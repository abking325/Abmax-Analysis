import { jsPDF } from 'jspdf';
import {
  JournalEntry,
  RecordedTrade,
  SavedReport,
  TIMEFRAME_ORDER,
} from '../types/journal';
import {
  PDF_THEMES,
  PdfExportStyle,
  detectPdfImageFormat,
  getPdfImageDimensions,
  getPdfStatusColor,
  resolveAllReportImages,
} from './pdfExport';
import { exportBlobOrDownload } from '../utils/nativeExport';

export interface PeriodExportOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  periodLabel?: string;
  preset?: 'today' | 'week' | 'month' | 'custom' | string;
  mode: 'summary' | 'full';
  includeAnalyses: boolean;
  includeTrades: boolean;
  includeJournal: boolean;
  includeMyJournalNotes?: boolean;
  includePerformance: boolean;
  includeImages: boolean;
  style?: PdfExportStyle;
  reports: SavedReport[];
  journalEntries: JournalEntry[];
  userId?: string | null;
  imagesMap?: Record<string, string>;
}

export function extractDeduplicatedTrades(
  reports: SavedReport[]
): (RecordedTrade & { sourceReportId?: string; sourceReportDate?: string; _reportUpdatedAt?: number })[] {
  const tradeMap = new Map<
    string,
    RecordedTrade & { sourceReportId?: string; sourceReportDate?: string; _reportUpdatedAt?: number }
  >();
  for (const r of reports) {
    for (const t of r.trades || []) {
      if (!t.id) continue;
      const existing = tradeMap.get(t.id);
      const tUpdated = t.updatedAt || r.updatedAt || 0;
      const existingUpdated = existing ? (existing.updatedAt || existing._reportUpdatedAt || 0) : -1;
      const shouldReplace =
        !existing ||
        tUpdated > existingUpdated ||
        (tUpdated === existingUpdated && (r.id || '') < (existing.sourceReportId || ''));
      if (shouldReplace) {
        tradeMap.set(t.id, {
          ...t,
          sourceReportId: r.id,
          sourceReportDate: r.date,
          _reportUpdatedAt: r.updatedAt,
        });
      }
    }
  }
  return Array.from(tradeMap.values());
}

export function calculatePeriodPerformance(trades: RecordedTrade[]) {
  let rulesFollowed = 0;
  let rulesBroken = 0;
  let unreviewed = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;

  for (const t of trades) {
    if (t.rulesFollowed === true) rulesFollowed++;
    else if (t.rulesFollowed === false) rulesBroken++;
    else unreviewed++;

    const out = (t.outcome || '').toLowerCase();
    if (out === 'win') wins++;
    else if (out === 'loss') losses++;
    else if (out === 'breakeven' || out === 'break-even') breakevens++;
  }

  const reviewedTrades = rulesFollowed + rulesBroken;
  const disciplineRate = reviewedTrades > 0 ? Math.round((rulesFollowed / reviewedTrades) * 100) : null;
  const decidedTrades = wins + losses;
  const winRate = decidedTrades > 0 ? Math.round((wins / decidedTrades) * 100) : null;

  return {
    totalTrades: trades.length,
    rulesFollowed,
    rulesBroken,
    unreviewed,
    reviewedTrades,
    disciplineRate,
    wins,
    losses,
    breakevens,
    decidedTrades,
    winRate,
  };
}

