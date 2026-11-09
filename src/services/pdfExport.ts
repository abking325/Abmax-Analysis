import { jsPDF } from 'jspdf';
import {
  ReportPresentationConfig,
  SavedReport,
  TIMEFRAME_ORDER,
  TimeframeId,
} from '../types/journal';
import {
  calculateOverallAlignment,
  findMatchingValues,
  isDeepAnalysisAligned,
} from '../utils/analysisUtils';
import { exportBlobOrDownload } from '../utils/nativeExport';
import { getChartImageUrl } from './cloudSync';
import { getImage } from './db';

export type PdfExportStyle = 'minimal' | 'emerald' | 'dark';

export interface ExportPdfOptions {
  report: SavedReport;
  imagesMap?: Record<string, string>; // imgId or tf -> dataUrl/blobUrl
  presentationConfig?: ReportPresentationConfig;
  style?: PdfExportStyle; // Defaults to 'minimal' (Minimal Journal)
  userId?: string | null;
}

export interface PdfThemePalette {
  style: PdfExportStyle;
  displayName: string;
  isDark: boolean;
  pageBg: [number, number, number];
  primaryText: [number, number, number];
  secondaryText: [number, number, number];
  headingText: [number, number, number];
  accentText: [number, number, number];
  warningText: [number, number, number];
  dividerColor: [number, number, number];
  headerRuleColor: [number, number, number];
  sectionFill: [number, number, number];
  cardBorder: [number, number, number];
}

export const PDF_THEMES: Record<PdfExportStyle, PdfThemePalette> = {
  minimal: {
    style: 'minimal',
    displayName: 'Minimal Journal',
    isDark: false,
    pageBg: [255, 255, 255],
    primaryText: [15, 23, 42], // #0f172a
    secondaryText: [100, 116, 139], // #64748b
    headingText: [30, 41, 59], // #1e293b
    accentText: [15, 23, 42], // #0f172a
    warningText: [185, 28, 28], // #b91c1c
    dividerColor: [226, 232, 240], // #e2e8f0
    headerRuleColor: [15, 23, 42],
    sectionFill: [248, 250, 252], // #f8fafc
    cardBorder: [226, 232, 240],
  },
  emerald: {
    style: 'emerald',
    displayName: 'Emerald',
    isDark: false,
    pageBg: [255, 255, 255],
    primaryText: [15, 23, 42], // #0f172a
    secondaryText: [100, 116, 139], // #64748b
    headingText: [6, 95, 70], // #065f46 deep emerald
    accentText: [4, 120, 87], // #047857 emerald
    warningText: [185, 28, 28], // #b91c1c
    dividerColor: [209, 250, 229], // #d1fae5
    headerRuleColor: [6, 95, 70],
    sectionFill: [236, 253, 245], // #ecfdf5 soft emerald tint
    cardBorder: [167, 243, 208], // #a7f3d0
  },
  dark: {
    style: 'dark',
    displayName: 'Dark Trading Desk',
    isDark: true,
    pageBg: [15, 23, 42], // #0f172a charcoal
    primaryText: [248, 250, 252], // #f8fafc
    secondaryText: [148, 163, 184], // #94a3b8
    headingText: [56, 189, 248], // #38bdf8 cyan
    accentText: [52, 211, 153], // #34d399 emerald
    warningText: [248, 113, 113], // #f87171 coral
    dividerColor: [51, 65, 85], // #334155
    headerRuleColor: [56, 189, 248],
    sectionFill: [30, 41, 59], // #1e293b dark card fill
    cardBorder: [51, 65, 85],
  },
};

const TIMEFRAME_DISPLAY_NAMES: Record<TimeframeId, string> = {
  Monthly: 'MONTHLY',
  Weekly: 'WEEKLY',
  Daily: 'DAILY',
  '4H': '4-HOUR',
  '1H': '1-HOUR',
  '15M': '15-MINUTE',
  '5M': '5-MINUTE',
  '1M': '1-MINUTE',
};

