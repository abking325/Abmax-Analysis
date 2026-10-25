import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  Share2,
  Download,
  AlertTriangle,
  FileText,
  Loader2,
  Info,
  CheckCircle2,
  Link2Off,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { generateReportPdfBlob } from '../services/pdfExport';
import { ReportPresentationConfig, SavedReport } from '../types/journal';

interface ShareReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport;
  imagesMap?: Record<string, string>;
  presentationConfig?: ReportPresentationConfig;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

export const ShareReportModal: React.FC<ShareReportModalProps> = ({
  isOpen,
  onClose,
  report,
  imagesMap = {},
  presentationConfig,
}) => {
  const [isPreparing, setIsPreparing] = useState(true);
  const [preparedBlob, setPreparedBlob] = useState<Blob | null>(null);
  const [filename, setFilename] = useState('');
  const [fileSizeKb, setFileSizeKb] = useState(0);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [canWebShareFiles, setCanWebShareFiles] = useState(false);

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Generate filesystem-safe filename
  const getSafeFilename = (rep: SavedReport): string => {
    const sanitizedTitle = rep.title
      ? rep.title.trim().replace(/[^a-zA-Z0-9_-]/g, '_')
      : '';
    const sanitizedPair = (rep.pair || 'XAUUSD').replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedDate = (rep.date || new Date().toISOString().slice(0, 10)).replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    return sanitizedTitle
      ? `ABMAX_${sanitizedTitle}_${sanitizedPair}_${sanitizedDate}.pdf`
      : `ABMAX_${sanitizedPair}_${sanitizedDate}.pdf`;
  };

  // Generate the PDF blob whenever modal opens
  useEffect(() => {
    if (!isOpen || !report) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    const safeName = getSafeFilename(report);
    setFilename(safeName);
    setIsPreparing(true);
    setPreparedBlob(null);
    setError(null);
    setShareSuccess(false);

    generateReportPdfBlob({
      report,
      imagesMap,
      presentationConfig,
    })
      .then(({ blob }) => {
        setPreparedBlob(blob);
        setFileSizeKb(Math.max(1, Math.round(blob.size / 1024)));
        setIsPreparing(false);

        // Check Web Share API capability
        if (
          !Capacitor.isNativePlatform() &&
          typeof navigator !== 'undefined' &&
          typeof navigator.canShare === 'function'
        ) {
          try {
            const testFile = new File([blob], safeName, { type: 'application/pdf' });
            const canShare = navigator.canShare({ files: [testFile] });
            setCanWebShareFiles(Boolean(canShare));
          } catch {
            setCanWebShareFiles(false);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to prepare PDF for sharing:', err);
        setError('Failed to generate PDF document. Please try again.');
        setIsPreparing(false);
      });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, report]);

  if (!isOpen || !report) return null;

  const triggerDownload = () => {
    if (!preparedBlob) return;
    const url = URL.createObjectURL(preparedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const handleShare = async () => {
    if (!preparedBlob || isSharing) return;
    setIsSharing(true);
    setError(null);

    try {
      if (Capacitor.isNativePlatform()) {
        // Native Android: write to Cache directory and invoke native Share Sheet
        const base64Data = await blobToBase64(preparedBlob);
        const writeResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache,
        });

        await Share.share({
          title: filename,
          files: [writeResult.uri],
          dialogTitle: 'Share Report PDF',
        });
        setShareSuccess(true);
      } else if (canWebShareFiles && navigator.share) {
        // Web / PWA: Web Share API with file attachment
        const file = new File([preparedBlob], filename, { type: 'application/pdf' });
        await navigator.share({
          files: [file],
          title: filename,
          text: `ABMAX Analysis: ${report.pair} (${report.date})`,
        });
        setShareSuccess(true);
      } else {
        // Fallback for browsers or iframes without Web Share
        triggerDownload();
      }
    } catch (err: any) {
      // User cancellation (AbortError or cancel message) is normal
      if (
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('cancel') ||
        err?.message?.toLowerCase().includes('dismiss')
      ) {
        // User closed the share sheet without picking an app
      } else {
        console.warn('Share operation encountered an issue:', err);
        setError('Direct sharing could not be launched on this platform. Please use Download PDF.');
      }
    } finally {
      setIsSharing(false);
    }
  };

  const isNative = Capacitor.isNativePlatform();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-report-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-md bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden flex flex-col text-app-main my-auto transition-all animate-in fade-in-50 zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-app flex items-center justify-between bg-app-secondary/60">
          <div className="flex items-center gap-2 min-w-0 pr-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-pale text-emerald-theme flex items-center justify-center shrink-0">
              <Share2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="share-report-modal-title"
                className="font-bold text-sm text-app-main truncate"
              >
                Share Analysis Report
              </h2>
              <div className="text-[11px] text-app-secondary truncate">
                {report.pair} · {report.date}
              </div>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer shrink-0"
            aria-label="Close share dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Document Summary Card */}
          <div className="p-3.5 rounded-lg border border-app bg-app-secondary/30 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-emerald-theme shrink-0" />
                <span className="font-semibold text-app-main truncate font-mono text-[11px]">
                  {filename}
                </span>
              </div>
              {!isPreparing && fileSizeKb > 0 && (
                <span className="text-[10px] text-app-secondary font-mono shrink-0">
                  {fileSizeKb} KB
                </span>
              )}
            </div>

            {isPreparing ? (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 py-1 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Preparing PDF with complete report data...</span>
              </div>
            ) : (
              <p className="text-[11px] text-app-secondary leading-relaxed">
                Includes all recorded multi-timeframe analysis, structured levels, and attached screenshots.
              </p>
            )}
          </div>

          {/* Platform Capability Info */}
          {!isPreparing && (
            <div className="p-3 rounded-lg border border-app bg-app-field/40 text-[11px] text-app-secondary space-y-1">
              <div className="font-semibold text-app-main flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-emerald-theme shrink-0" />
                <span>
                  {isNative
                    ? 'Android System Share Sheet'
                    : canWebShareFiles
                    ? 'Web System Share'
                    : 'Downloadable PDF Document'}
                </span>
              </div>
              <p className="leading-relaxed">
                {isNative
                  ? 'Opens your device share sheet to send the PDF file via Telegram, WhatsApp, Gmail, or any compatible messaging app.'
                  : canWebShareFiles
                  ? 'Shares the PDF file directly through your operating system share menu.'
                  : 'Direct file sharing is restricted in this browser or preview frame. Download the PDF to share it manually.'}
              </p>
            </div>
          )}

          {/* Copy Link Section (Requirement 5) */}
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
              <Link2Off className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Report Link</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              Report link unavailable — share the PDF instead.
            </p>
            <p className="text-[10px] text-slate-500 italic">
              ABMAX Analysis stores reports securely in your private local journal. Public recipient links require a dedicated cloud publishing feature.
            </p>
          </div>

          {/* Error Notice */}
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-start gap-2 text-rose-800 dark:text-rose-200 text-[11px]">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* Success Confirmation */}
          {shareSuccess && (
            <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 flex items-center gap-2 text-emerald-800 dark:text-emerald-200 text-[11px]">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Share action triggered successfully!</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-app bg-app-secondary/40 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={triggerDownload}
            disabled={isPreparing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-app-main bg-app-field border border-app hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer disabled:opacity-50"
            title="Download PDF directly to device"
          >
            <Download className="w-3.5 h-3.5 text-app-secondary" />
            Download PDF
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main rounded transition-colors cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={handleShare}
              disabled={isPreparing || isSharing}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSharing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sharing...</span>
                </>
              ) : isPreparing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Preparing...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{isNative || canWebShareFiles ? 'Share PDF' : 'Save & Share'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
