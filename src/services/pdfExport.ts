import { jsPDF } from 'jspdf';
import { SavedReport, TIMEFRAME_ORDER, TimeframeId } from '../types/journal';
import {
  calculateOverallAlignment,
  findMatchingValues,
  isDeepAnalysisAligned,
} from '../utils/analysisUtils';

interface ExportPdfOptions {
  report: SavedReport;
  imagesMap?: Record<string, string>; // imgId -> dataUrl/blobUrl
}

const TIMEFRAME_DISPLAY_NAMES: Record<TimeframeId, string> = {
  Weekly: 'WEEKLY',
  Daily: 'DAILY',
  '4H': '4-HOUR',
  '1H': '1-HOUR',
  '15M': '15-MINUTE',
  '5M': '5-MINUTE',
  '1M': '1-MINUTE',
};

/**
 * Generates and triggers download of an A4 portrait PDF with selectable text
 * matching the organized document layout specification.
 */
export async function downloadReportPdf({
  report,
  imagesMap = {},
}: ExportPdfOptions): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 11;
  const marginY = 12;
  const usableWidth = pageWidth - marginX * 2; // 188 mm
  const usableBottom = pageHeight - marginY;

  // Color palette matching Emerald Minimal typeset theme
  const emeraldMuted: [number, number, number] = [6, 95, 70]; // #065f46
  const textDark: [number, number, number] = [15, 23, 42]; // #0f172a
  const textMuted: [number, number, number] = [100, 116, 139]; // #64748b
  const ruleGray: [number, number, number] = [226, 232, 240]; // #e2e8f0

  const alignment = calculateOverallAlignment(report.timeframes);
  const matchingValues = findMatchingValues(report.timeframes);

  // Helper to draw header
  const drawPageHeader = () => {
    let curY = marginY + 4;

    // Document Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...emeraldMuted);
    doc.text(`ABMAX | ${report.pair} ANALYSIS`, marginX, curY);

    curY += 6;

    // Metadata line 1
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...textDark);

    const timeStr = report.time
      ? `${report.time}${report.timezone ? ` (${report.timezone})` : ''}`
      : '';
    const metaParts = [
      `Date: ${report.date}`,
      `Session: ${report.session}`,
      timeStr ? `Time: ${timeStr}` : '',
      `Made: ${report.analysisTiming || 'On time'}`,
      `Overall Alignment: ${alignment.label}`,
    ].filter(Boolean);

    doc.text(metaParts.join('   •   '), marginX, curY);
    curY += 4.5;

    // Provenance line
    doc.setFontSize(7.5);
    doc.setTextColor(...textMuted);
    const provParts: string[] = [];
    if (report.status === 'Modified') {
      provParts.push('Status: Modified Analysis');
    } else {
      provParts.push('Status: Original Analysis');
    }
    if (report.copiedFromId) {
      provParts.push(`Copied from: ${report.copiedFromId}`);
    }
    if (report.createdAt) {
      provParts.push(`Created: ${new Date(report.createdAt).toLocaleString()}`);
    }
    if (report.updatedAt) {
      provParts.push(`Updated: ${new Date(report.updatedAt).toLocaleString()}`);
    }
    doc.text(provParts.join('   ·   '), marginX, curY);
    curY += 3.5;

    // Separator rule
    doc.setDrawColor(...ruleGray);
    doc.setLineWidth(0.3);
    doc.line(marginX, curY, marginX + usableWidth, curY);

    return curY + 4;
  };

  const bodyStartY = drawPageHeader();

  // Three-column layout constants
  const gutter = 4;
  const colWidth = (usableWidth - gutter * 2) / 3; // ~60 mm
  const colX = [
    marginX,
    marginX + colWidth + gutter,
    marginX + (colWidth + gutter) * 2,
  ];

  // Helper: check if timeframe has any recorded detail
  const hasTimeframeDetail = (tf: TimeframeId) => {
    const d = report.timeframes[tf];
    if (!d) return false;
    const hasBias = Boolean(d.overallBias || d.biasSpecific);
    const hasSwing = Boolean(d.swing.direction || d.swing.high || d.swing.low || d.swing.bosAt);
    const hasInternal = Boolean(
      d.internal.direction || d.internal.high || d.internal.low || d.internal.ibosAt
    );
    const hasFractal = Boolean(d.fractal.direction || d.fractal.fractalBosAt);
    const hasNote = Boolean(d.note && d.note.trim());
    const hasChart = Boolean(d.chartImageId);
    const hasSD = (report.supplyDemandLevels || []).some((sd) => sd.timeframe === tf);
    return hasBias || hasSwing || hasInternal || hasFractal || hasNote || hasChart || hasSD;
  };

  // Helper to compile timeframe content lines
  const getTimeframeLines = (tf: TimeframeId): Array<{ type: 'heading' | 'body' | 'rule'; text: string }> => {
    const items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
    const d = report.timeframes[tf];
    const tfLabel = TIMEFRAME_DISPLAY_NAMES[tf];
    const biasStr = d?.overallBias ? d.overallBias : '—';

    items.push({
      type: 'heading',
      text: `${tfLabel} | ${biasStr}`,
    });

    if (!d || !hasTimeframeDetail(tf)) {
      items.push({ type: 'body', text: 'No detail recorded' });
      items.push({ type: 'rule', text: '' });
      return items;
    }

    // 1. Bias
    if (d.biasSpecific && d.biasSpecific.trim()) {
      items.push({ type: 'body', text: `Bias: ${d.biasSpecific.trim()}` });
    } else if (d.overallBias) {
      items.push({ type: 'body', text: `Bias: ${d.overallBias}` });
    } else {
      items.push({ type: 'body', text: 'Bias: —' });
    }

    // 2. Swing: [direction] | High [value] | Low [value] | BOS [value]
    const swingHasContent = Boolean(
      d.swing.direction || d.swing.high || d.swing.low || d.swing.bosAt
    );
    if (swingHasContent) {
      const sDir = d.swing.direction || '—';
      const sHigh = d.swing.high ? d.swing.high : '—';
      const sLow = d.swing.low ? d.swing.low : '—';
      const sBos = d.swing.bosAt ? d.swing.bosAt : '—';
      items.push({
        type: 'body',
        text: `Swing: ${sDir} | High ${sHigh} | Low ${sLow} | BOS ${sBos}`,
      });
    }

    // 3. Internal: [direction] | High [value] | Low [value] | iBOS [value]
    const internalHasContent = Boolean(
      d.internal.direction || d.internal.high || d.internal.low || d.internal.ibosAt
    );
    if (internalHasContent) {
      const iDir = d.internal.direction || '—';
      const iHigh = d.internal.high ? d.internal.high : '—';
      const iLow = d.internal.low ? d.internal.low : '—';
      const iBos = d.internal.ibosAt ? d.internal.ibosAt : '—';
      items.push({
        type: 'body',
        text: `Internal: ${iDir} | High ${iHigh} | Low ${iLow} | iBOS ${iBos}`,
      });
    }

    // 4. Fractal: [direction] | BOS [value]
    const fractalHasContent = Boolean(d.fractal.direction || d.fractal.fractalBosAt);
    if (fractalHasContent) {
      const fDir = d.fractal.direction || '—';
      const fBos = d.fractal.fractalBosAt ? d.fractal.fractalBosAt : '—';
      items.push({
        type: 'body',
        text: `Fractal: ${fDir} | BOS ${fBos}`,
      });
    }

    // 5. Deep alignment: [derived from existing logic, when applicable]
    if (d.swing.direction && d.internal.direction && d.fractal.direction) {
      if (isDeepAnalysisAligned(d)) {
        items.push({
          type: 'body',
          text: `Deep alignment: Aligned (${d.swing.direction})`,
        });
      } else {
        items.push({
          type: 'body',
          text: 'Deep alignment: Mixed / Divergent',
        });
      }
    }

    // 6. Supply / Demand
    const sdLevels = (report.supplyDemandLevels || []).filter((sd) => sd.timeframe === tf);
    if (sdLevels.length > 0) {
      const sdStrings = sdLevels.map((sd, i) => {
        const parts: string[] = [];
        if (sd.supply) parts.push(`Supply: ${sd.supply}`);
        if (sd.demand) parts.push(`Demand: ${sd.demand}`);
        return `#${i + 1} ${parts.join(' | ')}`;
      });
      items.push({
        type: 'body',
        text: `Supply / Demand: ${sdStrings.join('; ')}`,
      });
    }

    // 7. Note
    if (d.note && d.note.trim()) {
      items.push({
        type: 'body',
        text: `Note: ${d.note.trim()}`,
      });
    }

    // 8. Chart indicator
    if (d.chartImageId) {
      items.push({
        type: 'body',
        text: 'Chart: Attached (see Appendix page)',
      });
    }

    items.push({ type: 'rule', text: '' });
    return items;
  };

  // Compile Column 1: External Liquidity, Weekly, Daily
  const col1Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col1Items.push({ type: 'heading', text: 'EXTERNAL LIQUIDITY' });
  const liq = report.crossedLiquidity || [];
  if (liq.length > 0) {
    col1Items.push({ type: 'body', text: liq.join(', ') });
  } else {
    col1Items.push({ type: 'body', text: 'None recorded' });
  }
  col1Items.push({ type: 'rule', text: '' });
  col1Items.push(...getTimeframeLines('Weekly'));
  col1Items.push(...getTimeframeLines('Daily'));

  // Compile Column 2: 4-Hour, 1-Hour, 15-Minute
  const col2Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col2Items.push(...getTimeframeLines('4H'));
  col2Items.push(...getTimeframeLines('1H'));
  col2Items.push(...getTimeframeLines('15M'));

  // Compile Column 3: 5-Minute, 1-Minute, Overall Notes
  const col3Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col3Items.push(...getTimeframeLines('5M'));
  col3Items.push(...getTimeframeLines('1M'));
  col3Items.push({ type: 'heading', text: 'OVERALL NOTES' });
  if (report.overallNotes && report.overallNotes.trim()) {
    col3Items.push({ type: 'body', text: report.overallNotes.trim() });
  } else {
    col3Items.push({ type: 'body', text: 'None recorded' });
  }
  col3Items.push({ type: 'rule', text: '' });

  // Render a column's items within bounds
  const renderColumnItems = (
    items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }>,
    x: number,
    startY: number
  ): number => {
    let y = startY;

    for (const item of items) {
      if (item.type === 'heading') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...emeraldMuted);
        const lines = doc.splitTextToSize(item.text, colWidth);
        doc.text(lines, x, y);
        y += lines.length * 3.6 + 1.2;
      } else if (item.type === 'body') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...textDark);
        const lines = doc.splitTextToSize(item.text, colWidth);
        doc.text(lines, x, y);
        y += lines.length * 3.1 + 1.2;
      } else if (item.type === 'rule') {
        doc.setDrawColor(...ruleGray);
        doc.setLineWidth(0.2);
        doc.line(x, y, x + colWidth, y);
        y += 2.8;
      }
    }

    return y;
  };

  const endY1 = renderColumnItems(col1Items, colX[0], bodyStartY);
  const endY2 = renderColumnItems(col2Items, colX[1], bodyStartY);
  const endY3 = renderColumnItems(col3Items, colX[2], bodyStartY);

  const maxColumnY = Math.max(endY1, endY2, endY3);

  // Draw subtle vertical column separators
  doc.setDrawColor(...ruleGray);
  doc.setLineWidth(0.2);
  const separatorTop = bodyStartY - 2;
  const separatorBottom = Math.min(maxColumnY, usableBottom - 25);
  doc.line(colX[1] - gutter / 2, separatorTop, colX[1] - gutter / 2, separatorBottom);
  doc.line(colX[2] - gutter / 2, separatorTop, colX[2] - gutter / 2, separatorBottom);

  // Full-width ending: Matching Values and Footer
  let endingY = maxColumnY + 4;
  if (endingY > usableBottom - 25) {
    doc.addPage();
    endingY = marginY + 6;
  }

  // Full-width separator
  doc.setDrawColor(...ruleGray);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  // Matching Values section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...emeraldMuted);
  doc.text('MATCHING VALUES', marginX, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...textDark);

  if (matchingValues.length > 0) {
    for (const group of matchingValues) {
      const occText = group.occurrences
        .map((occ) => `${occ.timeframe} ${occ.field}`)
        .join(', ');
      const matchLine = `• Price ${group.displayPrice}: ${occText}`;
      const lines = doc.splitTextToSize(matchLine, usableWidth);
      doc.text(lines, marginX, endingY);
      endingY += lines.length * 3.2;
    }
  } else {
    doc.text('None detected', marginX, endingY);
    endingY += 4;
  }

  endingY += 4;

  // Helper to ensure enough vertical room or start a new page
  const ensureSpace = (neededHeight: number) => {
    if (endingY + neededHeight > usableBottom - 10) {
      doc.addPage();
      endingY = marginY + 6;
    }
  };

  // PLANNED SCENARIOS SECTION (Appended after 3-column analysis and matching values)
  ensureSpace(15);
  doc.setDrawColor(...ruleGray);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...emeraldMuted);
  const scnCount = report.scenarios?.length || 0;
  doc.text(`PLANNED SCENARIOS (${scnCount})`, marginX, endingY);
  endingY += 4.5;

  if (report.scenarios && report.scenarios.length > 0) {
    for (const sc of report.scenarios) {
      ensureSpace(18);
      // Scenario Header: Label [Direction] Strategy
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...textDark);
      const scHeader = `${sc.label || 'Scenario'}${sc.direction ? ` [${sc.direction.toUpperCase()}]` : ''}${
        sc.strategy ? ` — ${sc.strategy}` : ''
      }`;
      doc.text(scHeader, marginX, endingY);
      endingY += 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...textDark);

      if (sc.description) {
        const descLines = doc.splitTextToSize(`Description: ${sc.description}`, usableWidth);
        ensureSpace(descLines.length * 3.2);
        doc.text(descLines, marginX, endingY);
        endingY += descLines.length * 3.2 + 1;
      }

      if (sc.entryConditions) {
        const entryLines = doc.splitTextToSize(`Entry Rules: ${sc.entryConditions}`, usableWidth);
        ensureSpace(entryLines.length * 3.2);
        doc.text(entryLines, marginX, endingY);
        endingY += entryLines.length * 3.2 + 1;
      }

      if (sc.invalidationConditions) {
        doc.setTextColor(185, 28, 28); // subtle red
        const invLines = doc.splitTextToSize(
          `Invalidation: ${sc.invalidationConditions}`,
          usableWidth
        );
        ensureSpace(invLines.length * 3.2);
        doc.text(invLines, marginX, endingY);
        endingY += invLines.length * 3.2 + 2;
        doc.setTextColor(...textDark);
      } else {
        endingY += 1;
      }
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...textMuted);
    doc.text('No scenarios recorded.', marginX, endingY);
    endingY += 4.5;
  }

  // TRADES TAKEN SECTION (Appended below Planned Scenarios)
  ensureSpace(15);
  doc.setDrawColor(...ruleGray);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...emeraldMuted);
  const tradeCount = report.trades?.length || 0;
  doc.text(`TRADES TAKEN (${tradeCount})`, marginX, endingY);
  endingY += 4.5;

  if (report.trades && report.trades.length > 0) {
    for (const trd of report.trades) {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...textDark);
      const outcomeText = trd.outcome ? ` | Outcome: ${trd.outcome}` : '';
      const rulesText = trd.rulesFollowed !== false ? ' [Rules Followed]' : ' [Rules Broken]';
      const trdHeader = `• ${trd.direction || 'Trade'} — ${trd.scenarioLabel || 'Execution'}${outcomeText}${rulesText}`;
      doc.text(trdHeader, marginX, endingY);
      endingY += 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...textDark);

      const priceParts: string[] = [];
      if (trd.timeframeTaken) priceParts.push(`TF: ${trd.timeframeTaken}`);
      if (trd.session) priceParts.push(`Session: ${trd.session}`);
      if (trd.entryPrice) priceParts.push(`Entry: ${trd.entryPrice}`);
      if (trd.stopLoss) priceParts.push(`SL: ${trd.stopLoss}`);
      if (trd.takeProfit) priceParts.push(`TP: ${trd.takeProfit}`);
      if (trd.exitPrice) priceParts.push(`Exit: ${trd.exitPrice}`);
      if (trd.riskReward) priceParts.push(`R:R: ${trd.riskReward}`);

      if (priceParts.length > 0) {
        doc.text(priceParts.join('  •  '), marginX + 3, endingY);
        endingY += 3.5;
      }

      if (trd.notes) {
        const noteLines = doc.splitTextToSize(`Notes: "${trd.notes}"`, usableWidth - 3);
        ensureSpace(noteLines.length * 3.2);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(...textMuted);
        doc.text(noteLines, marginX + 3, endingY);
        endingY += noteLines.length * 3.2 + 2;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...textDark);
      } else {
        endingY += 1.5;
      }
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...textMuted);
    doc.text('No trades recorded.', marginX, endingY);
    endingY += 4.5;
  }

  endingY += 3;

  // Small footer
  doc.setDrawColor(...ruleGray);
  doc.setLineWidth(0.2);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 3.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...textMuted);
  doc.text('ABMAX ANALYSIS — Trading Journal', marginX, endingY);

  // CHART ATTACHMENT PAGES (APPENDIX)
  // Check if any timeframe has attached charts loaded in imagesMap
  const chartsToExport: Array<{ tf: TimeframeId; imgUrl: string }> = [];
  for (const tf of TIMEFRAME_ORDER) {
    const imgId = report.timeframes[tf]?.chartImageId;
    if (imgId && imagesMap[imgId]) {
      chartsToExport.push({ tf, imgUrl: imagesMap[imgId] });
    }
  }

  if (chartsToExport.length > 0) {
    for (const chart of chartsToExport) {
      doc.addPage();
      let pageY = marginY + 4;

      // Appendix Page Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...emeraldMuted);
      doc.text(`CHART APPENDIX — ${TIMEFRAME_DISPLAY_NAMES[chart.tf]}`, marginX, pageY);
      pageY += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...textMuted);
      doc.text(`Report: ${report.pair}  •  ${report.date}  •  ${report.session} Session`, marginX, pageY);
      pageY += 3;

      doc.setDrawColor(...ruleGray);
      doc.setLineWidth(0.3);
      doc.line(marginX, pageY, marginX + usableWidth, pageY);
      pageY += 6;

      try {
        // Draw image scaled while preserving aspect ratio
        const maxImgWidth = usableWidth; // 188mm
        const maxImgHeight = pageHeight - pageY - marginY - 10; // ~230mm

        // Use jsPDF's internal image handling
        doc.addImage(
          chart.imgUrl,
          'JPEG',
          marginX,
          pageY,
          maxImgWidth,
          maxImgHeight,
          undefined,
          'FAST'
        );
      } catch (err) {
        console.warn(`Could not render chart image for ${chart.tf}:`, err);
        doc.setFontSize(8);
        doc.setTextColor(...textMuted);
        doc.text(`[Chart screenshot for ${chart.tf} could not be rendered in PDF]`, marginX, pageY + 10);
      }

      // Appendix footer
      doc.setFontSize(7);
      doc.setTextColor(...textMuted);
      doc.text(
        `ABMAX ANALYSIS — ${TIMEFRAME_DISPLAY_NAMES[chart.tf]} Chart Screenshot`,
        marginX,
        pageHeight - marginY
      );
    }
  }

  // Sanitize filename: ABMAX_[PAIR]_[ANALYSIS-DATE].pdf
  const sanitizedPair = (report.pair || 'UNKNOWN').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedDate = (report.date || new Date().toISOString().slice(0, 10)).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const filename = `ABMAX_${sanitizedPair}_${sanitizedDate}.pdf`;

  // Trigger browser download
  doc.save(filename);
}
