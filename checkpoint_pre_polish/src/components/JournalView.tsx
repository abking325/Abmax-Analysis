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
} from 'lucide-react';
import {
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  EmotionalReadiness,
  JournalDailyReflection,
  JournalEntry,
  JournalEntryType,
  JournalInTrade,
  JournalPostTrade,
  JournalPreTrade,
  JournalPrep,
  JournalVisibilityConfig,
  SavedReport,
  TradingPair,
  TradingSession,
} from '../types/journal';
import {
  clearJournalDraft,
  deleteJournalEntry,
  getAllJournalEntries,
  getJournalDraft,
  isJournalEntryOwnedByScope,
  normalizeAccountScope,
  saveJournalDraft,
  saveJournalEntry,
  saveImage,
} from '../services/db';
import { MyJournalSection } from './MyJournalSection';

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

interface JournalViewProps {
  reportsList: SavedReport[];
  onOpenReport?: (reportId: string) => void;
  userId?: string | null;
  journalVisibilityConfig?: JournalVisibilityConfig;
  onOpenSettings?: (tab?: 'general' | 'journal_visibility' | 'performance_visibility' | 'admin') => void;
}

export const JournalView: React.FC<JournalViewProps> = ({
  reportsList,
  onOpenReport,
  userId,
  journalVisibilityConfig = DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  onOpenSettings,
}) => {
  const [mainJournalTab, setMainJournalTab] = useState<'my-journal' | 'trading-journal'>(() => {
    return journalVisibilityConfig.myJournal !== false ? 'my-journal' : 'trading-journal';
  });

  // Check if every journal section is hidden
  const isAllHidden = useMemo(() => {
    return Object.values(journalVisibilityConfig).every((val) => val === false);
  }, [journalVisibilityConfig]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPair, setSelectedPair] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<string>('all');
  const [selectedRuleStatus, setSelectedRuleStatus] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  // Form State
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  const [session, setSession] = useState<TradingSession>('London');
  const [pair, setPair] = useState<TradingPair>('XAUUSD');
  const [entryType, setEntryType] = useState<JournalEntryType>('general');

  // Sections
  const [prep, setPrep] = useState<JournalPrep>({
    sessionIntention: '',
    readinessState: 'Optimal / Calm',
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
    plannedRiskR: '1R',
    linkedReportId: '',
  });

  const [inTrade, setInTrade] = useState<JournalInTrade>({
    managementDecisions: '',
    planAdjustments: '',
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
  const [activeTab, setActiveTab] = useState<'prep' | 'preTrade' | 'inTrade' | 'postTrade' | 'reflection'>('prep');
  const [hasDraftNotice, setHasDraftNotice] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newRuleText, setNewRuleText] = useState('');
  const [timelineInput, setTimelineInput] = useState('');

  // Load entries on mount
  const refreshEntries = async () => {
    setLoading(true);
    try {
      const list = await getAllJournalEntries();
      setEntries(list);
    } catch (err) {
      console.error('Error loading journal entries', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshEntries();
  }, []);

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

  // Auto-save draft when editor is open, bound strictly to the active account scope
  useEffect(() => {
    if (!isEditorOpen) return;

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
    title,
    date,
    time,
    session,
    pair,
    entryType,
    prep,
    preTrade,
    inTrade,
    postTrade,
    reflection,
    generalNotes,
    userId,
  ]);

  const resetForm = () => {
    setTitle('');
    setDate(new Date().toISOString().slice(0, 10));
    setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setSession('London');
    setPair('XAUUSD');
    setEntryType('general');
    setPrep({
      sessionIntention: '',
      readinessState: 'Optimal / Calm',
      prioritizedRules: [],
      dailyPlanNotes: '',
    });
    setPreTrade({
      reasonForTrade: '',
      setupTag: '',
      confirmationChecklist: [
        { item: 'HTF liquidity swept / tapped', checked: false },
        { item: 'Clear 15M / 5M MSS confirmation', checked: false },
        { item: 'Aligned with overall bias', checked: false },
        { item: 'Acceptable risk-to-reward ratio', checked: false },
      ],
      plannedRiskR: '1R',
      linkedReportId: '',
    });
    setInTrade({
      managementDecisions: '',
      planAdjustments: '',
      emotionalObservations: '',
      timelineNotes: [],
    });
    setPostTrade({
      executionReview: '',
      rulesFollowedStatus: 'Followed',
      mistakeTags: [],
      lessonTags: [],
      repeatOrImprove: '',
    });
    setReflection({
      whatWorked: '',
      whatDidNot: '',
      keyLessons: '',
      nextSessionCommitment: '',
      noTradesDay: false,
    });
    setGeneralNotes('');
    setEditingEntryId(null);
    setActiveTab('prep');
  };

  const openNewEntry = () => {
    resetForm();
    setIsEditorOpen(true);
  };

  const openEditEntry = (entry: JournalEntry) => {
    setEditingEntryId(entry.id);
    setTitle(entry.title || '');
    setDate(entry.date || new Date().toISOString().slice(0, 10));
    setTime(entry.time || '');
    setSession(entry.session || 'London');
    setPair(entry.pair || 'XAUUSD');
    setEntryType(entry.entryType || 'general');
    if (entry.prep) setPrep(entry.prep);
    if (entry.preTrade) setPreTrade(entry.preTrade);
    if (entry.inTrade) setInTrade(entry.inTrade);
    if (entry.postTrade) setPostTrade(entry.postTrade);
    if (entry.reflection) setReflection(entry.reflection);
    setGeneralNotes(entry.generalNotes || '');
    setIsEditorOpen(true);
  };

  const handleApplyDraft = async () => {
    const draft = await getJournalDraft(userId);
    if (!draft) return;
    if (draft.title) setTitle(draft.title);
    if (draft.date) setDate(draft.date);
    if (draft.time) setTime(draft.time);
    if (draft.session) setSession(draft.session);
    if (draft.pair) setPair(draft.pair);
    if (draft.entryType) setEntryType(draft.entryType);
    if (draft.prep) setPrep(draft.prep);
    if (draft.preTrade) setPreTrade(draft.preTrade);
    if (draft.inTrade) setInTrade(draft.inTrade);
    if (draft.postTrade) setPostTrade(draft.postTrade);
    if (draft.reflection) setReflection(draft.reflection);
    if (draft.generalNotes) setGeneralNotes(draft.generalNotes);
    setHasDraftNotice(false);
    setIsEditorOpen(true);
  };

  const handleSaveEntry = async () => {
    const defaultTitle = reflection.noTradesDay
      ? `No Trades — ${date} (${session})`
      : title.trim() || `${pair} ${session} Session Reflection (${date})`;

    const selectedLinkedReport = reportsList.find((r) => r.id === preTrade.linkedReportId);

    const payload: JournalEntry = {
      id: editingEntryId || `jrn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      title: defaultTitle,
      date,
      time,
      session,
      pair,
      entryType,
      prep,
      preTrade,
      inTrade,
      postTrade,
      reflection,
      generalNotes,
      linkedReportId: preTrade.linkedReportId || undefined,
      linkedReportTitle: selectedLinkedReport ? selectedLinkedReport.title || `${selectedLinkedReport.pair} Analysis` : undefined,
      createdAt: editingEntryId ? entries.find((e) => e.id === editingEntryId)?.createdAt || Date.now() : Date.now(),
      updatedAt: Date.now(),
      userId: normalizeAccountScope(userId),
    };

    hasPendingDebounceRef.current = false;
    await saveJournalEntry(payload);
    await clearJournalDraft(userId);
    setHasDraftNotice(false);
    setIsEditorOpen(false);
    resetForm();
    await refreshEntries();
  };

  const handleDeleteEntry = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this journal entry?')) {
      await deleteJournalEntry(id);
      await refreshEntries();
    }
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
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (e.title || '').toLowerCase().includes(q);
        const matchesNotes = (e.generalNotes || '').toLowerCase().includes(q);
        const matchesReason = (e.preTrade?.reasonForTrade || '').toLowerCase().includes(q);
        const matchesSetup = (e.preTrade?.setupTag || '').toLowerCase().includes(q);
        const matchesReview = (e.postTrade?.executionReview || '').toLowerCase().includes(q);
        const matchesMistakes = (e.postTrade?.mistakeTags || []).some((m) => m.toLowerCase().includes(q));
        const matchesLessons = (e.postTrade?.lessonTags || []).some((l) => l.toLowerCase().includes(q));
        if (
          !matchesTitle &&
          !matchesNotes &&
          !matchesReason &&
          !matchesSetup &&
          !matchesReview &&
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
  }, [tradingJournalEntries, searchQuery, selectedPair, selectedSession, selectedRuleStatus, selectedDateFilter]);

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

  if (isAllHidden) {
    return (
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-12">
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
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 space-y-5">
      {/* Main Journal Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-app pb-2">
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
      </div>

      {mainJournalTab === 'my-journal' && journalVisibilityConfig.myJournal !== false ? (
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
            className="w-full px-2.5 py-2 rounded-md bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Instruments</option>
            <option value="XAUUSD">XAUUSD</option>
            <option value="BTCUSD">BTCUSD</option>
            <option value="EURUSD">EURUSD</option>
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
                      {entry.prep?.readinessState && (
                        <span>· Readiness: {entry.prep.readinessState}</span>
                      )}
                    </div>
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
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="p-1.5 rounded text-app-secondary hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                      title="Delete journal entry"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
                            <span className="text-app-secondary">({entry.preTrade.plannedRiskR} Risk)</span>
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
                onClick={() => setIsEditorOpen(false)}
                className="p-1 rounded text-app-secondary hover:text-app-main cursor-pointer"
                aria-label="Close editor"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
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
                    className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs cursor-pointer"
                  >
                    <option value="XAUUSD">XAUUSD</option>
                    <option value="BTCUSD">BTCUSD</option>
                    <option value="EURUSD">EURUSD</option>
                  </select>
                </div>
              </div>

              {/* Title / Headline */}
              <div>
                <label className="text-[11px] font-bold text-app-secondary uppercase block mb-1">
                  Entry Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. London Session Sweep & Expansion — Strict Discipline"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-app bg-app-field text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {/* Tab Navigation for Structured Input */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-app-field border border-app overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('prep')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'prep'
                      ? 'bg-app-main text-emerald-theme shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  1. Preparation
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preTrade')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'preTrade'
                      ? 'bg-app-main text-emerald-theme shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  2. Pre-Trade
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('inTrade')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'inTrade'
                      ? 'bg-app-main text-emerald-theme shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  3. In-Trade
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('postTrade')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'postTrade'
                      ? 'bg-app-main text-emerald-theme shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  4. Review &amp; Discipline
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reflection')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                    activeTab === 'reflection'
                      ? 'bg-app-main text-emerald-theme shadow-2xs'
                      : 'text-app-secondary hover:text-app-main'
                  }`}
                >
                  5. Daily Reflection
                </button>
              </div>

              {/* Tab 1: Preparation */}
              {activeTab === 'prep' && (
                <div className="space-y-3.5 p-3.5 rounded-lg border border-app bg-app-field/30">
                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Emotional Readiness &amp; Mindset
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {EMOTIONAL_STATES.map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setPrep((p) => ({ ...p, readinessState: st }))}
                          className={`px-3 py-2 rounded border text-xs font-medium text-left transition-colors cursor-pointer ${
                            prep.readinessState === st
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-theme font-bold'
                              : 'border-app bg-app-main text-app-secondary hover:text-app-main'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Session Intention &amp; Focus
                    </label>
                    <textarea
                      rows={2}
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
                      placeholder="Key daily/hourly levels to monitor, news releases, expected volatility..."
                      value={prep.dailyPlanNotes || ''}
                      onChange={(e) => setPrep((p) => ({ ...p, dailyPlanNotes: e.target.value }))}
                      className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Tab 2: Pre-Trade */}
              {activeTab === 'preTrade' && (
                <div className="space-y-3.5 p-3.5 rounded-lg border border-app bg-app-field/30">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                        Setup / Strategy Tag
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Liquidity Sweep + MSS"
                        value={preTrade.setupTag || ''}
                        onChange={(e) => setPreTrade((pt) => ({ ...pt, setupTag: e.target.value }))}
                        className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                      />
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {COMMON_SETUP_TAGS.slice(0, 4).map((tag) => (
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
                              next[idx].checked = e.target.checked;
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

              {/* Tab 3: In-Trade */}
              {activeTab === 'inTrade' && (
                <div className="space-y-3.5 p-3.5 rounded-lg border border-app bg-app-field/30">
                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Management Decisions &amp; Plan Adjustments
                    </label>
                    <textarea
                      rows={3}
                      placeholder="e.g. Moved stop to breakeven after 1:2 reached; took 50% partial at internal high..."
                      value={inTrade.managementDecisions || ''}
                      onChange={(e) => setInTrade((it) => ({ ...it, managementDecisions: e.target.value }))}
                      className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Emotional Observations During Trade
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Did you feel tempted to close early? Over-monitoring? Calm execution?"
                      value={inTrade.emotionalObservations || ''}
                      onChange={(e) => setInTrade((it) => ({ ...it, emotionalObservations: e.target.value }))}
                      className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Tab 4: Post-Trade Review & Discipline */}
              {activeTab === 'postTrade' && (
                <div className="space-y-3.5 p-3.5 rounded-lg border border-app bg-app-field/30">
                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Trading Rule Compliance Status
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPostTrade((pt) => ({ ...pt, rulesFollowedStatus: 'Followed' }))}
                        className={`px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
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
                        className={`px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
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
                        className={`px-3 py-2 rounded border text-xs font-bold transition-colors cursor-pointer text-center ${
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
                      {COMMON_MISTAKE_TAGS.map((tag) => {
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
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Lesson Tags &amp; Best Practices
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {COMMON_LESSON_TAGS.map((tag) => {
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
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-app-main uppercase block mb-1">
                      Execution Quality &amp; Key Takeaway
                    </label>
                    <textarea
                      rows={3}
                      placeholder="What should you repeat next time? What specific behavior should be improved?"
                      value={postTrade.executionReview || ''}
                      onChange={(e) => setPostTrade((pt) => ({ ...pt, executionReview: e.target.value }))}
                      className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Tab 5: Daily Reflection */}
              {activeTab === 'reflection' && (
                <div className="space-y-3.5 p-3.5 rounded-lg border border-app bg-app-field/30">
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
                      placeholder="One concrete behavioral commitment for the next trading session."
                      value={reflection.nextSessionCommitment || ''}
                      onChange={(e) => setReflection((r) => ({ ...r, nextSessionCommitment: e.target.value }))}
                      className="w-full px-3 py-2 rounded border border-app bg-app-main text-app-main text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-app bg-app-secondary/60">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
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
                <span>Save Journal Entry</span>
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
