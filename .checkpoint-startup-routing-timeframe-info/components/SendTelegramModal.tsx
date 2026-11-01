import React, { useState } from 'react';
import {
  X,
  Send,
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  ShieldCheck,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { SavedReport, ReportPresentationConfig } from '../types/journal';
import { generateReportPdfBlob } from '../services/pdfExport';
import { sendReportToTelegram, TelegramDeliveryResult } from '../services/telegramService';
import { useAuth } from '../context/AuthContext';
import { calculateOverallAlignment } from '../utils/analysisUtils';

interface SendTelegramModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport;
  imagesMap?: Record<string, string>;
  presentationConfig?: ReportPresentationConfig;
  onOpenAuth?: () => void;
}

export const SendTelegramModal: React.FC<SendTelegramModalProps> = ({
  isOpen,
  onClose,
  report,
  imagesMap = {},
  presentationConfig,
  onOpenAuth,
}) => {
  const { user } = useAuth();
  const [activeRequestId, setActiveRequestId] = useState<string>(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  );
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<TelegramDeliveryResult | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Check if any sections are hidden
  const v = presentationConfig?.sectionVisibility;
  const hasExclusions = Boolean(
    v &&
      (Object.values(v.general || {}).some((x) => x === false) ||
        Object.values(v.timeframes || {}).some((x) => x === false) ||
        Object.values(v.timeframeFields || {}).some((x) => x === false) ||
        Object.values(v.notesAndLevels || {}).some((x) => x === false) ||
        Object.values(v.scenariosAndTrades || {}).some((x) => x === false))
  );

  const handleSend = async (forceNewRequestId = false) => {
    if (isSending || isGeneratingPdf) return;
    setGeneralError(null);
    setDeliveryResult(null);

    let currentReqId = activeRequestId;
    if (forceNewRequestId) {
      currentReqId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setActiveRequestId(currentReqId);
    }

    // 1. Generate PDF Blob
    setIsGeneratingPdf(true);
    let pdfBlob: Blob;
    let filename: string;

    try {
      const res = await generateReportPdfBlob({
        report,
        imagesMap,
        presentationConfig,
      });
      pdfBlob = res.blob;
      filename = res.filename;
    } catch (err) {
      console.error('Failed to generate PDF for Telegram dispatch:', err);
      setIsGeneratingPdf(false);
      setGeneralError('Could not generate report PDF. Please verify chart image attachments and retry.');
      return;
    } finally {
      setIsGeneratingPdf(false);
    }

    // 2. Dispatch to Telegram through secure Supabase Edge Function
    setIsSending(true);
    try {
      const res = await sendReportToTelegram({
        report,
        pdfBlob,
        filename,
        requestId: currentReqId,
        presentationConfig,
      });

      setDeliveryResult(res);
      if (!res.ok && res.error) {
        setGeneralError(res.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown dispatch error';
      setGeneralError(msg);
      setDeliveryResult({ ok: false, status: 'failed', requestId: currentReqId, error: msg });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-xs overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-app-main border border-app rounded-xl shadow-2xl flex flex-col overflow-hidden text-app-main animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-theme" />
            <h3 className="text-sm font-bold text-app-main tracking-tight uppercase">
              Send Report to Telegram
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Destination & Bot Specs */}
          <div className="p-3.5 rounded-lg bg-app-secondary/50 border border-app space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-app-secondary">
                Configured Destination
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div>
                <span className="text-app-secondary block text-[11px]">Telegram Bot:</span>
                <span className="font-semibold text-app-main">@Abmaxanalysisbot</span>
              </div>
              <div>
                <span className="text-app-secondary block text-[11px]">Group Destination:</span>
                <span className="font-mono font-semibold text-app-main text-[11px]">-1004337945630</span>
              </div>
            </div>
          </div>

          {/* Report Information Snapshot */}
          <div className="p-3.5 rounded-lg bg-app-field border border-app space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-app-secondary block">
              Document Payload
            </span>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-app-secondary" />
                <span className="font-semibold text-app-main">
                  {report.pair} — {report.date}
                </span>
              </div>
              <span className="font-mono text-[11px] text-app-secondary">
                {calculateOverallAlignment(report.timeframes).label || 'No Alignment'}
              </span>
            </div>
            {report.title && (
              <p className="text-[11px] text-app-secondary italic truncate">
                Title: &quot;{report.title}&quot;
              </p>
            )}
          </div>

          {/* Export Exclusions Notice */}
          {hasExclusions && (
            <div className="p-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <span className="font-semibold">Display Filter Active:</span> The PDF will match your current custom presentation filters. Hidden sections will be excluded.
              </div>
            </div>
          )}

          {/* Delivery Result: Success */}
          {deliveryResult?.ok && (
            <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/50 space-y-1.5 animate-fade-in text-emerald-800 dark:text-emerald-200">
              <div className="flex items-center gap-2 font-bold text-xs">
                <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Delivered to Telegram Successfully!</span>
              </div>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                Telegram confirmed receipt of your analysis PDF in group{' '}
                <strong className="font-mono">-1004337945630</strong>.
                {deliveryResult.messageId && ` (Message ID: ${deliveryResult.messageId})`}
              </p>
            </div>
          )}

          {/* Delivery Result: Uncertain Timeout */}
          {deliveryResult?.status === 'uncertain' && (
            <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-500/50 space-y-2 text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2 font-bold text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Delivery Uncertain — Check Telegram</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                The connection timed out waiting for Telegram confirmation. The report may have already posted.
                Please check group <strong className="font-mono">-1004337945630</strong> before attempting to send again.
                Automatic resend is disabled to prevent duplicate group posts.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSend(false)}
                  disabled={isSending}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-semibold hover:bg-amber-700 transition-colors cursor-pointer"
                >
                  {isSending ? 'Checking...' : 'Re-check Status (Same ID)'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSend(true)}
                  disabled={isSending}
                  className="px-3 py-1.5 bg-app-field border border-app text-app-main rounded text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Verified Not Posted: Send Fresh
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {generalError && deliveryResult?.status !== 'uncertain' && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-500/40 text-rose-700 dark:text-rose-300 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>
                  {deliveryResult?.status === 'unreachable'
                    ? 'Backend Function Not Deployed or Unreachable'
                    : deliveryResult?.status === 'unauthenticated'
                    ? 'Authentication Required'
                    : deliveryResult?.status === 'missing_config'
                    ? 'Backend Configuration Missing'
                    : deliveryResult?.status === 'unsynced'
                    ? 'Report Synchronization Pending'
                    : deliveryResult?.status === 'telegram_rejected'
                    ? 'Telegram API Rejected Delivery'
                    : 'Dispatch Error'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed">{generalError}</p>

              {deliveryResult?.status === 'unauthenticated' && onOpenAuth && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAuth();
                    }}
                    className="px-3 py-1 bg-rose-600 text-white rounded text-xs font-semibold hover:bg-rose-700 transition-colors"
                  >
                    Sign in to Supabase
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-5 py-3.5 bg-app-secondary border-t border-app flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-[11px] text-app-secondary">
            {isGeneratingPdf
              ? 'Generating PDF document...'
              : isSending
              ? 'Contacting Telegram bot...'
              : 'Direct document export'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending || isGeneratingPdf}
              className="px-3 py-1.5 text-xs font-medium text-app-secondary hover:bg-app-field border border-app rounded transition-colors disabled:opacity-50 cursor-pointer"
            >
              {deliveryResult?.ok ? 'Done' : 'Cancel'}
            </button>

            {!deliveryResult?.ok && (
              <button
                type="button"
                onClick={() => handleSend(false)}
                disabled={isSending || isGeneratingPdf}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSending || isGeneratingPdf ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>
                  {isGeneratingPdf
                    ? 'Rendering PDF...'
                    : isSending
                    ? 'Sending to Telegram...'
                    : 'Confirm & Send'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
