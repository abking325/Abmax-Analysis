import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  PenTool,
  Plus,
  Search,
  Calendar,
  Clock,
  Tag,
  Smile,
  Trash2,
  Edit3,
  Image as ImageIcon,
  Save,
  X,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Link as LinkIcon,
  Filter,
  Eye,
  Sliders,
  ExternalLink,
  Info,
} from 'lucide-react';
import {
  EmotionalReadiness,
  JournalEntry,
  JournalVisibilityConfig,
  MyJournalContext,
  SavedReport,
} from '../types/journal';
import {
  clearMyJournalDraft,
  deleteJournalEntry,
  getMyJournalDraft,
  isJournalEntryOwnedByScope,
  normalizeAccountScope,
  saveImage,
  saveJournalEntry,
  saveMyJournalDraft,
} from '../services/db';

const MY_JOURNAL_CONTEXTS: { value: MyJournalContext; label: string; color: string }[] = [
  { value: 'Before Trading', label: 'Before Trading', color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700' },
  { value: 'During Trading', label: 'During Trading', color: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700' },
  { value: 'After Trading', label: 'After Trading', color: 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700' },
  { value: 'General', label: 'General Reflection', color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' },
  { value: 'No-Trade Day', label: 'No-Trade Day', color: 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700' },
];

const PREDEFINED_TAGS = [
  'Psychology',
  'Discipline',
  'Milestone',
  'Rule to Remember',
  'Weekend Reflection',
  'Mindset',
  'Risk Management',
  'Patience',
  'Daily Routine',
];

const EMOTIONAL_STATES: EmotionalReadiness[] = [
  'Optimal / Calm',
  'Focused',
  'Anxious',
  'Fatigued',
  'Overconfident',
  'Distracted',
];

interface MyJournalSectionProps {
  entries: JournalEntry[];
  reportsList: SavedReport[];
  onOpenReport?: (reportId: string) => void;
  userId?: string | null;
  visibilityConfig?: JournalVisibilityConfig;
  onRefresh: () => Promise<void>;
  onOpenSettings?: (tab?: 'general' | 'journal_visibility' | 'performance_visibility' | 'admin') => void;
}

export const MyJournalSection: React.FC<MyJournalSectionProps> = ({
  entries,
  reportsList,
  onOpenReport,
  userId,
  visibilityConfig,
  onRefresh,
  onOpenSettings,
}) => {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  );
  const [contextTag, setContextTag] = useState<MyJournalContext>('General');
  const [mood, setMood] = useState<EmotionalReadiness | ''>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linkedReportId, setLinkedReportId] = useState<string>('');

  // Status & Autosave
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [hasDraftNotice, setHasDraftNotice] = useState(false);
  const [activeDraft, setActiveDraft] = useState<Partial<JournalEntry> | null>(null);
  const isSavingRef = useRef(false);
  const draftDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const currentUserIdRef = useRef<string | null | undefined>(userId);
  currentUserIdRef.current = userId;

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContextFilter, setSelectedContextFilter] = useState<string>('all');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');

  // Filter only My Journal entries with strict canonical ownership isolation
  const myJournalEntries = useMemo(() => {
    return entries.filter((e) => {
      const isMyJournal = e.entryType === 'my-journal' || e.entryType === ('my_journal' as any);
      if (!isMyJournal) return false;
      return isJournalEntryOwnedByScope(e, userId);
    });
  }, [entries, userId]);

  // Keep a synchronous ref of the latest editor payload for immediate flush before account switch
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
      generalNotes: content,
      date,
      time,
      entryType: 'my-journal',
      myJournalContext: contextTag,
      prep: mood ? { sessionIntention: '', readinessState: mood, prioritizedRules: [], dailyPlanNotes: '' } : undefined,
      tags: selectedTags,
      imageUrl: imageUrl || undefined,
      linkedReportId: linkedReportId || undefined,
    },
  };

  // Coordinated account switch & destination draft loader:
  // 1) Flush any pending changes to the previous owner's scope
  // 2) Clear only the visible editor state
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
          await saveMyJournalDraft(snap.payload, prevScope).catch(() => {});
        }
        if (isMounted) {
          setIsEditorOpen(false);
          setEditingEntryId(null);
          resetForm();
        }
        prevUserRef.current = userId;
      }

      const draft = await getMyJournalDraft(userId);
      if (!isMounted) return;
      if (draft && (draft.title || draft.generalNotes)) {
        setActiveDraft(draft);
        setHasDraftNotice(true);
      } else {
        setActiveDraft(null);
        setHasDraftNotice(false);
      }
    };

    handleAccountTransitionAndLoad();

    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Autosave draft when editor is open, bound strictly to the active user's scope
  useEffect(() => {
    if (!isEditorOpen) return;

    if (draftDebounceRef.current) {
      clearTimeout(draftDebounceRef.current);
    }

    setSavingStatus('saving');
    hasPendingDebounceRef.current = true;
    const targetUserId = userId; // capture current scope at time of keystroke

    draftDebounceRef.current = setTimeout(async () => {
      try {
        // Guard against delayed write if account switched during debounce
        if (normalizeAccountScope(currentUserIdRef.current) !== normalizeAccountScope(targetUserId)) {
          return;
        }
        const draftPayload: Partial<JournalEntry> = {
          title,
          generalNotes: content,
          date,
          time,
          entryType: 'my-journal',
          myJournalContext: contextTag,
          prep: mood ? { sessionIntention: '', readinessState: mood, prioritizedRules: [], dailyPlanNotes: '' } : undefined,
          tags: selectedTags,
          imageUrl: imageUrl || undefined,
          linkedReportId: linkedReportId || undefined,
        };
        await saveMyJournalDraft(draftPayload, targetUserId);
        hasPendingDebounceRef.current = false;
        setSavingStatus('saved');
      } catch (err) {
        console.error('Error auto-saving My Journal draft:', err);
        setSavingStatus('error');
      }
    }, 800);

    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
    };
  }, [
    isEditorOpen,
    title,
    content,
    date,
    time,
    contextTag,
    mood,
    selectedTags,
    imageUrl,
    linkedReportId,
    userId,
  ]);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setDate(new Date().toISOString().slice(0, 10));
    setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    setContextTag('General');
    setMood('');
    setSelectedTags([]);
    setCustomTagInput('');
    setImageUrl(null);
    setLinkedReportId('');
    setEditingEntryId(null);
    setSavingStatus('idle');
  };

  const handleOpenNewNote = () => {
    resetForm();
    setIsEditorOpen(true);
  };

  const handleApplyDraft = () => {
    if (!activeDraft) return;
    if (activeDraft.title) setTitle(activeDraft.title);
    if (activeDraft.generalNotes) setContent(activeDraft.generalNotes);
    if (activeDraft.date) setDate(activeDraft.date);
    if (activeDraft.time) setTime(activeDraft.time);
    if (activeDraft.myJournalContext) setContextTag(activeDraft.myJournalContext);
    if (activeDraft.prep?.readinessState) setMood(activeDraft.prep.readinessState);
    if (activeDraft.tags) setSelectedTags(activeDraft.tags);
    if (activeDraft.imageUrl) setImageUrl(activeDraft.imageUrl);
    if (activeDraft.linkedReportId) setLinkedReportId(activeDraft.linkedReportId);
    setHasDraftNotice(false);
    setIsEditorOpen(true);
  };

  const handleDiscardDraft = async () => {
    await clearMyJournalDraft(userId);
    setActiveDraft(null);
    setHasDraftNotice(false);
  };

  const handleEditNote = (entry: JournalEntry) => {
    setEditingEntryId(entry.id);
    setTitle(entry.title || '');
    setContent(entry.generalNotes || '');
    setDate(entry.date || new Date().toISOString().slice(0, 10));
    setTime(entry.time || '');
    setContextTag(entry.myJournalContext || 'General');
    setMood(entry.prep?.readinessState || '');
    setSelectedTags(entry.tags || []);
    setImageUrl(entry.imageUrl || null);
    setLinkedReportId(entry.linkedReportId || '');
    setIsEditorOpen(true);
  };

  const handleSaveNote = async () => {
    if (isSavingRef.current) return;
    if (!content.trim() && !title.trim()) {
      alert('Please enter a note title or reflection content before saving.');
      return;
    }

    isSavingRef.current = true;
    setSavingStatus('saving');

    try {
      const now = Date.now();
      const defaultTitle =
        title.trim() ||
        `${contextTag} Reflection — ${date}${time ? ` ${time}` : ''}`;

      const selectedLinkedReport = reportsList.find((r) => r.id === linkedReportId);

      const payload: JournalEntry = {
        id: editingEntryId || `jrn_my_${now}_${Math.random().toString(36).substring(2, 9)}`,
        title: defaultTitle,
        date,
        time,
        entryType: 'my-journal',
        myJournalContext: contextTag,
        generalNotes: content.trim(),
        tags: selectedTags,
        imageUrl: imageUrl || undefined,
        linkedReportId: linkedReportId || undefined,
        linkedReportTitle: selectedLinkedReport
          ? selectedLinkedReport.title || `${selectedLinkedReport.pair} Analysis`
          : undefined,
        prep: mood
          ? {
              sessionIntention: '',
              readinessState: mood,
              prioritizedRules: [],
              dailyPlanNotes: '',
            }
          : undefined,
        createdAt: editingEntryId
          ? entries.find((e) => e.id === editingEntryId)?.createdAt || now
          : now,
        updatedAt: now,
        userId: normalizeAccountScope(userId),
      };

      hasPendingDebounceRef.current = false;
      await saveJournalEntry(payload);
      await clearMyJournalDraft(userId);
      setHasDraftNotice(false);
      setActiveDraft(null);
      setIsEditorOpen(false);
      resetForm();
      await onRefresh();
    } catch (err) {
      console.error('Error saving My Journal entry:', err);
      setSavingStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this personal reflection note?')) {
      await deleteJournalEntry(id);
      await onRefresh();
    }
  };

  const handleAddCustomTag = () => {
    const trimmed = customTagInput.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
      setCustomTagInput('');
    }
  };

  const togglePredefinedTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setImageUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Filtered Notes
  const filteredNotes = useMemo(() => {
    return myJournalEntries.filter((n) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (n.title || '').toLowerCase().includes(q);
        const matchesContent = (n.generalNotes || '').toLowerCase().includes(q);
        const matchesTags = (n.tags || []).some((t) => t.toLowerCase().includes(q));
        if (!matchesTitle && !matchesContent && !matchesTags) {
          return false;
        }
      }

      // Context filter
      if (selectedContextFilter !== 'all') {
        if (n.myJournalContext !== selectedContextFilter) {
          return false;
        }
      }

      // Tag filter
      if (selectedTagFilter !== 'all') {
        if (!n.tags?.includes(selectedTagFilter)) {
          return false;
        }
      }

      // Date range filter
      if (selectedDateFilter !== 'all') {
        const todayStr = new Date().toISOString().slice(0, 10);
        if (selectedDateFilter === 'today') {
          if (n.date !== todayStr) return false;
        } else if (selectedDateFilter === 'week') {
          const now = new Date();
          const day = now.getDay();
          const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
          const mondayStr = new Date(now.setDate(diffToMonday)).toISOString().slice(0, 10);
          if (n.date < mondayStr || n.date > todayStr) return false;
        } else if (selectedDateFilter === 'month') {
          const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
          if (n.date < monthStart || n.date > todayStr) return false;
        }
      }

      return true;
    });
  }, [
    myJournalEntries,
    searchQuery,
    selectedContextFilter,
    selectedTagFilter,
    selectedDateFilter,
  ]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-app bg-app-main shadow-2xs">
        <div>
          <h2 className="text-base font-bold text-app-main flex items-center gap-2">
            <PenTool className="w-4 h-4 text-emerald-theme" />
            <span>My Journal &amp; Personal Notes</span>
          </h2>
          <p className="text-xs text-app-secondary mt-0.5">
            Write freely before, during, or after trading. Record psychology, mindsets, rules, and reflections without requiring an active trade or report.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNewNote}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-theme text-white hover:bg-emerald-theme-hover transition-colors cursor-pointer shadow-2xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Write a Note</span>
        </button>
      </div>

      {/* Local Storage Clarification */}
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-app-field/60 border border-app text-[11px] text-app-secondary">
        <Info className="w-3.5 h-3.5 text-emerald-theme shrink-0" />
        <span>
          <strong>Local-Only Storage:</strong> Personal reflections in My Journal are stored exclusively on this device and are not uploaded to cloud accounts. Use <strong>Settings &rarr; Backup &amp; Restore</strong> to keep full JSON backups.
        </span>
      </div>

      {/* Recover Draft Alert */}
      {hasDraftNotice && !isEditorOpen && (
        <div className="flex items-center justify-between p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>You have an unsaved note draft from your previous writing session.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApplyDraft}
              className="px-2.5 py-1 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors cursor-pointer"
            >
              Resume Draft
            </button>
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded transition-colors cursor-pointer"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-app-secondary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search personal notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-app-main border border-app text-xs text-app-main placeholder:text-app-secondary/60 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div>
          <select
            value={selectedContextFilter}
            onChange={(e) => setSelectedContextFilter(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Contexts</option>
            {MY_JOURNAL_CONTEXTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={selectedTagFilter}
            onChange={(e) => setSelectedTagFilter(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Tags</option>
            {PREDEFINED_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={selectedDateFilter}
            onChange={(e) => setSelectedDateFilter(e.target.value as any)}
            className="w-full px-2.5 py-2 rounded-lg bg-app-main border border-app text-xs text-app-main cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>

      {/* Editor Modal / Expanded Form */}
      {isEditorOpen && (
        <div className="p-4 sm:p-5 rounded-xl border border-emerald-500/40 bg-app-main shadow-lg space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-app">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-app-main">
                {editingEntryId ? 'Edit Personal Note' : 'New Personal Reflection'}
              </span>
              {/* Saving status indicator */}
              <div className="text-[11px] font-medium flex items-center gap-1">
                {savingStatus === 'saving' && (
                  <span className="text-amber-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Saving...</span>
                  </span>
                )}
                {savingStatus === 'saved' && (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Saved</span>
                  </span>
                )}
                {savingStatus === 'error' && (
                  <span className="text-rose-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Could not save</span>
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="p-1 rounded text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3.5">
            {/* Title & Context */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Pre-market psychological check-in"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider">
                  Context
                </label>
                <select
                  value={contextTag}
                  onChange={(e) => setContextTag(e.target.value as MyJournalContext)}
                  className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main cursor-pointer"
                >
                  {MY_JOURNAL_CONTEXTS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date & Time (supports backfilling) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-emerald-theme" />
                  <span>Date</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-theme" />
                  <span>Time</span>
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main cursor-pointer"
                />
              </div>

              {/* Mood / Emotional Readiness (optional) */}
              {visibilityConfig?.moodReadiness !== false && (
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                    <Smile className="w-3 h-3 text-emerald-theme" />
                    <span>Mood / Readiness</span>
                  </label>
                  <select
                    value={mood}
                    onChange={(e) => setMood(e.target.value as EmotionalReadiness | '')}
                    className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main cursor-pointer"
                  >
                    <option value="">None selected</option>
                    {EMOTIONAL_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Comfortable multiline writing area */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider">
                Personal Thoughts &amp; Observations
              </label>
              <textarea
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write freely: observations on market behavior, rules to remember, discipline checks, mental state, emotional obstacles, or post-session reflections..."
                className="w-full px-3.5 py-2.5 rounded-lg bg-app-field border border-app text-xs text-app-main leading-relaxed placeholder:text-app-secondary/60 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-sans"
              />
            </div>

            {/* Tags and Lessons */}
            {visibilityConfig?.tagsAndLessons !== false && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                  <Tag className="w-3 h-3 text-emerald-theme" />
                  <span>Tags</span>
                </label>

                {/* Predefined Chips */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {PREDEFINED_TAGS.map((t) => {
                    const isSelected = selectedTags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => togglePredefinedTag(t)}
                        className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer border ${
                          isSelected
                            ? 'bg-emerald-theme text-white border-emerald-600 shadow-2xs'
                            : 'bg-app-field text-app-secondary border-app hover:text-app-main'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Tag input */}
                <div className="flex items-center gap-2 pt-1 max-w-sm">
                  <input
                    type="text"
                    placeholder="Add custom tag..."
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomTag();
                      }
                    }}
                    className="flex-1 px-2.5 py-1.5 rounded-md bg-app-field border border-app text-xs text-app-main"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomTag}
                    className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-app-secondary text-app-main hover:bg-app-field border border-app cursor-pointer"
                  >
                    Add Tag
                  </button>
                </div>
              </div>
            )}

            {/* Linked Analysis / Trade (optional, non-required) */}
            {visibilityConfig?.linkedAnalysisTrade !== false && (
              <div className="space-y-1 max-w-md">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                  <LinkIcon className="w-3 h-3 text-emerald-theme" />
                  <span>Connect to Market Analysis (Optional)</span>
                </label>
                <select
                  value={linkedReportId}
                  onChange={(e) => setLinkedReportId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-app-field border border-app text-xs text-app-main cursor-pointer"
                >
                  <option value="">None (Independent reflection)</option>
                  {reportsList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.date} — {r.pair} ({r.title || 'Analysis'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Attachments / Image Upload */}
            {visibilityConfig?.attachments !== false && (
              <div className="space-y-2 pt-1">
                <label className="text-[11px] font-semibold text-app-secondary block uppercase tracking-wider flex items-center gap-1">
                  <ImageIcon className="w-3 h-3 text-emerald-theme" />
                  <span>Image Attachment (Optional)</span>
                </label>

                {imageUrl ? (
                  <div className="relative inline-block border border-app rounded-lg overflow-hidden max-w-xs group">
                    <img src={imageUrl} alt="Attached reflection" className="w-full h-auto max-h-48 object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageUrl(null)}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-white hover:bg-black transition-colors cursor-pointer"
                      title="Remove image"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-app bg-app-field hover:bg-app-field/80 text-xs font-medium text-app-main cursor-pointer transition-colors">
                    <ImageIcon className="w-4 h-4 text-emerald-theme" />
                    <span>Upload Screenshot or Photo</span>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-app">
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-app-secondary hover:text-app-main bg-app-field rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={isSavingRef.current}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{editingEntryId ? 'Update Note' : 'Save Note'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Notes List */}
      {filteredNotes.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-xl border border-app bg-app-field/40 space-y-3">
          <PenTool className="w-10 h-10 text-app-secondary mx-auto opacity-50" />
          <div className="text-sm font-bold text-app-main">No Personal Notes Found</div>
          <p className="text-xs text-app-secondary max-w-md mx-auto">
            {searchQuery || selectedContextFilter !== 'all' || selectedTagFilter !== 'all'
              ? 'No notes match your active search or filters. Try adjusting your search criteria.'
              : 'Write your thoughts, observations, mindset checks, or rules to remember.'}
          </p>
          <button
            type="button"
            onClick={handleOpenNewNote}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-theme text-white hover:bg-emerald-theme-hover cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            <span>Write First Note</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredNotes.map((note) => {
            const contextDef = MY_JOURNAL_CONTEXTS.find((c) => c.value === note.myJournalContext);
            const matchingReport = note.linkedReportId
              ? reportsList.find((r) => r.id === note.linkedReportId)
              : null;

            return (
              <div
                key={note.id}
                className="rounded-xl border border-app bg-app-main shadow-2xs p-4 sm:p-5 space-y-3 hover:border-emerald-500/40 transition-colors"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-app/50 pb-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm sm:text-base text-app-main">{note.title}</h3>
                      {contextDef && (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${contextDef.color}`}
                        >
                          {contextDef.label}
                        </span>
                      )}
                      {note.prep?.readinessState && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                          <Smile className="w-3 h-3" />
                          <span>{note.prep.readinessState}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-app-secondary flex-wrap">
                      <span className="font-medium text-app-main">{note.date}</span>
                      {note.time && <span>· {note.time}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleEditNote(note)}
                      className="p-1.5 rounded text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer"
                      title="Edit note"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(note.id)}
                      className="p-1.5 rounded text-app-secondary hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                      title="Delete note"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                {note.generalNotes && (
                  <p className="text-xs text-app-main whitespace-pre-wrap leading-relaxed">
                    {note.generalNotes}
                  </p>
                )}

                {/* Attached Image Thumbnail */}
                {note.imageUrl && (
                  <div className="pt-1">
                    <img
                      src={note.imageUrl}
                      alt="Attached note proof"
                      className="rounded-lg border border-app max-h-56 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                      onClick={() => window.open(note.imageUrl, '_blank')}
                    />
                  </div>
                )}

                {/* Tags */}
                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {note.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-app-field text-app-secondary border border-app"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Linked Analysis Report */}
                {note.linkedReportId && (
                  <div className="pt-2 border-t border-app/40 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <LinkIcon className="w-3.5 h-3.5 text-app-secondary" />
                      {matchingReport ? (
                        <button
                          type="button"
                          onClick={() => onOpenReport?.(note.linkedReportId!)}
                          className="font-medium text-emerald-theme hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>Linked: {matchingReport.pair} Analysis ({matchingReport.date})</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-app-secondary">
                          Linked: {note.linkedReportTitle || 'Associated Analysis'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
