import React from 'react';
import { Cloud, CloudCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { SyncState } from '../services/cloudSync';
import { useAuth } from '../context/AuthContext';

export type AccurateStatusState =
  | SyncState
  | 'saving_local'
  | 'saved_local'
  | 'pending_cloud'
  | 'synced'
  | 'failed';

interface SyncStatusBadgeProps {
  status: AccurateStatusState;
  lastSyncedAt?: number | null;
  onRetry?: () => void;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  lastSyncedAt,
  onRetry,
}) => {
  const { user, isConfigured } = useAuth();

  if (status === 'saving_local') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-theme">
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Saving on this device…</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Save failed — your analysis is still open</span>
      </div>
    );
  }

  if (!isConfigured || !user || status === 'saved_local' || status === 'local') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-app-secondary">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span>Saved on this device</span>
      </div>
    );
  }

  if (status === 'syncing' || status === 'pending_cloud') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-theme">
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Pending cloud sync</span>
      </div>
    );
  }

  if (status === 'synced') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-theme font-medium">
        <CloudCheck className="w-3.5 h-3.5" />
        <span>Synced</span>
        {lastSyncedAt && (
          <span className="text-[10px] text-app-secondary font-mono">
            ({new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
          </span>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-theme">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Pending cloud sync</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="underline hover:text-amber-800 dark:hover:text-amber-300 ml-1 cursor-pointer font-medium"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] text-app-secondary">
      <Cloud className="w-3 h-3 text-app-secondary" />
      <span>Saved on this device</span>
    </div>
  );
};
