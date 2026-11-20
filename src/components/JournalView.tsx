import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Filter,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Link as LinkIcon,
  Tag,
  Smile,
  AlertTriangle,
  Trash2,
  Edit3,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  Save,
  X,
  Sparkles,
  PenTool,
  EyeOff,
  Sliders,
  Info,
  BookMarked,
} from 'lucide-react';
import {
  DEFAULT_INSTRUMENTS_CONFIG,
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  EmotionalReadiness,
  getEnabledInstrumentSymbols,
  getSelectorInstrumentOptions,
  IN_TRADE_MINDSET_PRESETS,
  IN_TRADE_OBSERVATION_PRESETS,
  InstrumentsConfig,
  JournalDailyReflection,
  JournalEntry,
  JournalEntryType,
  JournalInTrade,
  JournalLaunchContext,
  JournalPhaseKey,
  JournalPostTrade,
  JournalPreTrade,
  JournalPrep,
  JournalVisibilityConfig,
  normalizeInstrumentSymbol,
  normalizeReadinessStates,
  SavedReport,
  TradingPair,
  TradingSession,
} from '../types/journal';
import { registerBackHandler } from '../utils/backNavigation';
import {
  clearJournalDraft,
  deleteJournalEntry,
  getAllJournalEntries,
  getJournalDraft,
  getScopedContextualSuggestions,
  isJournalEntryOwnedByScope,
  normalizeAccountScope,
  saveJournalDraft,
  saveJournalEntry,
  ScopedContextualSuggestions,
} from '../services/db';
import { MyJournalSection } from './MyJournalSection';
import { StrategiesSection } from './StrategiesSection';

const EMOTIONAL_STATES: EmotionalReadiness[] = [
  'Optimal / Calm',
  'Focused',
  'Anxious',
  'Fatigued',
  'Overconfident',
  'Distracted',
];

const COMMON_SETUP_TAGS = [
  'Liquidity Sweep + MSS',
  'Order Block Tap',
  'Fair Value Gap',
  'Internal BOS Retest',
  'Break & Retest',
  'Range Fade',
  'Opening Candle Expansion',
];

const COMMON_MISTAKE_TAGS = [
  'FOMO Entry',
  'Chased Price',
  'Moved Stop Prematurely',
  'Overleveraged',
  'Ignored HTF Bias',
  'Revenge Trade',
  'Exited Too Early',
  'Traded Outside Session',
];

const COMMON_LESSON_TAGS = [
  'Patience Rewarded',
  'Clean 15M Confirmation',
  'Sized Conservatively',
  'Followed Plan Exactly',
  'Acceptable Planned Loss',
  'Held to Target',
  'Respected Invalidation',
];

const JOURNAL_PHASE_STORAGE_KEY = 'abmax_journal_phase_open_state';

const DEFAULT_OPEN_PHASES: Record<JournalPhaseKey, boolean> = {
  prep: true,
  preTrade: false,
  inTrade: false,
  postTrade: false,
  reflection: false,
};

function loadPersistedOpenPhases(): Record<JournalPhaseKey, boolean> {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_OPEN_PHASES };
  try {
    const raw = localStorage.getItem(JOURNAL_PHASE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPEN_PHASES };
    const parsed = JSON.parse(raw);
    return {
      prep: parsed?.prep !== false,
      preTrade: Boolean(parsed?.preTrade),
      inTrade: Boolean(parsed?.inTrade),
      postTrade: Boolean(parsed?.postTrade),
      reflection: Boolean(parsed?.reflection),
    };
  } catch {
    return { ...DEFAULT_OPEN_PHASES };
  }
}

interface JournalViewProps {
  reportsList: SavedReport[];
  onOpenReport?: (reportId: string) => void;
  userId?: string | null;
  journalVisibilityConfig?: JournalVisibilityConfig;
  onOpenSettings?: (tab?: 'general' | 'journal_visibility' | 'performance_visibility' | 'admin' | 'instruments') => void;
  instrumentsConfig?: InstrumentsConfig;
  journalLaunchRequest?: JournalLaunchContext | null;
  onConsumeJournalLaunchRequest?: () => void;
}

