import {
  AnalysisData,
  OverallBias,
  SavedReport,
  TIMEFRAME_ORDER,
  TimeframeData,
  TimeframeId,
} from '../types/journal';

export interface AlignmentResult {
  status: 'ALIGNED' | 'WAITING' | 'MIXED';
  label: string;
  bias: 'Bullish' | 'Bearish' | null;
  detail: string;
  isComplete: boolean;
}

/**
 * Calculates overall alignment across all 7 timeframes.
 * Show ALIGNED only when all seven overall bias selections are complete and identical (all Bullish or all Bearish).
 * Otherwise show Waiting / Mixed.
 */
export function calculateOverallAlignment(
  timeframes: Record<TimeframeId, TimeframeData>
): AlignmentResult {
  const biases = TIMEFRAME_ORDER.map((tf) => timeframes[tf]?.overallBias || '');
  const answeredCount = biases.filter((b) => b !== '').length;

  if (answeredCount < 7) {
    return {
      status: 'WAITING',
      label: 'Waiting / Incomplete',
      bias: null,
      detail: `${answeredCount}/7 timeframes selected`,
      isComplete: false,
    };
  }

  // All 7 answered
  const firstBias = biases[0];
  if (
    (firstBias === 'Bullish' || firstBias === 'Bearish') &&
    biases.every((b) => b === firstBias)
  ) {
    return {
      status: 'ALIGNED',
      label: `ALIGNED (${firstBias.toUpperCase()})`,
      bias: firstBias,
      detail: `All 7 timeframes confirm ${firstBias.toLowerCase()} bias`,
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
 * Swing, Internal, and Fractal are complete and all Bullish or all Bearish.
 */
export function isDeepAnalysisAligned(tfData: TimeframeData): boolean {
  const swing = tfData.swing.direction;
  const internal = tfData.internal.direction;
  const fractal = tfData.fractal.direction;

  if (!swing || !internal || !fractal) return false;
  if (swing === 'Neutral' || internal === 'Neutral') return false;

  return (
    (swing === 'Bullish' && internal === 'Bullish' && fractal === 'Bullish') ||
    (swing === 'Bearish' && internal === 'Bearish' && fractal === 'Bearish')
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
  timeframes: Record<TimeframeId, TimeframeData>
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

    const fieldsToCheck: Array<{ field: string; val: string }> = [
      { field: 'Swing High', val: data.swing.high },
      { field: 'Swing Low', val: data.swing.low },
      { field: 'Swing BOS', val: data.swing.bosAt },
      { field: 'Internal High', val: data.internal.high },
      { field: 'Internal Low', val: data.internal.low },
      { field: 'Internal iBOS', val: data.internal.ibosAt },
      { field: 'Fractal BOS', val: data.fractal.fractalBosAt },
    ];

    for (const item of fieldsToCheck) {
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

  // Filter only those with at least 2 occurrences
  const results: MatchingPriceGroup[] = [];
  for (const [norm, info] of map.entries()) {
    if (info.occurrences.length >= 2) {
      results.push({
        normalizedPrice: norm,
        displayPrice: info.displayPrice,
        occurrences: info.occurrences,
      });
    }
  }

  // Sort by price numerically if possible
  results.sort((a, b) => parseFloat(b.normalizedPrice) - parseFloat(a.normalizedPrice));
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
    'Date',
    'Time',
    'Timezone',
    'Pair',
    'Session',
    'Analysis Made',
    'Overall Alignment',
    'Weekly Bias',
    'Daily Bias',
    '4H Bias',
    '1H Bias',
    '15M Bias',
    '5M Bias',
    '1M Bias',
    'Weekly Note',
    'Daily Note',
    '4H Note',
    '1H Note',
    '15M Note',
    '5M Note',
    '1M Note',
    'Crossed Liquidity',
    'Supply & Demand Levels',
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
    const scenariosText = (r.scenarios || [])
      .map(
        (s) =>
          `[${s.label}: ${s.direction || '-'} | Strategy: ${s.strategy || '-'} | Rules: ${s.entryConditions || '-'} | Invalidation: ${s.invalidationConditions || '-'}]`
      )
      .join('; ');
    const tradesText = (r.trades || [])
      .map(
        (t) =>
          `[${t.direction || '-'} (${t.scenarioLabel || 'Trade'}) | Entry: ${t.entryPrice || '-'} SL: ${t.stopLoss || '-'} TP: ${t.takeProfit || '-'} Outcome: ${t.outcome || '-'} Rules: ${t.rulesFollowed ? 'Followed' : 'Broken'}]`
      )
      .join('; ');

    return [
      escapeCsvCell(r.id),
      escapeCsvCell(r.date),
      escapeCsvCell(r.time),
      escapeCsvCell(r.timezone),
      escapeCsvCell(r.pair),
      escapeCsvCell(r.session),
      escapeCsvCell(r.analysisTiming),
      escapeCsvCell(alignment.label),
      escapeCsvCell(r.timeframes?.['Weekly']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Daily']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['4H']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['1H']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['15M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['5M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['1M']?.overallBias || ''),
      escapeCsvCell(r.timeframes?.['Weekly']?.note || ''),
      escapeCsvCell(r.timeframes?.['Daily']?.note || ''),
      escapeCsvCell(r.timeframes?.['4H']?.note || ''),
      escapeCsvCell(r.timeframes?.['1H']?.note || ''),
      escapeCsvCell(r.timeframes?.['15M']?.note || ''),
      escapeCsvCell(r.timeframes?.['5M']?.note || ''),
      escapeCsvCell(r.timeframes?.['1M']?.note || ''),
      escapeCsvCell(crossedLiq),
      escapeCsvCell(sdLevels),
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
