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

export type StructureDirection = 'Bullish' | 'Bearish' | 'Neutral' | 'Waiting' | 'Not sure' | '';
export type FractalDirection = 'Bullish' | 'Bearish' | 'Neutral' | 'Waiting' | '';
export type StructureConfirmation = 'Waiting' | 'Confirmed' | '';

export interface StructureEvent {
  id: string; // e.g. "bos_..." or "mss_..." or "choch_..."
  type: 'BOS' | 'MSS' | 'CHoCH';
  direction: 'Bullish' | 'Bearish';
  brokenLevel: string; // Broken price level
  high: string; // Relevant swing/internal high
  low: string; // Relevant swing/internal low
  timestamp: number;
  affectedStructure?: 'Swing' | 'Internal' | 'Fractal';
  newActiveLevel?: string; // Resulting active Fractal level for CHoCH
  previousSnapshot?: {
    direction: StructureDirection | FractalDirection;
    confirmation?: StructureConfirmation;
    high?: string;
    low?: string;
    brokenLevel?: string;
    fractalLevel?: string;
  };
}

export interface SwingStructure {
  direction: StructureDirection;
  confirmation?: StructureConfirmation;
  high: string;
  low: string;
  bosAt: string;
  history?: StructureEvent[];
}

export interface InternalStructure {
  direction: StructureDirection;
  confirmation?: StructureConfirmation;
  high: string;
  low: string;
  ibosAt: string;
  history?: StructureEvent[];
}

export interface FractalStructure {
  direction: FractalDirection;
  confirmation?: StructureConfirmation;
  fractalBosAt: string;
  history?: StructureEvent[];
}

/**
 * Separates legacy combined direction strings ('Waiting', 'Not sure') into
 * clean Direction + Confirmation without inventing Bullish/Bearish.
 */
export function normalizeStructureDirectionAndConfirmation(
  rawDirection?: string | null,
  rawConfirmation?: string | null
): {
  direction: 'Bullish' | 'Bearish' | 'Neutral' | '';
  confirmation: StructureConfirmation;
} {
  const dir = (rawDirection || '').trim();
  const conf = (rawConfirmation || '').trim();

  const normalizedConf: StructureConfirmation =
    conf === 'Confirmed' || conf === 'Waiting' ? conf : '';

  if (dir === 'Bullish' || dir === 'Bearish' || dir === 'Neutral') {
    return {
      direction: dir,
      confirmation: normalizedConf,
    };
  }
  if (dir === 'Waiting' || dir === 'Not sure') {
    return {
      direction: '',
      confirmation: normalizedConf || 'Waiting',
    };
  }
  // Support any legacy parenthesized forms such as "Bearish (Waiting)" or "Bullish (Confirmed)"
  const dirMatch = dir.match(/\b(Bullish|Bearish|Neutral)\b/i);
  const parsedDir = dirMatch
    ? ((dirMatch[1].charAt(0).toUpperCase() + dirMatch[1].slice(1).toLowerCase()) as
        | 'Bullish'
        | 'Bearish'
        | 'Neutral')
    : '';
  const parsedConf: StructureConfirmation = normalizedConf
    ? normalizedConf
    : /\bwaiting\b/i.test(dir)
    ? 'Waiting'
    : /\bconfirmed\b/i.test(dir)
    ? 'Confirmed'
    : '';
  return {
    direction: parsedDir,
    confirmation: parsedConf,
  };
}

export function normalizeTimeframeStructures(tfData: TimeframeData): TimeframeData {
  const swingNorm = normalizeStructureDirectionAndConfirmation(
    tfData.swing?.direction,
    tfData.swing?.confirmation
  );
  const internalNorm = normalizeStructureDirectionAndConfirmation(
    tfData.internal?.direction,
    tfData.internal?.confirmation
  );
  const fractalNorm = normalizeStructureDirectionAndConfirmation(
    tfData.fractal?.direction,
    tfData.fractal?.confirmation
  );
  return {
    ...tfData,
    swing: {
      ...(tfData.swing || { high: '', low: '', bosAt: '' }),
      direction: swingNorm.direction,
      confirmation: swingNorm.confirmation,
    },
    internal: {
      ...(tfData.internal || { high: '', low: '', ibosAt: '' }),
      direction: internalNorm.direction,
      confirmation: internalNorm.confirmation,
    },
    fractal: {
      ...(tfData.fractal || { fractalBosAt: '' }),
      direction: fractalNorm.direction,
      confirmation: fractalNorm.confirmation,
    },
  };
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
  personalBiasNotes?: string; // Optional user personal bias narrative (Monthly, Weekly, Daily only)
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
  // Previous-period high/low numeric levels (Monthly: PMH/PML, Weekly: PWH/PWL, Daily: PDH/PDL)
  pmh?: string;
  pml?: string;
  pwh?: string;
  pwl?: string;
  pdh?: string;
  pdl?: string;
}

