import React, { useRef, useState, useEffect } from 'react';
import {
  X,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  ShieldCheck,
  Cloud,
  HardDrive,
} from 'lucide-react';
import {
  analyzeBackup,
  createFullBackup,
  restoreBackup,
  getLastBackupMetadata,
  RestorePreview,
} from '../services/db';
import { BackupData } from '../types/journal';
import { exportTextOrDownload } from '../utils/nativeExport';
import { useAuth } from '../context/AuthContext';

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
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [preRestoreExporting, setPreRestoreExporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedBackup, setParsedBackup] = useState<BackupData | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [foreignOwnershipMode, setForeignOwnershipMode] = useState<'preserve' | 'claim' | 'skip'>('preserve');
  const [restoring, setRestoring] = useState(false);
  const [lastBackupInfo, setLastBackupInfo] = useState<{ timestamp: number | null; status: string | null }>({
    timestamp: null,
    status: null,
  });
  const [restoreResult, setRestoreResult] = useState<{
    addedReports: number;
    addedTemplates: number;
    addedImages: number;
    addedJournalEntries: number;
    skippedForeignJournalEntries: number;
    addedStrategies?: number;
    skippedForeignStrategies?: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLastBackupInfo(getLastBackupMetadata());
      setRestoreResult(null);
      setParsedBackup(null);
      setPreview(null);
      setParseError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      const backup = await createFullBackup(user?.id);
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `abmax_analysis_backup_v${backup.version}_${new Date().toISOString().slice(0, 10)}.json`;
      await exportTextOrDownload(jsonStr, filename, 'application/json', 'ABMAX Backup Export');
      setLastBackupInfo(getLastBackupMetadata());
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setExporting(false);
    }
  };

  const handlePreRestoreExport = async () => {
    setPreRestoreExporting(true);
    try {
      const backup = await createFullBackup(user?.id);
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `abmax_safety_snapshot_before_restore_${new Date().toISOString().slice(0, 10)}.json`;
      await exportTextOrDownload(jsonStr, filename, 'application/json', 'ABMAX Safety Snapshot');
      setLastBackupInfo(getLastBackupMetadata());
    } catch (err) {
      console.error('Pre-restore export failed', err);
    } finally {
      setPreRestoreExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setParseError(null);
    setParsedBackup(null);
    setPreview(null);
    setRestoreResult(null);
    setForeignOwnershipMode('preserve');

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BackupData;

      if (!parsed || parsed.app !== 'ABMAX_ANALYSIS' || !Array.isArray(parsed.reports)) {
        throw new Error('Invalid ABMAX backup file. Missing application signature or corrupted structure.');
      }

      const pview = await analyzeBackup(parsed, user?.id);
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
      const result = await restoreBackup(parsedBackup, {
        restoreDraft: true,
        targetAccountId: user?.id || 'guest',
        foreignOwnershipMode,
      });
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
        className="w-full max-w-xl bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-app bg-app-secondary">
          <div className="text-sm font-bold text-app-main flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-theme" />
            <span>Backup &amp; Restore</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-app-secondary hover:text-app-main rounded"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-xs text-app-main">
          {/* Storage Architecture: Local Backup vs Cloud Sync */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-lg bg-app-field border border-app">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-xs text-app-main">
                <HardDrive className="w-3.5 h-3.5 text-emerald-theme" />
                <span>Local Backup (Offline &amp; Private)</span>
              </div>
              <p className="text-[11px] text-app-secondary leading-relaxed">
                Stores your entire database (analyses, trades, Journal, My Journal, Strategies, attachments, and drafts) inside local IndexedDB on this device. Journal, My Journal, and Strategies are local-only — export a JSON file to back up or transfer them.
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-xs text-app-main">
                <Cloud className="w-3.5 h-3.5 text-blue-500" />
                <span>Cloud Synchronization</span>
              </div>
              <p className="text-[11px] text-app-secondary leading-relaxed">
                When signed in to your Supabase account, analyses, templates, chart screenshots, and preferences sync across your authorized devices. Signing in does not back up Journal, My Journal, or Strategies.
              </p>
            </div>
          </div>

          {/* Export section */}
          <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm text-app-main">Export Full Backup</div>
              {lastBackupInfo.timestamp && (
                <span className="text-[10px] text-emerald-theme font-medium">
                  Last export: {new Date(lastBackupInfo.timestamp).toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-app-secondary leading-relaxed">
              Generates a versioned, portable JSON archive including all analyses, trades, journal entries,
              saved strategies, templates, active drafts, preferences, and embedded chart screenshots.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {exporting ? 'Generating Archive...' : 'Export Complete Backup (JSON)'}
              </button>
            </div>
          </div>

          {/* Import / Restore section */}
          <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 space-y-3">
            <div className="font-bold text-sm text-app-main">Restore from Backup</div>
            <p className="text-app-secondary leading-relaxed">
              Upload an ABMAX backup file. The system validates the file structure and provides an itemized preview.
              New records are safely merged, while identical IDs are preserved without overwrite.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-app-main border border-app hover:bg-app-field rounded transition-colors text-app-main cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-app-secondary" />
                <span>Select Backup File to Preview</span>
              </button>
            </div>

            {parseError && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Itemized Preview of Backup */}
            {preview && !restoreResult && (
              <div className="p-3.5 rounded-lg border border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-theme text-xs">
                    <FileCheck className="w-4 h-4" />
                    <span>Itemized Backup Preview:</span>
                  </div>
                  <span className="text-[10px] text-app-secondary">
                    Format: {parsedBackup?.version && parsedBackup.version >= 4 ? `Version ${parsedBackup.version} (Strategies & Journal Ready)` : parsedBackup?.version === 3 ? 'Version 3 (Journal Ready)' : `Version ${parsedBackup?.version || 1} (Compatible)`}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Analysis Reports</span>
                    <strong className="text-app-main text-xs">{preview.totalReportsInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newReportsCount} new, {preview.skippedReportsCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Journal Entries</span>
                    <strong className="text-app-main text-xs">{preview.totalJournalEntriesInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newJournalEntriesCount} new, {preview.skippedJournalEntriesCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Strategies</span>
                    <strong className="text-app-main text-xs">{preview.totalStrategiesInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newStrategiesCount} new, {preview.skippedStrategiesCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Templates</span>
                    <strong className="text-app-main text-xs">{preview.totalTemplatesInBackup}</strong>
                    <span className="text-emerald-theme block text-[10px]">
                      (+{preview.newTemplatesCount} new, {preview.skippedTemplatesCount} existing)
                    </span>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Chart Screenshots</span>
                    <strong className="text-app-main text-xs">{preview.imagesCount} images</strong>
                  </div>

                  <div className="p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary block">Active Draft &amp; Sessions</span>
                    <strong className="text-app-main text-xs">
                      {preview.hasDraft ? 'Draft Preserved' : 'None'}
                      {preview.ownershipSummary && preview.ownershipSummary.scopedDraftCount > 0
                        ? ` + ${preview.ownershipSummary.scopedDraftCount} scoped draft(s)`
                        : ''}
                      {preview.hasWorkingSession ? ' + In-Flight Workspace' : ''}
                    </strong>
                  </div>
                </div>

                {preview.ownershipSummary &&
                  (preview.ownershipSummary.foreignOwnerEntriesCount > 0 ||
                    preview.ownershipSummary.foreignOwnerStrategiesCount > 0 ||
                    preview.ownershipSummary.foreignScopedDraftCount > 0) && (
                    <div className="p-2.5 rounded border border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/20 space-y-2 text-[11px]">
                      <div className="font-bold text-amber-800 dark:text-amber-300">
                        Account Ownership Detected in Backup ({preview.ownershipSummary.foreignOwnerEntriesCount} journal entry(ies), {preview.ownershipSummary.foreignOwnerStrategiesCount} strategy(ies), {preview.ownershipSummary.foreignScopedDraftCount} draft scope(s) from another scope)
                      </div>
                      <p className="text-app-secondary leading-relaxed">
                        Choose how imported journal records belonging to another account/guest scope should be handled:
                      </p>
                      <div className="space-y-1">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="foreignOwnershipMode"
                            checked={foreignOwnershipMode === 'preserve'}
                            onChange={() => setForeignOwnershipMode('preserve')}
                            className="mt-0.5 accent-emerald-600"
                          />
                          <span>
                            <strong className="text-app-main">Preserve Original Ownership (Strict Isolation)</strong> — Keep entries under their original account IDs; they remain hidden until that account signs in.
                          </span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="foreignOwnershipMode"
                            checked={foreignOwnershipMode === 'claim'}
                            onChange={() => setForeignOwnershipMode('claim')}
                            className="mt-0.5 accent-emerald-600"
                          />
                          <span>
                            <strong className="text-app-main">Assign to Current Workspace ({user ? 'Signed-in Account' : 'Guest'})</strong> — Transfer imported entries and drafts into your currently active workspace.
                          </span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="foreignOwnershipMode"
                            checked={foreignOwnershipMode === 'skip'}
                            onChange={() => setForeignOwnershipMode('skip')}
                            className="mt-0.5 accent-emerald-600"
                          />
                          <span>
                            <strong className="text-app-main">Skip Foreign-Owned Records</strong> — Import only records belonging to the active workspace.
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                {/* Pre-restore safety snapshot recommendation */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-app/40">
                  <button
                    type="button"
                    onClick={handlePreRestoreExport}
                    disabled={preRestoreExporting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-app-main hover:bg-app-field border border-app rounded text-app-secondary hover:text-app-main transition-colors cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>{preRestoreExporting ? 'Saving snapshot...' : 'Export Safety Snapshot Before Restoring'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    disabled={restoring}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{restoring ? 'Merging Records...' : 'Confirm & Merge Import'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Clear Restore Result */}
            {restoreResult && (
              <div className="p-3.5 rounded-lg bg-emerald-pale text-emerald-theme border border-emerald-500/40 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-xs">Restore Completed Successfully!</div>
                  <div className="text-[11px] mt-1 text-app-main leading-relaxed">
                    Added <strong>{restoreResult.addedReports}</strong> report(s), <strong>{restoreResult.addedJournalEntries}</strong> journal entry(ies), <strong>{restoreResult.addedStrategies || 0}</strong> strategy(ies), <strong>{restoreResult.addedTemplates}</strong> template(s), and <strong>{restoreResult.addedImages}</strong> chart screenshot(s).
                    {(restoreResult.skippedForeignJournalEntries > 0 || (restoreResult.skippedForeignStrategies || 0) > 0)
                      ? ` Skipped ${restoreResult.skippedForeignJournalEntries} foreign-owned journal entry(ies) and ${restoreResult.skippedForeignStrategies || 0} foreign-owned strategy(ies).`
                      : ' Existing local records were fully preserved.'}
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
            className="px-4 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
