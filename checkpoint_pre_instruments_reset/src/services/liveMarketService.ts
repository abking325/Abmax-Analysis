import {
  LiveAlertRecord,
  LiveInstrumentState,
  LiveQuoteState,
  LiveScenarioStatus,
  LiveWatchScenario,
  LiveWorkspaceData,
  PlannedScenario,
  TradingPair,
} from '../types/journal';
import { deepClone } from '../utils/analysisUtils';
import { getLiveWorkspace, saveLiveWorkspace } from './db';

/**
 * Checks whether a quote is stale or unavailable for automatic trigger evaluation.
 */
export function isQuoteStale(quote: LiveQuoteState, now: number = Date.now()): boolean {
  if (!quote || quote.price === null || !Number.isFinite(quote.price)) return true;
  if (quote.status === 'stale' || quote.status === 'disconnected') return true;
  const threshold = quote.staleThresholdMs > 0 ? quote.staleThresholdMs : 60000;
  if (quote.mode === 'public_rest') {
    const refTime = quote.fetchedAt ?? quote.timestamp;
    if (!refTime) return true;
    return now - refTime > threshold;
  }
  // Manual observation quotes rely on explicit user observation timestamp if set
  if (quote.mode === 'manual' && quote.timestamp) {
    // Manual entries remain valid for explicit observation unless aged past 24h or marked stale
    return now - quote.timestamp > 24 * 60 * 60 * 1000;
  }
  return quote.status !== 'manual';
}

/**
 * Parses a zone string like "2650 - 2660" or "2655.50" into [low, high].
 */
export function parseNumericZone(
  targetZoneOrLevel: string,
  zoneLow?: string,
  zoneHigh?: string
): { low: number; high: number; isRange: boolean } | null {
  const lowNum = zoneLow !== undefined && zoneLow.trim() !== '' ? Number(zoneLow.replace(/,/g, '').trim()) : NaN;
  const highNum = zoneHigh !== undefined && zoneHigh.trim() !== '' ? Number(zoneHigh.replace(/,/g, '').trim()) : NaN;
  if (Number.isFinite(lowNum) && Number.isFinite(highNum)) {
    return {
      low: Math.min(lowNum, highNum),
      high: Math.max(lowNum, highNum),
      isRange: Math.min(lowNum, highNum) !== Math.max(lowNum, highNum),
    };
  }

  const raw = (targetZoneOrLevel || '').replace(/,/g, '').trim();
  if (!raw) return null;

  const rangeMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/i);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { low: Math.min(a, b), high: Math.max(a, b), isRange: Math.min(a, b) !== Math.max(a, b) };
    }
  }

  const single = Number(raw);
  if (Number.isFinite(single)) {
    return { low: single, high: single, isRange: false };
  }
  return null;
}

/**
 * Evaluates numeric price/zone intersection & invalidation rules strictly and honestly.
 * - Never triggers when quote is missing, disconnected, or stale.
 * - Reaching a zone moves status to 'Level reached' (or 'Awaiting confirmation' if discretionary confirmation required),
 *   NEVER auto-confirming discretionary BOS/MSS/sweep/candle-close conditions.
 * - Deduplicates alerts cleanly via dedupeKey so repeated quotes never spam duplicate alerts.
 */