export async function generatePeriodPdfBlob(
  options: PeriodExportOptions
): Promise<{ blob: Blob; filename: string }> {
  const {
    startDate,
    endDate,
    periodLabel,
    mode,
    includeAnalyses,
    includeTrades,
    includeJournal,
    includeMyJournalNotes = false,
    includePerformance,
    includeImages,
    style = 'minimal',
    reports,
    journalEntries,
    userId,
    imagesMap = {},
  } = options;

  const theme = PDF_THEMES[style] || PDF_THEMES.minimal;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297 mm
  const marginX = 14;
  const marginY = 14;
  const usableWidth = pageWidth - marginX * 2; // 182 mm
  const usableBottom = pageHeight - marginY; // 283 mm

  // Filter records within date range
  const filteredReports = reports.filter((r) => {
    if (!startDate || !endDate) return true;
    return r.date >= startDate && r.date <= endDate;
  });

  const filteredJournal = journalEntries.filter((j) => {
    const isMyJournal = j.entryType === 'my-journal' || j.entryType === ('my_journal' as any);
    if (isMyJournal && !includeMyJournalNotes) {
      return false;
    }
    if (!startDate || !endDate) return true;
    return j.date >= startDate && j.date <= endDate;
  });

  // Extract unique trades with deterministic revision selection
  const periodTrades = extractDeduplicatedTrades(filteredReports);

  // Calculate discipline & performance
  const {
    rulesFollowed,
    unreviewed,
    reviewedTrades,
    disciplineRate,
    wins,
    losses,
    decidedTrades,
    winRate,
  } = calculatePeriodPerformance(periodTrades);

  // Background painter
  const applyPageBg = () => {
    if (theme.isDark) {
      doc.setFillColor(...theme.pageBg);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
    }
  };
  applyPageBg();

  const addNewPage = () => {
    doc.addPage();
    applyPageBg();
  };

  let curY = marginY + 4;

  const ensureSpace = (neededHeight: number) => {
    if (curY + neededHeight > usableBottom - 10) {
      addNewPage();
      curY = marginY + 6;
    }
  };

  const drawWrapped = (
    text: string,
    x: number,
    maxWidth: number,
    lineHeight: number,
    extraBottomGap = 0
  ) => {
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      ensureSpace(lineHeight + 1);
      doc.text(line, x, curY);
      curY += lineHeight;
    }
    curY += extraBottomGap;
  };

  // Header Zone
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...theme.primaryText);
  const modeTag = mode === 'summary' ? 'SUMMARY REPORT' : 'FULL DETAIL REPORT';
  drawWrapped(`ABMAX | PERIOD ${modeTag}`, marginX, usableWidth, 5.5, 0.5);

  const displayPeriod = periodLabel || (startDate && endDate ? `${startDate} to ${endDate}` : 'ALL SESSIONS');
  const themeName = theme.displayName || style || 'MINIMAL';
  doc.setFontSize(10);
  doc.setTextColor(...theme.headingText);
  drawWrapped(`REPORTING PERIOD: ${displayPeriod.toUpperCase()}  •  ${themeName.toUpperCase()}`, marginX, usableWidth, 4.2, 0.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...theme.secondaryText);
  drawWrapped(
    `Exported: ${new Date().toLocaleString()}   ·   Analyses: ${filteredReports.length}   ·   Trades: ${periodTrades.length}   ·   Journal Entries: ${filteredJournal.length}`,
    marginX,
    usableWidth,
    3.8,
    0.5
  );

  // Rule
  doc.setDrawColor(...theme.headerRuleColor);
  doc.setLineWidth(0.35);
  doc.line(marginX, curY, marginX + usableWidth, curY);
  curY += 5;

  // SECTION 1: PERFORMANCE & DISCIPLINE SUMMARY
  if (includePerformance) {
    ensureSpace(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...theme.headingText);
    doc.text('1. EXECUTION QUALITY & DISCIPLINE SUMMARY', marginX, curY);
    curY += 4.5;

    // Stat cards row
    const cardGutter = 2.5;
    const cardWidth = (usableWidth - cardGutter * 3) / 4;
    const cardHeight = 15;

    const uniqueAnalysisDays = new Set(filteredReports.map((r) => r.date).filter(Boolean)).size;
    const cards = [
      {
        label: 'Discipline Rate',
        val: disciplineRate !== null ? `${disciplineRate}%` : 'No reviewed trades',
        sub: reviewedTrades > 0 ? `${rulesFollowed}/${reviewedTrades} reviewed` : '0 reviewed trades',
      },
      {
        label: 'Win Rate',
        val: winRate !== null ? `${winRate}%` : 'No decided trades',
        sub: decidedTrades > 0 ? `${wins}W / ${losses}L (${decidedTrades} closed)` : '0 decided trades',
      },
      {
        label: 'Trades Executed',
        val: `${periodTrades.length}`,
        sub: `${unreviewed} unreviewed`,
      },
      {
        label: 'Analyses Logged',
        val: `${filteredReports.length}`,
        sub: periodLabel || `${uniqueAnalysisDays} active day${uniqueAnalysisDays === 1 ? '' : 's'}`,
      },
    ];

    cards.forEach((c, i) => {
      const cx = marginX + i * (cardWidth + cardGutter);
      doc.setFillColor(...theme.sectionFill);
      doc.setDrawColor(...theme.cardBorder);
      doc.setLineWidth(0.25);
      doc.roundedRect(cx, curY, cardWidth, cardHeight, 1, 1, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...theme.secondaryText);
      doc.text(c.label, cx + 2, curY + 3.8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(c.val.length > 5 ? 7.0 : 10.5);
      doc.setTextColor(...theme.headingText);
      const valLines = doc.splitTextToSize(c.val, cardWidth - 4);
      doc.text(valLines[0] || c.val, cx + 2, curY + 8.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(...theme.secondaryText);
      const subLines = doc.splitTextToSize(c.sub, cardWidth - 4);
      doc.text(subLines[0] || c.sub, cx + 2, curY + 12.5);
    });

    curY += cardHeight + 5;
  }

  // SECTION 2: ANALYSES LOGGED
  if (includeAnalyses) {
    ensureSpace(26);
    doc.setDrawColor(...theme.dividerColor);
    doc.setLineWidth(0.25);
    doc.line(marginX, curY, marginX + usableWidth, curY);
    curY += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...theme.headingText);
    doc.text(`2. MARKET ANALYSES (${filteredReports.length})`, marginX, curY);
    curY += 4.5;

    if (filteredReports.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.secondaryText);
      doc.text('No market analyses logged during this period.', marginX, curY);
      curY += 5;
    } else {
      for (const rpt of filteredReports) {
        ensureSpace(12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...theme.primaryText);
        const sessionLabel = rpt.session || (rpt as any).data?.session || '';
        const sessionStr = sessionLabel ? ` — ${sessionLabel}` : '';
        const rptTitle = `${rpt.date} | ${rpt.pair}${sessionStr} (${rpt.title || 'Analysis'})`;
        drawWrapped(rptTitle, marginX, usableWidth, 3.4, 0.3);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...theme.secondaryText);
        const tfData = rpt.timeframes || (rpt as any).data?.timeframes || {};
        const biasParts = TIMEFRAME_ORDER.map((tf) => {
          const entry = tfData[tf] as { overallBias?: string; bias?: string } | undefined;
          return `${tf}:${entry?.overallBias || entry?.bias || '—'}`;
        }).join('  ');
        drawWrapped(`Biases: ${biasParts}`, marginX + 2, usableWidth - 4, 3.1, 0.3);

        const noteText = rpt.overallNotes || (rpt as any).data?.summaryNotes || '';
        if (mode === 'full' && noteText) {
          doc.setTextColor(...theme.primaryText);
          drawWrapped(`Notes: ${noteText}`, marginX + 2, usableWidth - 4, 3.1, 0.5);
        }
        curY += 1.2;
      }
    }
  }

  // SECTION 3: TRADES EXECUTED
  if (includeTrades) {
    ensureSpace(26);
    doc.setDrawColor(...theme.dividerColor);
    doc.setLineWidth(0.25);
    doc.line(marginX, curY, marginX + usableWidth, curY);
    curY += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...theme.headingText);
    doc.text(`3. TRADES RECORDED (${periodTrades.length})`, marginX, curY);
    curY += 4.5;

    if (periodTrades.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.secondaryText);
      doc.text('No trades recorded during this period.', marginX, curY);
      curY += 5;
    } else {
      for (const trd of periodTrades) {
        ensureSpace(12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);

        const dirLabel = `• ${trd.direction || 'TRADE'}`;
        const dirColor = getPdfStatusColor(trd.direction, theme.isDark);
        doc.setTextColor(...dirColor);
        doc.text(dirLabel, marginX, curY);
        const dirW = doc.getTextWidth(dirLabel) + 2;

        doc.setTextColor(...theme.primaryText);
        const titleStr = `${trd.pair} (${trd.date || '—'}) — ${trd.scenarioLabel || 'Execution'}`;
        const firstLineMaxW = Math.max(40, usableWidth - dirW);
        const titleLines = doc.splitTextToSize(titleStr, firstLineMaxW);
        doc.text(titleLines[0] || '', marginX + dirW, curY);
        curY += 3.5;
        for (let ti = 1; ti < titleLines.length; ti++) {
          ensureSpace(3.4);
          doc.text(titleLines[ti], marginX + 2, curY);
          curY += 3.4;
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...theme.secondaryText);

        const rulesText = trd.rulesFollowed !== false ? 'Rules Followed' : 'Rules Broken';
        const details = [
          trd.session ? `Session: ${trd.session}` : '',
          trd.timeframeTaken ? `TF: ${trd.timeframeTaken}` : '',
          trd.entryPrice ? `Entry: ${trd.entryPrice}` : '',
          trd.exitPrice ? `Exit: ${trd.exitPrice}` : '',
          trd.riskReward ? `R:R: ${trd.riskReward}` : '',
          trd.outcome ? `Outcome: ${trd.outcome}` : '',
          rulesText,
        ].filter(Boolean);

        drawWrapped(details.join('   •   '), marginX + 2, usableWidth - 4, 3.2, 0.3);

        if (mode === 'full' && trd.notes) {
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(...theme.primaryText);
          drawWrapped(`Notes: "${trd.notes}"`, marginX + 2, usableWidth - 4, 3.1, 0.4);
        }
        curY += 1.2;
      }
    }
  }

  // SECTION 4: JOURNAL REFLECTIONS & LESSONS
  if (includeJournal) {
    ensureSpace(28);
    doc.setDrawColor(...theme.dividerColor);
    doc.setLineWidth(0.25);
    doc.line(marginX, curY, marginX + usableWidth, curY);
    curY += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...theme.headingText);
    doc.text(`4. JOURNAL REFLECTIONS & LESSONS (${filteredJournal.length})`, marginX, curY);
    curY += 4.5;

    if (filteredJournal.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.secondaryText);
      doc.text('No journal reflections logged during this period.', marginX, curY);
      curY += 5;
    } else {
      for (const j of filteredJournal) {
        ensureSpace(14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...theme.primaryText);

        const isMyJournal = j.entryType === 'my-journal' || (j.entryType as string) === 'my_journal';
        if (isMyJournal) {
          const contextTag = j.myJournalContext ? ` [${j.myJournalContext}]` : ' [Personal Note]';
          const jTitle = `${j.date}${j.time ? ` ${j.time}` : ''} | ${j.title || 'Personal Reflection'}${contextTag}`;
          drawWrapped(jTitle, marginX, usableWidth, 3.5, 0.2);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...theme.secondaryText);

          const items: string[] = [];
          if (j.emotionalState) items.push(`Mood: ${j.emotionalState}`);
          if (j.tags && j.tags.length > 0) items.push(`Tags: ${j.tags.join(', ')}`);
          if (j.linkedReportTitle) items.push(`Linked: ${j.linkedReportTitle}`);
          if (items.length > 0) {
            drawWrapped(items.join('   •   '), marginX + 2, usableWidth - 4, 3.2, 0.2);
          }

          const noteText = j.notes || j.generalNotes || '';
          if (noteText) {
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...theme.primaryText);
            drawWrapped(noteText, marginX + 2, usableWidth - 4, 3.2, 0.3);
          }
          curY += 1.5;
        } else {
          const jTitle = `${j.date} | ${j.title || 'Session Reflection'}${j.session ? ` (${j.session})` : ''}`;
          drawWrapped(jTitle, marginX, usableWidth, 3.5, 0.2);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(...theme.secondaryText);

          const items: string[] = [];
          if (j.prep?.readinessState) items.push(`Readiness: ${j.prep.readinessState}`);
          if (j.preTrade?.setupTag) items.push(`Setup: ${j.preTrade.setupTag}`);
          if (j.postTrade?.rulesFollowedStatus) items.push(`Compliance: ${j.postTrade.rulesFollowedStatus}`);
          if (items.length > 0) {
            drawWrapped(items.join('   •   '), marginX + 2, usableWidth - 4, 3.2, 0.2);
          }

          if (mode === 'full') {
            if (j.prep?.sessionIntention) {
              doc.setTextColor(...theme.primaryText);
              drawWrapped(`Intention: ${j.prep.sessionIntention}`, marginX + 2, usableWidth - 4, 3.1, 0.1);
            }
            if (j.preTrade?.reasonForTrade) {
              doc.setTextColor(...theme.primaryText);
              drawWrapped(`Trade Thesis: ${j.preTrade.reasonForTrade}`, marginX + 2, usableWidth - 4, 3.1, 0.1);
            }
            if (j.inTrade?.managementDecisions) {
              doc.setTextColor(...theme.primaryText);
              drawWrapped(`In-Trade Management: ${j.inTrade.managementDecisions}`, marginX + 2, usableWidth - 4, 3.1, 0.1);
            }
            if (j.postTrade?.executionReview) {
              doc.setTextColor(...theme.primaryText);
              drawWrapped(`Execution Review: ${j.postTrade.executionReview}`, marginX + 2, usableWidth - 4, 3.1, 0.1);
            }
          }

          if (j.reflection?.whatWorked) {
            doc.setTextColor(...getPdfStatusColor('Bullish', theme.isDark));
            drawWrapped(`What Worked: ${j.reflection.whatWorked}`, marginX + 2, usableWidth - 4, 3.2, 0.1);
          }

          if (j.reflection?.whatDidNot) {
            doc.setTextColor(...getPdfStatusColor('Bearish', theme.isDark));
            drawWrapped(`What Did Not Work: ${j.reflection.whatDidNot}`, marginX + 2, usableWidth - 4, 3.2, 0.1);
          }

          if (j.reflection?.keyLessons) {
            doc.setTextColor(...theme.primaryText);
            drawWrapped(`Key Lessons: ${j.reflection.keyLessons}`, marginX + 2, usableWidth - 4, 3.2, 0.1);
          }

          if (j.reflection?.nextSessionCommitment) {
            doc.setTextColor(...theme.headingText);
            drawWrapped(`Next Commitment: ${j.reflection.nextSessionCommitment}`, marginX + 2, usableWidth - 4, 3.2, 0.1);
          }

          if (mode === 'full' && j.generalNotes) {
            doc.setTextColor(...theme.secondaryText);
            drawWrapped(`Notes: ${j.generalNotes}`, marginX + 2, usableWidth - 4, 3.1, 0.1);
          }

          curY += 1.5;
        }
      }
    }
  }

  // SECTION 5: ATTACHED CHARTS & SCREENSHOTS (when includeImages is enabled)
  if (includeImages) {
    interface PeriodAttachmentItem {
      id: string;
      label: string;
      sublabel: string;
      caption?: string;
      imgUrl?: string;
    }

    const attachmentItems: PeriodAttachmentItem[] = [];

    if (includeAnalyses) {
      for (const rpt of filteredReports) {
        const resolvedMap = await resolveAllReportImages(rpt, userId, imagesMap);

        for (const tf of TIMEFRAME_ORDER) {
          const imgId = rpt.timeframes?.[tf]?.chartImageId;
          if (imgId) {
            attachmentItems.push({
              id: imgId,
              label: `${rpt.pair} • ${tf} CHART`,
              sublabel: `${rpt.date}${rpt.title ? ` — ${rpt.title}` : ''}`,
              imgUrl: resolvedMap[imgId] || resolvedMap[tf],
            });
          }
        }

        if (rpt.scenarios) {
          for (const sc of rpt.scenarios) {
            if (sc.images && sc.images.length > 0) {
              sc.images.forEach((img, idx) => {
                attachmentItems.push({
                  id: img.id,
                  label: `SCENARIO: ${sc.label || 'Plan'} (${idx + 1}/${sc.images!.length})`,
                  sublabel: `${rpt.pair} • ${rpt.date}`,
                  caption: img.caption,
                  imgUrl: img.dataUrl || resolvedMap[img.id],
                });
              });
            }
          }
        }
      }
    }

    if (includeTrades) {
      for (const trd of periodTrades) {
        if (trd.images && trd.images.length > 0) {
          trd.images.forEach((img, idx) => {
            attachmentItems.push({
              id: img.id,
              label: `TRADE: ${trd.pair} ${trd.direction || ''} (${idx + 1}/${trd.images!.length})`.trim(),
              sublabel: `${trd.date || '—'} • ${trd.outcome || 'Recorded'}`,
              caption: img.caption,
              imgUrl: img.dataUrl,
            });
          });
        }
      }
    }

    if (includeJournal) {
      for (const j of filteredJournal) {
        const seenUrls = new Set<string>();
        if (j.images && j.images.length > 0) {
          j.images.forEach((img, idx) => {
            if (img.dataUrl) seenUrls.add(img.dataUrl);
            attachmentItems.push({
              id: img.id,
              label: `JOURNAL: ${j.title || 'Entry'} (${idx + 1}/${j.images!.length})`,
              sublabel: `${j.date} • ${j.pair || j.session || 'Journal'}`,
              caption: img.caption || img.name,
              imgUrl: img.dataUrl,
            });
          });
        }
        if (j.imageUrl && !seenUrls.has(j.imageUrl)) {
          attachmentItems.push({
            id: `${j.id}_img`,
            label: `JOURNAL: ${j.title || 'Entry'}`,
            sublabel: `${j.date} • ${j.pair || j.session || 'Journal'}`,
            imgUrl: j.imageUrl,
          });
        }
      }
    }

    if (attachmentItems.length > 0) {
      const thumbGutter = 5;
      const thumbCardWidth = (usableWidth - thumbGutter) / 2;
      const maxImgW = thumbCardWidth - 6;
      const maxImgH = 48;
      const cardPaddingTop = 8;
      const cardPaddingBottom = 5;

      const firstItem = attachmentItems[0];
      const secondItem = attachmentItems[1] as PeriodAttachmentItem | undefined;
      const firstDims1 = firstItem.imgUrl
        ? await getPdfImageDimensions(firstItem.imgUrl, maxImgW, maxImgH)
        : { width: maxImgW, height: 40, error: true };
      const firstDims2 = secondItem?.imgUrl
        ? await getPdfImageDimensions(secondItem.imgUrl, maxImgW, maxImgH)
        : { width: maxImgW, height: 40, error: Boolean(secondItem) };
      const firstRowH =
        Math.max(firstDims1.height, secondItem ? firstDims2.height : 0) +
        cardPaddingTop +
        cardPaddingBottom +
        (firstItem.caption || secondItem?.caption ? 5 : 0);

      ensureSpace(14 + firstRowH);
      doc.setDrawColor(...theme.dividerColor);
      doc.setLineWidth(0.25);
      doc.line(marginX, curY, marginX + usableWidth, curY);
      curY += 4;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...theme.headingText);
      doc.text(`5. ATTACHED CHARTS & SCREENSHOTS (${attachmentItems.length})`, marginX, curY);
      curY += 5;

      for (let i = 0; i < attachmentItems.length; i += 2) {
        const item1 = attachmentItems[i];
        const item2 = attachmentItems[i + 1] as PeriodAttachmentItem | undefined;

        const dims1 =
          i === 0
            ? firstDims1
            : item1.imgUrl
              ? await getPdfImageDimensions(item1.imgUrl, maxImgW, maxImgH)
              : { width: maxImgW, height: 40, error: true };
        const dims2 =
          i === 0 && secondItem
            ? firstDims2
            : item2?.imgUrl
              ? await getPdfImageDimensions(item2.imgUrl, maxImgW, maxImgH)
              : { width: maxImgW, height: 40, error: Boolean(item2) };

        const rowH =
          Math.max(dims1.height, item2 ? dims2.height : 0) +
          cardPaddingTop +
          cardPaddingBottom +
          (item1.caption || item2?.caption ? 5 : 0);

        ensureSpace(rowH + 4);

        const renderCard = (item: PeriodAttachmentItem, dims: { width: number; height: number; error: boolean }, cardX: number) => {
          const cardY = curY;
          doc.setFillColor(...theme.sectionFill);
          doc.setDrawColor(...theme.cardBorder);
          doc.setLineWidth(0.2);
          doc.roundedRect(cardX, cardY, thumbCardWidth, rowH, 1.5, 1.5, 'FD');

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(...theme.headingText);
          doc.text(doc.splitTextToSize(item.label, maxImgW - 2)[0] || item.label, cardX + 3, cardY + 4);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(...theme.secondaryText);
          doc.text(doc.splitTextToSize(item.sublabel, maxImgW - 2)[0] || item.sublabel, cardX + 3, cardY + 7);

          if (item.imgUrl && !dims.error) {
            try {
              const imgX = cardX + 3 + (maxImgW - dims.width) / 2;
              const imgY = cardY + cardPaddingTop;
              doc.addImage(
                item.imgUrl,
                detectPdfImageFormat(item.imgUrl),
                imgX,
                imgY,
                dims.width,
                dims.height,
                undefined,
                'FAST'
              );
            } catch {
              doc.setFontSize(7);
              doc.setTextColor(...theme.warningText);
              doc.text('[Image could not be embedded]', cardX + 4, cardY + 22);
            }
          } else {
            doc.setFontSize(7);
            doc.setTextColor(...theme.warningText);
            doc.text('[!] Chart image could not be loaded from storage.', cardX + 4, cardY + 22);
          }

          if (item.caption) {
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(6.5);
            doc.setTextColor(...theme.secondaryText);
            const capLines = doc.splitTextToSize(`"${item.caption}"`, maxImgW);
            doc.text(capLines[0] || '', cardX + 3, cardY + cardPaddingTop + dims.height + 3.5);
          }
        };

        renderCard(item1, dims1, marginX);
        if (item2) {
          renderCard(item2, dims2, marginX + thumbCardWidth + thumbGutter);
        }

        curY += rowH + 4;
      }
    }
  }

  // Running Page Numbering (Page X of Y)
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...theme.secondaryText);
    const footerText = `ABMAX Analysis — Confidential Period Report  •  Page ${p} of ${totalPages}`;
    doc.text(footerText, pageWidth / 2, pageHeight - marginY / 2, { align: 'center' });
  }

  const cleanStart = (startDate || 'period').replace(/-/g, '');
  const cleanEnd = (endDate || 'report').replace(/-/g, '');
  const styleSlug = style === 'minimal' ? '' : `_${style}`;
  const filename = `ABMAX_Period_${cleanStart}_${cleanEnd}${styleSlug}.pdf`;
  const blob = doc.output('blob');

  return { blob, filename };
}

export async function exportPeriodReport(options: PeriodExportOptions): Promise<void> {
  const { blob, filename } = await generatePeriodPdfBlob(options);
  await exportBlobOrDownload(blob, filename, 'application/pdf', 'ABMAX Period Report');
}

