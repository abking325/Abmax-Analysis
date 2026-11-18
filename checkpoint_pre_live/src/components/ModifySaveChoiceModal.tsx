import React from 'react';
import { AlertCircle, FilePlus, RefreshCw, X, AlertTriangle, Eye } from 'lucide-react';

interface ModifySaveChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportTitle?: string;
  reportPair: string;
  reportDate: string;
  onUpdateExisting: () => void;
  onSaveAsNew: () => void;
  onReviewLatest?: () => void;
  isSaving?: boolean;
  conflictState?: {
    type: 'deleted' | 'concurrency';
    message: string;
    currentRevision?: number;
    expectedRevision?: number;
  } | null;
}

export const ModifySaveChoiceModal: React.FC<ModifySaveChoiceModalProps> = ({
  isOpen,
  onClose,
  reportTitle,
  reportPair,
  reportDate,
  onUpdateExisting,
  onSaveAsNew,
  onReviewLatest,
  isSaving = false,
  conflictState = null,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modify-save-choice-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => {
        if (!isSaving) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-app-main border border-app rounded-xl shadow-2xl p-5 sm:p-6 text-app-main space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-app/60 pb-3.5">
          <div className="space-y-1">
            <h2 id="modify-save-choice-title" className="text-base sm:text-lg font-bold text-app-main tracking-tight">
              Save Modified Report
            </h2>
            <p className="text-xs text-app-secondary">
              You are editing an existing report. Choose how you would like to save your changes.
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="p-1.5 rounded-lg text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Identified Report Details Card */}
        <div className="p-3.5 rounded-lg bg-app-secondary border border-app flex items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-bold text-app-main text-sm">
              {reportTitle && reportTitle.trim() ? reportTitle.trim() : 'Untitled Report'}
            </div>
            <div className="text-app-secondary mt-0.5 flex items-center gap-2">
              <span className="font-semibold text-emerald-theme">{reportPair}</span>
              <span>•</span>
              <span>{reportDate}</span>
            </div>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700">
            Editing Record
          </span>
        </div>

        {/* Conflict Warning if present */}
        {conflictState && (
          <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-400/50 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {conflictState.type === 'deleted'
                  ? 'Original Report Not Found'
                  : 'Concurrent Revision Conflict'}
              </span>
            </div>
            <p className="text-amber-900 dark:text-amber-200 leading-relaxed">
              {conflictState.message}
            </p>
          </div>
        )}

        {/* Options */}
        {!conflictState ? (
          <div className="space-y-3 pt-1">
            {/* Option 1: Update Existing Report */}
            <button
              type="button"
              disabled={isSaving}
              onClick={onUpdateExisting}
              className="w-full text-left p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 transition-colors cursor-pointer group disabled:opacity-50"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0 text-emerald-700 dark:text-emerald-300 mt-0.5 group-hover:scale-105 transition-transform">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-app-main group-hover:text-emerald-theme transition-colors">
                    Update Existing Report
                  </div>
                  <p className="text-xs text-app-secondary mt-0.5 leading-relaxed">
                    Updates this saved report record in place. Preserves original creation timestamp and ID while incrementing the revision.
                  </p>
                </div>
              </div>
            </button>

            {/* Option 2: Save as New Report */}
            <button
              type="button"
              disabled={isSaving}
              onClick={onSaveAsNew}
              className="w-full text-left p-3.5 rounded-lg border border-app bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer group disabled:opacity-50"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-app-secondary flex items-center justify-center shrink-0 text-app-main mt-0.5 group-hover:scale-105 transition-transform">
                  <FilePlus className="w-4 h-4 text-emerald-theme" />
                </div>
                <div>
                  <div className="text-sm font-bold text-app-main group-hover:text-emerald-theme transition-colors">
                    Save as New Report
                  </div>
                  <p className="text-xs text-app-secondary mt-0.5 leading-relaxed">
                    Creates a separate new report with a new ID and today’s timestamp. Leaves the original report untouched.
                  </p>
                </div>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <button
              type="button"
              disabled={isSaving}
              onClick={onSaveAsNew}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <FilePlus className="w-4 h-4" />
              <span>Save as New Report (Preserves Both Versions)</span>
            </button>

            {conflictState.type === 'concurrency' && onReviewLatest && (
              <button
                type="button"
                disabled={isSaving}
                onClick={onReviewLatest}
                className="w-full py-2.5 px-4 rounded-lg bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 text-app-main border border-app font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Eye className="w-4 h-4 text-emerald-theme" />
                <span>Review Latest Version from Disk</span>
              </button>
            )}
          </div>
        )}

        {/* Footer / Cancel */}
        <div className="pt-2 border-t border-app/60 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="px-4 py-2 min-h-[40px] text-xs font-semibold text-app-secondary hover:text-app-main hover:bg-app-field rounded-lg border border-app transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel and Keep Editing
          </button>
        </div>
      </div>
    </div>
  );
};
