import React, { useRef, useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Trash2,
  Eye,
  Check,
  Edit2,
  RotateCcw,
  Upload,
  Clipboard,
  Plus,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  DeepLevelEntry,
  FractalDirection,
  OverallBias,
  PriceLocation,
  StructureDirection,
  SupplyDemandLevel,
  TimeframeData,
  TimeframeId,
  WorkspaceVisibilityConfig,
} from '../types/journal';
import { isDeepAnalysisAligned, compressImageFile } from '../utils/analysisUtils';

interface TimeframeSectionProps {
  timeframe: TimeframeId;
  data: TimeframeData;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onChangeOverallBias: (bias: OverallBias) => void;
  onUpdateField: (updater: (prev: TimeframeData) => TimeframeData) => void;
  onSaveDeep: () => Promise<{ success: boolean; error?: string } | void> | void;
  onEditDeep: () => void;
  onResetDeep: () => void;
  onAttachImage: (dataUrl: string) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  onViewImage: (imageId: string, title: string) => void;
  visibleSupplyDemandLevels: SupplyDemandLevel[];
  visibilityConfig?: WorkspaceVisibilityConfig;
  initialLevelDraft?: {
    addingLevelKey: string | null;
    newLevelPrice: string;
    newLevelNote: string;
    editingLevelId: string | null;
    editLevelPrice: string;
    editLevelNote: string;
  };
  onLevelDraftChange?: (draft: {
    addingLevelKey: string | null;
    newLevelPrice: string;
    newLevelNote: string;
    editingLevelId: string | null;
    editLevelPrice: string;
    editLevelNote: string;
  }) => void;
}

