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
  Plus,
  X,
  Check,
  RefreshCw,
  Edit2,
} from 'lucide-react';
import {
  AnalysisData,
  AnalysisTiming,
  DEFAULT_VISIBILITY_CONFIG,
  MajorLiquidityItem,
  OpeningCandleEntry,
  OpeningCandleSession,
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
  normalizeWorkspaceVisibilityConfig,
} from '../types/journal';
import {
  calculateOverallAlignment,
} from '../utils/analysisUtils';
import { exportTextOrDownload } from '../utils/nativeExport';
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
  getDraft,
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
  initialSessionUI?: {
    expandedTimeframes?: Record<TimeframeId, boolean>;
    unfinishedOc?: {
      isAdding: boolean;
      session: OpeningCandleSession;
      level: string;
      editingId: string | null;
      editSession: OpeningCandleSession;
      editLevel: string;
    };
    unfinishedSupplyDemand?: any;
    unfinishedTfLevels?: Record<string, any>;
    expandedScenarios?: Record<string, boolean>;
  };
  onSessionUIChange?: (ui: {
    expandedTimeframes: Record<TimeframeId, boolean>;
    unfinishedOc?: {
      isAdding: boolean;
      session: OpeningCandleSession;
      level: string;
      editingId: string | null;
      editSession: OpeningCandleSession;
      editLevel: string;
    };
    unfinishedSupplyDemand?: any;
    unfinishedTfLevels?: Record<string, any>;
    expandedScenarios?: Record<string, boolean>;
  }) => void;
  onAnalysisDataChange?: (data: AnalysisData) => void;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  initialData,
  isEditingExistingReport,
  onNavigateHome,
  onReportSavedSuccessfully,
  workspaceVisibility,
  initialSessionUI,
  onSessionUIChange,
  onAnalysisDataChange,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<AnalysisData>(initialData);
  const [expandedTimeframes, setExpandedTimeframes] = useState<Record<TimeframeId, boolean>>(() => {
    return (
      initialSessionUI?.expandedTimeframes || {
        Monthly: false,
        Weekly: false,
        Daily: false,
        '4H': false,
        '1H': false,
        '15M': false,
        '5M': false,
        '1M': false,
      }
    );
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
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [isNameReportModalOpen, setIsNameReportModalOpen] = useState(false);
  const [reportNameToSave, setReportNameToSave] = useState('');

  // Opening Candle state
  const [isAddingOc, setIsAddingOc] = useState(initialSessionUI?.unfinishedOc?.isAdding || false);
  const [newOcSession, setNewOcSession] = useState<OpeningCandleSession>(
    initialSessionUI?.unfinishedOc?.session || 'London'
  );
  const [newOcLevel, setNewOcLevel] = useState(initialSessionUI?.unfinishedOc?.level || '');
  const [editingOcId, setEditingOcId] = useState<string | null>(
    initialSessionUI?.unfinishedOc?.editingId || null
  );
  const [editOcSession, setEditOcSession] = useState<OpeningCandleSession>(
    initialSessionUI?.unfinishedOc?.editSession || 'London'
  );
  const [editOcLevel, setEditOcLevel] = useState(initialSessionUI?.unfinishedOc?.editLevel || '');
  const [confirmDeleteOcId, setConfirmDeleteOcId] = useState<string | null>(null);

  // Sub-section drafts state stored in refs to avoid triggering unnecessary re-renders of AnalysisView
  const unfinishedSupplyDemandRef = useRef(initialSessionUI?.unfinishedSupplyDemand || null);
  const unfinishedTfLevelsRef = useRef<Record<string, any>>(initialSessionUI?.unfinishedTfLevels || {});
  const expandedScenariosRef = useRef<Record<string, boolean>>(initialSessionUI?.expandedScenarios || {});

  // Stable ref for onSessionUIChange to prevent dependency loop
  const onSessionUIChangeRef = useRef(onSessionUIChange);
  useEffect(() => {
    onSessionUIChangeRef.current = onSessionUIChange;
  }, [onSessionUIChange]);

  const notifySessionUIChange = useCallback(() => {
    onSessionUIChangeRef.current?.({
      expandedTimeframes,
      unfinishedOc: {
        isAdding: isAddingOc,
        session: newOcSession,
        level: newOcLevel,
        editingId: editingOcId,
        editSession: editOcSession,
        editLevel: editOcLevel,
      },
      unfinishedSupplyDemand: unfinishedSupplyDemandRef.current,
      unfinishedTfLevels: unfinishedTfLevelsRef.current,
      expandedScenarios: expandedScenariosRef.current,
    });
  }, [
    expandedTimeframes,
    isAddingOc,
    newOcSession,
    newOcLevel,
    editingOcId,
    editOcSession,
    editOcLevel,
  ]);

  // Notify parent of UI session changes
  useEffect(() => {
    notifySessionUIChange();
  }, [notifySessionUIChange]);

  // Stable callbacks for child draft changes: updates refs and notifies session without re-rendering AnalysisView
  const handleLevelDraftChange = useCallback((tf: string, levelDraft: any) => {
    unfinishedTfLevelsRef.current = {
      ...unfinishedTfLevelsRef.current,
      [tf]: levelDraft,
    };
    notifySessionUIChange();
  }, [notifySessionUIChange]);

  const handleSupplyDemandDraftChange = useCallback((sdDraft: any) => {
    unfinishedSupplyDemandRef.current = sdDraft;
    notifySessionUIChange();
  }, [notifySessionUIChange]);

  const handleExpandedScenariosChange = useCallback((scnMap: Record<string, boolean>) => {
    expandedScenariosRef.current = scnMap;
    notifySessionUIChange();
  }, [notifySessionUIChange]);

  // Template confirmation state (Phase 3)
  const [templateToConfirm, setTemplateToConfirm] = useState<SavedTemplate | null>(null);

  // Synchronous reference to latest analysis data to prevent stale closures during saves
  const dataRef = useRef<AnalysisData>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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

  // Update data if initialData changes externally (e.g. from template or report loading)
  useEffect(() => {
    if (initialData && initialData !== dataRef.current) {
      setData(initialData);
      dataRef.current = initialData;
    }
  }, [initialData]);

  const lastAutosaveCallRef = useRef<number>(0);
  const activeUserIdRef = useRef<string | null>(user?.id || null);

  useEffect(() => {
    activeUserIdRef.current = user?.id || null;
  }, [user?.id]);

  // Clean up pending autosave timers on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

  // Debounced draft autosave with continuous typing bounded maxWait (3000ms)
  const triggerAutosave = useCallback((currentData: AnalysisData) => {
    if (isSavingReportRef.current) return;

    const initiatingUserId = user?.id || null;
    const now = Date.now();
    const timeSinceFirstKeystroke = lastAutosaveCallRef.current ? now - lastAutosaveCallRef.current : 0;
    const MAX_WAIT_MS = 3000;

    const executeSave = async () => {
      if (isSavingReportRef.current) return;
      lastAutosaveCallRef.current = 0;
      try {
        await saveDraft(currentData);
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setAutosaveStatus(`Draft autosaved at ${timeStr}`);

        // Cloud synchronization only if user is still logged into the SAME account and Auto-Sync is not disabled
        const isAutoSyncOff = typeof localStorage !== 'undefined' && localStorage.getItem('abmax_auto_sync_disabled') === 'true';

        if (initiatingUserId && activeUserIdRef.current === initiatingUserId && !isAutoSyncOff) {
          setSyncStatus('syncing');
          await uploadDraftToCloud(initiatingUserId, currentData);
          if (activeUserIdRef.current === initiatingUserId) {
            setSyncStatus('synced');
            setLastSyncedAt(Date.now());
          }
        } else {
          setSyncStatus('local');
        }
      } catch (err) {
        console.error('Autosave failed', err);
        setAutosaveStatus('Autosave failed (local storage full or blocked)');
        if (initiatingUserId) setSyncStatus('error');
      }
    };

    setAutosaveStatus('Saving changes...');

    // If typing continuously and maxWait has elapsed, flush immediately
    if (lastAutosaveCallRef.current > 0 && timeSinceFirstKeystroke >= MAX_WAIT_MS) {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
      executeSave();
      return;
    }

    if (!lastAutosaveCallRef.current) {
      lastAutosaveCallRef.current = now;
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(executeSave, 800);
  }, [user]);

  const updateAnalysis = (updater: (prev: AnalysisData) => AnalysisData) => {
    setData((prev) => {
      const next = updater(prev);
      dataRef.current = next;
      triggerAutosave(next);
      onAnalysisDataChange?.(next);
      return next;
    });
  };

  // Determine active visibility configuration
  const activeVisibility: WorkspaceVisibilityConfig =
    workspaceVisibility || data.visibilityConfig || DEFAULT_VISIBILITY_CONFIG;

  // Filter enabled timeframes based on visibility config
  const enabledTimeframes = TIMEFRAME_ORDER.filter(
    (tf) => activeVisibility.timeframes[tf] !== false
  );

  // Alignment Calculation using enabled timeframes
  const alignment = calculateOverallAlignment(data.timeframes, enabledTimeframes);

  // Timeframe expansion toggle
  // Keep the same timeframe header visible after collapse or save, preventing jump to scenarios or bottom
  const keepTimeframeHeaderVisible = (tf: TimeframeId) => {
    // Double requestAnimationFrame ensures React has committed the DOM update and the browser has recalculated the collapsed layout
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`section-${tf}`);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const navOffset = window.scrollY <= 80 ? 75 : 20;
        // If the header is outside the comfortable viewport window (scrolled above or pushed below)
        if (rect.top < 60 || rect.top > window.innerHeight - 100) {
          const targetY = window.scrollY + rect.top - navOffset;
          window.scrollTo({ top: Math.max(0, targetY), behavior: 'auto' });
        }
      });
    });
  };

  // Timeframe expansion toggle (preserves entered values and maintains header visibility on manual collapse)
  const toggleTimeframeExpand = (tf: TimeframeId) => {
    setExpandedTimeframes((prev) => {
      const willExpand = !prev[tf];
      if (!willExpand) {
        keepTimeframeHeaderVisible(tf);
      }
      return {
        ...prev,
        [tf]: willExpand,
      };
    });
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

  // Phase 1: Save deep analysis across any timeframe: immediately persists draft to IndexedDB, verifies read-back, automatically collapses editor, keeps header visible
  const handleSaveDeep = async (tf: TimeframeId): Promise<{ success: boolean; error?: string }> => {
    try {
      const currentLatest = dataRef.current || data;
      const currentTfData = currentLatest.timeframes[tf] || createEmptyTimeframeData(tf);
      const updatedData: AnalysisData = {
        ...currentLatest,
        timeframes: {
          ...currentLatest.timeframes,
          [tf]: {
            ...currentTfData,
            isSaved: true,
          },
        },
      };
      // Persist draft to IndexedDB immediately
      await saveDraft(updatedData);
      const verifiedDraft = await getDraft();
      if (!verifiedDraft) {
        throw new Error('Local draft verification failed after saving deep analysis.');
      }
      dataRef.current = updatedData;
      setData(updatedData);
      // Automatically collapse the editor
      setExpandedTimeframes((prev) => ({
        ...prev,
        [tf]: false,
      }));
      setAutosaveStatus(
        `Draft saved locally at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      );
      if (user) {
        uploadDraftToCloud(user.id, updatedData).catch((err) =>
          console.warn('Background cloud draft sync failed:', err)
        );
      }
      // Single layout-aware repositioning: keep that same timeframe's header comfortably visible below navigation. Never jump to scenarios or bottom of page.
      keepTimeframeHeaderVisible(tf);
      return { success: true };
    } catch (err) {
      console.error(`Failed to save deep analysis for timeframe ${tf}:`, err);
      const msg = (err as Error).message || 'Failed to persist deep analysis to local storage.';
      return { success: false, error: msg };
    }
  };

  // Phase 1: Edit deep analysis (unlocks fields, expands timeframe, keeps user at that timeframe)
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
    keepTimeframeHeaderVisible(tf);
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

  // Opening Candle Handlers (Phase 3)
  const handleStartAddOc = () => {
    setIsAddingOc(true);
    setNewOcSession('London');
    setNewOcLevel('');
    setEditingOcId(null);
    setConfirmDeleteOcId(null);
  };

  const handleCancelAddOc = () => {
    setIsAddingOc(false);
    setNewOcSession('London');
    setNewOcLevel('');
  };

  const handleSaveNewOc = () => {
    if (!newOcLevel.trim()) {
      handleCancelAddOc();
      return;
    }
    const newEntry: OpeningCandleEntry = {
      id: `oc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      session: newOcSession,
      level: newOcLevel, // preserves exact price string including trailing zeros
    };
    updateAnalysis((prev) => ({
      ...prev,
      openingCandles: [...(prev.openingCandles || []), newEntry],
    }));
    setIsAddingOc(false);
    setNewOcSession('London');
    setNewOcLevel('');
  };

  const handleStartEditOc = (entry: OpeningCandleEntry) => {
    setEditingOcId(entry.id);
    setEditOcSession(entry.session);
    setEditOcLevel(entry.level);
    setIsAddingOc(false);
    setConfirmDeleteOcId(null);
  };

  const handleCancelEditOc = () => {
    setEditingOcId(null);
    setEditOcLevel('');
  };

  const handleSaveEditOc = (id: string) => {
    updateAnalysis((prev) => ({
      ...prev,
      openingCandles: (prev.openingCandles || []).map((entry) =>
        entry.id === id ? { ...entry, session: editOcSession, level: editOcLevel } : entry
      ),
    }));
    setEditingOcId(null);
    setEditOcLevel('');
  };

  const handleConfirmRemoveOc = (id: string) => {
    updateAnalysis((prev) => ({
      ...prev,
      openingCandles: (prev.openingCandles || []).filter((entry) => entry.id !== id),
    }));
    setConfirmDeleteOcId(null);
  };


  // In-memory recovery backup export when save fails (Phase 2)
  const handleExportInMemoryBackup = async () => {
    try {
      const currentLatest = dataRef.current || data;
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        app: 'ABMAX_ANALYSIS' as const,
        recoveredAnalysis: currentLatest,
        note: 'In-memory recovery snapshot exported due to local storage save interruption.',
      };
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `abmax_recovery_${currentLatest.pair || 'analysis'}_${new Date().toISOString().slice(0, 10)}.json`;
      await exportTextOrDownload(jsonStr, filename, 'application/json');
    } catch (e) {
      console.error('Failed to export in-memory recovery backup', e);
    }
  };

  // Save Scenario directly (persists to draft if new, or to report if editing)
  const handleSaveScenarioDirectly = async () => {
    const currentLatest = dataRef.current || data;
    if (isEditingExistingReport) {
      const now = Date.now();
      const updatedReport: SavedReport = {
        ...currentLatest,
        updatedAt: now,
        status: 'Modified',
        isModified: true,
      };
      await saveReport(updatedReport);
      if (user) {
        uploadReportToCloud(user.id, updatedReport).catch(console.error);
      }
    } else {
      await saveDraft(currentLatest);
      if (user) {
        uploadDraftToCloud(user.id, currentLatest).catch(console.error);
      }
    }
  };

  // Execute Save Report with specified or existing title (Phase 2 & Phase 3)
  const executeSaveReport = async (overrideTitle?: string) => {
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
    const latestData = dataRef.current || data;

    // Determine genuine stable report ID: never leak active_draft, and lock to existing report ID when editing
    const targetId = (isEditingExistingReport && initialData?.id && initialData.id !== 'active_draft' && initialData.id !== 'draft')
      ? initialData.id
      : (latestData.id && latestData.id !== 'active_draft' && latestData.id !== 'draft'
          ? latestData.id
          : (latestData.originalId && latestData.originalId !== 'active_draft' && latestData.originalId !== 'draft'
              ? latestData.originalId
              : `rep_${now}_${Math.random().toString(36).substring(2, 9)}`));

    // Clean title: use overrideTitle if provided, else latestData.title
    const effectiveTitle = overrideTitle !== undefined ? overrideTitle : (latestData.title || '');
    const cleanTitle = effectiveTitle.trim();

    // Ensure all timeframes exist and have full structure
    const cleanTimeframes = { ...latestData.timeframes };
    for (const tf of TIMEFRAME_ORDER) {
      if (!cleanTimeframes[tf]) {
        cleanTimeframes[tf] = createEmptyTimeframeData(tf);
      }
    }

    // Preserve existing OC entries and capture unfinished non-empty inputs
    let finalOpeningCandles = [...(latestData.openingCandles || [])];
    if (isAddingOc && newOcLevel.trim()) {
      finalOpeningCandles.push({
        id: `oc_${now}_${Math.random().toString(36).substring(2, 7)}`,
        session: newOcSession,
        level: newOcLevel.trim(),
      });
    } else if (editingOcId && editOcLevel.trim()) {
      finalOpeningCandles = finalOpeningCandles.map((entry) =>
        entry.id === editingOcId ? { ...entry, session: editOcSession, level: editOcLevel.trim() } : entry
      );
    }

    const reportPayload: SavedReport = {
      ...latestData,
      id: targetId,
      title: cleanTitle || undefined,
      pair: latestData.pair || 'XAUUSD',
      date: latestData.date || new Date().toISOString().slice(0, 10),
      time: latestData.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      session: latestData.session || 'London',
      analysisTiming: latestData.analysisTiming || 'On time',
      timeframes: cleanTimeframes,
      crossedLiquidity: latestData.crossedLiquidity || [],
      majorLiquidityWatchlist: latestData.majorLiquidityWatchlist || '',
      supplyDemandLevels: latestData.supplyDemandLevels || [],
      openingCandles: finalOpeningCandles,
      scenarios: latestData.scenarios || [],
      trades: latestData.trades || [],
      overallNotes: latestData.overallNotes || '',
      visibilityConfig: activeVisibility,
      updatedAt: now,
      createdAt: isEditingExistingReport && (initialData.createdAt || latestData.createdAt) ? (initialData.createdAt || latestData.createdAt) : (latestData.createdAt || now),
      status: isEditingExistingReport ? 'Modified' : 'Original',
      isModified: isEditingExistingReport,
      copiedFromId: latestData.copiedFromId || (initialData as any)?.copiedFromId || undefined,
    };

    console.info(`[Report Lifecycle] Operation=save_report ID=${targetId} IsEditing=${isEditingExistingReport} TargetRev=${(latestData.revision || 0) + 1}`);

    try {
      // 1. SAVE LOCALLY FIRST via IndexedDB and verify read-back
      const savedRecord = await saveReport(reportPayload);
      console.info(`[Report Lifecycle] Operation=save_report_success ID=${savedRecord.id} Revision=${savedRecord.revision} TxResult=COMMITTED`);
      setSaveStage('saved_local');
      setAutosaveStatus('Saved on this device');

      // 2. Clear active draft locally after successful local save
      await clearDraft();

      // Update in-memory state with finalized report ID and revision
      dataRef.current = {
        ...latestData,
        ...savedRecord,
      };
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

  // Primary Save Report button click (prompts name dialog if title is blank)
  const handleSaveReport = () => {
    if (isSavingReportRef.current) return;
    const latestData = dataRef.current || data;
    const currentTitle = (latestData.title || '').trim();
    if (currentTitle.length > 0) {
      executeSaveReport(currentTitle);
    } else {
      setReportNameToSave('');
      setIsNameReportModalOpen(true);
    }
  };

  // Continue Later (saves full draft and returns Home)
  const handleContinueLater = async () => {
    try {
      const latestData = dataRef.current || data;
      await saveDraft(latestData);
      if (user) {
        await uploadDraftToCloud(user.id, latestData);
      }
      onNavigateHome();
    } catch (err) {
      console.error('Failed to save draft for later', err);
    }
  };

  // Save Template (Phase 3: includes timeframes, OC levels, notes, scenarios; excludes executed trades)
  const handleSaveTemplate = async (templateName: string) => {
    const latest = dataRef.current || data;
    const tmplId = `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const tmpl: SavedTemplate = {
      id: tmplId,
      name: templateName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        pair: latest.pair,
        title: latest.title,
        session: latest.session,
        timezone: latest.timezone,
        analysisTiming: latest.analysisTiming,
        timeframes: JSON.parse(JSON.stringify(latest.timeframes || {})),
        crossedLiquidity: [...(latest.crossedLiquidity || [])],
        majorLiquidityWatchlist: latest.majorLiquidityWatchlist || '',
        supplyDemandLevels: JSON.parse(JSON.stringify(latest.supplyDemandLevels || [])),
        openingCandles: JSON.parse(JSON.stringify(latest.openingCandles || [])),
        scenarios: (latest.scenarios || []).map((s) => ({
          ...s,
          id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        overallNotes: latest.overallNotes || '',
        visibilityConfig: activeVisibility,
      },
    };
    await saveTemplate(tmpl);
    if (user) {
      uploadTemplateToCloud(user.id, tmpl).catch((cloudErr) => {
        console.warn('[Template Cloud Sync] Failed to upload template to cloud, saved locally:', cloudErr);
      });
    }
  };

  // Helper: check if current workspace has unfinished work before replacing with template
  const hasUnfinishedWork = (d: AnalysisData): boolean => {
    if ((d.title || '').trim().length > 0) return true;
    if ((d.overallNotes || '').trim().length > 0) return true;
    if ((d.majorLiquidityWatchlist || '').trim().length > 0) return true;
    if ((d.openingCandles || []).length > 0) return true;
    if ((d.scenarios || []).length > 0) return true;
    if ((d.trades || []).length > 0) return true;
    if ((d.supplyDemandLevels || []).length > 0) return true;
    for (const tf of TIMEFRAME_ORDER) {
      const tfd = d.timeframes?.[tf];
      if (!tfd) continue;
      if (tfd.overallBias || (tfd.biasSpecific || '').trim().length > 0 || tfd.chartImageId) return true;
      if (tfd.swing?.high || tfd.swing?.low || tfd.internal?.high || tfd.internal?.low) return true;
      if ((tfd.supplyLevels || []).length > 0 || (tfd.demandLevels || []).length > 0) return true;
    }
    return false;
  };

  // Apply template: creates fresh analysis with new ID and today's date, saves draft immediately
  const applyTemplate = async (template: SavedTemplate) => {
    if (!template || !template.data) {
      setAutosaveStatus('Cannot load template: missing template data.');
      setTemplateToConfirm(null);
      setIsLoadTemplateOpen(false);
      return;
    }

    try {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const templatedScenarios = (template.data.scenarios || []).map((s, idx) => ({
        ...s,
        id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}_${idx}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      // Ensure all 8 timeframes exist with safe defaults
      const rawTfs = template.data.timeframes || {};
      const templatedTfs = {} as Record<TimeframeId, any>;
      for (const tf of TIMEFRAME_ORDER) {
        if (rawTfs[tf]) {
          templatedTfs[tf] = {
            ...createEmptyTimeframeData(tf),
            ...JSON.parse(JSON.stringify(rawTfs[tf])),
          };
        } else {
          templatedTfs[tf] = createEmptyTimeframeData(tf);
        }
      }

      const normalizedVis = normalizeWorkspaceVisibilityConfig(
        template.data.visibilityConfig || activeVisibility
      );

      const newAnalysis: AnalysisData = {
        id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title: template.data.title || '',
        pair: template.data.pair || 'XAUUSD',
        date: dateStr,
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        timezone: template.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        session: template.data.session || 'London',
        analysisTiming: template.data.analysisTiming || 'On time',
        timeframes: templatedTfs,
        crossedLiquidity: [...(template.data.crossedLiquidity || [])],
        majorLiquidityWatchlist: template.data.majorLiquidityWatchlist || '',
        supplyDemandLevels: JSON.parse(JSON.stringify(template.data.supplyDemandLevels || [])),
        openingCandles: template.data.openingCandles
          ? JSON.parse(JSON.stringify(template.data.openingCandles))
          : [],
        scenarios: templatedScenarios,
        trades: [], // Executed trades are always excluded from templates
        overallNotes: template.data.overallNotes || '',
        visibilityConfig: normalizedVis,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      dataRef.current = newAnalysis;
      setData(newAnalysis);
      await saveDraft(newAnalysis);
      setAutosaveStatus(`Template loaded as fresh analysis at ${newAnalysis.time}`);
      if (user) {
        uploadDraftToCloud(user.id, newAnalysis).catch((err) =>
          console.warn('Background cloud draft sync failed on template load:', err)
        );
      }
    } catch (err) {
      console.error('[AnalysisView] Failed to apply template:', err);
      setAutosaveStatus('Failed to apply template: template format unsupported.');
    } finally {
      setTemplateToConfirm(null);
      setIsLoadTemplateOpen(false);
    }
  };

  // Load Template (warns if unfinished analysis exists, else loads directly)
  const handleLoadTemplate = (template: SavedTemplate) => {
    setIsLoadTemplateOpen(false);
    const currentLatest = dataRef.current || data;
    if (hasUnfinishedWork(currentLatest)) {
      setTemplateToConfirm(template);
    } else {
      applyTemplate(template);
    }
  };

  // Clear Analysis
  const handleClearAnalysis = async () => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }
    const fresh = createInitialAnalysisData('XAUUSD', activeVisibility);
    dataRef.current = fresh;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-app">
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

        {/* Actionable error status only (informational "Saved on this device | Ready" status row removed) */}
        {(saveStage === 'failed' || syncStatus === 'error') && (
          <div className="flex items-center gap-2 text-xs">
            <SyncStatusBadge
              status="failed"
              lastSyncedAt={lastSyncedAt}
              onRetry={() => triggerAutosave(data)}
            />
          </div>
        )}
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
                key={tf}
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
                initialLevelDraft={unfinishedTfLevelsRef.current[tf]}
                onLevelDraftChange={(levelDraft) => handleLevelDraftChange(tf, levelDraft)}
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
            initialDraft={unfinishedSupplyDemandRef.current}
            onDraftChange={handleSupplyDemandDraftChange}
          />
        </>
      )}

      {/* Opening Candle (OC) Section - Immediately ABOVE Overall Notes */}
      {activeVisibility.otherSections.openingCandle !== false && (
        <>
          <div
            className="border-t-[3px] border-slate-300 dark:border-slate-700/80 my-7 rounded-full"
            role="separator"
            aria-orientation="horizontal"
          />
          <div className="border border-app rounded-lg bg-app-main p-4 sm:p-5 mb-6 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-xs font-bold text-app-main uppercase tracking-wider">
                  Opening Candle (OC)
                </h3>
                <p className="text-[11px] text-app-secondary mt-0.5">
                  Record session and timeframe opening levels for bias and confluence.
                </p>
              </div>
              {!isAddingOc && (
                <button
                  type="button"
                  onClick={handleStartAddOc}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-theme bg-emerald-pale hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add OC Level
                </button>
              )}
            </div>

            {/* List of compact saved OC boxes */}
            {(!data.openingCandles || data.openingCandles.length === 0) && !isAddingOc ? (
              <p className="text-xs text-app-secondary italic py-2">
                No opening candle levels recorded. Click &quot;Add OC Level&quot; to add a session or timeframe opening price.
              </p>
            ) : (
              <div className="space-y-2 mt-2">
                {(data.openingCandles || []).map((entry, idx) => {
                  const entryId = entry.id || `oc_fallback_${idx}`;
                  const isEditing = editingOcId === entryId;
                  const isDeleting = confirmDeleteOcId === entryId;

                  if (isEditing) {
                    // Inline editor for editing existing entry
                    return (
                      <div
                        key={entryId}
                        className="p-3 rounded bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-500/40 space-y-2"
                      >
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <div className="w-full sm:w-48 shrink-0">
                            <label className="block text-[10px] uppercase font-bold text-app-secondary mb-1">
                              Opening Period / Session
                            </label>
                            <select
                              value={editOcSession}
                              onChange={(e) => setEditOcSession(e.target.value as OpeningCandleSession)}
                              className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors cursor-pointer"
                            >
                              <option value="Yearly">Yearly</option>
                              <option value="Quarterly">Quarterly</option>
                              <option value="Monthly">Monthly</option>
                              <option value="Weekly">Weekly</option>
                              <option value="London">London</option>
                              <option value="New York">New York</option>
                              <option value="Asia">Asia</option>
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="block text-[10px] uppercase font-bold text-app-secondary mb-1">
                              Opening Level (exact)
                            </label>
                            <input
                              type="text"
                              value={editOcLevel}
                              onChange={(e) => setEditOcLevel(e.target.value)}
                              placeholder="Enter opening price (e.g. 5500.25)"
                              className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors"
                              autoFocus
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleSaveEditOc(entryId)}
                            className="px-3 py-1 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors cursor-pointer"
                          >
                            Save Changes
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditOc}
                            className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Compact Saved Box for OC (e.g. London — 5500)
                  const isLevelMissing = !entry.level || !entry.level.trim();

                  return (
                    <div
                      key={entryId}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2.5 rounded bg-app-secondary/50 border border-app hover:border-app-secondary transition-colors"
                    >
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-semibold text-xs px-2.5 py-0.5 rounded bg-emerald-pale text-bullish border border-emerald-500/30 font-sans">
                          {entry.session}
                        </span>
                        <span className="text-app-secondary text-xs">—</span>
                        {!isLevelMissing ? (
                          <span className="font-mono font-bold text-sm text-app-main tabular-nums bg-app-main px-2.5 py-0.5 rounded border border-app/60">
                            {entry.level}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-300">
                            Incomplete: no level
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                        {!isDeleting ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleStartEditOc(entry)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                              title="Edit OC entry"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span className="text-xs">Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteOcId(entryId)}
                              className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors cursor-pointer"
                              title="Remove OC entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 p-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded text-xs">
                            <span className="text-rose-700 dark:text-rose-300 text-xs">Delete {entry.session} OC?</span>
                            <button
                              type="button"
                              onClick={() => handleConfirmRemoveOc(entryId)}
                              className="px-2 py-0.5 bg-rose-600 text-white rounded text-xs font-bold cursor-pointer"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteOcId(null)}
                              className="px-1.5 py-0.5 text-app-secondary hover:text-app-main text-xs cursor-pointer"
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

            {/* Inline Add Editor for new OC Level */}
            {isAddingOc && (
              <div className="mt-2 p-3 rounded bg-emerald-50/30 dark:bg-emerald-950/20 border border-emerald-500/40 space-y-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="w-full sm:w-48 shrink-0">
                    <label className="block text-[10px] uppercase font-bold text-app-secondary mb-1">
                      Opening Period / Session
                    </label>
                    <select
                      value={newOcSession}
                      onChange={(e) => setNewOcSession(e.target.value as OpeningCandleSession)}
                      className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors cursor-pointer"
                    >
                      <option value="Yearly">Yearly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Weekly">Weekly</option>
                      <option value="London">London</option>
                      <option value="New York">New York</option>
                      <option value="Asia">Asia</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase font-bold text-app-secondary mb-1">
                      Opening Level (exact)
                    </label>
                    <input
                      type="text"
                      value={newOcLevel}
                      onChange={(e) => setNewOcLevel(e.target.value)}
                      placeholder="Enter opening price (e.g. 5500.25)"
                      className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveNewOc}
                    className="px-3 py-1 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelAddOc}
                    className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
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
            initialExpandedMap={expandedScenariosRef.current}
            onExpandedMapChange={handleExpandedScenariosChange}
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
                onClick={handleExportInMemoryBackup}
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

      {/* Confirmation modal before replacing unfinished analysis when loading a template */}
      {templateToConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="replace-unfinished-analysis-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl p-5 space-y-4">
            <h3 id="replace-unfinished-analysis-title" className="text-base font-bold text-app-main">
              Replace Unfinished Analysis?
            </h3>
            <p className="text-xs text-app-secondary leading-relaxed">
              You have an active unfinished analysis in your workspace. Loading template{' '}
              <strong className="text-app-main">&ldquo;{templateToConfirm.name}&rdquo;</strong> will replace your
              current unsaved inputs with the template setup.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
              <button
                type="button"
                onClick={() => setTemplateToConfirm(null)}
                className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applyTemplate(templateToConfirm)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors cursor-pointer"
              >
                Yes, Replace &amp; Load
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Phase 3: Name this report dialog (when title is blank) */}
      {isNameReportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="name-report-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-app pb-3">
              <h3 id="name-report-title" className="text-base font-bold text-app-main">
                Name this report
              </h3>
              <button
                type="button"
                onClick={() => setIsNameReportModalOpen(false)}
                aria-label="Close dialog"
                className="p-1 text-app-secondary hover:text-app-main rounded transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label htmlFor="report-name-input" className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1.5">
                Report name
              </label>
              <input
                id="report-name-input"
                type="text"
                autoFocus
                value={reportNameToSave}
                onChange={(e) => setReportNameToSave(e.target.value)}
                placeholder="Optional — enter a name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const name = reportNameToSave.trim();
                    setIsNameReportModalOpen(false);
                    executeSaveReport(name);
                  }
                }}
                className="w-full px-3 py-2 text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main transition-colors"
              />
              <p className="text-[11px] text-app-secondary mt-1.5 leading-relaxed">
                If left blank, your report will be saved using the standard automated convention ({data.pair || 'XAUUSD'} — {data.date || new Date().toISOString().slice(0, 10)}).
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-app">
              <button
                type="button"
                onClick={() => setIsNameReportModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-medium text-app-secondary hover:bg-app-field rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNameReportModalOpen(false);
                  executeSaveReport('');
                }}
                disabled={isSavingReport}
                className="px-3.5 py-1.5 text-xs font-medium text-app-main bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 border border-app rounded transition-colors cursor-pointer"
              >
                Save Without Name
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = reportNameToSave.trim();
                  setIsNameReportModalOpen(false);
                  executeSaveReport(name);
                }}
                disabled={isSavingReport}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                Save Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
