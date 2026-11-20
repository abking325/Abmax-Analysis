import {
  AnalysisData,
  OverallBias,
  PlannedRRChoice,
  RecordedTrade,
  SavedReport,
  SetupValidity,
  TIMEFRAME_ORDER,
  TimeframeData,
  TimeframeId,
  MajorLiquidityItem,
  OpeningCandleEntry,
  normalizeStructureDirectionAndConfirmation,
} from '../types/journal';

export interface AlignmentResult {
  status: 'ALIGNED' | 'WAITING' | 'MIXED';
  label: string;
  bias: 'Bullish' | 'Bearish' | null;
  detail: string;
  isComplete: boolean;
}

/**
 * Calculates overall alignment across enabled timeframes (defaulting to present timeframes or all 8).
 * Show ALIGNED only when all enabled overall bias selections are complete and identical (all Bullish or all Bearish).
 * Otherwise show Waiting / Mixed.
 */
export function calculateOverallAlignment(
  timeframes: Record<TimeframeId, TimeframeData>,
  enabledTimeframes?: TimeframeId[]
): AlignmentResult {
  if (!timeframes) {
    return {
      status: 'WAITING',
      label: 'Waiting / Incomplete',
      bias: null,
      detail: '0 of 8 timeframes selected',
      isComplete: false,
    };
  }

  const activeTfs = (enabledTimeframes && enabledTimeframes.length > 0)
    ? enabledTimeframes
    : TIMEFRAME_ORDER.filter((tf) => Boolean(timeframes[tf]));

  const total = activeTfs.length;
  if (total === 0) {
    return {
      status: 'WAITING',
      label: 'No timeframes selected',
      bias: null,
      detail: 'No timeframes are enabled in this analysis',
      isComplete: false,
    };
  }

  const answeredTfs = activeTfs.filter((tf) => Boolean(timeframes[tf]?.overallBias));
  const answeredCount = answeredTfs.length;

  if (answeredCount < total) {
    return {
      status: 'WAITING',
      label: 'Waiting / Incomplete',
      bias: null,
      detail: `${answeredCount} of ${total} timeframes selected`,
      isComplete: false,
    };
  }

  // All enabled timeframes are answered
  const biases = activeTfs.map((tf) => timeframes[tf]?.overallBias);
  const firstBias = biases[0];

  if (
    (firstBias === 'Bullish' || firstBias === 'Bearish') &&
    biases.every((b) => b === firstBias)
  ) {
    return {
      status: 'ALIGNED',
      label: `ALIGNED (${firstBias.toUpperCase()})`,
      bias: firstBias,
      detail: `All ${total} timeframes confirm ${firstBias.toLowerCase()} bias`,
      isComplete: true,
    };
  }

  return {
    status: 'MIXED',
    label: 'Mixed / Divergent',
    bias: null,
    detail: 'Biases conflict across timeframes',
    isComplete: true,
  };
}

/**
 * Bias summary for reports archive cards:
 * - Incomplete when any timeframe selection is missing.
 * - The common bias when all seven match.
 * - Mixed when complete selections disagree.
 */
export function getReportBiasSummary(report: SavedReport): {
  summary: string;
  badgeClass: string;
} {
  const alignment = calculateOverallAlignment(report.timeframes);
  if (!alignment.isComplete) {
    return {
      summary: 'Incomplete',
      badgeClass: 'text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400',
    };
  }
  if (alignment.status === 'ALIGNED' && alignment.bias) {
    return {
      summary: alignment.bias,
      badgeClass:
        alignment.bias === 'Bullish'
          ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400'
          : 'text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400',
    };
  }
  return {
    summary: 'Mixed',
    badgeClass: 'text-slate-700 bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
  };
}

/**
 * Checks if deep analysis in a timeframe is aligned:
 * Swing, Internal, and Fractal are complete, not Waiting confirmation, and all Bullish or all Bearish.
 */
export function isDeepAnalysisAligned(tfData: TimeframeData): boolean {
  const swing = normalizeStructureDirectionAndConfirmation(
    tfData.swing?.direction,
    tfData.swing?.confirmation
  );
  const internal = normalizeStructureDirectionAndConfirmation(
    tfData.internal?.direction,
    tfData.internal?.confirmation
  );
  const fractal = normalizeStructureDirectionAndConfirmation(
    tfData.fractal?.direction,
    tfData.fractal?.confirmation
  );

  if (!swing.direction || !internal.direction || !fractal.direction) return false;
  if (swing.direction === 'Neutral' || internal.direction === 'Neutral' || fractal.direction === 'Neutral') {
    return false;
  }
  if (
    swing.confirmation === 'Waiting' ||
    internal.confirmation === 'Waiting' ||
    fractal.confirmation === 'Waiting'
  ) {
    return false;
  }

  return (
    (swing.direction === 'Bullish' && internal.direction === 'Bullish' && fractal.direction === 'Bullish') ||
    (swing.direction === 'Bearish' && internal.direction === 'Bearish' && fractal.direction === 'Bearish')
  );
}

/**
 * Normalizes price string for exact comparison (e.g. "2670" and "2670.00" become "2670").
 * Strips whitespace, commas, trailing zeros after decimal, trailing decimal points.
 */
