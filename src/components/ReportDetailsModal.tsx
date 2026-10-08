import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Printer,
  Edit,
  Copy,
  Trash2,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SavedReport, TIMEFRAME_ORDER, TimeframeId } from '../types/journal';
import {
  calculateOverallAlignment,
  findMatchingValues,
} from '../utils/analysisUtils';
import { getImage } from '../services/db';
import { ImageViewerModal } from './ImageViewerModal';

interface ReportDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport | null;
  onModify: (report: SavedReport) => void;
  onCopy: (report: SavedReport) => void;
  onDelete: (id: string) => void;
}

export const ReportDetailsModal: React.FC<ReportDetailsModalProps> = ({
  isOpen,
  onClose,
  report,
  onModify,
  onCopy,
  onDelete,
}) => {
  const [imagesMap, setImagesMap] = useState<Record<string, string>>({});
  const [expandedImages, setExpandedImages] = useState<Record<TimeframeId, boolean>>({
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

  const modalContainerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Load chart images from IndexedDB when report opens
  useEffect(() => {
    if (!report || !isOpen) return;

    let isMounted = true;
    const loadImages = async () => {
      const map: Record<string, string> = {};
      for (const tf of TIMEFRAME_ORDER) {
        const imgId = report.timeframes[tf]?.chartImageId;
        if (imgId) {
          try {
            const dataUrl = await getImage(imgId);
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
  }, [report, isOpen]);

  // Lock background scroll and manage keyboard focus
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !activeViewerImage) {
        onClose();
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
    };
  }, [isOpen, activeViewerImage, onClose]);

  if (!isOpen || !report) return null;

  const alignment = calculateOverallAlignment(report.timeframes);
  const matchingValues = findMatchingValues(report.timeframes);

  const toggleImageExpand = (tf: TimeframeId) => {
    setExpandedImages((prev) => ({ ...prev, [tf]: !prev[tf] }));
  };

  const handlePrint = () => {
    window.print();
  };

  const getDirectionColorClass = (dir: string) => {
    if (dir === 'Bullish') return 'text-bullish font-semibold';
    if (dir === 'Bearish') return 'text-bearish font-semibold';
    if (dir === 'Neutral') return 'text-slate-500 dark:text-slate-400 font-semibold';
    if (dir === 'Not sure') return 'text-amber-theme font-semibold';
    return 'text-app-secondary';
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${report.pair} Analysis Report`}
        className="print-modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-xs overflow-y-auto"
        onClick={onClose}
      >
        <div
          ref={modalContainerRef}
          className="print-modal-container relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-4xl bg-app-main border border-app sm:rounded-lg shadow-2xl flex flex-col overflow-hidden text-app-main"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Interactive Modal Top Bar with Actions */}
          <div className="no-print flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-3 border-b border-app bg-app-secondary shrink-0">
            <span className="text-xs font-semibold text-emerald-theme uppercase tracking-wider">
              Document Report View
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-app-main border border-app hover:bg-app-field rounded transition-colors text-app-main"
                title="Print or Save as PDF"
              >
                <Printer className="w-3.5 h-3.5 text-app-secondary" />
                Print / Save as PDF
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Internal Scrolling Document Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
            {/* 1. DOCUMENT HEADER */}
            <div className="space-y-2 border-b border-app pb-5">
              {/* Status & Quiet secondary info */}
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

              {/* [PAIR] — Analysis Report */}
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-app-main">
                {report.pair} — <span className="text-emerald-theme">Analysis Report</span>
              </h1>

              {/* Analysis date • Session • Analysis Made */}
              <div className="text-xs sm:text-sm text-app-main font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono">{report.date}</span>
                <span className="text-app-secondary">•</span>
                <span>{report.session} Session</span>
                <span className="text-app-secondary">•</span>
                <span>Analysis Made: {report.analysisTiming}</span>
              </div>

              {/* Creation and modification timestamps */}
              <div className="text-[11px] text-app-secondary flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span>Created: {new Date(report.createdAt).toLocaleString()}</span>
                <span>·</span>
                <span>Last modified: {new Date(report.updatedAt).toLocaleString()}</span>
              </div>

              {/* Compact row showing Overall Bias and Alignment */}
              <div className="mt-3 p-3 rounded-md bg-app-secondary border border-app flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div>
                    <span className="text-app-secondary font-medium mr-1.5">Overall Alignment:</span>
                    <strong className="text-app-main font-bold">{alignment.label}</strong>
                  </div>
                  <span className="text-app-secondary hidden sm:inline">·</span>
                  <div className="text-app-secondary text-[11px]">
                    {alignment.detail}
                  </div>
                </div>

                {/* Strip of all 7 timeframes */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {TIMEFRAME_ORDER.map((tf) => {
                    const b = report.timeframes[tf]?.overallBias;
                    return (
                      <div
                        key={tf}
                        className="text-center px-1.5 py-0.5 rounded border border-app bg-app-main text-[10px]"
                      >
                        <span className="text-app-secondary font-mono mr-1">{tf}:</span>
                        <span className={getDirectionColorClass(b || '')}>
                          {b ? b.slice(0, 4) : '—'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. LIQUIDITY FIRST: LIQUIDITY CROSSED */}
            <div className="space-y-1.5 border-b border-app pb-5">
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
            </div>

            {/* 3. SEVEN TIMEFRAME ROWS (Weekly, Daily, 4H, 1H, 15M, 5M, 1M) */}
            <div className="space-y-0">
              <div className="text-xs font-bold text-app-main uppercase tracking-wider mb-2">
                TIMEFRAME ANALYSIS
              </div>

              {TIMEFRAME_ORDER.map((tf, index) => {
                const tfData = report.timeframes[tf];
                if (!tfData) return null;

                const tfImageId = tfData.chartImageId;
                const tfImageUrl = tfImageId ? imagesMap[tfImageId] : null;
                const isImgExpanded = expandedImages[tf];

                // All saved supply/demand entries for this timeframe
                const tfSdLevels = (report.supplyDemandLevels || []).filter(
                  (sd) => sd.timeframe === tf
                );

                const hasInterpretation = Boolean(tfData.biasSpecific && tfData.biasSpecific.trim());
                const hasSwing = Boolean(
                  tfData.swing.direction ||
                  tfData.swing.high?.trim() ||
                  tfData.swing.low?.trim() ||
                  tfData.swing.bosAt?.trim()
                );
                const hasInternal = Boolean(
                  tfData.internal.direction ||
                  tfData.internal.high?.trim() ||
                  tfData.internal.low?.trim() ||
                  tfData.internal.ibosAt?.trim()
                );
                const hasFractal = Boolean(
                  tfData.fractal.direction ||
                  tfData.fractal.fractalBosAt?.trim()
                );
                const hasSd = tfSdLevels.length > 0;
                const hasNote = Boolean(tfData.note && tfData.note.trim());
                const hasChart = Boolean(tfImageUrl);

                const hasAnyDetail =
                  hasInterpretation ||
                  hasSwing ||
                  hasInternal ||
                  hasFractal ||
                  hasSd ||
                  hasNote ||
                  hasChart;

                return (
                  <div
                    key={tf}
                    className={`print-timeframe-row py-4 ${
                      index < TIMEFRAME_ORDER.length - 1 ? 'border-b border-app/70' : ''
                    }`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-y-2 md:gap-x-6">
                      {/* Desktop narrow left column / Mobile header */}
                      <div className="md:col-span-3 space-y-1">
                        <div className="font-extrabold text-base text-app-main tracking-tight">
                          {tf}
                        </div>
                        <div className="text-xs">
                          <span className="text-app-secondary mr-1">Bias:</span>
                          <span className={getDirectionColorClass(tfData.overallBias || '')}>
                            {tfData.overallBias || 'Not set'}
                          </span>
                        </div>
                      </div>

                      {/* Wide right column: Analytical details */}
                      <div className="md:col-span-9 space-y-2 text-xs text-app-main">
                        {!hasAnyDetail ? (
                          <div className="text-xs text-app-secondary italic py-1">
                            No detail recorded
                          </div>
                        ) : (
                          <>
                            {/* Overall interpretation */}
                            {hasInterpretation && (
                              <div className="leading-relaxed whitespace-pre-wrap">
                                <span className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider block sm:inline sm:mr-2">
                                  Overall Interpretation:
                                </span>
                                <span>{tfData.biasSpecific}</span>
                              </div>
                            )}

                            {/* SWING: Direction · High [value] · Low [value] · BOS [value] */}
                            {hasSwing && (
                              <div className="leading-relaxed flex flex-wrap items-center gap-x-1.5">
                                <span className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider">
                                  SWING
                                </span>
                                <span className="text-app-secondary select-none">—</span>
                                <span className={getDirectionColorClass(tfData.swing.direction)}>
                                  {tfData.swing.direction || '—'}
                                </span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>High {tfData.swing.high?.trim() || '—'}</span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>Low {tfData.swing.low?.trim() || '—'}</span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>BOS {tfData.swing.bosAt?.trim() || '—'}</span>
                              </div>
                            )}

                            {/* INTERNAL: Direction · High [value] · Low [value] · iBOS [value] */}
                            {hasInternal && (
                              <div className="leading-relaxed flex flex-wrap items-center gap-x-1.5">
                                <span className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider">
                                  INTERNAL
                                </span>
                                <span className="text-app-secondary select-none">—</span>
                                <span className={getDirectionColorClass(tfData.internal.direction)}>
                                  {tfData.internal.direction || '—'}
                                </span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>High {tfData.internal.high?.trim() || '—'}</span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>Low {tfData.internal.low?.trim() || '—'}</span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>iBOS {tfData.internal.ibosAt?.trim() || '—'}</span>
                              </div>
                            )}

                            {/* FRACTAL: Direction · BOS [value] */}
                            {hasFractal && (
                              <div className="leading-relaxed flex flex-wrap items-center gap-x-1.5">
                                <span className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider">
                                  FRACTAL
                                </span>
                                <span className="text-app-secondary select-none">—</span>
                                <span className={getDirectionColorClass(tfData.fractal.direction)}>
                                  {tfData.fractal.direction || '—'}
                                </span>
                                <span className="text-app-secondary select-none">·</span>
                                <span>BOS {tfData.fractal.fractalBosAt?.trim() || '—'}</span>
                              </div>
                            )}

                            {/* SUPPLY & DEMAND: One compact line for each saved entry */}
                            {hasSd && (
                              <div className="space-y-1 pt-0.5">
                                <div className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider">
                                  SUPPLY &amp; DEMAND
                                </div>
                                {tfSdLevels.map((sd) => (
                                  <div
                                    key={sd.id}
                                    className="leading-relaxed flex flex-wrap items-center gap-x-1.5 pl-2 sm:pl-3 border-l-2 border-app font-mono text-[11px]"
                                  >
                                    <span className={sd.supply ? 'text-bearish' : 'text-app-secondary'}>
                                      Supply {sd.supply?.trim() || '—'}
                                    </span>
                                    <span className="text-app-secondary select-none">·</span>
                                    <span className={sd.demand ? 'text-bullish' : 'text-app-secondary'}>
                                      Demand {sd.demand?.trim() || '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* NOTE: Weekly Note for Weekly, timeframe note for others */}
                            {hasNote && (
                              <div className="leading-relaxed whitespace-pre-wrap pt-0.5">
                                <span className="font-semibold text-app-secondary uppercase text-[11px] tracking-wider block sm:inline sm:mr-2">
                                  {tf === 'Weekly' ? 'Weekly Note:' : `${tf} Note:`}
                                </span>
                                <span>{tfData.note}</span>
                              </div>
                            )}

                            {/* CHART IMAGE */}
                            {tfImageUrl && (
                              <div className="pt-1.5 space-y-2">
                                <div className="no-print">
                                  <button
                                    type="button"
                                    onClick={() => toggleImageExpand(tf)}
                                    className="inline-flex items-center gap-1.5 text-xs text-emerald-theme hover:underline font-medium"
                                  >
                                    <ImageIcon className="w-3.5 h-3.5" />
                                    {isImgExpanded ? 'Hide Chart Image' : 'Show Chart Image'}
                                    {isImgExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>

                                {/* On-screen inline expansion preserving aspect ratio */}
                                {isImgExpanded && (
                                  <div className="no-print p-2 bg-app-secondary rounded border border-app max-w-2xl">
                                    <img
                                      src={tfImageUrl}
                                      alt={`${report.pair} ${tf} screenshot`}
                                      className="max-h-80 w-auto object-contain rounded cursor-pointer border border-app"
                                      onClick={() =>
                                        setActiveViewerImage({
                                          url: tfImageUrl,
                                          title: `${report.pair} - ${tf} Chart`,
                                        })
                                      }
                                    />
                                    <div className="text-[11px] text-app-secondary mt-1">
                                      Click to view fullscreen with zoom &amp; download
                                    </div>
                                  </div>
                                )}

                                {/* Print version: Always included in print output */}
                                <div className="hidden print:block print-image-container">
                                  <div className="text-[10px] text-app-secondary font-mono mb-1">
                                    {tf} Chart Attachment:
                                  </div>
                                  <img
                                    src={tfImageUrl}
                                    alt={`${report.pair} ${tf} screenshot`}
                                    className="max-w-full max-h-[380px] object-contain border border-slate-300 rounded"
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 4. DOCUMENT ENDING */}
            <div className="space-y-6 pt-2 border-t border-app">
              {/* 1. OVERALL NOTES */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                  OVERALL NOTES
                </div>
                <div className="text-xs sm:text-sm text-app-main leading-relaxed whitespace-pre-wrap">
                  {report.overallNotes?.trim() ? (
                    report.overallNotes
                  ) : (
                    <span className="text-app-secondary italic">None recorded</span>
                  )}
                </div>
              </div>

              {/* 2. MATCHING VALUES */}
              <div className="space-y-2 border-t border-app/60 pt-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-app-main uppercase tracking-wider">
                    MATCHING VALUES
                  </div>
                  {matchingValues.length > 0 && (
                    <span className="text-[11px] text-app-secondary">
                      {matchingValues.length} matched price levels
                    </span>
                  )}
                </div>

                {matchingValues.length > 0 ? (
                  <div className="space-y-1.5">
                    {matchingValues.map((group, idx) => (
                      <div
                        key={idx}
                        className="text-xs leading-relaxed flex flex-wrap items-baseline gap-x-2"
                      >
                        <span className="font-mono font-bold text-app-main">
                          {group.displayPrice}:
                        </span>
                        <span className="text-app-secondary">
                          {group.occurrences
                            .map((occ) => `${occ.timeframe} ${occ.field}`)
                            .join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-app-secondary italic">
                    No matching values recorded
                  </div>
                )}
              </div>

              {/* 3. REPORT ACTIONS */}
              <div className="no-print pt-4 border-t border-app flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-app-main border border-app hover:bg-app-field rounded text-app-main transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 text-app-secondary" />
                    Print / Save as PDF
                  </button>

                  <button
                    type="button"
                    onClick={() => onModify(report)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Modify Report
                  </button>

                  <button
                    type="button"
                    onClick={() => onCopy(report)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-app-secondary" />
                    Copy Report
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-2 p-1 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 rounded text-xs">
                      <span className="text-rose-700 dark:text-rose-300 text-xs">
                        Permanently delete?
                      </span>
                      <button
                        type="button"
                        onClick={() => onDelete(report.id)}
                        className="px-2 py-0.5 bg-rose-600 text-white rounded font-semibold text-xs"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-2 py-0.5 text-app-secondary rounded text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-medium text-app-secondary hover:bg-app-field border border-app rounded transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* 4. Small footer */}
              <div className="text-center pt-3 border-t border-app text-[11px] text-app-secondary">
                ABMAX ANALYSIS — Professional Trading Journal
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Large Image Zoom Viewer Modal */}
      {activeViewerImage && (
        <ImageViewerModal
          isOpen={Boolean(activeViewerImage)}
          onClose={() => setActiveViewerImage(null)}
          imageUrl={activeViewerImage.url}
          title={activeViewerImage.title}
        />
      )}
    </>
  );
};
