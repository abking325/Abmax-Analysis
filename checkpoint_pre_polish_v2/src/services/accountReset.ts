import { createClient, User } from '@supabase/supabase-js';
import {
  clearLocalAccountDataForReset,
  getLocalResetScopeCounts,
  LocalResetScopeCounts,
} from './db';
import { resetCloudDraftVersionTracking } from './cloudSync';
import { supabase, supabaseKey, supabaseUrl } from './supabase';

export const REQUIRED_RESET_CONFIRMATION = 'RESET ALL MY DATA';
export const MAX_FRESH_AUTH_AGE_MS = 5 * 60 * 1000;

export interface ServerResetAvailability {
  available: boolean;
  edgeFunctionDeployed: boolean;
  schemaDeployed: boolean;
  reason: string;
  missingSteps: string[];
}

export interface FreshAuthProof {
  verified: boolean;
  method: 'password' | 'oauth_recent';
  verifiedAt: number;
  reauthPassword?: string;
}

export interface AccountResetPreview {
  accountId: string;
  email: string;
  localCounts: LocalResetScopeCounts;
  willDelete: string[];
  willPreserve: string[];
}

export interface ExecuteAccountResetResult {
  success: boolean;
  unavailable?: boolean;
  resetEpoch?: number;
  deletedCounts?: Record<string, number>;
  localCleared?: Awaited<ReturnType<typeof clearLocalAccountDataForReset>>;
  error?: string;
}

export function validateResetConfirmationPhrase(input: string): boolean {
  return (input || '').trim() === REQUIRED_RESET_CONFIRMATION;
}

export async function getAccountResetPreview(user: User): Promise<AccountResetPreview> {
  const localCounts = await getLocalResetScopeCounts(user.id);
  return {
    accountId: user.id,
    email: user.email || user.id,
    localCounts,
    willDelete: [
      `Cloud & local Analysis Reports (${localCounts.reportsCount} local record(s) + cloud synced reports)`,
      `Saved Templates (${localCounts.templatesCount} local record(s) + cloud templates)`,
      `Chart Screenshots & Image Attachments (${localCounts.estimatedImagesCount} local image(s) + cloud storage)`,
      `Local Trading Journal & My Journal Entries (${localCounts.journalCount} record(s))`,
      `Local Saved Strategies (${localCounts.strategiesCount} record(s))`,
      `Local Live Workspace Watchlists & Scenarios (${localCounts.hasLiveWorkspace ? 'Active' : 'Empty'})`,
      `In-progress Drafts, Scoped Preferences & Custom Instruments (${localCounts.scopedDraftsCount} scoped draft(s))`,
    ],
    willPreserve: [
      `Your login identity and credentials (${user.email || user.id}) — you remain signed in`,
      `Other users' local accounts & guest data (${localCounts.preservedForeignAccountsCount} foreign scope(s) untouched)`,
      'Authoritative server reset epoch to block stale offline devices from restoring deleted records',
    ],
  };
}

/**
 * Safe, strictly read-only capability check verifying whether both the Edge Function
 * (`reset-account-data`) and the schema (`public.user_reset_epochs`) are deployed on Supabase.
 * Never mutates or deletes any user data.
 */