/**
 * Pre-fetches and resolves all chart images attached to the report.
 * Checks imagesMap, IndexedDB, and Supabase cloud signed URLs.
 */
export async function resolveAllReportImages(
  report: SavedReport,
  userId?: string | null,
  initialMap: Record<string, string> = {}
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = { ...initialMap };

  // 1. Timeframe charts
  for (const tf of TIMEFRAME_ORDER) {
    const tfData = report.timeframes[tf];
    if (tfData?.chartImageId) {
      const imgId = tfData.chartImageId;
      if (!resolved[imgId] && !resolved[tf]) {
        try {
          const url = await getChartImageUrl(userId || null, imgId);
          if (url) {
            resolved[imgId] = url;
            resolved[tf] = url;
          } else {
            const local = await getImage(imgId);
            if (local) {
              resolved[imgId] = local;
              resolved[tf] = local;
            }
          }
        } catch {
          // Handled honestly during render
        }
      } else if (resolved[tf] && !resolved[imgId]) {
        resolved[imgId] = resolved[tf];
      }
    }
  }

  // 2. Scenario images
  if (report.scenarios) {
    for (const sc of report.scenarios) {
      const scImages = sc.images;
      if (scImages && scImages.length > 0) {
        for (const img of scImages) {
          if (img.dataUrl && img.id && !resolved[img.id]) {
            resolved[img.id] = img.dataUrl;
          }
        }
      }
    }
  }

  // 3. Trade images
  if (report.trades) {
    for (const trd of report.trades) {
      const trdImages = trd.images;
      if (trdImages && trdImages.length > 0) {
        for (const img of trdImages) {
          if (img.dataUrl && img.id && !resolved[img.id]) {
            resolved[img.id] = img.dataUrl;
          }
        }
      }
    }
  }

  return resolved;
}

/**
 * Calculates natural dimensions of an image in mm preserving aspect ratio.
 */
function getImageDimensions(
  src: string,
  maxW: number,
  maxH: number
): Promise<{ width: number; height: number; error: boolean }> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.Image) {
      resolve({ width: maxW, height: maxH, error: false });
      return;
    }
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || 800;
      const naturalH = img.naturalHeight || 600;
      const aspect = naturalW / naturalH;

      let renderW = maxW;
      let renderH = renderW / aspect;

      if (renderH > maxH) {
        renderH = maxH;
        renderW = renderH * aspect;
      }

      resolve({ width: renderW, height: renderH, error: false });
    };
    img.onerror = () => {
      resolve({ width: maxW, height: maxH, error: true });
    };
    img.src = src;
  });
}

/**
 * Generates an A4 portrait PDF Blob with selectable text and presentation theme.
 * Defaults to 'minimal' (Minimal Journal). Content is 100% identical across all three styles.
 */