export const JournalView: React.FC<JournalViewProps> = ({
  reportsList,
  onOpenReport,
  userId,
  journalVisibilityConfig = DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  onOpenSettings,
  instrumentsConfig = DEFAULT_INSTRUMENTS_CONFIG,
  journalLaunchRequest,
  onConsumeJournalLaunchRequest,
}) => {
  const [mainJournalTab, setMainJournalTab] = useState<'trading-journal' | 'my-journal' | 'strategies'>('trading-journal');

  useEffect(() => {
    if (mainJournalTab === 'my-journal' && journalVisibilityConfig.myJournal === false) {
      setMainJournalTab('trading-journal');
    }
  }, [mainJournalTab, journalVisibilityConfig.myJournal]);

  // Check if every journal section is hidden
  const isAllHidden = useMemo(() => {
    return Object.values(journalVisibilityConfig).every((val) => val === false);
  }, [journalVisibilityConfig]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [confirmDeleteEntryId, setConfirmDeleteEntryId] = useState<string | null>(null);
  const originalSnapshotRef = useRef<string>('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPair, setSelectedPair] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<string>('all');
  const [selectedRuleStatus, setSelectedRuleStatus] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [filterTradeId, setFilterTradeId] = useState<string | null>(null);

  const filterInstrumentOptions = useMemo(() => {
    const enabled = getEnabledInstrumentSymbols(instrumentsConfig);
    const seen = new Set(enabled);
    const extra: string[] = [];
    for (const e of entries) {
      const sym = normalizeInstrumentSymbol(e.pair || '');
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        extra.push(sym);
      }
    }
    return [
      ...enabled.map((sym) => ({ symbol: sym, label: sym })),
      ...extra.map((sym) => ({ symbol: sym, label: `${sym} (Historical)` })),
    ];
  }, [instrumentsConfig, entries]);

  // Form State
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  const [session, setSession] = useState<TradingSession>('London');
  const [pair, setPair] = useState<TradingPair>(() => getEnabledInstrumentSymbols(instrumentsConfig)[0] || 'XAUUSD');
  const [entryType, setEntryType] = useState<JournalEntryType>('general');
  const [linkedScenarioId, setLinkedScenarioId] = useState('');
  const [linkedScenarioLabel, setLinkedScenarioLabel] = useState('');
  const [linkedTradeId, setLinkedTradeId] = useState('');

  // Sections
  const [prep, setPrep] = useState<JournalPrep>({
    sessionIntention: '',
    readinessState: 'Optimal / Calm',
    readinessStates: ['Optimal / Calm'],
    prioritizedRules: [],
    dailyPlanNotes: '',
  });

  const [preTrade, setPreTrade] = useState<JournalPreTrade>({
    reasonForTrade: '',
    setupTag: '',
    confirmationChecklist: [
      { item: 'HTF liquidity swept / tapped', checked: false },
      { item: 'Clear 15M / 5M MSS confirmation', checked: false },
      { item: 'Aligned with overall bias', checked: false },
      { item: 'Acceptable risk-to-reward ratio', checked: false },
    ],
    plannedRiskR: '1',
    linkedReportId: '',
  });

  const [inTrade, setInTrade] = useState<JournalInTrade>({
    mindsets: [],
    mindsetOther: '',
    managementDecisions: '',
    planAdjustments: '',
    emotionalObservationTags: [],
    emotionalObservations: '',
    timelineNotes: [],
  });

  const [postTrade, setPostTrade] = useState<JournalPostTrade>({
    executionReview: '',
    rulesFollowedStatus: 'Followed',
    mistakeTags: [],
    lessonTags: [],
    repeatOrImprove: '',
  });

  const [reflection, setReflection] = useState<JournalDailyReflection>({
    whatWorked: '',
    whatDidNot: '',
    keyLessons: '',
    nextSessionCommitment: '',
    noTradesDay: false,
  });

  const [generalNotes, setGeneralNotes] = useState('');
  const [openPhases, setOpenPhases] = useState<Record<JournalPhaseKey, boolean>>(() => loadPersistedOpenPhases());
  const [hasDraftNotice, setHasDraftNotice] = useState(false);
  const [moodCapWarning, setMoodCapWarning] = useState<string | null>(null);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newInTradeObsTag, setNewInTradeObsTag] = useState('');
  const [customMistakeInput, setCustomMistakeInput] = useState('');
  const [customLessonInput, setCustomLessonInput] = useState('');
  const [suggestions, setSuggestions] = useState<ScopedContextualSuggestions>({
    setupTags: [],
    mistakeTags: [],
    lessonTags: [],
    tags: [],
    strategies: [],
    usedInstruments: [],
  });
  const phaseContainerRef = useRef<HTMLDivElement>(null);

  const togglePhase = (phase: JournalPhaseKey) => {
    setOpenPhases((prev) => {
      const next = { ...prev, [phase]: !prev[phase] };
      try {
        localStorage.setItem(JOURNAL_PHASE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage limitations
      }
      return next;
    });
  };

  const expandSinglePhase = (phase: JournalPhaseKey) => {
    setOpenPhases((prev) => {
      const next = { ...prev, [phase]: true };
      try {
        localStorage.setItem(JOURNAL_PHASE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
    setTimeout(() => {
      const target = phaseContainerRef.current?.querySelector(`[data-journal-phase="${phase}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  // Load entries and scoped contextual suggestions
  const refreshSuggestions = async (scopeId?: string | null) => {
    const sug = await getScopedContextualSuggestions(scopeId ?? userId);
    setSuggestions(sug);
  };

  const refreshEntries = async () => {
    setLoading(true);
    try {
      const list = await getAllJournalEntries();
      setEntries(list);
      await refreshSuggestions(userId);
    } catch (err) {
      console.error('Error loading journal entries', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshEntries();
  }, [userId]);

  // Track current active account scope and pending unsaved draft state
  const currentUserIdRef = useRef<string | null | undefined>(userId);
  currentUserIdRef.current = userId;
  const draftDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const hasPendingDebounceRef = useRef(false);
  const latestDraftStateRef = useRef<{
    isEditorOpen: boolean;
    editingEntryId: string | null;
    payload: Partial<JournalEntry>;
  }>({
    isEditorOpen: false,
    editingEntryId: null,
    payload: {},
  });
  latestDraftStateRef.current = {
    isEditorOpen,
    editingEntryId,
    payload: {
      title,
      date,
      time,
      session,
      pair,
      entryType,
      linkedScenarioId: linkedScenarioId || undefined,
      linkedScenarioLabel: linkedScenarioLabel || undefined,
      linkedTradeId: linkedTradeId || undefined,
      prep,
      preTrade,
      inTrade,
      postTrade,
      reflection,
      generalNotes,
    },
  };

  // Coordinated account switch & destination draft loader:
  // 1) Flush any pending changes to the previous owner's scope
  // 2) Clear only visible editor state
  // 3) Load the destination account's own draft
  const prevUserRef = useRef(userId);
  useEffect(() => {
    let isMounted = true;
    const prevScope = normalizeAccountScope(prevUserRef.current);
    const nextScope = normalizeAccountScope(userId);

    const handleAccountTransitionAndLoad = async () => {
      if (prevScope !== nextScope) {
        if (draftDebounceRef.current) {
          clearTimeout(draftDebounceRef.current);
          draftDebounceRef.current = null;
        }
        const snap = latestDraftStateRef.current;
        if (
          hasPendingDebounceRef.current ||
          (snap.isEditorOpen && !snap.editingEntryId && (snap.payload.title || snap.payload.generalNotes))
        ) {
          hasPendingDebounceRef.current = false;
          await saveJournalDraft(snap.payload, prevScope).catch(() => {});
        }
        if (isMounted) {
          setIsEditorOpen(false);
          setEditingEntryId(null);
          resetForm();
        }
        prevUserRef.current = userId;
      }

      const draft = await getJournalDraft(userId);
      if (!isMounted) return;
      if (draft && Object.keys(draft).length > 0) {
        setHasDraftNotice(true);
      } else {
        setHasDraftNotice(false);
      }
    };

    handleAccountTransitionAndLoad();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Auto-save draft when creating a new entry, bound strictly to the active account scope
  // Do NOT clobber new-entry draft when editing an existing saved entry.
  useEffect(() => {
    if (!isEditorOpen || editingEntryId) return;

    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
    }

    hasPendingDebounceRef.current = true;
    const targetUserId = userId; // capture current scope at time of keystroke

    draftDebounceRef.current = setTimeout(async () => {
      // Guard against delayed write if account switched during debounce
      if (normalizeAccountScope(currentUserIdRef.current) !== normalizeAccountScope(targetUserId)) {
        return;
      }
      const draftPayload: Partial<JournalEntry> = {
        title,
        date,
        time,
        session,
        pair,
        entryType,
        linkedScenarioId: linkedScenarioId || undefined,
        linkedScenarioLabel: linkedScenarioLabel || undefined,
        linkedTradeId: linkedTradeId || undefined,
        prep,
        preTrade,
        inTrade,
        postTrade,
        reflection,
        generalNotes,
      };
      await saveJournalDraft(draftPayload, targetUserId);
      hasPendingDebounceRef.current = false;
    }, 1000);

    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
    };
  }, [
    isEditorOpen,
    editingEntryId,
    title,
    date,
    time,
    session,
    pair,
    entryType,
    linkedScenarioId,
    linkedScenarioLabel,
    linkedTradeId,
    prep,
    preTrade,
    inTrade,
    postTrade,
    reflection,
    generalNotes,
    userId,
  ]);

  const serializeEditorState = (vals: {
    title: string;
    date: string;
    time: string;
    session: TradingSession;
    pair: TradingPair;
    entryType: JournalEntryType;
    linkedScenarioId?: string;
    linkedScenarioLabel?: string;
    linkedTradeId?: string;
    prep: JournalPrep;
    preTrade: JournalPreTrade;
    inTrade: JournalInTrade;
    postTrade: JournalPostTrade;
    reflection: JournalDailyReflection;
    generalNotes: string;
  }) => JSON.stringify(vals);

  const resetForm = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const defaultPrep: JournalPrep = {
      sessionIntention: '',
      readinessState: 'Optimal / Calm',
      readinessStates: ['Optimal / Calm'],
      prioritizedRules: [],
      dailyPlanNotes: '',
    };
    const defaultPreTrade: JournalPreTrade = {
      reasonForTrade: '',
      setupTag: '',
      confirmationChecklist: [
        { item: 'HTF liquidity swept / tapped', checked: false },
        { item: 'Clear 15M / 5M MSS confirmation', checked: false },
        { item: 'Aligned with overall bias', checked: false },
        { item: 'Acceptable risk-to-reward ratio', checked: false },
      ],
      plannedRiskR: '1',
      linkedReportId: '',
    };
    const defaultInTrade: JournalInTrade = {
      mindsets: [],
      mindsetOther: '',
      managementDecisions: '',
      planAdjustments: '',
      emotionalObservationTags: [],
      emotionalObservations: '',
      timelineNotes: [],
    };
    const defaultPostTrade: JournalPostTrade = {
      executionReview: '',
      rulesFollowedStatus: 'Followed',
      mistakeTags: [],
      lessonTags: [],
      repeatOrImprove: '',
    };
    const defaultReflection: JournalDailyReflection = {
      whatWorked: '',
      whatDidNot: '',
      keyLessons: '',
      nextSessionCommitment: '',
      noTradesDay: false,
    };
    const defaultPair = getEnabledInstrumentSymbols(instrumentsConfig)[0] || 'XAUUSD';
    setTitle('');
    setDate(todayStr);
    setTime(timeStr);
    setSession('London');
    setPair(defaultPair);
    setEntryType('general');
    setLinkedScenarioId('');
    setLinkedScenarioLabel('');
    setLinkedTradeId('');
    setPrep(defaultPrep);
    setPreTrade(defaultPreTrade);
    setInTrade(defaultInTrade);
    setPostTrade(defaultPostTrade);
    setReflection(defaultReflection);
    setGeneralNotes('');
    setEditingEntryId(null);
    setMoodCapWarning(null);
    setShowDiscardConfirm(false);
    return {
      title: '',
      date: todayStr,
      time: timeStr,
      session: 'London' as TradingSession,
      pair: defaultPair as TradingPair,
      entryType: 'general' as JournalEntryType,
      linkedScenarioId: '',
      linkedScenarioLabel: '',
      linkedTradeId: '',
      prep: defaultPrep,
      preTrade: defaultPreTrade,
      inTrade: defaultInTrade,
      postTrade: defaultPostTrade,
      reflection: defaultReflection,
      generalNotes: '',
    };
  };

  const openNewEntry = () => {
    const initialVals = resetForm();
    originalSnapshotRef.current = serializeEditorState(initialVals);
    refreshSuggestions(userId).catch(() => {});
    setIsEditorOpen(true);
  };

  const openEditEntry = (entry: JournalEntry, focusPhase?: JournalPhaseKey) => {
    const clonedEntry: JournalEntry = JSON.parse(JSON.stringify(entry));
    const rawPrep = clonedEntry.prep || {
      sessionIntention: '',
      readinessState: 'Optimal / Calm',
      prioritizedRules: [],
      dailyPlanNotes: '',
    };
    const normalizedStates = normalizeReadinessStates(rawPrep);
    const entryPrep: JournalPrep = {
      ...rawPrep,
      readinessStates: normalizedStates,
      readinessState: normalizedStates[0] || rawPrep.readinessState || '',
    };
    const entryPreTrade = clonedEntry.preTrade || {
      reasonForTrade: '',
      setupTag: '',
      confirmationChecklist: [
        { item: 'HTF liquidity swept / tapped', checked: false },
        { item: 'Clear 15M / 5M MSS confirmation', checked: false },
        { item: 'Aligned with overall bias', checked: false },
        { item: 'Acceptable risk-to-reward ratio', checked: false },
      ],
      plannedRiskR: '1',
      linkedReportId: clonedEntry.linkedReportId || '',
    };
    const entryInTrade: JournalInTrade = {
      mindsets: [],
      mindsetOther: '',
      managementDecisions: '',
      planAdjustments: '',
      emotionalObservationTags: [],
      emotionalObservations: '',
      timelineNotes: [],
      ...(clonedEntry.inTrade || {}),
    };
    const entryPostTrade = clonedEntry.postTrade || {
      executionReview: '',
      rulesFollowedStatus: 'Followed',
      mistakeTags: [],
      lessonTags: [],
      repeatOrImprove: '',
    };
    const entryReflection = clonedEntry.reflection || {
      whatWorked: '',
      whatDidNot: '',
      keyLessons: '',
      nextSessionCommitment: '',
      noTradesDay: false,
    };
    const entryDate = clonedEntry.date || new Date().toISOString().slice(0, 10);
    const entryTime = clonedEntry.time || '';
    const entrySession = clonedEntry.session || 'London';
    const entryPair = clonedEntry.pair || 'XAUUSD';
    const entryTypeVal = clonedEntry.entryType || 'general';
    const entryTitle = clonedEntry.title || '';
    const entryNotes = clonedEntry.generalNotes || '';
    const nextScenarioId = clonedEntry.linkedScenarioId || entryPreTrade.linkedScenarioId || '';
    const nextScenarioLabel = clonedEntry.linkedScenarioLabel || entryPreTrade.linkedScenarioLabel || '';
    const nextTradeId = clonedEntry.linkedTradeId || entryPreTrade.linkedTradeId || entryPostTrade.tradeId || '';

    setEditingEntryId(clonedEntry.id);
    setTitle(entryTitle);
    setDate(entryDate);
    setTime(entryTime);
    setSession(entrySession);
    setPair(entryPair);
    setEntryType(entryTypeVal);
    setLinkedScenarioId(nextScenarioId);
    setLinkedScenarioLabel(nextScenarioLabel);
    setLinkedTradeId(nextTradeId);
    setPrep(entryPrep);
    setPreTrade({ ...entryPreTrade, linkedReportId: entryPreTrade.linkedReportId || clonedEntry.linkedReportId || '' });
    setInTrade(entryInTrade);
    setPostTrade(entryPostTrade);
    setReflection(entryReflection);
    setGeneralNotes(entryNotes);
    setMoodCapWarning(null);
    setShowDiscardConfirm(false);
    originalSnapshotRef.current = serializeEditorState({
      title: entryTitle,
      date: entryDate,
      time: entryTime,
      session: entrySession,
      pair: entryPair,
      entryType: entryTypeVal,
      linkedScenarioId: nextScenarioId,
      linkedScenarioLabel: nextScenarioLabel,
      linkedTradeId: nextTradeId,
      prep: entryPrep,
      preTrade: { ...entryPreTrade, linkedReportId: entryPreTrade.linkedReportId || clonedEntry.linkedReportId || '' },
      inTrade: entryInTrade,
      postTrade: entryPostTrade,
      reflection: entryReflection,
      generalNotes: entryNotes,
    });
    refreshSuggestions(userId).catch(() => {});
    setIsEditorOpen(true);
    if (focusPhase) {
      expandSinglePhase(focusPhase);
    }
  };

  const handleApplyDraft = async () => {
    const draft = await getJournalDraft(userId);
    if (!draft) return;
    const clonedDraft: Partial<JournalEntry> = JSON.parse(JSON.stringify(draft));
    const base = resetForm();
    const nextTitle = clonedDraft.title ?? base.title;
    const nextDate = clonedDraft.date ?? base.date;
    const nextTime = clonedDraft.time ?? base.time;
    const nextSession = clonedDraft.session ?? base.session;
    const nextPair = clonedDraft.pair ?? base.pair;
    const nextType = clonedDraft.entryType ?? base.entryType;
    const rawPrep = clonedDraft.prep ?? base.prep;
    const normStates = normalizeReadinessStates(rawPrep);
    const nextPrep: JournalPrep = {
      ...rawPrep,
      readinessStates: normStates,
      readinessState: (normStates[0] || rawPrep.readinessState || '') as EmotionalReadiness,
    };
    const nextPreTrade = clonedDraft.preTrade ?? base.preTrade;
    const nextInTrade = { ...base.inTrade, ...(clonedDraft.inTrade || {}) };
    const nextPostTrade = clonedDraft.postTrade ?? base.postTrade;
    const nextReflection = clonedDraft.reflection ?? base.reflection;
    const nextNotes = clonedDraft.generalNotes ?? base.generalNotes;
    const nextScenId = clonedDraft.linkedScenarioId || '';
    const nextScenLabel = clonedDraft.linkedScenarioLabel || '';
    const nextTrdId = clonedDraft.linkedTradeId || '';

    setTitle(nextTitle);
    setDate(nextDate);
    setTime(nextTime);
    setSession(nextSession);
    setPair(nextPair);
    setEntryType(nextType);
    setLinkedScenarioId(nextScenId);
    setLinkedScenarioLabel(nextScenLabel);
    setLinkedTradeId(nextTrdId);
    setPrep(nextPrep);
    setPreTrade(nextPreTrade);
    setInTrade(nextInTrade);
    setPostTrade(nextPostTrade);
    setReflection(nextReflection);
    setGeneralNotes(nextNotes);
    originalSnapshotRef.current = serializeEditorState({
      title: nextTitle,
      date: nextDate,
      time: nextTime,
      session: nextSession,
      pair: nextPair,
      entryType: nextType,
      linkedScenarioId: nextScenId,
      linkedScenarioLabel: nextScenLabel,
      linkedTradeId: nextTrdId,
      prep: nextPrep,
      preTrade: nextPreTrade,
      inTrade: nextInTrade,
      postTrade: nextPostTrade,
      reflection: nextReflection,
      generalNotes: nextNotes,
    });
    setHasDraftNotice(false);
    setIsEditorOpen(true);
  };

  // Handle cross-feature launch context (e.g. from Trade Card -> In-Trade Mindset / Post-Trade Review / View Linked)
  const lastConsumedLaunchIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!journalLaunchRequest || lastConsumedLaunchIdRef.current === journalLaunchRequest.requestId) {
      return;
    }
    lastConsumedLaunchIdRef.current = journalLaunchRequest.requestId;
    setMainJournalTab('trading-journal');

    if (journalLaunchRequest.mode === 'view_linked' && journalLaunchRequest.filterTradeId) {
      setFilterTradeId(journalLaunchRequest.filterTradeId);
      setIsEditorOpen(false);
      onConsumeJournalLaunchRequest?.();
      return;
    }

    const existing = journalLaunchRequest.entryIdToEdit
      ? entries.find((e) => e.id === journalLaunchRequest.entryIdToEdit)
      : undefined;

    if (existing) {
      openEditEntry(existing, journalLaunchRequest.targetPhase);
    } else {
      const base = resetForm();
      const targetPair = journalLaunchRequest.pair || base.pair;
      const targetSession = journalLaunchRequest.session || base.session;
      const targetDate = journalLaunchRequest.date || base.date;
      const targetTime = journalLaunchRequest.time || base.time;
      const targetScenId = journalLaunchRequest.linkedScenarioId || '';
      const targetScenLabel = journalLaunchRequest.linkedScenarioLabel || '';
      const targetTrdId = journalLaunchRequest.linkedTradeId || '';
      const targetReportId = journalLaunchRequest.linkedReportId || '';
      const defaultTitle = targetScenLabel
        ? `${targetPair} — ${targetScenLabel} (${targetDate})`
        : `${targetPair} ${targetSession} Trade Journal (${targetDate})`;
      const nextPreTrade: JournalPreTrade = {
        ...base.preTrade,
        setupTag: journalLaunchRequest.strategy || '',
        linkedReportId: targetReportId,
        linkedScenarioId: targetScenId || undefined,
        linkedScenarioLabel: targetScenLabel || undefined,
        linkedTradeId: targetTrdId || undefined,
        timezone: journalLaunchRequest.timezone,
      };
      const nextPostTrade: JournalPostTrade = {
        ...base.postTrade,
        tradeId: targetTrdId || undefined,
        outcome: journalLaunchRequest.outcome ? journalLaunchRequest.outcome.toLowerCase() : undefined,
        rulesFollowedStatus: 'Unreviewed',
      };
      const nextType: JournalEntryType =
        journalLaunchRequest.targetPhase === 'inTrade'
          ? 'in-trade'
          : journalLaunchRequest.targetPhase === 'postTrade'
          ? 'post-trade'
          : 'general';

      setTitle(defaultTitle);
      setDate(targetDate);
      setTime(targetTime);
      setSession(targetSession);
      setPair(targetPair);
      setEntryType(nextType);
      setLinkedScenarioId(targetScenId);
      setLinkedScenarioLabel(targetScenLabel);
      setLinkedTradeId(targetTrdId);
      setPreTrade(nextPreTrade);
      setPostTrade(nextPostTrade);
      originalSnapshotRef.current = serializeEditorState({
        ...base,
        title: defaultTitle,
        date: targetDate,
        time: targetTime,
        session: targetSession,
        pair: targetPair,
        entryType: nextType,
        linkedScenarioId: targetScenId,
        linkedScenarioLabel: targetScenLabel,
        linkedTradeId: targetTrdId,
        preTrade: nextPreTrade,
        postTrade: nextPostTrade,
      });
      setIsEditorOpen(true);
      expandSinglePhase(journalLaunchRequest.targetPhase);
    }

    onConsumeJournalLaunchRequest?.();
  }, [journalLaunchRequest, entries]);

  const isEditorDirty = () => {
    const current = serializeEditorState({
      title,
      date,
      time,
      session,
      pair,
      entryType,
      linkedScenarioId,
      linkedScenarioLabel,
      linkedTradeId,
      prep,
      preTrade,
      inTrade,
      postTrade,
      reflection,
      generalNotes,
    });
    return current !== originalSnapshotRef.current;
  };

  const executeDiscardAndCloseEditor = async () => {
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    hasPendingDebounceRef.current = false;
    if (!editingEntryId) {
      await clearJournalDraft(userId).catch(() => {});
      setHasDraftNotice(false);
    }
    setShowDiscardConfirm(false);
    setIsEditorOpen(false);
    resetForm();
  };

  const handleRequestCloseEditor = () => {
    if (isEditorDirty()) {
      setShowDiscardConfirm(true);
    } else {
      executeDiscardAndCloseEditor();
    }
  };

  const editorBackRef = useRef<() => void>(() => {});
  editorBackRef.current = () => {
    if (showDiscardConfirm) {
      setShowDiscardConfirm(false);
    } else {
      handleRequestCloseEditor();
    }
  };

  useEffect(() => {
    if (!isEditorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        editorBackRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const unregBack = registerBackHandler(() => editorBackRef.current());
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      unregBack();
    };
  }, [isEditorOpen]);

  const handleSaveEntry = async () => {
    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
      draftDebounceRef.current = null;
    }
    const defaultTitle = reflection.noTradesDay
      ? `No Trades — ${date} (${session})`
      : title.trim() || `${pair} ${session} Session Reflection (${date})`;

    const selectedLinkedReport = reportsList.find((r) => r.id === preTrade.linkedReportId);

    const normalizedReadiness = normalizeReadinessStates(prep);
    const cleanedPrep: JournalPrep = {
      ...prep,
      readinessStates: normalizedReadiness,
      readinessState: normalizedReadiness[0] || '',
    };

    const payload: JournalEntry = {
      id: editingEntryId || `jrn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: defaultTitle,
      date,
      time,
      session,
      pair,
      entryType,
      prep: cleanedPrep,
      preTrade: {
        ...preTrade,
        linkedScenarioId: linkedScenarioId || undefined,
        linkedScenarioLabel: linkedScenarioLabel || undefined,
        linkedTradeId: linkedTradeId || undefined,
      },
      inTrade,
      postTrade: {
        ...postTrade,
        tradeId: linkedTradeId || postTrade.tradeId || undefined,
      },
      reflection,
      generalNotes,
      linkedReportId: preTrade.linkedReportId || undefined,
      linkedReportTitle: selectedLinkedReport ? selectedLinkedReport.title || `${selectedLinkedReport.pair} Analysis` : undefined,
      linkedScenarioId: linkedScenarioId || undefined,
      linkedScenarioLabel: linkedScenarioLabel || undefined,
      linkedTradeId: linkedTradeId || undefined,
      createdAt: editingEntryId ? entries.find((e) => e.id === editingEntryId)?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
      userId: normalizeAccountScope(userId),
    };

    hasPendingDebounceRef.current = false;
    await saveJournalEntry(payload);
    if (!editingEntryId) {
      await clearJournalDraft(userId);
      setHasDraftNotice(false);
    }
    setIsEditorOpen(false);
    resetForm();
    await refreshEntries();
  };

  const handleConfirmDeleteEntry = async (id: string) => {
    await deleteJournalEntry(id);
    setConfirmDeleteEntryId(null);
    await refreshEntries();
  };

  const tradingJournalEntries = useMemo(() => {
    return entries.filter((e) => {
      const isTrading = e.entryType !== 'my-journal' && e.entryType !== ('my_journal' as any);
      if (!isTrading) return false;
      return isJournalEntryOwnedByScope(e, userId);
    });
  }, [entries, userId]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return tradingJournalEntries.filter((e) => {
      if (filterTradeId) {
        const entryTradeId = e.linkedTradeId || e.preTrade?.linkedTradeId || e.postTrade?.tradeId;
        if (entryTradeId !== filterTradeId) return false;
      }

      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (e.title || '').toLowerCase().includes(q);
        const matchesNotes = (e.generalNotes || '').toLowerCase().includes(q);
        const matchesReason = (e.preTrade?.reasonForTrade || '').toLowerCase().includes(q);
        const matchesSetup = (e.preTrade?.setupTag || '').toLowerCase().includes(q);
        const matchesReview = (e.postTrade?.executionReview || '').toLowerCase().includes(q);
        const matchesMindset = (e.inTrade?.mindsets || []).some((m) => m.toLowerCase().includes(q)) || (e.inTrade?.mindsetOther || '').toLowerCase().includes(q);
        const matchesMistakes = (e.postTrade?.mistakeTags || []).some((m) => m.toLowerCase().includes(q));
        const matchesLessons = (e.postTrade?.lessonTags || []).some((l) => l.toLowerCase().includes(q));
        if (
          !matchesTitle &&
          !matchesNotes &&
          !matchesReason &&
          !matchesSetup &&
          !matchesReview &&
          !matchesMindset &&
          !matchesMistakes &&
          !matchesLessons
        ) {
          return false;
        }
      }

      // Pair
      if (selectedPair !== 'all' && e.pair !== selectedPair) {
        return false;
      }

      // Session
      if (selectedSession !== 'all' && e.session !== selectedSession) {
        return false;
      }

      // Rule Status
      if (selectedRuleStatus !== 'all') {
        const status = e.postTrade?.rulesFollowedStatus || 'Unreviewed';
        if (status !== selectedRuleStatus) return false;
      }

      // Date Filter
      if (selectedDateFilter === 'today') {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (e.date !== todayStr) return false;
      } else if (selectedDateFilter === 'week') {
        const d = new Date(e.date);
        const now = new Date();
        const diffDays = (now.getTime() - d.getTime()) / (1000 * 3600 * 24);
        if (diffDays > 7 || diffDays < 0) return false;
      } else if (selectedDateFilter === 'month') {
        const currentMonth = new Date().toISOString().slice(0, 7);
        if (!e.date.startsWith(currentMonth)) return false;
      }

      return true;
    });
  }, [tradingJournalEntries, filterTradeId, searchQuery, selectedPair, selectedSession, selectedRuleStatus, selectedDateFilter]);

  const summaryStats = useMemo(() => {
    let followed = 0;
    let broken = 0;
    let unreviewed = 0;
    for (const e of tradingJournalEntries) {
      if (e.postTrade?.rulesFollowedStatus === 'Followed') followed++;
      else if (e.postTrade?.rulesFollowedStatus === 'Broken') broken++;
      else if (e.postTrade?.rulesFollowedStatus === 'Unreviewed') unreviewed++;
    }
    const reviewed = followed + broken;
    const rate = reviewed > 0 ? Math.round((followed / reviewed) * 100) : null;
    return { followed, broken, unreviewed, total: tradingJournalEntries.length, rate };
  }, [tradingJournalEntries]);

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 space-y-5">
      {/* Main Journal Navigation Tabs: Trading Journal | My Journal | Strategies */}
      <div className="flex items-center gap-2 border-b border-app pb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setMainJournalTab('trading-journal')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
            mainJournalTab === 'trading-journal'
              ? 'bg-emerald-theme text-white shadow-2xs'
              : 'text-app-secondary hover:text-app-main hover:bg-app-field'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Trading Journal</span>
        </button>
        {journalVisibilityConfig.myJournal !== false && (
          <button
            type="button"
            onClick={() => setMainJournalTab('my-journal')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
              mainJournalTab === 'my-journal'
                ? 'bg-emerald-theme text-white shadow-2xs'
                : 'text-app-secondary hover:text-app-main hover:bg-app-field'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>My Journal</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setMainJournalTab('strategies')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
            mainJournalTab === 'strategies'
              ? 'bg-emerald-theme text-white shadow-2xs'
              : 'text-app-secondary hover:text-app-main hover:bg-app-field'
          }`}
        >
          <BookMarked className="w-3.5 h-3.5" />
          <span>Strategies</span>
        </button>
      </div>

      {mainJournalTab === 'strategies' ? (
        <StrategiesSection userId={userId} />
      ) : isAllHidden ? (
        <div className="py-8">
          <div className="p-8 text-center border border-dashed border-app rounded-xl bg-app-main space-y-3 max-w-lg mx-auto">
            <EyeOff className="w-10 h-10 text-app-secondary mx-auto opacity-60" />
            <h2 className="text-base font-bold text-app-main">All Journal sections are currently hidden</h2>
            <p className="text-xs text-app-secondary leading-relaxed">
              All cards, prep sections, and reflection tools are hidden by your current visibility preferences. Your notes and trading records are safe.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onOpenSettings?.('journal_visibility')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Adjust Visibility in Settings</span>
              </button>
            </div>
          </div>
        </div>
      ) : mainJournalTab === 'my-journal' && journalVisibilityConfig.myJournal !== false ? (
        <MyJournalSection
          entries={entries}
          reportsList={reportsList}
          onOpenReport={onOpenReport}
          userId={userId}
          visibilityConfig={journalVisibilityConfig}
          onRefresh={refreshEntries}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <>
          {/* Top Banner / Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-app">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-app-main tracking-tight flex items-center gap-2">
                <BookOpen className="w-6 h-6 text-emerald-theme" />
                <span>Trading Journal</span>
              </h1>
              <p className="text-xs text-app-secondary mt-0.5">
                Record pre-session preparation, in-trade decisions, execution discipline, and daily reflections.
              </p>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-app-secondary bg-app-field/60 border border-app px-2.5 py-1 rounded-md max-w-xl">
                <Info className="w-3.5 h-3.5 text-emerald-theme shrink-0" />
                <span>
                  <strong>Local-Only Storage:</strong> Trading Journal entries are stored locally on this device and are not synchronized to cloud accounts. Use Settings &rarr; Backup to download a full backup copy.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {hasDraftNotice && (
                <button
                  type="button"
                  onClick={handleApplyDraft}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Resume Unfinished Draft</span>
                </button>
              )}

              <button
                type="button"
                onClick={openNewEntry}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white bg-emerald-theme hover:bg-emerald-theme-hover shadow-2xs transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Journal Entry</span>
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {journalVisibilityConfig.summaryCards !== false && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-app-secondary flex items-center justify-between">
                  <span>Discipline Rate</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-theme" />
                </div>
                <div className="text-xl font-extrabold text-app-main">
                  {summaryStats.rate !== null ? `${summaryStats.rate}%` : '—'}
                </div>
                <div className="text-[10px] text-app-secondary">
                  {summaryStats.followed} followed / {summaryStats.broken} broken
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-app-secondary flex items-center justify-between">
                  <span>Trading Session Entries</span>
                  <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <div className="text-xl font-extrabold text-app-main">
                  {summaryStats.total}
                </div>
                <div className="text-[10px] text-app-secondary">
                  Logged trading session reviews
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-app-secondary flex items-center justify-between">
                  <span>Reviews Completed</span>
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                </div>
                <div className="text-xl font-extrabold text-app-main">
                  {summaryStats.followed + summaryStats.broken}
                </div>
                <div className="text-[10px] text-app-secondary">
                  {summaryStats.unreviewed} pending review
                </div>
              </div>
            </div>
          )}

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 p-3 rounded-lg bg-app-field border border-app text-xs">
        {/* Search */}
        <div className="relative col-span-1 sm:col-span-2 lg:col-span-2">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-app-secondary" />
          <input
            type="text"
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            placeholder="Search tags, mistakes, reflections, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-md bg-app-main border border-app text-xs text-app-main focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Date Filter */}
        <div>
          <select
            value={selectedDateFilter}
            onChange={(e) => setSelectedDateFilter(e.target.value as any)}
            className="w-full px-2.5 py-2 rounded-md bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="week">Past 7 Days</option>
            <option value="month">This Month</option>
          </select>
        </div>

        {/* Pair Filter */}
        <div>
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            aria-label="Filter journal by instrument"
            className="w-full px-2.5 py-2 rounded-md bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Instruments</option>
            {filterInstrumentOptions.map((opt) => (
              <option key={opt.symbol} value={opt.symbol}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Discipline / Rule Status Filter */}
        <div>
          <select
            value={selectedRuleStatus}
            onChange={(e) => setSelectedRuleStatus(e.target.value)}
            className="w-full px-2.5 py-2 rounded-md bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Rule Reviews</option>
            <option value="Followed">Rules Followed</option>
            <option value="Broken">Rules Broken</option>
            <option value="Unreviewed">Unreviewed</option>
          </select>
        </div>
      </div>

      {filterTradeId && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-emerald-pale/60 border border-emerald-500/40 text-xs">
          <div className="flex items-center gap-2 font-semibold text-emerald-theme">
            <LinkIcon className="w-3.5 h-3.5" />
            <span>Showing journal entries linked to Trade ID: {filterTradeId}</span>
          </div>
          <button
            type="button"
            onClick={() => setFilterTradeId(null)}
            className="px-2.5 py-1 rounded bg-app-main border border-app text-app-main font-semibold hover:bg-app-field cursor-pointer"
          >
            Show All Journal Entries
          </button>
        </div>
      )}

      {/* Entries List / Timeline */}
      {loading ? (
        <div className="text-center py-12 text-xs text-app-secondary">
          Loading journal entries...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-xl border border-app bg-app-field/40 space-y-3">
          <BookOpen className="w-10 h-10 text-app-secondary mx-auto opacity-50" />
          <div className="text-sm font-bold text-app-main">No Journal Entries Found</div>
          <p className="text-xs text-app-secondary max-w-md mx-auto">
            {searchQuery || selectedPair !== 'all' || selectedRuleStatus !== 'all'
              ? 'No records match your active search or filters. Try adjusting your criteria.'
              : 'Start your trading day with a preparation note or reflect on your executed trades.'}
          </p>
          <button
            type="button"
            onClick={openNewEntry}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-emerald-theme text-white hover:bg-emerald-theme-hover cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Entry</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map((entry) => {
            const hasLinkedReport = Boolean(entry.linkedReportId);
            const matchingReport = entry.linkedReportId
              ? reportsList.find((r) => r.id === entry.linkedReportId)
              : null;
            const isNoTradesDay = Boolean(entry.reflection?.noTradesDay);

            return (
              <div
                key={entry.id}
                className="rounded-xl border border-app bg-app-main shadow-2xs p-4 sm:p-5 space-y-3 hover:border-emerald-500/40 transition-colors"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app/50 pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-app-main">{entry.title}</span>
                      {isNoTradesDay && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          No Trades Taken
                        </span>
                      )}
                      {entry.postTrade?.rulesFollowedStatus === 'Followed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Rules Followed</span>
                        </span>
                      )}
                      {entry.postTrade?.rulesFollowedStatus === 'Broken' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-700">
                          <XCircle className="w-3 h-3" />
                          <span>Rules Broken</span>
                        </span>
                      )}
                      {entry.postTrade?.rulesFollowedStatus === 'Unreviewed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                          <HelpCircle className="w-3 h-3" />
                          <span>Unreviewed</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-app-secondary flex-wrap">
                      <span className="font-medium text-app-main">{entry.date}</span>
                      {entry.time && <span>· {entry.time}</span>}
                      {entry.session && <span>· {entry.session} Session</span>}
                      {entry.pair && <span>· {entry.pair}</span>}
                      {(() => {
                        const moods = normalizeReadinessStates(entry.prep);
                        return moods.length > 0 ? (
                          <span>· Readiness: {moods.join(', ')}</span>
                        ) : null;
                      })()}
                    </div>
                    {(entry.linkedScenarioLabel || entry.linkedTradeId) && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5 text-[10px]">
                        {entry.linkedScenarioLabel && (
                          <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-semibold">
                            Scenario: {entry.linkedScenarioLabel}
                          </span>
                        )}
                        {entry.linkedTradeId && (
                          <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-semibold">
                            Trade Linked
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditEntry(entry)}
                      className="p-1.5 rounded text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer"
                      title="Edit journal entry"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmDeleteEntryId === entry.id ? (
                      <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded px-1.5 py-0.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleConfirmDeleteEntry(entry.id)}
                          className="px-2 py-0.5 bg-rose-600 text-white font-bold rounded cursor-pointer"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteEntryId(null)}
                          className="px-1.5 py-0.5 text-app-secondary hover:text-app-main cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEntryId(entry.id)}
                        className="p-1.5 rounded text-app-secondary hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                        title="Delete journal entry"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Body Content */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                  {/* Preparation & Pre-trade */}
                  {(entry.prep?.sessionIntention || entry.preTrade?.reasonForTrade || entry.preTrade?.setupTag) && (
                    <div className="p-3 rounded-lg bg-app-field/50 border border-app/60 space-y-1.5">
                      <div className="font-bold text-[11px] text-app-secondary uppercase tracking-wider">
                        Preparation &amp; Pre-Trade
                      </div>
                      {entry.prep?.sessionIntention && (
                        <div>
                          <span className="text-app-secondary font-medium">Session Intention: </span>
                          <span className="text-app-main">{entry.prep.sessionIntention}</span>
                        </div>
                      )}
                      {entry.preTrade?.setupTag && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <Tag className="w-3 h-3 text-emerald-theme" />
                          <span className="font-semibold text-emerald-theme">{entry.preTrade.setupTag}</span>
                          {entry.preTrade.plannedRiskR && (
                            <span className="text-app-secondary">({entry.preTrade.plannedRiskR}R Risk)</span>
                          )}
                        </div>
                      )}
                      {entry.preTrade?.reasonForTrade && (
                        <p className="text-app-main mt-1 italic">
                          &ldquo;{entry.preTrade.reasonForTrade}&rdquo;
                        </p>
                      )}
                    </div>
                  )}

                  {/* In-Trade Mindset & Management */}
                  {(entry.inTrade?.managementDecisions ||
                    entry.inTrade?.emotionalObservations ||
                    (entry.inTrade?.mindsets && entry.inTrade.mindsets.length > 0) ||
                    entry.inTrade?.mindsetOther ||
                    (entry.inTrade?.emotionalObservationTags && entry.inTrade.emotionalObservationTags.length > 0)) && (
                    <div className="p-3 rounded-lg bg-app-field/50 border border-app/60 space-y-1.5">
                      <div className="font-bold text-[11px] text-app-secondary uppercase tracking-wider">
                        In-Trade Mindset &amp; Management
                      </div>
                      {((entry.inTrade?.mindsets && entry.inTrade.mindsets.length > 0) || entry.inTrade?.mindsetOther) && (
                        <div className="flex flex-wrap items-center gap-1">
                          {(entry.inTrade?.mindsets || []).map((m) => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-300/70"
                            >
                              {m}
                            </span>
                          ))}
                          {entry.inTrade?.mindsetOther && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-app-main text-app-main border border-app">
                              {entry.inTrade.mindsetOther}
                            </span>
                          )}
                        </div>
                      )}
                      {entry.inTrade?.emotionalObservationTags && entry.inTrade.emotionalObservationTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {entry.inTrade.emotionalObservationTags.map((t) => (
                            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-app-main text-app-secondary border border-app">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      {entry.inTrade?.managementDecisions && (
                        <p className="text-app-main">{entry.inTrade.managementDecisions}</p>
                      )}
                      {entry.inTrade?.emotionalObservations && (
                        <p className="text-app-secondary italic">{entry.inTrade.emotionalObservations}</p>
                      )}
                    </div>
                  )}

                  {/* Execution, Mistakes & Lessons */}
                  {(entry.postTrade?.executionReview || (entry.postTrade?.mistakeTags && entry.postTrade.mistakeTags.length > 0) || (entry.postTrade?.lessonTags && entry.postTrade.lessonTags.length > 0)) && (
                    <div className="p-3 rounded-lg bg-app-field/50 border border-app/60 space-y-1.5">
                      <div className="font-bold text-[11px] text-app-secondary uppercase tracking-wider">
                        Execution &amp; Discipline Review
                      </div>
                      {entry.postTrade?.executionReview && (
                        <p className="text-app-main">{entry.postTrade.executionReview}</p>
                      )}
                      {entry.postTrade?.mistakeTags && entry.postTrade.mistakeTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">Mistakes:</span>
                          {entry.postTrade.mistakeTags.map((m) => (
                            <span
                              key={m}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                      {entry.postTrade?.lessonTags && entry.postTrade.lessonTags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Lessons:</span>
                          {entry.postTrade.lessonTags.map((l) => (
                            <span
                              key={l}
                              className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Daily Reflection */}
                  {(entry.reflection?.whatWorked || entry.reflection?.whatDidNot || entry.reflection?.nextSessionCommitment) && (
                    <div className="p-3 rounded-lg bg-app-field/50 border border-app/60 space-y-1.5 col-span-1 md:col-span-2">
                      <div className="font-bold text-[11px] text-app-secondary uppercase tracking-wider">
                        Daily Reflection &amp; Next Commitment
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5">
                        {entry.reflection?.whatWorked && (
                          <div>
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold block text-[11px]">
                              What Worked:
                            </span>
                            <span className="text-app-main">{entry.reflection.whatWorked}</span>
                          </div>
                        )}
                        {entry.reflection?.whatDidNot && (
                          <div>
                            <span className="text-rose-600 dark:text-rose-400 font-semibold block text-[11px]">
                              What Did Not Work:
                            </span>
                            <span className="text-app-main">{entry.reflection.whatDidNot}</span>
                          </div>
                        )}
                        {entry.reflection?.nextSessionCommitment && (
                          <div>
                            <span className="text-blue-600 dark:text-blue-400 font-semibold block text-[11px]">
                              Next Commitment:
                            </span>
                            <span className="text-app-main">{entry.reflection.nextSessionCommitment}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* General standalone notes */}
                  {entry.generalNotes && (
                    <div className="p-3 rounded-lg bg-app-field/50 border border-app/60 space-y-1 col-span-1 md:col-span-2">
                      <div className="font-bold text-[11px] text-app-secondary uppercase tracking-wider">Notes</div>
                      <p className="text-app-main whitespace-pre-line">{entry.generalNotes}</p>
                    </div>
                  )}
                </div>

                {/* Footer Link: Non-destructive link to Analysis Report */}
                {hasLinkedReport && (
                  <div className="pt-2 border-t border-app/40 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5 text-app-secondary" />
                      {matchingReport ? (
                        <button
                          type="button"
                          onClick={() => onOpenReport?.(entry.linkedReportId!)}
                          className="font-semibold text-emerald-theme hover:underline cursor-pointer"
                        >
                          Linked Analysis: {matchingReport.title || `${matchingReport.pair} Analysis (${matchingReport.date})`}
                        </button>
                      ) : (
                        <span className="text-app-secondary italic">
                          Linked Analysis: {entry.linkedReportTitle || 'Archived / Unavailable'}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-app-secondary">
                      Updated {new Date(entry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      {isEditorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Journal Entry Editor"
          onClick={handleRequestCloseEditor}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs"
        >
          <div
            className="w-full max-w-3xl bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary/60">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-theme" />
                <span className="font-bold text-sm text-app-main">
                  {editingEntryId ? 'Edit Journal Entry' : 'New Journal Entry'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRequestCloseEditor}
                className="p-1 rounded text-app-secondary hover:text-app-main cursor-pointer"
                aria-label="Close editor"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body — Smooth vertical scroll with 5 stacked collapsible phases */}
            <div ref={phaseContainerRef} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Metadata Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                    Session
                  </label>
                  <select
                    value={session}
                    onChange={(e) => setSession(e.target.value as TradingSession)}
                    className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs cursor-pointer"
                  >
                    <option value="Asia">Asia</option>
                    <option value="London">London</option>
                    <option value="NY AM">NY AM</option>
                    <option value="NY PM">NY PM</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                    Instrument
                  </label>
                  <select
                    value={pair}
                    onChange={(e) => setPair(e.target.value as TradingPair)}
                    aria-label="Journal entry instrument"
                    className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs cursor-pointer"
                  >
                    {getSelectorInstrumentOptions(instrumentsConfig, [pair]).map((opt) => (
                      <option key={opt.symbol} value={opt.symbol}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(linkedScenarioLabel || linkedTradeId) && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-emerald-pale/50 border border-emerald-500/30 text-[11px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <LinkIcon className="w-3.5 h-3.5 text-emerald-theme" />
                    {linkedScenarioLabel && (
                      <span className="font-semibold text-app-main">Scenario: {linkedScenarioLabel}</span>
                    )}
                    {linkedTradeId && (
                      <span className="text-app-secondary">Trade ID: {linkedTradeId}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkedScenarioId('');
                      setLinkedScenarioLabel('');
                      setLinkedTradeId('');
                    }}
                    className="text-[10px] font-semibold text-app-secondary hover:text-rose-600 cursor-pointer"
                  >
                    Unlink
                  </button>
                </div>
              )}

              {/* Title / Headline */}
              <div>
                <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                  Entry Title (Optional)
                </label>
                <input
                  type="text"
                  spellCheck
                  autoCorrect="on"
                  autoCapitalize="sentences"
                  placeholder="e.g. London Session Sweep & Expansion — Strict Discipline"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-app bg-app-field text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {/* 5 Vertically Stacked Collapsible Journal Phases */}
              {(() => {
                const selectedMoods = normalizeReadinessStates(prep);
                const prepStatus: 'Empty' | 'Draft' | 'Filled' =
                  (prep.sessionIntention?.trim() || prep.dailyPlanNotes?.trim()) && selectedMoods.length > 0
                    ? 'Filled'
                    : prep.sessionIntention?.trim() || prep.dailyPlanNotes?.trim() || selectedMoods.length > 0
                    ? 'Draft'
                    : 'Empty';

                const checkedCount = (preTrade.confirmationChecklist || []).filter((c) => c.checked).length;
                const preTradeStatus: 'Empty' | 'Draft' | 'Filled' =
                  preTrade.reasonForTrade?.trim() && (preTrade.setupTag?.trim() || checkedCount > 0)
                    ? 'Filled'
                    : preTrade.reasonForTrade?.trim() || preTrade.setupTag?.trim() || preTrade.linkedReportId || checkedCount > 0
                    ? 'Draft'
                    : 'Empty';

                const inTradeFieldsCount =
                  ((inTrade.mindsets?.length || 0) > 0 || Boolean(inTrade.mindsetOther?.trim()) ? 1 : 0) +
                  (inTrade.managementDecisions?.trim() ? 1 : 0) +
                  ((inTrade.emotionalObservationTags?.length || 0) > 0 || Boolean(inTrade.emotionalObservations?.trim()) ? 1 : 0);
                const inTradeStatus: 'Empty' | 'Draft' | 'Filled' =
                  inTradeFieldsCount >= 2 ? 'Filled' : inTradeFieldsCount === 1 ? 'Draft' : 'Empty';

                const postTradeHasContent =
                  Boolean(postTrade.executionReview?.trim()) ||
                  (postTrade.mistakeTags?.length || 0) > 0 ||
                  (postTrade.lessonTags?.length || 0) > 0;
                const postTradeStatus: 'Empty' | 'Draft' | 'Filled' = postTradeHasContent
                  ? 'Filled'
                  : postTrade.rulesFollowedStatus && postTrade.rulesFollowedStatus !== 'Unreviewed'
                  ? 'Draft'
                  : 'Empty';

                const reflectionCount =
                  (reflection.whatWorked?.trim() ? 1 : 0) +
                  (reflection.whatDidNot?.trim() ? 1 : 0) +
                  (reflection.nextSessionCommitment?.trim() ? 1 : 0);
                const reflectionStatus: 'Empty' | 'Draft' | 'Filled' =
                  reflection.noTradesDay || reflectionCount >= 2
                    ? 'Filled'
                    : reflectionCount === 1
                    ? 'Draft'
                    : 'Empty';

                const statusPillClass = (status: 'Empty' | 'Draft' | 'Filled') =>
                  status === 'Filled'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                    : status === 'Draft'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                    : 'bg-app-field text-app-secondary border-app';

                const mergedSetupSuggestions = Array.from(
                  new Set([...COMMON_SETUP_TAGS, ...suggestions.setupTags, ...suggestions.strategies])
                );
                const mergedMistakeSuggestions = Array.from(
                  new Set([...COMMON_MISTAKE_TAGS, ...suggestions.mistakeTags])
                );
                const mergedLessonSuggestions = Array.from(
                  new Set([...COMMON_LESSON_TAGS, ...suggestions.lessonTags])
                );

                return (
                  <div className="space-y-3">
                    {/* PHASE 1: Daily Preparation */}
                    <div
                      data-journal-phase="prep"
                      className="rounded-lg border border-app bg-app-field/25 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase('prep')}
                        aria-expanded={openPhases.prep}
                        className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 bg-app-secondary/50 hover:bg-app-secondary/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs sm:text-sm text-app-main">
                            1. Daily Preparation
                          </div>
                          <div className="text-[11px] text-app-secondary truncate">
                            Mindset readiness (up to 3), session intention &amp; key plan
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusPillClass(prepStatus)}`}>
                            {prepStatus}
                          </span>
                          {openPhases.prep ? <ChevronUp className="w-4 h-4 text-app-secondary" /> : <ChevronDown className="w-4 h-4 text-app-secondary" />}
                        </div>
                      </button>

                      {openPhases.prep && (
                        <div className="p-3.5 space-y-3.5 border-t border-app/60">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <label className="text-[11px] font-bold text-app-main uppercase">
                                Emotional Readiness &amp; Mindset (Up to 3)
                              </label>
                              <span
                                className={`text-[11px] font-bold ${
                                  selectedMoods.length >= 3 ? 'text-emerald-theme' : 'text-app-secondary'
                                }`}
                              >
                                {selectedMoods.length} / 3 selected
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {EMOTIONAL_STATES.map((st) => {
                                const isSelected = selectedMoods.includes(st);
                                return (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => {
                                      if (isSelected) {
                                        const next = selectedMoods.filter((m) => m !== st);
                                        setMoodCapWarning(null);
                                        setPrep((p) => ({
                                          ...p,
                                          readinessStates: next,
                                          readinessState: next[0] || '',
                                        }));
                                      } else if (selectedMoods.length >= 3) {
                                        setMoodCapWarning('Maximum 3 readiness moods can be selected. Deselect one first to pick another.');
                                      } else {
                                        const next = [...selectedMoods, st];
                                        setMoodCapWarning(null);
                                        setPrep((p) => ({
                                          ...p,
                                          readinessStates: next,
                                          readinessState: next[0] || '',
                                        }));
                                      }
                                    }}
                                    aria-pressed={isSelected}
                                    className={`min-h-[44px] px-3 py-2 rounded border text-xs font-medium text-left transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-theme font-bold'
                                        : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                    }`}
                                  >
                                    {isSelected ? '✓ ' : ''}
                                    {st}
                                  </button>
                                );
                              })}
                            </div>
                            {moodCapWarning && (
                              <div className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-300/70 rounded px-2.5 py-1.5">
                                {moodCapWarning}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Session Intention &amp; Focus
                            </label>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="e.g. Wait patiently for the 15M sweep during London open. Do not front-run confirmation."
                              value={prep.sessionIntention || ''}
                              onChange={(e) => setPrep((p) => ({ ...p, sessionIntention: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Daily Plan &amp; Key Levels
                            </label>
                            <textarea
                              rows={3}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Key daily/hourly levels to monitor, news releases, expected volatility..."
                              value={prep.dailyPlanNotes || ''}
                              onChange={(e) => setPrep((p) => ({ ...p, dailyPlanNotes: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PHASE 2: Pre-Trade Checklist */}
                    <div
                      data-journal-phase="preTrade"
                      className="rounded-lg border border-app bg-app-field/25 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase('preTrade')}
                        aria-expanded={openPhases.preTrade}
                        className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 bg-app-secondary/50 hover:bg-app-secondary/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs sm:text-sm text-app-main">
                            2. Pre-Trade Checklist
                          </div>
                          <div className="text-[11px] text-app-secondary truncate">
                            Setup / strategy tag, linked analysis &amp; confirmation checklist
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusPillClass(preTradeStatus)}`}>
                            {preTradeStatus}
                          </span>
                          {openPhases.preTrade ? <ChevronUp className="w-4 h-4 text-app-secondary" /> : <ChevronDown className="w-4 h-4 text-app-secondary" />}
                        </div>
                      </button>

                      {openPhases.preTrade && (
                        <div className="p-3.5 space-y-3.5 border-t border-app/60">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                                Setup / Strategy Tag
                              </label>
                              <input
                                type="text"
                                spellCheck
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                list="journal-setup-suggestions"
                                placeholder="e.g. Liquidity Sweep + MSS"
                                value={preTrade.setupTag || ''}
                                onChange={(e) => setPreTrade((pt) => ({ ...pt, setupTag: e.target.value }))}
                                className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                              />
                              <datalist id="journal-setup-suggestions">
                                {mergedSetupSuggestions.map((tag) => (
                                  <option key={tag} value={tag} />
                                ))}
                              </datalist>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                {mergedSetupSuggestions.slice(0, 6).map((tag) => (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => setPreTrade((pt) => ({ ...pt, setupTag: tag }))}
                                    className="px-2 py-0.5 rounded text-[10px] bg-app-field text-app-secondary hover:text-app-main border border-app cursor-pointer"
                                  >
                                    + {tag}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                                Planned Risk (R)
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="1 or 0.5"
                                value={preTrade.plannedRiskR || ''}
                                onChange={(e) => setPreTrade((pt) => ({ ...pt, plannedRiskR: e.target.value }))}
                                className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                              />
                            </div>

                            <div>
                              <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                                Link to Saved Analysis (Optional)
                              </label>
                              <select
                                value={preTrade.linkedReportId || ''}
                                onChange={(e) => setPreTrade((pt) => ({ ...pt, linkedReportId: e.target.value }))}
                                className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs cursor-pointer"
                              >
                                <option value="">None (Standalone Entry)</option>
                                {reportsList.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.title || `${r.pair} Analysis (${r.date})`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Reason for Considering Trade
                            </label>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Why is this trade valid under your strategy? What market condition supports it?"
                              value={preTrade.reasonForTrade || ''}
                              onChange={(e) => setPreTrade((pt) => ({ ...pt, reasonForTrade: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Pre-Trade Confirmation Checklist
                            </label>
                            <div className="space-y-1.5">
                              {(preTrade.confirmationChecklist || []).map((chk, idx) => (
                                <label
                                  key={idx}
                                  className="flex items-center gap-2 p-2 rounded bg-app-main border border-app cursor-pointer hover:bg-app-field transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    checked={chk.checked}
                                    onChange={(e) => {
                                      const next = [...(preTrade.confirmationChecklist || [])];
                                      next[idx] = { ...next[idx], checked: e.target.checked };
                                      setPreTrade((pt) => ({ ...pt, confirmationChecklist: next }));
                                    }}
                                    className="rounded text-emerald-theme focus:ring-emerald-500"
                                  />
                                  <span className={`text-xs ${chk.checked ? 'text-app-main font-semibold' : 'text-app-secondary'}`}>
                                    {chk.item}
                                  </span>
                                </label>
                              ))}
                            </div>

                            <div className="flex items-center gap-2 mt-2">
                              <input
                                type="text"
                                spellCheck
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                placeholder="Add custom confirmation rule..."
                                value={newChecklistText}
                                onChange={(e) => setNewChecklistText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newChecklistText.trim()) {
                                    e.preventDefault();
                                    setPreTrade((pt) => ({
                                      ...pt,
                                      confirmationChecklist: [
                                        ...(pt.confirmationChecklist || []),
                                        { item: newChecklistText.trim(), checked: false },
                                      ],
                                    }));
                                    setNewChecklistText('');
                                  }
                                }}
                                className="flex-1 px-2.5 py-1.5 rounded border border-app bg-app-main text-xs text-app-main"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (newChecklistText.trim()) {
                                    setPreTrade((pt) => ({
                                      ...pt,
                                      confirmationChecklist: [
                                        ...(pt.confirmationChecklist || []),
                                        { item: newChecklistText.trim(), checked: false },
                                      ],
                                    }));
                                    setNewChecklistText('');
                                  }
                                }}
                                className="px-3 py-1.5 rounded bg-app-field border border-app text-xs font-semibold text-app-main hover:bg-app-main cursor-pointer"
                              >
                                Add Rule
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PHASE 3: In-Trade Management */}
                    <div
                      data-journal-phase="inTrade"
                      className="rounded-lg border border-app bg-app-field/25 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase('inTrade')}
                        aria-expanded={openPhases.inTrade}
                        className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 bg-app-secondary/50 hover:bg-app-secondary/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs sm:text-sm text-app-main">
                            3. In-Trade Management
                          </div>
                          <div className="text-[11px] text-app-secondary truncate">
                            Mindset during trade, active management &amp; emotional observations
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusPillClass(inTradeStatus)}`}>
                            {inTradeStatus}
                          </span>
                          {openPhases.inTrade ? <ChevronUp className="w-4 h-4 text-app-secondary" /> : <ChevronDown className="w-4 h-4 text-app-secondary" />}
                        </div>
                      </button>

                      {openPhases.inTrade && (
                        <div className="p-3.5 space-y-3.5 border-t border-app/60">
                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1.5">
                              Mindset During Trade
                            </label>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {IN_TRADE_MINDSET_PRESETS.map((preset) => {
                                const isSel = (inTrade.mindsets || []).includes(preset);
                                return (
                                  <button
                                    key={preset}
                                    type="button"
                                    aria-pressed={isSel}
                                    onClick={() => {
                                      const cur = inTrade.mindsets || [];
                                      setInTrade((it) => ({
                                        ...it,
                                        mindsets: isSel ? cur.filter((x) => x !== preset) : [...cur, preset],
                                      }));
                                    }}
                                    className={`min-h-[36px] px-2.5 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                                      isSel
                                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-theme font-bold'
                                        : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                    }`}
                                  >
                                    {isSel ? '✓ ' : ''}
                                    {preset}
                                  </button>
                                );
                              })}
                            </div>
                            <input
                              type="text"
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Other mindset state (optional)..."
                              value={inTrade.mindsetOther || ''}
                              onChange={(e) => setInTrade((it) => ({ ...it, mindsetOther: e.target.value }))}
                              className="w-full px-3 py-1.5 rounded border border-app bg-app-main text-app-main text-xs"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Management Decisions &amp; Plan Adjustments
                            </label>
                            <textarea
                              rows={3}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="e.g. Moved stop to breakeven after 1:2 reached; took 50% partial at internal high..."
                              value={inTrade.managementDecisions || ''}
                              onChange={(e) => setInTrade((it) => ({ ...it, managementDecisions: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[11px] font-bold text-app-main uppercase block">
                              Emotional Observations &amp; Urges During Trade
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {IN_TRADE_OBSERVATION_PRESETS.map((obs) => {
                                const isSel = (inTrade.emotionalObservationTags || []).includes(obs);
                                return (
                                  <button
                                    key={obs}
                                    type="button"
                                    aria-pressed={isSel}
                                    onClick={() => {
                                      const cur = inTrade.emotionalObservationTags || [];
                                      setInTrade((it) => ({
                                        ...it,
                                        emotionalObservationTags: isSel ? cur.filter((x) => x !== obs) : [...cur, obs],
                                      }));
                                    }}
                                    className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                                      isSel
                                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold'
                                        : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                    }`}
                                  >
                                    {isSel ? '✓ ' : '+ '}
                                    {obs}
                                  </button>
                                );
                              })}
                              {(inTrade.emotionalObservationTags || [])
                                .filter((t) => !(IN_TRADE_OBSERVATION_PRESETS as ReadonlyArray<string>).includes(t))
                                .map((customTag) => (
                                  <button
                                    key={customTag}
                                    type="button"
                                    onClick={() =>
                                      setInTrade((it) => ({
                                        ...it,
                                        emotionalObservationTags: (it.emotionalObservationTags || []).filter((x) => x !== customTag),
                                      }))
                                    }
                                    className="px-2.5 py-1 rounded border border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold cursor-pointer"
                                  >
                                    ✕ {customTag}
                                  </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                spellCheck
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                placeholder="Add custom emotional observation tag..."
                                value={newInTradeObsTag}
                                onChange={(e) => setNewInTradeObsTag(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newInTradeObsTag.trim()) {
                                    e.preventDefault();
                                    const trimmed = newInTradeObsTag.trim();
                                    setInTrade((it) => ({
                                      ...it,
                                      emotionalObservationTags: (it.emotionalObservationTags || []).includes(trimmed)
                                        ? it.emotionalObservationTags
                                        : [...(it.emotionalObservationTags || []), trimmed],
                                    }));
                                    setNewInTradeObsTag('');
                                  }
                                }}
                                className="flex-1 px-2.5 py-1.5 rounded border border-app bg-app-main text-xs text-app-main"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const trimmed = newInTradeObsTag.trim();
                                  if (!trimmed) return;
                                  setInTrade((it) => ({
                                    ...it,
                                    emotionalObservationTags: (it.emotionalObservationTags || []).includes(trimmed)
                                      ? it.emotionalObservationTags
                                      : [...(it.emotionalObservationTags || []), trimmed],
                                  }));
                                  setNewInTradeObsTag('');
                                }}
                                className="px-3 py-1.5 rounded bg-app-field border border-app text-xs font-semibold text-app-main cursor-pointer"
                              >
                                Add Tag
                              </button>
                            </div>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Detailed notes on what you felt during execution (kept separate from Rule Compliance)..."
                              value={inTrade.emotionalObservations || ''}
                              onChange={(e) => setInTrade((it) => ({ ...it, emotionalObservations: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PHASE 4: Review & Discipline */}
                    <div
                      data-journal-phase="postTrade"
                      className="rounded-lg border border-app bg-app-field/25 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase('postTrade')}
                        aria-expanded={openPhases.postTrade}
                        className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 bg-app-secondary/50 hover:bg-app-secondary/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs sm:text-sm text-app-main">
                            4. Review &amp; Discipline
                          </div>
                          <div className="text-[11px] text-app-secondary truncate">
                            Rule compliance, mistake &amp; lesson tags, execution takeaway
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusPillClass(postTradeStatus)}`}>
                            {postTradeStatus}
                          </span>
                          {openPhases.postTrade ? <ChevronUp className="w-4 h-4 text-app-secondary" /> : <ChevronDown className="w-4 h-4 text-app-secondary" />}
                        </div>
                      </button>

                      {openPhases.postTrade && (
                        <div className="p-3.5 space-y-3.5 border-t border-app/60">
                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Trading Rule Compliance Status
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => setPostTrade((pt) => ({ ...pt, rulesFollowedStatus: 'Followed' }))}
                                className={`min-h-[44px] px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
                                  postTrade.rulesFollowedStatus === 'Followed'
                                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-theme'
                                    : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                }`}
                              >
                                ✓ Rules Followed
                              </button>
                              <button
                                type="button"
                                onClick={() => setPostTrade((pt) => ({ ...pt, rulesFollowedStatus: 'Broken' }))}
                                className={`min-h-[44px] px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
                                  postTrade.rulesFollowedStatus === 'Broken'
                                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                                    : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                }`}
                              >
                                ✕ Rules Broken
                              </button>
                              <button
                                type="button"
                                onClick={() => setPostTrade((pt) => ({ ...pt, rulesFollowedStatus: 'Unreviewed' }))}
                                className={`min-h-[44px] px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
                                  postTrade.rulesFollowedStatus === 'Unreviewed'
                                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                                    : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                                }`}
                              >
                                ? Unreviewed
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Mistake Tags (if any rules were broken)
                            </label>
                            <div className="flex flex-wrap items-center gap-1.5 mb-2">
                              {mergedMistakeSuggestions.map((tag) => {
                                const isSelected = (postTrade.mistakeTags || []).includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      const cur = postTrade.mistakeTags || [];
                                      setPostTrade((pt) => ({
                                        ...pt,
                                        mistakeTags: isSelected ? cur.filter((t) => t !== tag) : [...cur, tag],
                                      }));
                                    }}
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-300'
                                        : 'bg-app-main text-app-secondary border-app hover:text-app-main'
                                    }`}
                                  >
                                    {isSelected ? '✕ ' : '+ '}
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                spellCheck
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                placeholder="Add custom mistake tag..."
                                value={customMistakeInput}
                                onChange={(e) => setCustomMistakeInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && customMistakeInput.trim()) {
                                    e.preventDefault();
                                    const trimmed = customMistakeInput.trim();
                                    setPostTrade((pt) => ({
                                      ...pt,
                                      mistakeTags: (pt.mistakeTags || []).includes(trimmed)
                                        ? pt.mistakeTags
                                        : [...(pt.mistakeTags || []), trimmed],
                                    }));
                                    setCustomMistakeInput('');
                                  }
                                }}
                                className="flex-1 px-2.5 py-1.5 rounded border border-app bg-app-main text-xs text-app-main"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const trimmed = customMistakeInput.trim();
                                  if (!trimmed) return;
                                  setPostTrade((pt) => ({
                                    ...pt,
                                    mistakeTags: (pt.mistakeTags || []).includes(trimmed)
                                      ? pt.mistakeTags
                                      : [...(pt.mistakeTags || []), trimmed],
                                  }));
                                  setCustomMistakeInput('');
                                }}
                                className="px-3 py-1.5 rounded bg-app-field border border-app text-xs font-semibold text-app-main cursor-pointer"
                              >
                                Add Mistake
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Lesson Tags &amp; Best Practices
                            </label>
                            <div className="flex flex-wrap items-center gap-1.5 mb-2">
                              {mergedLessonSuggestions.map((tag) => {
                                const isSelected = (postTrade.lessonTags || []).includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      const cur = postTrade.lessonTags || [];
                                      setPostTrade((pt) => ({
                                        ...pt,
                                        lessonTags: isSelected ? cur.filter((t) => t !== tag) : [...cur, tag],
                                      }));
                                    }}
                                    className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                                      isSelected
                                        ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                                        : 'bg-app-main text-app-secondary border-app hover:text-app-main'
                                    }`}
                                  >
                                    {isSelected ? '✓ ' : '+ '}
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                spellCheck
                                autoCorrect="on"
                                autoCapitalize="sentences"
                                placeholder="Add custom lesson tag..."
                                value={customLessonInput}
                                onChange={(e) => setCustomLessonInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && customLessonInput.trim()) {
                                    e.preventDefault();
                                    const trimmed = customLessonInput.trim();
                                    setPostTrade((pt) => ({
                                      ...pt,
                                      lessonTags: (pt.lessonTags || []).includes(trimmed)
                                        ? pt.lessonTags
                                        : [...(pt.lessonTags || []), trimmed],
                                    }));
                                    setCustomLessonInput('');
                                  }
                                }}
                                className="flex-1 px-2.5 py-1.5 rounded border border-app bg-app-main text-xs text-app-main"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const trimmed = customLessonInput.trim();
                                  if (!trimmed) return;
                                  setPostTrade((pt) => ({
                                    ...pt,
                                    lessonTags: (pt.lessonTags || []).includes(trimmed)
                                      ? pt.lessonTags
                                      : [...(pt.lessonTags || []), trimmed],
                                  }));
                                  setCustomLessonInput('');
                                }}
                                className="px-3 py-1.5 rounded bg-app-field border border-app text-xs font-semibold text-app-main cursor-pointer"
                              >
                                Add Lesson
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                              Execution Quality &amp; Key Takeaway
                            </label>
                            <textarea
                              rows={3}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="What should you repeat next time? What specific behavior should be improved?"
                              value={postTrade.executionReview || ''}
                              onChange={(e) => setPostTrade((pt) => ({ ...pt, executionReview: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PHASE 5: Daily Reflection */}
                    <div
                      data-journal-phase="reflection"
                      className="rounded-lg border border-app bg-app-field/25 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase('reflection')}
                        aria-expanded={openPhases.reflection}
                        className="w-full min-h-[44px] px-3.5 py-2.5 flex items-center justify-between gap-2 bg-app-secondary/50 hover:bg-app-secondary/80 transition-colors cursor-pointer text-left"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs sm:text-sm text-app-main">
                            5. Daily Reflection
                          </div>
                          <div className="text-[11px] text-app-secondary truncate">
                            What worked, what didn&rsquo;t, no-trade status &amp; next session commitment
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusPillClass(reflectionStatus)}`}>
                            {reflectionStatus}
                          </span>
                          {openPhases.reflection ? <ChevronUp className="w-4 h-4 text-app-secondary" /> : <ChevronDown className="w-4 h-4 text-app-secondary" />}
                        </div>
                      </button>

                      {openPhases.reflection && (
                        <div className="p-3.5 space-y-3.5 border-t border-app/60">
                          <label className="flex items-center gap-2 p-2.5 rounded bg-app-main border border-app cursor-pointer">
                            <input
                              type="checkbox"
                              checked={reflection.noTradesDay || false}
                              onChange={(e) => setReflection((r) => ({ ...r, noTradesDay: e.target.checked }))}
                              className="rounded text-emerald-theme focus:ring-emerald-500"
                            />
                            <div>
                              <span className="font-bold text-xs text-app-main block">
                                Record as No-Trade Day
                              </span>
                              <span className="text-[11px] text-app-secondary">
                                Documenting non-trading days preserves discipline and tracks patience when criteria are not met.
                              </span>
                            </div>
                          </label>

                          <div>
                            <label className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase block mb-1">
                              What Worked Today
                            </label>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Positive execution habits, patience, rule adhesion..."
                              value={reflection.whatWorked || ''}
                              onChange={(e) => setReflection((r) => ({ ...r, whatWorked: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase block mb-1">
                              What Did Not Work
                            </label>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="Hesitation, overtrading, missed invalidations..."
                              value={reflection.whatDidNot || ''}
                              onChange={(e) => setReflection((r) => ({ ...r, whatDidNot: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-bold text-blue-600 dark:text-blue-400 uppercase block mb-1">
                              Commitment for Next Session
                            </label>
                            <textarea
                              rows={2}
                              spellCheck
                              autoCorrect="on"
                              autoCapitalize="sentences"
                              placeholder="One concrete behavioral commitment for the next trading session."
                              value={reflection.nextSessionCommitment || ''}
                              onChange={(e) => setReflection((r) => ({ ...r, nextSessionCommitment: e.target.value }))}
                              className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Discard confirmation */}
            {showDiscardConfirm && (
              <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-300 dark:border-amber-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-amber-900 dark:text-amber-200">
                  Discard unsaved journal changes?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDiscardConfirm(false)}
                    className="px-3 py-1.5 text-xs font-medium text-app-main bg-app-main border border-app rounded hover:bg-app-field cursor-pointer"
                  >
                    Keep editing
                  </button>
                  <button
                    type="button"
                    onClick={executeDiscardAndCloseEditor}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
                  >
                    Discard changes
                  </button>
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-app bg-app-secondary/60">
              <button
                type="button"
                onClick={handleRequestCloseEditor}
                className="px-4 py-2 text-xs font-semibold text-app-secondary hover:text-app-main cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveEntry}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold text-white bg-emerald-theme hover:bg-emerald-theme-hover shadow-2xs transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{editingEntryId ? 'Save Changes' : 'Save Journal Entry'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
