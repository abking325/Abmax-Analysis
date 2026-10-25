import { App as CapApp } from '@capacitor/app';
import {
  ActiveView,
} from '../components/Header';
import {
  AnalysisData,
  OpeningCandleSession,
  TimeframeId,
  TradingSession,
  TradeOutcome,
} from '../types/journal';
import { saveDraft } from './db';

export interface UnfinishedOcDraft {
  isAdding: boolean;
  session: OpeningCandleSession;
  level: string;
  editingId: string | null;
  editSession: OpeningCandleSession;
  editLevel: string;
}

export interface UnfinishedSupplyDemandDraft {
  isAdding: boolean;
  timeframe: TimeframeId;
  supply: string;
  demand: string;
  editingId: string | null;
  editTimeframe: TimeframeId;
  editSupply: string;
  editDemand: string;
}

export interface UnfinishedTfLevelDraft {
  isAdding: boolean;
  timeframe: TimeframeId;
  type: string;
  price: string;
  notes: string;
}

export interface UnfinishedTradeModalDraft {
  isOpen: boolean;
  reportId: string;
  tradeToEditId?: string | null;
  selectedScenarioId: string;
  direction: 'Buy' | 'Sell';
  session: TradingSession;
  timeframeTaken: TimeframeId;
  entryPrice: string;
  stopLoss: string;
  takeProfit: string;
  exitPrice: string;
  riskReward: string;
  outcome: TradeOutcome;
  rulesFollowed: boolean;
  notes: string;
  tradeDate: string;
  tradeTime: string;
}

export interface WorkingSessionState {
  version: 2;
  timestamp: number;
  accountId: string; // user.id or 'local'
  activeView: ActiveView;
  isEditingExistingReport: boolean;
  activeReportId?: string;
  scrollPositions: {
    home?: number;
    analysis?: number;
    reports?: number;
  };
  analysisUI?: {
    expandedTimeframes: Record<TimeframeId, boolean>;
    unfinishedOc?: UnfinishedOcDraft;
    unfinishedSupplyDemand?: UnfinishedSupplyDemandDraft;
    unfinishedTfLevels?: Record<string, UnfinishedTfLevelDraft>;
    expandedScenarios?: Record<string, boolean>;
  };
  reportsUI?: {
    selectedPair: string;
    searchQuery: string;
    activeReportDetailsId: string | null;
  };
  tradeModalDraft?: UnfinishedTradeModalDraft | null;
}

const STORAGE_PREFIX = 'abmax_session_v2_';

function getSessionKey(accountId: string): string {
  const safeAccount = (accountId || 'local').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${STORAGE_PREFIX}${safeAccount}`;
}

/**
 * Thread-safe serial write queue to guarantee persistence operations run sequentially
 * so an older pending autosave can never overwrite a newer save.
 */
class SerializedSessionManager {
  private queue: Promise<void> = Promise.resolve();
  private pendingSession: WorkingSessionState | null = null;
  private pendingAnalysis: AnalysisData | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingTimestamp: number | null = null;
  private readonly maxWaitMs: number = 2000; // Forces persistent write every 2.0s even during continuous non-stop editing
  private inMemoryActive: boolean = true;
  private isHydrated: boolean = false;
  private lastCompletedWriteTimestamp: number | null = null;

  public setHydrated(val: boolean) {
    this.isHydrated = val;
  }

  public getIsHydrated(): boolean {
    return this.isHydrated;
  }

  public getLastCompletedWriteTimestamp(): number | null {
    return this.lastCompletedWriteTimestamp;
  }

  /**
   * Schedule debounced persistence of working session state and analysis data.
   * Continuous editing is bounded by maxWaitMs so typing never delays persistence indefinitely.
   * Recovery restores the last successfully completed write.
   */
  public scheduleSave(
    session: WorkingSessionState,
    analysis?: AnalysisData,
    debounceMs: number = 400
  ) {
    this.pendingSession = { ...session, timestamp: Date.now() };
    if (analysis) {
      this.pendingAnalysis = analysis;
    }

    if (this.firstPendingTimestamp === null) {
      this.firstPendingTimestamp = Date.now();
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const elapsed = Date.now() - this.firstPendingTimestamp;
    if (elapsed >= this.maxWaitMs) {
      this.flushNow();
      return;
    }

    if (!this.maxWaitTimer) {
      const remainingMax = Math.max(0, this.maxWaitMs - elapsed);
      this.maxWaitTimer = setTimeout(() => {
        this.flushNow();
      }, remainingMax);
    }

    const remainingMax = Math.max(0, this.maxWaitMs - elapsed);
    const delay = Math.min(debounceMs, remainingMax);
    this.debounceTimer = setTimeout(() => {
      this.flushNow();
    }, delay);
  }

  /**
   * Immediate synchronous execution of any queued save operations.
   * Returns a promise resolving after the write is committed to persistent storage.
   */
  public flushNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    this.firstPendingTimestamp = null;

    const sessionToSave = this.pendingSession;
    const analysisToSave = this.pendingAnalysis;
    this.pendingSession = null;
    this.pendingAnalysis = null;

    if (!sessionToSave && !analysisToSave) {
      return this.queue;
    }

    // Append to sequential chain
    this.queue = this.queue.then(async () => {
      try {
        if (sessionToSave) {
          const key = getSessionKey(sessionToSave.accountId);
          localStorage.setItem(key, JSON.stringify(sessionToSave));
        }
        if (analysisToSave) {
          await saveDraft(analysisToSave);
        }
        this.lastCompletedWriteTimestamp = Date.now();
      } catch (err) {
        console.warn('Serialized session write warning:', err);
      }
    });

    return this.queue;
  }

  /**
   * Load stored working session for account
   */
  public loadSession(accountId: string): WorkingSessionState | null {
    try {
      const key = getSessionKey(accountId);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WorkingSessionState;
      if (parsed && parsed.version === 2) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Clear session for an account (e.g. on explicit logout or clean report finish)
   */
  public clearSession(accountId: string) {
    try {
      const key = getSessionKey(accountId);
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export const sessionManager = new SerializedSessionManager();

/**
 * Register lifecycle hooks for Capacitor appStateChange, pause, and web visibilitychange
 */
export function registerLifecycleSessionListeners(
  onFlush: () => void,
  onResume?: () => void
): () => void {
  let capAppStateHandle: { remove: () => void } | null = null;
  let capPauseHandle: { remove: () => void } | null = null;
  let capResumeHandle: { remove: () => void } | null = null;

  try {
    CapApp.addListener('appStateChange', (state) => {
      if (!state.isActive) {
        onFlush();
      } else {
        onResume?.();
      }
    }).then((h) => {
      capAppStateHandle = h;
    }).catch(() => {});

    CapApp.addListener('pause', () => {
      onFlush();
    }).then((h) => {
      capPauseHandle = h;
    }).catch(() => {});

    CapApp.addListener('resume', () => {
      onResume?.();
    }).then((h) => {
      capResumeHandle = h;
    }).catch(() => {});
  } catch {
    // Non-native / pure browser environment
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      onFlush();
    } else {
      onResume?.();
    }
  };

  const handlePageHide = () => {
    onFlush();
  };

  window.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);

  return () => {
    capAppStateHandle?.remove();
    capPauseHandle?.remove();
    capResumeHandle?.remove();
    window.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
  };
}

/**
 * Restores scroll position safely after DOM paints
 */
export function restoreScrollPosition(y?: number) {
  if (typeof y !== 'number' || y <= 0) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    });
  });
}
