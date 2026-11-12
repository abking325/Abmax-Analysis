import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  X,
  Edit,
  Copy,
  Trash2,
  Download,
  ArrowLeft,
  Loader2,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  Share2,
  LayoutGrid,
  Check,
  CheckCircle,
  Plus,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import {
  DEFAULT_REPORT_PRESENTATION,
  DEFAULT_REPORT_VISIBILITY,
  PlannedScenario,
  RecordedTrade,
  ReportPresentationConfig,
  ReportVisibilityConfig,
  SavedReport,
  TIMEFRAME_ORDER,
  TimeframeId,
} from '../types/journal';
import {
  getUserReportPresentationConfig,
  saveUserReportPresentationConfig,
} from '../services/db';
import {
  calculateOverallAlignment,
  findMatchingValues,
  formatReadableAnalysisDate,
  getTimeframeStructureAlignment,
  getTimeframePairAlignments,
} from '../utils/analysisUtils';
import { getChartImageUrl } from '../services/cloudSync';
import { useAuth } from '../context/AuthContext';
import { ImageViewerModal } from './ImageViewerModal';
import { OrganizedReportView } from './OrganizedReportView';
import { downloadReportPdf, PdfExportStyle } from '../services/pdfExport';
import { EditScenariosModal } from './EditScenariosModal';
import { TakeTradeModal } from './TakeTradeModal';
import { ShareReportModal } from './ShareReportModal';
import { PdfStyleChooserModal } from './PdfStyleChooserModal';

interface ReportDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onViewModeChange?: (mode: 'standard' | 'organized') => void;
  report: SavedReport | null;
  onModify: (report: SavedReport) => void;
  onCopy: (report: SavedReport) => void;
  onDelete: (id: string) => void;
  onUpdateReport?: (updated: SavedReport) => Promise<void>;
  initialTradeDraft?: any;
  onTradeDraftChange?: (draft: any) => void;
}