export async function generateReportPdfBlob({
  report,
  imagesMap = {},
  presentationConfig,
  style = 'minimal',
  userId,
}: ExportPdfOptions): Promise<{ blob: Blob; filename: string; doc: jsPDF; style: PdfExportStyle }> {
  const theme = PDF_THEMES[style] || PDF_THEMES.minimal;

  // Fully resolve all available images from storage / cache
  const allImages = await resolveAllReportImages(report, userId, imagesMap);

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
  const usableBottom = pageHeight - marginY - 10; // Reserve room for page numbers

  const alignment = calculateOverallAlignment(report.timeframes);
  const matchingValues = findMatchingValues(report.timeframes);

  // Helper to paint page background for dark theme
  const applyPageBackground = () => {
    if (theme.isDark) {
      doc.setFillColor(...theme.pageBg);
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
    }
  };

  // Helper to start a fresh page
  const addNewPage = () => {
    doc.addPage();
    applyPageBackground();
  };

  // Apply background to first page
  applyPageBackground();

  // Helper to draw header
  const drawPageHeader = () => {
    let curY = marginY + 4;

    // Optional Report Title or standard document title
    if (report.title) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(...theme.primaryText);
      doc.text(report.title, marginX, curY);
      curY += 5.5;

      doc.setFontSize(10.5);
      doc.setTextColor(...theme.headingText);
      doc.text(`ABMAX | ${report.pair} ANALYSIS  •  ${theme.displayName.toUpperCase()}`, marginX, curY);
      curY += 5;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.setTextColor(...theme.headingText);
      doc.text(`ABMAX | ${report.pair} ANALYSIS`, marginX, curY);
      curY += 6;
    }

    // Metadata line 1
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...theme.primaryText);

    const timeStr = report.time
      ? `${report.time}${report.timezone ? ` (${report.timezone})` : ''}`
      : '';
    const metaParts = [
      `Date: ${report.date}`,
      `Session: ${report.session}`,
      timeStr ? `Time: ${timeStr}` : '',
      `Timing: ${report.analysisTiming || 'On time'}`,
      `Overall Alignment: ${alignment.label}`,
    ].filter(Boolean);

    doc.text(metaParts.join('   •   '), marginX, curY);
    curY += 4.5;

    // Provenance line
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.secondaryText);
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
    provParts.push(`Export Style: ${theme.displayName}`);

    doc.text(provParts.join('   ·   '), marginX, curY);
    curY += 3.5;

    // Separator rule
    doc.setDrawColor(...theme.headerRuleColor);
    doc.setLineWidth(theme.style === 'minimal' ? 0.3 : 0.4);
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
    const hasPriceLoc = Boolean(d.priceLocation?.location || d.priceLocation?.levelRange);
    const hasSwing = Boolean(d.swing.direction || d.swing.high || d.swing.low || d.swing.bosAt);
    const hasInternal = Boolean(
      d.internal.direction || d.internal.high || d.internal.low || d.internal.ibosAt
    );
    const hasFractal = Boolean(d.fractal.direction || d.fractal.fractalBosAt);
    const hasStructuredLevels = Boolean(
      (d.supplyLevels && d.supplyLevels.length > 0) ||
      (d.demandLevels && d.demandLevels.length > 0) ||
      (d.supportLevels && d.supportLevels.length > 0) ||
      (d.resistanceLevels && d.resistanceLevels.length > 0) ||
      (d.liquidityLevels && d.liquidityLevels.length > 0)
    );
    const hasNote = Boolean(d.note && d.note.trim());
    const hasChart = Boolean(d.chartImageId);
    const hasSD = (report.supplyDemandLevels || []).some((sd) => sd.timeframe === tf);
    return (
      hasBias ||
      hasPriceLoc ||
      hasSwing ||
      hasInternal ||
      hasFractal ||
      hasStructuredLevels ||
      hasNote ||
      hasChart ||
      hasSD
    );
  };

  // Helper to compile timeframe content lines (identical across all styles)
  const getTimeframeLines = (
    tf: TimeframeId
  ): Array<{ type: 'heading' | 'body' | 'rule'; text: string }> => {
    const items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
    const d = report.timeframes[tf];
    const tfLabel = TIMEFRAME_DISPLAY_NAMES[tf] || tf.toUpperCase();
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

    // 2. Price Location
    if (d.priceLocation?.location || d.priceLocation?.levelRange) {
      const loc = d.priceLocation.location || '—';
      const range = d.priceLocation.levelRange ? ` (${d.priceLocation.levelRange})` : '';
      items.push({
        type: 'body',
        text: `Price Location: ${loc}${range}`,
      });
    }

    // Previous-Period Levels
    if (tf === 'Monthly' && (d.pmh || d.pml)) {
      const parts: string[] = [];
      if (d.pmh) parts.push(`PMH ${d.pmh}`);
      if (d.pml) parts.push(`PML ${d.pml}`);
      items.push({
        type: 'body',
        text: `Previous Month: ${parts.join(' | ')}`,
      });
    } else if (tf === 'Weekly' && (d.pwh || d.pwl)) {
      const parts: string[] = [];
      if (d.pwh) parts.push(`PWH ${d.pwh}`);
      if (d.pwl) parts.push(`PWL ${d.pwl}`);
      items.push({
        type: 'body',
        text: `Previous Week: ${parts.join(' | ')}`,
      });
    } else if (tf === 'Daily' && (d.pdh || d.pdl)) {
      const parts: string[] = [];
      if (d.pdh) parts.push(`PDH ${d.pdh}`);
      if (d.pdl) parts.push(`PDL ${d.pdl}`);
      items.push({
        type: 'body',
        text: `Previous Day: ${parts.join(' | ')}`,
      });
    }

    // 3. Swing
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

    // 4. Internal
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

    // 5. Fractal
    const fractalHasContent = Boolean(d.fractal.direction || d.fractal.fractalBosAt);
    if (fractalHasContent) {
      const fDir = d.fractal.direction || '—';
      const fBos = d.fractal.fractalBosAt ? d.fractal.fractalBosAt : '—';
      items.push({
        type: 'body',
        text: `Fractal: ${fDir} | BOS ${fBos}`,
      });
    }

    // 6. Deep alignment
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

    // 7. Structured Deep Levels
    if (d.supplyLevels && d.supplyLevels.length > 0) {
      const str = d.supplyLevels.map((l) => `${l.level}${l.note ? ` (${l.note})` : ''}`).join(', ');
      items.push({ type: 'body', text: `Supply Levels: ${str}` });
    }
    if (d.demandLevels && d.demandLevels.length > 0) {
      const str = d.demandLevels.map((l) => `${l.level}${l.note ? ` (${l.note})` : ''}`).join(', ');
      items.push({ type: 'body', text: `Demand Levels: ${str}` });
    }
    if (d.supportLevels && d.supportLevels.length > 0) {
      const str = d.supportLevels.map((l) => `${l.level}${l.note ? ` (${l.note})` : ''}`).join(', ');
      items.push({ type: 'body', text: `Support Levels: ${str}` });
    }
    if (d.resistanceLevels && d.resistanceLevels.length > 0) {
      const str = d.resistanceLevels.map((l) => `${l.level}${l.note ? ` (${l.note})` : ''}`).join(', ');
      items.push({ type: 'body', text: `Resistance Levels: ${str}` });
    }
    if (d.liquidityLevels && d.liquidityLevels.length > 0) {
      const str = d.liquidityLevels.map((l) => `${l.level}${l.note ? ` (${l.note})` : ''}`).join(', ');
      items.push({ type: 'body', text: `Liquidity Levels: ${str}` });
    }

    // 8. Supply / Demand (General)
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

    // 9. Note
    if (d.note && d.note.trim()) {
      items.push({
        type: 'body',
        text: `Note: ${d.note.trim()}`,
      });
    }

    // 10. Attached Chart reference
    if (d.chartImageId) {
      items.push({
        type: 'body',
        text: 'Chart Screenshot: Attached (see Attached Charts section)',
      });
    }

    items.push({ type: 'rule', text: '' });
    return items;
  };

  // Compile Column 1: External Liquidity, Watchlist, Monthly, Weekly, Daily
  const col1Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col1Items.push({ type: 'heading', text: 'EXTERNAL LIQUIDITY' });
  const liq = report.crossedLiquidity || [];
  if (liq.length > 0) {
    col1Items.push({ type: 'body', text: liq.join(', ') });
  } else {
    col1Items.push({ type: 'body', text: 'None recorded' });
  }
  col1Items.push({ type: 'rule', text: '' });

  if (report.majorLiquidityWatchlist && report.majorLiquidityWatchlist.trim()) {
    col1Items.push({ type: 'heading', text: 'MAJOR LIQUIDITY WATCHLIST' });
    col1Items.push({ type: 'body', text: report.majorLiquidityWatchlist.trim() });
    col1Items.push({ type: 'rule', text: '' });
  }

  col1Items.push(...getTimeframeLines('Monthly'));
  col1Items.push(...getTimeframeLines('Weekly'));
  col1Items.push(...getTimeframeLines('Daily'));

  // Compile Column 2: 4-Hour, 1-Hour, 15-Minute
  const col2Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col2Items.push(...getTimeframeLines('4H'));
  col2Items.push(...getTimeframeLines('1H'));
  col2Items.push(...getTimeframeLines('15M'));

  // Compile Column 3: 5-Minute, 1-Minute, Opening Candle Levels, Overall Notes
  const col3Items: Array<{ type: 'heading' | 'body' | 'rule'; text: string }> = [];
  col3Items.push(...getTimeframeLines('5M'));
  col3Items.push(...getTimeframeLines('1M'));

  if (report.openingCandles && report.openingCandles.length > 0) {
    col3Items.push({ type: 'heading', text: 'OPENING CANDLE LEVELS' });
    const ocSummary = report.openingCandles
      .map((oc) => `${oc.session}: ${oc.level || '—'}`)
      .join('  |  ');
    col3Items.push({ type: 'body', text: ocSummary });
    col3Items.push({ type: 'rule', text: '' });
  }

  col3Items.push({ type: 'heading', text: 'OVERALL NOTES' });
  if (report.overallNotes && report.overallNotes.trim()) {
    col3Items.push({ type: 'body', text: report.overallNotes.trim() });
  } else {
    col3Items.push({ type: 'body', text: 'None recorded' });
  }
  col3Items.push({ type: 'rule', text: '' });

  // Render a column's items within bounds with themed fonts and colors
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
        doc.setTextColor(...theme.headingText);
        const lines = doc.splitTextToSize(item.text, colWidth);
        doc.text(lines, x, y);
        y += lines.length * 3.6 + 1.2;
      } else if (item.type === 'body') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...theme.primaryText);
        const lines = doc.splitTextToSize(item.text, colWidth);
        doc.text(lines, x, y);
        y += lines.length * 3.1 + 1.2;
      } else if (item.type === 'rule') {
        doc.setDrawColor(...theme.dividerColor);
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
  doc.setDrawColor(...theme.dividerColor);
  doc.setLineWidth(0.2);
  const separatorTop = bodyStartY - 2;
  const separatorBottom = Math.min(maxColumnY, usableBottom - 25);
  doc.line(colX[1] - gutter / 2, separatorTop, colX[1] - gutter / 2, separatorBottom);
  doc.line(colX[2] - gutter / 2, separatorTop, colX[2] - gutter / 2, separatorBottom);

  // Full-width ending: Matching Values and Footer
  let endingY = maxColumnY + 4;
  if (endingY > usableBottom - 25) {
    addNewPage();
    endingY = marginY + 6;
  }

  // Full-width separator
  doc.setDrawColor(...theme.dividerColor);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  // Matching Values section
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...theme.headingText);
  doc.text('MATCHING VALUES', marginX, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...theme.primaryText);

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
    if (endingY + neededHeight > usableBottom) {
      addNewPage();
      endingY = marginY + 6;
    }
  };

  // PLANNED SCENARIOS SECTION
  ensureSpace(16);
  doc.setDrawColor(...theme.dividerColor);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...theme.headingText);
  const scnCount = report.scenarios?.length || 0;
  doc.text(`PLANNED SCENARIOS (${scnCount})`, marginX, endingY);
  endingY += 4.5;

  if (report.scenarios && report.scenarios.length > 0) {
    for (const sc of report.scenarios) {
      ensureSpace(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...theme.primaryText);
      const imgCountText = sc.images && sc.images.length > 0 ? ` [${sc.images.length} chart(s)]` : '';
      const scHeader = `${sc.label || 'Scenario'}${sc.direction ? ` [${sc.direction.toUpperCase()}]` : ''}${
        sc.strategy ? ` — ${sc.strategy}` : ''
      }${imgCountText}`;
      doc.text(scHeader, marginX, endingY);
      endingY += 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.primaryText);

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
        doc.setTextColor(...theme.warningText);
        const invLines = doc.splitTextToSize(
          `Invalidation: ${sc.invalidationConditions}`,
          usableWidth
        );
        ensureSpace(invLines.length * 3.2);
        doc.text(invLines, marginX, endingY);
        endingY += invLines.length * 3.2 + 2;
        doc.setTextColor(...theme.primaryText);
      } else {
        endingY += 1;
      }
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.secondaryText);
    doc.text('No scenarios recorded.', marginX, endingY);
    endingY += 4.5;
  }

  // TRADES TAKEN SECTION
  ensureSpace(16);
  doc.setDrawColor(...theme.dividerColor);
  doc.setLineWidth(0.3);
  doc.line(marginX, endingY, marginX + usableWidth, endingY);
  endingY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...theme.headingText);
  const tradeCount = report.trades?.length || 0;
  doc.text(`TRADES TAKEN (${tradeCount})`, marginX, endingY);
  endingY += 4.5;

  if (report.trades && report.trades.length > 0) {
    for (const trd of report.trades) {
      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...theme.primaryText);
      const outcomeText = trd.outcome ? ` | Outcome: ${trd.outcome}` : '';
      const rulesText = trd.rulesFollowed !== false ? ' [Rules Followed]' : ' [Rules Broken]';
      const imgText = trd.images && trd.images.length > 0 ? ` [${trd.images.length} screenshot(s)]` : '';
      const trdHeader = `• ${trd.direction || 'Trade'} — ${trd.scenarioLabel || 'Execution'}${outcomeText}${rulesText}${imgText}`;
      doc.text(trdHeader, marginX, endingY);
      endingY += 3.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.primaryText);

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
        doc.setTextColor(...theme.secondaryText);
        doc.text(noteLines, marginX + 3, endingY);
        endingY += noteLines.length * 3.2 + 2;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...theme.primaryText);
      } else {
        endingY += 1.5;
      }
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...theme.secondaryText);
    doc.text('No trades recorded.', marginX, endingY);
    endingY += 4.5;
  }

  // =========================================================================
  // ATTACHED CHARTS & SCREENSHOTS SECTION (Compact Thumbnail Grid)
  // Preserves aspect ratio, maximum dimensions, honest error handling, zooming
  // =========================================================================
  const includeTfCharts = presentationConfig?.pdfImages?.includeTimeframeCharts !== false;
  const includeScenarioImages = presentationConfig?.pdfImages?.includeScenarioImages !== false;
  const includeTradeImages = presentationConfig?.pdfImages?.includeTradeImages !== false;

  interface AttachedChartItem {
    id: string;
    label: string;
    sublabel: string;
    caption?: string;
    imgUrl?: string;
  }

  const allAttachedCharts: AttachedChartItem[] = [];

  if (includeTfCharts) {
    for (const tf of TIMEFRAME_ORDER) {
      const imgId = report.timeframes[tf]?.chartImageId;
      if (imgId) {
        allAttachedCharts.push({
          id: imgId,
          label: `${TIMEFRAME_DISPLAY_NAMES[tf]} TIMEFRAME`,
          sublabel: `Analysis Chart (${report.pair})`,
          imgUrl: allImages[imgId] || allImages[tf],
        });
      }
    }
  }

  if (includeScenarioImages && report.scenarios) {
    for (const sc of report.scenarios) {
      const scImages = sc.images;
      if (scImages && scImages.length > 0) {
        scImages.forEach((img, idx) => {
          allAttachedCharts.push({
            id: img.id,
            label: `SCENARIO: ${sc.label || 'Plan'} (Chart ${idx + 1}/${scImages.length})`,
            sublabel: `${sc.direction || 'Setup'} • ${sc.strategy || 'Strategy'}`,
            caption: img.caption,
            imgUrl: img.dataUrl || allImages[img.id],
          });
        });
      }
    }
  }

  if (includeTradeImages && report.trades) {
    for (const trd of report.trades) {
      const trdImages = trd.images;
      if (trdImages && trdImages.length > 0) {
        trdImages.forEach((img, idx) => {
          allAttachedCharts.push({
            id: img.id,
            label: `TRADE: ${trd.direction || 'Trade'} (Screenshot ${idx + 1}/${trdImages.length})`,
            sublabel: `${trd.scenarioLabel || 'Execution'} • Outcome: ${trd.outcome || 'N/A'}`,
            caption: img.caption,
            imgUrl: img.dataUrl || allImages[img.id],
          });
        });
      }
    }
  }

  if (allAttachedCharts.length > 0) {
    ensureSpace(24);
    doc.setDrawColor(...theme.dividerColor);
    doc.setLineWidth(0.3);
    doc.line(marginX, endingY, marginX + usableWidth, endingY);
    endingY += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...theme.headingText);
    doc.text(`ATTACHED CHARTS & SCREENSHOTS (${allAttachedCharts.length})`, marginX, endingY);
    endingY += 5;

    // Render compact 2-column thumbnail cards
    const thumbGutter = 5;
    const thumbCardWidth = (usableWidth - thumbGutter) / 2; // ~91.5 mm
    const maxImgW = thumbCardWidth - 6; // ~85.5 mm
    const maxImgH = 50; // max 50mm height to avoid tall screenshots consuming a full page
    const cardPaddingTop = 8;
    const cardPaddingBottom = 6;

    for (let i = 0; i < allAttachedCharts.length; i += 2) {
      const item1 = allAttachedCharts[i];
      const item2 = allAttachedCharts[i + 1] as AttachedChartItem | undefined;

      // Measure dimensions for item1
      let dims1 = { width: maxImgW, height: 45, error: false };
      if (item1.imgUrl) {
        dims1 = await getImageDimensions(item1.imgUrl, maxImgW, maxImgH);
      } else {
        dims1.error = true;
      }

      // Measure dimensions for item2 if present
      let dims2 = { width: maxImgW, height: 45, error: false };
      if (item2?.imgUrl) {
        dims2 = await getImageDimensions(item2.imgUrl, maxImgW, maxImgH);
      } else if (item2) {
        dims2.error = true;
      }

      const rowH = Math.max(dims1.height, item2 ? dims2.height : 0) + cardPaddingTop + cardPaddingBottom + (item1.caption || item2?.caption ? 5 : 0);

      // Check page break
      ensureSpace(rowH + 4);

      // Render Item 1 Card
      const card1X = marginX;
      const card1Y = endingY;

      // Card background and border
      doc.setFillColor(...theme.sectionFill);
      doc.setDrawColor(...theme.cardBorder);
      doc.setLineWidth(0.2);
      doc.roundedRect(card1X, card1Y, thumbCardWidth, rowH, 1.5, 1.5, 'FD');

      // Card Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...theme.headingText);
      doc.text(item1.label, card1X + 3, card1Y + 4);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...theme.secondaryText);
      doc.text(item1.sublabel, card1X + 3, card1Y + 7);

      // Image or Honest Error Message
      if (item1.imgUrl && !dims1.error) {
        try {
          const imgX = card1X + 3 + (maxImgW - dims1.width) / 2;
          const imgY = card1Y + cardPaddingTop;
          doc.addImage(
            item1.imgUrl,
            'JPEG',
            imgX,
            imgY,
            dims1.width,
            dims1.height,
            undefined,
            'FAST'
          );
        } catch (err) {
          doc.setFontSize(7);
          doc.setTextColor(...theme.warningText);
          doc.text('[Chart image could not be embedded in PDF]', card1X + 4, card1Y + 22);
        }
      } else {
        doc.setFontSize(7);
        doc.setTextColor(...theme.warningText);
        doc.text('⚠️ Chart image could not be loaded from storage.', card1X + 4, card1Y + 20);
        doc.setFontSize(6);
        doc.setTextColor(...theme.secondaryText);
        doc.text('(Tap Retry in export dialog to reload)', card1X + 4, card1Y + 24);
      }

      if (item1.caption) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.setTextColor(...theme.secondaryText);
        const capLines = doc.splitTextToSize(`"${item1.caption}"`, maxImgW);
        doc.text(capLines, card1X + 3, card1Y + cardPaddingTop + dims1.height + 3.5);
      }

      // Render Item 2 Card (if present)
      if (item2) {
        const card2X = marginX + thumbCardWidth + thumbGutter;
        const card2Y = endingY;

        doc.setFillColor(...theme.sectionFill);
        doc.setDrawColor(...theme.cardBorder);
        doc.setLineWidth(0.2);
        doc.roundedRect(card2X, card2Y, thumbCardWidth, rowH, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...theme.headingText);
        doc.text(item2.label, card2X + 3, card2Y + 4);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...theme.secondaryText);
        doc.text(item2.sublabel, card2X + 3, card2Y + 7);

        if (item2.imgUrl && !dims2.error) {
          try {
            const imgX = card2X + 3 + (maxImgW - dims2.width) / 2;
            const imgY = card2Y + cardPaddingTop;
            doc.addImage(
              item2.imgUrl,
              'JPEG',
              imgX,
              imgY,
              dims2.width,
              dims2.height,
              undefined,
              'FAST'
            );
          } catch (err) {
            doc.setFontSize(7);
            doc.setTextColor(...theme.warningText);
            doc.text('[Chart image could not be embedded in PDF]', card2X + 4, card2Y + 22);
          }
        } else {
          doc.setFontSize(7);
          doc.setTextColor(...theme.warningText);
          doc.text('⚠️ Chart image could not be loaded from storage.', card2X + 4, card2Y + 20);
          doc.setFontSize(6);
          doc.setTextColor(...theme.secondaryText);
          doc.text('(Tap Retry in export dialog to reload)', card2X + 4, card2Y + 24);
        }

        if (item2.caption) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(6.5);
          doc.setTextColor(...theme.secondaryText);
          const capLines = doc.splitTextToSize(`"${item2.caption}"`, maxImgW);
          doc.text(capLines, card2X + 3, card2Y + cardPaddingTop + dims2.height + 3.5);
        }
      }

      endingY += rowH + 4;
    }
  }

  // =========================================================================
  // FINAL PASS: Page Numbering & Footer across all generated pages
  // =========================================================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const footerY = pageHeight - marginY + 2;

    doc.setDrawColor(...theme.dividerColor);
    doc.setLineWidth(0.2);
    doc.line(marginX, footerY - 3, marginX + usableWidth, footerY - 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...theme.secondaryText);
    doc.text(
      `ABMAX ANALYSIS  •  ${report.pair}  •  ${theme.displayName}`,
      marginX,
      footerY
    );

    const pageStr = `Page ${i} of ${totalPages}`;
    const pageStrWidth = doc.getTextWidth(pageStr);
    doc.text(pageStr, marginX + usableWidth - pageStrWidth, footerY);
  }

  // Sanitize filename: ABMAX_[PAIR]_[STYLE]_[DATE].pdf
  const sanitizedPair = (report.pair || 'UNKNOWN').replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedDate = (report.date || new Date().toISOString().slice(0, 10)).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const stylePart = theme.style && theme.style !== 'minimal' ? `_${theme.style}` : '';
  const filename = `ABMAX_${sanitizedPair}${stylePart}_${sanitizedDate}.pdf`;
  const pdfBlob = doc.output('blob');

  return { blob: pdfBlob, filename, doc, style: theme.style };
}

/**
 * Generates and triggers download of an A4 portrait PDF with selectable text
 * matching the chosen presentation style. Defaults to 'minimal' (Minimal Journal).
 */
export async function downloadReportPdf(options: ExportPdfOptions): Promise<void> {
  const { blob, filename } = await generateReportPdfBlob(options);
  await exportBlobOrDownload(blob, filename, 'application/pdf', 'ABMAX Analysis PDF');
}