export const HIGHER_BIAS_TIMEFRAMES: ReadonlyArray<TimeframeId> = ['Monthly', 'Weekly', 'Daily'];

export function isHigherPersonalBiasTimeframe(tf: TimeframeId): boolean {
  return tf === 'Monthly' || tf === 'Weekly' || tf === 'Daily';
}

export function getPersonalBiasLabel(tf: TimeframeId): 'My Monthly Bias' | 'My Weekly Bias' | 'My Daily Bias' | null {
  if (tf === 'Monthly') return 'My Monthly Bias';
  if (tf === 'Weekly') return 'My Weekly Bias';
  if (tf === 'Daily') return 'My Daily Bias';
  return null;
}

export type TradingPair = string;

export type InstrumentCategory =
  | 'Forex'
  | 'Commodities'
  | 'Crypto'
  | 'Indices'
  | 'Stocks'
  | 'Custom';

export interface InstrumentConfigItem {
  symbol: string;
  name?: string;
  category: InstrumentCategory;
  enabled: boolean;
  isDefault?: boolean;
  supportsLiveFeed?: boolean;
  createdAt?: number;
}

export interface InstrumentsConfig {
  items: InstrumentConfigItem[];
  updatedAt?: number;
}

export const DEFAULT_INSTRUMENTS: ReadonlyArray<InstrumentConfigItem> = [
  {
    symbol: 'XAUUSD',
    name: 'Gold / US Dollar',
    category: 'Commodities',
    enabled: true,
    isDefault: true,
    supportsLiveFeed: false,
  },
  {
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    category: 'Forex',
    enabled: true,
    isDefault: true,
    supportsLiveFeed: false,
  },
  {
    symbol: 'BTCUSD',
    name: 'Bitcoin / US Dollar',
    category: 'Crypto',
    enabled: true,
    isDefault: true,
    supportsLiveFeed: true,
  },
];

export const DEFAULT_INSTRUMENTS_CONFIG: InstrumentsConfig = {
  items: DEFAULT_INSTRUMENTS.map((item) => ({ ...item })),
};

export function normalizeInstrumentSymbol(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '')
    .replace(/[^A-Z0-9._-]/g, '');
  return cleaned.slice(0, 16);
}

export function validateInstrumentSymbol(raw: string): {
  valid: boolean;
  symbol: string;
  error?: string;
} {
  const symbol = normalizeInstrumentSymbol(raw);
  if (!symbol || symbol.length < 2) {
    return {
      valid: false,
      symbol,
      error: 'Enter an instrument symbol with 2 to 16 alphanumeric characters (e.g. GBPUSD, US30, NAS100, AAPL).',
    };
  }
  if (!/^[A-Z0-9][A-Z0-9._-]{1,15}$/.test(symbol)) {
    return {
      valid: false,
      symbol,
      error: 'Instrument symbol must start with a letter or number and use only A-Z, 0-9, ., -, or _.',
    };
  }
  return { valid: true, symbol };
}

