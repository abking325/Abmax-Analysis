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
  TrendingUp,
  Share2,
  MoreVertical,
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
} from '../utils/analysisUtils';
import { getChartImageUrl } from '../services/cloudSync';
import { useAuth } from '../context/AuthContext';
import { ImageViewerModal } from './ImageViewerModal';
import { OrganizedReportView } from './OrganizedReportView';
import { downloadReportPdf } from '../services/pdfExport';
import { EditScenariosModal } from './EditScenariosModal';
import { TakeTradeModal } from './TakeTradeModal';
import { ShareReportModal } from './ShareReportModal';

interface ReportDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
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
  report,
  onModify,
  onCopy,
  onDelete,
  onUpdateReport,
  initialTradeDraft,
  onTradeDraftChange,
}) => {
  const { user } = useAuth();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [imagesMap, setImagesMap] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );
  const [isTakeTradeOpen, setIsTakeTradeOpen] = useState(Boolean(initialTradeDraft?.isOpen));
  const [editingTrade, setEditingTrade] = useState<RecordedTrade | null>(null);
  const [deleteTradeConfirmId, setDeleteTradeConfirmId] = useState<string | null>(null);
  const [isEditScenariosOpen, setIsEditScenariosOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  const modalContainerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

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

  const [presentationConfig, setPresentationConfig] = useState<ReportPresentationConfig>(DEFAULT_REPORT_PRESENTATION);
  const [overrideShowAll, setOverrideShowAll] = useState(false);

  // Load presentation config when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      getUserReportPresentationConfig().then((cfg) => {
        setPresentationConfig(cfg);
      });
      setOverrideShowAll(false);
      setPdfError(null);
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

  const handleDownloadPdf = async () => {
    if (!report || exportingPdf) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      await downloadReportPdf({ report, imagesMap });
    } catch (err: unknown) {
      console.error('Failed to export PDF:', err);
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF.';
      setPdfError(`${msg} You can use Print / Save as PDF as a fallback.`);
    } finally {
      setExportingPdf(false);
    }
  };

  // Load chart images from private cloud storage or local IndexedDB
  useEffect(() => {
    if (!report || !isOpen) return;

    let isMounted = true;
    const loadImages = async () => {
      const map: Record<string, string> = {};
      for (const tf of TIMEFRAME_ORDER) {
        const imgId = report.timeframes[tf]?.chartImageId;
        if (imgId) {
          try {
            const dataUrl = await getChartImageUrl(user?.id || null, imgId);
            if (dataUrl && isMounted) {
              map[imgId] = dataUrl;
            }
          } catch (e) {
            console.error('Failed to load chart image', e);
          }
        }
      }
      if (isMounted) {
        setImagesMap(map);
      }
    };

    loadImages();
    return () => {
      isMounted = false;
    };
  }, [report, isOpen, user]);

  // Child dialog close coordinator: closes topmost child dialog first if open
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
    if (editingTrade) {
      setEditingTrade(null);
      return true;
    }
    if (isTakeTradeOpen) {
      setIsTakeTradeOpen(false);
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
    if (showActionsMenu) {
      setShowActionsMenu(false);
      return true;
    }
    return false;
  }, [
    activeViewerImage,
    showDeleteConfirm,
    deleteTradeConfirmId,
    editingTrade,
    isTakeTradeOpen,
    isEditScenariosOpen,
    isShareModalOpen,
    showActionsMenu,
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

  const handleBackAction = useCallback((source: 'native' | 'popstate' | 'escape' | 'ui') => {
    const now = Date.now();
    if (now - lastBackActionTimeRef.current < 250) {
      return;
    }
    lastBackActionTimeRef.current = now;

    // 1. If any child dialog is open, close that child dialog first
    if (closeTopmostChildRef.current()) {
      if (source === 'popstate') {
        // Browser consumed the history entry; re-push to keep report modal active
        try {
          window.history.pushState({ abmaxModal: 'report_details', reportId: report?.id }, '');
          historyPushedRef.current = true;
        } catch (_) {}
      }
      return;
    }

    // 2. No child open: close the report modal
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

  // Lock background scroll, preserve scroll position, and integrate browser / Android Back navigation
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

    // Listen to Capacitor Android hardware back button if available
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

    // Focus close button on mount for accessibility
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
      // Restore scroll position so user returns to exact place in reports list
      window.scrollTo(0, savedScrollY);
    };
  }, [isOpen, report?.id, handleBackAction]);

  if (!isOpen || !report) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <ErrorBoundary fallbackTitle="Document Report View encountered an issue" onReset={onClose}>
      <>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${report.pair} Analysis Report`}
          className="print-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-xs overflow-hidden"
          onClick={() => handleBackAction('ui')}
        >
          <div
            ref={modalContainerRef}
            className="print-modal-container relative w-full h-full sm:h-auto sm:max-h-[94vh] sm:max-w-4xl bg-app-main border border-app sm:rounded-xl shadow-2xl flex flex-col overflow-hidden text-app-main"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Pinned Visible Navigation & Actions Toolbar (Sticky, 44px touch targets, mobile safe area) */}
            <div className="no-print shrink-0 sticky top-0 z-30 bg-app-main border-b border-app shadow-xs pt-[env(safe-area-inset-top,0px)]">
              <div className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-2.5 gap-2">
                {/* Obvious Back / Close control */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={() => handleBackAction('ui')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] min-w-[44px] text-xs font-bold text-app-main hover:bg-app-field rounded-lg transition-colors cursor-pointer border border-app bg-app-secondary"
                    title="Close report and return to list (Esc / Back)"
                    aria-label="Close report and return to list"
                  >
                    <ArrowLeft className="w-4 h-4 text-emerald-theme shrink-0" />
                    <span className="font-semibold text-xs">Close</span>
                  </button>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-app-main leading-tight">
                        {report.pair}
                      </span>
                      <span className="text-app-secondary text-xs">· {report.date}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-pale text-emerald-theme border border-emerald-500/20">
                        Organized
                      </span>
                    </div>
                    <span className="text-[10px] text-app-secondary">
                      {report.session || 'Session'} {report.time ? `· ${report.time}` : ''}
                    </span>
                  </div>
                </div>

                {/* Action Buttons Toolbar: Share, Download PDF, Take Trade, More */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsShareModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-md shadow-2xs transition-colors cursor-pointer"
                    title="Share report PDF via Android Share Sheet or Web Share"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Share</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    disabled={exportingPdf}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer disabled:opacity-50"
                    title="Download selectable PDF"
                  >
                    {exportingPdf ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-app-secondary" />
                    )}
                    <span className="hidden md:inline">PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsTakeTradeOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] text-xs font-semibold bg-emerald-theme text-white hover:bg-emerald-theme-hover rounded-md shadow-2xs transition-colors cursor-pointer"
                    title="Record an executed trade linked to this report"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span className="hidden lg:inline">Take Trade</span>
                  </button>

                  {/* More actions dropdown (Modify, Copy, Delete, Print) */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowActionsMenu((prev) => !prev)}
                      className="p-2 min-h-[44px] min-w-[40px] flex items-center justify-center text-app-secondary hover:text-app-main hover:bg-app-field border border-app rounded-md transition-colors cursor-pointer"
                      title="More actions"
                      aria-label="More report actions"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {showActionsMenu && (
                      <div
                        className="absolute right-0 mt-1 w-44 bg-app-main border border-app rounded-lg shadow-xl py-1 z-40 text-xs"
                        onClick={() => setShowActionsMenu(false)}
                      >
                        <button
                          type="button"
                          onClick={() => onModify(report)}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-app-main hover:bg-app-field transition-colors cursor-pointer"
                        >
                          <Edit className="w-3.5 h-3.5 text-app-secondary" />
                          <span>Modify Report</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onCopy(report)}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-app-main hover:bg-app-field transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5 text-app-secondary" />
                          <span>Copy Report</span>
                        </button>
                        <button
                          type="button"
                          onClick={handlePrint}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-app-main hover:bg-app-field transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-app-secondary" />
                          <span>Browser Print</span>
                        </button>
                        <div className="border-t border-app my-1" />
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(true)}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer font-medium"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Report</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Internal Scrolling Document Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 space-y-6">
              {/* Banner when sections are hidden by display preferences */}
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

              {/* Direct Organized View Presentation (Only Report View) */}
              <OrganizedReportView
                report={report}
                imagesMap={imagesMap}
                onOpenViewer={(url, title) => setActiveViewerImage({ url, title })}
                onEditTrade={(trd) => setEditingTrade(trd)}
                onRemoveTrade={handleDeleteTrade}
                presentationConfig={{ ...presentationConfig, sectionVisibility: secVis }}
              />
            </div>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Delete Report"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
          >
            <div className="w-full max-w-sm bg-app-main border border-rose-300 dark:border-rose-900 rounded-lg shadow-xl p-5 space-y-4">
              <h3 className="text-base font-bold text-rose-600 dark:text-rose-400">
                Delete Analysis Report?
              </h3>
              <p className="text-xs text-app-secondary leading-relaxed">
                Are you sure you want to permanently delete the analysis report for{' '}
                <strong className="text-app-main">{report.pair}</strong> ({report.date})? This action cannot be undone.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    onDelete(report.id);
                  }}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors cursor-pointer"
                >
                  Yes, Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Large Image Zoom Viewer Modal */}
        {activeViewerImage && (
          <ImageViewerModal
            isOpen={Boolean(activeViewerImage)}
            onClose={() => setActiveViewerImage(null)}
            imageUrl={activeViewerImage.url}
            title={activeViewerImage.title}
          />
        )}

        {/* Edit Scenarios Modal */}
        {isEditScenariosOpen && (
          <EditScenariosModal
            isOpen={isEditScenariosOpen}
            onClose={() => setIsEditScenariosOpen(false)}
            scenarios={report.scenarios || []}
            onSave={async (updatedScenarios) => {
              if (onUpdateReport) {
                const updatedReport: SavedReport = {
                  ...report,
                  scenarios: updatedScenarios,
                  updatedAt: Date.now(),
                };
                await onUpdateReport(updatedReport);
              }
            }}
          />
        )}

        {/* Take Trade Modal (Supports both New Trade and Edit Trade modes) */}
        {(isTakeTradeOpen || Boolean(editingTrade)) && (
          <TakeTradeModal
            isOpen={isTakeTradeOpen || Boolean(editingTrade)}
            onClose={() => {
              setIsTakeTradeOpen(false);
              setEditingTrade(null);
              onTradeDraftChange?.(null);
            }}
            report={report}
            tradeToEdit={editingTrade}
            initialTradeDraft={initialTradeDraft}
            onTradeDraftChange={onTradeDraftChange}
            onSaveTrade={async (savedTrade) => {
              if (onUpdateReport) {
                const currentTrades = report.trades || [];
                let updatedTrades: RecordedTrade[];

                if (editingTrade) {
                  // Update existing trade using original ID in place
                  updatedTrades = currentTrades.map((t) =>
                    t.id === savedTrade.id ? savedTrade : t
                  );
                } else {
                  // Add new trade
                  updatedTrades = [...currentTrades, savedTrade];
                }

                const updatedReport: SavedReport = {
                  ...report,
                  trades: updatedTrades,
                  updatedAt: Date.now(),
                };
                await onUpdateReport(updatedReport);
              }
              setEditingTrade(null);
              setIsTakeTradeOpen(false);
            }}
          />
        )}

        {/* Share Report Modal */}
        {isShareModalOpen && report && (
          <ShareReportModal
            isOpen={isShareModalOpen}
            onClose={() => setIsShareModalOpen(false)}
            report={report}
            imagesMap={imagesMap}
            presentationConfig={presentationConfig || undefined}
          />
        )}
      </>
    </ErrorBoundary>
  );
};
