import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit3,
  ExternalLink,
  FileText,
  Info,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_INSTRUMENTS_CONFIG,
  getEnabledInstrumentSymbols,
  InstrumentsConfig,
  JournalEntry,
  JournalLaunchContext,
  LIVE_SCENARIO_STATUSES,
  LiveConfirmationTimeframe,
  LiveEventItem,
  LiveInstrumentState,
  LiveLevelZone,
  LiveQuoteState,
  LiveScenarioStatus,
  LiveWatchScenario,
  LiveWorkspaceData,
  PlannedScenario,
  RecordedTrade,
  SavedReport,
  TimeframeId,
  TradingPair,
  createEmptyLiveInstrumentState,
  createInitialLiveWorkspace,
} from '../types/journal';
import {
  getLiveWorkspace,
  resetLiveInstrument,
  resetLiveWorkspace,
  saveLiveWorkspace,
  saveReport,
} from '../services/db';
import {
  evaluateLiveScenarioConditions,
  fetchPublicQuoteForPair,
  isQuoteStale,
} from '../services/liveMarketService';
import { StrategySelector } from './StrategySelector';
import { TakeTradeModal } from './TakeTradeModal';
import { deepClone, formatDateInTimezone, formatTimeInTimezone } from '../utils/analysisUtils';
import { registerBackHandler } from '../utils/backNavigation';

const ZONE_TYPES: LiveLevelZone['type'][] = ['Supply', 'Demand', 'Support', 'Resistance', 'Liquidity', 'Custom'];
const CONFIRMATION_TIMEFRAMES: LiveConfirmationTimeframe[] = ['1M', '5M', '15M', '1H', '4H'];

interface LiveViewProps {
  userId?: string | null;
  instrumentsConfig?: InstrumentsConfig;
  reports?: SavedReport[];
  onOpenReport?: (reportId: string) => void;
  onUpdateReport?: (updated: SavedReport) => Promise<void>;
  onLaunchJournalFromTrade?: (ctx: Omit<JournalLaunchContext, 'requestId'>) => void;
  onSavePreparationJournal?: (entry: JournalEntry) => Promise<void>;
}

const createEmptyScenarioDraft = (): LiveWatchScenario => {
  const now = Date.now();
  return {
    id: `lscn_${now}_${Math.random().toString(36).substring(2, 8)}`,
    name: '',
    direction: 'Buy',
    strategy: '',
    targetZoneOrLevel: '',
    zoneLow: '',
    zoneHigh: '',
    triggerConditions: '',
    confirmationType: '',
    confirmationTimeframe: '15M',
    requiresCandleClose: true,
    plannedResponse: '',
    invalidationLevel: '',
    priority: 'High',
    status: 'Waiting',
    notes: '',
    alertOnZoneTouch: true,
    alertOnInvalidation: true,
    createdAt: now,
    updatedAt: now,
  };
};

const createEmptyLevelDraft = (): LiveLevelZone => {
  const now = Date.now();
  return {
    id: `llvl_${now}_${Math.random().toString(36).substring(2, 8)}`,
    label: '',
    price: '',
    type: 'Supply',
    timeframe: '1H',
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
};

const createEmptyEventDraft = (): LiveEventItem => {
  const now = Date.now();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    id: `levt_${now}_${Math.random().toString(36).substring(2, 8)}`,
    title: '',
    scheduledTime: '',
    timezone: tz,
    currencyOrInstrument: 'USD',
    impact: 'High',
    notes: '',
    status: 'Upcoming',
    createdAt: now,
    updatedAt: now,
  };
};