export function evaluateLiveScenarioConditions(
  scenarios: LiveWatchScenario[],
  quote: LiveQuoteState,
  existingAlerts: LiveAlertRecord[] = [],
  now: number = Date.now()
): {
  updatedScenarios: LiveWatchScenario[];
  newAlerts: LiveAlertRecord[];
  changed: boolean;
} {
  if (!scenarios || scenarios.length === 0) {
    return { updatedScenarios: scenarios, newAlerts: [], changed: false };
  }

  if (isQuoteStale(quote, now) || quote.price === null || !Number.isFinite(quote.price)) {
    return { updatedScenarios: scenarios, newAlerts: [], changed: false };
  }

  const price = quote.price;
  const existingKeys = new Set(existingAlerts.map((a) => a.dedupeKey));
  const newAlerts: LiveAlertRecord[] = [];
  let changed = false;

  const updatedScenarios = scenarios.map((scn) => {
    if (
      scn.status === 'Paused' ||
      scn.status === 'Completed' ||
      scn.status === 'Invalidated' ||
      scn.status === 'Confirmed'
    ) {
      return scn;
    }

    // 1. Check Invalidation Price first (if numeric)
    const invRaw = (scn.invalidationLevel || '').replace(/,/g, '').trim();
    const invNum = invRaw && /^-?\d+(?:\.\d+)?$/.test(invRaw) ? Number(invRaw) : NaN;
    if (Number.isFinite(invNum)) {
      const invalidated =
        scn.direction === 'Buy'
          ? price <= invNum
          : scn.direction === 'Sell'
          ? price >= invNum
          : false;

      if (invalidated) {
        const dedupeKey = `inv_${scn.id}_${invRaw}`;
        changed = true;
        if (scn.alertOnInvalidation && !existingKeys.has(dedupeKey) && scn.lastTriggeredKey !== dedupeKey) {
          existingKeys.add(dedupeKey);
          newAlerts.push({
            id: `lalert_${now}_${Math.random().toString(36).slice(2, 7)}`,
            scenarioId: scn.id,
            dedupeKey,
            title: `Invalidation Reached: ${scn.name}`,
            message: `Observed price ${price} reached invalidation level ${invRaw}.`,
            severity: 'warning',
            timestamp: now,
            acknowledged: false,
          });
        }
        return {
          ...scn,
          status: 'Invalidated' as const,
          lastEvaluatedAt: now,
          lastTriggeredKey: dedupeKey,
          updatedAt: now,
        };
      }
    }

    // 2. Check Target Zone / Level Intersection (Wait -> Level reached / Awaiting confirmation)
    const parsedZone = parseNumericZone(scn.targetZoneOrLevel, scn.zoneLow, scn.zoneHigh);
    if (parsedZone) {
      const tolerance = parsedZone.isRange ? 0 : Math.max(Math.abs(parsedZone.low) * 0.00015, 0.0001);
      const touched =
        price >= parsedZone.low - tolerance && price <= parsedZone.high + tolerance;

      if (touched && scn.status === 'Waiting') {
        const requiresDiscretionaryConfirm = Boolean(
          scn.requiresCandleClose ||
            (scn.confirmationType && scn.confirmationType.trim().length > 0) ||
            (scn.confirmationTimeframe && scn.confirmationTimeframe.trim().length > 0)
        );
        const nextStatus: LiveScenarioStatus = 'Level reached';
        const dedupeKey = `zone_${scn.id}_${parsedZone.low}_${parsedZone.high}`;
        changed = true;

        if (scn.alertOnZoneTouch && !existingKeys.has(dedupeKey) && scn.lastTriggeredKey !== dedupeKey) {
          existingKeys.add(dedupeKey);
          newAlerts.push({
            id: `lalert_${now}_${Math.random().toString(36).slice(2, 7)}`,
            scenarioId: scn.id,
            dedupeKey,
            title: `Zone Reached: ${scn.name}`,
            message: requiresDiscretionaryConfirm
              ? `Price ${price} entered ${scn.targetZoneOrLevel || `${parsedZone.low}-${parsedZone.high}`}. Awaiting manual confirmation (${[scn.confirmationType, scn.confirmationTimeframe].filter(Boolean).join(' • ') || 'discretionary'}).`
              : `Price ${price} reached target ${scn.targetZoneOrLevel || `${parsedZone.low}`}. Review planned response manually.`,
            severity: 'alert',
            timestamp: now,
            acknowledged: false,
          });
        }

        return {
          ...scn,
          status: nextStatus,
          lastEvaluatedAt: now,
          lastTriggeredKey: dedupeKey,
          updatedAt: now,
        };
      }
    }

    return scn;
  });

  return { updatedScenarios, newAlerts, changed };
}

/**
 * Fetches an honest public quote when a real CORS-capable public endpoint is available.
 * - Currently supports BTCUSD via Coinbase Public Spot API (https://api.coinbase.com/v2/prices/BTC-USD/spot).
 * - Does NOT fabricate or simulate prices for XAUUSD / EURUSD where no key-free real-time CORS feed exists.
 */
