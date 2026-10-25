import React, { useEffect, useState } from 'react';
import {
  X,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  FileText,
  Bookmark,
  Edit3,
  Image as ImageIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getLocalDataCounts,
  migrateLocalDataToCloud,
  MigrationPreview,
} from '../services/cloudSync';

interface MigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMigrationComplete: () => void;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
  isOpen,
  onClose,
  onMigrationComplete,
}) => {
  const { user } = useAuth();
  const [counts, setCounts] = useState<MigrationPreview | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    uploadedReports: number;
    uploadedTemplates: number;
    uploadedImages: number;
    skippedReports: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMigrationError(null);
      setResult(null);
      setProgressPercent(0);
      setProgressMsg('');
      setLoadingCounts(true);

      getLocalDataCounts()
        .then((res) => {
          setCounts(res);
        })
        .finally(() => {
          setLoadingCounts(false);
        });
    }
  }, [isOpen]);

  if (!isOpen || !user) return null;

  const handleStartMigration = async () => {
    setMigrating(true);
    setMigrationError(null);
    setProgressPercent(10);
    setProgressMsg('Initiating journal upload...');

    try {
      const res = await migrateLocalDataToCloud(user.id, (step, percent) => {
        setProgressMsg(step);
        setProgressPercent(percent);
      });
      setResult(res);
      onMigrationComplete();
    } catch (err) {
      setMigrationError((err as Error).message || 'Migration encountered an error.');
    } finally {
      setMigrating(false);
    }
  };

  const hasAnyData =
    counts &&
    (counts.reportsCount > 0 ||
      counts.templatesCount > 0 ||
      counts.hasDraft ||
      counts.imagesCount > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upload Local Journal to Cloud"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-app-main border border-app rounded-lg shadow-xl overflow-hidden text-app-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-emerald-theme" />
            <span className="font-bold text-sm tracking-tight">
              Upload Journal to Account
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-app-secondary hover:text-app-main rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-app-secondary leading-relaxed">
            Upload this browser&apos;s existing journal to your account? All analytical fields,
            dates, price strings, and chart screenshots will be securely preserved in your cloud database.
          </p>

          {loadingCounts ? (
            <div className="text-center py-6 text-xs text-app-secondary">
              Inspecting local IndexedDB records...
            </div>
          ) : !hasAnyData ? (
            <div className="p-4 rounded border border-dashed border-app bg-app-field/50 text-center text-xs text-app-secondary">
              No local reports, templates, or screenshots found in this browser.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="p-3 rounded bg-app-secondary border border-app flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-emerald-theme" />
                <div>
                  <div className="text-xs font-bold text-app-main">
                    {counts.reportsCount} Reports
                  </div>
                  <div className="text-[10px] text-app-secondary">Saved analyses</div>
                </div>
              </div>

              <div className="p-3 rounded bg-app-secondary border border-app flex items-center gap-2.5">
                <Bookmark className="w-4 h-4 text-emerald-theme" />
                <div>
                  <div className="text-xs font-bold text-app-main">
                    {counts.templatesCount} Templates
                  </div>
                  <div className="text-[10px] text-app-secondary">Saved setups</div>
                </div>
              </div>

              <div className="p-3 rounded bg-app-secondary border border-app flex items-center gap-2.5">
                <ImageIcon className="w-4 h-4 text-emerald-theme" />
                <div>
                  <div className="text-xs font-bold text-app-main">
                    {counts.imagesCount} Screenshots
                  </div>
                  <div className="text-[10px] text-app-secondary">Private chart images</div>
                </div>
              </div>

              <div className="p-3 rounded bg-app-secondary border border-app flex items-center gap-2.5">
                <Edit3 className="w-4 h-4 text-emerald-theme" />
                <div>
                  <div className="text-xs font-bold text-app-main">
                    {counts.hasDraft ? '1 Active' : 'None'}
                  </div>
                  <div className="text-[10px] text-app-secondary">Unfinished draft</div>
                </div>
              </div>
            </div>
          )}

          {/* Progress Indicator */}
          {migrating && (
            <div className="space-y-1.5 p-3 rounded bg-app-field border border-app text-xs">
              <div className="flex items-center justify-between text-[11px] font-medium">
                <span className="text-emerald-theme">{progressMsg}</span>
                <span className="font-mono text-app-secondary">{progressPercent}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-theme h-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {migrationError && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Migration failed: </span>
                <span>{migrationError}</span>
              </div>
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className="p-3 rounded bg-emerald-pale text-emerald-theme border border-emerald-500/40 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">Upload Completed Successfully!</div>
                <div className="text-[11px] text-app-main mt-0.5">
                  Uploaded {result.uploadedReports} report(s), {result.uploadedTemplates} template(s), and {result.uploadedImages} chart screenshot(s) to your private account storage.
                  {result.skippedReports > 0 && ` (${result.skippedReports} existing record(s) kept untouched)`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-app bg-app-secondary flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded"
          >
            {result ? 'Done' : 'Not Now'}
          </button>

          {!result && hasAnyData && (
            <button
              type="button"
              disabled={migrating}
              onClick={handleStartMigration}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors disabled:opacity-40"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {migrating ? 'Uploading...' : 'Confirm & Upload to Cloud'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