export function normalizeInstrumentsConfig(
  raw?: Partial<InstrumentsConfig> | null
): InstrumentsConfig {
  const incoming = Array.isArray(raw?.items) ? raw.items : [];
  const defaultMap = new Map(DEFAULT_INSTRUMENTS.map((d) => [d.symbol, d]));
  const resultMap = new Map<string, InstrumentConfigItem>();

  // Always preserve default instruments in canonical order
  for (const def of DEFAULT_INSTRUMENTS) {
    const match = incoming.find((item) => normalizeInstrumentSymbol(item?.symbol || '') === def.symbol);
    resultMap.set(def.symbol, {
      symbol: def.symbol,
      name: (match?.name || def.name || '').trim() || undefined,
      category: match?.category || def.category,
      enabled: match ? match.enabled !== false : true,
      isDefault: true,
      supportsLiveFeed: def.symbol === 'BTCUSD',
      createdAt: match?.createdAt,
    });
  }

  // Append custom instruments cleanly, deduplicated by uppercase symbol
  for (const item of incoming) {
    const sym = normalizeInstrumentSymbol(item?.symbol || '');
    if (!sym || sym.length < 2 || defaultMap.has(sym) || resultMap.has(sym)) {
      continue;
    }
    const validCategories: InstrumentCategory[] = [
      'Forex',
      'Commodities',
      'Crypto',
      'Indices',
      'Stocks',
      'Custom',
    ];
    const cat = validCategories.includes(item?.category as InstrumentCategory)
      ? (item.category as InstrumentCategory)
      : 'Custom';
    resultMap.set(sym, {
      symbol: sym,
      name: item?.name ? String(item.name).trim().slice(0, 48) : undefined,
      category: cat,
      enabled: item?.enabled !== false,
      isDefault: false,
      supportsLiveFeed: false,
      createdAt: item?.createdAt || Date.now(),
    });
  }

  const items = Array.from(resultMap.values());
  // Ensure at least one instrument stays enabled across selectors
  if (!items.some((i) => i.enabled)) {
    items[0] = { ...items[0], enabled: true };
  }

  return {
    items,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

export function getEnabledInstrumentSymbols(config?: InstrumentsConfig | null): string[] {
  const normalized = normalizeInstrumentsConfig(config);
  const enabled = normalized.items.filter((i) => i.enabled).map((i) => i.symbol);
  return enabled.length > 0 ? enabled : ['XAUUSD', 'EURUSD', 'BTCUSD'];
}

export function getSelectorInstrumentOptions(
  config?: InstrumentsConfig | null,
  currentOrHistoricalValues: Array<string | undefined | null> = []
): Array<{ symbol: string; label: string; isInactive: boolean }> {
  const normalized = normalizeInstrumentsConfig(config);
  const enabledItems = normalized.items.filter((i) => i.enabled);
  const enabledSet = new Set(enabledItems.map((i) => i.symbol));

  const options = enabledItems.map((i) => ({
    symbol: i.symbol,
    label: i.symbol,
    isInactive: false,
  }));

  const seenExtra = new Set<string>();
  for (const rawVal of currentOrHistoricalValues) {
    const clean = normalizeInstrumentSymbol(rawVal || '');
    if (!clean || enabledSet.has(clean) || seenExtra.has(clean)) continue;
    seenExtra.add(clean);
    options.push({
      symbol: clean,
      label: `${clean} (Disabled / Historical)`,
      isInactive: true,
    });
  }

  return options;
}

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

export interface StrategySnapshot {
  id?: string;
  name: string;
  description?: string;
  setupContext?: string;
  entryRules?: string;
  invalidationConditions?: string;
  riskManagementRules?: string;
  exitRules?: string;
  tags?: string[];
  notes?: string;
  isArchived?: boolean;
  capturedAt: number;
}

export interface TradingStrategy {
  id: string; // e.g. "str_..."
  name: string;
  description?: string;
  setupContext?: string;
  entryRules?: string;
  invalidationConditions?: string;
  riskManagementRules?: string;
  exitRules?: string;
  tags?: string[];
  notes?: string;
  isArchived?: boolean;
  userId?: string;
  createdAt: number;
  updatedAt: number;
}

export function createStrategySnapshot(strategy: TradingStrategy): StrategySnapshot {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    setupContext: strategy.setupContext,
    entryRules: strategy.entryRules,
    invalidationConditions: strategy.invalidationConditions,
    riskManagementRules: strategy.riskManagementRules,
    exitRules: strategy.exitRules,
    tags: strategy.tags ? [...strategy.tags] : undefined,
    notes: strategy.notes,
    isArchived: strategy.isArchived,
    capturedAt: Date.now(),
  };
}

export interface PlannedScenario {
  id: string; // stable UUID or unique id (e.g. scn_...)
  label: string; // "Scenario 1", "Scenario 2", etc.
  strategy: string; // Strategy Used (display name or free-text custom strategy)
  strategyId?: string; // Optional linked TradingStrategy ID
  strategySnapshot?: StrategySnapshot; // Immutable snapshot captured when selected
  direction: 'Buy' | 'Sell' | '';
  description: string; // Scenario Description
  entryConditions: string; // Entry Conditions / Rules
  invalidationConditions: string; // Invalidation Conditions
  images?: ImageAttachment[]; // Attached setup charts / execution zone screenshots
  isSaved?: boolean; // Individual scenario locked / collapsed state
  isInvalid?: boolean; // Mark invalid action flag
  status?: 'Active' | 'Invalid'; // Scenario operational status
  createdAt: number;
  updatedAt: number;
}

export type TradeOutcome = 'Win' | 'Loss' | 'Break-even' | 'Open' | '';
export type SetupValidity = 'Valid' | 'Invalid' | 'Not reviewed';
export type PlannedRRChoice = '1:1' | '1:1.5' | '1:2' | '1:3' | 'Custom';

export interface RecordedTrade {
  id: string; // stable UUID or unique id (e.g. trd_...)
  scenarioId?: string; // linked planned scenario ID (or empty if unlinked)
  scenarioLabel?: string; // display snapshot of scenario label
  strategy?: string; // Strategy Used (either from strategy selector, linked scenario, or custom text)
  strategyId?: string; // Optional linked TradingStrategy ID
  strategySnapshot?: StrategySnapshot; // Immutable snapshot captured at execution/edit time
  scenarioSnapshot?: {
    strategy?: string;
    strategyId?: string;
    strategySnapshot?: StrategySnapshot;
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
  plannedRRChoice?: PlannedRRChoice;
  plannedRRRatio?: string;
  setupValidity?: SetupValidity;
  outcome?: TradeOutcome;
  rulesFollowed?: boolean;
  notes?: string;
  images?: ImageAttachment[]; // Attached execution, entry, exit charts
  date: string; // YYYY-MM-DD
  time?: string;
  closedAt?: number;
  closedDate?: string;
  closedTime?: string;
  linkedJournalIds?: string[];
  sourceReportId?: string;
  sourceReportTitle?: string;
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
  personalBiasNotes?: boolean;
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
  pmh?: boolean;
  pml?: boolean;
  pwh?: boolean;
  pwl?: boolean;
  pdh?: boolean;
  pdl?: boolean;
  timeframeInfoSection?: boolean; // Analysis information top section
  structureTrackingControls?: boolean; // Structure tracking controls (BOS/MSS)
  structureHistory?: boolean; // Structure history
}

export const DEFAULT_DEEP_FIELDS_VISIBILITY: TimeframeDeepFieldsVisibility = {
  overallInterpretation: true,
  personalBiasNotes: true,
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
  pmh: true,
  pml: true,
  pwh: true,
  pwl: true,
  pdh: true,
  pdl: true,
  timeframeInfoSection: true,
  structureTrackingControls: true,
  structureHistory: true,
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
    personalBiasNotes?: boolean;
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
    pmh?: boolean;
    pml?: boolean;
    pwh?: boolean;
    pwl?: boolean;
    pdh?: boolean;
    pdl?: boolean;
    timeframeInfoSection?: boolean;
    structureTrackingControls?: boolean;
    structureHistory?: boolean;
  };
  perTimeframeFields?: Record<TimeframeId, TimeframeDeepFieldsVisibility>;
  otherSections: {
    metadataAndTimestamps?: boolean;
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
    personalBiasNotes: true,
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
    timeframeInfoSection: true,
    structureTrackingControls: true,
    structureHistory: true,
  },
  perTimeframeFields: createDefaultPerTimeframeFields(),
  otherSections: {
    metadataAndTimestamps: true,
    majorLiquidityChecklist: true,
    majorLiquidityWatchlist: true,
    supplyDemandManager: true,
    openingCandle: true,
    overallNotes: true,
    plannedScenarios: true,
  },
};

export interface JournalVisibilityConfig {
  myJournal: boolean; // My Journal / personal notes
  myJournalNotes?: boolean; // Alias for My Journal notes
  dailyPreparation: boolean; // Daily preparation
  preTradeChecklist: boolean; // Pre-trade checklist
  inTradeManagement: boolean; // In-trade management
  postTradeReview: boolean; // Post-trade review
  dailyReflection: boolean; // Daily reflection
  moodReadiness: boolean; // Mood / readiness
  tagsAndLessons: boolean; // Tags and lessons
  linkedAnalysisTrade: boolean; // Linked analysis / trade information
  attachments: boolean; // Attachments / screenshots
  summaryCards: boolean; // Summary statistics cards
}

export const DEFAULT_JOURNAL_VISIBILITY_CONFIG: JournalVisibilityConfig = {
  myJournal: true,
  myJournalNotes: true,
  dailyPreparation: true,
  preTradeChecklist: true,
  inTradeManagement: true,
  postTradeReview: true,
  dailyReflection: true,
  moodReadiness: true,
  tagsAndLessons: true,
  linkedAnalysisTrade: true,
  attachments: true,
  summaryCards: true,
};

export function normalizeJournalVisibilityConfig(
  raw?: Partial<JournalVisibilityConfig> | null
): JournalVisibilityConfig {
  const myJournalVal = (raw?.myJournal === false || raw?.myJournalNotes === false)
    ? false
    : Boolean(raw?.myJournal ?? raw?.myJournalNotes ?? true);

  return {
    myJournal: myJournalVal,
    myJournalNotes: myJournalVal,
    dailyPreparation: raw?.dailyPreparation !== false,
    preTradeChecklist: raw?.preTradeChecklist !== false,
    inTradeManagement: raw?.inTradeManagement !== false,
    postTradeReview: raw?.postTradeReview !== false,
    dailyReflection: raw?.dailyReflection !== false,
    moodReadiness: raw?.moodReadiness !== false,
    tagsAndLessons: raw?.tagsAndLessons !== false,
    linkedAnalysisTrade: raw?.linkedAnalysisTrade !== false,
    attachments: raw?.attachments !== false,
    summaryCards: raw?.summaryCards !== false,
  };
}

export interface PerformanceVisibilityConfig {
  totalsSummary: boolean; // Analysis and trade totals
  activeDays: boolean; // Active-day statistics
  disciplineStats?: boolean; // Rule-compliance statistics
  disciplineCompliance?: boolean; // Rule-compliance statistics (alias)
  reviewCompletion: boolean; // Review completion
  outcomeStats?: boolean; // Outcome statistics
  outcomeDistribution?: boolean; // Outcome statistics (alias)
  activityCalendar: boolean; // Activity chart / calendar
  instrumentBreakdown: boolean; // Instrument breakdown
  sessionBreakdown: boolean; // Session breakdown
  setupBreakdown: boolean; // Setup breakdown
  mistakesAndLessons: boolean; // Mistake / lesson analysis
  metricDefinitions: boolean; // Metric definitions & accuracy invariants
}

export const DEFAULT_PERFORMANCE_VISIBILITY_CONFIG: PerformanceVisibilityConfig = {
  totalsSummary: true,
  activeDays: true,
  disciplineStats: true,
  disciplineCompliance: true,
  reviewCompletion: true,
  outcomeStats: true,
  outcomeDistribution: true,
  activityCalendar: true,
  instrumentBreakdown: true,
  sessionBreakdown: true,
  setupBreakdown: true,
  mistakesAndLessons: true,
  metricDefinitions: true,
};

export function normalizePerformanceVisibilityConfig(
  raw?: Partial<PerformanceVisibilityConfig> | null
): PerformanceVisibilityConfig {
  const disciplineVal = (raw?.disciplineCompliance === false || raw?.disciplineStats === false)
    ? false
    : Boolean(raw?.disciplineCompliance ?? raw?.disciplineStats ?? true);

  const outcomeVal = (raw?.outcomeDistribution === false || raw?.outcomeStats === false)
    ? false
    : Boolean(raw?.outcomeDistribution ?? raw?.outcomeStats ?? true);

  return {
    totalsSummary: raw?.totalsSummary !== false,
    activeDays: raw?.activeDays !== false,
    disciplineStats: disciplineVal,
    disciplineCompliance: disciplineVal,
    reviewCompletion: raw?.reviewCompletion !== false,
    outcomeStats: outcomeVal,
    outcomeDistribution: outcomeVal,
    activityCalendar: raw?.activityCalendar !== false,
    instrumentBreakdown: raw?.instrumentBreakdown !== false,
    sessionBreakdown: raw?.sessionBreakdown !== false,
    setupBreakdown: raw?.setupBreakdown !== false,
    mistakesAndLessons: raw?.mistakesAndLessons !== false,
    metricDefinitions: raw?.metricDefinitions !== false,
  };
}

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
      personalBiasNotes: existing?.personalBiasNotes !== undefined
        ? Boolean(existing.personalBiasNotes)
        : true,
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
      pmh: existing?.pmh !== undefined ? Boolean(existing.pmh) : true,
      pml: existing?.pml !== undefined ? Boolean(existing.pml) : true,
      pwh: existing?.pwh !== undefined ? Boolean(existing.pwh) : true,
      pwl: existing?.pwl !== undefined ? Boolean(existing.pwl) : true,
      pdh: existing?.pdh !== undefined ? Boolean(existing.pdh) : true,
      pdl: existing?.pdl !== undefined ? Boolean(existing.pdl) : true,
      timeframeInfoSection: existing?.timeframeInfoSection !== undefined
        ? Boolean(existing.timeframeInfoSection)
        : (legacyDeep?.timeframeInfoSection !== false),
      structureTrackingControls: existing?.structureTrackingControls !== undefined
        ? Boolean(existing.structureTrackingControls)
        : (legacyDeep?.structureTrackingControls !== false),
      structureHistory: existing?.structureHistory !== undefined
        ? Boolean(existing.structureHistory)
        : (legacyDeep?.structureHistory !== false),
    };
  }

  const otherSections = {
    metadataAndTimestamps: raw?.otherSections?.metadataAndTimestamps !== false,
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
  sourceRevision?: number;
  revision?: number;
  baseCloudRevision?: number;
  lastCloudRevision?: number;
  pendingSaveId?: string;
  templateId?: string;
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
    personalBiasNotes?: boolean;
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
    pmh?: boolean;
    pml?: boolean;
    pwh?: boolean;
    pwl?: boolean;
    pdh?: boolean;
    pdl?: boolean;
    timeframeInfoSection?: boolean;
    structureTrackingControls?: boolean;
    structureHistory?: boolean;
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
    personalBiasNotes: true,
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
    timeframeInfoSection: true,
    structureTrackingControls: true,
    structureHistory: true,
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
      personalBiasNotes: existing?.personalBiasNotes !== undefined
        ? Boolean(existing.personalBiasNotes)
        : true,
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
      pmh: existing?.pmh !== undefined ? Boolean(existing.pmh) : true,
      pml: existing?.pml !== undefined ? Boolean(existing.pml) : true,
      pwh: existing?.pwh !== undefined ? Boolean(existing.pwh) : true,
      pwl: existing?.pwl !== undefined ? Boolean(existing.pwl) : true,
      pdh: existing?.pdh !== undefined ? Boolean(existing.pdh) : true,
      pdl: existing?.pdl !== undefined ? Boolean(existing.pdl) : true,
      timeframeInfoSection: existing?.timeframeInfoSection !== undefined
        ? Boolean(existing.timeframeInfoSection)
        : (legacyFields?.timeframeInfoSection !== false),
      structureTrackingControls: existing?.structureTrackingControls !== undefined
        ? Boolean(existing.structureTrackingControls)
        : (legacyFields?.structureTrackingControls !== false),
      structureHistory: existing?.structureHistory !== undefined
        ? Boolean(existing.structureHistory)
        : (legacyFields?.structureHistory !== false),
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

export type JournalEntryType =
  | 'prep'
  | 'pre_trade'
  | 'in_trade'
  | 'post_trade'
  | 'daily_reflection'
  | 'general'
  | 'no_trade_day'
  | 'pre-trade'
  | 'in-trade'
  | 'post-trade'
  | 'daily-reflection'
  | 'no-trade-day'
  | 'my_journal'
  | 'my-journal';

export type MyJournalContext = 'Before Trading' | 'During Trading' | 'After Trading' | 'General' | 'No-Trade Day';

export const IN_TRADE_MINDSET_PRESETS = [
  'Calm',
  'Focused',
  'Patient',
  'Confident',
  'Anxious',
  'Fearful',
  'Impulsive',
  'Distracted',
  'Overconfident',
  'Frustrated',
] as const;

export const IN_TRADE_OBSERVATION_PRESETS = [
  'Urge to move the stop',
  'Urge to close early',
  'Fear of missing out',
  'Revenge-trading urge',
  'Hesitation',
  'Following the plan',
  'Comfortable with uncertainty',
] as const;

export type EmotionalReadiness = 'Optimal / Calm' | 'Focused' | 'Anxious' | 'Fatigued' | 'Overconfident' | 'Distracted' | '';

export type JournalPhaseKey = 'prep' | 'preTrade' | 'inTrade' | 'postTrade' | 'reflection';

export interface JournalLaunchContext {
  requestId: number;
  targetPhase: JournalPhaseKey;
  mode?: 'create' | 'view_linked';
  filterTradeId?: string;
  linkedReportId?: string;
  linkedReportTitle?: string;
  linkedScenarioId?: string;
  linkedScenarioLabel?: string;
  linkedTradeId?: string;
  pair?: TradingPair;
  session?: TradingSession;
  strategy?: string;
  date?: string;
  time?: string;
  timezone?: string;
  outcome?: string;
  entryIdToEdit?: string;
}

export interface JournalPrep {
  sessionIntention?: string;
  readinessState?: EmotionalReadiness;
  readinessStates?: EmotionalReadiness[];
  prioritizedRules?: string[];
  dailyPlanNotes?: string;
}

export function normalizeReadinessStates(prep?: JournalPrep): EmotionalReadiness[] {
  if (!prep) return [];
  const rawList =
    Array.isArray(prep.readinessStates) && prep.readinessStates.length > 0
      ? prep.readinessStates
      : prep.readinessState
      ? [prep.readinessState]
      : [];
  const deduped: EmotionalReadiness[] = [];
  for (const item of rawList) {
    if (item && !deduped.includes(item) && deduped.length < 3) {
      deduped.push(item);
    }
  }
  return deduped;
}

export interface JournalPreTrade {
  reasonForTrade?: string;
  setupTag?: string;
  confirmationChecklist?: Array<{ item: string; checked: boolean }>;
  plannedRiskR?: string;
  linkedReportId?: string;
  linkedScenarioId?: string;
  linkedScenarioLabel?: string;
  linkedTradeId?: string;
  timezone?: string;
}

export interface JournalInTrade {
  mindsets?: string[];
  mindsetOther?: string;
  managementDecisions?: string;
  planAdjustments?: string;
  emotionalObservationTags?: string[];
  emotionalObservations?: string;
  timelineNotes?: Array<{ timestamp: number; note: string }>;
  screenshotImageIds?: string[];
}

export interface JournalPostTrade {
  tradeId?: string;
  executionReview?: string;
  rulesFollowedStatus?: 'Followed' | 'Broken' | 'Unreviewed';
  followedRules?: 'yes' | 'no' | 'unreviewed' | 'Followed' | 'Broken' | 'Unreviewed';
  outcome?: 'win' | 'loss' | 'breakeven' | 'open' | string;
  mistakeTags?: string[];
  lessonTags?: string[];
  lessonsLearned?: string;
  repeatOrImprove?: string;
}

export interface JournalDailyReflection {
  whatWorked?: string;
  whatDidNot?: string;
  keyLessons?: string;
  nextSessionCommitment?: string;
  noTradesDay?: boolean;
}

export interface JournalEntry {
  id: string; // e.g. "jrn_..."
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  timezone?: string;
  session?: TradingSession;
  pair?: TradingPair;
  entryType: JournalEntryType;
  myJournalContext?: MyJournalContext;
  emotionalState?: EmotionalReadiness;
  tags?: string[];
  notes?: string;
  generalNotes?: string;
  prep?: JournalPrep;
  preTrade?: JournalPreTrade;
  inTrade?: JournalInTrade;
  postTrade?: JournalPostTrade;
  reflection?: JournalDailyReflection;
  images?: ImageAttachment[];
  imageUrl?: string;
  linkedReportId?: string;
  linkedReportTitle?: string;
  linkedScenarioId?: string;
  linkedScenarioLabel?: string;
  linkedTradeId?: string;
  createdAt: number;
  updatedAt: number;
  userId?: string;
}

export interface BackupData {
  version: number;
  exportedAt: string;
  app: 'ABMAX_ANALYSIS';
  reports: SavedReport[];
  templates: SavedTemplate[];
  draft: AnalysisData | null;
  images: ImageAttachment[];
  journalEntries?: JournalEntry[];
  strategies?: TradingStrategy[];
  liveWorkspaces?: LiveWorkspaceData[];
  journalDraft?: any;
  myJournalDraft?: any;
  scopedJournalDrafts?: Record<string, any>;
  scopedMyJournalDrafts?: Record<string, any>;
  scopedStrategyDrafts?: Record<string, Partial<TradingStrategy>>;
  scopedInstrumentsConfigs?: Record<string, InstrumentsConfig>;
  ownership?: {
    exportedByAccountId: string;
    totalJournalEntries: number;
    entryOwners: Record<string, number>;
    scopedDraftAccounts: string[];
    totalStrategies?: number;
    strategyOwners?: Record<string, number>;
    totalLiveWorkspaces?: number;
    liveWorkspaceOwners?: Record<string, number>;
  };
  preferences: {
    theme: 'light' | 'dark' | 'system';
    visibilityConfig?: WorkspaceVisibilityConfig;
    presentationConfig?: ReportPresentationConfig;
    journalVisibilityConfig?: JournalVisibilityConfig;
    performanceVisibilityConfig?: PerformanceVisibilityConfig;
    instrumentsConfig?: InstrumentsConfig;
  };
  workingSessions?: Record<string, unknown>;
}

// ============================================================================
// Live Trading Workspace Types (Local-Only Monitor & Watch Scenarios)
// ============================================================================

export type LiveScenarioStatus =
  | 'Waiting'
  | 'Level reached'
  | 'Awaiting confirmation'
  | 'Confirmed'
  | 'Invalidated'
  | 'Paused'
  | 'Completed';

export const LIVE_SCENARIO_STATUSES: LiveScenarioStatus[] = [
  'Waiting',
  'Level reached',
  'Awaiting confirmation',
  'Confirmed',
  'Invalidated',
  'Paused',
  'Completed',
];

export type LiveConfirmationTimeframe =
  | 'Weekly'
  | 'Daily'
  | '4H'
  | '1H'
  | '15M'
  | '5M'
  | '1M'
  | '';

export interface LiveLevelZone {
  id: string;
  label: string;
  type: 'Supply' | 'Demand' | 'Support' | 'Resistance' | 'Liquidity' | 'Custom';
  price: string;
  zoneLow?: string;
  zoneHigh?: string;
  timeframe?: TimeframeId | '';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveQuoteState {
  mode: 'manual' | 'public_rest';
  provider: string;
  price: number | null;
  priceType: 'last' | 'bid' | 'ask' | 'manual';
  bid?: number | null;
  ask?: number | null;
  providerTimestamp?: number | null;
  timestamp: number | null;
  fetchedAt: number | null;
  status: 'fresh' | 'delayed' | 'stale' | 'disconnected' | 'manual';
  staleThresholdMs: number;
  error?: string;
}

export interface LiveWatchScenario {
  id: string;
  name: string;
  direction: 'Buy' | 'Sell' | '';
  strategyId?: string;
  strategy?: string;
  strategySnapshot?: StrategySnapshot;
  targetZoneOrLevel: string;
  zoneLow?: string;
  zoneHigh?: string;
  triggerConditions: string;
  confirmationType: string;
  confirmationTimeframe?: LiveConfirmationTimeframe;
  requiresCandleClose?: boolean;
  plannedResponse: string;
  invalidationLevel: string;
  priority: 'High' | 'Medium' | 'Low';
  notes: string;
  status: LiveScenarioStatus;
  alertOnZoneTouch: boolean;
  alertOnInvalidation: boolean;
  sourceReportId?: string;
  sourceReportTitle?: string;
  sourceScenarioId?: string;
  sourcePair?: TradingPair;
  sourceLabel?: string;
  lastEvaluatedAt?: number;
  lastTriggeredKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveEventItem {
  id: string;
  title: string;
  scheduledTime: string;
  timezone: string;
  currencyOrInstrument: string;
  impact?: 'High' | 'Medium' | 'Low';
  notes: string;
  status: 'Upcoming' | 'Triggered' | 'Dismissed';
  createdAt: number;
  updatedAt: number;
}

export interface LiveAlertRecord {
  id: string;
  scenarioId?: string;
  eventId?: string;
  dedupeKey: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'alert';
  timestamp: number;
  acknowledged: boolean;
}

export interface LiveInstrumentState {
  pair: string;
  marketConditionSummary: string;
  quote: LiveQuoteState;
  keyLevels: LiveLevelZone[];
  scenarios: LiveWatchScenario[];
  events: LiveEventItem[];
  alerts: LiveAlertRecord[];
  updatedAt: number;
}

export interface LiveWorkspaceData {
  id: string; // e.g. live_workspace_local or live_workspace_<userId>
  ownerScope: string;
  activePair: string;
  instruments: Record<string, LiveInstrumentState>;
  updatedAt: number;
}

export function createEmptyLiveInstrumentState(pair: string): LiveInstrumentState {
  return {
    pair,
    marketConditionSummary: '',
    quote: {
      mode: 'manual',
      provider: 'Manual Observation',
      price: null,
      priceType: 'manual',
      bid: null,
      ask: null,
      timestamp: null,
      fetchedAt: null,
      status: 'manual',
      staleThresholdMs: 60000,
    },
    keyLevels: [],
    scenarios: [],
    events: [],
    alerts: [],
    updatedAt: Date.now(),
  };
}

export function createInitialLiveWorkspace(
  ownerScope: string,
  enabledPairs?: string[]
): LiveWorkspaceData {
  const cleanScope = ownerScope || 'local';
  const seedPairs = Array.from(
    new Set([
      ...(enabledPairs && enabledPairs.length > 0 ? enabledPairs : []),
      'XAUUSD',
      'BTCUSD',
      'EURUSD',
    ])
  );
  const instruments: Record<string, LiveInstrumentState> = {};
  for (const sym of seedPairs) {
    instruments[sym] = createEmptyLiveInstrumentState(sym);
  }
  const initialActive =
    enabledPairs && enabledPairs.length > 0 ? enabledPairs[0] : 'XAUUSD';
  return {
    id: `live_workspace_${cleanScope}`,
    ownerScope: cleanScope,
    activePair: initialActive,
    instruments,
    updatedAt: Date.now(),
  };
}

export function createEmptyTimeframeData(tf: TimeframeId): TimeframeData {
  return {
    timeframe: tf,
    overallBias: '',
    biasSpecific: '',
    ...(isHigherPersonalBiasTimeframe(tf) ? { personalBiasNotes: '' } : {}),
    priceLocation: {
      location: '',
      levelRange: '',
    },
    swing: {
      direction: '',
      confirmation: '',
      high: '',
      low: '',
      bosAt: '',
      history: [],
    },
    internal: {
      direction: '',
      confirmation: '',
      high: '',
      low: '',
      ibosAt: '',
      history: [],
    },
    fractal: {
      direction: '',
      confirmation: '',
      fractalBosAt: '',
      history: [],
    },
    supplyLevels: [],
    demandLevels: [],
    supportLevels: [],
    resistanceLevels: [],
    liquidityLevels: [],
    note: '',
    chartImageId: undefined,
    isSaved: false,
    pmh: '',
    pml: '',
    pwh: '',
    pwl: '',
    pdh: '',
    pdl: '',
  };
}

export function createInitialAnalysisData(pair: TradingPair = 'XAUUSD', visibility?: WorkspaceVisibilityConfig): AnalysisData {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let dateStr = '';
  try {
    dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    dateStr = now.toISOString().slice(0, 10);
  }
  
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