export async function fetchPublicQuoteForPair(
  pair: string,
  staleThresholdMs: number = 60000
): Promise<LiveQuoteState> {
  const normalized = (pair || '').toUpperCase().trim();
  const now = Date.now();

  if (normalized === 'BTCUSD') {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        mode: 'public_rest',
        provider: 'Coinbase BTC-USD',
        price: null,
        priceType: 'last',
        providerTimestamp: null,
        timestamp: null,
        fetchedAt: now,
        status: 'disconnected',
        staleThresholdMs,
        error: 'Device is offline. Public quote cannot be refreshed.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          mode: 'public_rest',
          provider: 'Coinbase BTC-USD',
          price: null,
          priceType: 'last',
          providerTimestamp: null,
          timestamp: null,
          fetchedAt: now,
          status: 'disconnected',
          staleThresholdMs,
          error: `Coinbase BTC-USD feed returned HTTP ${res.status}.`,
        };
      }
      const json = (await res.json()) as { data?: { amount?: string; base?: string; currency?: string; timestamp?: string } };
      const parsed = Number(json?.data?.amount);
      if (!Number.isFinite(parsed)) {
        return {
          mode: 'public_rest',
          provider: 'Coinbase BTC-USD',
          price: null,
          priceType: 'last',
          providerTimestamp: null,
          timestamp: null,
          fetchedAt: now,
          status: 'disconnected',
          staleThresholdMs,
          error: 'Coinbase BTC-USD feed returned an unreadable quote payload.',
        };
      }
      const rawProviderTs = json?.data?.timestamp ? Date.parse(json.data.timestamp) : NaN;
      const providerTimestamp = Number.isFinite(rawProviderTs) ? rawProviderTs : null;
      return {
        mode: 'public_rest',
        provider: 'Coinbase BTC-USD',
        price: parsed,
        priceType: 'last',
        bid: null,
        ask: null,
        providerTimestamp,
        timestamp: providerTimestamp ?? now,
        fetchedAt: now,
        status: 'fresh',
        staleThresholdMs,
      };
    } catch (err) {
      return {
        mode: 'public_rest',
        provider: 'Coinbase BTC-USD',
        price: null,
        priceType: 'last',
        providerTimestamp: null,
        timestamp: null,
        fetchedAt: now,
        status: 'disconnected',
        staleThresholdMs,
        error:
          (err as Error)?.name === 'AbortError'
            ? 'Coinbase BTC-USD request timed out (offline or blocked).'
            : 'Unable to reach Coinbase BTC-USD public quote API (offline or CORS/network restriction).',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    mode: 'public_rest',
    provider: 'Manual observation required',
    price: null,
    priceType: 'manual',
    providerTimestamp: null,
    timestamp: null,
    fetchedAt: now,
    status: 'disconnected',
    staleThresholdMs,
    error: `No unauthenticated real-time public feed is configured for ${normalized}. Switch to Manual for user-entered observations.`,
  };
}

/**
 * Copies a PlannedScenario from an Analysis/Report into the user's separate Live workspace
 * as an independent LiveWatchScenario without modifying the source analysis/report.
 */
export async function copyScenarioToLiveWorkspace(params: {
  scenario: PlannedScenario;
  pair: TradingPair | string;
  sourceReportId?: string;
  sourceReportTitle?: string;
  userId?: string | null;
}): Promise<{ workspace: LiveWorkspaceData; copiedScenario: LiveWatchScenario }> {
  const { scenario, pair, sourceReportId, sourceReportTitle, userId } = params;
  const now = Date.now();
  const ws = await getLiveWorkspace(userId);

  const targetPair = (pair || ws.activePair || 'XAUUSD').toUpperCase();
  const existingInst: LiveInstrumentState = ws.instruments[targetPair] || {
    pair: targetPair,
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
    updatedAt: now,
  };

  const copiedScenario: LiveWatchScenario = {
    id: `live_scn_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name: scenario.label || 'Copied Scenario',
    direction: scenario.direction || '',
    strategyId: scenario.strategyId,
    strategy: scenario.strategy || scenario.strategySnapshot?.name || '',
    strategySnapshot: scenario.strategySnapshot ? deepClone(scenario.strategySnapshot) : undefined,
    targetZoneOrLevel: '',
    zoneLow: '',
    zoneHigh: '',
    triggerConditions: scenario.entryConditions || '',
    confirmationType: '',
    confirmationTimeframe: '',
    requiresCandleClose: false,
    plannedResponse: scenario.description || '',
    invalidationLevel: scenario.invalidationConditions || '',
    priority: 'Medium',
    notes: sourceReportTitle ? `Copied from: ${sourceReportTitle}` : '',
    status: 'Waiting',
    alertOnZoneTouch: true,
    alertOnInvalidation: true,
    sourceReportId,
    sourceReportTitle,
    sourceScenarioId: scenario.id,
    sourcePair: (pair as TradingPair) || 'XAUUSD',
    sourceLabel: scenario.label,
    createdAt: now,
    updatedAt: now,
  };

  const nextWs: LiveWorkspaceData = {
    ...ws,
    activePair: targetPair,
    instruments: {
      ...ws.instruments,
      [targetPair]: {
        ...existingInst,
        scenarios: [copiedScenario, ...(existingInst.scenarios || [])],
        updatedAt: now,
      },
    },
    updatedAt: now,
  };

  const saved = await saveLiveWorkspace(nextWs, userId);
  return { workspace: saved, copiedScenario };
}