export async function checkServerAccountResetAvailability(
  userId?: string | null,
  options?: {
    client?: any;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    anonKey?: string;
  }
): Promise<ServerResetAvailability> {
  const missingSteps: string[] = [];
  const client = options?.client ?? supabase;
  const fetchFn = options?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  const baseUrl = (options?.baseUrl ?? supabaseUrl).replace(/\/+$/, '');
  const anonKey = options?.anonKey ?? supabaseKey;

  if (!client || !userId) {
    return {
      available: false,
      edgeFunctionDeployed: false,
      schemaDeployed: false,
      reason: 'Sign in with a verified cloud account before checking server reset availability.',
      missingSteps: ['Sign in to an active Supabase account'],
    };
  }

  let edgeFunctionDeployed = false;
  let schemaDeployed = false;

  // 1. Read-only GET ping against Edge Function capability endpoint
  if (fetchFn && baseUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetchFn(`${baseUrl}/functions/v1/reset-account-data`, {
          method: 'GET',
          headers: anonKey ? { apikey: anonKey } : {},
          signal: controller.signal,
        });
        if (res.ok) {
          const json = (await res.json().catch(() => null)) as { deployed?: boolean } | null;
          if (json?.deployed === true) {
            edgeFunctionDeployed = true;
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      edgeFunctionDeployed = false;
    }
  }

  // 2. Read-only SELECT check on public.user_reset_epochs
  try {
    const { error } = await client
      .from('user_reset_epochs')
      .select('reset_epoch')
      .eq('user_id', userId)
      .maybeSingle();

    if (!error) {
      schemaDeployed = true;
    } else {
      const msg = (error.message || '').toLowerCase();
      const code = (error as any).code || '';
      const isMissing =
        code === 'PGRST205' ||
        code === '42P01' ||
        msg.includes('could not find the table') ||
        msg.includes('does not exist');
      schemaDeployed = !isMissing;
    }
  } catch {
    schemaDeployed = false;
  }

  if (!schemaDeployed) {
    missingSteps.push(
      'Apply SQL migration supabase/migrations/20261115000000_account_reset_barrier.sql (creates user_reset_epochs, barrier triggers, and reset_user_account_data RPC)'
    );
  }
  if (!edgeFunctionDeployed) {
    missingSteps.push(
      'Deploy Edge Function supabase/functions/reset-account-data with SUPABASE_SERVICE_ROLE_KEY configured'
    );
  }

  const available = edgeFunctionDeployed && schemaDeployed;
  return {
    available,
    edgeFunctionDeployed,
    schemaDeployed,
    reason: available
      ? 'Server-side authoritative account reset is available.'
      : 'Full account-data reset is currently unavailable because the required server-side migration and/or Edge Function are not yet deployed to Supabase.',
    missingSteps,
  };
}

/**
 * Verifies fresh authentication before allowing a destructive account-data reset.
 * Uses an isolated non-persisted Supabase auth client for password verification so the active
 * user session is cleanly preserved without touching localStorage.
 */
export async function verifyFreshAuthForReset(params: {
  user: User;
  mode: 'password' | 'oauth_recent';
  password?: string;
  verifyPasswordFn?: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ ok: boolean; proof?: FreshAuthProof; error?: string }> {
  const { user, mode, password, verifyPasswordFn } = params;
  const now = Date.now();

  if (mode === 'password') {
    const email = user.email?.trim();
    if (!email) {
      return { ok: false, error: 'This account does not have a verified email address for password re-authentication.' };
    }
    if (!password || password.length === 0) {
      return { ok: false, error: 'Enter your current account password to complete fresh authentication.' };
    }

    if (verifyPasswordFn) {
      const custom = await verifyPasswordFn(email, password);
      if (!custom.ok) {
        return { ok: false, error: custom.error || 'Password verification failed.' };
      }
      return {
        ok: true,
        proof: { verified: true, method: 'password', verifiedAt: now, reauthPassword: password },
      };
    }

    if (!supabaseUrl || !supabaseKey) {
      return { ok: false, error: 'Supabase configuration unavailable.' };
    }

    const scratchClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await scratchClient.auth.signInWithPassword({ email, password });
    if (error || !data.user || data.user.id !== user.id) {
      return { ok: false, error: error?.message || 'Incorrect password. Re-authentication failed.' };
    }

    return {
      ok: true,
      proof: { verified: true, method: 'password', verifiedAt: now, reauthPassword: password },
    };
  }

  // OAuth / recent sign-in verification
  const lastSignInMs = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
  if (!Number.isFinite(lastSignInMs) || now - lastSignInMs > MAX_FRESH_AUTH_AGE_MS) {
    return {
      ok: false,
      error: 'Your session is older than 5 minutes. Sign out and sign back in fresh via Google OAuth to reset account data.',
    };
  }

  return {
    ok: true,
    proof: { verified: true, method: 'oauth_recent', verifiedAt: now },
  };
}

/**
 * Executes protected full account-data reset.
 * Refuses to run if:
 *  - User is not signed in
 *  - Server-side reset capability is not verified as deployed
 *  - Fresh authentication proof is missing or expired (> 5 minutes)
 *  - Destructive confirmation phrase does not exactly match 'RESET ALL MY DATA'
 */
export async function executeProtectedAccountReset(params: {
  user: User | null;
  confirmationPhrase: string;
  freshAuth: FreshAuthProof | null;
  client?: any;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  anonKey?: string;
}): Promise<ExecuteAccountResetResult> {
  const { user, confirmationPhrase, freshAuth } = params;
  const client = params.client ?? supabase;
  const fetchFn = params.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  const baseUrl = (params.baseUrl ?? supabaseUrl).replace(/\/+$/, '');
  const anonKey = params.anonKey ?? supabaseKey;

  if (!user || !client) {
    return {
      success: false,
      unavailable: true,
      error: 'You must be signed in to execute a full account-data reset.',
    };
  }

  if (!freshAuth?.verified || Date.now() - freshAuth.verifiedAt > MAX_FRESH_AUTH_AGE_MS) {
    return {
      success: false,
      error: 'Fresh authentication is required (within the last 5 minutes).',
    };
  }

  if (!validateResetConfirmationPhrase(confirmationPhrase)) {
    return {
      success: false,
      error: `Type the exact confirmation phrase "${REQUIRED_RESET_CONFIRMATION}".`,
    };
  }

  const availability = await checkServerAccountResetAvailability(user.id, {
    client,
    fetchImpl: fetchFn,
    baseUrl,
    anonKey,
  });

  if (!availability.available) {
    return {
      success: false,
      unavailable: true,
      error: availability.reason,
    };
  }

  if (!fetchFn) {
    return {
      success: false,
      unavailable: true,
      error: 'Network fetch implementation is unavailable.',
    };
  }

  try {
    const sessionRes = await client.auth.getSession();
    const accessToken = sessionRes?.data?.session?.access_token;
    if (!accessToken) {
      return {
        success: false,
        error: 'Active authentication token missing. Sign in again to continue.',
      };
    }

    const res = await fetchFn(`${baseUrl}/functions/v1/reset-account-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(anonKey ? { apikey: anonKey } : {}),
      },
      body: JSON.stringify({
        confirmationPhrase: confirmationPhrase.trim(),
        reauthPassword: freshAuth.reauthPassword,
        reauthVerifiedAt: freshAuth.verifiedAt,
      }),
    });

    const payload = (await res.json().catch(() => null)) as {
      ok?: boolean;
      resetEpoch?: number;
      deletedCounts?: Record<string, number>;
      error?: string;
    } | null;

    if (!res.ok || !payload?.ok) {
      return {
        success: false,
        unavailable: res.status === 404,
        error: payload?.error || `Server reset rejected (HTTP ${res.status}). No data was wiped.`,
      };
    }

    const resetEpoch = typeof payload.resetEpoch === 'number' ? payload.resetEpoch : 1;
    const localCleared = await clearLocalAccountDataForReset(user.id, resetEpoch);
    resetCloudDraftVersionTracking(user.id);

    return {
      success: true,
      resetEpoch,
      deletedCounts: payload.deletedCounts || {},
      localCleared,
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error)?.message || 'Failed to execute server-side account reset.',
    };
  }
}
