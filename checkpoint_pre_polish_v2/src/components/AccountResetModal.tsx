import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createFullBackup } from '../services/db';
import { exportTextOrDownload } from '../utils/nativeExport';
import {
  AccountResetPreview,
  checkServerAccountResetAvailability,
  executeProtectedAccountReset,
  FreshAuthProof,
  getAccountResetPreview,
  REQUIRED_RESET_CONFIRMATION,
  ServerResetAvailability,
  validateResetConfirmationPhrase,
  verifyFreshAuthForReset,
} from '../services/accountReset';
import { registerBackHandler } from '../utils/backNavigation';

interface AccountResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetCompleted?: () => Promise<void> | void;
}

export const AccountResetModal: React.FC<AccountResetModalProps> = ({
  isOpen,
  onClose,
  onResetCompleted,
}) => {
  const { user } = useAuth();
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [availability, setAvailability] = useState<ServerResetAvailability | null>(null);
  const [preview, setPreview] = useState<AccountResetPreview | null>(null);

  const [exportingBackup, setExportingBackup] = useState(false);
  const [backupDownloaded, setBackupDownloaded] = useState(false);

  const [authMode, setAuthMode] = useState<'password' | 'oauth_recent'>('password');
  const [passwordInput, setPasswordInput] = useState('');
  const [verifyingAuth, setVerifyingAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [freshAuth, setFreshAuth] = useState<FreshAuthProof | null>(null);

  const [confirmationInput, setConfirmationInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<string | null>(null);
  const [resetDoneNotice, setResetDoneNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPasswordInput('');
    setAuthError(null);
    setFreshAuth(null);
    setConfirmationInput('');
    setExecuteError(null);
    setResetDoneNotice(null);
    setBackupDownloaded(false);

    const provider = String((user?.app_metadata as any)?.provider || '').toLowerCase();
    setAuthMode(provider === 'google' || provider === 'oauth' ? 'oauth_recent' : 'password');

    if (!user) {
      setPreview(null);
      setAvailability({
        available: false,
        edgeFunctionDeployed: false,
        schemaDeployed: false,
        reason: 'Sign in with a verified account to perform a protected full account-data reset.',
        missingSteps: ['Sign in to an active account'],
      });
      return;
    }

    let mounted = true;
    setLoadingStatus(true);
    Promise.all([
      getAccountResetPreview(user),
      checkServerAccountResetAvailability(user.id),
    ])
      .then(([prevData, availData]) => {
        if (!mounted) return;
        setPreview(prevData);
        setAvailability(availData);
      })
      .catch(() => {
        if (!mounted) return;
        setAvailability({
          available: false,
          edgeFunctionDeployed: false,
          schemaDeployed: false,
          reason: 'Could not verify server-side reset deployment status.',
          missingSteps: [
            'Verify SQL migration supabase/migrations/20261115000000_account_reset_barrier.sql',
            'Verify Edge Function supabase/functions/reset-account-data',
          ],
        });
      })
      .finally(() => {
        if (mounted) setLoadingStatus(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !executing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unregBack = registerBackHandler(() => {
      if (!executing) onClose();
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unregBack();
    };
  }, [isOpen, executing, onClose]);

  if (!isOpen) return null;

  const handleDownloadBackupBeforeReset = async () => {
    if (!user) return;
    setExportingBackup(true);
    try {
      const backup = await createFullBackup(user.id);
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `abmax_pre_reset_backup_${new Date().toISOString().slice(0, 10)}.json`;
      await exportTextOrDownload(jsonStr, filename, 'application/json', 'ABMAX Pre-Reset Backup');
      setBackupDownloaded(true);
    } catch (err) {
      setExecuteError((err as Error)?.message || 'Failed to generate backup file.');
    } finally {
      setExportingBackup(false);
    }
  };

  const handleVerifyFreshAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setAuthError(null);
    setVerifyingAuth(true);
    try {
      const res = await verifyFreshAuthForReset({
        user,
        mode: authMode,
        password: passwordInput,
      });
      if (!res.ok || !res.proof) {
        setFreshAuth(null);
        setAuthError(res.error || 'Fresh authentication failed.');
      } else {
        setFreshAuth(res.proof);
        setPasswordInput('');
      }
    } finally {
      setVerifyingAuth(false);
    }
  };

  const isPhraseValid = validateResetConfirmationPhrase(confirmationInput);
  const canExecuteReset = Boolean(
    user &&
      availability?.available &&
      freshAuth?.verified &&
      isPhraseValid &&
      !executing &&
      !resetDoneNotice
  );

  const handleExecuteReset = async () => {
    if (!canExecuteReset || !user) return;
    setExecuting(true);
    setExecuteError(null);
    try {
      const result = await executeProtectedAccountReset({
        user,
        confirmationPhrase: confirmationInput,
        freshAuth,
      });
      if (!result.success) {
        setExecuteError(result.error || 'Protected account reset was rejected.');
        return;
      }
      setResetDoneNotice(
        `Account data reset completed (Server epoch ${result.resetEpoch}). Your login identity remains active.`
      );
      await onResetCompleted?.();
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Protected Full Account-Data Reset"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-3 sm:p-4 backdrop-blur-xs"
      onClick={() => {
        if (!executing) onClose();
      }}
    >
      <div
        className="w-full max-w-xl bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-xs text-app-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-app bg-rose-50/70 dark:bg-rose-950/30 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <h3 className="text-sm font-bold text-app-main">
              Protected Full Account-Data Reset
            </h3>
          </div>
          <button
            type="button"
            disabled={executing}
            onClick={onClose}
            aria-label="Close account reset dialog"
            className="p-1 text-app-secondary hover:text-app-main rounded cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* 1. Server Capability Check Banner */}
          {loadingStatus ? (
            <div className="p-3 rounded-lg border border-app bg-app-field flex items-center gap-2 text-app-secondary">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-theme shrink-0" />
              <span>Checking server reset endpoint and epoch barrier deployment...</span>
            </div>
          ) : availability && !availability.available ? (
            <div
              data-testid="reset-server-unavailable-banner"
              className="p-3.5 rounded-lg border border-amber-400/70 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 space-y-2"
            >
              <div className="flex items-start gap-2 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <span>Full Account-Data Reset Unavailable</span>
              </div>
              <p className="text-[11px] leading-relaxed">{availability.reason}</p>
              {availability.missingSteps.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-amber-300/60 dark:border-amber-800/60">
                  <div className="text-[10px] font-bold uppercase tracking-wider">
                    Required Backend Setup:
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                    {availability.missingSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : availability?.available ? (
            <div className="p-3 rounded-lg border border-emerald-400/60 bg-emerald-50/70 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Server reset Edge Function &amp; epoch barrier verified active.</span>
            </div>
          ) : null}

          {resetDoneNotice && (
            <div className="p-3.5 rounded-lg border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{resetDoneNotice}</span>
            </div>
          )}

          {/* 2. Explicit Scope */}
          {preview && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border border-rose-300/70 dark:border-rose-900/70 bg-rose-50/40 dark:bg-rose-950/15 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                  Will Be Permanently Deleted
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-app-main">
                  {preview.willDelete.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-lg border border-emerald-300/70 dark:border-emerald-900/70 bg-emerald-50/40 dark:bg-emerald-950/15 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Strictly Preserved
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-app-main">
                  {preview.willPreserve.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 3. Pre-Reset Backup Option */}
          {user && (
            <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 flex flex-wrap items-center justify-between gap-2.5">
              <div className="space-y-0.5 max-w-sm">
                <div className="font-bold text-app-main">Recommended: Export JSON Backup First</div>
                <p className="text-[11px] text-app-secondary">
                  Save an offline snapshot of your reports, journals, strategies, instruments, and Live notes before proceeding.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadBackupBeforeReset}
                disabled={exportingBackup || executing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-theme hover:bg-emerald-theme-hover text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {exportingBackup
                    ? 'Exporting...'
                    : backupDownloaded
                    ? 'Backup Downloaded'
                    : 'Download JSON Backup'}
                </span>
              </button>
            </div>
          )}

          {/* 4. Fresh Authentication Gate */}
          {user && (
            <form
              onSubmit={handleVerifyFreshAuth}
              className="p-3.5 rounded-lg border border-app bg-app-secondary/40 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 font-bold text-app-main">
                  <Lock className="w-3.5 h-3.5 text-emerald-theme" />
                  <span>Step 1: Fresh Authentication</span>
                </div>
                {freshAuth?.verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-pale text-emerald-theme text-[10px] font-bold border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified ({new Date(freshAuth.verifiedAt).toLocaleTimeString()})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="resetAuthMode"
                    checked={authMode === 'password'}
                    onChange={() => {
                      setAuthMode('password');
                      setAuthError(null);
                    }}
                  />
                  <span>Re-enter Password</span>
                </label>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="resetAuthMode"
                    checked={authMode === 'oauth_recent'}
                    onChange={() => {
                      setAuthMode('oauth_recent');
                      setAuthError(null);
                    }}
                  />
                  <span>Recent Sign-In (&le; 5 min)</span>
                </label>
              </div>

              {authMode === 'password' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={`Current password for ${user.email || 'account'}`}
                    autoComplete="current-password"
                    className="flex-1 min-w-[180px] px-2.5 py-1.5 rounded bg-app-main border border-app text-xs text-app-main"
                  />
                  <button
                    type="submit"
                    disabled={verifyingAuth || !passwordInput}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-app-main border border-app hover:border-emerald-500 text-app-main cursor-pointer disabled:opacity-50"
                  >
                    {verifyingAuth ? 'Verifying...' : 'Verify Identity'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-app-secondary">
                    Verifies your current session signed in within the last 5 minutes.
                  </span>
                  <button
                    type="submit"
                    disabled={verifyingAuth}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-app-main border border-app hover:border-emerald-500 text-app-main cursor-pointer disabled:opacity-50"
                  >
                    {verifyingAuth ? 'Checking...' : 'Check Recent Sign-In'}
                  </button>
                </div>
              )}

              {authError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                  {authError}
                </div>
              )}
            </form>
          )}

          {/* 5. Destructive Confirmation */}
          {user && (
            <div className="p-3.5 rounded-lg border border-rose-300/70 dark:border-rose-900/70 bg-app-secondary/40 space-y-2">
              <div className="font-bold text-app-main">
                Step 2: Destructive Confirmation
              </div>
              <p className="text-[11px] text-app-secondary">
                Type{' '}
                <code className="px-1.5 py-0.5 rounded bg-app-field border border-app font-mono font-bold text-rose-600 dark:text-rose-400">
                  {REQUIRED_RESET_CONFIRMATION}
                </code>{' '}
                exactly to unlock the permanent reset action. Pending sync operations and pre-reset device queues will be blocked by the server reset epoch.
              </p>
              <input
                type="text"
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder={REQUIRED_RESET_CONFIRMATION}
                aria-label="Destructive confirmation phrase"
                className="w-full px-3 py-1.5 rounded bg-app-main border border-app font-mono text-xs text-app-main"
              />
            </div>
          )}

          {executeError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px]">
              {executeError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-app bg-app-secondary shrink-0">
          <button
            type="button"
            disabled={executing}
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium text-app-secondary hover:text-app-main border border-app bg-app-main cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canExecuteReset}
            onClick={handleExecuteReset}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title={
              !availability?.available
                ? 'Unavailable until server migration and Edge Function are deployed'
                : !freshAuth?.verified
                ? 'Complete Step 1 fresh authentication first'
                : !isPhraseValid
                ? `Type ${REQUIRED_RESET_CONFIRMATION} first`
                : 'Permanently delete your account data'
            }
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {executing
                ? 'Resetting Account Data...'
                : !availability?.available
                ? 'Reset Unavailable (Server Setup Required)'
                : 'Permanently Reset Account Data'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
