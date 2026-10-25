import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Database } from 'lucide-react';
import {
  checkSupabaseConnectivity,
  DiagnosticStatusLabel,
  SupabaseDiagnosticDetails,
} from '../services/supabaseDiagnostic';
import { useAuth } from '../context/AuthContext';

interface SupabaseDiagnosticProps {
  buttonTabIndex?: number;
  onOpenAccountPanel?: () => void;
}

export const SupabaseDiagnostic: React.FC<SupabaseDiagnosticProps> = ({
  buttonTabIndex = 0,
  onOpenAccountPanel,
}) => {
  const { user } = useAuth();
  const [details, setDetails] = useState<SupabaseDiagnosticDetails>({
    status: 'Checking',
    url: '',
    projectRef: '',
    message: 'Testing Supabase service reachability...',
    checkedAt: Date.now(),
  });
  const [isChecking, setIsChecking] = useState(true);

  const runCheck = useCallback(async () => {
    setIsChecking(true);
    setDetails((prev) => ({ ...prev, status: 'Checking' }));
    try {
      const result = await checkSupabaseConnectivity(undefined, Boolean(user), user?.id);
      setDetails(result);
    } catch {
      setDetails({
        status: 'Error',
        url: '',
        projectRef: '',
        message: 'Unexpected error during diagnostic check',
        checkedAt: Date.now(),
      });
    } finally {
      setIsChecking(false);
    }
  }, [user]);

  // Run diagnostic check on mount or when auth state changes
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const { status, message } = details;

  return (
    <button
      type="button"
      tabIndex={buttonTabIndex}
      onClick={onOpenAccountPanel}
      aria-label={`Supabase status: ${status}. Click to open Account and Cloud Diagnostics panel.`}
      title={`Supabase status: ${status} (${message}) — Click to view Account & Diagnostics`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 cursor-pointer ${
        status === 'Cloud save verified'
          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100/90 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700'
          : status === 'Signed in'
          ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200 hover:bg-emerald-100/70 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800'
          : status === 'Service reachable'
          ? 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-800'
          : status === 'Checking'
          ? 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-400 dark:border-slate-800'
          : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
      }`}
    >
      {/* State Dot Indicator */}
      {status === 'Cloud save verified' ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
      ) : status === 'Signed in' ? (
        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
      ) : status === 'Service reachable' ? (
        <span className="h-2 w-2 rounded-full bg-emerald-500/80 shrink-0" />
      ) : status === 'Checking' ? (
        <RefreshCw className="w-3 h-3 text-slate-500 shrink-0 animate-spin" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
      )}

      {/* Concise Diagnostic Label - No permanent latency number prominently shown */}
      <span className="font-medium tracking-tight">
        {status}
      </span>
    </button>
  );
};
