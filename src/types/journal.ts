export type TimeframeId = 'Weekly' | 'Daily' | '4H' | '1H' | '15M' | '5M' | '1M';

export const TIMEFRAME_ORDER: TimeframeId[] = [
  'Weekly',
  'Daily',
  '4H',
  '1H',
  '15M',
  '5M',
  '1M',
];

export type OverallBias = 'Bullish' | 'Neutral' | 'Bearish' | 'Not sure' | '';

export type StructureDirection = 'Bullish' | 'Bearish' | 'Neutral' | '';
export type FractalDirection = 'Bullish' | 'Bearish' | '';

export interface SwingStructure {
  direction: StructureDirection;
  high: string;
  low: string;
  bosAt: string;
}

export interface InternalStructure {
  direction: StructureDirection;
  high: string;
  low: string;
  ibosAt: string;
}

export interface FractalStructure {
  direction: FractalDirection;
  fractalBosAt: string;
}

export interface TimeframeData {
  timeframe: TimeframeId;
  overallBias: OverallBias;
  biasSpecific: string;
  swing: SwingStructure;
  internal: InternalStructure;
  fractal: FractalStructure;
  note: string;
  chartImageId?: string;
  isSaved: boolean; // Locked in editor until 'Edit' is clicked
}

export type TradingPair = 'XAUUSD' | 'BTCUSD' | 'EURUSD';

export type TradingSession = 'Asian' | 'London' | 'NY AM' | 'NY PM';

export type AnalysisTiming = 'On time' | 'Before session' | 'Before 1 day';

export interface SupplyDemandLevel {
  id: string;
  timeframe: TimeframeId;
  supply: string;
  demand: string;
  showInTimeframe: boolean; // "Show here" / "Hide here" toggle
}

export const MAJOR_LIQUIDITY_ITEMS = [
  'PDH',
  'PDL',
  'PWH',
  'PWL',
  'PMH',
  'PML',
  'PD Mid',
  'PW Mid',
  'Asian High',
  'Asian Low',
  'London High',
  'London Low',
  'NY High',
  'NY Low',
  '4H High',
  '4H Low',
  'Equal Highs',
  'Equal Lows',
  'Buy-side Liquidity',
  'Sell-side Liquidity',
] as const;

export type MajorLiquidityItem = typeof MAJOR_LIQUIDITY_ITEMS[number];

export interface AnalysisData {
  id: string; // Report ID or 'draft'
  pair: TradingPair;
  date: string; // Local date (YYYY-MM-DD)
  time: string; // Live captured time or custom
  timezone: string;
  session: TradingSession;
  analysisTiming: AnalysisTiming;
  timeframes: Record<TimeframeId, TimeframeData>;
  crossedLiquidity: MajorLiquidityItem[];
  supplyDemandLevels: SupplyDemandLevel[];
  overallNotes: string;
  createdAt: number;
  updatedAt: number;
  isModified?: boolean;
  copiedFromId?: string;
}

export interface SavedReport extends AnalysisData {
  status: 'Original' | 'Modified';
}

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: Omit<AnalysisData, 'id' | 'createdAt' | 'updatedAt' | 'date' | 'time'>;
  imageMap?: Record<TimeframeId, string>; // base64 or IDB image reference
}

export interface ImageAttachment {
  id: string;
  dataUrl: string; // compressed base64 or blob URL
  name?: string;
  createdAt: number;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  app: 'ABMAX_ANALYSIS';
  reports: SavedReport[];
  templates: SavedTemplate[];
  draft: AnalysisData | null;
  images: ImageAttachment[];
  preferences: {
    theme: 'light' | 'dark';
  };
}

export function createEmptyTimeframeData(tf: TimeframeId): TimeframeData {
  return {
    timeframe: tf,
    overallBias: '',
    biasSpecific: '',
    swing: {
      direction: '',
      high: '',
      low: '',
      bosAt: '',
    },
    internal: {
      direction: '',
      high: '',
      low: '',
      ibosAt: '',
    },
    fractal: {
      direction: '',
      fractalBosAt: '',
    },
    note: '',
    chartImageId: undefined,
    isSaved: false,
  };
}

export function createInitialAnalysisData(pair: TradingPair = 'XAUUSD'): AnalysisData {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  
  const timeframes = {} as Record<TimeframeId, TimeframeData>;
  for (const tf of TIMEFRAME_ORDER) {
    timeframes[tf] = createEmptyTimeframeData(tf);
  }

  return {
    id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    pair,
    date: dateStr,
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    timezone: tz,
    session: 'London',
    analysisTiming: 'On time',
    timeframes,
    crossedLiquidity: [],
    supplyDemandLevels: [],
    overallNotes: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
