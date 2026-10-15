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
  DEFAULT_VISIBILITY_CONFIG,
  MajorLiquidityItem,
  PlannedScenario,
  SavedReport,
  SavedTemplate,
  SupplyDemandLevel,
  TIMEFRAME_ORDER,
  TimeframeData,
  TimeframeId,
  TradingPair,
  TradingSession,
  WorkspaceVisibilityConfig,
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
import { PlannedScenariosSection } from './PlannedScenariosSection';
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
import { BackupModal } from './BackupModal';

interface AnalysisViewProps {
  initialData: AnalysisData;
  isEditingExistingReport: boolean;
  onNavigateHome: () => void;
  onReportSavedSuccessfully: (reportId: string) => void;
  workspaceVisibility?: WorkspaceVisibilityConfig;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  initialData,
  isEditingExistingReport,
  onNavigateHome,
  onReportSavedSuccessfully,
  workspaceVisibility,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<AnalysisData>(initialData);
  const [expandedTimeframes, setExpandedTimeframes] = useState<Record<TimeframeId, boolean>>({
    Monthly: false,
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
  const isSavingReportRef = useRef(false);

  // Modals state
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [isLoadTemplateOpen, setIsLoadTemplateOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );
  const [saveReportError, setSaveReportError] = useState<string | null>(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [saveStage, setSaveStage] = useState<'idle' | 'saving_local' | 'saved_local' | 'pending_cloud' | 'synced' | 'failed'>('idle');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

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

  // Clean up pending autosave timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

  // Debounced draft autosave
  const triggerAutosave = useCallback((currentData: AnalysisData) => {
    if (isSavingReportRef.current) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    setAutosaveStatus('Saving changes...');

    autosaveTimeoutRef.current = setTimeout(async () => {
      if (isSavingReportRef.current) return;
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

  // Determine active visibility configuration
  const activeVisibility: WorkspaceVisibilityConfig =
    data.visibilityConfig || workspaceVisibility || DEFAULT_VISIBILITY_CONFIG;

  // Filter enabled timeframes based on visibility config
  const enabledTimeframes = TIMEFRAME_ORDER.filter(
    (tf) => activeVisibility.timeframes[tf] !== false
  );

  // Alignment Calculation using enabled timeframes
  const alignment = calculateOverallAlignment(data.timeframes, enabledTimeframes);

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

  // Save deep analysis (marks saved, preserves expanded state without viewport jump)
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
    // Note: Timeframe remains expanded. Collapse happens ONLY when user clicks Collapse.
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
          overallBias: prev.timeframes[tf]?.overallBias || '',
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

  // Save Scenario directly (persists to draft if new, or to report if editing)
  const handleSaveScenarioDirectly = async () => {
    if (isEditingExistingReport) {
      const now = Date.now();
      const updatedReport: SavedReport = {
        ...data,
        updatedAt: now,
        status: 'Modified',
        isModified: true,
      };
      await saveReport(updatedReport);
      if (user) {
        uploadReportToCloud(user.id, updatedReport).catch(console.error);
      }
    } else {
      await saveDraft(data);
      if (user) {
        uploadDraftToCloud(user.id, data).catch(console.error);
      }
    }
  };

  // Save Report (Primary action)
  const handleSaveReport = async () => {
    if (isSavingReportRef.current) return;
    isSavingReportRef.current = true;
    setIsSavingReport(true);
    setSaveReportError(null);
    setSaveStage('saving_local');
    setAutosaveStatus('Saving on this device…');

    // Cancel pending draft autosave so it cannot resurrect after clearDraft
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }

    const now = Date.now();

    // Determine genuine stable report ID: never leak active_draft, and lock to existing report ID when editing
    const targetId = (isEditingExistingReport && initialData?.id && initialData.id !== 'active_draft' && initialData.id !== 'draft')
      ? initialData.id
      : (data.id && data.id !== 'active_draft' && data.id !== 'draft'
          ? data.id
          : (data.originalId && data.originalId !== 'active_draft' && data.originalId !== 'draft'
              ? data.originalId
              : `rep_${now}_${Math.random().toString(36).substring(2, 9)}`));

    // Clean title
    const cleanTitle = (data.title || '').trim();

    // Ensure all timeframes exist and have full structure
    const cleanTimeframes = { ...data.timeframes };
    for (const tf of TIMEFRAME_ORDER) {
      if (!cleanTimeframes[tf]) {
        cleanTimeframes[tf] = createEmptyTimeframeData(tf);
      }
    }

    const reportPayload: SavedReport = {
      ...data,
      id: targetId,
      title: cleanTitle || undefined,
      pair: data.pair || 'XAUUSD',
      date: data.date || new Date().toISOString().slice(0, 10),
      time: data.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      session: data.session || 'London',
      analysisTiming: data.analysisTiming || 'On time',
      timeframes: cleanTimeframes,
      crossedLiquidity: data.crossedLiquidity || [],
      majorLiquidityWatchlist: data.majorLiquidityWatchlist || '',
      supplyDemandLevels: data.supplyDemandLevels || [],
      scenarios: data.scenarios || [],
      trades: data.trades || [],
      overallNotes: data.overallNotes || '',
      visibilityConfig: activeVisibility,
      updatedAt: now,
      createdAt: isEditingExistingReport && (initialData.createdAt || data.createdAt) ? (initialData.createdAt || data.createdAt) : (data.createdAt || now),
      status: isEditingExistingReport ? 'Modified' : 'Original',
      isModified: isEditingExistingReport,
      copiedFromId: data.copiedFromId || (initialData as any)?.copiedFromId || undefined,
    };

    console.info(`[Report Lifecycle] Operation=save_report ID=${targetId} IsEditing=${isEditingExistingReport} TargetRev=${(data.revision || 0) + 1}`);

    try {
      // 1. SAVE LOCALLY FIRST via IndexedDB and verify read-back
      const savedRecord = await saveReport(reportPayload);
      console.info(`[Report Lifecycle] Operation=save_report_success ID=${savedRecord.id} Revision=${savedRecord.revision} TxResult=COMMITTED`);

      setSaveStage('saved_local');
      setAutosaveStatus('Saved on this device');

      // 2. Clear active draft locally after successful local save
      await clearDraft();

      // Update in-memory state with finalized report ID and revision
      setData((prev) => ({
        ...prev,
        ...savedRecord,
      }));

      // 3. Cloud synchronization if user is signed in
      if (user) {
        setSaveStage('pending_cloud');
        setSyncStatus('syncing');
        setAutosaveStatus('Pending cloud sync');
        try {
          console.info(`[Report Lifecycle] Operation=cloud_upload_start ID=${savedRecord.id} Revision=${savedRecord.revision}`);
          const cloudRes = await uploadReportToCloud(user.id, savedRecord);
          await clearDraftFromCloud(user.id);
          if (cloudRes.success) {
            setSaveStage('synced');
            setSyncStatus('synced');
            setAutosaveStatus('Synced');
            setLastSyncedAt(Date.now());
            console.info(`[Report Lifecycle] Operation=cloud_upload_success ID=${savedRecord.id}`);
          } else if (cloudRes.conflict) {
            setSaveStage('pending_cloud');
            setSyncStatus('error');
            console.warn(`[Report Lifecycle] Operation=cloud_upload_conflict ID=${savedRecord.id}`);
          } else {
            setSaveStage('pending_cloud');
            setSyncStatus('error');
            console.warn(`[Report Lifecycle] Operation=cloud_upload_pending ID=${savedRecord.id}: ${cloudRes.error}`);
          }
        } catch (cloudErr) {
          console.warn('[Report Lifecycle] Operation=cloud_upload_network_error', cloudErr);
          setSaveStage('pending_cloud');
          setSyncStatus('error');
        }
      }

      // 4. Navigate only after successful local save
      onReportSavedSuccessfully(reportPayload.id);
    } catch (err) {
      console.error(`[Report Lifecycle] Operation=save_report_failed ID=${targetId}:`, err);
      setSaveStage('failed');
      setAutosaveStatus('Save failed — your analysis is still open');
      setSaveReportError((err as Error).message || 'Save failed — your analysis is still open');
    } finally {
      setIsSavingReport(false);
      isSavingReportRef.current = false;
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
        title: data.title,
        session: data.session,
        timezone: data.timezone,
        analysisTiming: data.analysisTiming,
        timeframes: data.timeframes,
        crossedLiquidity: data.crossedLiquidity,
        majorLiquidityWatchlist: data.majorLiquidityWatchlist,
        supplyDemandLevels: data.supplyDemandLevels,
        scenarios: (data.scenarios || []).map((s) => ({
          ...s,
          id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        overallNotes: data.overallNotes,
        visibilityConfig: activeVisibility,
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
    const templatedScenarios = (template.data.scenarios || []).map((s, idx) => ({
      ...s,
      id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${idx}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    // Ensure all 8 timeframes exist
    const templatedTfs = JSON.parse(JSON.stringify(template.data.timeframes || {}));
    for (const tf of TIMEFRAME_ORDER) {
      if (!templatedTfs[tf]) {
        templatedTfs[tf] = createEmptyTimeframeData(tf);
      }
    }

    const newAnalysis: AnalysisData = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: template.data.title || '',
      pair: template.data.pair,
      date: dateStr,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      timezone: template.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      session: template.data.session,
      analysisTiming: template.data.analysisTiming,
      timeframes: templatedTfs,
      crossedLiquidity: [...(template.data.crossedLiquidity || [])],
      majorLiquidityWatchlist: template.data.majorLiquidityWatchlist || '',
      supplyDemandLevels: JSON.parse(JSON.stringify(template.data.supplyDemandLevels || [])),
      scenarios: templatedScenarios,
      trades: [],
      overallNotes: template.data.overallNotes || '',
      visibilityConfig: template.data.visibilityConfig || activeVisibility,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    updateAnalysis(() => newAnalysis);
    setIsLoadTemplateOpen(false);
  };

  // Clear Analysis
  const handleClearAnalysis = async () => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    const fresh = createInitialAnalysisData('XAUUSD', activeVisibility);
    setData(fresh);
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
            Continuous multi-timeframe SMC journal flow from Monthly to 1-Minute.
          </p>
        </div>

        {/* Autosave subtle status text & Cloud Sync Status */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-app-secondary">
          <SyncStatusBadge
            status={
              saveStage === 'saving_local'
                ? 'saving_local'
                : saveStage === 'failed'
                ? 'failed'
                : saveStage === 'pending_cloud'
                ? 'pending_cloud'
                : saveStage === 'saved_local'
                ? 'saved_local'
                : saveStage === 'synced'
                ? 'synced'
                : syncStatus
            }
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

      {/* Phase 2: Optional Report Title */}
      <div className="p-3.5 sm:p-4 rounded-lg bg-app-secondary border border-app mb-4 shadow-2xs">
        <label className="block text-xs font-bold text-app-main uppercase tracking-wider mb-1.5">
          Report Title
        </label>
        <input
          type="text"
          value={data.title || ''}
          onChange={(e) => updateAnalysis((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="Optional — name this analysis"
          className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors font-medium"
        />
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

          {/* Timing */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">Timing</label>
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

      {/* 3. Overall Alignment Status Card */}
      <div className="p-4 rounded-lg bg-app-secondary border border-app mb-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              alignment.status === 'ALIGNED'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                : alignment.status === 'WAITING'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {alignment.status === 'ALIGNED' ? (
              <CheckCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-app-secondary">
              Overall Alignment
            </div>
            <div className="text-base sm:text-lg font-extrabold text-app-main flex items-center gap-2">
              <span>{alignment.label}</span>
            </div>
            <p className="text-xs text-app-secondary mt-0.5">{alignment.detail}</p>
          </div>
        </div>

        {/* Enabled Timeframes quick-status dots */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {enabledTimeframes.map((tf) => {
            const b = data.timeframes[tf]?.overallBias;
            return (
              <span
                key={tf}
                title={`${tf}: ${b || 'Not selected'}`}
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

      {/* 4-11: Timeframe Sections in exact order (Monthly, Weekly, Daily, 4H, 1H, 15M, 5M, 1M) with bold ~3px separators */}
      <div className="space-y-3 mb-6">
        {enabledTimeframes.map((tf, idx) => {
          const visibleSd = (data.supplyDemandLevels || []).filter(
            (sd) => sd.timeframe === tf && sd.showInTimeframe
          );

          return (
            <React.Fragment key={tf}>
              {idx > 0 && (
                <div
                  className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-4 rounded-full"
                  role="separator"
                  aria-orientation="horizontal"
                />
              )}
              <TimeframeSection
                timeframe={tf}
                data={data.timeframes[tf] || createEmptyTimeframeData(tf)}
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
                visibilityConfig={activeVisibility}
              />
            </React.Fragment>
          );
        })}
      </div>

      {/* Major Liquidity (Checklist & Watchlist) */}
      {(activeVisibility.otherSections.majorLiquidityChecklist !== false ||
        activeVisibility.otherSections.majorLiquidityWatchlist !== false) && (
        <>
          <div
            className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-7 rounded-full"
            role="separator"
            aria-orientation="horizontal"
          />
          <MajorLiquiditySection
            selectedItems={data.crossedLiquidity || []}
            onToggleItem={handleToggleLiquidity}
            watchlist={data.majorLiquidityWatchlist || ''}
            onChangeWatchlist={(val) =>
              updateAnalysis((prev) => ({ ...prev, majorLiquidityWatchlist: val }))
            }
            showChecklist={activeVisibility.otherSections.majorLiquidityChecklist !== false}
            showWatchlist={activeVisibility.otherSections.majorLiquidityWatchlist !== false}
          />
        </>
      )}

      {/* Supply & Demand Levels (General Manager) */}
      {activeVisibility.otherSections.supplyDemandManager !== false && (
        <>
          <div
            className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-7 rounded-full"
            role="separator"
            aria-orientation="horizontal"
          />
          <SupplyDemandSection
            levels={data.supplyDemandLevels || []}
            onAddLevel={handleAddSDLevel}
            onUpdateLevel={handleUpdateSDLevel}
            onRemoveLevel={handleRemoveSDLevel}
            onToggleVisibility={handleToggleSDVisibility}
          />
        </>
      )}

      {/* Overall Notes */}
      {activeVisibility.otherSections.overallNotes !== false && (
        <>
          <div
            className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-7 rounded-full"
            role="separator"
            aria-orientation="horizontal"
          />
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
        </>
      )}

      {/* Planned Scenarios */}
      {activeVisibility.otherSections.plannedScenarios !== false && (
        <>
          <div
            className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-7 rounded-full"
            role="separator"
            aria-orientation="horizontal"
          />
          <PlannedScenariosSection
            scenarios={data.scenarios || []}
            onChange={(updatedScenarios) =>
              updateAnalysis((prev) => ({ ...prev, scenarios: updatedScenarios }))
            }
            onSaveScenario={handleSaveScenarioDirectly}
          />
        </>
      )}

      {/* Save report error indicator if any */}
      {(saveStage === 'failed' || saveReportError) && (
        <div className="p-3.5 mb-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <strong className="text-sm font-bold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                Save failed — your analysis is still open
              </strong>
              <p className="opacity-90">
                {saveReportError || 'Could not verify storage persistence on this device. All entered fields and data are preserved.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveReport}
                className="px-3 py-1.5 bg-rose-600 text-white font-semibold rounded text-xs hover:bg-rose-700 transition-colors cursor-pointer"
              >
                Retry Save
              </button>
              <button
                type="button"
                onClick={() => setIsBackupModalOpen(true)}
                className="px-3 py-1.5 bg-app-field border border-app text-app-main font-semibold rounded text-xs hover:bg-app-secondary transition-colors cursor-pointer"
              >
                Export Backup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons in normal page flow */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-app">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: Save Report */}
          <button
            type="button"
            onClick={handleSaveReport}
            disabled={isSavingReport}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            {saveStage === 'saving_local'
              ? 'Saving on this device…'
              : saveStage === 'saved_local'
              ? 'Saved on this device'
              : saveStage === 'pending_cloud'
              ? 'Pending cloud sync…'
              : isSavingReport
              ? 'Saving Report...'
              : isEditingExistingReport
              ? 'Update Report'
              : 'Save Report'}
          </button>

          {/* Continue Later: saves draft & returns Home */}
          <button
            type="button"
            onClick={handleContinueLater}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-medium bg-app-secondary border border-app text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-app-secondary" />
            Continue Later
          </button>
        </div>

        {/* Secondary: Templates & Clear Analysis */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSaveTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-app-main bg-app-secondary border border-app hover:bg-app-field rounded transition-colors cursor-pointer"
          >
            <Bookmark className="w-3.5 h-3.5 text-emerald-theme" />
            Save as Template
          </button>

          <button
            type="button"
            onClick={() => setIsLoadTemplateOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-app-main bg-app-secondary border border-app hover:bg-app-field rounded transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-app-secondary" />
            Load Template
          </button>

          {/* Clear Analysis */}
          {!showClearConfirm ? (
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded border border-transparent transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Analysis
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 text-xs p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 rounded">
              <span className="text-rose-700 dark:text-rose-300 text-xs">Clear all fields?</span>
              <button
                type="button"
                onClick={handleClearAnalysis}
                className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-semibold cursor-pointer"
              >
                Yes, Clear
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-2 py-1 text-app-secondary rounded text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <SaveTemplateModal
        isOpen={isSaveTemplateOpen}
        onClose={() => setIsSaveTemplateOpen(false)}
        onSave={handleSaveTemplate}
      />

      <LoadTemplateModal
        isOpen={isLoadTemplateOpen}
        onClose={() => setIsLoadTemplateOpen(false)}
        onSelectTemplate={handleLoadTemplate}
      />

      {activeViewerImage && (
        <ImageViewerModal
          isOpen={Boolean(activeViewerImage)}
          onClose={() => setActiveViewerImage(null)}
          imageUrl={activeViewerImage.url}
          title={activeViewerImage.title}
        />
      )}

      {/* Emergency Backup / Recovery Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        onDataChanged={() => {}}
      />
    </div>
  );
};
