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

export interface TimeframeDeepFieldsVisibility {
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
  chartAttachments: boolean;
  timeframeImages: boolean;
}

export const DEFAULT_DEEP_FIELDS_VISIBILITY: TimeframeDeepFieldsVisibility = {
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
  chartAttachments: true,
  timeframeImages: true,
};

export function createDefaultPerTimeframeFields(): Record<TimeframeId, TimeframeDeepFieldsVisibility> {
  return {
    Monthly: { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    Weekly: { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    Daily: { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    '4H': { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    '1H': { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    '15M': { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    '5M': { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
    '1M': { ...DEFAULT_DEEP_FIELDS_VISIBILITY },
  };
}

export interface WorkspaceVisibilityConfig {
  timeframes: Record<TimeframeId, boolean>;
  deepSections?: {
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
  perTimeframeFields?: Record<TimeframeId, TimeframeDeepFieldsVisibility>;
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
  perTimeframeFields: createDefaultPerTimeframeFields(),
  otherSections: {
    majorLiquidityChecklist: true,
    majorLiquidityWatchlist: true,
    supplyDemandManager: true,
    openingCandle: true,
    overallNotes: true,
    plannedScenarios: true,
  },
};

export interface NormalizedWorkspaceVisibilityConfig extends WorkspaceVisibilityConfig {
  perTimeframeFields: Record<TimeframeId, TimeframeDeepFieldsVisibility>;
}

export function normalizeWorkspaceVisibilityConfig(
  raw?: Partial<WorkspaceVisibilityConfig> | null
): NormalizedWorkspaceVisibilityConfig {
  const timeframes = { ...DEFAULT_VISIBILITY_CONFIG.timeframes };
  if (raw?.timeframes) {
    for (const tf of TIMEFRAME_ORDER) {
      if (raw.timeframes[tf] !== undefined) {
        timeframes[tf] = Boolean(raw.timeframes[tf]);
      }
    }
  }

  const legacyDeep = raw?.deepSections || DEFAULT_VISIBILITY_CONFIG.deepSections!;
  const perTimeframeFields: Record<TimeframeId, TimeframeDeepFieldsVisibility> = createDefaultPerTimeframeFields();

  for (const tf of TIMEFRAME_ORDER) {
    const existing = raw?.perTimeframeFields?.[tf];
    perTimeframeFields[tf] = {
      overallInterpretation: existing?.overallInterpretation !== undefined
        ? Boolean(existing.overallInterpretation)
        : (legacyDeep?.overallInterpretation !== false),
      priceLocation: existing?.priceLocation !== undefined
        ? Boolean(existing.priceLocation)
        : (legacyDeep?.priceLocation !== false),
      swingStructure: existing?.swingStructure !== undefined
        ? Boolean(existing.swingStructure)
        : (legacyDeep?.swingStructure !== false),
      internalStructure: existing?.internalStructure !== undefined
        ? Boolean(existing.internalStructure)
        : (legacyDeep?.internalStructure !== false),
      fractalStructure: existing?.fractalStructure !== undefined
        ? Boolean(existing.fractalStructure)
        : (legacyDeep?.fractalStructure !== false),
      deepAlignment: existing?.deepAlignment !== undefined
        ? Boolean(existing.deepAlignment)
        : true,
      supplyLevels: existing?.supplyLevels !== undefined
        ? Boolean(existing.supplyLevels)
        : (legacyDeep?.supplyLevels !== false),
      demandLevels: existing?.demandLevels !== undefined
        ? Boolean(existing.demandLevels)
        : (legacyDeep?.demandLevels !== false),
      supportLevels: existing?.supportLevels !== undefined
        ? Boolean(existing.supportLevels)
        : (legacyDeep?.supportLevels !== false),
      resistanceLevels: existing?.resistanceLevels !== undefined
        ? Boolean(existing.resistanceLevels)
        : (legacyDeep?.resistanceLevels !== false),
      liquidityLevels: existing?.liquidityLevels !== undefined
        ? Boolean(existing.liquidityLevels)
        : (legacyDeep?.liquidityLevels !== false),
      timeframeNotes: existing?.timeframeNotes !== undefined
        ? Boolean(existing.timeframeNotes)
        : (legacyDeep?.timeframeNotes !== false),
      chartAttachments: existing?.chartAttachments !== undefined
        ? Boolean(existing.chartAttachments)
        : (existing?.timeframeImages !== undefined
            ? Boolean(existing.timeframeImages)
            : (legacyDeep?.chartAttachments !== false)),
      timeframeImages: existing?.timeframeImages !== undefined
        ? Boolean(existing.timeframeImages)
        : (existing?.chartAttachments !== undefined
            ? Boolean(existing.chartAttachments)
            : (legacyDeep?.chartAttachments !== false)),
    };
  }

  const otherSections = {
    majorLiquidityChecklist: raw?.otherSections?.majorLiquidityChecklist !== false,
    majorLiquidityWatchlist: raw?.otherSections?.majorLiquidityWatchlist !== false,
    supplyDemandManager: raw?.otherSections?.supplyDemandManager !== false,
    openingCandle: raw?.otherSections?.openingCandle !== false,
    overallNotes: raw?.otherSections?.overallNotes !== false,
    plannedScenarios: raw?.otherSections?.plannedScenarios !== false,
  };

  return {
    timeframes,
    deepSections: legacyDeep,
    perTimeframeFields,
    otherSections,
  };
}

export interface AnalysisData {
  id: string; // Report ID or 'draft'
  accountId?: string; // Owning user account UUID or 'local'
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
  timeframeFields?: {
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
    chartAttachments?: boolean;
  };
  perTimeframeFields?: Record<TimeframeId, TimeframeDeepFieldsVisibility>;
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
  perTimeframeFields: createDefaultPerTimeframeFields(),
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

export interface NormalizedReportVisibilityConfig extends ReportVisibilityConfig {
  perTimeframeFields: Record<TimeframeId, TimeframeDeepFieldsVisibility>;
}

export function normalizeReportVisibilityConfig(
  raw?: Partial<ReportVisibilityConfig> | null
): NormalizedReportVisibilityConfig {
  const timeframes = { ...DEFAULT_REPORT_VISIBILITY.timeframes };
  if (raw?.timeframes) {
    for (const tf of TIMEFRAME_ORDER) {
      if (raw.timeframes[tf] !== undefined) {
        timeframes[tf] = Boolean(raw.timeframes[tf]);
      }
    }
  }

  const legacyFields = raw?.timeframeFields || DEFAULT_REPORT_VISIBILITY.timeframeFields!;
  const perTimeframeFields: Record<TimeframeId, TimeframeDeepFieldsVisibility> = createDefaultPerTimeframeFields();

  for (const tf of TIMEFRAME_ORDER) {
    const existing = raw?.perTimeframeFields?.[tf];
    perTimeframeFields[tf] = {
      overallInterpretation: existing?.overallInterpretation !== undefined
        ? Boolean(existing.overallInterpretation)
        : (legacyFields?.overallInterpretation !== false),
      priceLocation: existing?.priceLocation !== undefined
        ? Boolean(existing.priceLocation)
        : (legacyFields?.priceLocation !== false),
      swingStructure: existing?.swingStructure !== undefined
        ? Boolean(existing.swingStructure)
        : (legacyFields?.swingStructure !== false),
      internalStructure: existing?.internalStructure !== undefined
        ? Boolean(existing.internalStructure)
        : (legacyFields?.internalStructure !== false),
      fractalStructure: existing?.fractalStructure !== undefined
        ? Boolean(existing.fractalStructure)
        : (legacyFields?.fractalStructure !== false),
      deepAlignment: existing?.deepAlignment !== undefined
        ? Boolean(existing.deepAlignment)
        : (legacyFields?.deepAlignment !== false),
      supplyLevels: existing?.supplyLevels !== undefined
        ? Boolean(existing.supplyLevels)
        : (legacyFields?.supplyLevels !== false),
      demandLevels: existing?.demandLevels !== undefined
        ? Boolean(existing.demandLevels)
        : (legacyFields?.demandLevels !== false),
      supportLevels: existing?.supportLevels !== undefined
        ? Boolean(existing.supportLevels)
        : (legacyFields?.supportLevels !== false),
      resistanceLevels: existing?.resistanceLevels !== undefined
        ? Boolean(existing.resistanceLevels)
        : (legacyFields?.resistanceLevels !== false),
      liquidityLevels: existing?.liquidityLevels !== undefined
        ? Boolean(existing.liquidityLevels)
        : (legacyFields?.liquidityLevels !== false),
      timeframeNotes: existing?.timeframeNotes !== undefined
        ? Boolean(existing.timeframeNotes)
        : (legacyFields?.timeframeNotes !== false),
      chartAttachments: existing?.chartAttachments !== undefined
        ? Boolean(existing.chartAttachments)
        : (existing?.timeframeImages !== undefined
            ? Boolean(existing.timeframeImages)
            : (legacyFields?.timeframeImages !== false)),
      timeframeImages: existing?.timeframeImages !== undefined
        ? Boolean(existing.timeframeImages)
        : (existing?.chartAttachments !== undefined
            ? Boolean(existing.chartAttachments)
            : (legacyFields?.timeframeImages !== false)),
    };
  }

  const general = {
    metadataAndTimestamps: raw?.general?.metadataAndTimestamps !== false,
    overallAlignment: raw?.general?.overallAlignment !== false,
    majorLiquidityChecklist: raw?.general?.majorLiquidityChecklist !== false,
    majorLiquidityWatchlist: raw?.general?.majorLiquidityWatchlist !== false,
  };

  const notesAndLevels = {
    openingCandleLevels: raw?.notesAndLevels?.openingCandleLevels !== false,
    generalSupplyDemand: raw?.notesAndLevels?.generalSupplyDemand !== false,
    overallNotes: raw?.notesAndLevels?.overallNotes !== false,
    matchingValues: raw?.notesAndLevels?.matchingValues !== false,
  };

  const scenariosAndTrades = {
    plannedScenarios: raw?.scenariosAndTrades?.plannedScenarios !== false,
    scenarioImages: raw?.scenariosAndTrades?.scenarioImages !== false,
    tradesTaken: raw?.scenariosAndTrades?.tradesTaken !== false,
    tradeImages: raw?.scenariosAndTrades?.tradeImages !== false,
  };

  return {
    general,
    timeframes,
    timeframeFields: legacyFields,
    perTimeframeFields,
    notesAndLevels,
    scenariosAndTrades,
  };
}

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
  workingSessions?: Record<string, unknown>;
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