export const ReportDetailsModal: React.FC<ReportDetailsModalProps> = ({
  isOpen,
  onClose,
  onViewModeChange,
  report,
  onModify,
  onCopy,
  onDelete,
  onUpdateReport,
  initialTradeDraft,
  onTradeDraftChange,
}) => {
  const { user } = useAuth();
  // View mode: 'standard' (Normal report details) is the default; 'organized' for sheet layout
  const [viewMode, setViewMode] = useState<'standard' | 'organized'>('standard');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [isPdfChooserOpen, setIsPdfChooserOpen] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [imagesMap, setImagesMap] = useState<Record<string, string>>({});
  const [expandedImages, setExpandedImages] = useState<Record<TimeframeId, boolean>>({
    Monthly: false,
    Weekly: false,
    Daily: false,
    '4H': false,
    '1H': false,
    '15M': false,
    '5M': false,
    '1M': false,
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );
  const [isTakeTradeOpen, setIsTakeTradeOpen] = useState(Boolean(initialTradeDraft?.isOpen));
  const [scenarioTradeDraft, setScenarioTradeDraft] = useState<any>(null);
  const [editingTrade, setEditingTrade] = useState<RecordedTrade | null>(null);
  const [deleteTradeConfirmId, setDeleteTradeConfirmId] = useState<string | null>(null);
  const [invalidatingScenarioId, setInvalidatingScenarioId] = useState<string | null>(null);
  const [isEditScenariosOpen, setIsEditScenariosOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const modalContainerRef = useRef<HTMLDivElement>(null);
  const bodyContainerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const normalScrollTopRef = useRef<number>(0);

  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const handleDeleteTrade = async (tradeId: string) => {
    if (!onUpdateReport || !report) return;
    const currentTrades = report.trades || [];
    const updatedTrades = currentTrades.filter((t) => t.id !== tradeId);
    const updatedReport: SavedReport = {
      ...report,
      trades: updatedTrades,
      updatedAt: Date.now(),
    };
    await onUpdateReport(updatedReport);
    setDeleteTradeConfirmId(null);
  };

  const handleToggleScenarioInvalid = async (sc: PlannedScenario) => {
    if (!report || !onUpdateReport) return;
    const targetId = sc.id;
    const isCurrentlyInvalid = Boolean(sc.isInvalid || sc.status === 'Invalid');
    const updatedScenarios = (report.scenarios || []).map((s) => {
      if (s.id !== targetId) return s;
      return {
        ...s,
        isInvalid: !isCurrentlyInvalid,
        status: (!isCurrentlyInvalid ? 'Invalid' : 'Active') as 'Active' | 'Invalid',
        updatedAt: Date.now(),
      };
    });

    const updatedReport: SavedReport = {
      ...report,
      scenarios: updatedScenarios,
      updatedAt: Date.now(),
    };

    await onUpdateReport(updatedReport);
    setInvalidatingScenarioId(null);
  };

  const handleTakeTradeForScenario = (sc: PlannedScenario) => {
    if (!report || sc.isInvalid) return;
    setScenarioTradeDraft({
      selectedScenarioId: sc.id,
      direction: (sc.direction === 'Buy' || sc.direction === 'Sell') ? sc.direction : 'Buy',
      session: (report.session as any) || 'London',
      timeframeTaken: '5M',
      entryPrice: '',
      stopLoss: '',
      takeProfit: '',
      exitPrice: '',
      riskReward: '',
      outcome: 'Open',
      rulesFollowed: true,
      notes: `Trade executed on ${sc.label || 'Scenario'}: ${sc.description || ''}`,
      tradeDate: report.date || new Date().toISOString().slice(0, 10),
      tradeTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
    setEditingTrade(null);
    setIsTakeTradeOpen(true);
  };

  const [presentationConfig, setPresentationConfig] = useState<ReportPresentationConfig>(DEFAULT_REPORT_PRESENTATION);
  const [overrideShowAll, setOverrideShowAll] = useState(false);

  const onViewModeChangeRef = useRef(onViewModeChange);
  useEffect(() => {
    onViewModeChangeRef.current = onViewModeChange;
  }, [onViewModeChange]);

  // Load presentation config and ensure Normal details view is default
  useEffect(() => {
    if (isOpen) {
      getUserReportPresentationConfig().then((cfg) => {
        setPresentationConfig(cfg);
      });
      setViewMode('standard');
      onViewModeChangeRef.current?.('standard');
      setOverrideShowAll(false);
      setPdfError(null);
      setScenarioTradeDraft(null);
      setInvalidatingScenarioId(null);
    } else {
      setPdfError(null);
    }
  }, [isOpen]);

  const secVis: ReportVisibilityConfig = overrideShowAll
    ? DEFAULT_REPORT_VISIBILITY
    : (presentationConfig?.sectionVisibility || DEFAULT_REPORT_VISIBILITY);

  const hasHiddenSections = useMemo(() => {
    if (overrideShowAll) return false;
    const v = presentationConfig?.sectionVisibility;
    if (!v) return false;
    const checkGroup = (grp?: Record<string, any>) => Object.values(grp || {}).some((x) => x === false);
    const checkPerTf = (ptf?: Record<string, any>) =>
      Object.values(ptf || {}).some((tfFields) => checkGroup(tfFields));
    return (
      checkGroup(v.general) ||
      checkGroup(v.timeframes) ||
      checkGroup(v.timeframeFields) ||
      checkPerTf(v.perTimeframeFields) ||
      checkGroup(v.notesAndLevels) ||
      checkGroup(v.scenariosAndTrades)
    );
  }, [presentationConfig?.sectionVisibility, overrideShowAll]);

  const handleDownloadPdf = async (style: PdfExportStyle = 'minimal') => {
    if (!report || exportingPdf) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      await downloadReportPdf({ report, imagesMap, style, userId: user?.id });
    } catch (err) {
      console.error('[ReportDetailsModal] PDF download failed:', err);
      setPdfError((err as Error).message || 'Failed to generate PDF');
      throw err;
    } finally {
      setExportingPdf(false);
    }
  };

  // Pre-load all available timeframe chart screenshots for fast preview
  useEffect(() => {
    if (!report || !isOpen) return;
    let isCancelled = false;

    const loadImages = async () => {
      const map: Record<string, string> = {};
      const loadPromises = TIMEFRAME_ORDER.map(async (tf) => {
        const tfData = report.timeframes[tf];
        if (tfData?.chartImageId) {
          try {
            const url = await getChartImageUrl(user?.id || null, tfData.chartImageId);
            if (url) {
              map[tf] = url;
            }
          } catch (e) {
            console.error(`Failed to load image for ${tf}:`, e);
          }
        }
      });

      await Promise.all(loadPromises);
      if (!isCancelled) {
        setImagesMap(map);
      }
    };

    loadImages();
    return () => {
      isCancelled = true;
    };
  }, [report, isOpen, user?.id]);

  const handleSaveTrade = async (trade: RecordedTrade) => {
    if (!onUpdateReport || !report) return;
    const currentTrades = report.trades || [];
    const exists = currentTrades.some((t) => t.id === trade.id);
    let updatedTrades: RecordedTrade[];

    if (exists) {
      updatedTrades = currentTrades.map((t) => (t.id === trade.id ? trade : t));
    } else {
      updatedTrades = [trade, ...currentTrades];
    }

    const updatedReport: SavedReport = {
      ...report,
      trades: updatedTrades,
      updatedAt: Date.now(),
    };

    await onUpdateReport(updatedReport);
    setIsTakeTradeOpen(false);
    setEditingTrade(null);
    setScenarioTradeDraft(null);
    onTradeDraftChange?.(null);
  };

  // Topmost child dialog closer for hardware / browser back stack
  const closeTopmostChild = useCallback(() => {
    if (activeViewerImage) {
      setActiveViewerImage(null);
      return true;
    }
    if (showDeleteConfirm) {
      setShowDeleteConfirm(false);
      return true;
    }
    if (deleteTradeConfirmId) {
      setDeleteTradeConfirmId(null);
      return true;
    }
    if (invalidatingScenarioId) {
      setInvalidatingScenarioId(null);
      return true;
    }
    if (editingTrade) {
      setEditingTrade(null);
      return true;
    }
    if (isTakeTradeOpen) {
      setIsTakeTradeOpen(false);
      setScenarioTradeDraft(null);
      onTradeDraftChange?.(null);
      return true;
    }
    if (isEditScenariosOpen) {
      setIsEditScenariosOpen(false);
      return true;
    }
    if (isShareModalOpen) {
      setIsShareModalOpen(false);
      return true;
    }
    return false;
  }, [
    activeViewerImage,
    showDeleteConfirm,
    deleteTradeConfirmId,
    invalidatingScenarioId,
    editingTrade,
    isTakeTradeOpen,
    isEditScenariosOpen,
    isShareModalOpen,
    onTradeDraftChange,
  ]);

  const closeTopmostChildRef = useRef(closeTopmostChild);
  useEffect(() => {
    closeTopmostChildRef.current = closeTopmostChild;
  }, [closeTopmostChild]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const historyPushedRef = useRef(false);
  const lastBackActionTimeRef = useRef(0);
  const isClosingRef = useRef(false);

  // Transition: Switch to Organized view (records scroll of Normal details)
  const handleViewOrganized = () => {
    if (bodyContainerRef.current) {
      normalScrollTopRef.current = bodyContainerRef.current.scrollTop;
    }
    setViewMode('organized');
    onViewModeChangeRef.current?.('organized');
    // Scroll to top of organized view
    setTimeout(() => {
      if (bodyContainerRef.current) {
        bodyContainerRef.current.scrollTop = 0;
      }
    }, 10);
  };

  // Transition: Return from Organized view back to Normal details (restores scroll)
  const handleBackToDetails = () => {
    setViewMode('standard');
    onViewModeChangeRef.current?.('standard');
    setTimeout(() => {
      if (bodyContainerRef.current && normalScrollTopRef.current > 0) {
        bodyContainerRef.current.scrollTop = normalScrollTopRef.current;
      }
    }, 10);
  };

  // Coordinated back action matching the deterministic phone Back behavior:
  // 1. If child dialog is open -> close topmost child dialog
  // 2. Otherwise, if Organized view is open -> return to Normal details
  // 3. Otherwise, if Normal details are open -> return to Reports list
  const handleBackAction = useCallback((source: 'native' | 'popstate' | 'escape' | 'ui') => {
    const now = Date.now();
    if (now - lastBackActionTimeRef.current < 200) {
      return;
    }
    lastBackActionTimeRef.current = now;

    // Step 1: Child dialogs take precedence
    if (closeTopmostChildRef.current()) {
      if (source === 'popstate') {
        try {
          window.history.pushState({ abmaxModal: 'report_details', reportId: report?.id }, '');
          historyPushedRef.current = true;
        } catch (_) {}
      }
      return;
    }

    // Step 2: If Organized view is active, step back to Normal details
    if (viewModeRef.current === 'organized') {
      handleBackToDetails();
      if (source === 'popstate') {
        try {
          window.history.pushState({ abmaxModal: 'report_details', reportId: report?.id }, '');
          historyPushedRef.current = true;
        } catch (_) {}
      }
      return;
    }

    // Step 3: At Normal details, close report modal back to Reports list
    isClosingRef.current = true;
    if (source === 'popstate') {
      historyPushedRef.current = false;
      onCloseRef.current();
    } else {
      if (historyPushedRef.current && window.history.state?.abmaxModal === 'report_details') {
        historyPushedRef.current = false;
        try {
          window.history.back();
        } catch (_) {}
      }
      onCloseRef.current();
    }
  }, [report?.id]);

  // Lock background scroll, preserve list scroll, and listen to popstate / Capacitor hardware Back
  useEffect(() => {
    if (!isOpen || !report) return;

    isClosingRef.current = false;
    const savedScrollY = window.scrollY;

    // Push synthetic state once so hardware / browser back button closes report modal
    if (!historyPushedRef.current) {
      try {
        window.history.pushState({ abmaxModal: 'report_details', reportId: report.id }, '');
        historyPushedRef.current = true;
      } catch (_) {}
    }

    const handlePopState = () => {
      handleBackAction('popstate');
    };
    window.addEventListener('popstate', handlePopState);

    let capHandle: any = null;
    if (typeof window !== 'undefined' && (window as any).Capacitor?.isPluginAvailable?.('App')) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('backButton', () => {
          handleBackAction('native');
        }).then((h) => {
          capHandle = h;
        }).catch(() => {});
      }).catch(() => {});
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBackAction('escape');
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      if (capHandle?.remove) {
        capHandle.remove();
      }
      if (historyPushedRef.current && window.history.state?.abmaxModal === 'report_details') {
        historyPushedRef.current = false;
        try {
          window.history.back();
        } catch (_) {}
      }
      window.scrollTo(0, savedScrollY);
    };
  }, [isOpen, report?.id, handleBackAction]);

  if (!isOpen || !report) return null;

  const alignment = calculateOverallAlignment(report.timeframes);
  const matchingValues = findMatchingValues(report.timeframes, {
    supplyDemandLevels: report.supplyDemandLevels,
    openingCandles: report.openingCandles,
  });

  const toggleImageExpand = (tf: TimeframeId) => {
    setExpandedImages((prev) => ({ ...prev, [tf]: !prev[tf] }));
  };

  const getDirectionColorClass = (dir: string) => {
    if (dir === 'Bullish') return 'text-bullish font-semibold';
    if (dir === 'Bearish') return 'text-bearish font-semibold';
    if (dir === 'Neutral') return 'text-slate-500 dark:text-slate-400 font-semibold';
    if (dir === 'Not sure') return 'text-amber-theme font-semibold';
    return 'text-app-secondary';
  };

  const renderReportActions = () => (
    <div className="no-print mt-10 pt-6 border-t-2 border-app/80 pb-12 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-app-main uppercase tracking-wider">
          Report Actions
        </div>
        <span className="text-[11px] text-app-secondary">
          {report.pair} · {formatReadableAnalysisDate(report.date).full}
        </span>
      </div>

      {pdfError && (
        <div className="p-3 text-xs bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-lg flex items-center justify-between">
          <span>{pdfError}</span>
          <button
            type="button"
            onClick={() => setPdfError(null)}
            className="text-xs font-semibold underline ml-2 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {/* Modify Report */}
        <button
          type="button"
          onClick={() => onModify(report)}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-2xs"
          title="Open and modify this report in Analysis editor"
        >
          <Edit className="w-4 h-4 text-emerald-theme shrink-0" />
          <span>Modify Report</span>
        </button>

        {/* Copy Report */}
        <button
          type="button"
          onClick={() => onCopy(report)}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-2xs"
          title="Duplicate this report as a new distinct entry"
        >
          <Copy className="w-4 h-4 text-app-secondary shrink-0" />
          <span>Copy Report</span>
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={() => setIsShareModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-lg transition-colors cursor-pointer shadow-2xs"
          title="Share report PDF via Android Share Sheet or Web Share"
        >
          <Share2 className="w-4 h-4 shrink-0" />
          <span>Share</span>
        </button>

        {/* Download PDF */}
        <button
          type="button"
          onClick={() => setIsPdfChooserOpen(true)}
          disabled={exportingPdf}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
          title="Download selectable PDF"
        >
          {exportingPdf ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <Download className="w-4 h-4 text-app-secondary shrink-0" />
          )}
          <span>{exportingPdf ? 'Generating...' : 'Download PDF'}</span>
        </button>

        {/* Take Trade */}
        <button
          type="button"
          onClick={() => {
            setScenarioTradeDraft(null);
            setEditingTrade(null);
            setIsTakeTradeOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-2xs"
          title="Record an executed trade linked to this report"
        >
          <TrendingUp className="w-4 h-4 text-emerald-theme shrink-0" />
          <span>Take Trade</span>
        </button>

        {/* Delete Report */}
        {!showDeleteConfirm ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold text-rose-500 hover:text-rose-400 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Delete report"
            aria-label="Delete report"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>Delete Report</span>
          </button>
        ) : (
          <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex flex-wrap items-center justify-between gap-3 p-3.5 bg-rose-950/40 border border-rose-500/50 rounded-lg">
            <div className="flex items-center gap-2 text-rose-300 text-xs font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>Permanently delete this report? This cannot be undone.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-2 min-h-[44px] text-xs text-app-secondary hover:text-app-main rounded-md border border-app cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDelete(report.id);
                }}
                className="px-4 py-2 min-h-[44px] text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md transition-colors cursor-pointer"
              >
                Yes, Delete Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ErrorBoundary fallbackTitle="Report Details View encountered an issue" onReset={onClose}>
      <>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${report.pair} Analysis Report`}
          className={`print-modal-backdrop fixed inset-0 flex flex-col bg-app-main overflow-hidden ${
            viewMode === 'organized'
              ? 'z-50 pt-[env(safe-area-inset-top,0px)]'
              : 'z-30 pt-[calc(58px+env(safe-area-inset-top,0px))]'
          }`}
          onClick={() => handleBackAction('ui')}
        >
          <div
            ref={modalContainerRef}
            className="print-modal-container relative w-full h-full flex flex-col overflow-hidden text-app-main bg-app-main"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Compact Navigation Row (Sticky below Header, 44px min touch targets, mobile safe area) */}
            <div className="no-print shrink-0 sticky top-0 z-20 bg-app-main/95 backdrop-blur-xs border-b border-app shadow-2xs">
              <div className="flex items-center justify-between px-3 sm:px-6 py-2 gap-2 flex-wrap min-h-[50px]">
                {/* Left Navigation: "Back to Reports" or "Back to Details" + "View Organized" */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  {viewMode === 'organized' ? (
                    <button
                      ref={closeButtonRef}
                      type="button"
                      onClick={handleBackToDetails}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-bold text-app-main hover:bg-app-field rounded-lg transition-colors cursor-pointer border border-app bg-app-secondary"
                      title="Back to Normal report details"
                      aria-label="Back to Details"
                    >
                      <ArrowLeft className="w-4 h-4 text-emerald-theme shrink-0" />
                      <span className="font-semibold text-xs">Back to Details</span>
                    </button>
                  ) : (
                    <button
                      ref={closeButtonRef}
                      type="button"
                      onClick={() => handleBackAction('ui')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-bold text-app-main hover:bg-app-field rounded-lg transition-colors cursor-pointer border border-app bg-app-secondary"
                      title="Close report and return to reports list (Esc / Back)"
                      aria-label="Back to Reports"
                    >
                      <ArrowLeft className="w-4 h-4 text-emerald-theme shrink-0" />
                      <span className="font-semibold text-xs">Back to Reports</span>
                    </button>
                  )}

                  {/* Clearly visible "View Organized" toggle in Normal details */}
                  {viewMode === 'standard' && (
                    <button
                      type="button"
                      onClick={handleViewOrganized}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-xs font-bold text-emerald-theme bg-emerald-pale hover:bg-emerald-pale/80 border border-emerald-500/30 rounded-lg transition-colors cursor-pointer shadow-2xs"
                      title="Switch to Organized Sheet layout"
                      aria-label="View Organized layout"
                    >
                      <LayoutGrid className="w-4 h-4 shrink-0" />
                      <span className="font-bold text-xs">View Organized</span>
                    </button>
                  )}
                </div>

                {/* Right: Pair, Date, and View Mode Badge */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-app-main leading-tight">
                    {report.pair}
                  </span>
                  <span className="text-app-secondary text-xs">· {report.date}</span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                      viewMode === 'organized'
                        ? 'bg-emerald-pale text-emerald-theme border-emerald-500/20'
                        : 'bg-app-secondary text-app-main border-app'
                    }`}
                  >
                    {viewMode === 'organized' ? 'Organized' : 'Normal Details'}
                  </span>
                </div>
              </div>
            </div>

            {/* Internal Scrolling Body */}
            <div ref={bodyContainerRef} className="flex-1 overflow-y-auto p-3.5 sm:p-6 md:p-8 space-y-6">
              {/* Preferences Filter Banner */}
              {hasHiddenSections && (
                <div className="no-print p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Some report sections are hidden by display preferences.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOverrideShowAll((prev) => !prev)}
                    className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-200 dark:bg-amber-900/60 hover:bg-amber-300 text-amber-900 dark:text-amber-100 transition-colors cursor-pointer"
                  >
                    {overrideShowAll ? 'Restore Filtered View' : 'Show All Sections'}
                  </button>
                </div>
              )}

              {/* RENDER VIEW: Organized vs Normal Details */}
              {viewMode === 'organized' ? (
                <div className="space-y-6">
                  <OrganizedReportView
                    report={report}
                    imagesMap={imagesMap}
                    onOpenViewer={(url, title) => setActiveViewerImage({ url, title })}
                    onEditTrade={(trd) => {
                      setEditingTrade(trd);
                      setScenarioTradeDraft(null);
                      setIsTakeTradeOpen(true);
                    }}
                    onRemoveTrade={handleDeleteTrade}
                    presentationConfig={{ ...presentationConfig, sectionVisibility: secVis }}
                  />
                  {renderReportActions()}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 1. DOCUMENT HEADER */}
                  <div className="space-y-2 border-b border-app pb-5">
                    {secVis.general?.metadataAndTimestamps !== false && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold tracking-wide uppercase text-[11px] px-2 py-0.5 rounded ${
                              report.status === 'Modified'
                                ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-theme border border-amber-300'
                                : 'bg-emerald-pale text-emerald-theme border border-emerald-500/30'
                            }`}
                          >
                            {report.status === 'Modified' ? 'Modified' : 'Original Analysis'}
                          </span>
                          {report.copiedFromId && (
                            <span className="text-app-secondary text-[11px]">
                              · Copied entry
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Report Title */}
                    {report.title ? (
                      <div className="space-y-1">
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-app-main">
                          {report.title}
                        </h1>
                        <div className="text-xs sm:text-sm font-semibold text-emerald-theme">
                          {report.pair} — Analysis Report
                        </div>
                      </div>
                    ) : (
                      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-app-main">
                        {report.pair} — <span className="text-emerald-theme">Analysis Report</span>
                      </h1>
                    )}

                    {secVis.general?.metadataAndTimestamps !== false && (
                      <>
                        <div className="text-xs sm:text-sm text-app-main font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>
                            <strong className="font-semibold">{formatReadableAnalysisDate(report.date).primary}</strong>
                            {formatReadableAnalysisDate(report.date).secondary && (
                              <span className="text-app-secondary font-normal ml-1">
                                ({formatReadableAnalysisDate(report.date).secondary})
                              </span>
                            )}
                          </span>
                          <span className="text-app-secondary">•</span>
                          <span>{report.session} Session</span>
                          <span className="text-app-secondary">•</span>
                          <span>Analysis Made: {report.analysisTiming}</span>
                        </div>

                        <div className="text-[11px] text-app-secondary flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span>Created: {new Date(report.createdAt).toLocaleString()}</span>
                          <span>·</span>
                          <span>Last modified: {new Date(report.updatedAt).toLocaleString()}</span>
                        </div>
                      </>
                    )}

                    {/* Complete Overall Alignment Card */}
                    {secVis.general?.overallAlignment !== false && (
                      <div className="mt-3 p-4 rounded-lg bg-app-secondary border border-app shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
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

                        {/* Individual timeframe boxes in exact order with readable direction labels and S / I / F deep structure badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {TIMEFRAME_ORDER.map((tf) => {
                            if (secVis.timeframes && secVis.timeframes[tf] === false) return null;
                            const tfData = report.timeframes[tf];
                            const b = tfData?.overallBias;
                            const sDir = tfData?.swing?.direction;
                            const iDir = tfData?.internal?.direction;
                            const fDir = tfData?.fractal?.direction;

                            const renderMiniBadge = (prefix: 'S' | 'I' | 'F', dir?: string) => {
                              const norm = dir === 'Not sure' ? 'Waiting' : dir;
                              const isBull = norm === 'Bullish';
                              const isBear = norm === 'Bearish';
                              const isNeut = norm === 'Neutral';
                              const isWait = norm === 'Waiting';

                              const badgeStyle = isBull
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                                : isBear
                                ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40'
                                : isNeut
                                ? 'bg-slate-300/40 text-slate-700 dark:text-slate-300 border-slate-400/40'
                                : isWait
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40'
                                : 'bg-app-field/60 text-app-secondary border-app/60';

                              const fullLabel = prefix === 'S'
                                ? `Swing: ${norm || 'Unset'}`
                                : prefix === 'I'
                                ? `Internal: ${norm || 'Unset'}`
                                : `Fractal: ${norm || 'Unset'}`;

                              return (
                                <span
                                  title={fullLabel}
                                  className={`inline-flex items-center gap-0.5 px-1 py-0.2 text-[9px] font-mono font-bold rounded border ${badgeStyle}`}
                                >
                                  <span>{prefix}:</span>
                                  <span>{norm ? (norm === 'Waiting' ? 'Wait' : norm.slice(0, 4)) : '—'}</span>
                                </span>
                              );
                            };

                            const tfFields = secVis.perTimeframeFields?.[tf] || secVis.timeframeFields;
                            const showSwing = tfFields?.swingStructure !== false;
                            const showInternal = tfFields?.internalStructure !== false;
                            const showFractal = tfFields?.fractalStructure !== false;
                            const hasAnyStructureVisible = showSwing || showInternal || showFractal;

                            return (
                              <div
                                key={tf}
                                className={`inline-flex flex-col gap-1 px-2.5 py-1.5 rounded text-xs border font-medium transition-colors ${
                                  b === 'Bullish'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                    : b === 'Bearish'
                                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                    : b === 'Neutral'
                                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                                    : 'bg-app-field text-app-secondary border-app'
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-app-main">{tf}:</span>
                                  <span>{b || 'Not selected'}</span>
                                </div>
                                {hasAnyStructureVisible && (
                                  <div className="flex items-center gap-1 pt-0.5 border-t border-app/30">
                                    {showSwing && renderMiniBadge('S', sDir)}
                                    {showInternal && renderMiniBadge('I', iDir)}
                                    {showFractal && renderMiniBadge('F', fDir)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. LIQUIDITY FIRST: Crossed & Watchlist */}
                  {(secVis.general?.majorLiquidityChecklist !== false || secVis.general?.majorLiquidityWatchlist !== false) && (
                    <div className="space-y-2 border-b border-app pb-5">
                      {secVis.general?.majorLiquidityChecklist !== false && (
                        <>
                          <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                            LIQUIDITY CROSSED
                          </div>
                          <div className="text-xs text-app-main leading-relaxed">
                            {report.crossedLiquidity && report.crossedLiquidity.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {report.crossedLiquidity.map((liq, index) => (
                                  <React.Fragment key={liq}>
                                    <span className="font-medium text-bullish bg-emerald-pale/60 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                      {liq}
                                    </span>
                                    {index < report.crossedLiquidity.length - 1 && (
                                      <span className="text-app-secondary select-none">·</span>
                                    )}
                                  </React.Fragment>
                                ))}
                              </div>
                            ) : (
                              <span className="text-app-secondary italic">None recorded</span>
                            )}
                          </div>
                        </>
                      )}

                      {secVis.general?.majorLiquidityWatchlist !== false && report.majorLiquidityWatchlist && report.majorLiquidityWatchlist.trim() && (
                        <div className={`space-y-1 ${secVis.general?.majorLiquidityChecklist !== false ? 'pt-2.5 border-t border-app/60' : ''}`}>
                          <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                            MAJOR LIQUIDITY TO WATCH TODAY
                          </div>
                          <p className="text-xs text-app-main leading-relaxed whitespace-pre-wrap">
                            {report.majorLiquidityWatchlist}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. MULTI-TIMEFRAME ANALYSIS DETAILS */}
                  <div className="space-y-4 border-b border-app pb-5">
                    <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                      TIMEFRAME ANALYSIS BREAKDOWN
                    </div>

                    <div className="space-y-3">
                      {TIMEFRAME_ORDER.map((tf) => {
                        if (secVis.timeframes && secVis.timeframes[tf] === false) return null;
                        const data = report.timeframes[tf];
                        if (!data) return null;

                        const tfFields = secVis.perTimeframeFields?.[tf] || secVis.timeframeFields;
                        const hasImage = Boolean(data.chartImageId);
                        const isExpanded = expandedImages[tf];
                        const imgUrl = imagesMap[tf];
                        const structStatus = getTimeframeStructureAlignment(data);
                        const pairAlignments = getTimeframePairAlignments(tf, report.timeframes, secVis.timeframes);

                        return (
                          <div
                            key={tf}
                            className="p-3.5 rounded-lg border border-app bg-app-field space-y-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-app-main text-sm">{tf}</span>
                                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                                  data.overallBias === 'Bullish'
                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300'
                                    : data.overallBias === 'Bearish'
                                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300'
                                    : 'bg-app-main text-app-secondary border-app'
                                }`}>
                                  {data.overallBias || 'No Bias'}
                                </span>
                              </div>

                              {hasImage && imgUrl && (
                                <button
                                  type="button"
                                  onClick={() => toggleImageExpand(tf)}
                                  className="inline-flex items-center gap-1 text-[11px] text-emerald-theme hover:underline cursor-pointer"
                                >
                                  <ImageIcon className="w-3.5 h-3.5" />
                                  <span>{isExpanded ? 'Hide Chart' : 'Show Chart'}</span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                              )}
                            </div>

                            {/* Deep Structure Alignment & Timeframe Pairs Summary Row */}
                            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-app/50">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                  structStatus.status === 'aligned'
                                    ? structStatus.direction === 'Bullish'
                                      ? 'bg-emerald-pale text-bullish border-emerald-500/40'
                                      : 'bg-bearish-pale text-bearish border-rose-500/40'
                                    : structStatus.status === 'mixed'
                                    ? 'bg-slate-200 dark:bg-slate-800 text-app-secondary border-app'
                                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-theme border-amber-400/40'
                                }`}
                              >
                                {structStatus.label}
                              </span>

                              {pairAlignments.map((pair) => (
                                <span
                                  key={`${pair.localTf}-${pair.partnerTf}`}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                    pair.status === 'aligned'
                                      ? pair.direction === 'Bullish'
                                        ? 'bg-emerald-pale text-bullish border-emerald-500/40'
                                        : 'bg-bearish-pale text-bearish border-rose-500/40'
                                      : pair.status === 'differing'
                                      ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-theme border-amber-400/40'
                                      : 'bg-app-field text-app-secondary border-app'
                                  }`}
                                >
                                  {pair.label}
                                </span>
                              ))}
                            </div>

                            {/* Timeframe analytical details */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-[11px] text-app-secondary pt-1">
                              {tfFields?.swingStructure !== false && (data.swing?.high || data.swing?.low) && (
                                <div>
                                  <span className="font-semibold text-app-main block">Swing:</span>
                                  <span>H: {data.swing.high || '—'} / L: {data.swing.low || '—'}</span>
                                </div>
                              )}
                              {tfFields?.internalStructure !== false && (data.internal?.high || data.internal?.low) && (
                                <div>
                                  <span className="font-semibold text-app-main block">Internal:</span>
                                  <span>H: {data.internal.high || '—'} / L: {data.internal.low || '—'}</span>
                                </div>
                              )}
                              {tfFields?.liquidityLevels !== false && (data.liquidityLevels || []).length > 0 && (
                                <div>
                                  <span className="font-semibold text-app-main block">Liquidity Levels:</span>
                                  <span>{data.liquidityLevels!.map((l) => l.level).join(', ')}</span>
                                </div>
                              )}
                              {tf === 'Monthly' && ((tfFields?.pmh !== false && Boolean(data.pmh)) || (tfFields?.pml !== false && Boolean(data.pml))) && (
                                <div>
                                  <span className="font-semibold text-app-main block">Previous Month:</span>
                                  <span>
                                    {tfFields?.pmh !== false && data.pmh ? `PMH: ${data.pmh}` : ''}
                                    {tfFields?.pmh !== false && data.pmh && tfFields?.pml !== false && data.pml ? ' / ' : ''}
                                    {tfFields?.pml !== false && data.pml ? `PML: ${data.pml}` : ''}
                                  </span>
                                </div>
                              )}
                              {tf === 'Weekly' && ((tfFields?.pwh !== false && Boolean(data.pwh)) || (tfFields?.pwl !== false && Boolean(data.pwl))) && (
                                <div>
                                  <span className="font-semibold text-app-main block">Previous Week:</span>
                                  <span>
                                    {tfFields?.pwh !== false && data.pwh ? `PWH: ${data.pwh}` : ''}
                                    {tfFields?.pwh !== false && data.pwh && tfFields?.pwl !== false && data.pwl ? ' / ' : ''}
                                    {tfFields?.pwl !== false && data.pwl ? `PWL: ${data.pwl}` : ''}
                                  </span>
                                </div>
                              )}
                              {tf === 'Daily' && ((tfFields?.pdh !== false && Boolean(data.pdh)) || (tfFields?.pdl !== false && Boolean(data.pdl))) && (
                                <div>
                                  <span className="font-semibold text-app-main block">Previous Day:</span>
                                  <span>
                                    {tfFields?.pdh !== false && data.pdh ? `PDH: ${data.pdh}` : ''}
                                    {tfFields?.pdh !== false && data.pdh && tfFields?.pdl !== false && data.pdl ? ' / ' : ''}
                                    {tfFields?.pdl !== false && data.pdl ? `PDL: ${data.pdl}` : ''}
                                  </span>
                                </div>
                              )}
                            </div>

                            {data.note && (
                              <div className="text-app-main text-xs pt-1 border-t border-app/60">
                                <span className="font-semibold text-app-secondary">Notes: </span>
                                <span>{data.note}</span>
                              </div>
                            )}

                            {/* Chart screenshot inline expansion */}
                            {hasImage && isExpanded && imgUrl && (
                              <div className="pt-2 border-t border-app/60">
                                <div
                                  className="relative aspect-video max-w-lg rounded-md overflow-hidden border border-app cursor-pointer group bg-black/20"
                                  onClick={() => setActiveViewerImage({ url: imgUrl, title: `${report.pair} — ${tf} Chart` })}
                                >
                                  <img
                                    src={imgUrl}
                                    alt={`${tf} Chart`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                                    Click to view full resolution
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3B. REPEATED ANALYSIS LEVELS (present in >= 2 distinct timeframes) */}
                  {secVis.notesAndLevels?.matchingValues !== false && matchingValues.length > 0 && (
                    <div className="space-y-2 border-b border-app pb-5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-app-main uppercase tracking-wider flex items-center gap-1.5">
                          <span>REPEATED LEVELS ({matchingValues.length})</span>
                          <span className="text-[10px] font-normal text-app-secondary lowercase">
                            (across &ge;2 timeframes)
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {matchingValues.map((group, idx) => {
                          const distinctTfs = Array.from(new Set(group.occurrences.map((o) => o.timeframe)));
                          return (
                            <div
                              key={idx}
                              className="p-2.5 rounded border border-app bg-app-field space-y-1 text-xs"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono font-bold text-emerald-theme text-sm">
                                  {group.displayPrice}
                                </span>
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                  {distinctTfs.length} timeframes
                                </span>
                              </div>
                              <div className="text-[11px] text-app-secondary leading-snug">
                                {group.occurrences.map((o, oIdx) => (
                                  <span key={oIdx} className="inline-block mr-1.5 font-mono">
                                    <strong className="text-app-main">{o.timeframe}</strong>{' '}
                                    <span className="text-[10px] text-app-secondary">({o.field})</span>
                                    {oIdx < group.occurrences.length - 1 ? ',' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 4. PLANNED SCENARIOS WITH SCENARIO ACTIONS */}
                  {secVis.scenariosAndTrades?.plannedScenarios !== false && (
                    <div className="space-y-3 border-b border-app pb-5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                          PLANNED SCENARIOS ({report.scenarios?.length || 0})
                        </div>
                      </div>

                      {report.scenarios && report.scenarios.length > 0 ? (
                        <div className="space-y-3">
                          {report.scenarios.map((sc, idx) => (
                            <div
                              key={sc.id || idx}
                              className={`p-3.5 rounded-lg border bg-app-field space-y-2 text-xs transition-colors ${
                                sc.isInvalid || sc.status === 'Invalid'
                                  ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/20'
                                  : 'border-app'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap pb-1.5 border-b border-app/60">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-app-main text-sm">
                                    {sc.label || `Scenario ${idx + 1}`}
                                  </span>
                                  {sc.strategy && (
                                    <span className="text-app-secondary">— {sc.strategy}</span>
                                  )}
                                  {(sc.isInvalid || sc.status === 'Invalid') && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700">
                                      Invalid
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {sc.direction && (
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                                        sc.direction === 'Buy'
                                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                      }`}
                                    >
                                      {sc.direction}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {sc.description && (
                                <div className="text-app-main leading-relaxed">
                                  <span className="font-semibold text-app-secondary">Description: </span>
                                  <span className="whitespace-pre-wrap">{sc.description}</span>
                                </div>
                              )}

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                                {sc.entryConditions && (
                                  <div className="p-2 rounded bg-app-main border border-app/60">
                                    <span className="font-bold text-app-main block mb-0.5">
                                      Entry Conditions:
                                    </span>
                                    <span className="text-app-secondary whitespace-pre-wrap">
                                      {sc.entryConditions}
                                    </span>
                                  </div>
                                )}
                                {sc.invalidationConditions && (
                                  <div className="p-2 rounded bg-app-main border border-app/60">
                                    <span className="font-bold text-rose-600 dark:text-rose-400 block mb-0.5">
                                      Invalidation Rules:
                                    </span>
                                    <span className="text-app-secondary whitespace-pre-wrap">
                                      {sc.invalidationConditions}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Setup chart screenshots */}
                              {secVis.scenariosAndTrades?.scenarioImages !== false && sc.images && sc.images.length > 0 && (
                                <div className="pt-2 border-t border-app/60">
                                  <span className="text-[11px] font-semibold text-app-main block mb-1.5">
                                    Setup Charts ({sc.images.length}):
                                  </span>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {sc.images.map((img, i) => (
                                      <div
                                        key={img.id || i}
                                        onClick={() =>
                                          setActiveViewerImage({
                                            url: img.dataUrl,
                                            title: img.caption || img.name || `${sc.label} Setup Chart`,
                                          })
                                        }
                                        className="group border border-app rounded-md overflow-hidden bg-app-main cursor-pointer hover:border-emerald-500 transition-colors"
                                      >
                                        <div className="aspect-video bg-black/10 overflow-hidden relative">
                                          <img
                                            src={img.dataUrl}
                                            alt={img.caption || 'Setup Chart'}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                            loading="lazy"
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Actions inside each scenario box: Take Trade & Mark Invalid */}
                              <div className="flex items-center justify-between pt-2 border-t border-app/60 flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={sc.isInvalid || sc.status === 'Invalid'}
                                    onClick={() => handleTakeTradeForScenario(sc)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-semibold bg-emerald-theme hover:bg-emerald-theme-hover text-white rounded-md shadow-2xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={sc.isInvalid ? "Scenario is marked invalid. Restore scenario to take trade." : `Record a trade based on ${sc.label}`}
                                  >
                                    <TrendingUp className="w-3.5 h-3.5" />
                                    <span>Take Trade</span>
                                  </button>

                                  {(sc.isInvalid || sc.status === 'Invalid') ? (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleScenarioInvalid(sc)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-semibold bg-app-main text-emerald-theme hover:bg-emerald-pale rounded-md border border-emerald-500/30 transition-colors cursor-pointer"
                                      title="Restore scenario to active eligible state"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Restore Scenario</span>
                                    </button>
                                  ) : invalidatingScenarioId === sc.id ? (
                                    <div className="inline-flex items-center gap-1.5 p-1 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-md text-xs">
                                      <span className="text-rose-700 dark:text-rose-300 text-[11px] font-medium">Mark invalid?</span>
                                      <button
                                        type="button"
                                        onClick={() => handleToggleScenarioInvalid(sc)}
                                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold text-[10px] cursor-pointer"
                                      >
                                        Yes
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setInvalidatingScenarioId(null)}
                                        className="px-2 py-1 text-app-secondary hover:text-app-main text-[10px] cursor-pointer"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setInvalidatingScenarioId(sc.id)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-md border border-rose-200 dark:border-rose-800/40 transition-colors cursor-pointer"
                                      title="Mark this scenario as invalid"
                                    >
                                      <AlertCircle className="w-3.5 h-3.5" />
                                      <span>Mark Invalid</span>
                                    </button>
                                  )}
                                </div>

                                {(sc.isInvalid || sc.status === 'Invalid') && (
                                  <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium italic">
                                    Marked invalid — trade entry disabled
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-app-secondary italic">No planned scenarios recorded.</p>
                      )}
                    </div>
                  )}

                  {/* 5. TRADES TAKEN */}
                  {secVis.scenariosAndTrades?.tradesTaken !== false && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-app-main uppercase tracking-wider">
                            TRADES TAKEN
                          </span>
                          {report.trades && report.trades.length > 0 && (
                            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                              {report.trades.length}
                            </span>
                          )}
                        </div>
                        {onUpdateReport && (
                          <button
                            type="button"
                            onClick={() => {
                              setScenarioTradeDraft(null);
                              setEditingTrade(null);
                              setIsTakeTradeOpen(true);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-theme hover:underline cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Record Trade
                          </button>
                        )}
                      </div>

                      {report.trades && report.trades.length > 0 ? (
                        <div className="space-y-2.5">
                          {report.trades.map((trd, idx) => (
                            <div
                              key={trd.id || idx}
                              className="p-3 rounded-lg border border-app bg-app-field space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                                      trd.direction === 'Buy'
                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                                    }`}
                                  >
                                    {trd.direction}
                                  </span>
                                  <span className="font-bold text-app-main">
                                    {trd.scenarioLabel || 'Planned Execution'}
                                  </span>
                                  {trd.timeframeTaken && (
                                    <span className="text-app-secondary font-mono text-[11px]">
                                      [{trd.timeframeTaken}]
                                    </span>
                                  )}
                                  {trd.session && (
                                    <span className="text-app-secondary text-[11px]">{trd.session}</span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {trd.outcome && (
                                    <span
                                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                                        trd.outcome === 'Win'
                                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-400'
                                          : trd.outcome === 'Loss'
                                          ? 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 border-rose-400'
                                          : trd.outcome === 'Break-even'
                                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border-amber-400'
                                          : 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 border-blue-400'
                                      }`}
                                    >
                                      {trd.outcome}
                                    </span>
                                  )}
                                  {onUpdateReport && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingTrade(trd);
                                          setScenarioTradeDraft(null);
                                          setIsTakeTradeOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-emerald-theme hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded border border-emerald-300 dark:border-emerald-700 transition-colors cursor-pointer"
                                        title="Edit this recorded trade"
                                      >
                                        <Edit className="w-2.5 h-2.5" />
                                        Edit Trade
                                      </button>
                                      {deleteTradeConfirmId === trd.id ? (
                                        <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-300 dark:border-rose-800 text-[10px]">
                                          <span className="text-rose-700 dark:text-rose-300 font-medium">Remove?</span>
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteTrade(trd.id)}
                                            className="px-1.5 py-0.2 bg-rose-600 text-white rounded font-bold text-[9px] cursor-pointer hover:bg-rose-700"
                                          >
                                            Yes
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setDeleteTradeConfirmId(null)}
                                            className="px-1 py-0.2 text-app-secondary hover:text-app-main text-[9px] cursor-pointer"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => setDeleteTradeConfirmId(trd.id)}
                                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded border border-rose-300 dark:border-rose-800 transition-colors cursor-pointer"
                                          title="Remove this recorded trade"
                                        >
                                          <Trash2 className="w-2.5 h-2.5" />
                                          Remove Trade
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-app-secondary bg-app-main p-2 rounded border border-app/60">
                                {trd.entryPrice && (
                                  <span>
                                    Entry: <strong className="text-app-main">{trd.entryPrice}</strong>
                                  </span>
                                )}
                                {trd.stopLoss && (
                                  <span>
                                    SL: <strong className="text-rose-600 dark:text-rose-400">{trd.stopLoss}</strong>
                                  </span>
                                )}
                                {trd.takeProfit && (
                                  <span>
                                    TP: <strong className="text-emerald-600 dark:text-emerald-400">{trd.takeProfit}</strong>
                                  </span>
                                )}
                                {trd.exitPrice && (
                                  <span>
                                    Exit: <strong className="text-app-main">{trd.exitPrice}</strong>
                                  </span>
                                )}
                                {trd.riskReward && (
                                  <span>
                                    R:R: <strong className="text-app-main">{trd.riskReward}</strong>
                                  </span>
                                )}
                              </div>

                              {trd.notes && (
                                <div className="text-app-secondary whitespace-pre-wrap italic pt-0.5 text-[11px]">
                                  &ldquo;{trd.notes}&rdquo;
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-app-secondary italic">No trades recorded for this report.</p>
                      )}
                    </div>
                  )}

                  {/* 6. OVERALL NOTES & TRADE IDEAS */}
                  {secVis.notesAndLevels?.overallNotes !== false && report.overallNotes && (
                    <div className="space-y-1.5 border-t border-app/60 pt-4">
                      <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                        ANALYSIS NOTES &amp; TRADE IDEAS
                      </div>
                      <p className="text-xs text-app-main leading-relaxed whitespace-pre-wrap">
                        {report.overallNotes}
                      </p>
                    </div>
                  )}

                  {/* 7. BOTTOM REPORT ACTIONS */}
                  {renderReportActions()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Child Modals */}
        {activeViewerImage && (
          <ImageViewerModal
            isOpen={Boolean(activeViewerImage)}
            onClose={() => setActiveViewerImage(null)}
            imageUrl={activeViewerImage.url}
            title={activeViewerImage.title}
          />
        )}

        {isShareModalOpen && report && (
          <ShareReportModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            report={report}
            imagesMap={imagesMap}
          />
        )}

        {isTakeTradeOpen && report && (
          <TakeTradeModal
            isOpen={isTakeTradeOpen}
            onClose={() => {
              setIsTakeTradeOpen(false);
              setEditingTrade(null);
              setScenarioTradeDraft(null);
              onTradeDraftChange?.(null);
            }}
            report={report}
            tradeToEdit={editingTrade}
            onSaveTrade={handleSaveTrade}
            initialTradeDraft={scenarioTradeDraft || initialTradeDraft}
            onTradeDraftChange={onTradeDraftChange}
          />
        )}

        {isEditScenariosOpen && report && (
          <EditScenariosModal
            isOpen={isEditScenariosOpen}
            onClose={() => setIsEditScenariosOpen(false)}
            scenarios={report.scenarios || []}
            onSave={async (scns) => {
              if (onUpdateReport) {
                await onUpdateReport({
                  ...report,
                  scenarios: scns,
                  updatedAt: Date.now(),
                });
              }
              setIsEditScenariosOpen(false);
            }}
          />
        )}

        {isPdfChooserOpen && report && (
          <PdfStyleChooserModal
            isOpen={isPdfChooserOpen}
            onClose={() => setIsPdfChooserOpen(false)}
            onDownload={handleDownloadPdf}
            reportPair={report.pair}
            reportDate={report.date}
          />
        )}
      </>
    </ErrorBoundary>
  );
};
