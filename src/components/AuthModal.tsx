import React, { useEffect, useState } from 'react';
import {
  X,
  Mail,
  Lock,
  LogOut,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Cloud,
  Database,
  RefreshCw,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  runFullCloudVerification,
  FullVerificationResult,
} from '../services/cloudVerification';
import {
  checkSupabaseConnectivity,
  setCloudVerifiedState,
} from '../services/supabaseDiagnostic';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMigration: () => void;
}

type AuthTab = 'signin' | 'signup' | 'forgot' | 'reset';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onOpenMigration,
}) => {
  const {
    user,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    isConfigured,
    isPasswordRecovery,
    clearPasswordRecovery,
  } = useAuth();

  const [tab, setTab] = useState<AuthTab>(isPasswordRecovery ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Cloud Diagnostics state (kept strictly inside Account when signed in)
  const [diagResult, setDiagResult] = useState<FullVerificationResult | null>(null);
  const [runningDiag, setRunningDiag] = useState(false);
  const [serviceLatencyMs, setServiceLatencyMs] = useState<number | undefined>(undefined);
  const [showDiagDetails, setShowDiagDetails] = useState(false);

  const executeVerification = async () => {
    if (!user) return;
    setRunningDiag(true);
    try {
      const res = await runFullCloudVerification();
      setDiagResult(res);
      setServiceLatencyMs(res.serviceLatencyMs);
      setCloudVerifiedState(user.id, res.cloudSaveVerified, res.screenshotStorageVerified);
    } finally {
      setRunningDiag(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (user) {
        checkSupabaseConnectivity(undefined, true, user.id).then((diag) => {
          setServiceLatencyMs(diag.latencyMs);
        });
        executeVerification();
      }
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const { error } = await signIn(email.trim(), password);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg('Signed in successfully!');
        setTimeout(() => {
          onClose();
          onOpenMigration();
        }, 500);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const { error, needsEmailConfirmation } = await signUp(email.trim(), password);
      if (error) {
        setErrorMsg(error.message);
      } else if (needsEmailConfirmation) {
        setSuccessMsg(
          'Confirmation link sent! Please check your email to verify your account.'
        );
      } else {
        setSuccessMsg('Account created and signed in!');
        setTimeout(() => {
          onClose();
          onOpenMigration();
        }, 600);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const { error } = await resetPassword(email.trim());
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg('Password reset link sent to your email.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccessMsg('Password successfully updated!');
        clearPasswordRecovery();
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    await signOut();
    setLoading(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={user ? 'Account' : 'Sign In'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-app-main border border-app rounded-lg shadow-xl overflow-hidden text-app-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app bg-app-secondary">
          <span className="font-semibold text-xs tracking-tight text-app-main">
            {user ? 'Account' : 'Account'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-app-secondary hover:text-app-main rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4">
          {user ? (
            /* ================= SIGNED IN VIEW (Account + Diagnostics) ================= */
            <div className="space-y-4">
              {/* User Identity */}
              <div className="p-3 rounded bg-app-secondary border border-app space-y-2 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-theme/20 text-emerald-theme flex items-center justify-center font-bold text-sm shrink-0">
                    {user.email?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-app-main text-xs truncate">
                      {user.email}
                    </div>
                    <div className="text-[11px] text-emerald-theme font-medium flex items-center gap-1 mt-0.5">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>Cloud Sync Active</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cloud Diagnostics (Kept inside Account) */}
              <div className="p-3 rounded-lg border border-app bg-app-secondary space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-app-main flex items-center gap-1.5 text-xs">
                    <Database className="w-3.5 h-3.5 text-emerald-theme" />
                    Cloud Diagnostic Status
                  </span>
                  <button
                    type="button"
                    disabled={runningDiag}
                    onClick={executeVerification}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-emerald-theme hover:bg-emerald-pale transition-colors cursor-pointer disabled:opacity-50"
                    title="Run live safe database and screenshot storage verification probe"
                  >
                    <RefreshCw className={`w-3 h-3 ${runningDiag ? 'animate-spin' : ''}`} />
                    {runningDiag ? 'Testing...' : 'Test Now'}
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-1.5 pt-0.5">
                  {/* Gateway Health */}
                  <div className="flex items-center justify-between p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary text-[11px]">Service Reachability:</span>
                    <span className="font-semibold inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      Service reachable
                      {serviceLatencyMs !== undefined && (
                        <span className="text-[10px] text-app-secondary font-mono">
                          ({serviceLatencyMs}ms)
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Account Session */}
                  <div className="flex items-center justify-between p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary text-[11px]">Account Session:</span>
                    <span className="font-semibold inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      Signed in
                    </span>
                  </div>

                  {/* Database Cloud Save */}
                  <div className="flex items-center justify-between p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary text-[11px]">Database Cloud Save:</span>
                    <span
                      className={`font-semibold inline-flex items-center gap-1 text-[11px] ${
                        diagResult?.cloudSaveVerified
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {diagResult?.cloudSaveVerified ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          Cloud save verified
                        </>
                      ) : runningDiag ? (
                        'Verifying...'
                      ) : (
                        'Pending verification'
                      )}
                    </span>
                  </div>

                  {/* Screenshot Storage */}
                  <div className="flex items-center justify-between p-2 rounded bg-app-main border border-app">
                    <span className="text-app-secondary text-[11px]">Screenshot Storage:</span>
                    <span
                      className={`font-semibold inline-flex items-center gap-1 text-[11px] ${
                        diagResult?.screenshotStorageVerified
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {diagResult?.screenshotStorageVerified ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          Screenshot storage verified
                        </>
                      ) : runningDiag ? (
                        'Verifying bucket...'
                      ) : (
                        'Pending verification'
                      )}
                    </span>
                  </div>
                </div>

                {/* Verification Log */}
                {diagResult && (
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowDiagDetails((prev) => !prev)}
                      className="w-full flex items-center justify-between text-[11px] text-app-secondary hover:text-app-main py-1"
                    >
                      <span>Verification Step Log ({diagResult.steps.length} steps)</span>
                      {showDiagDetails ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {showDiagDetails && (
                      <div className="space-y-1 mt-1 p-2 rounded bg-app-field border border-app font-mono text-[10px] max-h-36 overflow-y-auto">
                        {diagResult.steps.map((st, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span
                              className={
                                st.status === 'passed'
                                  ? 'text-emerald-600 font-bold'
                                  : st.status === 'failed'
                                  ? 'text-rose-600 font-bold'
                                  : 'text-slate-500 font-bold'
                              }
                            >
                              [{st.status.toUpperCase()}]
                            </span>
                            <span className="text-app-main">{st.name}:</span>
                            <span className="text-app-secondary truncate">{st.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Sync and Sign Out Actions */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenMigration();
                  }}
                  className="w-full py-2 px-3 text-xs font-semibold text-app-main bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 border border-app rounded transition-colors text-left flex items-center justify-between"
                >
                  <span>Upload / Sync Local Journal to Cloud</span>
                  <Cloud className="w-3.5 h-3.5 text-emerald-theme" />
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSignOut}
                  className="w-full py-2 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded transition-colors flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {loading ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
            </div>
          ) : (
            /* ================= SIGN IN / CREATE ACCOUNT VIEW ================= */
            <div className="space-y-3.5">
              {/* Tab Selector: Only Sign In & Create Account */}
              {tab !== 'reset' && (
                <div className="flex items-center p-1 bg-app-field rounded-md border border-app text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className={`flex-1 py-1.5 text-center rounded transition-colors ${
                      tab === 'signin'
                        ? 'bg-app-main text-app-main font-semibold shadow-2xs'
                        : 'text-app-secondary hover:text-app-main'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signup');
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className={`flex-1 py-1.5 text-center rounded transition-colors ${
                      tab === 'signup'
                        ? 'bg-app-main text-app-main font-semibold shadow-2xs'
                        : 'text-app-secondary hover:text-app-main'
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              )}

              {/* Status alerts */}
              {errorMsg && (
                <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-2.5 rounded bg-emerald-pale text-emerald-theme border border-emerald-500/40 text-xs flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* 1. Sign In Tab */}
              {tab === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="trader@example.com"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-app-secondary">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setTab('forgot');
                          setErrorMsg(null);
                          setSuccessMsg(null);
                        }}
                        className="text-[11px] text-emerald-theme hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !isConfigured}
                    className="w-full py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors disabled:opacity-40"
                  >
                    {loading ? 'Signing in...' : 'Sign In to Account'}
                  </button>
                </form>
              )}

              {/* 2. Create Account Tab */}
              {tab === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="trader@example.com"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !isConfigured}
                    className="w-full py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors disabled:opacity-40"
                  >
                    {loading ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              )}

              {/* 3. Forgot Password */}
              {tab === 'forgot' && (
                <form onSubmit={handleForgotPassword} className="space-y-3">
                  <p className="text-xs text-app-secondary leading-normal">
                    Enter your email address and we&apos;ll send you a password reset link.
                  </p>
                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-3.5 h-3.5 text-app-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="trader@example.com"
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTab('signin')}
                      className="px-3 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded border border-app"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading || !isConfigured}
                      className="flex-1 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-40"
                    >
                      {loading ? 'Sending link...' : 'Send Reset Link'}
                    </button>
                  </div>
                </form>
              )}

              {/* 4. Reset Password */}
              {tab === 'reset' && (
                <form onSubmit={handleResetPassword} className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-theme">
                    <KeyRound className="w-4 h-4" />
                    <span>Set New Password</span>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-secondary mb-1">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs"
                  >
                    {loading ? 'Updating password...' : 'Update Password'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
