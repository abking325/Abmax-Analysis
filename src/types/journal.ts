export type TimeframeId = 'Monthly' | 'Weekly' | 'Daily' | '4H' | '1H' | '15M' | '5M' | '1M';

export const TIMEFRAME_ORDER: TimeframeId[] = [
  'Monthly',
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

export type PriceLocation = 'Discount' | 'Equilibrium' | 'Premium' | '';

export interface PriceLocationData {
  location: PriceLocation;
  levelRange: string;
}

export interface DeepLevelEntry {
  id: string;
  level: string;
  note?: string;
}

export interface TimeframeData {
  timeframe: TimeframeId;
  overallBias: OverallBias;
  biasSpecific: string;
  priceLocation?: PriceLocationData;
  swing: SwingStructure;
  internal: InternalStructure;
  fractal: FractalStructure;
  supplyLevels?: DeepLevelEntry[];
  demandLevels?: DeepLevelEntry[];
  supportLevels?: DeepLevelEntry[];
  resistanceLevels?: DeepLevelEntry[];
  liquidityLevels?: DeepLevelEntry[];
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

export interface PlannedScenario {
  id: string; // stable UUID or unique id (e.g. scn_...)
  label: string; // "Scenario 1", "Scenario 2", etc.
  strategy: string; // Strategy Used
  direction: 'Buy' | 'Sell' | '';
  description: string; // Scenario Description
  entryConditions: string; // Entry Conditions / Rules
  invalidationConditions: string; // Invalidation Conditions
  images?: ImageAttachment[]; // Attached setup charts / execution zone screenshots
  isSaved?: boolean; // Individual scenario locked / collapsed state
  createdAt: number;
  updatedAt: number;
}

export type TradeOutcome = 'Win' | 'Loss' | 'Break-even' | 'Open' | '';

export interface RecordedTrade {
  id: string; // stable UUID or unique id (e.g. trd_...)
  scenarioId?: string; // linked planned scenario ID (or empty if unlinked)
  scenarioLabel?: string; // display snapshot of scenario label
  scenarioSnapshot?: {
    strategy?: string;
    direction?: string;
    description?: string;
    entryConditions?: string;
    invalidationConditions?: string;
    images?: ImageAttachment[];
  };
  pair: TradingPair;
  direction: 'Buy' | 'Sell' | '';
  session?: TradingSession;
  timeframeTaken?: TimeframeId | '';
  entryPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
  exitPrice?: string;
  riskReward?: string;
  outcome?: TradeOutcome;
  rulesFollowed?: boolean;
  notes?: string;
  images?: ImageAttachment[]; // Attached execution, entry, exit charts
  date: string; // YYYY-MM-DD
  time?: string;
  createdAt: number;
  updatedAt: number;
}

export type OpeningCandleSession =
  | 'Yearly'
  | 'Quarterly'
  | 'Monthly'
  | 'Weekly'
  | 'London'
  | 'New York'
  | 'Asia';

export interface OpeningCandleEntry {
  id: string; // stable unique ID (e.g. oc_...)
  session: OpeningCandleSession;
  level: string; // string price to preserve exact decimal formatting, blank not zero
}

export interface WorkspaceVisibilityConfig {
  timeframes: Record<TimeframeId, boolean>;
  deepSections: {
    overallInterpretation: boolean;
    priceLocation: boolean;
    swingStructure: boolean;
    internalStructure: boolean;
    fractalStructure: boolean;
    supplyLevels: boolean;
    demandLevels: boolean;
    supportLevels: boolean;
    resistanceLevels: boolean;
    liquidityLevels: boolean;
    timeframeNotes: boolean;
    chartAttachments: boolean;
  };
  otherSections: {
    majorLiquidityChecklist: boolean;
    majorLiquidityWatchlist: boolean;
    supplyDemandManager: boolean;
    openingCandle?: boolean;
    overallNotes: boolean;
    plannedScenarios: boolean;
  };
}

export const DEFAULT_VISIBILITY_CONFIG: WorkspaceVisibilityConfig = {
  timeframes: {
    Monthly: true,
    Weekly: true,
    Daily: true,
    '4H': true,
    '1H': true,
    '15M': true,
    '5M': true,
    '1M': true,
  },
  deepSections: {
    overallInterpretation: true,
    priceLocation: true,
    swingStructure: true,
    internalStructure: true,
    fractalStructure: true,
    supplyLevels: true,
    demandLevels: true,
    supportLevels: true,
    resistanceLevels: true,
    liquidityLevels: true,
    timeframeNotes: true,
    chartAttachments: true,
  },
  otherSections: {
    majorLiquidityChecklist: true,
    majorLiquidityWatchlist: true,
    supplyDemandManager: true,
    openingCandle: true,
    overallNotes: true,
    plannedScenarios: true,
  },
};

export interface AnalysisData {
  id: string; // Report ID or 'draft'
  title?: string; // Optional report title (Phase 2)
  pair: TradingPair;
  date: string; // Local date (YYYY-MM-DD)
  time: string; // Live captured time or custom
  timezone: string;
  session: TradingSession;
  analysisTiming: AnalysisTiming;
  timeframes: Record<TimeframeId, TimeframeData>;
  crossedLiquidity: MajorLiquidityItem[];
  majorLiquidityWatchlist?: string; // Phase 7: Major Liquidity Watchlist
  supplyDemandLevels: SupplyDemandLevel[];
  openingCandles?: OpeningCandleEntry[]; // Phase 4: Opening Candle Levels
  scenarios?: PlannedScenario[];
  trades?: RecordedTrade[];
  overallNotes: string;
  visibilityConfig?: WorkspaceVisibilityConfig;
  createdAt: number;
  updatedAt: number;
  isModified?: boolean;
  copiedFromId?: string;
  originalId?: string;
  revision?: number;
}

export interface SavedReport extends AnalysisData {
  status: 'Original' | 'Modified';
}

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: Omit<AnalysisData, 'id' | 'createdAt' | 'updatedAt' | 'date' | 'time' | 'trades'>;
  imageMap?: Record<TimeframeId, string>; // base64 or IDB image reference
}

export interface ImageAttachment {
  id: string;
  dataUrl: string; // compressed base64 or blob URL
  name?: string;
  caption?: string; // optional descriptive caption
  createdAt: number;
}

export interface ReportVisibilityConfig {
  general: {
    metadataAndTimestamps: boolean;
    overallAlignment: boolean;
    majorLiquidityChecklist: boolean;
    majorLiquidityWatchlist: boolean;
  };
  timeframes: Record<TimeframeId, boolean>;
  timeframeFields: {
    overallInterpretation: boolean;
    priceLocation: boolean;
    swingStructure: boolean;
    internalStructure: boolean;
    fractalStructure: boolean;
    deepAlignment: boolean;
    supplyLevels: boolean;
    demandLevels: boolean;
    supportLevels: boolean;
    resistanceLevels: boolean;
    liquidityLevels: boolean;
    timeframeNotes: boolean;
    timeframeImages: boolean;
  };
  notesAndLevels: {
    openingCandleLevels: boolean;
    generalSupplyDemand: boolean;
    overallNotes: boolean;
    matchingValues: boolean;
  };
  scenariosAndTrades: {
    plannedScenarios: boolean;
    scenarioImages: boolean;
    tradesTaken: boolean;
    tradeImages: boolean;
  };
}

export const DEFAULT_REPORT_VISIBILITY: ReportVisibilityConfig = {
  general: {
    metadataAndTimestamps: true,
    overallAlignment: true,
    majorLiquidityChecklist: true,
    majorLiquidityWatchlist: true,
  },
  timeframes: {
    Monthly: true,
    Weekly: true,
    Daily: true,
    '4H': true,
    '1H': true,
    '15M': true,
    '5M': true,
    '1M': true,
  },
  timeframeFields: {
    overallInterpretation: true,
    priceLocation: true,
    swingStructure: true,
    internalStructure: true,
    fractalStructure: true,
    deepAlignment: true,
    supplyLevels: true,
    demandLevels: true,
    supportLevels: true,
    resistanceLevels: true,
    liquidityLevels: true,
    timeframeNotes: true,
    timeframeImages: true,
  },
  notesAndLevels: {
    openingCandleLevels: true,
    generalSupplyDemand: true,
    overallNotes: true,
    matchingValues: true,
  },
  scenariosAndTrades: {
    plannedScenarios: true,
    scenarioImages: true,
    tradesTaken: true,
    tradeImages: true,
  },
};

export interface ReportPresentationConfig {
  defaultView: 'standard' | 'organized';
  desktopLayout: '1-col' | '2-col' | '3-col';
  textSize: 'small' | 'standard' | 'large';
  spacing: 'compact' | 'comfortable';
  separators: 'subtle' | 'bold';
  chartDisplay: 'collapsed' | 'expanded';
  showEmptySections: boolean;
  sectionVisibility?: ReportVisibilityConfig;
  pdfImages: {
    includeTimeframeCharts: boolean;
    includeScenarioImages: boolean;
    includeTradeImages: boolean;
  };
}

export const DEFAULT_REPORT_PRESENTATION: ReportPresentationConfig = {
  defaultView: 'standard',
  desktopLayout: '3-col',
  textSize: 'standard',
  spacing: 'comfortable',
  separators: 'subtle',
  chartDisplay: 'collapsed',
  showEmptySections: true,
  sectionVisibility: DEFAULT_REPORT_VISIBILITY,
  pdfImages: {
    includeTimeframeCharts: true,
    includeScenarioImages: true,
    includeTradeImages: true,
  },
};

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
    visibilityConfig?: WorkspaceVisibilityConfig;
    presentationConfig?: ReportPresentationConfig;
  };
}