export const LiveView: React.FC<LiveViewProps> = ({
  userId,
  instrumentsConfig = DEFAULT_INSTRUMENTS_CONFIG,
  reports = [],
  onOpenReport,
  onUpdateReport,
  onLaunchJournalFromTrade,
  onSavePreparationJournal,
}) => {
  const enabledInstruments = useMemo(
    () => getEnabledInstrumentSymbols(instrumentsConfig),
    [instrumentsConfig]
  );
  const [workspace, setWorkspace] = useState<LiveWorkspaceData>(() =>
    createInitialLiveWorkspace(userId || 'local', getEnabledInstrumentSymbols(instrumentsConfig))
  );
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Manual observation inputs
  const [manualLastInput, setManualLastInput] = useState('');
  const [manualBidInput, setManualBidInput] = useState('');
  const [manualAskInput, setManualAskInput] = useState('');
  const [quoteFetchError, setQuoteFetchError] = useState<string | null>(null);
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [autoPollPublic, setAutoPollPublic] = useState(false);

  // Scenario editor state (isolated deep copy)
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [scenarioDraft, setScenarioDraft] = useState<LiveWatchScenario>(createEmptyScenarioDraft);
  const scenarioOriginRef = useRef<string>('');
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [showScenarioDiscardConfirm, setShowScenarioDiscardConfirm] = useState(false);
  const [confirmDeleteScenarioId, setConfirmDeleteScenarioId] = useState<string | null>(null);

  // Level editor state (isolated deep copy)
  const [isLevelEditorOpen, setIsLevelEditorOpen] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelDraft, setLevelDraft] = useState<LiveLevelZone>(createEmptyLevelDraft);
  const levelOriginRef = useRef<string>('');
  const [levelError, setLevelError] = useState<string | null>(null);
  const [showLevelDiscardConfirm, setShowLevelDiscardConfirm] = useState(false);
  const [confirmDeleteLevelId, setConfirmDeleteLevelId] = useState<string | null>(null);

  // Event editor state (isolated deep copy)
  const [isEventEditorOpen, setIsEventEditorOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDraft, setEventDraft] = useState<LiveEventItem>(createEmptyEventDraft);
  const eventOriginRef = useRef<string>('');
  const [eventError, setEventError] = useState<string | null>(null);
  const [showEventDiscardConfirm, setShowEventDiscardConfirm] = useState(false);
  const [confirmDeleteEventId, setConfirmDeleteEventId] = useState<string | null>(null);

  // Loaded Report reference & Record Trade integration (non-destructive)
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [loadedScenarioExpandedMap, setLoadedScenarioExpandedMap] = useState<Record<string, boolean>>({});
  const [copiedLoadedScenarioId, setCopiedLoadedScenarioId] = useState<string | null>(null);
  const [tradeModalState, setTradeModalState] = useState<{
    report: SavedReport;
    draft: any;
  } | null>(null);
  const [reportPickerForLiveScenario, setReportPickerForLiveScenario] = useState<LiveWatchScenario | null>(null);
  const [pickerReportId, setPickerReportId] = useState<string>('');
  const [tradeSavedFeedback, setTradeSavedFeedback] = useState<{
    reportId: string;
    reportTitle: string;
    tradeId: string;
    direction: 'Buy' | 'Sell' | '';
    pair: TradingPair;
  } | null>(null);

  // Reset confirmations
  const [showResetInstrumentConfirm, setShowResetInstrumentConfirm] = useState(false);
  const [showResetWorkspaceConfirm, setShowResetWorkspaceConfirm] = useState(false);

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const currentAccountRef = useRef(userId);
  currentAccountRef.current = userId;

  // Load workspace for active account scope; clear stale transient modals on account switch
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setSaveError(null);
    setQuoteFetchError(null);
    setIsScenarioModalOpen(false);
    setIsLevelEditorOpen(false);
    setIsEventEditorOpen(false);
    setTradeModalState(null);
    setReportPickerForLiveScenario(null);
    setTradeSavedFeedback(null);
    setShowResetInstrumentConfirm(false);
    setShowResetWorkspaceConfirm(false);

    getLiveWorkspace(userId)
      .then((ws) => {
        if (!mounted) return;
        setWorkspace(ws);
        const inst = ws.instruments[ws.activePair];
        setManualLastInput(inst?.quote?.price !== null && inst?.quote?.price !== undefined ? String(inst.quote.price) : '');
        setManualBidInput(inst?.quote?.bid !== null && inst?.quote?.bid !== undefined ? String(inst.quote.bid) : '');
        setManualAskInput(inst?.quote?.ask !== null && inst?.quote?.ask !== undefined ? String(inst.quote.ask) : '');
      })
      .catch((err) => {
        if (!mounted) return;
        setSaveError((err as Error).message || 'Could not load Live workspace.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [userId]);

  const activePair: TradingPair = enabledInstruments.includes(workspace.activePair)
    ? (workspace.activePair as TradingPair)
    : (enabledInstruments[0] || 'XAUUSD');
  const activeInstrument: LiveInstrumentState = useMemo(() => {
    return workspace.instruments[activePair] || createEmptyLiveInstrumentState(activePair);
  }, [workspace.instruments, activePair]);

  useEffect(() => {
    if (!loading && workspace.activePair !== activePair) {
      const targetInst = workspace.instruments[activePair] || createEmptyLiveInstrumentState(activePair);
      setManualLastInput(targetInst.quote?.price !== null && targetInst.quote?.price !== undefined ? String(targetInst.quote.price) : '');
      setManualBidInput(targetInst.quote?.bid !== null && targetInst.quote?.bid !== undefined ? String(targetInst.quote.bid) : '');
      setManualAskInput(targetInst.quote?.ask !== null && targetInst.quote?.ask !== undefined ? String(targetInst.quote.ask) : '');
    }
  }, [loading, workspace.activePair, activePair, workspace.instruments]);

  const persistWorkspace = useCallback(async (updater: (prev: LiveWorkspaceData) => LiveWorkspaceData) => {
    const scope = currentAccountRef.current;
    const prev = workspaceRef.current;
    const next = updater(prev);
    workspaceRef.current = next;
    setWorkspace(next);
    setSaveError(null);
    try {
      await saveLiveWorkspace(next, scope);
    } catch (err) {
      setSaveError((err as Error).message || 'Failed to save Live workspace locally.');
    }
  }, []);

  const updateInstrument = useCallback(
    async (pair: TradingPair, updater: (prev: LiveInstrumentState) => LiveInstrumentState) => {
      await persistWorkspace((prev) => {
        const currentInst = prev.instruments[pair] || createEmptyLiveInstrumentState(pair);
        const updatedInst = updater(currentInst);
        return {
          ...prev,
          updatedAt: Date.now(),
          instruments: {
            ...prev.instruments,
            [pair]: updatedInst,
          },
        };
      });
    },
    [persistWorkspace]
  );

  // Sync manual inputs when switching instrument
  const handleSelectInstrument = async (pair: TradingPair) => {
    setQuoteFetchError(null);
    setAutoPollPublic(false);
    setShowResetInstrumentConfirm(false);
    const targetInst = workspaceRef.current.instruments[pair] || createEmptyLiveInstrumentState(pair);
    setManualLastInput(targetInst.quote?.price !== null && targetInst.quote?.price !== undefined ? String(targetInst.quote.price) : '');
    setManualBidInput(targetInst.quote?.bid !== null && targetInst.quote?.bid !== undefined ? String(targetInst.quote.bid) : '');
    setManualAskInput(targetInst.quote?.ask !== null && targetInst.quote?.ask !== undefined ? String(targetInst.quote.ask) : '');
    await persistWorkspace((prev) => ({
      ...prev,
      activePair: pair,
      updatedAt: Date.now(),
    }));
  };

  // Apply quote + run deterministic condition evaluator cleanly
  const applyQuoteAndEvaluate = useCallback(
    async (pair: TradingPair, nextQuote: LiveQuoteState) => {
      await updateInstrument(pair, (inst) => {
        const evaluated = evaluateLiveScenarioConditions(
          inst.scenarios,
          nextQuote,
          inst.alerts,
          Date.now()
        );
        return {
          ...inst,
          quote: nextQuote,
          scenarios: evaluated.updatedScenarios,
          alerts: [...evaluated.newAlerts, ...inst.alerts],
          updatedAt: Date.now(),
        };
      });
    },
    [updateInstrument]
  );

  const handleFetchPublicQuote = useCallback(async () => {
    setQuoteFetchError(null);
    setIsFetchingQuote(true);
    try {
      const nextQuote = await fetchPublicQuoteForPair(activePair);
      if (nextQuote.status === 'fresh' && nextQuote.price !== null) {
        await applyQuoteAndEvaluate(activePair, nextQuote);
        setManualLastInput(String(nextQuote.price));
      } else {
        setQuoteFetchError(nextQuote.error || 'Public quote unavailable for this instrument.');
        await updateInstrument(activePair, (inst) => ({
          ...inst,
          quote: nextQuote,
          updatedAt: Date.now(),
        }));
      }
    } finally {
      setIsFetchingQuote(false);
    }
  }, [activePair, applyQuoteAndEvaluate, updateInstrument]);

  // Auto-poll ONLY when explicitly enabled in Public Feed mode for supported instruments
  useEffect(() => {
    if (!autoPollPublic || activeInstrument.quote.mode !== 'public_rest' || activePair !== 'BTCUSD') {
      return;
    }
    const timer = setInterval(() => {
      handleFetchPublicQuote();
    }, 15000);
    return () => clearInterval(timer);
  }, [autoPollPublic, activeInstrument.quote.mode, activePair, handleFetchPublicQuote]);

  const handleSaveManualQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuoteFetchError(null);
    const parsedLast = manualLastInput.trim() ? Number(manualLastInput.trim()) : NaN;
    const parsedBid = manualBidInput.trim() ? Number(manualBidInput.trim()) : null;
    const parsedAsk = manualAskInput.trim() ? Number(manualAskInput.trim()) : null;

    if (!Number.isFinite(parsedLast) || parsedLast <= 0) {
      setQuoteFetchError('Enter a valid positive price for manual observation.');
      return;
    }
    if (parsedBid !== null && (!Number.isFinite(parsedBid) || parsedBid <= 0)) {
      setQuoteFetchError('Bid price must be a positive number.');
      return;
    }
    if (parsedAsk !== null && (!Number.isFinite(parsedAsk) || parsedAsk <= 0)) {
      setQuoteFetchError('Ask price must be a positive number.');
      return;
    }

    const now = Date.now();
    const quote: LiveQuoteState = {
      mode: 'manual',
      provider: 'Manual Observation',
      priceType: 'manual',
      price: parsedLast,
      bid: parsedBid,
      ask: parsedAsk,
      timestamp: now,
      fetchedAt: now,
      status: 'manual',
      staleThresholdMs: 24 * 60 * 60 * 1000,
    };
    await applyQuoteAndEvaluate(activePair, quote);
  };

  // --- Scenario CRUD with Isolated Snapshot + Cancel Dirty Guard ---
  const openNewScenario = () => {
    const fresh = createEmptyScenarioDraft();
    setEditingScenarioId(null);
    setScenarioDraft(fresh);
    scenarioOriginRef.current = JSON.stringify(fresh);
    setScenarioError(null);
    setShowScenarioDiscardConfirm(false);
    setIsScenarioModalOpen(true);
  };

  const openEditScenario = (sc: LiveWatchScenario) => {
    const cloned = deepClone(sc);
    setEditingScenarioId(cloned.id);
    setScenarioDraft(cloned);
    scenarioOriginRef.current = JSON.stringify(cloned);
    setScenarioError(null);
    setShowScenarioDiscardConfirm(false);
    setIsScenarioModalOpen(true);
  };

  const handleRequestCloseScenarioModal = useCallback(() => {
    const isDirty = JSON.stringify(scenarioDraft) !== scenarioOriginRef.current;
    if (isDirty) {
      setShowScenarioDiscardConfirm(true);
    } else {
      setIsScenarioModalOpen(false);
      setEditingScenarioId(null);
      setShowScenarioDiscardConfirm(false);
    }
  }, [scenarioDraft]);

  const handleSaveScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    setScenarioError(null);
    if (!scenarioDraft.name.trim()) {
      setScenarioError('Scenario name is required.');
      return;
    }

    const now = Date.now();
    const toSave: LiveWatchScenario = {
      ...deepClone(scenarioDraft),
      name: scenarioDraft.name.trim(),
      targetZoneOrLevel: scenarioDraft.targetZoneOrLevel.trim(),
      triggerConditions: scenarioDraft.triggerConditions.trim(),
      confirmationType: scenarioDraft.confirmationType.trim(),
      plannedResponse: scenarioDraft.plannedResponse.trim(),
      invalidationLevel: scenarioDraft.invalidationLevel?.trim() || '',
      notes: scenarioDraft.notes?.trim() || '',
      updatedAt: now,
      createdAt: editingScenarioId ? scenarioDraft.createdAt : now,
    };

    await updateInstrument(activePair, (inst) => {
      const exists = inst.scenarios.some((s) => s.id === toSave.id);
      const nextScenarios = exists
        ? inst.scenarios.map((s) => (s.id === toSave.id ? toSave : s))
        : [toSave, ...inst.scenarios];

      const evaluated = evaluateLiveScenarioConditions(
        nextScenarios,
        inst.quote,
        inst.alerts,
        now
      );

      return {
        ...inst,
        scenarios: evaluated.updatedScenarios,
        alerts: [...evaluated.newAlerts, ...inst.alerts],
        updatedAt: now,
      };
    });

    setIsScenarioModalOpen(false);
    setEditingScenarioId(null);
    setShowScenarioDiscardConfirm(false);
  };

  const handleScenarioStatusChange = async (scenarioId: string, nextStatus: LiveScenarioStatus) => {
    const now = Date.now();
    await updateInstrument(activePair, (inst) => ({
      ...inst,
      scenarios: inst.scenarios.map((s) =>
        s.id === scenarioId ? { ...s, status: nextStatus, updatedAt: now } : s
      ),
      updatedAt: now,
    }));
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    await updateInstrument(activePair, (inst) => ({
      ...inst,
      scenarios: inst.scenarios.filter((s) => s.id !== scenarioId),
      alerts: inst.alerts.filter((a) => a.scenarioId !== scenarioId),
      updatedAt: Date.now(),
    }));
    setConfirmDeleteScenarioId(null);
  };

  // --- Level CRUD with Isolated Snapshot + Cancel Dirty Guard ---
  const openNewLevel = () => {
    const fresh = createEmptyLevelDraft();
    setEditingLevelId(null);
    setLevelDraft(fresh);
    levelOriginRef.current = JSON.stringify(fresh);
    setLevelError(null);
    setShowLevelDiscardConfirm(false);
    setIsLevelEditorOpen(true);
  };

  const openEditLevel = (lvl: LiveLevelZone) => {
    const cloned = deepClone(lvl);
    setEditingLevelId(cloned.id);
    setLevelDraft(cloned);
    levelOriginRef.current = JSON.stringify(cloned);
    setLevelError(null);
    setShowLevelDiscardConfirm(false);
    setIsLevelEditorOpen(true);
  };

  const handleRequestCloseLevelEditor = useCallback(() => {
    if (JSON.stringify(levelDraft) !== levelOriginRef.current) {
      setShowLevelDiscardConfirm(true);
    } else {
      setIsLevelEditorOpen(false);
      setEditingLevelId(null);
      setShowLevelDiscardConfirm(false);
    }
  }, [levelDraft]);

  const handleSaveLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    setLevelError(null);
    if (!levelDraft.label.trim() && !levelDraft.price.trim()) {
      setLevelError('Enter a label or price level before saving.');
      return;
    }
    const now = Date.now();
    const toSave: LiveLevelZone = {
      ...deepClone(levelDraft),
      label: levelDraft.label.trim() || `${levelDraft.type} Zone`,
      price: levelDraft.price.trim(),
      notes: levelDraft.notes?.trim() || '',
      updatedAt: now,
      createdAt: editingLevelId ? levelDraft.createdAt : now,
    };

    await updateInstrument(activePair, (inst) => {
      const exists = inst.keyLevels.some((l) => l.id === toSave.id);
      const nextLevels = exists
        ? inst.keyLevels.map((l) => (l.id === toSave.id ? toSave : l))
        : [toSave, ...inst.keyLevels];
      return { ...inst, keyLevels: nextLevels, updatedAt: now };
    });

    setIsLevelEditorOpen(false);
    setEditingLevelId(null);
    setShowLevelDiscardConfirm(false);
  };

  const handleDeleteLevel = async (levelId: string) => {
    await updateInstrument(activePair, (inst) => ({
      ...inst,
      keyLevels: inst.keyLevels.filter((l) => l.id !== levelId),
      updatedAt: Date.now(),
    }));
    setConfirmDeleteLevelId(null);
  };

  // --- Event CRUD with Isolated Snapshot + Cancel Dirty Guard ---
  const openNewEvent = () => {
    const fresh = createEmptyEventDraft();
    setEditingEventId(null);
    setEventDraft(fresh);
    eventOriginRef.current = JSON.stringify(fresh);
    setEventError(null);
    setShowEventDiscardConfirm(false);
    setIsEventEditorOpen(true);
  };

  const openEditEvent = (ev: LiveEventItem) => {
    const cloned = deepClone(ev);
    setEditingEventId(cloned.id);
    setEventDraft(cloned);
    eventOriginRef.current = JSON.stringify(cloned);
    setEventError(null);
    setShowEventDiscardConfirm(false);
    setIsEventEditorOpen(true);
  };

  const handleRequestCloseEventEditor = useCallback(() => {
    if (JSON.stringify(eventDraft) !== eventOriginRef.current) {
      setShowEventDiscardConfirm(true);
    } else {
      setIsEventEditorOpen(false);
      setEditingEventId(null);
      setShowEventDiscardConfirm(false);
    }
  }, [eventDraft]);

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setEventError(null);
    if (!eventDraft.title.trim()) {
      setEventError('Event title is required.');
      return;
    }
    const now = Date.now();
    const toSave: LiveEventItem = {
      ...deepClone(eventDraft),
      title: eventDraft.title.trim(),
      scheduledTime: eventDraft.scheduledTime.trim(),
      notes: eventDraft.notes?.trim() || '',
      updatedAt: now,
      createdAt: editingEventId ? eventDraft.createdAt : now,
    };

    await updateInstrument(activePair, (inst) => {
      const exists = inst.events.some((ev) => ev.id === toSave.id);
      const nextEvents = exists
        ? inst.events.map((ev) => (ev.id === toSave.id ? toSave : ev))
        : [toSave, ...inst.events];
      return { ...inst, events: nextEvents, updatedAt: now };
    });

    setIsEventEditorOpen(false);
    setEditingEventId(null);
    setShowEventDiscardConfirm(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    await updateInstrument(activePair, (inst) => ({
      ...inst,
      events: inst.events.filter((ev) => ev.id !== eventId),
      updatedAt: Date.now(),
    }));
    setConfirmDeleteEventId(null);
  };

  // Keyboard Escape support for topmost open editor
  useEffect(() => {
    if (!isScenarioModalOpen && !isLevelEditorOpen && !isEventEditorOpen && !reportPickerForLiveScenario) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (reportPickerForLiveScenario) {
        setReportPickerForLiveScenario(null);
      } else if (isScenarioModalOpen) {
        if (showScenarioDiscardConfirm) setShowScenarioDiscardConfirm(false);
        else handleRequestCloseScenarioModal();
      } else if (isLevelEditorOpen) {
        if (showLevelDiscardConfirm) setShowLevelDiscardConfirm(false);
        else handleRequestCloseLevelEditor();
      } else if (isEventEditorOpen) {
        if (showEventDiscardConfirm) setShowEventDiscardConfirm(false);
        else handleRequestCloseEventEditor();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isScenarioModalOpen,
    isLevelEditorOpen,
    isEventEditorOpen,
    reportPickerForLiveScenario,
    showScenarioDiscardConfirm,
    showLevelDiscardConfirm,
    showEventDiscardConfirm,
    handleRequestCloseScenarioModal,
    handleRequestCloseLevelEditor,
    handleRequestCloseEventEditor,
  ]);

  // Register topmost Android Back handler when any Live editor modal is open
  useEffect(() => {
    if (!isScenarioModalOpen && !isLevelEditorOpen && !isEventEditorOpen && !reportPickerForLiveScenario) return;
    return registerBackHandler(() => {
      if (reportPickerForLiveScenario) {
        setReportPickerForLiveScenario(null);
      } else if (isScenarioModalOpen) {
        if (showScenarioDiscardConfirm) setShowScenarioDiscardConfirm(false);
        else handleRequestCloseScenarioModal();
      } else if (isLevelEditorOpen) {
        if (showLevelDiscardConfirm) setShowLevelDiscardConfirm(false);
        else handleRequestCloseLevelEditor();
      } else if (isEventEditorOpen) {
        if (showEventDiscardConfirm) setShowEventDiscardConfirm(false);
        else handleRequestCloseEventEditor();
      }
    });
  }, [
    isScenarioModalOpen,
    isLevelEditorOpen,
    isEventEditorOpen,
    reportPickerForLiveScenario,
    showScenarioDiscardConfirm,
    showLevelDiscardConfirm,
    showEventDiscardConfirm,
    handleRequestCloseScenarioModal,
    handleRequestCloseLevelEditor,
    handleRequestCloseEventEditor,
  ]);

  // Quote health classification
  const quoteHealth = useMemo(() => {
    const q = activeInstrument.quote;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (q.mode === 'manual') {
      if (q.price === null || q.price === undefined) {
        return { label: 'Manual (No price entered)', tone: 'text-app-secondary border-app bg-app-field', stale: true };
      }
      return { label: 'Manual Observation', tone: 'text-amber-700 dark:text-amber-300 border-amber-400/50 bg-amber-50 dark:bg-amber-950/30', stale: false };
    }
    if (isOffline || q.status === 'disconnected') {
      return { label: isOffline ? 'Offline' : 'Disconnected', tone: 'text-rose-700 dark:text-rose-300 border-rose-400/50 bg-rose-50 dark:bg-rose-950/30', stale: true };
    }
    if (q.price === null || q.price === undefined) {
      return { label: 'Disconnected', tone: 'text-app-secondary border-app bg-app-field', stale: true };
    }
    if (isQuoteStale(q)) {
      return { label: 'Stale (>60s)', tone: 'text-amber-700 dark:text-amber-300 border-amber-400/50 bg-amber-50 dark:bg-amber-950/30', stale: true };
    }
    return { label: 'Fresh', tone: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-pale', stale: false };
  }, [activeInstrument.quote]);

  const unacknowledgedAlerts = useMemo(
    () => activeInstrument.alerts.filter((a) => !a.acknowledged),
    [activeInstrument.alerts]
  );

  // Reports sorted by recency with activePair matches prioritized
  const orderedReportsForPicker = useMemo(() => {
    const activePairMatches: SavedReport[] = [];
    const others: SavedReport[] = [];
    for (const r of reports) {
      if (r.pair === activePair) activePairMatches.push(r);
      else others.push(r);
    }
    return { activePairMatches, others, all: [...activePairMatches, ...others] };
  }, [reports, activePair]);

  const loadedReport = useMemo(() => {
    if (!selectedReportId) return null;
    return reports.find((r) => r.id === selectedReportId) || null;
  }, [reports, selectedReportId]);

  const reportsById = useMemo(() => {
    const map = new Map<string, SavedReport>();
    for (const r of reports) {
      map.set(r.id, r);
    }
    return map;
  }, [reports]);

  // Clear report selection when switching instrument if it doesn't belong to activePair
  useEffect(() => {
    if (loadedReport && loadedReport.pair !== activePair) {
      const firstForPair = reports.find((r) => r.pair === activePair);
      setSelectedReportId(firstForPair ? firstForPair.id : '');
      setLoadedScenarioExpandedMap({});
    }
  }, [activePair, loadedReport, reports]);

  const handleCopyLoadedScenarioToLive = async (rpt: SavedReport, sc: PlannedScenario) => {
    const now = Date.now();
    const watchItem: LiveWatchScenario = {
      id: `lscn_${now}_${Math.random().toString(36).substring(2, 8)}`,
      name: sc.label || 'Scenario',
      direction: sc.direction === 'Sell' ? 'Sell' : 'Buy',
      strategy: sc.strategy || sc.strategySnapshot?.name || '',
      strategyId: sc.strategyId,
      strategySnapshot: sc.strategySnapshot ? deepClone(sc.strategySnapshot) : undefined,
      targetZoneOrLevel: '',
      zoneLow: '',
      zoneHigh: '',
      triggerConditions: sc.entryConditions || '',
      confirmationType: sc.entryConditions || '',
      confirmationTimeframe: '15M',
      requiresCandleClose: true,
      plannedResponse: sc.description || '',
      invalidationLevel: sc.invalidationConditions || '',
      priority: 'High',
      status: 'Waiting',
      notes: '',
      sourceReportId: rpt.id,
      sourceScenarioId: sc.id,
      sourceReportTitle: rpt.title || `${rpt.pair} (${rpt.date})`,
      alertOnZoneTouch: true,
      alertOnInvalidation: true,
      createdAt: now,
      updatedAt: now,
    };
    const targetPair = rpt.pair || activePair;
    await updateInstrument(targetPair, (inst) => ({
      ...inst,
      scenarios: [watchItem, ...inst.scenarios],
      updatedAt: now,
    }));
    setCopiedLoadedScenarioId(sc.id);
    setTimeout(() => {
      setCopiedLoadedScenarioId((prev) => (prev === sc.id ? null : prev));
    }, 2000);
  };

  const openTakeTradeForReportAndLiveScenario = (
    targetReport: SavedReport,
    sc: LiveWatchScenario,
    sourcePlannedScenario?: PlannedScenario
  ) => {
    const now = new Date();
    const matchedScenario =
      sourcePlannedScenario ||
      (sc.sourceScenarioId
        ? targetReport.scenarios?.find((s) => s.id === sc.sourceScenarioId)
        : undefined);
    setTradeSavedFeedback(null);
    setTradeModalState({
      report: targetReport,
      draft: {
        selectedScenarioId: matchedScenario ? matchedScenario.id : 'manual',
        direction: sc.direction || 'Buy',
        session: targetReport.session || 'London',
        timeframeTaken: (sc.confirmationTimeframe as TimeframeId) || '15M',
        entryPrice: '',
        stopLoss: '',
        takeProfit: '',
        exitPrice: '',
        riskReward: '',
        plannedRRChoice: '',
        plannedRRRatio: '',
        setupValidity: 'Not reviewed',
        outcome: 'Open',
        rulesFollowed: true,
        notes: [sc.name, sc.plannedResponse, sc.notes].filter(Boolean).join(' — '),
        tradeDate: formatDateInTimezone(now),
        tradeTime: formatTimeInTimezone(now),
        strategy: sc.strategy || sc.strategySnapshot?.name || matchedScenario?.strategy || '',
        strategyId: sc.strategyId || matchedScenario?.strategyId,
        strategySnapshot: sc.strategySnapshot || matchedScenario?.strategySnapshot,
        sourceReportId: targetReport.id,
        sourceReportTitle: targetReport.title || `${targetReport.pair} (${targetReport.date})`,
      },
    });
  };

  const handleTriggerRecordTradeFromLiveScenario = (sc: LiveWatchScenario) => {
    if (sc.sourceReportId) {
      const matched = reportsById.get(sc.sourceReportId);
      if (matched) {
        openTakeTradeForReportAndLiveScenario(matched, sc);
        return;
      }
    }
    const defaultPick =
      orderedReportsForPicker.activePairMatches[0]?.id ||
      orderedReportsForPicker.all[0]?.id ||
      '';
    setPickerReportId(defaultPick);
    setReportPickerForLiveScenario(sc);
  };

  const handleConfirmSaveLiveTrade = async (trade: RecordedTrade) => {
    if (!tradeModalState) return;
    const latestReport = reportsById.get(tradeModalState.report.id) || tradeModalState.report;
    const existingTrades = latestReport.trades || [];
    const tradeWithSource: RecordedTrade = {
      ...trade,
      sourceReportId: latestReport.id,
      sourceReportTitle: latestReport.title || `${latestReport.pair} (${latestReport.date})`,
    };
    const nextTrades = existingTrades.some((t) => t.id === tradeWithSource.id)
      ? existingTrades.map((t) => (t.id === tradeWithSource.id ? tradeWithSource : t))
      : [...existingTrades, tradeWithSource];
    const updatedReport: SavedReport = {
      ...latestReport,
      trades: nextTrades,
      updatedAt: Date.now(),
    };
    if (onUpdateReport) {
      await onUpdateReport(updatedReport);
    } else {
      await saveReport(updatedReport);
    }
    setTradeSavedFeedback({
      reportId: updatedReport.id,
      reportTitle: updatedReport.title || `${updatedReport.pair} (${updatedReport.date})`,
      tradeId: tradeWithSource.id,
      direction: tradeWithSource.direction,
      pair: updatedReport.pair,
    });
    setTradeModalState(null);
  };

  const handleResetCurrentInstrument = async () => {
    const updated = await resetLiveInstrument(activePair, userId);
    setWorkspace(updated);
    setManualLastInput('');
    setManualBidInput('');
    setManualAskInput('');
    setShowResetInstrumentConfirm(false);
  };

  const handleResetEntireLiveWorkspace = async () => {
    const updated = await resetLiveWorkspace(userId);
    setWorkspace(updated);
    setManualLastInput('');
    setManualBidInput('');
    setManualAskInput('');
    setShowResetWorkspaceConfirm(false);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center text-xs text-app-secondary">
        Loading Live Workspace...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3.5 sm:px-6 py-5 sm:py-7 space-y-6">
      {/* Page Header & Honest Local-Only Disclosure */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-app">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Activity className="w-6 h-6 text-emerald-theme shrink-0" />
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-app-main">
              Live Workspace
            </h1>
            <span className="text-xs text-app-secondary">·</span>
            <span className="text-xs font-medium text-app-secondary">
              Execution Monitoring &amp; Setup Watch
            </span>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-app-secondary bg-app-field/70 border border-app px-3 py-2 rounded-lg max-w-2xl">
            <Info className="w-3.5 h-3.5 text-emerald-theme shrink-0 mt-0.5" />
            <span>
              <strong className="text-app-main">Local-Only &amp; Foreground Monitoring:</strong>{' '}
              Live workspace scenarios, levels, events, and alert logs are stored strictly locally on this device (included in JSON backups; not synced to cloud accounts). Condition checks and alerts operate only while the app is open in the foreground.
            </span>
          </div>
        </div>

        {/* Instrument Tabs & Reset Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center flex-wrap gap-0.5 p-1 rounded-lg bg-app-secondary border border-app">
            {enabledInstruments.map((pair) => (
              <button
                key={pair}
                type="button"
                onClick={() => handleSelectInstrument(pair)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activePair === pair
                    ? 'bg-emerald-theme text-white shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                {pair}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowResetInstrumentConfirm((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-app-secondary hover:text-rose-600 bg-app-secondary border border-app rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title={`Reset only ${activePair} in Live`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset {activePair}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowResetWorkspaceConfirm((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-300/60 dark:border-rose-900 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Reset all Live instruments and watchlists"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Live</span>
          </button>
        </div>
      </div>

      {/* Inline Reset Confirmations */}
      {showResetInstrumentConfirm && (
        <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-rose-800 dark:text-rose-200 font-medium">
            Clear all {activePair} scenarios, levels, events, alerts, and quote state in Live? Saved Analysis Reports and Journal entries are never affected.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowResetInstrumentConfirm(false)}
              className="px-3 py-1.5 text-xs font-medium text-app-main bg-app-main border border-app rounded cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResetCurrentInstrument}
              className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
            >
              Confirm Reset {activePair}
            </button>
          </div>
        </div>
      )}

      {showResetWorkspaceConfirm && (
        <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-300 dark:border-rose-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-rose-800 dark:text-rose-200 font-medium">
            Reset the entire Live workspace across all configured instruments ({enabledInstruments.join(', ')})? Saved Analysis Reports, Journal entries, and Strategies remain untouched.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowResetWorkspaceConfirm(false)}
              className="px-3 py-1.5 text-xs font-medium text-app-main bg-app-main border border-app rounded cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResetEntireLiveWorkspace}
              className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
            >
              Confirm Reset Live
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Alerts Log Banner (if any unacknowledged or recent alerts exist) */}
      {activeInstrument.alerts.length > 0 && (
        <section className="p-4 rounded-xl border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/20 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-app-main">
              <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Triggered Zone Alerts ({unacknowledgedAlerts.length} active)</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {activeInstrument.alerts.slice(0, 6).map((al) => (
              <div
                key={al.id}
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-app-main border border-app text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-app-main">{al.title}</span>
                    <span className="text-[11px] text-app-secondary">
                      · {new Date(al.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-app-secondary">{al.message}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!al.acknowledged && (
                    <button
                      type="button"
                      onClick={() =>
                        updateInstrument(activePair, (inst) => ({
                          ...inst,
                          alerts: inst.alerts.map((x) => (x.id === al.id ? { ...x, acknowledged: true } : x)),
                        }))
                      }
                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-pale text-emerald-theme rounded border border-emerald-500/30 cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      updateInstrument(activePair, (inst) => ({
                        ...inst,
                        alerts: inst.alerts.filter((x) => x.id !== al.id),
                      }))
                    }
                    className="p-1 text-app-secondary hover:text-rose-500 rounded cursor-pointer"
                    title="Dismiss alert"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top Grid: Price Card + Market Condition Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Price & Feed Status Card */}
        <section className="lg:col-span-7 p-4 sm:p-5 rounded-xl border border-app bg-app-main space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-app/60">
            <div>
              <div className="text-xs font-semibold text-app-secondary">
                Active Instrument &amp; Observed Price
              </div>
              <div className="text-2xl font-extrabold text-app-main tracking-tight">
                {activePair}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border ${quoteHealth.tone}`}>
                {activeInstrument.quote.mode === 'public_rest' && !quoteHealth.stale ? (
                  <Wifi className="w-3.5 h-3.5" />
                ) : activeInstrument.quote.status === 'disconnected' ? (
                  <WifiOff className="w-3.5 h-3.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                <span>{quoteHealth.label}</span>
              </span>

              <div className="inline-flex items-center p-0.5 rounded-lg bg-app-secondary border border-app text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setAutoPollPublic(false);
                    setQuoteFetchError(null);
                    updateInstrument(activePair, (inst) => ({
                      ...inst,
                      quote: {
                        ...inst.quote,
                        mode: 'manual',
                        provider: 'Manual Observation',
                        priceType: 'manual',
                        status: inst.quote.price !== null ? 'manual' : 'disconnected',
                      },
                    }));
                  }}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                    activeInstrument.quote.mode === 'manual'
                      ? 'bg-app-main text-app-main shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateInstrument(activePair, (inst) => ({
                      ...inst,
                      quote: {
                        ...inst.quote,
                        mode: 'public_rest',
                      },
                    }));
                  }}
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                    activeInstrument.quote.mode === 'public_rest'
                      ? 'bg-app-main text-app-main shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  Public Feed
                </button>
              </div>
            </div>
          </div>

          {/* Large Price Readout */}
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold font-mono tabular-nums text-app-main">
                {activeInstrument.quote.price !== null ? activeInstrument.quote.price : '—'}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-app-secondary mt-1 font-mono tabular-nums">
                {activeInstrument.quote.bid !== null && activeInstrument.quote.bid !== undefined && (
                  <span>Bid: {activeInstrument.quote.bid}</span>
                )}
                {activeInstrument.quote.ask !== null && activeInstrument.quote.ask !== undefined && (
                  <span>· Ask: {activeInstrument.quote.ask}</span>
                )}
                <span>
                  Quote type:{' '}
                  {activeInstrument.quote.mode === 'public_rest'
                    ? `Spot (${activeInstrument.quote.priceType})`
                    : 'Manual'}
                </span>
                {activeInstrument.quote.mode === 'public_rest' && activePair === 'BTCUSD' && (
                  <span className="font-sans text-[11px] text-amber-700 dark:text-amber-300">
                    · Public spot reference (not Exness bid/ask)
                  </span>
                )}
              </div>
            </div>

            <div className="text-right text-[11px] text-app-secondary space-y-0.5">
              <div className="font-semibold text-app-main">
                Source: {activeInstrument.quote.mode === 'manual' ? `Manual (${activePair})` : activeInstrument.quote.provider}
              </div>
              <div className="font-mono tabular-nums">
                {activeInstrument.quote.mode === 'public_rest' ? (
                  activeInstrument.quote.providerTimestamp ? (
                    `Provider timestamp: ${new Date(activeInstrument.quote.providerTimestamp).toLocaleString()}`
                  ) : activeInstrument.quote.fetchedAt ? (
                    `Retrieval time: ${new Date(activeInstrument.quote.fetchedAt).toLocaleString()}`
                  ) : (
                    'Not fetched yet'
                  )
                ) : activeInstrument.quote.timestamp ? (
                  `Manual entry time: ${new Date(activeInstrument.quote.timestamp).toLocaleString()}`
                ) : (
                  'No manual observation recorded'
                )}
              </div>
            </div>
          </div>

          {/* Manual vs Public Feed Controls */}
          {activeInstrument.quote.mode === 'public_rest' ? (
            <div className="p-3 rounded-lg bg-app-secondary/50 border border-app space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-app-secondary">
                  {activePair === 'BTCUSD'
                    ? 'Source: Coinbase BTC-USD spot price (last spot quote; not Exness bid/ask). Timestamp shows provider time when supplied or device retrieval time.'
                    : `No public unauthenticated live feed is configured for ${activePair}. Switch to Manual for user-entered ${activePair} observations.`}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {activePair === 'BTCUSD' && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-app-main cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoPollPublic}
                        onChange={(e) => setAutoPollPublic(e.target.checked)}
                        className="rounded text-emerald-theme"
                      />
                      <span>Auto 15s</span>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={handleFetchPublicQuote}
                    disabled={isFetchingQuote}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isFetchingQuote ? 'animate-spin' : ''}`} />
                    <span>{isFetchingQuote ? 'Refreshing...' : 'Refresh Quote'}</span>
                  </button>
                </div>
              </div>
              {quoteFetchError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                  {quoteFetchError}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSaveManualQuote} className="p-3 rounded-lg bg-app-secondary/50 border border-app space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-app-secondary mb-1">
                    Observed Price
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualLastInput}
                    onChange={(e) => setManualLastInput(e.target.value)}
                    placeholder={
                      activePair === 'XAUUSD'
                        ? 'e.g. 2685.50'
                        : activePair === 'BTCUSD'
                        ? 'e.g. 94250'
                        : activePair === 'EURUSD'
                        ? 'e.g. 1.0845'
                        : `Observed ${activePair} price`
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-app-main border border-app font-mono tabular-nums text-xs text-app-main"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-app-secondary mb-1">
                    Bid (Optional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualBidInput}
                    onChange={(e) => setManualBidInput(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-1.5 rounded bg-app-main border border-app font-mono tabular-nums text-xs text-app-main"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-app-secondary mb-1">
                    Ask (Optional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={manualAskInput}
                    onChange={(e) => setManualAskInput(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-1.5 rounded bg-app-main border border-app font-mono tabular-nums text-xs text-app-main"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded cursor-pointer"
                >
                  Update Price
                </button>
              </div>
              {quoteFetchError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                  {quoteFetchError}
                </div>
              )}
            </form>
          )}
        </section>

        {/* Market Condition Summary Card */}
        <section className="lg:col-span-5 p-4 sm:p-5 rounded-xl border border-app bg-app-main flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-app-main">
              {activePair} Condition Summary
            </h2>
            <p className="text-[11px] text-app-secondary">
              Track active liquidity draw, session narrative, and what must happen before entry.
            </p>
          </div>
          <textarea
            rows={5}
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            value={activeInstrument.marketConditionSummary}
            onChange={(e) => {
              const val = e.target.value;
              updateInstrument(activePair, (inst) => ({
                ...inst,
                marketConditionSummary: val,
                updatedAt: Date.now(),
              }));
            }}
            placeholder={`Current ${activePair} narrative: key HTF POI, session sweep status, or stand-aside rules...`}
            className="w-full flex-1 px-3 py-2 text-xs bg-app-field border border-app rounded-lg text-app-main focus:outline-hidden focus:border-emerald-600 resize-y leading-relaxed"
          />
        </section>
      </div>

      {/* Saved Trade Feedback Banner */}
      {tradeSavedFeedback && (
        <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-app-main">
            <CheckCircle2 className="w-4 h-4 text-emerald-theme shrink-0" />
            <span>
              Trade recorded in <strong className="font-bold">{tradeSavedFeedback.reportTitle}</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {onLaunchJournalFromTrade && (
              <button
                type="button"
                onClick={() =>
                  onLaunchJournalFromTrade({
                    targetPhase: 'inTrade',
                    mode: 'create',
                    linkedReportId: tradeSavedFeedback.reportId,
                    linkedReportTitle: tradeSavedFeedback.reportTitle,
                    linkedTradeId: tradeSavedFeedback.tradeId,
                    pair: tradeSavedFeedback.pair,
                  })
                }
                className="px-2.5 py-1 rounded bg-emerald-theme text-white font-semibold hover:bg-emerald-theme-hover cursor-pointer"
              >
                Open in Journal
              </button>
            )}
            {onOpenReport && (
              <button
                type="button"
                onClick={() => onOpenReport(tradeSavedFeedback.reportId)}
                className="px-2.5 py-1 rounded bg-app-main border border-app text-app-main font-semibold hover:bg-app-field cursor-pointer"
              >
                View Report
              </button>
            )}
            <button
              type="button"
              onClick={() => setTradeSavedFeedback(null)}
              className="p-1 text-app-secondary hover:text-app-main cursor-pointer"
              aria-label="Dismiss trade confirmation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Load Report Reference Section */}
      <section className="p-4 sm:p-5 rounded-xl border border-app bg-app-main space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-theme" />
              <h2 className="text-sm font-bold text-app-main">
                Load Report Reference ({activePair})
              </h2>
            </div>
            <p className="text-[11px] text-app-secondary mt-0.5">
              Pull saved analysis scenarios into Live as read-only references or independent watch copies.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              aria-label="Load Saved Report in Live"
              value={loadedReport ? loadedReport.id : ''}
              onChange={(e) => {
                setSelectedReportId(e.target.value);
                setLoadedScenarioExpandedMap({});
              }}
              className="px-3 py-2 rounded-lg bg-app-field border border-app text-xs font-medium text-app-main max-w-full sm:max-w-xs cursor-pointer"
            >
              <option value="">
                {orderedReportsForPicker.all.length === 0
                  ? 'No saved reports available'
                  : `Select a saved report (${orderedReportsForPicker.activePairMatches.length} for ${activePair})...`}
              </option>
              {orderedReportsForPicker.activePairMatches.length > 0 && (
                <optgroup label={`${activePair} Reports`}>
                  {orderedReportsForPicker.activePairMatches.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.title || 'Analysis')} — {r.pair} · Analysis {r.date}{r.time ? ` ${r.time}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {orderedReportsForPicker.others.length > 0 && (
                <optgroup label="Other Instruments">
                  {orderedReportsForPicker.others.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.title || 'Analysis')} — {r.pair} · Analysis {r.date}{r.time ? ` ${r.time}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {loadedReport && onOpenReport && (
              <button
                type="button"
                onClick={() => onOpenReport(loadedReport.id)}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-theme bg-emerald-pale rounded-lg border border-emerald-500/30 hover:opacity-90 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>View Report</span>
              </button>
            )}
          </div>
        </div>

        {selectedReportId && !loadedReport && (
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300/70 text-[11px] text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>The previously selected source report is no longer available in saved reports. Copied Live watch scenarios remain preserved.</span>
          </div>
        )}

        {loadedReport && (
          <div className="p-3.5 rounded-xl bg-app-secondary/40 border border-app space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-app/60">
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-app-main">
                  {loadedReport.title || `${loadedReport.pair} Analysis`}
                </div>
                <div className="text-[11px] text-app-secondary flex flex-wrap items-center gap-2">
                  <span>Instrument: <strong className="text-app-main">{loadedReport.pair}</strong></span>
                  <span>·</span>
                  <span>Analysis Date/Time: <strong className="font-mono text-app-main">{loadedReport.date}{loadedReport.time ? ` ${loadedReport.time}` : ''}</strong></span>
                  <span>·</span>
                  <span>Session: <strong className="text-app-main">{loadedReport.session}</strong></span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReportId('')}
                className="text-[11px] text-app-secondary hover:text-app-main px-2 py-1 rounded border border-app bg-app-main cursor-pointer"
              >
                Unload Reference
              </button>
            </div>

            {(!loadedReport.scenarios || loadedReport.scenarios.length === 0) ? (
              <p className="text-[11px] text-app-secondary italic">
                No planned scenarios saved in this report. You can still record a discretionary trade via Record Trade on any Watch Scenario.
              </p>
            ) : (
              <div className="space-y-2">
                {loadedReport.scenarios.map((sc, idx) => {
                  const isExp = Boolean(loadedScenarioExpandedMap[sc.id]);
                  const headline = sc.label || `Scenario ${idx + 1}`;
                  const stratLabel = sc.strategy || sc.strategySnapshot?.name;
                  return (
                    <div key={sc.id} className="p-3 rounded-lg bg-app-main border border-app space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-sm text-app-main">{headline}</span>
                          {sc.direction && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                                sc.direction === 'Buy'
                                  ? 'bg-emerald-pale text-bullish border-emerald-500/40'
                                  : 'bg-bearish-pale text-bearish border-rose-500/40'
                              }`}
                            >
                              {sc.direction}
                            </span>
                          )}
                          {stratLabel && (
                            <span className="text-[11px] font-semibold text-emerald-theme">
                              · {stratLabel}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleCopyLoadedScenarioToLive(loadedReport, sc)}
                            className="px-2.5 py-1 rounded text-[11px] font-semibold text-emerald-theme bg-emerald-pale border border-emerald-500/30 hover:opacity-90 cursor-pointer"
                          >
                            {copiedLoadedScenarioId === sc.id ? 'Copied!' : 'Copy into Live'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openTakeTradeForReportAndLiveScenario(
                                loadedReport,
                                {
                                  ...createEmptyScenarioDraft(),
                                  name: headline,
                                  direction: sc.direction === 'Sell' ? 'Sell' : 'Buy',
                                  strategy: stratLabel || '',
                                  strategyId: sc.strategyId,
                                  strategySnapshot: sc.strategySnapshot,
                                  plannedResponse: sc.description || '',
                                  sourceReportId: loadedReport.id,
                                  sourceScenarioId: sc.id,
                                },
                                sc
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover cursor-pointer"
                          >
                            <TrendingUp className="w-3 h-3" />
                            <span>Record Trade</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setLoadedScenarioExpandedMap((prev) => ({ ...prev, [sc.id]: !isExp }))
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-app-secondary hover:text-app-main border border-app bg-app-field cursor-pointer"
                          >
                            {isExp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            <span>{isExp ? 'Hide' : 'Details'}</span>
                          </button>
                        </div>
                      </div>

                      {isExp && (
                        <div className="pt-2 border-t border-app/60 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                          {sc.description && (
                            <div className="p-2 rounded bg-app-field/60 border border-app/50">
                              <div className="font-bold text-app-secondary mb-0.5">Narrative</div>
                              <div className="text-app-main whitespace-pre-wrap">{sc.description}</div>
                            </div>
                          )}
                          {sc.entryConditions && (
                            <div className="p-2 rounded bg-app-field/60 border border-app/50">
                              <div className="font-bold text-app-secondary mb-0.5">Entry Rules</div>
                              <div className="text-app-main whitespace-pre-wrap">{sc.entryConditions}</div>
                            </div>
                          )}
                          {sc.invalidationConditions && (
                            <div className="p-2 rounded bg-app-field/60 border border-app/50">
                              <div className="font-bold text-app-secondary mb-0.5">Invalidation</div>
                              <div className="text-app-main whitespace-pre-wrap">{sc.invalidationConditions}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Watch Scenarios Section */}
      <section className="p-4 sm:p-5 rounded-xl border border-app bg-app-main space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-app/60">
          <div>
            <h2 className="text-base font-bold text-app-main">
              Watch Scenarios ({activeInstrument.scenarios.length})
            </h2>
            <p className="text-xs text-app-secondary">
              Monitor planned entry zones, confirmation requirements, and invalidations. Level hits automatically enter awaiting confirmation and never auto-confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={openNewScenario}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-lg shadow-2xs cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Watch Scenario</span>
          </button>
        </div>

        {activeInstrument.scenarios.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-app rounded-xl bg-app-field/30 space-y-2.5">
            <Activity className="w-8 h-8 text-app-secondary mx-auto opacity-50" />
            <div className="text-sm font-bold text-app-main">No {activePair} Watch Scenarios</div>
            <p className="text-xs text-app-secondary max-w-md mx-auto">
              Add a watch scenario here or use &ldquo;Copy into Live&rdquo; from any Planned Scenario in Analysis or Reports.
            </p>
            <button
              type="button"
              onClick={openNewScenario}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Watch Scenario</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {activeInstrument.scenarios.map((sc) => (
              <div
                key={sc.id}
                className={`p-4 rounded-xl border bg-app-secondary/30 space-y-2.5 text-xs ${
                  sc.status === 'Invalidated'
                    ? 'border-rose-300/70 dark:border-rose-900/60 opacity-85'
                    : sc.status === 'Level reached' || sc.status === 'Awaiting confirmation'
                    ? 'border-amber-400/70 dark:border-amber-700/70'
                    : sc.status === 'Confirmed'
                    ? 'border-emerald-500/60'
                    : 'border-app'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2 pb-2 border-b border-app/50">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-app-main">{sc.name}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                          sc.direction === 'Buy'
                            ? 'bg-emerald-pale text-bullish border-emerald-500/40'
                            : 'bg-bearish-pale text-bearish border-rose-500/40'
                        }`}
                      >
                        {sc.direction}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded border border-app bg-app-main text-app-main">
                        {sc.status}
                      </span>
                      <span className="text-[11px] text-app-secondary">
                        · {sc.priority}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-app-secondary font-mono tabular-nums">
                      {sc.targetZoneOrLevel && (
                        <span>Zone/Level: <strong className="text-app-main">{sc.targetZoneOrLevel}</strong></span>
                      )}
                      {sc.confirmationTimeframe && (
                        <span>· {sc.confirmationTimeframe} {sc.requiresCandleClose ? 'Candle Close' : 'Touch'}</span>
                      )}
                      {sc.invalidationLevel && (
                        <span>· Invalidation: <strong className="text-rose-600 dark:text-rose-400">{sc.invalidationLevel}</strong></span>
                      )}
                      {(sc.strategy || sc.strategySnapshot?.name) && (
                        <span className="font-sans text-emerald-theme font-semibold">
                          · Strategy: {sc.strategy || sc.strategySnapshot?.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    <select
                      value={sc.status}
                      onChange={(e) => handleScenarioStatusChange(sc.id, e.target.value as LiveScenarioStatus)}
                      aria-label={`Change status for ${sc.name}`}
                      className="px-2 py-1 rounded bg-app-main border border-app text-[11px] font-semibold text-app-main cursor-pointer"
                    >
                      {LIVE_SCENARIO_STATUSES.map((st: LiveScenarioStatus) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        updateInstrument(activePair, (inst) => ({
                          ...inst,
                          scenarios: inst.scenarios.map((x) =>
                            x.id === sc.id ? { ...x, alertOnZoneTouch: !x.alertOnZoneTouch, updatedAt: Date.now() } : x
                          ),
                        }))
                      }
                      className="p-1.5 rounded border border-app bg-app-main text-app-secondary hover:text-app-main cursor-pointer"
                      title={sc.alertOnZoneTouch ? 'Mute zone alerts' : 'Enable zone alerts'}
                    >
                      {sc.alertOnZoneTouch ? <Bell className="w-3.5 h-3.5 text-emerald-theme" /> : <BellOff className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleScenarioStatusChange(sc.id, sc.status === 'Paused' ? 'Waiting' : 'Paused')
                      }
                      className="p-1.5 rounded border border-app bg-app-main text-app-secondary hover:text-app-main cursor-pointer"
                      title={sc.status === 'Paused' ? 'Resume watch' : 'Pause watch'}
                    >
                      {sc.status === 'Paused' ? <Play className="w-3.5 h-3.5 text-emerald-theme" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditScenario(sc)}
                      className="p-1.5 rounded border border-app bg-app-main text-app-secondary hover:text-app-main cursor-pointer"
                      title="Edit watch scenario"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    {confirmDeleteScenarioId === sc.id ? (
                      <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded px-1.5 py-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleDeleteScenario(sc.id)}
                          className="px-2 py-0.5 bg-rose-600 text-white font-bold rounded cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteScenarioId(null)}
                          className="px-1.5 py-0.5 text-app-secondary cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteScenarioId(sc.id)}
                        className="p-1.5 rounded border border-app bg-app-main text-app-secondary hover:text-rose-500 cursor-pointer"
                        title="Delete watch scenario"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px]">
                  {sc.triggerConditions && (
                    <div className="p-2 rounded bg-app-main border border-app/60">
                      <div className="font-bold text-app-secondary mb-0.5">Trigger Conditions</div>
                      <div className="text-app-main whitespace-pre-wrap">{sc.triggerConditions}</div>
                    </div>
                  )}
                  {sc.confirmationType && (
                    <div className="p-2 rounded bg-app-main border border-app/60">
                      <div className="font-bold text-app-secondary mb-0.5">Confirmation Required</div>
                      <div className="text-app-main whitespace-pre-wrap">{sc.confirmationType}</div>
                    </div>
                  )}
                  {sc.plannedResponse && (
                    <div className="p-2 rounded bg-app-main border border-app/60">
                      <div className="font-bold text-app-secondary mb-0.5">Planned Response</div>
                      <div className="text-app-main whitespace-pre-wrap">{sc.plannedResponse}</div>
                    </div>
                  )}
                </div>

                {sc.notes && (
                  <p className="text-[11px] text-app-secondary italic">{sc.notes}</p>
                )}

                <div className="pt-2 border-t border-app/50 flex flex-wrap items-center justify-between gap-2 text-[11px] text-app-secondary">
                  <div className="flex flex-wrap items-center gap-2">
                    {sc.sourceReportId && (() => {
                      const matchedSource = reportsById.get(sc.sourceReportId);
                      const wasModifiedAfterCopy = Boolean(
                        matchedSource && sc.createdAt && matchedSource.updatedAt > sc.createdAt
                      );
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          {matchedSource && onOpenReport ? (
                            <button
                              type="button"
                              onClick={() => onOpenReport(sc.sourceReportId!)}
                              className="inline-flex items-center gap-1 font-medium text-emerald-theme hover:underline cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Copied from Report: {sc.sourceReportTitle || sc.sourceReportId}</span>
                            </button>
                          ) : (
                            <span>
                              Copied from Report: {sc.sourceReportTitle || sc.sourceReportId}
                              {!matchedSource && ' (source report deleted — Live copy preserved)'}
                            </span>
                          )}
                          {wasModifiedAfterCopy && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 text-amber-800 dark:text-amber-300 text-[10px]">
                              Source modified since copy
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleTriggerRecordTradeFromLiveScenario(sc)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-theme hover:bg-emerald-theme-hover text-white font-semibold text-[11px] cursor-pointer"
                  >
                    <TrendingUp className="w-3 h-3" />
                    <span>Record Trade</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Bottom 2-Column Section: Key Levels/Zones + Manual Events/News Watch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Key Levels & Zones */}
        <section className="p-4 sm:p-5 rounded-xl border border-app bg-app-main space-y-3.5">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-app/60">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-theme" />
              <h2 className="text-sm font-bold text-app-main">
                Key Levels &amp; Zones ({activeInstrument.keyLevels.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={openNewLevel}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-theme bg-emerald-pale rounded hover:opacity-90 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Level</span>
            </button>
          </div>

          {isLevelEditorOpen && (
            <form onSubmit={handleSaveLevel} className="p-3 rounded-lg bg-app-secondary/50 border border-emerald-500/40 space-y-2.5 text-xs">
              {levelError && (
                <div className="text-rose-600 dark:text-rose-400 font-medium">{levelError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  spellCheck
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  value={levelDraft.label}
                  onChange={(e) => setLevelDraft((p) => ({ ...p, label: e.target.value }))}
                  placeholder="Label (e.g. Daily Supply POI)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
                />
                <input
                  type="text"
                  value={levelDraft.price}
                  onChange={(e) => setLevelDraft((p) => ({ ...p, price: e.target.value }))}
                  placeholder="Price / range (e.g. 2680.50 - 2685.00)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app font-mono tabular-nums text-app-main"
                />
                <select
                  value={levelDraft.type}
                  onChange={(e) => setLevelDraft((p) => ({ ...p, type: e.target.value as LiveLevelZone['type'] }))}
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main cursor-pointer"
                >
                  {ZONE_TYPES.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={levelDraft.timeframe || ''}
                  onChange={(e) => setLevelDraft((p) => ({ ...p, timeframe: e.target.value as TimeframeId | '' }))}
                  placeholder="Timeframe (e.g. 4H, 1H)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
                />
              </div>
              <input
                type="text"
                spellCheck
                autoCorrect="on"
                autoCapitalize="sentences"
                value={levelDraft.notes || ''}
                onChange={(e) => setLevelDraft((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional note..."
                className="w-full px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
              />
              {showLevelDiscardConfirm && (
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 flex items-center justify-between gap-2">
                  <span className="text-amber-900 dark:text-amber-200 font-medium">Discard level changes?</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowLevelDiscardConfirm(false)}
                      className="px-2 py-1 bg-app-main border border-app rounded cursor-pointer"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsLevelEditorOpen(false);
                        setShowLevelDiscardConfirm(false);
                      }}
                      className="px-2 py-1 bg-rose-600 text-white rounded font-semibold cursor-pointer"
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRequestCloseLevelEditor}
                  className="px-3 py-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-emerald-theme text-white font-semibold rounded cursor-pointer"
                >
                  {editingLevelId ? 'Save Changes' : 'Save Level'}
                </button>
              </div>
            </form>
          )}

          {activeInstrument.keyLevels.length === 0 ? (
            <p className="text-xs text-app-secondary italic py-3">
              No key levels added for {activePair}.
            </p>
          ) : (
            <div className="space-y-2">
              {activeInstrument.keyLevels.map((lvl: LiveLevelZone) => (
                <div
                  key={lvl.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-app-field/50 border border-app text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-app-main">{lvl.label}</span>
                      <span className="font-mono font-bold tabular-nums text-emerald-theme">
                        {lvl.price}
                      </span>
                      <span className="text-[11px] text-app-secondary">
                        · {lvl.type}{lvl.timeframe ? ` · ${lvl.timeframe}` : ''}
                      </span>
                    </div>
                    {lvl.notes && <p className="text-[11px] text-app-secondary">{lvl.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditLevel(lvl)}
                      className="p-1 text-app-secondary hover:text-app-main cursor-pointer"
                      title="Edit level"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDeleteLevelId === lvl.id ? (
                      <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-300 text-[10px]">
                        <button
                          type="button"
                          onClick={() => handleDeleteLevel(lvl.id)}
                          className="px-1.5 py-0.5 bg-rose-600 text-white rounded font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteLevelId(null)}
                          className="px-1 text-app-secondary cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteLevelId(lvl.id)}
                        className="p-1 text-app-secondary hover:text-rose-500 cursor-pointer"
                        title="Delete level"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Manual Events & News Watch */}
        <section className="p-4 sm:p-5 rounded-xl border border-app bg-app-main space-y-3.5">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-app/60">
            <div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-theme" />
                <h2 className="text-sm font-bold text-app-main">
                  Manual Events &amp; News Watch ({activeInstrument.events.length})
                </h2>
              </div>
              <p className="text-[11px] text-app-secondary mt-0.5">
                Manual session &amp; economic catalyst reminders (no external news feed connected).
              </p>
            </div>
            <button
              type="button"
              onClick={openNewEvent}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-theme bg-emerald-pale rounded hover:opacity-90 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Event</span>
            </button>
          </div>

          {isEventEditorOpen && (
            <form onSubmit={handleSaveEvent} className="p-3 rounded-lg bg-app-secondary/50 border border-emerald-500/40 space-y-2.5 text-xs">
              {eventError && (
                <div className="text-rose-600 dark:text-rose-400 font-medium">{eventError}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  spellCheck
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  value={eventDraft.title}
                  onChange={(e) => setEventDraft((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Event title (e.g. US CPI Release)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
                />
                <input
                  type="text"
                  value={eventDraft.scheduledTime}
                  onChange={(e) => setEventDraft((p) => ({ ...p, scheduledTime: e.target.value }))}
                  placeholder="Time (e.g. 13:30)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app font-mono tabular-nums text-app-main"
                />
                <select
                  value={eventDraft.impact}
                  onChange={(e) => setEventDraft((p) => ({ ...p, impact: e.target.value as 'High' | 'Medium' | 'Low' }))}
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main cursor-pointer"
                >
                  <option value="High">High Impact</option>
                  <option value="Medium">Medium Impact</option>
                  <option value="Low">Low Impact</option>
                </select>
                <input
                  type="text"
                  value={eventDraft.currencyOrInstrument}
                  onChange={(e) => setEventDraft((p) => ({ ...p, currencyOrInstrument: e.target.value }))}
                  placeholder="Currency (e.g. USD)"
                  className="px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
                />
              </div>
              <input
                type="text"
                spellCheck
                autoCorrect="on"
                autoCapitalize="sentences"
                value={eventDraft.notes || ''}
                onChange={(e) => setEventDraft((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Rule / expected volatility note..."
                className="w-full px-2.5 py-1.5 rounded bg-app-main border border-app text-app-main"
              />
              {showEventDiscardConfirm && (
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 flex items-center justify-between gap-2">
                  <span className="text-amber-900 dark:text-amber-200 font-medium">Discard event changes?</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowEventDiscardConfirm(false)}
                      className="px-2 py-1 bg-app-main border border-app rounded cursor-pointer"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEventEditorOpen(false);
                        setShowEventDiscardConfirm(false);
                      }}
                      className="px-2 py-1 bg-rose-600 text-white rounded font-semibold cursor-pointer"
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRequestCloseEventEditor}
                  className="px-3 py-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-emerald-theme text-white font-semibold rounded cursor-pointer"
                >
                  {editingEventId ? 'Save Changes' : 'Save Event'}
                </button>
              </div>
            </form>
          )}

          {activeInstrument.events.length === 0 ? (
            <p className="text-xs text-app-secondary italic py-3">
              No manual events recorded for {activePair}.
            </p>
          ) : (
            <div className="space-y-2">
              {activeInstrument.events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-app-field/50 border border-app text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-app-main">{ev.title}</span>
                      {ev.scheduledTime && (
                        <span className="font-mono tabular-nums text-[11px] text-emerald-theme font-semibold">
                          {ev.scheduledTime}
                        </span>
                      )}
                      <span className="text-[11px] text-app-secondary">
                        · {ev.impact} · {ev.currencyOrInstrument} · {ev.status}
                      </span>
                    </div>
                    {ev.notes && <p className="text-[11px] text-app-secondary">{ev.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditEvent(ev)}
                      className="p-1 text-app-secondary hover:text-app-main cursor-pointer"
                      title="Edit event"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    {confirmDeleteEventId === ev.id ? (
                      <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-300 text-[10px]">
                        <button
                          type="button"
                          onClick={() => handleDeleteEvent(ev.id)}
                          className="px-1.5 py-0.5 bg-rose-600 text-white rounded font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteEventId(null)}
                          className="px-1 text-app-secondary cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEventId(ev.id)}
                        className="p-1 text-app-secondary hover:text-rose-500 cursor-pointer"
                        title="Delete event"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Watch Scenario Add/Edit Modal */}
      {isScenarioModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingScenarioId ? 'Edit Watch Scenario' : 'Add Watch Scenario'}
          onClick={handleRequestCloseScenarioModal}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary">
              <h2 className="text-sm font-bold text-app-main">
                {editingScenarioId ? `Edit Watch Scenario (${activePair})` : `New Watch Scenario (${activePair})`}
              </h2>
              <button
                type="button"
                onClick={handleRequestCloseScenarioModal}
                aria-label="Close watch scenario editor"
                className="p-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveScenario} className="p-5 overflow-y-auto space-y-3.5 text-xs flex-1">
              {scenarioError && (
                <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 font-medium">
                  {scenarioError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-app-main mb-1">
                    Scenario Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    spellCheck
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    value={scenarioDraft.name}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Scenario A — NY Sweep of Asia Low + 15M MSS"
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-app-main mb-1">Direction</label>
                  <select
                    value={scenarioDraft.direction}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, direction: e.target.value as 'Buy' | 'Sell' }))}
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main cursor-pointer"
                  >
                    <option value="Buy">Buy</option>
                    <option value="Sell">Sell</option>
                  </select>
                </div>
              </div>

              <StrategySelector
                userId={userId}
                strategyId={scenarioDraft.strategyId}
                strategy={scenarioDraft.strategy || ''}
                strategySnapshot={scenarioDraft.strategySnapshot}
                onChange={({ strategyId, strategy, strategySnapshot }) =>
                  setScenarioDraft((p) => ({
                    ...p,
                    strategyId,
                    strategy,
                    strategySnapshot,
                  }))
                }
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Target Zone / Level</label>
                  <input
                    type="text"
                    value={scenarioDraft.targetZoneOrLevel}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, targetZoneOrLevel: e.target.value }))}
                    placeholder="e.g. 2680.50 - 2685.00"
                    className="w-full px-3 py-2 rounded bg-app-field border border-app font-mono tabular-nums text-app-main"
                  />
                </div>
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Invalidation Level</label>
                  <input
                    type="text"
                    value={scenarioDraft.invalidationLevel || ''}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, invalidationLevel: e.target.value }))}
                    placeholder="e.g. Close below 2675.00"
                    className="w-full px-3 py-2 rounded bg-app-field border border-app font-mono tabular-nums text-app-main"
                  />
                </div>
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Confirmation Timeframe</label>
                  <select
                    value={scenarioDraft.confirmationTimeframe}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, confirmationTimeframe: e.target.value as LiveConfirmationTimeframe }))}
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main cursor-pointer"
                  >
                    {CONFIRMATION_TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>{tf}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Trigger Conditions</label>
                  <textarea
                    rows={2}
                    spellCheck
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    value={scenarioDraft.triggerConditions}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, triggerConditions: e.target.value }))}
                    placeholder="What price action or liquidity sweep puts this setup in play?"
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main"
                  />
                </div>
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Confirmation Criteria</label>
                  <textarea
                    rows={2}
                    spellCheck
                    autoCorrect="on"
                    autoCapitalize="sentences"
                    value={scenarioDraft.confirmationType}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, confirmationType: e.target.value }))}
                    placeholder="e.g. 15M MSS + FVG displacement"
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">Planned Response / Execution Plan</label>
                <textarea
                  rows={2}
                  spellCheck
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  value={scenarioDraft.plannedResponse}
                  onChange={(e) => setScenarioDraft((p) => ({ ...p, plannedResponse: e.target.value }))}
                  placeholder="Entry trigger, stop placement, and TP1/TP2 management..."
                  className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                <div>
                  <label className="block font-medium text-app-secondary mb-1">Priority</label>
                  <select
                    value={scenarioDraft.priority}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, priority: e.target.value as 'High' | 'Medium' | 'Low' }))}
                    className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main cursor-pointer"
                  >
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(scenarioDraft.requiresCandleClose)}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, requiresCandleClose: e.target.checked }))}
                    className="rounded text-emerald-theme"
                  />
                  <span className="text-app-main font-medium">Require candle close confirmation</span>
                </label>
                <label className="inline-flex items-center gap-2 pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scenarioDraft.alertOnZoneTouch}
                    onChange={(e) => setScenarioDraft((p) => ({ ...p, alertOnZoneTouch: e.target.checked }))}
                    className="rounded text-emerald-theme"
                  />
                  <span className="text-app-main font-medium">Zone alert enabled</span>
                </label>
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">Notes</label>
                <input
                  type="text"
                  spellCheck
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  value={scenarioDraft.notes || ''}
                  onChange={(e) => setScenarioDraft((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional observation notes..."
                  className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main"
                />
              </div>

              {showScenarioDiscardConfirm && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-amber-900 dark:text-amber-200">
                    Discard unsaved watch scenario changes?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowScenarioDiscardConfirm(false)}
                      className="px-3 py-1 bg-app-main border border-app rounded font-medium cursor-pointer"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsScenarioModalOpen(false);
                        setEditingScenarioId(null);
                        setShowScenarioDiscardConfirm(false);
                      }}
                      className="px-3 py-1 bg-rose-600 text-white rounded font-semibold cursor-pointer"
                    >
                      Discard changes
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-app">
                <button
                  type="button"
                  onClick={handleRequestCloseScenarioModal}
                  className="px-4 py-2 text-xs font-medium text-app-secondary hover:text-app-main rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-lg shadow-2xs cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingScenarioId ? 'Save Changes' : 'Save Watch Scenario'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Explicit Target Report Chooser for Live Record Trade */}
      {reportPickerForLiveScenario && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose Saved Report for Trade"
          onClick={() => setReportPickerForLiveScenario(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-app-main border border-app rounded-xl shadow-2xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-app pb-2.5">
              <h3 className="text-sm font-bold text-app-main">Select Target Saved Report</h3>
              <button
                type="button"
                onClick={() => setReportPickerForLiveScenario(null)}
                className="p-1 text-app-secondary hover:text-app-main cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {orderedReportsForPicker.all.length === 0 ? (
              <div className="p-4 rounded-lg bg-app-field border border-app text-app-secondary space-y-2">
                <p className="font-semibold text-app-main">No Saved Reports Found</p>
                <p>
                  Trades are stored on an existing Analysis Report so discipline and history stay consistent. Save an Analysis Report first, then record your trade here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-app-secondary">
                  Choose which existing Analysis Report should record the trade from <strong className="text-app-main">{reportPickerForLiveScenario.name}</strong>. Your Live Watch Scenario will remain untouched.
                </p>
                <select
                  value={pickerReportId}
                  onChange={(e) => setPickerReportId(e.target.value)}
                  aria-label="Target saved report"
                  className="w-full px-3 py-2 rounded bg-app-field border border-app text-app-main cursor-pointer"
                >
                  {orderedReportsForPicker.all.map((r) => (
                    <option key={r.id} value={r.id}>
                      {(r.title || 'Analysis')} — {r.pair} ({r.date}{r.time ? ` ${r.time}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-app">
              <button
                type="button"
                onClick={() => setReportPickerForLiveScenario(null)}
                className="px-3 py-1.5 text-app-secondary hover:text-app-main rounded cursor-pointer"
              >
                Cancel
              </button>
              {orderedReportsForPicker.all.length > 0 && (
                <button
                  type="button"
                  disabled={!pickerReportId}
                  onClick={() => {
                    const target = reportsById.get(pickerReportId);
                    const sc = reportPickerForLiveScenario;
                    setReportPickerForLiveScenario(null);
                    if (target && sc) {
                      openTakeTradeForReportAndLiveScenario(target, sc);
                    }
                  }}
                  className="px-4 py-1.5 bg-emerald-theme text-white font-semibold rounded hover:bg-emerald-theme-hover cursor-pointer disabled:opacity-40"
                >
                  Continue to Trade Form
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shared Record Trade Modal triggered from Live */}
      {tradeModalState && (
        <TakeTradeModal
          isOpen={true}
          onClose={() => setTradeModalState(null)}
          report={tradeModalState.report}
          initialTradeDraft={tradeModalState.draft}
          onSaveTrade={handleConfirmSaveLiveTrade}
          onSavePreparationJournal={onSavePreparationJournal}
          userId={userId}
        />
      )}
    </div>
  );
};
