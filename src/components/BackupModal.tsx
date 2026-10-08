import React, { useRef, useState } from 'react';
import {
  X,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
} from 'lucide-react';
import {
  analyzeBackup,
  createFullBackup,
  restoreBackup,
  RestorePreview,
} from '../services/db';
import { BackupData } from '../types/journal';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataChanged: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  onDataChanged,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupData | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    addedReports: number;
    addedTemplates: number;
    addedImages: number;
  } | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const backup = await createFullBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `abmax_analysis_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setParseError(null);
    setParsedBackup(null);
    setPreview(null);
    setRestoreResult(null);

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupData;

      if (!parsed || parsed.app !== 'ABMAX_ANALYSIS' || !Array.isArray(parsed.reports)) {
        throw new Error('Invalid ABMAX backup file. Missing signature or corrupted structure.');
      }

      const pview = await analyzeBackup(parsed);
      setParsedBackup(parsed);
      setPreview(pview);
    } catch (err) {
      setParseError((err as Error).message || 'Failed to read backup file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExecuteRestore = async () => {
    if (!parsedBackup) return;
    setRestoring(true);
    try {
      const result = await restoreBackup(parsedBackup);
      setRestoreResult(result);
      onDataChanged();
    } catch (err) {
      setParseError((err as Error).message || 'Failed to restore data.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Backup & Restore Data"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-app bg-app-secondary">
          <div className="text-sm font-bold text-app-main">Backup &amp; Restore Journal Data</div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-app-secondary hover:text-app-main rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs text-app-main">
          {/* Information box explaining local storage accurately */}
          <div className="p-3 rounded bg-app-field border border-app text-app-secondary leading-relaxed">
            <strong className="text-app-main font-semibold block mb-0.5">
              Storage Architecture
            </strong>
            ABMAX Analysis securely stores your journals, drafts, and chart screenshots in your
            browser&apos;s local IndexedDB. Data remains on this device/origin. Export regular JSON
            backups to preserve your trading archives or transfer them to another browser.
          </div>

          {/* Export section */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/40 space-y-2">
            <div className="font-bold text-sm text-app-main">Export Backup</div>
            <p className="text-app-secondary">
              Creates a comprehensive, versioned JSON file including all analysis reports,
              saved templates, active drafts, and embedded chart screenshots.
            </p>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? 'Generating Backup...' : 'Export Complete Backup (JSON)'}
            </button>
          </div>

          {/* Import section */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/40 space-y-3">
            <div className="font-bold text-sm text-app-main">Import / Restore Backup</div>
            <p className="text-app-secondary">
              Upload a previously exported ABMAX backup file. The system will merge new reports and
              templates, skipping identical IDs to protect existing records without overwriting.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-app-main border border-app hover:bg-app-field rounded transition-colors text-app-main"
            >
              <Upload className="w-3.5 h-3.5 text-app-secondary" />
              Select Backup File to Preview
            </button>

            {parseError && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Itemized Preview of Backup */}
            {preview && !restoreResult && (
              <div className="p-3 rounded border border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-2.5">
                <div className="flex items-center gap-1.5 font-bold text-emerald-theme text-xs">
                  <FileCheck className="w-4 h-4" />
                  Itemized Backup Preview:
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Reports Found</span>
                    <strong className="text-app-main text-xs">{preview.totalReportsInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newReportsCount} new, {preview.skippedReportsCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Templates Found</span>
                    <strong className="text-app-main text-xs">{preview.totalTemplatesInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newTemplatesCount} new, {preview.skippedTemplatesCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app col-span-2">
                    <span className="text-app-secondary block">Chart Screenshots Included</span>
                    <strong className="text-app-main text-xs">{preview.imagesCount} images</strong>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    disabled={restoring}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {restoring ? 'Merging Data...' : 'Confirm & Merge Import'}
                  </button>
                </div>
              </div>
            )}

            {/* Clear Restore Result */}
            {restoreResult && (
              <div className="p-3 rounded bg-emerald-pale text-emerald-theme border border-emerald-500/40 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-xs">Restore Completed Successfully!</div>
                  <div className="text-[11px] mt-0.5 text-app-main">
                    Added {restoreResult.addedReports} new report(s), {restoreResult.addedTemplates} template(s),
                    and {restoreResult.addedImages} chart screenshot(s).
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-app bg-app-secondary flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