export function normalizePrice(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/,/g, '');
  if (!cleaned) return null;

  // Validate numeric format (positive integer or decimal)
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  // To avoid floating-point inaccuracies, handle string-level normalization
  const parts = cleaned.split('.');
  const intPart = parts[0].replace(/^0+(?=\d)/, ''); // Remove leading zeros unless "0"
  if (parts.length === 1) {
    return intPart;
  }

  let decPart = parts[1].replace(/0+$/, ''); // Remove trailing zeros
  if (decPart.length === 0) {
    return intPart;
  }
  return `${intPart}.${decPart}`;
}

export interface MatchingPriceGroup {
  normalizedPrice: string;
  displayPrice: string;
  occurrences: Array<{
    timeframe: TimeframeId;
    field: string;
    originalInput: string;
  }>;
}

/**
 * Compares valid prices from:
 * Swing High, Swing Low, Swing BOS, Internal High, Internal Low, Internal iBOS, Fractal BOS.
 * Groups equal values and lists timeframe/field locations.
 */
export function findMatchingValues(
  timeframes: Record<TimeframeId, TimeframeData>,
  additionalSources?: {
    supplyDemandLevels?: Array<{ timeframe: TimeframeId; supply?: string; demand?: string }>;
    openingCandles?: Array<{ session: string; level: string }>;
  }
): MatchingPriceGroup[] {
  const map = new Map<
    string,
    {
      displayPrice: string;
      occurrences: Array<{
        timeframe: TimeframeId;
        field: string;
        originalInput: string;
      }>;
    }
  >();

  for (const tf of TIMEFRAME_ORDER) {
    const data = timeframes[tf];
    if (!data) continue;

    const fieldsToCheck: Array<{ field: string; val?: string }> = [
      { field: 'Swing High', val: data.swing?.high },
      { field: 'Swing Low', val: data.swing?.low },
      { field: 'Swing BOS', val: data.swing?.bosAt },
      { field: 'Internal High', val: data.internal?.high },
      { field: 'Internal Low', val: data.internal?.low },
      { field: 'Internal iBOS', val: data.internal?.ibosAt },
      { field: 'Fractal BOS', val: data.fractal?.fractalBosAt },
      { field: 'PMH', val: data.pmh },
      { field: 'PML', val: data.pml },
      { field: 'PWH', val: data.pwh },
      { field: 'PWL', val: data.pwl },
      { field: 'PDH', val: data.pdh },
      { field: 'PDL', val: data.pdl },
    ];

    // Deep structured levels (support, resistance, supply, demand)
    if (data.supportLevels && Array.isArray(data.supportLevels)) {
      data.supportLevels.forEach((item, idx) => {
        fieldsToCheck.push({ field: `Support ${idx + 1}`, val: item.level });
      });
    }
    if (data.resistanceLevels && Array.isArray(data.resistanceLevels)) {
      data.resistanceLevels.forEach((item, idx) => {
        fieldsToCheck.push({ field: `Resistance ${idx + 1}`, val: item.level });
      });
    }
    if (data.supplyLevels && Array.isArray(data.supplyLevels)) {
      data.supplyLevels.forEach((item, idx) => {
        fieldsToCheck.push({ field: `Supply ${idx + 1}`, val: item.level });
      });
    }
    if (data.demandLevels && Array.isArray(data.demandLevels)) {
      data.demandLevels.forEach((item, idx) => {
        fieldsToCheck.push({ field: `Demand ${idx + 1}`, val: item.level });
      });
    }

    for (const item of fieldsToCheck) {
      if (!item.val) continue;
      const norm = normalizePrice(item.val);
      if (!norm) continue;

      if (!map.has(norm)) {
        map.set(norm, {
          displayPrice: item.val.trim(),
          occurrences: [],
        });
      }
      map.get(norm)!.occurrences.push({
        timeframe: tf,
        field: item.field,
        originalInput: item.val.trim(),
      });
    }
  }

  // Check additional workspace supply & demand levels if provided
  if (additionalSources?.supplyDemandLevels) {
    for (const item of additionalSources.supplyDemandLevels) {
      if (item.supply) {
        const norm = normalizePrice(item.supply);
        if (norm) {
          if (!map.has(norm)) {
            map.set(norm, { displayPrice: item.supply.trim(), occurrences: [] });
          }
          map.get(norm)!.occurrences.push({
            timeframe: item.timeframe,
            field: 'Supply Zone',
            originalInput: item.supply.trim(),
          });
        }
      }
      if (item.demand) {
        const norm = normalizePrice(item.demand);
        if (norm) {
          if (!map.has(norm)) {
            map.set(norm, { displayPrice: item.demand.trim(), occurrences: [] });
          }
          map.get(norm)!.occurrences.push({
            timeframe: item.timeframe,
            field: 'Demand Zone',
            originalInput: item.demand.trim(),
          });
        }
      }
    }
  }

  // Filter groups present in at least 2 distinct timeframes
  const results: MatchingPriceGroup[] = [];
  for (const [norm, info] of map.entries()) {
    const distinctTimeframes = new Set(info.occurrences.map((o) => o.timeframe));
    if (distinctTimeframes.size >= 2) {
      results.push({
        normalizedPrice: norm,
        displayPrice: info.displayPrice,
        occurrences: info.occurrences,
      });
    }
  }

  // Sort by count of distinct timeframes descending, then by price numerically descending
  results.sort((a, b) => {
    const aTfs = new Set(a.occurrences.map((o) => o.timeframe)).size;
    const bTfs = new Set(b.occurrences.map((o) => o.timeframe)).size;
    if (bTfs !== aTfs) {
      return bTfs - aTfs;
    }
    return parseFloat(b.normalizedPrice) - parseFloat(a.normalizedPrice);
  });

  return results;
}

