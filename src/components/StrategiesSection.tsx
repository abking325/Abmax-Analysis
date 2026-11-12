import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookMarked,
  CheckCircle2,
  Edit3,
  Eye,
  Info,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { TradingStrategy } from '../types/journal';
import {
  archiveStrategy,
  clearStrategyDraft,
  deleteStrategy,
  getAllStrategies,
  getStrategyDraft,
  isStrategyOwnedByScope,
  normalizeAccountScope,
  saveStrategy,
  saveStrategyDraft,
} from '../services/db';

interface StrategiesSectionProps {
  userId?: string | null;
}

export const StrategiesSection: React.FC<StrategiesSectionProps> = ({ userId }) => {
  const [strategies, setStrategies] = useState<TradingStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');

  // View & Editor Modal States
  const [viewingStrategy, setViewingStrategy] = useState<TradingStrategy | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingStrategyId, setEditingStrategyId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [setupContext, setSetupContext] = useState('');
  const [entryRules, setEntryRules] = useState('');
  const [invalidationConditions, setInvalidationConditions] = useState('');
  const [riskManagementRules, setRiskManagementRules] = useState('');
  const [exitRules, setExitRules] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [hasDraftNotice, setHasDraftNotice] = useState(false);

  // Account-scoped draft isolation refs
  const currentScope = normalizeAccountScope(userId);
  const prevScopeRef = useRef<string>(currentScope);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftStateRef = useRef({
    editingStrategyId: null as string | null,
    isEditorOpen: false,
    name: '',
    description: '',
    setupContext: '',
    entryRules: '',
    invalidationConditions: '',
    riskManagementRules: '',
    exitRules: '',
    tags: [] as string[],
    notes: '',
  });
  draftStateRef.current = {
    editingStrategyId,
    isEditorOpen,
    name,
    description,
    setupContext,
    entryRules,
    invalidationConditions,
    riskManagementRules,
    exitRules,
    tags,
    notes,
  };

  const resetForm = () => {
    setEditingStrategyId(null);
    setName('');
    setDescription('');
    setSetupContext('');
    setEntryRules('');
    setInvalidationConditions('');
    setRiskManagementRules('');
    setExitRules('');
    setTags([]);
    setTagInput('');
    setNotes('');
    setFormError(null);
  };

  const loadStrategies = async () => {
    setLoading(true);
    try {
      const all = await getAllStrategies();
      setStrategies(all);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStrategies();
  }, []);

  // Coordinated account-switch draft flush & load (never deletes outgoing draft; clears only UI state)
  useEffect(() => {
    const prevScope = prevScopeRef.current;
    const nextScope = normalizeAccountScope(userId);
    let cancelled = false;

    const syncScopeSwitch = async () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }

      if (prevScope !== nextScope) {
        const cur = draftStateRef.current;
        const hasPending =
          cur.isEditorOpen &&
          !cur.editingStrategyId &&
          Boolean(
            cur.name.trim() ||
              cur.description.trim() ||
              cur.setupContext.trim() ||
              cur.entryRules.trim() ||
              cur.invalidationConditions.trim() ||
              cur.riskManagementRules.trim() ||
              cur.exitRules.trim() ||
              cur.notes.trim() ||
              cur.tags.length > 0
          );
        if (hasPending) {
          await saveStrategyDraft(
            {
              name: cur.name,
              description: cur.description,
              setupContext: cur.setupContext,
              entryRules: cur.entryRules,
              invalidationConditions: cur.invalidationConditions,
              riskManagementRules: cur.riskManagementRules,
              exitRules: cur.exitRules,
              tags: cur.tags,
              notes: cur.notes,
              userId: prevScope,
            },
            prevScope
          );
        }
        resetForm();
        setIsEditorOpen(false);
        setViewingStrategy(null);
        prevScopeRef.current = nextScope;
      }

      const incomingDraft = await getStrategyDraft(nextScope);
      if (cancelled) return;
      if (
        incomingDraft &&
        (incomingDraft.name?.trim() ||
          incomingDraft.description?.trim() ||
          incomingDraft.entryRules?.trim() ||
          incomingDraft.invalidationConditions?.trim() ||
          incomingDraft.notes?.trim())
      ) {
        setName(incomingDraft.name || '');
        setDescription(incomingDraft.description || '');
        setSetupContext(incomingDraft.setupContext || '');
        setEntryRules(incomingDraft.entryRules || '');
        setInvalidationConditions(incomingDraft.invalidationConditions || '');
        setRiskManagementRules(incomingDraft.riskManagementRules || '');
        setExitRules(incomingDraft.exitRules || '');
        setTags(incomingDraft.tags || []);
        setNotes(incomingDraft.notes || '');
        setHasDraftNotice(true);
      } else {
        setHasDraftNotice(false);
      }
    };

    syncScopeSwitch();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Debounced autosave for new strategy draft (strictly guarded to owner scope)
  useEffect(() => {
    if (!isEditorOpen || editingStrategyId) return;
    const ownerScope = normalizeAccountScope(userId);
    const hasAnyContent = Boolean(
      name.trim() ||
        description.trim() ||
        setupContext.trim() ||
        entryRules.trim() ||
        invalidationConditions.trim() ||
        riskManagementRules.trim() ||
        exitRules.trim() ||
        notes.trim() ||
        tags.length > 0
    );

    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      if (prevScopeRef.current !== ownerScope) return;
      if (hasAnyContent) {
        saveStrategyDraft(
          {
            name,
            description,
            setupContext,
            entryRules,
            invalidationConditions,
            riskManagementRules,
            exitRules,
            tags,
            notes,
            userId: ownerScope,
          },
          ownerScope
        ).catch(() => {});
        setHasDraftNotice(true);
      }
    }, 350);

    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, [
    isEditorOpen,
    editingStrategyId,
    name,
    description,
    setupContext,
    entryRules,
    invalidationConditions,
    riskManagementRules,
    exitRules,
    tags,
    notes,
    userId,
  ]);

  const scopedStrategies = useMemo(() => {
    return strategies.filter((s) => isStrategyOwnedByScope(s, userId));
  }, [strategies, userId]);

  const filteredStrategies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scopedStrategies.filter((s) => {
      if (statusFilter === 'active' && s.isArchived) return false;
      if (statusFilter === 'archived' && !s.isArchived) return false;
      if (!q) return true;
      const hay = [
        s.name,
        s.description,
        s.setupContext,
        s.entryRules,
        s.invalidationConditions,
        s.notes,
        ...(s.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [scopedStrategies, statusFilter, searchQuery]);

  const activeCount = useMemo(
    () => scopedStrategies.filter((s) => !s.isArchived).length,
    [scopedStrategies]
  );
  const archivedCount = useMemo(
    () => scopedStrategies.filter((s) => s.isArchived).length,
    [scopedStrategies]
  );

  const openNewEditor = async () => {
    setFormError(null);
    const savedDraft = await getStrategyDraft(userId);
    if (savedDraft && (savedDraft.name || savedDraft.description || savedDraft.entryRules)) {
      setEditingStrategyId(null);
      setName(savedDraft.name || '');
      setDescription(savedDraft.description || '');
      setSetupContext(savedDraft.setupContext || '');
      setEntryRules(savedDraft.entryRules || '');
      setInvalidationConditions(savedDraft.invalidationConditions || '');
      setRiskManagementRules(savedDraft.riskManagementRules || '');
      setExitRules(savedDraft.exitRules || '');
      setTags(savedDraft.tags || []);
      setNotes(savedDraft.notes || '');
    } else {
      resetForm();
    }
    setIsEditorOpen(true);
  };

  const openEditEditor = (strategy: TradingStrategy) => {
    setEditingStrategyId(strategy.id);
    setName(strategy.name || '');
    setDescription(strategy.description || '');
    setSetupContext(strategy.setupContext || '');
    setEntryRules(strategy.entryRules || '');
    setInvalidationConditions(strategy.invalidationConditions || '');
    setRiskManagementRules(strategy.riskManagementRules || '');
    setExitRules(strategy.exitRules || '');
    setTags(strategy.tags ? [...strategy.tags] : []);
    setNotes(strategy.notes || '');
    setFormError(null);
    setViewingStrategy(null);
    setIsEditorOpen(true);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim();
    if (!clean) return;
    if (!tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setTagInput('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError('Strategy Name is required.');
      return;
    }

    const existing = editingStrategyId
      ? strategies.find((s) => s.id === editingStrategyId)
      : undefined;

    const strategyToSave: TradingStrategy = {
      id:
        editingStrategyId ||
        `str_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: trimmedName,
      description: description.trim() || undefined,
      setupContext: setupContext.trim() || undefined,
      entryRules: entryRules.trim() || undefined,
      invalidationConditions: invalidationConditions.trim() || undefined,
      riskManagementRules: riskManagementRules.trim() || undefined,
      exitRules: exitRules.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      notes: notes.trim() || undefined,
      isArchived: existing?.isArchived || false,
      userId: existing?.userId || normalizeAccountScope(userId),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await saveStrategy(strategyToSave);
    if (!editingStrategyId) {
      await clearStrategyDraft(userId);
      setHasDraftNotice(false);
    }
    await loadStrategies();
    setIsEditorOpen(false);
    resetForm();
    setSaveNotice(`Saved strategy "${strategyToSave.name}".`);
    setTimeout(() => setSaveNotice(null), 3000);
  };

  const handleArchiveToggle = async (strategy: TradingStrategy) => {
    await archiveStrategy(strategy.id, !strategy.isArchived);
    await loadStrategies();
    if (viewingStrategy?.id === strategy.id) {
      setViewingStrategy((prev) =>
        prev ? { ...prev, isArchived: !strategy.isArchived } : null
      );
    }
  };

  const handleDelete = async (id: string) => {
    await deleteStrategy(id);
    setDeleteConfirmId(null);
    if (viewingStrategy?.id === id) setViewingStrategy(null);
    await loadStrategies();
  };

  return (
    <div className="space-y-4">
      {/* Header & Local-Only Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-app">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-app-main tracking-tight flex items-center gap-2">
            <BookMarked className="w-6 h-6 text-emerald-theme" />
            <span>Strategies</span>
          </h1>
          <p className="text-xs text-app-secondary mt-0.5">
            Build and organize your own trading setups, entry rules, invalidations, and risk guidelines for quick selection in Scenarios and Trades.
          </p>
          <div className="flex items-start gap-1.5 mt-2 text-[11px] text-app-secondary bg-app-field/60 border border-app px-2.5 py-1.5 rounded-md max-w-2xl">
            <Info className="w-3.5 h-3.5 text-emerald-theme shrink-0 mt-0.5" />
            <span>
              <strong className="text-app-main">Local-Only Storage:</strong> Strategies are stored strictly on this device in IndexedDB and are not synced to the cloud. Export a full JSON backup in Settings to back up or transfer them.
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={openNewEditor}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-theme bg-emerald-theme-hover rounded-lg shadow-2xs transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{hasDraftNotice ? 'Resume Strategy Draft' : 'New Strategy'}</span>
        </button>
      </div>

      {saveNotice && (
        <div className="p-2.5 rounded-lg bg-emerald-pale text-emerald-theme border border-emerald-500/30 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{saveNotice}</span>
        </div>
      )}

      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search strategies by name, rules, context, or tags..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded-lg text-app-main focus:outline-hidden focus:border-emerald-600"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-app-secondary/60 p-1 rounded-lg border border-app self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'active'
                ? 'bg-emerald-theme text-white shadow-2xs'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('archived')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'archived'
                ? 'bg-emerald-theme text-white shadow-2xs'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            Archived ({archivedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-emerald-theme text-white shadow-2xs'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            All ({scopedStrategies.length})
          </button>
        </div>
      </div>

      {/* Strategy List / Empty State */}
      {loading ? (
        <div className="p-8 text-center text-xs text-app-secondary border border-app rounded-lg bg-app-main">
          Loading strategies...
        </div>
      ) : filteredStrategies.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-app rounded-xl bg-app-main space-y-2.5">
          <BookMarked className="w-9 h-9 text-app-secondary mx-auto opacity-50" />
          <div className="text-sm font-bold text-app-main">
            {scopedStrategies.length === 0
              ? 'No strategies created yet'
              : 'No strategies match your current filter'}
          </div>
          <p className="text-xs text-app-secondary max-w-md mx-auto">
            {scopedStrategies.length === 0
              ? 'Save your personal setup definitions once and select them whenever planning scenarios or logging executed trades.'
              : 'Try adjusting your search query or switching between Active and Archived strategies.'}
          </p>
          {scopedStrategies.length === 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={openNewEditor}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Your First Strategy
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredStrategies.map((strategy) => (
            <div
              key={strategy.id}
              className={`p-4 rounded-xl border bg-app-main space-y-2.5 flex flex-col justify-between transition-colors ${
                strategy.isArchived
                  ? 'border-app/70 opacity-85 bg-app-secondary/30'
                  : 'border-app hover:border-emerald-500/40'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-app-main truncate">
                        {strategy.name}
                      </h3>
                      {strategy.isArchived && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-app-secondary border border-app">
                          Archived
                        </span>
                      )}
                    </div>
                    {strategy.setupContext && (
                      <p className="text-[11px] text-emerald-theme font-medium mt-0.5">
                        {strategy.setupContext}
                      </p>
                    )}
                  </div>
                </div>

                {strategy.description && (
                  <p className="text-xs text-app-secondary line-clamp-2 leading-relaxed">
                    {strategy.description}
                  </p>
                )}

                {strategy.entryRules && (
                  <div className="text-[11px] bg-app-field/60 border border-app rounded p-2">
                    <span className="font-semibold text-app-main">Entry Rules: </span>
                    <span className="text-app-secondary line-clamp-2">{strategy.entryRules}</span>
                  </div>
                )}

                {strategy.tags && strategy.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {strategy.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-pale text-emerald-theme border border-emerald-500/20"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-app/60 flex-wrap">
                <span className="text-[10px] text-app-secondary">
                  Updated {new Date(strategy.updatedAt || strategy.createdAt).toLocaleDateString()}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewingStrategy(strategy)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-app-main bg-app-field hover:bg-app-secondary border border-app rounded cursor-pointer"
                  >
                    <Eye className="w-3 h-3" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditEditor(strategy)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-theme bg-emerald-pale rounded hover:opacity-90 cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchiveToggle(strategy)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-app-secondary hover:text-app-main bg-app-field border border-app rounded cursor-pointer"
                    title={strategy.isArchived ? 'Restore to active strategies' : 'Archive strategy'}
                  >
                    {strategy.isArchived ? (
                      <>
                        <ArchiveRestore className="w-3 h-3" />
                        Unarchive
                      </>
                    ) : (
                      <>
                        <Archive className="w-3 h-3" />
                        Archive
                      </>
                    )}
                  </button>
                  {deleteConfirmId === strategy.id ? (
                    <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded border border-rose-300 dark:border-rose-800 text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleDelete(strategy.id)}
                        className="px-1.5 py-0.5 bg-rose-600 text-white rounded font-bold cursor-pointer"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-1 text-app-secondary cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(strategy.id)}
                      className="p-1 text-app-secondary hover:text-rose-600 rounded cursor-pointer"
                      aria-label={`Delete ${strategy.name}`}
                      title="Delete strategy"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Detail View Modal */}
      {viewingStrategy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Strategy Details: ${viewingStrategy.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setViewingStrategy(null)}
        >
          <div
            className="w-full max-w-lg bg-app-main border border-app rounded-xl shadow-xl overflow-hidden max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary">
              <div className="flex items-center gap-2 min-w-0">
                <BookMarked className="w-4 h-4 text-emerald-theme shrink-0" />
                <h2 className="text-sm font-bold text-app-main truncate">
                  {viewingStrategy.name}
                </h2>
                {viewingStrategy.isArchived && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-app-secondary border border-app">
                    Archived
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingStrategy(null)}
                className="p-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
                aria-label="Close strategy details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3 text-xs">
              {viewingStrategy.setupContext && (
                <div>
                  <span className="font-bold text-app-secondary uppercase text-[10px] block">
                    Setup Context / Market Conditions
                  </span>
                  <p className="text-app-main mt-0.5 whitespace-pre-wrap">{viewingStrategy.setupContext}</p>
                </div>
              )}
              {viewingStrategy.description && (
                <div>
                  <span className="font-bold text-app-secondary uppercase text-[10px] block">
                    Description / Summary
                  </span>
                  <p className="text-app-main mt-0.5 whitespace-pre-wrap">{viewingStrategy.description}</p>
                </div>
              )}
              {viewingStrategy.entryRules && (
                <div className="p-2.5 rounded bg-app-field border border-app">
                  <span className="font-bold text-app-main uppercase text-[10px] block mb-0.5">
                    Entry Rules / Confirmation Criteria
                  </span>
                  <p className="text-app-main whitespace-pre-wrap">{viewingStrategy.entryRules}</p>
                </div>
              )}
              {viewingStrategy.invalidationConditions && (
                <div className="p-2.5 rounded bg-rose-50/40 dark:bg-rose-950/20 border border-rose-300/60 dark:border-rose-900">
                  <span className="font-bold text-rose-700 dark:text-rose-400 uppercase text-[10px] block mb-0.5">
                    Invalidation Conditions
                  </span>
                  <p className="text-app-main whitespace-pre-wrap">{viewingStrategy.invalidationConditions}</p>
                </div>
              )}
              {viewingStrategy.riskManagementRules && (
                <div>
                  <span className="font-bold text-app-secondary uppercase text-[10px] block">
                    Risk Management Rules
                  </span>
                  <p className="text-app-main mt-0.5 whitespace-pre-wrap">{viewingStrategy.riskManagementRules}</p>
                </div>
              )}
              {viewingStrategy.exitRules && (
                <div>
                  <span className="font-bold text-app-secondary uppercase text-[10px] block">
                    Take-Profit / Exit Rules
                  </span>
                  <p className="text-app-main mt-0.5 whitespace-pre-wrap">{viewingStrategy.exitRules}</p>
                </div>
              )}
              {viewingStrategy.notes && (
                <div>
                  <span className="font-bold text-app-secondary uppercase text-[10px] block">
                    Notes
                  </span>
                  <p className="text-app-secondary mt-0.5 whitespace-pre-wrap">{viewingStrategy.notes}</p>
                </div>
              )}
              {viewingStrategy.tags && viewingStrategy.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {viewingStrategy.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded bg-emerald-pale text-emerald-theme text-[10px] font-semibold"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-app bg-app-secondary">
              <button
                type="button"
                onClick={() => handleArchiveToggle(viewingStrategy)}
                className="px-3 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main bg-app-field border border-app rounded cursor-pointer"
              >
                {viewingStrategy.isArchived ? 'Unarchive Strategy' : 'Archive Strategy'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditEditor(viewingStrategy)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded cursor-pointer"
                >
                  Edit Strategy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Create/Edit Modal */}
      {isEditorOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingStrategyId ? 'Edit Strategy' : 'New Strategy'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          onClick={() => setIsEditorOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-app-main border border-app rounded-xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary">
              <h2 className="text-sm font-bold text-app-main">
                {editingStrategyId ? 'Edit Strategy' : 'Create Strategy'}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="p-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
                aria-label="Close strategy editor"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-3.5 text-xs flex-1">
              {formError && (
                <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 font-medium">
                  {formError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-app-main mb-1">
                  Strategy Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. London Session Liquidity Sweep + 5M iBOS"
                  className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                  required
                />
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">
                  Setup Context / Market Conditions
                </label>
                <input
                  type="text"
                  value={setupContext}
                  onChange={(e) => setSetupContext(e.target.value)}
                  placeholder="e.g. HTF aligned, discount/premium POI tapped during London Killzone"
                  className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">
                  Short Description / Summary
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Overall thesis and narrative of how this setup unfolds..."
                  className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-app-secondary mb-1">
                    Entry Rules / Confirmation Criteria
                  </label>
                  <textarea
                    rows={3}
                    value={entryRules}
                    onChange={(e) => setEntryRules(e.target.value)}
                    placeholder="Specific confirmation candle, LTF shift, FVG or OB trigger..."
                    className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                  />
                </div>
                <div>
                  <label className="block font-medium text-app-secondary mb-1">
                    Invalidation Conditions
                  </label>
                  <textarea
                    rows={3}
                    value={invalidationConditions}
                    onChange={(e) => setInvalidationConditions(e.target.value)}
                    placeholder="What invalidates this setup cleanly?"
                    className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-rose-500 resize-y"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-app-secondary mb-1">
                    Risk Management Rules
                  </label>
                  <textarea
                    rows={2}
                    value={riskManagementRules}
                    onChange={(e) => setRiskManagementRules(e.target.value)}
                    placeholder="e.g. Max 0.5% risk, stop behind structural high/low..."
                    className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                  />
                </div>
                <div>
                  <label className="block font-medium text-app-secondary mb-1">
                    Take-Profit / Exit Rules
                  </label>
                  <textarea
                    rows={2}
                    value={exitRules}
                    onChange={(e) => setExitRules(e.target.value)}
                    placeholder="e.g. Partial at 2R, final target at opposing external liquidity..."
                    className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">
                  Tags
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                      }
                    }}
                    placeholder="Add tag (e.g. Continuation, Sweep, News) and press Enter"
                    className="flex-1 px-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-3 py-1.5 text-xs font-semibold bg-app-field border border-app rounded hover:bg-app-secondary cursor-pointer"
                  >
                    Add
                  </button>
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-pale text-emerald-theme text-[11px] font-medium"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => setTags(tags.filter((x) => x !== t))}
                          className="hover:text-rose-600 cursor-pointer"
                          aria-label={`Remove tag ${t}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-app-secondary mb-1">
                  Additional Notes
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional psychological or execution reminders..."
                  className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-app">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs cursor-pointer"
                >
                  {editingStrategyId ? 'Save Changes' : 'Save Strategy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
