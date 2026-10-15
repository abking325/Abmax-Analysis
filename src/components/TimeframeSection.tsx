import React, { useRef, useState } from 'react';
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
  onSaveDeep: () => void;
  onEditDeep: () => void;
  onResetDeep: () => void;
  onAttachImage: (dataUrl: string) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  onViewImage: (imageId: string, title: string) => void;
  visibleSupplyDemandLevels: SupplyDemandLevel[];
  visibilityConfig?: WorkspaceVisibilityConfig;
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
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showRemoveImageConfirm, setShowRemoveImageConfirm] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);

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

  // Save handler: preserves open state and viewport position without scroll jumping
  const handleSaveTimeframe = () => {
    onSaveDeep();
  };

  // Level array helpers
  const addLevelEntry = (key: 'supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels') => {
    const newEntry: DeepLevelEntry = {
      id: `lvl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      level: '',
      note: '',
    };
    onUpdateField((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), newEntry],
    }));
  };

  const updateLevelEntry = (
    key: 'supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels',
    id: string,
    updates: Partial<DeepLevelEntry>
  ) => {
    onUpdateField((prev) => ({
      ...prev,
      [key]: (prev[key] || []).map((item) => (item.id === id ? { ...item, ...updates } : item)),
    }));
  };

  const removeLevelEntry = (
    key: 'supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels',
    id: string
  ) => {
    onUpdateField((prev) => ({
      ...prev,
      [key]: (prev[key] || []).filter((item) => item.id !== id),
    }));
  };

  const renderLevelSection = (
    title: string,
    buttonLabel: string,
    key: 'supplyLevels' | 'demandLevels' | 'supportLevels' | 'resistanceLevels' | 'liquidityLevels',
    tagColor: string
  ) => {
    const list = data[key] || [];
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
          <button
            type="button"
            onClick={() => addLevelEntry(key)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-theme bg-emerald-pale hover:bg-emerald-100 dark:hover:bg-emerald-900/30 rounded transition-colors"
          >
            <Plus className="w-3 h-3" /> {buttonLabel}
          </button>
        </div>

        {list.length === 0 ? (
          <p className="text-[11px] text-app-secondary italic py-1">No {title.toLowerCase()} added.</p>
        ) : (
          <div className="space-y-2 mt-1.5">
            {list.map((entry, idx) => (
              <div
                key={entry.id || idx}
                className="flex flex-col sm:flex-row items-start sm:items-center gap-2 p-2 rounded bg-app-secondary/40 border border-app"
              >
                <div className="flex-1 w-full sm:w-auto">
                  <input
                    type="text"
                    value={entry.level}
                    onChange={(e) => updateLevelEntry(key, entry.id, { level: e.target.value })}
                    placeholder="Enter level or range (e.g. 2685.50 - 2690.00)"
                    className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                  />
                </div>
                <div className="flex-1 w-full sm:w-auto">
                  <input
                    type="text"
                    value={entry.note || ''}
                    onChange={(e) => updateLevelEntry(key, entry.id, { note: e.target.value })}
                    placeholder="Optional observation / note..."
                    className="w-full px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeLevelEntry(key, entry.id)}
                  title="Remove entry"
                  className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors shrink-0 self-end sm:self-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
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

            {data.isSaved && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-theme bg-emerald-pale px-2 py-0.5 rounded">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}

            {deepAligned && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-theme bg-emerald-pale border border-emerald-theme/30 px-2 py-0.5 rounded">
                Deep Analysis Aligned ({data.swing.direction})
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleExpand}
            className="md:hidden p-1.5 rounded text-app-secondary hover:text-app-main hover:bg-app-field transition-colors"
            aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
            className="hidden md:inline-flex p-1.5 rounded text-app-secondary hover:text-app-main hover:bg-app-field transition-colors ml-1"
            aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Visible General Supply & Demand summary badges under header if any */}
      {visibleSupplyDemandLevels.length > 0 && (
        <div className="px-3 sm:px-4 py-1.5 bg-app-field/60 border-b border-app/40 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-app-secondary font-medium text-[11px] uppercase tracking-wider">
            S/D Manager:
          </span>
          {visibleSupplyDemandLevels.map((sd) => (
            <span
              key={sd.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-app-main border border-app text-app-main text-[11px]"
            >
              {sd.supply && <span className="text-bearish">Supply: {sd.supply}</span>}
              {sd.supply && sd.demand && <span className="opacity-40">|</span>}
              {sd.demand && <span className="text-bullish">Demand: {sd.demand}</span>}
            </span>
          ))}
        </div>
      )}

      {/* Collapsed State with Saved Summary & Edit button */}
      {!isExpanded && data.isSaved && (
        <div className="p-3 sm:p-4 bg-app-main flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-app-secondary">
            {data.priceLocation?.location && (
              <span>
                <strong className="text-app-main font-semibold">Location:</strong>{' '}
                {data.priceLocation.location}{' '}
                {data.priceLocation.levelRange ? `(${data.priceLocation.levelRange})` : ''}
              </span>
            )}
            <span>
              <strong className="text-app-main font-semibold">Swing:</strong>{' '}
              {data.swing.direction || '—'}{' '}
              {data.swing.high && `(H: ${data.swing.high})`}{' '}
              {data.swing.low && `(L: ${data.swing.low})`}
            </span>
            <span>
              <strong className="text-app-main font-semibold">Internal:</strong>{' '}
              {data.internal.direction || '—'}{' '}
              {data.internal.high && `(H: ${data.internal.high})`}
            </span>
            <span>
              <strong className="text-app-main font-semibold">Fractal:</strong>{' '}
              {data.fractal.direction || '—'}
            </span>
            {data.chartImageId && (
              <span className="inline-flex items-center gap-1 text-emerald-theme">
                <ImageIcon className="w-3.5 h-3.5" /> Chart Attached
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onEditDeep}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium text-emerald-theme bg-emerald-pale rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <Edit2 className="w-3 h-3" /> Edit Deep Analysis
          </button>
        </div>
      )}

      {/* Expanded Deep Analysis Editor */}
      {isExpanded && (
        <div className="p-3.5 sm:p-5 bg-app-main divide-y divide-app/50">
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

          {/* 13. Save, Reset, Collapse actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveTimeframe}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors"
              >
                <Check className="w-3.5 h-3.5" /> Save {timeframe}
              </button>

              <button
                type="button"
                onClick={onToggleExpand}
                className="px-3 py-1.5 text-xs font-medium text-app-secondary bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
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
      )}
    </section>
  );
};