/**
 * Compresses an image data URL before storing in IndexedDB.
 */
export function compressImageFile(file: File, maxWidth = 1920, maxHeight = 1920, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Use JPEG for charts unless transparent PNG
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outputType, quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image for compression'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Escapes a CSV cell value according to RFC 4180.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV string for a list of reports.
 */
export function generateReportsCsv(reports: SavedReport[]): string {
  const headers = [
    'Report ID',
    'Title',
    'Date',
    'Time',
    'Timezone',
    'Pair',
    'Session',
    'Analysis Made',
    'Overall Alignment',
    'Monthly Bias',
    'My Monthly Bias',
    'Weekly Bias',
    'My Weekly Bias',
    'Daily Bias',
    'My Daily Bias',
    '4H Bias',
    '1H Bias',
    '15M Bias',
    '5M Bias',
    '1M Bias',
    'Monthly Note',
    'Weekly Note',
    'Daily Note',
    '4H Note',
    '1H Note',
    '15M Note',
    '5M Note',
    '1M Note',
    'Crossed Liquidity',
    'Major Liquidity Watchlist',
    'Supply & Demand Levels',
    'Opening Candle Levels',
    'Overall Notes',
    'Planned Scenarios',
    'Trades Taken',
    'Status',
    'Created At',
    'Updated At',
  ];

  const rows = reports.map((r) => {
    const alignment = calculateOverallAlignment(r.timeframes);
    const crossedLiq = (r.crossedLiquidity || []).join('; ');
    const sdLevels = (r.supplyDemandLevels || [])
      .map((sd) => `${sd.timeframe}: S[${sd.supply || '-'}] D[${sd.demand || '-'}]`)
      .join('; ');
    const ocLevels = (r.openingCandles || [])
      .map((oc) => `${oc.session}: ${oc.level || '-'}`)
      .join('; ');
    const scenariosText = (r.scenarios || [])
      .map(
        (s) =>
          `[${s.label}: ${s.direction || '-'} | Strategy: ${s.strategy || '-'} | Rules: ${s.entryConditions || '-'} | Invalidation: ${s.invalidationConditions || '-'}]`
      )
      .join('; ');
    const tradesText = (r.trades || [])
      .map(
        (t) =>
          `[${t.direction || '-'} (${t.scenarioLabel || 'Trade'}${t.strategy || t.strategySnapshot?.name || t.scenarioSnapshot?.strategy ? ` | Strategy: ${t.strategy || t.strategySnapshot?.name || t.scenarioSnapshot?.strategy}` : ''}) | Entry: ${t.entryPrice || '-'} SL: ${t.stopLoss || '-'} TP: ${t.takeProfit || '-'} Planned R:R: ${t.plannedRRChoice === 'Custom' ? t.plannedRRRatio || 'Custom' : t.plannedRRChoice || t.riskReward || '-'} Setup Validity: ${t.setupValidity || 'Not reviewed'} Outcome: ${t.outcome || '-'} Rules: ${t.rulesFollowed === false ? 'Broken' : 'Followed'}]`
      )
      .join('; ');

    return [
      escapeCsvCell(r.id),
      escapeCsvCell(r.title || ''),
      escapeCsvCell(r.date),
      escapeCsvCell(r.time),
      escapeCsvCell(r.timezone),
      escapeCsvCell(r.pair),
      escapeCsvCell(r.session),
      escapeCsvCell(r.analysisTiming),
      escapeCsvCell(alignment.label),
      escapeCsvCell(r.timeframes?.['Monthly']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Monthly']?.personalBiasNotes || ''),
      escapeCsvCell(r.timeframes?.['Weekly']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Weekly']?.personalBiasNotes || ''),
      escapeCsvCell(r.timeframes?.['Daily']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Daily']?.personalBiasNotes || ''),
      escapeCsvCell(r.timeframes?.['4H']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['1H']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['15M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['5M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['1M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Monthly']?.note || ''),
      escapeCsvCell(r.timeframes?.['Weekly']?.note || ''),
      escapeCsvCell(r.timeframes?.['Daily']?.note || ''),
      escapeCsvCell(r.timeframes?.['4H']?.note || ''),
      escapeCsvCell(r.timeframes?.['1H']?.note || ''),
      escapeCsvCell(r.timeframes?.['15M']?.note || ''),
      escapeCsvCell(r.timeframes?.['5M']?.note || ''),
      escapeCsvCell(r.timeframes?.['1M']?.note || ''),
      escapeCsvCell(crossedLiq),
      escapeCsvCell(r.majorLiquidityWatchlist || ''),
      escapeCsvCell(sdLevels),
      escapeCsvCell(ocLevels),
      escapeCsvCell(r.overallNotes || ''),
      escapeCsvCell(scenariosText),
      escapeCsvCell(tradesText),
      escapeCsvCell(r.status || 'Original'),
      escapeCsvCell(new Date(r.createdAt).toISOString()),
      escapeCsvCell(new Date(r.updatedAt).toISOString()),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\r\n');
}

/**
 * SMC & Discipline rotating quotes for the Home section
 */
export interface DisciplineQuote {
  quote: string;
  author: string;
  reference?: string;
}

export const DISCIPLINE_QUOTES: DisciplineQuote[] = [
  {
    quote: "Anything can happen.",
    author: "Mark Douglas",
  },
  {
    quote: "Losers average losers.",
    author: "Paul Tudor Jones",
  },
  {
    quote: "Know what you own and why you own it.",
    author: "Peter Lynch",
  },
  {
    quote: "I have always found it profitable to study my mistakes.",
    author: "Edwin Lefèvre",
    reference: "Reminiscences of a Stock Operator",
  },
  {
    quote: "You can’t predict. You can prepare.",
    author: "Howard Marks",
  },
  {
    quote: "Whenever I enter a position, I have a predetermined stop.",
    author: "Bruce Kovner",
  },
  {
    quote: "Profits always take care of themselves but losses never do.",
    author: "Jesse Livermore",
  },
  {
    quote: "The investor’s chief problem, and even his worst enemy, is likely to be himself.",
    author: "Benjamin Graham",
  },
  {
    quote: "Writing down your trades is the best exercise in the world.",
    author: "Linda Bradford Raschke",
  },
  {
    quote: "Risk comes from not knowing what you’re doing.",
    author: "Warren Buffett",
  },
  {
    quote: "If you lose all your chips, you can’t bet.",
    author: "Larry Hite",
  },
  {
    quote: "Every moment in the market is unique.",
    author: "Mark Douglas",
  },
  {
    quote: "The four most dangerous words in investing are, ‘It’s different this time.’",
    author: "John Templeton",
  },
  {
    quote: "The most important rule of trading is to play great defense, not great offense.",
    author: "Paul Tudor Jones",
  },
  {
    quote: "Nobody can catch all the fluctuations.",
    author: "Edwin Lefèvre",
    reference: "Reminiscences of a Stock Operator",
  },
  {
    quote: "You don’t trade the markets: You trade your beliefs about the markets.",
    author: "Van K. Tharp",
  },
  {
    quote: "If you can’t take a small loss, sooner or later you will take the mother of all losses.",
    author: "Ed Seykota",
  },
  {
    quote: "To hell with my ego, making money is more important.",
    author: "Marty Schwartz",
    reference: "Pit Bull",
  },
  {
    quote: "Risk management is the most important thing to be well understood.",
    author: "Bruce Kovner",
  },
  {
    quote: "I predefine the risk of every trade.",
    author: "Mark Douglas",
    reference: "Trading in the Zone",
  },
  {
    quote: "Never argue with the market.",
    author: "Jesse Livermore",
  },
  {
    quote: "The way to build superior long-term returns is through preservation of capital and home runs.",
    author: "Stanley Druckenmiller",
  },
  {
    quote: "The market is a device for transferring money from the impatient to the patient.",
    author: "Warren Buffett",
  },
  {
    quote: "Structure provides the narrative; liquidity provides the fuel.",
    author: "Smart Money Principle",
  },
  {
    quote: "When higher timeframe structure and lower timeframe intent align, clarity replaces anxiety.",
    author: "Discipline Axiom",
  },
];

/**
 * Shuffles quotes ensuring no two consecutive quotes are from the same author
 */
export function getShuffledQuotes(list: DisciplineQuote[] = DISCIPLINE_QUOTES): DisciplineQuote[] {
  const pool = [...list];
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Pass to ensure no consecutive quotes share the same author
  for (let i = 1; i < pool.length; i++) {
    if (pool[i].author === pool[i - 1].author) {
      let swapIdx = -1;
      for (let j = i + 1; j < pool.length; j++) {
        if (
          pool[j].author !== pool[i - 1].author &&
          (j + 1 === pool.length || pool[j].author !== pool[j + 1]?.author)
        ) {
          swapIdx = j;
          break;
        }
      }
      if (swapIdx === -1) {
        for (let j = 0; j < i - 1; j++) {
          if (
            pool[j].author !== pool[i].author &&
            (j === 0 || pool[j - 1].author !== pool[i].author)
          ) {
            swapIdx = j;
            break;
          }
        }
      }
      if (swapIdx !== -1) {
        [pool[i], pool[swapIdx]] = [pool[swapIdx], pool[i]];
      }
    }
  }

  return pool;
}

export interface TimeframeStructureStatus {
  status: 'aligned' | 'mixed' | 'incomplete';
  label: string;
  direction?: 'Bullish' | 'Bearish';
}

/**
 * Derives structure alignment from swing, internal, and fractal structures for a timeframe.
 * Full alignment requires all applicable required components filled and agreeing (all Bullish or all Bearish).
 * If filled but mixed: 'Mixed structure'.
 * If any required direction missing: 'Structure incomplete'.
 */
export function getTimeframeStructureAlignment(tfData?: TimeframeData | null): TimeframeStructureStatus {
  if (!tfData) {
    return {
      status: 'incomplete',
      label: 'Structure incomplete',
    };
  }

  const swing = normalizeStructureDirectionAndConfirmation(
    tfData.swing?.direction,
    tfData.swing?.confirmation
  );
  const internal = normalizeStructureDirectionAndConfirmation(
    tfData.internal?.direction,
    tfData.internal?.confirmation
  );
  const fractal = normalizeStructureDirectionAndConfirmation(
    tfData.fractal?.direction,
    tfData.fractal?.confirmation
  );

  // Missing or unselected required components
  if (!swing.direction || !internal.direction || !fractal.direction) {
    return {
      status: 'incomplete',
      label: 'Structure incomplete',
    };
  }

  if (
    swing.confirmation === 'Waiting' ||
    internal.confirmation === 'Waiting' ||
    fractal.confirmation === 'Waiting'
  ) {
    return {
      status: 'incomplete',
      label: 'Waiting confirmation',
    };
  }

  // Neutral is non-directional, therefore cannot form full bullish/bearish alignment
  if (swing.direction === 'Neutral' || internal.direction === 'Neutral' || fractal.direction === 'Neutral') {
    return {
      status: 'mixed',
      label: 'Mixed structure',
    };
  }

  if (swing.direction === 'Bullish' && internal.direction === 'Bullish' && fractal.direction === 'Bullish') {
    return {
      status: 'aligned',
      label: 'Structures aligned — Bullish',
      direction: 'Bullish',
    };
  }

  if (swing.direction === 'Bearish' && internal.direction === 'Bearish' && fractal.direction === 'Bearish') {
    return {
      status: 'aligned',
      label: 'Structures aligned — Bearish',
      direction: 'Bearish',
    };
  }

  return {
    status: 'mixed',
    label: 'Mixed structure',
  };
}

/**
 * Returns recorded Opening Candle (OC) level for a timeframe if present.
 */
export function getTimeframeOcLevel(
  timeframe: TimeframeId,
  openingCandles?: OpeningCandleEntry[] | null
): string | null {
  if (!openingCandles || openingCandles.length === 0) return null;

  const match = openingCandles.find((oc) => {
    if (!oc || !oc.level || !oc.level.trim()) return false;
    if (timeframe === 'Monthly' && oc.session === 'Monthly') return true;
    if (timeframe === 'Weekly' && oc.session === 'Weekly') return true;
    if (oc.session.toLowerCase() === timeframe.toLowerCase()) return true;
    return false;
  });

  return match ? match.level.trim() : null;
}

/**
 * Returns compact formatted string of crossed liquidity taken corresponding to a timeframe.
 * Monthly: PMH, PML
 * Weekly: PWH, PWL
 * Daily: PDH, PDL
 * 4H: 4H High, 4H Low
 */
export function getTimeframeLiquidityTaken(
  timeframe: TimeframeId,
  crossedLiquidity?: MajorLiquidityItem[] | null
): string | null {
  if (!crossedLiquidity || crossedLiquidity.length === 0) return null;

  const taken: string[] = [];
  if (timeframe === 'Monthly') {
    if (crossedLiquidity.includes('PMH')) taken.push('PMH');
    if (crossedLiquidity.includes('PML')) taken.push('PML');
  } else if (timeframe === 'Weekly') {
    if (crossedLiquidity.includes('PWH')) taken.push('PWH');
    if (crossedLiquidity.includes('PWL')) taken.push('PWL');
  } else if (timeframe === 'Daily') {
    if (crossedLiquidity.includes('PDH')) taken.push('PDH');
    if (crossedLiquidity.includes('PDL')) taken.push('PDL');
  } else if (timeframe === '4H') {
    if (crossedLiquidity.includes('4H High')) taken.push('4H High');
    if (crossedLiquidity.includes('4H Low')) taken.push('4H Low');
  }

  if (taken.length === 0) return null;
  return `Liquidity taken: ${taken.join(', ')}`;
}

export interface TimeframePairAlignmentInfo {
  localTf: TimeframeId;
  partnerTf: TimeframeId;
  status: 'aligned' | 'differing' | 'incomplete' | 'neutral';
  direction?: 'Bullish' | 'Bearish';
  label: string;
  deepAligned: boolean;
}

export const CONFIGURED_TIMEFRAME_PAIRS: Array<[TimeframeId, TimeframeId]> = [
  ['Daily', '1H'],
  ['4H', '15M'],
  ['1H', '5M'],
  ['15M', '1M'],
];

/**
 * Returns pair alignment information for the given local timeframe.
 * Configured pairs: Daily ↔ 1H, 4H ↔ 15M, 1H ↔ 5M, 15M ↔ 1M.
 * 1H and 15M participate in two pairs each.
 * Omit pairs whose counterpart timeframe is hidden by visibility settings.
 * Checks deep structures: appends '(Deep structures also aligned)' if and only if both timeframes
 * have complete structure alignment in the same direction.
 */
export function getTimeframePairAlignments(
  localTf: TimeframeId,
  timeframes: Record<TimeframeId, TimeframeData>,
  visibleTimeframes?: Record<TimeframeId, boolean>
): TimeframePairAlignmentInfo[] {
  if (!timeframes) return [];

  // Determine configured partner timeframes in standard order
  const partners: TimeframeId[] = [];
  if (localTf === 'Daily') {
    partners.push('1H');
  } else if (localTf === '4H') {
    partners.push('15M');
  } else if (localTf === '1H') {
    partners.push('Daily', '5M');
  } else if (localTf === '15M') {
    partners.push('4H', '1M');
  } else if (localTf === '5M') {
    partners.push('1H');
  } else if (localTf === '1M') {
    partners.push('15M');
  }

  const results: TimeframePairAlignmentInfo[] = [];

  for (const partnerTf of partners) {
    // Respect counterpart timeframe visibility: if hidden, omit pair
    if (visibleTimeframes && visibleTimeframes[partnerTf] === false) {
      continue;
    }

    const localData = timeframes[localTf];
    const partnerData = timeframes[partnerTf];

    const localBias = localData?.overallBias;
    const partnerBias = partnerData?.overallBias;

    // Both explicitly Bullish
    if (localBias === 'Bullish' && partnerBias === 'Bullish') {
      const localDeep = getTimeframeStructureAlignment(localData);
      const partnerDeep = getTimeframeStructureAlignment(partnerData);
      const deepAligned =
        localDeep.status === 'aligned' &&
        partnerDeep.status === 'aligned' &&
        localDeep.direction === 'Bullish' &&
        partnerDeep.direction === 'Bullish';

      results.push({
        localTf,
        partnerTf,
        status: 'aligned',
        direction: 'Bullish',
        label: deepAligned
          ? `${localTf} aligned with ${partnerTf} — Bullish (Deep structures also aligned)`
          : `${localTf} aligned with ${partnerTf} — Bullish`,
        deepAligned,
      });
      continue;
    }

    // Both explicitly Bearish
    if (localBias === 'Bearish' && partnerBias === 'Bearish') {
      const localDeep = getTimeframeStructureAlignment(localData);
      const partnerDeep = getTimeframeStructureAlignment(partnerData);
      const deepAligned =
        localDeep.status === 'aligned' &&
        partnerDeep.status === 'aligned' &&
        localDeep.direction === 'Bearish' &&
        partnerDeep.direction === 'Bearish';

      results.push({
        localTf,
        partnerTf,
        status: 'aligned',
        direction: 'Bearish',
        label: deepAligned
          ? `${localTf} aligned with ${partnerTf} — Bearish (Deep structures also aligned)`
          : `${localTf} aligned with ${partnerTf} — Bearish`,
        deepAligned,
      });
      continue;
    }

    // Opposing directions -> "Biases differ"
    if (
      (localBias === 'Bullish' && partnerBias === 'Bearish') ||
      (localBias === 'Bearish' && partnerBias === 'Bullish')
    ) {
      results.push({
        localTf,
        partnerTf,
        status: 'differing',
        label: `${localTf} and ${partnerTf} — Biases differ`,
        deepAligned: false,
      });
      continue;
    }

    // Either Neutral -> "No directional alignment"
    if (localBias === 'Neutral' || partnerBias === 'Neutral') {
      results.push({
        localTf,
        partnerTf,
        status: 'neutral',
        label: `${localTf} and ${partnerTf} — No directional alignment`,
        deepAligned: false,
      });
      continue;
    }

    // Either missing/unselected/Not sure -> "Pair incomplete"
    results.push({
      localTf,
      partnerTf,
      status: 'incomplete',
      label: `${localTf} and ${partnerTf} — Pair incomplete`,
      deepAligned: false,
    });
  }

  return results;
}

const UTC_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UTC_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Formats an ISO analysis date (YYYY-MM-DD) into a human-readable display string
 * such as "Tuesday, Nov 3" with year secondary, without shifting UTC calendar days
 * across extreme timezones (UTC+14 to UTC-12) or breaking legacy formats.
 */
export function formatReadableAnalysisDate(dateStr?: string | null): {
  primary: string; // e.g. "Tuesday, Nov 3"
  secondary: string; // e.g. "2026"
  full: string; // e.g. "Tuesday, Nov 3, 2026"
} {
  if (!dateStr || !dateStr.trim()) {
    return { primary: 'Unspecified Date', secondary: '', full: 'Unspecified Date' };
  }
  const str = dateStr.trim();
  const parts = str.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    // Use UTC noon to guarantee zero day-shift regardless of local timezone or extreme offset (UTC+14 to UTC-12)
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (!isNaN(d.getTime()) && month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const weekday = UTC_WEEKDAY_NAMES[d.getUTCDay()];
      const monthStr = UTC_MONTH_NAMES[month];
      const primary = `${weekday}, ${monthStr} ${day}`;
      const secondary = `${year}`;
      return { primary, secondary, full: `${primary}, ${secondary}` };
    }
  }
  return { primary: str, secondary: '', full: str };
}

/**
 * Isolated deep clone helper so nested arrays, objects, structure history, and strategy snapshots
 * never share mutable references across edit buffers or saved snapshots.
 */
export function deepClone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
  } catch {
    // Fallback below if non-cloneable property present
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Formats a Date into YYYY-MM-DD in the supplied IANA timezone (avoiding UTC day shift).
 */
export function formatDateInTimezone(date: Date = new Date(), timeZone?: string): string {
  const tz = (timeZone || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Formats a Date into HH:MM:SS (24-hour) in the supplied IANA timezone.
 */
export function formatTimeInTimezone(date: Date = new Date(), timeZone?: string): string {
  const tz = (timeZone || '').trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
}

/**
 * Determines whether an AnalysisData session contains meaningful user work or is bound to
 * an existing report so untouched blank new forms do not trigger false "Continue Analysis" prompts.
 */
export function hasMeaningfulAnalysisWork(
  data?: AnalysisData | null,
  isEditingExistingOrBound = false
): boolean {
  if (!data) return false;
  if (isEditingExistingOrBound) return true;
  if (
    Boolean(data.originalId && data.originalId !== 'active_draft' && data.originalId !== 'draft') ||
    data.isModified === true ||
    Boolean(data.copiedFromId) ||
    Boolean(data.templateId)
  ) {
    return true;
  }
  if ((data.title || '').trim().length > 0) return true;
  if ((data.overallNotes || '').trim().length > 0) return true;
  if ((data.majorLiquidityWatchlist || '').trim().length > 0) return true;
  if ((data.crossedLiquidity || []).length > 0) return true;
  if ((data.openingCandles || []).length > 0) return true;
  if ((data.supplyDemandLevels || []).length > 0) return true;
  if ((data.scenarios || []).length > 0) return true;
  if ((data.trades || []).length > 0) return true;

  for (const tf of TIMEFRAME_ORDER) {
    const tfd = data.timeframes?.[tf];
    if (!tfd) continue;
    if (
      tfd.overallBias ||
      (tfd.biasSpecific || '').trim().length > 0 ||
      (tfd.personalBiasNotes || '').trim().length > 0 ||
      (tfd.note || '').trim().length > 0 ||
      Boolean(tfd.chartImageId) ||
      tfd.isSaved === true ||
      Boolean(tfd.priceLocation?.location) ||
      Boolean((tfd.priceLocation?.levelRange || '').trim()) ||
      Boolean(tfd.swing?.direction) ||
      Boolean((tfd.swing?.high || '').trim()) ||
      Boolean((tfd.swing?.low || '').trim()) ||
      Boolean((tfd.swing?.bosAt || '').trim()) ||
      (tfd.swing?.history || []).length > 0 ||
      Boolean(tfd.internal?.direction) ||
      Boolean((tfd.internal?.high || '').trim()) ||
      Boolean((tfd.internal?.low || '').trim()) ||
      Boolean((tfd.internal?.ibosAt || '').trim()) ||
      (tfd.internal?.history || []).length > 0 ||
      Boolean(tfd.fractal?.direction) ||
      Boolean((tfd.fractal?.fractalBosAt || '').trim()) ||
      (tfd.fractal?.history || []).length > 0 ||
      (tfd.supplyLevels || []).length > 0 ||
      (tfd.demandLevels || []).length > 0 ||
      (tfd.supportLevels || []).length > 0 ||
      (tfd.resistanceLevels || []).length > 0 ||
      (tfd.liquidityLevels || []).length > 0 ||
      Boolean((tfd.pmh || '').trim()) ||
      Boolean((tfd.pml || '').trim()) ||
      Boolean((tfd.pwh || '').trim()) ||
      Boolean((tfd.pwl || '').trim()) ||
      Boolean((tfd.pdh || '').trim()) ||
      Boolean((tfd.pdl || '').trim())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether all active enabled timeframes are directional (all Bullish or all Bearish)
 * AND Confirmed (no Waiting confirmation, no Neutral/Not sure bias, no conflicting/Waiting structure).
 */
export function areRequiredTimeframesConfirmedAligned(
  timeframes?: Record<TimeframeId, TimeframeData> | null,
  enabledTimeframes?: TimeframeId[]
): {
  aligned: boolean;
  bias: 'Bullish' | 'Bearish' | null;
  signature: string;
} {
  if (!timeframes) {
    return { aligned: false, bias: null, signature: '' };
  }

  const activeTfs =
    enabledTimeframes && enabledTimeframes.length > 0
      ? enabledTimeframes
      : TIMEFRAME_ORDER.filter((tf) => Boolean(timeframes[tf]));

  if (activeTfs.length === 0) {
    return { aligned: false, bias: null, signature: '' };
  }

  const overall = calculateOverallAlignment(timeframes, activeTfs);
  if (overall.status !== 'ALIGNED' || !overall.bias) {
    return { aligned: false, bias: null, signature: '' };
  }

  const targetBias = overall.bias;

  for (const tf of activeTfs) {
    const tfd = timeframes[tf];
    if (!tfd) {
      return { aligned: false, bias: null, signature: '' };
    }
    const layers = [
      normalizeStructureDirectionAndConfirmation(tfd.swing?.direction, tfd.swing?.confirmation),
      normalizeStructureDirectionAndConfirmation(tfd.internal?.direction, tfd.internal?.confirmation),
      normalizeStructureDirectionAndConfirmation(tfd.fractal?.direction, tfd.fractal?.confirmation),
    ];

    for (const layer of layers) {
      if (layer.confirmation === 'Waiting') {
        return { aligned: false, bias: null, signature: '' };
      }
      if (layer.direction === 'Neutral') {
        return { aligned: false, bias: null, signature: '' };
      }
      if (layer.direction && layer.direction !== targetBias) {
        return { aligned: false, bias: null, signature: '' };
      }
    }
  }

  return {
    aligned: true,
    bias: targetBias,
    signature: `${targetBias}:${activeTfs.join(',')}`,
  };
}

/**
 * Sanitizes decimal typing without deleting intermediate decimal points, leading '-',
 * or trailing zeros. Converts locale commas to dots cleanly when typing.
 */
export function sanitizeDecimalInput(
  raw: string,
  options: { allowNegative?: boolean } = {}
): string {
  const allowNeg = Boolean(options.allowNegative);
  let str = String(raw || '').replace(/,/g, '.').replace(/\s+/g, '');
  let out = '';
  let hasDot = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (ch === '.' && !hasDot) {
      hasDot = true;
      out += '.';
    } else if (ch === '-' && allowNeg && out.length === 0) {
      out += '-';
    }
  }
  return out;
}

/**
 * Parses a locale-flexible decimal string safely. Returns null for empty or non-finite values.
 */
export function parseLocaleDecimal(raw?: string | number | null): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/,/g, '.');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
    return null;
  }
  if (!/^-?\d*(\.\d*)?$/.test(cleaned)) {
    return null;
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function getPlannedRRTargetMultiplier(
  choice?: PlannedRRChoice | string,
  customRatio?: string
): number | null {
  if (!choice) return null;
  if (choice === '1:1') return 1;
  if (choice === '1:1.5') return 1.5;
  if (choice === '1:2') return 2;
  if (choice === '1:3') return 3;

  const raw = (customRatio || choice || '').trim();
  if (!raw) return null;
  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length === 2) {
      const left = parseLocaleDecimal(parts[0]);
      const right = parseLocaleDecimal(parts[1]);
      if (left && right && left > 0 && right > 0) {
        return right / left;
      }
    }
    return null;
  }
  const single = parseLocaleDecimal(raw);
  return single && single > 0 ? single : null;
}

export function computeLiveRRFromPrices(params: {
  direction?: 'Buy' | 'Sell' | '';
  entryPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
}): {
  ratio: number | null;
  formatted: string;
  validRisk: boolean;
  invalidReason?: string;
} {
  const entry = parseLocaleDecimal(params.entryPrice);
  const sl = parseLocaleDecimal(params.stopLoss);
  const tp = parseLocaleDecimal(params.takeProfit);

  if (entry === null || sl === null) {
    return { ratio: null, formatted: '', validRisk: false };
  }

  if (params.direction === 'Buy' && sl >= entry) {
    return {
      ratio: null,
      formatted: '',
      validRisk: false,
      invalidReason: 'For Buy trades, Stop Loss must be below Entry price.',
    };
  }
  if (params.direction === 'Sell' && sl <= entry) {
    return {
      ratio: null,
      formatted: '',
      validRisk: false,
      invalidReason: 'For Sell trades, Stop Loss must be above Entry price.',
    };
  }

  const risk = Math.abs(entry - sl);
  if (risk <= 0) {
    return { ratio: null, formatted: '', validRisk: false };
  }

  if (tp === null) {
    return { ratio: null, formatted: '', validRisk: true };
  }

  if (params.direction === 'Buy' && tp <= entry) {
    return {
      ratio: null,
      formatted: '',
      validRisk: true,
      invalidReason: 'For Buy trades, Take Profit should be above Entry price.',
    };
  }
  if (params.direction === 'Sell' && tp >= entry) {
    return {
      ratio: null,
      formatted: '',
      validRisk: true,
      invalidReason: 'For Sell trades, Take Profit should be below Entry price.',
    };
  }

  const reward = Math.abs(tp - entry);
  const ratio = Number((reward / risk).toFixed(2));
  return {
    ratio,
    formatted: `1:${Number.isInteger(ratio) ? ratio : Number(ratio.toFixed(2))}`,
    validRisk: true,
  };
}

export function checkPlannedRRMismatch(params: {
  plannedRRChoice?: PlannedRRChoice | string;
  plannedRRRatio?: string;
  computedRatio: number | null;
  tolerance?: number;
}): {
  hasMismatch: boolean;
  message?: string;
} {
  const target = getPlannedRRTargetMultiplier(params.plannedRRChoice, params.plannedRRRatio);
  if (target === null || params.computedRatio === null) {
    return { hasMismatch: false };
  }
  const tol = params.tolerance ?? 0.15;
  if (Math.abs(params.computedRatio - target) > tol) {
    return {
      hasMismatch: true,
      message: `Entered levels yield ~1:${Number(params.computedRatio.toFixed(2))}, which differs from your Planned R:R (1:${target}). Your entered prices stay untouched unless you calculate TP explicitly.`,
    };
  }
  return { hasMismatch: false };
}

export function calculateTakeProfitForPlannedRR(params: {
  direction: 'Buy' | 'Sell' | '';
  entryPrice?: string;
  stopLoss?: string;
  targetMultiplier: number;
}): string | null {
  const entry = parseLocaleDecimal(params.entryPrice);
  const sl = parseLocaleDecimal(params.stopLoss);
  if (entry === null || sl === null || !params.direction || params.targetMultiplier <= 0) {
    return null;
  }
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  if (params.direction === 'Buy' && sl >= entry) return null;
  if (params.direction === 'Sell' && sl <= entry) return null;

  const entryStr = (params.entryPrice || '').trim().replace(/,/g, '.');
  const slStr = (params.stopLoss || '').trim().replace(/,/g, '.');
  const entryDecimals = entryStr.includes('.') ? entryStr.split('.')[1].length : 0;
  const slDecimals = slStr.includes('.') ? slStr.split('.')[1].length : 0;
  const precision = Math.min(6, Math.max(entryDecimals, slDecimals, 2));

  const tp =
    params.direction === 'Buy'
      ? entry + risk * params.targetMultiplier
      : entry - risk * params.targetMultiplier;
  return tp.toFixed(precision);
}

export function formatSetupValidityBadge(validity?: SetupValidity | string): string {
  if (validity === 'Valid') return 'Valid setup';
  if (validity === 'Invalid') return 'Invalid setup';
  return 'Not reviewed';
}

export function formatTradeCombinedStatus(trade: Pick<RecordedTrade, 'setupValidity' | 'outcome'>): string {
  const validityLabel = formatSetupValidityBadge(trade.setupValidity);
  const outcomeLabel = trade.outcome || 'Open';
  return `${validityLabel} · ${outcomeLabel}`;
}



