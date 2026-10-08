import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Save,
  Bookmark,
  FolderOpen,
  Trash2,
  Clock,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import {
  AnalysisData,
  AnalysisTiming,
  MajorLiquidityItem,
  SavedReport,
  SavedTemplate,
  SupplyDemandLevel,
  TIMEFRAME_ORDER,
  TimeframeData,
  TimeframeId,
  TradingPair,
  TradingSession,
  createEmptyTimeframeData,
  createInitialAnalysisData,
} from '../types/journal';
import {
  calculateOverallAlignment,
} from '../utils/analysisUtils';
import { TimeframeSection } from './TimeframeSection';
import {
  MajorLiquiditySection,
  SupplyDemandSection,
} from './LiquidityAndSupplyDemand';
import { SaveTemplateModal, LoadTemplateModal } from './TemplatesModal';
import { ImageViewerModal } from './ImageViewerModal';
import {
  saveDraft,
  clearDraft,
  saveReport,
  saveImage,
  deleteImage,
  getImage,
  saveTemplate,
} from '../services/db';
import { useAuth } from '../context/AuthContext';
import {
  uploadReportToCloud,
  uploadDraftToCloud,
  clearDraftFromCloud,
  uploadTemplateToCloud,
  SyncState,
} from '../services/cloudSync';
import { SyncStatusBadge } from './SyncStatusBadge';

interface AnalysisViewProps {
  initialData: AnalysisData;
  isEditingExistingReport: boolean;
  onNavigateHome: () => void;
  onReportSavedSuccessfully: (reportId: string) => void;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  initialData,
  isEditingExistingReport,
  onNavigateHome,
  onReportSavedSuccessfully,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<AnalysisData>(initialData);
  const [expandedTimeframes, setExpandedTimeframes] = useState<Record<TimeframeId, boolean>>({
    Weekly: false,
    Daily: false,
    '4H': false,
    '1H': false,
    '15M': false,
    '5M': false,
    '1M': false,
  });

  // Live local clock state for display
  const [liveClock, setLiveClock] = useState(() => {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  });

  // Autosave & sync status state
  const [autosaveStatus, setAutosaveStatus] = useState<string>('Ready');
  const [syncStatus, setSyncStatus] = useState<SyncState>('local');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Modals state
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [isLoadTemplateOpen, setIsLoadTemplateOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );
  const [saveReportError, setSaveReportError] = useState<string | null>(null);
  const [isSavingReport, setIsSavingReport] = useState(false);

