import {
  DEFAULT_TRADING_PAIRS,
  INSTRUMENT_CATEGORIES,
  InstrumentCategory,
  InstrumentDefinition,
  JournalEntry,
  LiveWorkspaceData,
  SavedReport,
  SavedTemplate,
  VerifiedFeedProvider,
} from '../types/journal';

export const DEFAULT_INSTRUMENTS: ReadonlyArray<InstrumentDefinition> = [
  {
    id: 'inst_default_xauusd',
    symbol: 'XAUUSD',
    displayName: 'Gold / US Dollar',
    category: 'Metals',
    quoteCurrency: 'USD',
    precision: 2,
    enabled: true,
    archived: false,
    sortOrder: 0,
    isDefault: true,
    verifiedFeedProvider: 'none',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'inst_default_eurusd',
    symbol: 'EURUSD',
    displayName: 'Euro / US Dollar',
    category: 'Forex',
    quoteCurrency: 'USD',
    precision: 5,
    enabled: true,
    archived: false,
    sortOrder: 1,
    isDefault: true,
    verifiedFeedProvider: 'none',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'inst_default_btcusd',
    symbol: 'BTCUSD',
    displayName: 'Bitcoin / US Dollar',
    category: 'Crypto',
    quoteCurrency: 'USD',
    precision: 2,
    enabled: true,
    archived: false,
    sortOrder: 2,
    isDefault: true,
    verifiedFeedProvider: 'coinbase_btc_usd',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

export function createDefaultInstruments(): InstrumentDefinition[] {
  return DEFAULT_INSTRUMENTS.map((item) => ({ ...item }));
}

export function normalizeInstrumentSymbol(raw: string): string {
  return (raw || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeOptionalText(raw?: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeExchangeKey(raw?: string): string {
  return (raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function computeCompositeInstrumentKey(symbol: string, exchangeOrBroker?: string): string {
  return `${normalizeInstrumentSymbol(symbol)}::${normalizeExchangeKey(exchangeOrBroker)}`;
}

export function normalizeInstrumentList(rawList?: unknown): InstrumentDefinition[] {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return createDefaultInstruments();
  }

  const seenIds = new Set<string>();
  const cleaned: InstrumentDefinition[] = [];

  rawList.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Partial<InstrumentDefinition>;
    const symbol = normalizeInstrumentSymbol(item.symbol || '');
    if (!symbol) return;

    const id =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id.trim()
        : `inst_custom_${idx}_${symbol.replace(/[^A-Z0-9]/g, '')}`;

    if (seenIds.has(id)) return;
    seenIds.add(id);

    const category: InstrumentCategory = INSTRUMENT_CATEGORIES.includes(
      item.category as InstrumentCategory
    )
      ? (item.category as InstrumentCategory)
      : 'Other';

    const precision =
      typeof item.precision === 'number' &&
      Number.isInteger(item.precision) &&
      item.precision >= 0 &&
      item.precision <= 8
        ? item.precision
        : undefined;

    const isDefault =
      Boolean(item.isDefault) ||
      id === 'inst_default_xauusd' ||
      id === 'inst_default_eurusd' ||
      id === 'inst_default_btcusd';

    const verifiedFeedProvider: VerifiedFeedProvider =
      item.verifiedFeedProvider === 'coinbase_btc_usd' ||
      id === 'inst_default_btcusd'
        ? 'coinbase_btc_usd'
        : 'none';

    cleaned.push({
      id,
      symbol,
      displayName: (item.displayName || symbol).trim().replace(/\s+/g, ' '),
      category,
      exchangeOrBroker: normalizeOptionalText(item.exchangeOrBroker),
      quoteCurrency: normalizeOptionalText(item.quoteCurrency)?.toUpperCase(),
      precision,
      enabled: item.enabled !== false && item.archived !== true,
      archived: item.archived === true,
      sortOrder: typeof item.sortOrder === 'number' && Number.isFinite(item.sortOrder) ? item.sortOrder : idx,
      isDefault,
      verifiedFeedProvider,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    });
  });

  if (cleaned.length === 0) {
    return createDefaultInstruments();
  }

  return sortInstruments(cleaned);
}

export function sortInstruments(list: InstrumentDefinition[]): InstrumentDefinition[] {
  return [...list]
    .sort((a, b) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.createdAt - b.createdAt;
    })
    .map((item, idx) => ({ ...item, sortOrder: idx }));
}

export interface InstrumentDraftInput {
  symbol: string;
  displayName: string;
  category: InstrumentCategory;
  exchangeOrBroker?: string;
  quoteCurrency?: string;
  precision?: number | string | null;
}

export interface InstrumentValidationResult {
  valid: boolean;
  error?: string;
  normalized?: {
    symbol: string;
    displayName: string;
    category: InstrumentCategory;
    exchangeOrBroker?: string;
    quoteCurrency?: string;
    precision?: number;
  };
}

export function validateInstrumentInput(
  input: InstrumentDraftInput,
  existingList: InstrumentDefinition[],
  excludeId?: string
): InstrumentValidationResult {
  const symbol = normalizeInstrumentSymbol(input.symbol);
  if (!symbol) {
    return { valid: false, error: 'Symbol is required (e.g., GBPUSD, NAS100, AAPL).' };
  }
  if (symbol.length > 24) {
    return { valid: false, error: 'Symbol must be 24 characters or fewer.' };
  }

  const displayName = (input.displayName || '').trim().replace(/\s+/g, ' ');
  if (!displayName) {
    return { valid: false, error: 'Display name is required (e.g., British Pound / US Dollar).' };
  }

  const category = input.category;
  if (!INSTRUMENT_CATEGORIES.includes(category)) {
    return { valid: false, error: 'Select a valid instrument category.' };
  }

  let precision: number | undefined;
  if (input.precision !== undefined && input.precision !== null && String(input.precision).trim() !== '') {
    const parsed = Number(String(input.precision).trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) {
      return { valid: false, error: 'Price decimal precision must be an integer between 0 and 8.' };
    }
    precision = parsed;
  }

  const exchangeOrBroker = normalizeOptionalText(input.exchangeOrBroker);
  const quoteCurrency = normalizeOptionalText(input.quoteCurrency)?.toUpperCase();

  const candidateCompositeKey = computeCompositeInstrumentKey(symbol, exchangeOrBroker);
  const duplicate = existingList.find(
    (item) =>
      item.id !== excludeId &&
      computeCompositeInstrumentKey(item.symbol, item.exchangeOrBroker) === candidateCompositeKey
  );

  if (duplicate) {
    const exchangeDesc = exchangeOrBroker ? ` (${exchangeOrBroker})` : '';
    if (duplicate.archived) {
      return {
        valid: false,
        error: `${symbol}${exchangeDesc} already exists in Archived instruments. Unarchive or update the existing record instead.`,
      };
    }
    return {
      valid: false,
      error: `${symbol}${exchangeDesc} already exists in your instruments list. Specify a distinct Exchange/Broker if tracking a different venue or product.`,
    };
  }

  return {
    valid: true,
    normalized: {
      symbol,
      displayName,
      category,
      exchangeOrBroker,
      quoteCurrency,
      precision,
    },
  };
}

export function addCustomInstrument(
  existingList: InstrumentDefinition[],
  input: InstrumentDraftInput
): { list: InstrumentDefinition[]; added?: InstrumentDefinition; error?: string } {
  const check = validateInstrumentInput(input, existingList);
  if (!check.valid || !check.normalized) {
    return { list: existingList, error: check.error };
  }

  const now = Date.now();
  const safeSym = check.normalized.symbol.replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'INST';
  const maxSortOrder = existingList.reduce((max, item) => Math.max(max, item.sortOrder), -1);

  const newInstrument: InstrumentDefinition = {
    id: `inst_custom_${safeSym}_${now}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: check.normalized.symbol,
    displayName: check.normalized.displayName,
    category: check.normalized.category,
    exchangeOrBroker: check.normalized.exchangeOrBroker,
    quoteCurrency: check.normalized.quoteCurrency,
    precision: check.normalized.precision,
    enabled: true,
    archived: false,
    sortOrder: maxSortOrder + 1,
    isDefault: false,
    verifiedFeedProvider: 'none',
    createdAt: now,
    updatedAt: now,
  };

  return {
    list: sortInstruments([...existingList, newInstrument]),
    added: newInstrument,
  };
}

export function updateInstrumentDefinition(
  existingList: InstrumentDefinition[],
  id: string,
  input: InstrumentDraftInput
): { list: InstrumentDefinition[]; updated?: InstrumentDefinition; error?: string } {
  const target = existingList.find((item) => item.id === id);
  if (!target) {
    return { list: existingList, error: 'Instrument not found.' };
  }

  const check = validateInstrumentInput(input, existingList, id);
  if (!check.valid || !check.normalized) {
    return { list: existingList, error: check.error };
  }

  // Default instruments keep their verified canonical symbol & ID so Live/history remain invariant
  const nextSymbol = target.isDefault ? target.symbol : check.normalized.symbol;
  const now = Date.now();

  const updated: InstrumentDefinition = {
    ...target,
    symbol: nextSymbol,
    displayName: check.normalized.displayName,
    category: check.normalized.category,
    exchangeOrBroker: check.normalized.exchangeOrBroker,
    quoteCurrency: check.normalized.quoteCurrency,
    precision: check.normalized.precision,
    updatedAt: now,
  };

  return {
    list: sortInstruments(existingList.map((item) => (item.id === id ? updated : item))),
    updated,
  };
}

export function toggleInstrumentEnabled(
  existingList: InstrumentDefinition[],
  id: string
): InstrumentDefinition[] {
  const now = Date.now();
  return sortInstruments(
    existingList.map((item) => {
      if (item.id !== id) return item;
      const nextEnabled = !item.enabled;
      return {
        ...item,
        enabled: nextEnabled,
        archived: nextEnabled ? false : item.archived,
        updatedAt: now,
      };
    })
  );
}

export function moveInstrumentOrder(
  existingList: InstrumentDefinition[],
  id: string,
  direction: 'up' | 'down'
): InstrumentDefinition[] {
  const sorted = sortInstruments(existingList);
  const active = sorted.filter((i) => !i.archived);
  const archived = sorted.filter((i) => i.archived);
  const idx = active.findIndex((i) => i.id === id);
  if (idx === -1) return sorted;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= active.length) return sorted;

  const copy = [...active];
  const temp = copy[idx];
  copy[idx] = copy[swapIdx];
  copy[swapIdx] = temp;

  const now = Date.now();
  const reordered = [...copy, ...archived].map((item, i) => ({
    ...item,
    sortOrder: i,
    updatedAt: item.id === id ? now : item.updatedAt,
  }));

  return reordered;
}

export function archiveInstrument(
  existingList: InstrumentDefinition[],
  id: string
): InstrumentDefinition[] {
  const now = Date.now();
  return sortInstruments(
    existingList.map((item) =>
      item.id === id ? { ...item, archived: true, enabled: false, updatedAt: now } : item
    )
  );
}

export function unarchiveInstrument(
  existingList: InstrumentDefinition[],
  id: string
): InstrumentDefinition[] {
  const now = Date.now();
  return sortInstruments(
    existingList.map((item) =>
      item.id === id ? { ...item, archived: false, enabled: true, updatedAt: now } : item
    )
  );
}

export function isInstrumentReferencedInHistory(
  symbol: string,
  context: {
    reports?: SavedReport[];
    templates?: SavedTemplate[];
    journalEntries?: JournalEntry[];
    liveWorkspaces?: LiveWorkspaceData[];
  }
): boolean {
  const norm = normalizeInstrumentSymbol(symbol);
  if (!norm) return false;

  for (const r of context.reports || []) {
    if (normalizeInstrumentSymbol(r.pair || '') === norm) return true;
    for (const t of r.trades || []) {
      if (normalizeInstrumentSymbol(t.pair || '') === norm) return true;
    }
  }
  for (const tmpl of context.templates || []) {
    if (normalizeInstrumentSymbol(tmpl.data?.pair || '') === norm) return true;
  }
  for (const j of context.journalEntries || []) {
    if (normalizeInstrumentSymbol(j.pair || '') === norm) return true;
  }
  for (const lw of context.liveWorkspaces || []) {
    const inst = lw.instruments?.[norm];
    if (
      inst &&
      (inst.scenarios.length > 0 ||
        inst.keyLevels.length > 0 ||
        inst.events.length > 0 ||
        inst.alerts.length > 0 ||
        inst.marketConditionSummary.trim().length > 0 ||
        inst.quote.price !== null)
    ) {
      return true;
    }
  }
  return false;
}

export function removeOrArchiveInstrument(
  existingList: InstrumentDefinition[],
  id: string,
  context: {
    reports?: SavedReport[];
    templates?: SavedTemplate[];
    journalEntries?: JournalEntry[];
    liveWorkspaces?: LiveWorkspaceData[];
  }
): { list: InstrumentDefinition[]; action: 'archived' | 'deleted' | 'blocked'; reason?: string } {
  const target = existingList.find((i) => i.id === id);
  if (!target) return { list: existingList, action: 'blocked', reason: 'Instrument not found.' };

  if (target.isDefault) {
    return {
      list: archiveInstrument(existingList, id),
      action: 'archived',
      reason: 'Default instruments are archived rather than permanently removed and can be restored anytime.',
    };
  }

  const referenced = isInstrumentReferencedInHistory(target.symbol, context);
  if (referenced) {
    return {
      list: archiveInstrument(existingList, id),
      action: 'archived',
      reason: `${target.symbol} has existing records in your history and was safely archived to preserve those labels.`,
    };
  }

  return {
    list: sortInstruments(existingList.filter((i) => i.id !== id)),
    action: 'deleted',
  };
}

/**
 * Restores default instruments (XAUUSD, EURUSD, BTCUSD) to enabled/unarchived state
 * without removing custom user instruments or modifying any historical records.
 */
export function restoreDefaultInstruments(
  existingList: InstrumentDefinition[]
): InstrumentDefinition[] {
  const now = Date.now();
  const defaults = createDefaultInstruments();
  const byId = new Map(existingList.map((item) => [item.id, item]));

  for (const def of defaults) {
    const cur = byId.get(def.id);
    if (cur) {
      byId.set(def.id, {
        ...def,
        displayName: cur.displayName || def.displayName,
        enabled: true,
        archived: false,
        updatedAt: now,
      });
    } else {
      byId.set(def.id, { ...def, updatedAt: now });
    }
  }

  // Keep defaults first cleanly, preserve custom order right after
  const defaultIds = new Set(defaults.map((d) => d.id));
  const restoredDefaults = defaults.map((d, idx) => ({
    ...(byId.get(d.id) || d),
    sortOrder: idx,
  }));
  const customOnly = existingList
    .filter((item) => !defaultIds.has(item.id))
    .map((item, idx) => ({
      ...item,
      sortOrder: restoredDefaults.length + idx,
    }));

  return [...restoredDefaults, ...customOnly];
}

/**
 * Merges incoming instrument registries strictly by immutable ID, never silently
 * collapsing distinct products that share a display name or symbol on another venue.
 */
export function mergeInstrumentRegistriesById(
  existing: InstrumentDefinition[],
  incoming: InstrumentDefinition[]
): InstrumentDefinition[] {
  const merged = new Map<string, InstrumentDefinition>();
  for (const item of normalizeInstrumentList(existing)) {
    merged.set(item.id, item);
  }
  for (const inc of normalizeInstrumentList(incoming)) {
    const prev = merged.get(inc.id);
    if (!prev || (inc.updatedAt || 0) > (prev.updatedAt || 0)) {
      merged.set(inc.id, inc);
    }
  }
  return sortInstruments(Array.from(merged.values()));
}

export interface InstrumentOptionItem {
  symbol: string;
  label: string;
  category?: InstrumentCategory;
  exchangeOrBroker?: string;
  isArchived?: boolean;
  isDisabled?: boolean;
  isHistoricalOnly?: boolean;
}

export function buildEditorInstrumentOptions(
  registry: InstrumentDefinition[],
  currentSelectedPair?: string
): InstrumentOptionItem[] {
  const sorted = sortInstruments(registry);
  const enabled = sorted.filter((i) => i.enabled && !i.archived);

  const options: InstrumentOptionItem[] = enabled.map((inst) => ({
    symbol: inst.symbol,
    label: inst.displayName && inst.displayName !== inst.symbol
      ? `${inst.symbol} — ${inst.displayName}${inst.exchangeOrBroker ? ` (${inst.exchangeOrBroker})` : ''}`
      : inst.symbol,
    category: inst.category,
    exchangeOrBroker: inst.exchangeOrBroker,
  }));

  const currentNorm = normalizeInstrumentSymbol(currentSelectedPair || '');
  if (currentNorm && !options.some((o) => normalizeInstrumentSymbol(o.symbol) === currentNorm)) {
    const matchedInReg = sorted.find((i) => normalizeInstrumentSymbol(i.symbol) === currentNorm);
    if (matchedInReg) {
      options.push({
        symbol: matchedInReg.symbol,
        label: matchedInReg.archived
          ? `${matchedInReg.symbol} — ${matchedInReg.displayName} (Archived)`
          : `${matchedInReg.symbol} — ${matchedInReg.displayName} (Disabled)`,
        category: matchedInReg.category,
        exchangeOrBroker: matchedInReg.exchangeOrBroker,
        isArchived: matchedInReg.archived,
        isDisabled: !matchedInReg.enabled,
      });
    } else {
      options.push({
        symbol: currentNorm,
        label: `${currentNorm} (Historical)`,
        isHistoricalOnly: true,
      });
    }
  }

  return options;
}

export function buildFilterInstrumentOptions(
  registry: InstrumentDefinition[],
  historicalPairs: Array<string | undefined | null>
): InstrumentOptionItem[] {
  const sorted = sortInstruments(registry);
  const enabled = sorted.filter((i) => i.enabled && !i.archived);
  const options: InstrumentOptionItem[] = [];
  const seenSymbols = new Set<string>();

  for (const inst of enabled) {
    const norm = normalizeInstrumentSymbol(inst.symbol);
    if (seenSymbols.has(norm)) continue;
    seenSymbols.add(norm);
    options.push({
      symbol: inst.symbol,
      label: inst.symbol,
      category: inst.category,
    });
  }

  const extras: InstrumentOptionItem[] = [];
  for (const rawPair of historicalPairs) {
    const norm = normalizeInstrumentSymbol(rawPair || '');
    if (!norm || seenSymbols.has(norm)) continue;
    seenSymbols.add(norm);
    const inReg = sorted.find((i) => normalizeInstrumentSymbol(i.symbol) === norm);
    extras.push({
      symbol: norm,
      label: inReg?.archived
        ? `${norm} (Archived)`
        : inReg && !inReg.enabled
        ? `${norm} (Disabled)`
        : `${norm} (Historical)`,
      isArchived: inReg?.archived,
      isDisabled: inReg ? !inReg.enabled : false,
      isHistoricalOnly: !inReg,
    });
  }

  extras.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return [...options, ...extras];
}

export function getDefaultPrimaryPair(registry: InstrumentDefinition[]): string {
  const enabled = sortInstruments(registry).filter((i) => i.enabled && !i.archived);
  return enabled[0]?.symbol || DEFAULT_TRADING_PAIRS[0];
}

export interface VerifiedFeedDescriptor {
  supported: boolean;
  providerId: VerifiedFeedProvider;
  providerLabel: string;
  disclaimer: string;
}

/**
 * Resolves live market feed availability strictly without fabricating prices
 * or guessing broker symbol mappings for unmapped custom instruments.
 */
export function getVerifiedFeedForInstrument(
  instrumentOrSymbol: InstrumentDefinition | string | undefined | null
): VerifiedFeedDescriptor {
  if (!instrumentOrSymbol) {
    return {
      supported: false,
      providerId: 'none',
      providerLabel: 'Manual observation only',
      disclaimer: 'Live feed not connected. Record manual price observations below.',
    };
  }

  if (typeof instrumentOrSymbol === 'string') {
    const norm = normalizeInstrumentSymbol(instrumentOrSymbol);
    if (norm === 'BTCUSD') {
      return {
        supported: true,
        providerId: 'coinbase_btc_usd',
        providerLabel: 'Coinbase BTC-USD',
        disclaimer:
          'Source: Coinbase BTC-USD spot price (last spot quote; not Exness bid/ask). Timestamp shows provider time when supplied or device retrieval time.',
      };
    }
    return {
      supported: false,
      providerId: 'none',
      providerLabel: 'Manual observation only',
      disclaimer: `Live feed not connected for ${norm}. This instrument is configured for analysis and manual price tracking only.`,
    };
  }

  const isVerifiedCoinbase =
    instrumentOrSymbol.verifiedFeedProvider === 'coinbase_btc_usd' ||
    (instrumentOrSymbol.id === 'inst_default_btcusd' &&
      normalizeInstrumentSymbol(instrumentOrSymbol.symbol) === 'BTCUSD');

  if (isVerifiedCoinbase) {
    return {
      supported: true,
      providerId: 'coinbase_btc_usd',
      providerLabel: 'Coinbase BTC-USD',
      disclaimer:
        'Source: Coinbase BTC-USD spot price (last spot quote; not Exness bid/ask). Timestamp shows provider time when supplied or device retrieval time.',
    };
  }

  return {
    supported: false,
    providerId: 'none',
    providerLabel: 'Manual observation only',
    disclaimer: `Live feed not connected for ${instrumentOrSymbol.symbol}. Custom instruments and assets without a verified feed support analysis and manual price observations only.`,
  };
}