export function createEmptyTimeframeData(tf: TimeframeId): TimeframeData {
  return {
    timeframe: tf,
    overallBias: '',
    biasSpecific: '',
    priceLocation: {
      location: '',
      levelRange: '',
    },
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
    supplyLevels: [],
    demandLevels: [],
    supportLevels: [],
    resistanceLevels: [],
    liquidityLevels: [],
    note: '',
    chartImageId: undefined,
    isSaved: false,
  };
}

export function createInitialAnalysisData(pair: TradingPair = 'XAUUSD', visibility?: WorkspaceVisibilityConfig): AnalysisData {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  
  const timeframes = {} as Record<TimeframeId, TimeframeData>;
  for (const tf of TIMEFRAME_ORDER) {
    timeframes[tf] = createEmptyTimeframeData(tf);
  }

  return {
    id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    title: '',
    pair,
    date: dateStr,
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    timezone: tz,
    session: 'London',
    analysisTiming: 'On time',
    timeframes,
    crossedLiquidity: [],
    majorLiquidityWatchlist: '',
    supplyDemandLevels: [],
    openingCandles: [],
    scenarios: [],
    trades: [],
    overallNotes: '',
    visibilityConfig: visibility ? JSON.parse(JSON.stringify(visibility)) : JSON.parse(JSON.stringify(DEFAULT_VISIBILITY_CONFIG)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