  // Run live clock timer
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveClock(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Update data if initialData changes (e.g. from template or report loading)
  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  // Debounced draft autosave
  const triggerAutosave = useCallback((currentData: AnalysisData) => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    setAutosaveStatus('Saving changes...');

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveDraft(currentData);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setAutosaveStatus(`Draft autosaved at ${timeStr}`);

        if (user) {
          setSyncStatus('syncing');
          await uploadDraftToCloud(user.id, currentData);
          setSyncStatus('synced');
          setLastSyncedAt(Date.now());
        } else {
          setSyncStatus('local');
        }
      } catch (err) {
        console.error('Autosave failed', err);
        setAutosaveStatus('Autosave failed (local storage full or blocked)');
        if (user) setSyncStatus('error');
      }
    }, 800);
  }, [user]);

  const updateAnalysis = (updater: (prev: AnalysisData) => AnalysisData) => {
    setData((prev) => {
      const next = updater(prev);
      triggerAutosave(next);
      return next;
    });
  };

  // Alignment Calculation
  const alignment = calculateOverallAlignment(data.timeframes);

  // Timeframe expansion toggle
  const toggleTimeframeExpand = (tf: TimeframeId) => {
    setExpandedTimeframes((prev) => ({
      ...prev,
      [tf]: !prev[tf],
    }));
  };

  // Overall Bias change
  const handleOverallBiasChange = (tf: TimeframeId, bias: TimeframeData['overallBias']) => {
    updateAnalysis((prev) => ({
      ...prev,
      timeframes: {
        ...prev.timeframes,
        [tf]: {
          ...prev.timeframes[tf],
          overallBias: bias,
        },
      },
    }));
  };

  // Deep field updates
  const handleUpdateDeepTimeframe = (
    tf: TimeframeId,
    updater: (prev: TimeframeData) => TimeframeData
  ) => {
    updateAnalysis((prev) => ({
      ...prev,
      timeframes: {
        ...prev.timeframes,
        [tf]: updater(prev.timeframes[tf]),
      },
    }));
  };

  // Save deep analysis (locks fields, collapses editor)
  const handleSaveDeep = (tf: TimeframeId) => {
    updateAnalysis((prev) => ({
      ...prev,
      timeframes: {
        ...prev.timeframes,
        [tf]: {
          ...prev.timeframes[tf],
          isSaved: true,
        },
      },
    }));
    setExpandedTimeframes((prev) => ({ ...prev, [tf]: false }));
  };

  // Edit deep analysis (unlocks fields)
  const handleEditDeep = (tf: TimeframeId) => {
    updateAnalysis((prev) => ({
      ...prev,
      timeframes: {
        ...prev.timeframes,
        [tf]: {
          ...prev.timeframes[tf],
          isSaved: false,
        },
      },
    }));
    setExpandedTimeframes((prev) => ({ ...prev, [tf]: true }));
  };

  // Reset deep analysis (clears deep fields & chart image after confirmation, preserves overall bias)
  const handleResetDeep = async (tf: TimeframeId) => {
    const existingImgId = data.timeframes[tf]?.chartImageId;
    if (existingImgId) {
      await deleteImage(existingImgId);
    }

    const empty = createEmptyTimeframeData(tf);
    updateAnalysis((prev) => ({
      ...prev,
      timeframes: {
        ...prev.timeframes,
        [tf]: {
          ...empty,
          overallBias: prev.timeframes[tf]?.overallBias || '', // preserve overall bias
          isSaved: false,
        },
      },
    }));
  };

  // Image attachment
  const handleAttachImage = async (tf: TimeframeId, dataUrl: string) => {
    try {
      const existingImgId = data.timeframes[tf]?.chartImageId;
      if (existingImgId) {
        await deleteImage(existingImgId);
      }
      const newId = await saveImage(dataUrl, `${tf} Chart`);
      updateAnalysis((prev) => ({
        ...prev,
        timeframes: {
          ...prev.timeframes,
          [tf]: {
            ...prev.timeframes[tf],
            chartImageId: newId,
          },
        },
      }));
    } catch (e) {
      console.error('Failed to attach chart image', e);
    }
  };

  // Image remove
  const handleRemoveImage = async (tf: TimeframeId) => {
    const existingImgId = data.timeframes[tf]?.chartImageId;
    if (existingImgId) {
      await deleteImage(existingImgId);
      updateAnalysis((prev) => ({
        ...prev,
        timeframes: {
          ...prev.timeframes,
          [tf]: {
            ...prev.timeframes[tf],
            chartImageId: undefined,
          },
        },
      }));
    }
  };

  // View image
  const handleViewImage = async (imageId: string, title: string) => {
    const url = await getImage(imageId);
    if (url) {
      setActiveViewerImage({ url, title });
    }
  };

  // Major Liquidity Toggle
  const handleToggleLiquidity = (item: MajorLiquidityItem) => {
    updateAnalysis((prev) => {
      const current = prev.crossedLiquidity || [];
      const exists = current.includes(item);
      return {
        ...prev,
        crossedLiquidity: exists
          ? current.filter((x) => x !== item)
          : [...current, item],
      };
    });
  };

  // Supply & Demand Handlers
  const handleAddSDLevel = (level: SupplyDemandLevel) => {
    updateAnalysis((prev) => ({
      ...prev,
      supplyDemandLevels: [...(prev.supplyDemandLevels || []), level],
    }));
  };

  const handleUpdateSDLevel = (updated: SupplyDemandLevel) => {
    updateAnalysis((prev) => ({
      ...prev,
      supplyDemandLevels: (prev.supplyDemandLevels || []).map((l) =>
        l.id === updated.id ? updated : l
      ),
    }));
  };

  const handleRemoveSDLevel = (id: string) => {
    updateAnalysis((prev) => ({
      ...prev,
      supplyDemandLevels: (prev.supplyDemandLevels || []).filter((l) => l.id !== id),
    }));
  };

  const handleToggleSDVisibility = (id: string) => {
    updateAnalysis((prev) => ({
      ...prev,
      supplyDemandLevels: (prev.supplyDemandLevels || []).map((l) =>
        l.id === id ? { ...l, showInTimeframe: !l.showInTimeframe } : l
      ),
    }));
  };

  // Save Report (Primary action)
  const handleSaveReport = async () => {
    setIsSavingReport(true);
    setSaveReportError(null);
    try {
      const now = Date.now();
      const reportPayload: SavedReport = {
        ...data,
        updatedAt: now,
        createdAt: isEditingExistingReport ? data.createdAt : now,
        status: isEditingExistingReport ? 'Modified' : 'Original',
        isModified: isEditingExistingReport,
      };

      await saveReport(reportPayload);
      await clearDraft();

      // Cloud synchronization if user is signed in
      if (user) {
        setSyncStatus('syncing');
        const cloudRes = await uploadReportToCloud(user.id, reportPayload);
        await clearDraftFromCloud(user.id);
        if (cloudRes.success) {
          setSyncStatus('synced');
          setLastSyncedAt(Date.now());
        } else if (cloudRes.conflict) {
          setSaveReportError('Cloud revision conflict: a newer version of this report exists in your account. Your local edit has been saved to this browser.');
          setSyncStatus('error');
        } else {
          setSaveReportError(`Saved locally. Cloud sync pending: ${cloudRes.error}`);
          setSyncStatus('error');
        }
      }

      onReportSavedSuccessfully(reportPayload.id);
    } catch (err) {
      console.error('Failed to save report', err);
      setSaveReportError((err as Error).message || 'Failed to save report to local storage.');
    } finally {
      setIsSavingReport(false);
    }
  };

  // Continue Later (saves full draft and returns Home)
  const handleContinueLater = async () => {
    try {
      await saveDraft(data);
      if (user) {
        await uploadDraftToCloud(user.id, data);
      }
      onNavigateHome();
    } catch (err) {
      console.error('Failed to save draft for later', err);
    }
  };

  // Save Template
  const handleSaveTemplate = async (templateName: string) => {
    const tmplId = `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tmpl: SavedTemplate = {
      id: tmplId,
      name: templateName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        pair: data.pair,
        session: data.session,
        timezone: data.timezone,
        analysisTiming: data.analysisTiming,
        timeframes: data.timeframes,
        crossedLiquidity: data.crossedLiquidity,
        supplyDemandLevels: data.supplyDemandLevels,
        overallNotes: data.overallNotes,
      },
    };
    await saveTemplate(tmpl);
    if (user) {
      await uploadTemplateToCloud(user.id, tmpl);
    }
  };

  // Load Template (loads as a new analysis with today's local date, does not carry existing report ID)
  const handleLoadTemplate = (template: SavedTemplate) => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const newAnalysis: AnalysisData = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pair: template.data.pair,
      date: dateStr,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      timezone: template.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      session: template.data.session,
      analysisTiming: template.data.analysisTiming,
      timeframes: JSON.parse(JSON.stringify(template.data.timeframes)),
      crossedLiquidity: [...(template.data.crossedLiquidity || [])],
      supplyDemandLevels: JSON.parse(JSON.stringify(template.data.supplyDemandLevels || [])),
      overallNotes: template.data.overallNotes || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    updateAnalysis(() => newAnalysis);
    setIsLoadTemplateOpen(false);
  };

  // Clear Analysis
  const handleClearAnalysis = async () => {
    const fresh = createInitialAnalysisData('XAUUSD');
    updateAnalysis(() => fresh);
    await clearDraft();
    if (user) {
      await clearDraftFromCloud(user.id);
    }
    setShowClearConfirm(false);
  };

  return (
    <div className="max-w-[1100px] mx-auto px-3.5 sm:px-6 py-6 sm:py-8">
      {/* 1. Market Analysis Heading */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-5 border-b border-app">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-app-main">
              Market Analysis
            </h2>
            {isEditingExistingReport && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-theme border border-amber-300 dark:bg-amber-950/40">
                Editing Report ({data.id})
              </span>
            )}
          </div>
          <p className="text-xs text-app-secondary mt-0.5">
            Continuous multi-timeframe SMC journal flow from Weekly to 1-Minute.
          </p>
        </div>

        {/* Autosave subtle status text & Cloud Sync Status */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-app-secondary">
          <SyncStatusBadge
            status={syncStatus}
            lastSyncedAt={lastSyncedAt}
            onRetry={() => triggerAutosave(data)}
          />
          <span className="text-app-secondary opacity-40">|</span>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-theme" />
            <span>{autosaveStatus}</span>
          </div>
        </div>
      </div>

      {/* 2. General Information (Responsive wrapping grid, labels above controls) */}
      <div className="p-4 rounded-lg bg-app-secondary border border-app mb-4 shadow-2xs">
        <div className="text-xs font-bold text-app-main uppercase tracking-wider mb-3">
          General Information
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* Pair */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">Pair</label>
            <select
              value={data.pair}
              onChange={(e) =>
                updateAnalysis((prev) => ({ ...prev, pair: e.target.value as TradingPair }))
              }
              className="w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main font-semibold focus:outline-hidden focus:border-emerald-600"
            >
              <option value="XAUUSD">XAUUSD</option>
              <option value="BTCUSD">BTCUSD</option>
              <option value="EURUSD">EURUSD</option>
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">
              Analysis Date
            </label>
            <input
              type="date"
              value={data.date}
              onChange={(e) =>
                updateAnalysis((prev) => ({ ...prev, date: e.target.value }))
              }
              className="w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
            />
          </div>

          {/* Time with timezone label */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">
              Live Time ({data.timezone || 'Local'})
            </label>
            <div className="px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main font-mono tabular-nums flex items-center justify-between">
              <span>{liveClock}</span>
              <span className="text-[10px] text-emerald-theme uppercase font-semibold">Live</span>
            </div>
          </div>

          {/* Session */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">Session</label>
            <select
              value={data.session}
              onChange={(e) =>
                updateAnalysis((prev) => ({
                  ...prev,
                  session: e.target.value as TradingSession,
                }))
              }
              className="w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
            >
              <option value="Asian">Asian</option>
              <option value="London">London</option>
              <option value="NY AM">NY AM</option>
              <option value="NY PM">NY PM</option>
            </select>
          </div>

          {/* Analysis Made */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">
              Analysis Made
            </label>
            <select
              value={data.analysisTiming}
              onChange={(e) =>
                updateAnalysis((prev) => ({
                  ...prev,
                  analysisTiming: e.target.value as AnalysisTiming,
                }))
              }
              className="w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
            >
              <option value="On time">On time</option>
              <option value="Before session">Before session</option>
              <option value="Before 1 day">Before 1 day</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Overall Alignment Banner (Slim banner, ALIGNED only when all 7 match) */}
      <div
        className={`w-full p-3 rounded-lg border mb-5 flex flex-wrap items-center justify-between gap-2 text-xs transition-colors shadow-2xs ${
          alignment.status === 'ALIGNED'
            ? alignment.bias === 'Bullish'
              ? 'bg-emerald-pale border-emerald-500 text-bullish font-semibold'
              : 'bg-bearish-pale border-rose-500 text-bearish font-semibold'
            : alignment.status === 'MIXED'
            ? 'bg-app-field border-slate-300 dark:border-slate-700 text-app-main'
            : 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 text-amber-theme'
        }`}
      >
        <div className="flex items-center gap-2">
          {alignment.status === 'ALIGNED' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="font-bold tracking-wide">{alignment.label}</span>
          <span className="opacity-75 hidden sm:inline">— {alignment.detail}</span>
        </div>

        {/* Quick summary tally of timeframes */}
        <div className="flex items-center gap-1 text-[11px] font-mono">
          {TIMEFRAME_ORDER.map((tf) => {
            const b = data.timeframes[tf]?.overallBias;
            return (
              <span
                key={tf}
                title={`${tf}: ${b || 'Not set'}`}
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  b === 'Bullish'
                    ? 'bg-emerald-600 text-white'
                    : b === 'Bearish'
                    ? 'bg-rose-600 text-white'
                    : b === 'Neutral'
                    ? 'bg-slate-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-app-secondary'
                }`}
              >
                {tf}
              </span>
            );
          })}
        </div>
      </div>

      {/* 4-10: Seven Timeframe Sections in exact order (Weekly, Daily, 4H, 1H, 15M, 5M, 1M) */}
      <div className="space-y-3 mb-6">
        {TIMEFRAME_ORDER.map((tf) => {
          // Filter visible S/D levels for this timeframe
          const visibleSd = (data.supplyDemandLevels || []).filter(
            (sd) => sd.timeframe === tf && sd.showInTimeframe
          );

          return (
            <TimeframeSection
              key={tf}
              timeframe={tf}
              data={data.timeframes[tf]}
              isExpanded={expandedTimeframes[tf]}
              onToggleExpand={() => toggleTimeframeExpand(tf)}
              onChangeOverallBias={(b) => handleOverallBiasChange(tf, b)}
              onUpdateField={(updater) => handleUpdateDeepTimeframe(tf, updater)}
              onSaveDeep={() => handleSaveDeep(tf)}
              onEditDeep={() => handleEditDeep(tf)}
              onResetDeep={() => handleResetDeep(tf)}
              onAttachImage={(dataUrl) => handleAttachImage(tf, dataUrl)}
              onRemoveImage={() => handleRemoveImage(tf)}
              onViewImage={(imgId, title) => handleViewImage(imgId, title)}
              visibleSupplyDemandLevels={visibleSd}
            />
          );
        })}
      </div>

      {/* 11. Major Liquidity */}
      <MajorLiquiditySection
        selectedItems={data.crossedLiquidity || []}
        onToggleItem={handleToggleLiquidity}
      />

      {/* 12. Supply & Demand Levels */}
      <SupplyDemandSection
        levels={data.supplyDemandLevels || []}
        onAddLevel={handleAddSDLevel}
        onUpdateLevel={handleUpdateSDLevel}
        onRemoveLevel={handleRemoveSDLevel}
        onToggleVisibility={handleToggleSDVisibility}
      />

      {/* 13. Overall Notes */}
      <div className="border border-app rounded-lg bg-app-main p-4 sm:p-5 mb-6 shadow-2xs">
        <label className="block text-xs font-bold text-app-main uppercase tracking-wider mb-2">
          Overall Notes
        </label>
        <textarea
          rows={4}
          value={data.overallNotes}
          onChange={(e) =>
            updateAnalysis((prev) => ({ ...prev, overallNotes: e.target.value }))
          }
          placeholder="Comprehensive trade thesis, high-probability execution zones, key invalidations, risk parameters, and news catalysts..."
          className="w-full px-3 py-2.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main resize-y transition-colors leading-relaxed"
        />
      </div>

      {/* Save report error indicator if any */}
      {saveReportError && (
        <div className="p-3 mb-4 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs">
          {saveReportError}
        </div>
      )}

      {/* 14. Action buttons in normal page flow */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-app">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: Save Report */}
          <button
            type="button"
            onClick={handleSaveReport}
            disabled={isSavingReport}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-xs transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSavingReport
              ? 'Saving Report...'
              : isEditingExistingReport
              ? 'Update Report'
              : 'Save Report'}
          </button>

          {/* Continue Later: saves draft & returns Home */}
          <button
            type="button"
            onClick={handleContinueLater}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-medium bg-app-secondary border border-app text-app-main hover:bg-app-field rounded transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-app-secondary" />
            Continue Later
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Save Template */}
          <button
            type="button"
            onClick={() => setIsSaveTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-app-field border border-app hover:bg-slate-200 dark:hover:bg-slate-800 text-app-main rounded transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5 text-app-secondary" />
            Save Template
          </button>

          {/* Load Template */}
          <button
            type="button"
            onClick={() => setIsLoadTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-app-field border border-app hover:bg-slate-200 dark:hover:bg-slate-800 text-app-main rounded transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-app-secondary" />
            Load Template
          </button>

          {/* Clear Analysis with confirmation */}
          {!showClearConfirm ? (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Analysis
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 rounded text-xs">
              <span className="text-rose-700 dark:text-rose-300 font-medium">Clear all fields?</span>
              <button
                type="button"
                onClick={handleClearAnalysis}
                className="px-2 py-0.5 bg-rose-600 text-white rounded font-semibold"
              >
                Yes, Clear
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-2 py-0.5 text-app-secondary rounded"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Save Template Modal */}
      <SaveTemplateModal
        isOpen={isSaveTemplateOpen}
        onClose={() => setIsSaveTemplateOpen(false)}
        onSave={handleSaveTemplate}
      />

      {/* Load Template Modal */}
      <LoadTemplateModal
        isOpen={isLoadTemplateOpen}
        onClose={() => setIsLoadTemplateOpen(false)}
        onSelectTemplate={handleLoadTemplate}
      />

      {/* Large Image Modal */}
      {activeViewerImage && (
        <ImageViewerModal
          isOpen={Boolean(activeViewerImage)}
          onClose={() => setActiveViewerImage(null)}
          imageUrl={activeViewerImage.url}
          title={activeViewerImage.title}
        />
      )}
    </div>
  );
};
