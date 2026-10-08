import React from 'react';
import { Cloud, CloudCheck, RefreshCw, AlertCircle } from 'lucide-react';
import { SyncState } from '../services/cloudSync';
import { useAuth } from '../context/AuthContext';

interface SyncStatusBadgeProps {
  status: SyncState;
  lastSyncedAt?: number | null;
  onRetry?: () => void;
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  lastSyncedAt,
  onRetry,
}) => {
  const { user, isConfigured } = useAuth();

  if (!isConfigured || !user) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-app-secondary">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
        <span>Saved locally (IndexedDB)</span>
      </div>
    );
  }

  if (status === 'syncing') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-theme">
        <RefreshCw className="w-3 h-3 animate-spin" />
        <span>Syncing to account...</span>
      </div>
    );
  }

  if (status === 'synced') {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] text-emerald-theme">
        <CloudCheck className="w-3.5 h-3.5" />
        <span>Synced to Cloud</span>
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
        <span>Sync pending</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="underline hover:text-amber-800 dark:hover:text-amber-300 ml-1"
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
      <span>Saved locally</span>
    </div>
  );
};