export const TimeframeSection: React.FC<TimeframeSectionProps> = ({
  timeframe,
  data,
  isExpanded,
  onToggleExpand,
  onChangeOverallBias,
  onUpdateField,
  onSaveDeep,
  onEditDeep,
  onResetDeep,
  onAttachImage,
  onRemoveImage,
  onViewImage,
  visibleSupplyDemandLevels,
  visibilityConfig,
  initialLevelDraft,
  onLevelDraftChange,
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showRemoveImageConfirm, setShowRemoveImageConfirm] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isSavingDeep, setIsSavingDeep] = useState(false);
  const [deepSaveSuccessMsg, setDeepSaveSuccessMsg] = useState<string | null>(null);
  const [deepSaveErrorMsg, setDeepSaveErrorMsg] = useState<string | null>(null);

  // Phase 2: Active inline adding key ('supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels' | null)
  const [addingLevelKey, setAddingLevelKey] = useState<string | null>(initialLevelDraft?.addingLevelKey || null);
  const [newLevelPrice, setNewLevelPrice] = useState(initialLevelDraft?.newLevelPrice || '');
  const [newLevelNote, setNewLevelNote] = useState(initialLevelDraft?.newLevelNote || '');

  // Phase 2: Active inline editing entry ID
  const [editingLevelId, setEditingLevelId] = useState<string | null>(initialLevelDraft?.editingLevelId || null);
  const [editLevelPrice, setEditLevelPrice] = useState(initialLevelDraft?.editLevelPrice || '');
  const [editLevelNote, setEditLevelNote] = useState(initialLevelDraft?.editLevelNote || '');

  // Notify parent on draft updates
  useEffect(() => {
    onLevelDraftChange?.({
      addingLevelKey,
      newLevelPrice,
      newLevelNote,
      editingLevelId,
      editLevelPrice,
      editLevelNote,
    });
  }, [addingLevelKey, newLevelPrice, newLevelNote, editingLevelId, editLevelPrice, editLevelNote, onLevelDraftChange]);

  // Phase 2: Confirmation for removal
  const [confirmDeleteLevelId, setConfirmDeleteLevelId] = useState<string | null>(null);

  const deepAligned = isDeepAnalysisAligned(data);
  const deepVis = visibilityConfig?.deepSections;

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      await onAttachImage(compressed);
    } catch (err) {
      console.error('Error compressing image', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteImage = async () => {
    setPasteError(null);
    try {
      if (!navigator.clipboard?.read) {
        setPasteError('Direct paste not supported by browser. Use file select or paste in input.');
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], `${timeframe.toLowerCase()}_chart.png`, { type });
            const compressed = await compressImageFile(file);
            await onAttachImage(compressed);
            return;
          }
        }
      }
      setPasteError('No image found in clipboard.');
    } catch {
      setPasteError('Clipboard access denied. Use the Upload button or file picker.');
    }
  };

  const handleManualPasteTarget = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    setPasteError(null);
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const compressed = await compressImageFile(file);
          await onAttachImage(compressed);
          e.preventDefault();
          return;
        }
      }
    }
    setPasteError('No image in pasted data');
  };

  // Phase 1: Save handler: persists deep analysis, verifies local write, collapses editor, keeps header comfortably visible
  const handleSaveTimeframe = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSavingDeep(true);
    setDeepSaveSuccessMsg(null);
    setDeepSaveErrorMsg(null);
    try {
      const res = await onSaveDeep();
      if (res && typeof res === 'object' && res.success === false) {
        // Keep editor open, retain all entered values, show actionable error
        setDeepSaveErrorMsg(res.error || 'Failed to save deep analysis.');
      } else {
        setDeepSaveSuccessMsg('Deep analysis saved');
        setTimeout(() => {
          setDeepSaveSuccessMsg(null);
        }, 4000);
      }
    } catch (err) {
      setDeepSaveErrorMsg((err as Error).message || 'Failed to save deep analysis.');
    } finally {
      setIsSavingDeep(false);
    }
  };

  // Phase 2: Level array helpers & management
  type LevelKey = 'supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels';

  const handleStartAddLevel = (key: LevelKey) => {
    setAddingLevelKey(key);
    setNewLevelPrice('');
    setNewLevelNote('');
    setEditingLevelId(null);
    setConfirmDeleteLevelId(null);
  };

  const handleCancelAddLevel = () => {
    setAddingLevelKey(null);
    setNewLevelPrice('');
    setNewLevelNote('');
  };

  const handleSaveNewLevel = (key: LevelKey) => {
    // If completely empty, do not create a misleading card
    if (!newLevelPrice.trim() && !newLevelNote.trim()) {
      handleCancelAddLevel();
      return;
    }
    const newEntry: DeepLevelEntry = {
      id: `lvl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      level: newLevelPrice, // Keep exact price string, including trailing decimal zeros
      note: newLevelNote.trim(),
    };
    onUpdateField((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), newEntry],
    }));
    setAddingLevelKey(null);
    setNewLevelPrice('');
    setNewLevelNote('');
  };

  const handleStartEditLevel = (entry: DeepLevelEntry) => {
    setEditingLevelId(entry.id);
    setEditLevelPrice(entry.level);
    setEditLevelNote(entry.note || '');
    setAddingLevelKey(null);
    setConfirmDeleteLevelId(null);
  };

  const handleCancelEditLevel = () => {
    setEditingLevelId(null);
    setEditLevelPrice('');
    setEditLevelNote('');
  };

  const handleSaveEditLevel = (key: LevelKey, id: string) => {
    onUpdateField((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((item) =>
        item.id === id
          ? { ...item, level: editLevelPrice, note: editLevelNote.trim() }
          : item
      ),
    }));
    setEditingLevelId(null);
    setEditLevelPrice('');
    setEditLevelNote('');
  };

  const handleConfirmRemoveLevel = (key: LevelKey, id: string) => {
    onUpdateField((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((item) => item.id !== id),
    }));
    setConfirmDeleteLevelId(null);
  };

  const renderLevelSection = (
    title: string,
    buttonLabel: string,
    key: LevelKey,
    tagColor: string
  ) => {
    const list = data[key] || [];
    const isAdding = addingLevelKey === key;

    return (
      <div className="py-2.5 border-b border-app/50 last:border-b-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-app-main uppercase tracking-wider">
              {title}
            </span>
            {list.length > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${tagColor}`}>
                {list.length}
              </span>
            )}
          </div>
          {!isAdding && (
            <button
              type="button"
              onClick={() => handleStartAddLevel(key)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-theme bg-emerald-pale hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" /> {buttonLabel}
            </button>
          )}
        </div>

        {/* Existing saved entries list (compact saved boxes) */}
        {list.length === 0 && !isAdding ? (
          <p className="text-[11px] text-app-secondary italic py-1">No {title.toLowerCase()} added.</p>
        ) : (
          <div className="space-y-2 mt-1.5">
            {list.map((entry, idx) => {
              const entryId = entry.id || `lvl_fallback_${idx}`;
              const isEditing = editingLevelId === entryId;
              const isDeleting = confirmDeleteLevelId === entryId;

              if (isEditing) {
                // Compact inline editor for existing entry
                return (
                  <div
                    key={entryId}
                    className="p-2.5 rounded bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-500/40 space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <div className="flex-1">
                        <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                          Price or range (exact)
                        </label>
                        <input
                          type="text"
                          value={editLevelPrice}
                          onChange={(e) => setEditLevelPrice(e.target.value)}
                          placeholder="e.g. 2685.50 or 2685.50 - 2690.00"
                          className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                          autoFocus
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                          Optional notes
                        </label>
                        <input
                          type="text"
                          value={editLevelNote}
                          onChange={(e) => setEditLevelNote(e.target.value)}
                          placeholder="Optional observation / note..."
                          className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveEditLevel(key, entryId)}
                        className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors cursor-pointer"
                      >
                        Save Changes
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEditLevel}
                        className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }

              // Compact Saved Box
              const isLevelMissing = !entry.level || !entry.level.trim();
              const hasNote = Boolean(entry.note && entry.note.trim());

              return (
                <div
                  key={entryId}
                  className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 rounded bg-app-secondary/50 border border-app hover:border-app-secondary transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs min-w-0 flex-1">
                    {/* Exact Price/Range in Mono font */}
                    {!isLevelMissing ? (
                      <span className="font-mono font-bold text-app-main tabular-nums bg-app-main px-2 py-0.5 rounded border border-app/60">
                        {entry.level}
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-300">
                        Incomplete: no level
                      </span>
                    )}

                    {/* Note if present */}
                    {hasNote && (
                      <span className="text-app-main text-xs truncate max-w-md">
                        {entry.note}
                      </span>
                    )}
                  </div>

                  {/* Actions: Edit, Remove (with confirmation) */}
                  <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                    {!isDeleting ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEditLevel(entry)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                          title="Edit level"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span className="text-[11px]">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteLevelId(entryId)}
                          className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors cursor-pointer"
                          title="Remove level"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 p-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded text-xs">
                        <span className="text-rose-700 dark:text-rose-300 text-[11px]">Remove?</span>
                        <button
                          type="button"
                          onClick={() => handleConfirmRemoveLevel(key, entryId)}
                          className="px-2 py-0.5 bg-rose-600 text-white rounded text-[11px] font-bold cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteLevelId(null)}
                          className="px-1.5 py-0.5 text-app-secondary hover:text-app-main text-[11px] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Inline Add Editor for new entry */}
        {isAdding && (
          <div className="mt-2 p-2.5 rounded bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-500/40 space-y-2">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                  Price or range (exact)
                </label>
                <input
                  type="text"
                  value={newLevelPrice}
                  onChange={(e) => setNewLevelPrice(e.target.value)}
                  placeholder="e.g. 2685.50 or 2685.50 - 2690.00"
                  className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                  autoFocus
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                  Optional notes
                </label>
                <input
                  type="text"
                  value={newLevelNote}
                  onChange={(e) => setNewLevelNote(e.target.value)}
                  placeholder="Optional observation / note..."
                  className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleSaveNewLevel(key)}
                className="px-3 py-1 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelAddLevel}
                className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const noteLabel = `${timeframe} Note`;

  return (
    <section
      ref={sectionRef}
      id={`section-${timeframe}`}
      className="border border-app rounded-lg bg-app-main mb-3 transition-colors shadow-2xs overflow-hidden"
    >
      {/* Timeframe Header Bar (Always visible) */}
      <div className="p-3 sm:p-4 bg-app-secondary border-b border-app/60 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base sm:text-lg font-bold text-app-main tracking-tight">
              {timeframe} Overall
            </h3>

            {isExpanded && data.isSaved && !deepSaveSuccessMsg && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-theme bg-emerald-pale px-2 py-0.5 rounded">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {isExpanded && deepSaveSuccessMsg && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-theme bg-emerald-pale border border-emerald-500/40 px-2 py-0.5 rounded">
                <Check className="w-3 h-3" /> Deep analysis saved
              </span>
            )}

            {isExpanded && deepAligned && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-theme bg-emerald-pale border border-emerald-theme/30 px-2 py-0.5 rounded">
                Deep Analysis Aligned ({data.swing.direction})
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleExpand}
            className="md:hidden inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-app-secondary hover:text-app-main hover:bg-app-field rounded border border-app transition-colors cursor-pointer"
            aria-label={isExpanded ? `Collapse ${timeframe} Deep Analysis` : `Expand ${timeframe} Deep Analysis`}
            aria-expanded={isExpanded}
          >
            <span>Deep</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Bias Buttons (Always visible even when deep analysis is collapsed) */}
        <div className="flex items-center gap-1.5 flex-wrap justify-between md:justify-end">
          <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
            {(['Bullish', 'Neutral', 'Bearish', 'Not sure'] as const).map((b) => {
              const isSelected = data.overallBias === b;
              let selectedStyle = 'border-app text-app-secondary hover:bg-app-field';
              if (isSelected) {
                if (b === 'Bullish') {
                  selectedStyle = 'bg-emerald-pale text-bullish border-emerald-500 font-semibold shadow-2xs';
                } else if (b === 'Bearish') {
                  selectedStyle = 'bg-bearish-pale text-bearish border-rose-500 font-semibold shadow-2xs';
                } else if (b === 'Neutral') {
                  selectedStyle = 'bg-slate-200 dark:bg-slate-700 text-app-main border-slate-400 font-semibold shadow-2xs';
                } else {
                  selectedStyle = 'bg-amber-100 dark:bg-amber-950/40 text-amber-theme border-amber-400 font-semibold shadow-2xs';
                }
              }

              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => onChangeOverallBias(b)}
                  className={`px-2.5 py-1 text-xs sm:text-xs rounded border transition-colors whitespace-nowrap ${selectedStyle}`}
                >
                  {b}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onToggleExpand}
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-app-secondary hover:text-app-main hover:bg-app-field rounded border border-app transition-colors ml-1 cursor-pointer"
            aria-label={isExpanded ? `Collapse ${timeframe} Deep Analysis` : `Expand ${timeframe} Deep Analysis`}
            aria-expanded={isExpanded}
          >
            <span>Deep Analysis</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Deep Analysis Body (Kept mounted to preserve unsaved form inputs, but completely hidden when collapsed) */}
      <div className={isExpanded ? "p-3.5 sm:p-5 bg-app-main divide-y divide-app/50" : "hidden"} aria-hidden={!isExpanded}>
        {/* Visible General Supply & Demand summary badges inside deep analysis body */}
        {visibleSupplyDemandLevels.length > 0 && (
          <div className="pb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-app-secondary font-medium text-[11px] uppercase tracking-wider">
              S/D Manager:
            </span>
            {visibleSupplyDemandLevels.map((sd) => (
              <span
                key={sd.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-app-field border border-app text-app-main text-[11px]"
              >
                {sd.supply && <span className="text-bearish">Supply: {sd.supply}</span>}
                {sd.supply && sd.demand && <span className="opacity-40">|</span>}
                {sd.demand && <span className="text-bullish">Demand: {sd.demand}</span>}
              </span>
            ))}
          </div>
        )}
          {/* 1. Overall Interpretation (biasSpecific) */}
          {deepVis?.overallInterpretation !== false && (
            <div className="pb-4">
              <label className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1">
                1. Overall Interpretation
              </label>
              <input
                type="text"
                value={data.biasSpecific}
                onChange={(e) =>
                  onUpdateField((prev) => ({ ...prev, biasSpecific: e.target.value }))
                }
                placeholder={`Specific ${timeframe} contextual bias, order flow notes, or HTF intent...`}
                className="w-full px-3 py-2 text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors"
              />
            </div>
          )}

          {/* 2. Equilibrium / Price Location */}
          {deepVis?.priceLocation !== false && (
            <div className="py-4">
              <label className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1.5">
                2. Equilibrium / Price Location
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-app-secondary mb-1">
                    Market Location
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['Discount', 'Equilibrium', 'Premium'] as const).map((loc) => {
                      const isSel = data.priceLocation?.location === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          onClick={() =>
                            onUpdateField((prev) => ({
                              ...prev,
                              priceLocation: {
                                location: isSel ? '' : (loc as PriceLocation),
                                levelRange: prev.priceLocation?.levelRange || '',
                              },
                            }))
                          }
                          className={`py-1.5 text-xs rounded border transition-colors ${
                            isSel
                              ? loc === 'Discount'
                                ? 'bg-emerald-pale text-bullish border-emerald-500 font-semibold'
                                : loc === 'Premium'
                                ? 'bg-bearish-pale text-bearish border-rose-500 font-semibold'
                                : 'bg-slate-200 dark:bg-slate-700 text-app-main border-slate-400 font-semibold'
                              : 'border-app text-app-secondary hover:bg-app-field'
                          }`}
                        >
                          {loc}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-app-secondary mb-1">
                    Level / Range
                  </label>
                  <input
                    type="text"
                    value={data.priceLocation?.levelRange || ''}
                    onChange={(e) =>
                      onUpdateField((prev) => ({
                        ...prev,
                        priceLocation: {
                          location: prev.priceLocation?.location || '',
                          levelRange: e.target.value,
                        },
                      }))
                    }
                    placeholder="Enter level or range"
                    className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3, 4, 5. Swing, Internal & Fractal Structure Columns */}
          <div className="py-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 3. SWING Structure */}
              {deepVis?.swingStructure !== false && (
                <div className="p-3 rounded border border-app bg-app-secondary/50">
                  <div className="text-xs font-bold uppercase tracking-wider text-app-main mb-2.5 pb-1 border-b border-app/60 flex items-center justify-between">
                    <span>3. SWING</span>
                    {data.swing.direction && (
                      <span
                        className={`text-[11px] font-semibold ${
                          data.swing.direction === 'Bullish'
                            ? 'text-bullish'
                            : data.swing.direction === 'Bearish'
                            ? 'text-bearish'
                            : 'text-app-secondary'
                        }`}
                      >
                        {data.swing.direction}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Swing Structure
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(['Bullish', 'Bearish', 'Neutral'] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() =>
                              onUpdateField((prev) => ({
                                ...prev,
                                swing: {
                                  ...prev.swing,
                                  direction: prev.swing.direction === dir ? ('' as StructureDirection) : dir,
                                },
                              }))
                            }
                            className={`py-1 text-xs rounded border transition-colors ${
                              data.swing.direction === dir
                                ? dir === 'Bullish'
                                ? 'bg-emerald-pale text-bullish border-emerald-500 font-medium'
                                : dir === 'Bearish'
                                ? 'bg-bearish-pale text-bearish border-rose-500 font-medium'
                                : 'bg-slate-200 dark:bg-slate-700 text-app-main border-slate-400 font-medium'
                                : 'border-app text-app-secondary hover:bg-app-field'
                            }`}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-app-secondary mb-1">
                          Swing High
                        </label>
                        <input
                          type="text"
                          value={data.swing.high}
                          onChange={(e) =>
                            onUpdateField((prev) => ({
                              ...prev,
                              swing: { ...prev.swing, high: e.target.value },
                            }))
                          }
                          placeholder="e.g. 2685.50"
                          className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-app-secondary mb-1">
                          Swing Low
                        </label>
                        <input
                          type="text"
                          value={data.swing.low}
                          onChange={(e) =>
                            onUpdateField((prev) => ({
                              ...prev,
                              swing: { ...prev.swing, low: e.target.value },
                            }))
                          }
                          placeholder="e.g. 2652.00"
                          className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        BOS At
                      </label>
                      <input
                        type="text"
                        value={data.swing.bosAt}
                        onChange={(e) =>
                          onUpdateField((prev) => ({
                            ...prev,
                            swing: { ...prev.swing, bosAt: e.target.value },
                          }))
                        }
                        placeholder="Break of Structure price"
                        className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 4. INTERNAL Structure */}
              {deepVis?.internalStructure !== false && (
                <div className="p-3 rounded border border-app bg-app-secondary/50">
                  <div className="text-xs font-bold uppercase tracking-wider text-app-main mb-2.5 pb-1 border-b border-app/60 flex items-center justify-between">
                    <span>4. INTERNAL</span>
                    {data.internal.direction && (
                      <span
                        className={`text-[11px] font-semibold ${
                          data.internal.direction === 'Bullish'
                            ? 'text-bullish'
                            : data.internal.direction === 'Bearish'
                            ? 'text-bearish'
                            : 'text-app-secondary'
                        }`}
                      >
                        {data.internal.direction}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Internal Structure
                      </label>
                      <div className="grid grid-cols-3 gap-1">
                        {(['Bullish', 'Bearish', 'Neutral'] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() =>
                              onUpdateField((prev) => ({
                                ...prev,
                                internal: {
                                  ...prev.internal,
                                  direction: prev.internal.direction === dir ? ('' as StructureDirection) : dir,
                                },
                              }))
                            }
                            className={`py-1 text-xs rounded border transition-colors ${
                              data.internal.direction === dir
                                ? dir === 'Bullish'
                                ? 'bg-emerald-pale text-bullish border-emerald-500 font-medium'
                                : dir === 'Bearish'
                                ? 'bg-bearish-pale text-bearish border-rose-500 font-medium'
                                : 'bg-slate-200 dark:bg-slate-700 text-app-main border-slate-400 font-medium'
                                : 'border-app text-app-secondary hover:bg-app-field'
                            }`}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-app-secondary mb-1">
                          Internal High
                        </label>
                        <input
                          type="text"
                          value={data.internal.high}
                          onChange={(e) =>
                            onUpdateField((prev) => ({
                              ...prev,
                              internal: { ...prev.internal, high: e.target.value },
                            }))
                          }
                          placeholder="e.g. 2674.20"
                          className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-app-secondary mb-1">
                          Internal Low
                        </label>
                        <input
                          type="text"
                          value={data.internal.low}
                          onChange={(e) =>
                            onUpdateField((prev) => ({
                              ...prev,
                              internal: { ...prev.internal, low: e.target.value },
                            }))
                          }
                          placeholder="e.g. 2661.10"
                          className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        iBOS At
                      </label>
                      <input
                        type="text"
                        value={data.internal.ibosAt}
                        onChange={(e) =>
                          onUpdateField((prev) => ({
                            ...prev,
                            internal: { ...prev.internal, ibosAt: e.target.value },
                          }))
                        }
                        placeholder="Internal break of structure price"
                        className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 5. FRACTAL Structure */}
              {deepVis?.fractalStructure !== false && (
                <div className="p-3 rounded border border-app bg-app-secondary/50">
                  <div className="text-xs font-bold uppercase tracking-wider text-app-main mb-2.5 pb-1 border-b border-app/60 flex items-center justify-between">
                    <span>5. FRACTAL</span>
                    {data.fractal.direction && (
                      <span
                        className={`text-[11px] font-semibold ${
                          data.fractal.direction === 'Bullish'
                            ? 'text-bullish'
                            : 'text-bearish'
                        }`}
                      >
                        {data.fractal.direction}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Fractal Structure
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        {(['Bullish', 'Bearish'] as const).map((dir) => (
                          <button
                            key={dir}
                            type="button"
                            onClick={() =>
                              onUpdateField((prev) => ({
                                ...prev,
                                fractal: {
                                  ...prev.fractal,
                                  direction: prev.fractal.direction === dir ? ('' as FractalDirection) : dir,
                                },
                              }))
                            }
                            className={`py-1 text-xs rounded border transition-colors ${
                              data.fractal.direction === dir
                                ? dir === 'Bullish'
                                ? 'bg-emerald-pale text-bullish border-emerald-500 font-medium'
                                : 'bg-bearish-pale text-bearish border-rose-500 font-medium'
                                : 'border-app text-app-secondary hover:bg-app-field'
                            }`}
                          >
                            {dir}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Fractal BOS At
                      </label>
                      <input
                        type="text"
                        value={data.fractal.fractalBosAt}
                        onChange={(e) =>
                          onUpdateField((prev) => ({
                            ...prev,
                            fractal: { ...prev.fractal, fractalBosAt: e.target.value },
                          }))
                        }
                        placeholder="Fractal break level"
                        className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 6. Supply Levels */}
          {deepVis?.supplyLevels !== false &&
            renderLevelSection('6. Supply Levels', 'Add Supply', 'supplyLevels', 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300')}

          {/* 7. Demand Levels */}
          {deepVis?.demandLevels !== false &&
            renderLevelSection('7. Demand Levels', 'Add Demand', 'demandLevels', 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300')}

          {/* 8. Support Levels */}
          {deepVis?.supportLevels !== false &&
            renderLevelSection('8. Support Levels', 'Add Support', 'supportLevels', 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300')}

          {/* 9. Resistance Levels */}
          {deepVis?.resistanceLevels !== false &&
            renderLevelSection('9. Resistance Levels', 'Add Resistance', 'resistanceLevels', 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300')}

          {/* 10. Liquidity Levels */}
          {deepVis?.liquidityLevels !== false &&
            renderLevelSection('10. Liquidity Levels', 'Add Liquidity', 'liquidityLevels', 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300')}

          {/* 11. Timeframe Note */}
          {deepVis?.timeframeNotes !== false && (
            <div className="py-4">
              <label className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1">
                11. {noteLabel}
              </label>
              <textarea
                rows={2}
                value={data.note}
                onChange={(e) =>
                  onUpdateField((prev) => ({ ...prev, note: e.target.value }))
                }
                placeholder={`Key observations, inducement, liquidity pools, or order blocks in ${timeframe}...`}
                className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors resize-y"
              />
            </div>
          )}

          {/* 12. Chart Attachments */}
          {deepVis?.chartAttachments !== false && (
            <div className="py-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-app-main mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-app-secondary" />
                  12. {timeframe} Chart Screenshot (Optional)
                </span>
                {data.chartImageId && (
                  <span className="text-[11px] font-normal text-emerald-theme">
                    Image attached
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-app-main border border-app text-app-main hover:bg-app-field rounded transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-app-secondary" />
                  {data.chartImageId ? 'Replace Image' : 'Add Image'}
                </button>

                <button
                  type="button"
                  onClick={handlePasteImage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-app-main border border-app text-app-main hover:bg-app-field rounded transition-colors"
                >
                  <Clipboard className="w-3.5 h-3.5 text-app-secondary" />
                  Paste Image
                </button>

                {/* Paste fallback target input for restrictive browsers */}
                <input
                  type="text"
                  placeholder="Or paste screenshot here (Ctrl+V)"
                  onPaste={handleManualPasteTarget}
                  className="px-2.5 py-1 text-xs bg-app-field border border-dashed border-app rounded text-app-secondary focus:outline-hidden focus:border-emerald-600 w-52"
                />

                {data.chartImageId && (
                  <>
                    <button
                      type="button"
                      onClick={() => onViewImage(data.chartImageId!, `${timeframe} Chart`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-theme bg-emerald-pale hover:bg-emerald-100 rounded transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Image
                    </button>

                    {!showRemoveImageConfirm ? (
                      <button
                        type="button"
                        onClick={() => setShowRemoveImageConfirm(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 text-xs p-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded">
                        <span className="text-rose-700 dark:text-rose-300 text-[11px]">Remove image?</span>
                        <button
                          type="button"
                          onClick={async () => {
                            await onRemoveImage();
                            setShowRemoveImageConfirm(false);
                          }}
                          className="px-2 py-0.5 bg-rose-600 text-white rounded text-[11px] font-semibold"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRemoveImageConfirm(false)}
                          className="px-2 py-0.5 text-app-secondary rounded text-[11px]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {pasteError && (
                <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{pasteError}</p>
              )}
            </div>
          )}

          {/* Deep Save feedback message if any */}
          {deepSaveSuccessMsg && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 my-2 rounded bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-xs font-semibold animate-fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>Deep analysis saved</span>
            </div>
          )}

          {deepSaveErrorMsg && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 my-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-rose-600 dark:text-rose-400 text-xs">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{deepSaveErrorMsg}</span>
              </div>
              <button
                type="button"
                onClick={handleSaveTimeframe}
                className="font-bold underline hover:no-underline cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* 13. Save, Reset, Collapse actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleSaveTimeframe}
                disabled={isSavingDeep}
                aria-label={`Save ${timeframe} Deep Analysis`}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSavingDeep ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>{isSavingDeep ? 'Saving...' : 'Save Deep Analysis'}</span>
              </button>

              <button
                type="button"
                onClick={onToggleExpand}
                className="px-3 py-1.5 text-xs font-medium text-app-secondary bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
              >
                Collapse
              </button>
            </div>

            {/* Reset with confirmation */}
            {!showResetConfirm ? (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Reset {timeframe} Fields
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 text-xs p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 rounded">
                <span className="text-rose-700 dark:text-rose-300 text-xs">
                  Clear {timeframe} deep fields & chart?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onResetDeep();
                    setShowResetConfirm(false);
                  }}
                  className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-semibold"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="px-2 py-1 text-app-secondary rounded text-xs"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
    </section>
  );
};
