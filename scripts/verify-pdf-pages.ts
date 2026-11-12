import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';
import { generateReportPdfBlob, PdfExportStyle } from '../src/services/pdfExport';
import { generatePeriodPdfBlob } from '../src/services/periodExport';
import {
  createInitialAnalysisData,
  JournalEntry,
  RecordedTrade,
  SavedReport,
} from '../src/types/journal';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

/**
 * Creates a crisp synthetic chart PNG data URL with gridlines and candlesticks.
 */
function makeChartPngDataUrl(
  width: number,
  height: number,
  bg: [number, number, number],
  accent: [number, number, number]
): string {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter none
    const isGridY = y % 20 === 0;
    for (let x = 0; x < width; x++) {
      const idx = rowStart + 1 + x * 3;
      const isGridX = x % 24 === 0;
      const diagY = Math.round(height * 0.78 - (x / width) * height * 0.55);
      const isCandleBar = x % 14 >= 5 && x % 14 <= 9 && Math.abs(y - diagY) < 12;
      if (isCandleBar || Math.abs(y - diagY) <= 1) {
        raw[idx] = accent[0];
        raw[idx + 1] = accent[1];
        raw[idx + 2] = accent[2];
      } else if (isGridX || isGridY) {
        raw[idx] = Math.min(255, bg[0] + 22);
        raw[idx + 1] = Math.min(255, bg[1] + 22);
        raw[idx + 2] = Math.min(255, bg[2] + 22);
      } else {
        raw[idx] = bg[0];
        raw[idx + 1] = bg[1];
        raw[idx + 2] = bg[2];
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function run() {
  const outputDir = '/tmp/pdf_verification';
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const chartLandscapePng = makeChartPngDataUrl(240, 135, [22, 34, 52], [16, 185, 129]);
  const chartPortraitPng = makeChartPngDataUrl(140, 180, [30, 41, 59], [56, 189, 248]);
  const tradeExecPng = makeChartPngDataUrl(220, 125, [18, 28, 44], [245, 158, 11]);
  const journalChartPng = makeChartPngDataUrl(200, 120, [24, 38, 48], [52, 211, 153]);

  const baseData = createInitialAnalysisData('XAUUSD');
  baseData.title = 'XAUUSD Institutional Multi-Timeframe Deep Dive & Execution Blueprint';
  baseData.date = '2026-11-05';
  baseData.session = 'London';
  baseData.analysisTiming = 'On time';
  baseData.crossedLiquidity = ['PDH', 'Asian Low', 'Equal Highs'];
  baseData.majorLiquidityWatchlist = 'Primary magnet: 2762.50 PWH & 2714.00 Sell-side Liquidity';
  baseData.openingCandles = [
    { id: 'oc_1', session: 'Weekly', level: '2724.50' },
    { id: 'oc_2', session: 'London', level: '2731.20' },
  ];
  baseData.overallNotes =
    'SENTINEL_OVERALL_START Full institutional displacement observed following Asian Low sweep. Patience maintained until 15M MSS confirmation above 2733.50 with strict 1R risk ceiling and zero news interference. SENTINEL_OVERALL_END';

  // Populate rich multi-timeframe notes to guarantee multi-page column flow
  baseData.timeframes.Monthly.overallBias = 'Bullish';
  baseData.timeframes.Monthly.personalBiasNotes =
    'SENTINEL_MY_MONTHLY_BIAS Higher-timeframe monthly demand sweep remains intact with clear bullish displacement toward 2790.00.';
  baseData.timeframes.Monthly.pmh = '2790.00';
  baseData.timeframes.Monthly.pml = '2605.00';
  baseData.timeframes.Monthly.swing = { direction: 'Bullish', high: '2790.00', low: '2605.00', bosAt: '2680.00', history: [] };
  baseData.timeframes.Monthly.note =
    'SENTINEL_MONTHLY_START Monthly impulse remains constructive above premium equilibrium midpoint 2697.50. Wait for weekly pullback completion into institutional demand before aggressive continuation entries. SENTINEL_MONTHLY_END';
  baseData.timeframes.Monthly.chartImageId = 'img_tf_monthly';

  baseData.timeframes.Weekly.overallBias = 'Bullish';
  baseData.timeframes.Weekly.personalBiasNotes =
    'SENTINEL_MY_WEEKLY_BIAS Weekly liquidity draw favors upside continuation above 2762.50.';
  baseData.timeframes.Weekly.pwh = '2762.50';
  baseData.timeframes.Weekly.pwl = '2685.00';
  baseData.timeframes.Weekly.swing = { direction: 'Bullish', high: '2762.50', low: '2685.00', bosAt: '2715.00', history: [] };
  baseData.timeframes.Weekly.note =
    'SENTINEL_WEEKLY_NOTE Weekly structure broke cleanly higher after mitigating prior imbalance zone at 2692.00. SENTINEL_WEEKLY_END';

  baseData.timeframes.Daily.overallBias = 'Bullish';
  baseData.timeframes.Daily.personalBiasNotes =
    'SENTINEL_MY_DAILY_BIAS Wait strictly for London discount retrace into 2724 demand before scaling.';
  baseData.timeframes.Daily.pdh = '2748.50';
  baseData.timeframes.Daily.pdl = '2714.00';
  baseData.timeframes.Daily.swing = { direction: 'Bullish', high: '2752.00', low: '2714.00', bosAt: '2733.50', history: [] };
  baseData.timeframes.Daily.internal = { direction: 'Bullish', high: '2744.00', low: '2718.00', ibosAt: '2731.00', history: [] };
  baseData.timeframes.Daily.note =
    'SENTINEL_DAILY_TAIL_START Daily candles show clean wick rejections at 2718.00 demand followed by strong body displacement closes above previous day equilibrium, confirming institutional accumulation ahead of London session. Extended multi-session commentary confirms that Asian range lows were engineered as sell-side inducement prior to heavy London expansion, leaving clean fair value gaps along 2725.00-2729.00 and untouched buy-side stops above equal highs at 2758.00-2762.50 for institutional continuation. SENTINEL_DAILY_TAIL_END';

  baseData.timeframes['4H'].overallBias = 'Bullish';
  baseData.timeframes['4H'].note = 'SENTINEL_4H_NOTE 4H demand mitigation intact; bullish order flow preserved across consecutive sessions.';
  baseData.timeframes['4H'].chartImageId = 'img_tf_4h';

  baseData.timeframes['1H'].overallBias = 'Bullish';
  baseData.timeframes['1H'].note = 'SENTINEL_1H_NOTE 1H internal BOS confirmed at 2731.00 with clean unmitigated fair value gap resting below open.';

  baseData.timeframes['15M'].overallBias = 'Bullish';
  baseData.timeframes['15M'].note =
    'SENTINEL_15M_TAIL_START Clean market structure shift confirmed following Asian low sweep. Entry trigger aligned with 15M bullish breaker block and optimal trade entry retracement zone. SENTINEL_15M_TAIL_END';

  baseData.timeframes['5M'].overallBias = 'Bullish';
  baseData.timeframes['5M'].note = 'SENTINEL_5M_NOTE Precision 5M CHoCH + engulfing displacement triggered Limit Buy at 2722.50.';
  baseData.timeframes['1M'].overallBias = 'Waiting';
  baseData.timeframes['1M'].note = 'SENTINEL_1M_TAIL Wait for 1M liquidity sweep before adding secondary scale-in position.';

  baseData.scenarios = [
    {
      id: 'scn_long_1',
      label: 'Scenario 1',
      direction: 'Buy',
      strategyId: 'str_pdf_1',
      strategy: 'Asian Sweep + 15M MSS Institutional Continuation',
      strategySnapshot: {
        id: 'str_pdf_1',
        name: 'Asian Sweep + 15M MSS Institutional Continuation',
        description: 'Sweep Asian range low near 2721.40 followed by impulsive 15M closure.',
        entryRules: '15M close above 2726.00 + 5M retest of discount OB.',
        invalidationConditions: 'Full 15M close below 2718.00.',
        capturedAt: 1000,
      },
      description: 'Sweep Asian range low near 2721.40 followed by impulsive 15M closure above swing point and FVG mitigation.',
      entryConditions: '15M close above 2726.00 + 5M retest of discount OB without invalidating 2718.00 structural low.',
      invalidationConditions: 'Full 15M candle close below 2718.00 invalidates intraday bullish continuation.',
      images: [
        { id: 'img_scn_1', dataUrl: chartLandscapePng, caption: 'Scenario 1 H4/15M Mapping', createdAt: 1000 },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  const trades: RecordedTrade[] = [
    {
      id: 'trade_rep_01',
      pair: 'XAUUSD',
      direction: 'Buy',
      scenarioId: 'scn_long_1',
      scenarioLabel: 'Scenario 1',
      strategyId: 'str_pdf_1',
      strategy: 'Asian Sweep + 15M MSS Institutional Continuation',
      date: '2026-11-03',
      time: '08:15',
      session: 'London',
      timeframeTaken: '15M',
      entryPrice: '2722.50',
      stopLoss: '2718.00',
      takeProfit: '2745.00',
      exitPrice: '2745.00',
      riskReward: '5.0R',
      outcome: 'Win',
      rulesFollowed: true,
      notes: 'SENTINEL_TRADE_1 Textbook Asian low sweep with 5M MSS confirmation. Clean 5R expansion.',
      images: [
        { id: 'img_trd_1', dataUrl: tradeExecPng, caption: 'London 5R Execution Chart', createdAt: 1000 },
      ],
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'trade_rep_02',
      pair: 'XAUUSD',
      direction: 'Sell',
      scenarioLabel: 'Counter-trend Fade',
      date: '2026-11-04',
      time: '13:30',
      session: 'NY AM',
      timeframeTaken: '5M',
      entryPrice: '2752.00',
      stopLoss: '2756.00',
      takeProfit: '2736.00',
      exitPrice: '2756.00',
      riskReward: '4.0R',
      outcome: 'Loss',
      rulesFollowed: true,
      notes: 'Attempted counter-trend fade on NY news injection. Stopped out cleanly per risk plan.',
      createdAt: 2000,
      updatedAt: 2000,
    },
    {
      id: 'trade_rep_03',
      pair: 'EURUSD',
      direction: 'Sell',
      scenarioLabel: 'NY Distribution',
      date: '2026-11-06',
      time: '14:00',
      session: 'NY PM',
      timeframeTaken: '15M',
      entryPrice: '1.0850',
      stopLoss: '1.0875',
      takeProfit: '1.0775',
      exitPrice: '1.0775',
      riskReward: '3.0R',
      outcome: 'Win',
      rulesFollowed: false,
      notes: 'Chased entry slightly early before full candle closure. Documented for discipline improvement.',
      createdAt: 4000,
      updatedAt: 4000,
    },
  ];

  const longSingleReport: SavedReport = {
    ...baseData,
    status: 'Modified',
    trades,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now(),
  };

  const secondaryReport: SavedReport = {
    ...createInitialAnalysisData('EURUSD'),
    id: 'report_rep_02',
    date: '2026-11-06',
    pair: 'EURUSD',
    session: 'London',
    status: 'Original',
    title: 'EURUSD HTF Distribution & Liquidity Imbalance',
    overallNotes: 'SENTINEL_RPT2 EURUSD reached higher timeframe premium. Equal highs swept prior to London close.',
    trades: [],
    createdAt: Date.now() - 43200000,
    updatedAt: Date.now() - 43200000,
  };

  const journalEntries: JournalEntry[] = [
    {
      id: 'journal_rep_01',
      title: 'London Session Discipline Execution Review',
      date: '2026-11-03',
      time: '11:30',
      session: 'London',
      pair: 'XAUUSD',
      entryType: 'post-trade',
      prep: {
        sessionIntention: 'Focus exclusively on A+ setups with clear HTF alignment and liquidity draw.',
        readinessState: 'Optimal / Calm',
      },
      preTrade: {
        reasonForTrade: 'Asian range low sweep with 15M MSS and fair value gap mitigation.',
        setupTag: 'Liquidity Sweep + MSS',
      },
      inTrade: {
        managementDecisions: 'Held position through minor 5M pullback towards target.',
      },
      postTrade: {
        executionReview: 'Flawless execution adhering to all predefined rules.',
        rulesFollowedStatus: 'Followed',
      },
      reflection: {
        whatWorked: 'Disciplined patience and adhering strictly to risk parameters.',
        whatDidNot: 'Nothing negative observed during this session.',
        keyLessons: 'High probability setups provide the smoothest expansions.',
        nextSessionCommitment: 'Maintain identical discipline for the upcoming NY session.',
      },
      images: [
        { id: 'j_img_1', dataUrl: journalChartPng, caption: 'Post-Trade Journal Annotated Setup', createdAt: 1000 },
      ],
      generalNotes: 'SENTINEL_JOURNAL_1 Session concluded with +5R profit.',
      createdAt: Date.now() - 172800000,
      updatedAt: Date.now() - 172800000,
    },
    {
      id: 'my_journal_rep_01',
      title: 'Weekly Psychological Debrief & Performance Calibration',
      date: '2026-11-06',
      time: '16:45',
      session: 'NY PM',
      pair: 'XAUUSD',
      entryType: 'my-journal',
      myJournalContext: 'After Trading',
      emotionalState: 'Focused',
      tags: ['Mindset', 'Discipline', 'Weekly Calibrate'],
      notes:
        'SENTINEL_MYJOURNAL_NOTE Overall strong week. Win rate sits at 67% (2 wins, 1 loss). The single rule breach reinforces waiting cleanly for candle closure.',
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 86400000,
    },
  ];

  const singleImagesMap: Record<string, string> = {
    img_tf_monthly: chartLandscapePng,
    img_tf_4h: chartPortraitPng,
  };
  const expectedSingleImageCount = 4; // Monthly + 4H + 1 scenario + 1 trade

  const themes: PdfExportStyle[] = ['minimal', 'emerald', 'dark'];
  const singleSentinels = [
    'SENTINEL_MY_MONTHLY_BIAS',
    'SENTINEL_MY_WEEKLY_BIAS',
    'SENTINEL_MY_DAILY_BIAS',
    'Asian Sweep + 15M MSS Institutional Continuation',
    'SENTINEL_MONTHLY_END',
    'SENTINEL_DAILY_TAIL_END',
    'SENTINEL_15M_TAIL_END',
    'SENTINEL_1M_TAIL',
    'SENTINEL_OVERALL_END',
    'SENTINEL_TRADE_1',
    'ATTACHED CHARTS & SCREENSHOTS (4)',
  ];
  const periodSentinels = [
    'SENTINEL_MY_MONTHLY_BIAS',
    'SENTINEL_MY_WEEKLY_BIAS',
    'SENTINEL_MY_DAILY_BIAS',
    'Asian Sweep + 15M MSS Institutional Continuation',
    'SENTINEL_OVERALL_END',
    'SENTINEL_RPT2',
    'SENTINEL_TRADE_1',
    'SENTINEL_JOURNAL_1',
    'SENTINEL_MYJOURNAL_NOTE',
    'ATTACHED CHARTS & SCREENSHOTS (5)',
  ];

  const summaryResults: Array<Record<string, unknown>> = [];

  for (const style of themes) {
    // 1. Single Long Analysis Report PDF
    const singleRes = await generateReportPdfBlob({
      report: longSingleReport,
      imagesMap: singleImagesMap,
      style,
    });
    const singlePdfPath = path.join(outputDir, `single_${style}.pdf`);
    fs.writeFileSync(singlePdfPath, Buffer.from(await singleRes.blob.arrayBuffer()));
    execSync(`pdftoppm -png -r 150 ${singlePdfPath} ${path.join(outputDir, `single_${style}_page`)}`);

    const singleTxt = execSync(`pdftotext ${singlePdfPath} -`).toString('utf8');
    const singleMissing = singleSentinels.filter((s) => !singleTxt.includes(s));
    const singleImgRows = execSync(`pdfimages -list ${singlePdfPath}`).toString('utf8')
      .trim()
      .split('\n')
      .filter((line) => /^\s*\d+\s+\d+\s+image/.test(line));
    const singlePages = fs.readdirSync(outputDir).filter((f) => f.startsWith(`single_${style}_page-`)).length;

    summaryResults.push({
      kind: 'single',
      style,
      pdfPath: singlePdfPath,
      pages: singlePages,
      textLength: singleTxt.length,
      missingSentinels: singleMissing,
      embeddedImages: singleImgRows.length,
      expectedImages: expectedSingleImageCount,
    });

    if (singleMissing.length > 0) {
      throw new Error(`Single PDF (${style}) missing text sentinels: ${singleMissing.join(', ')}`);
    }
    if (singleImgRows.length !== expectedSingleImageCount) {
      throw new Error(`Single PDF (${style}) image count mismatch: got ${singleImgRows.length}, expected ${expectedSingleImageCount}`);
    }

    // 2. Period Detail PDF with includeImages: true
    const periodRes = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: true,
      includePerformance: true,
      includeImages: true,
      style,
      reports: [longSingleReport, secondaryReport],
      journalEntries,
      imagesMap: singleImagesMap,
    });
    const periodPdfPath = path.join(outputDir, `period_${style}.pdf`);
    fs.writeFileSync(periodPdfPath, Buffer.from(await periodRes.blob.arrayBuffer()));
    execSync(`pdftoppm -png -r 150 ${periodPdfPath} ${path.join(outputDir, `period_${style}_page`)}`);

    const periodTxt = execSync(`pdftotext ${periodPdfPath} -`).toString('utf8');
    const periodMissing = periodSentinels.filter((s) => !periodTxt.includes(s));
    const periodImgRows = execSync(`pdfimages -list ${periodPdfPath}`).toString('utf8')
      .trim()
      .split('\n')
      .filter((line) => /^\s*\d+\s+\d+\s+image/.test(line));
    const periodPages = fs.readdirSync(outputDir).filter((f) => f.startsWith(`period_${style}_page-`)).length;
    const expectedPeriodImages = 5; // 2 TF charts + 1 scenario + 1 trade + 1 journal

    summaryResults.push({
      kind: 'period',
      style,
      pdfPath: periodPdfPath,
      pages: periodPages,
      textLength: periodTxt.length,
      missingSentinels: periodMissing,
      embeddedImages: periodImgRows.length,
      expectedImages: expectedPeriodImages,
    });

    if (periodMissing.length > 0) {
      throw new Error(`Period PDF (${style}) missing text sentinels: ${periodMissing.join(', ')}`);
    }
    if (periodImgRows.length !== expectedPeriodImages) {
      throw new Error(`Period PDF (${style}) image count mismatch: got ${periodImgRows.length}, expected ${expectedPeriodImages}`);
    }
  }

  console.log(JSON.stringify(summaryResults, null, 2));
}

run().catch((err) => {
  console.error('PDF verification failed:', err);
  process.exit(1);
});

