// ============================================================================
// Supabase Edge Function: reset-account-data
// Purpose: Server-authoritative full account-data reset for ABMAX Analysis
// Security:
//   - Requires valid Supabase Bearer JWT (auth.getUser)
//   - Enforces fresh authentication (password re-verification OR recent sign-in <= 5m)
//   - Enforces explicit confirmation phrase ('RESET ALL MY DATA')
//   - Purges user Storage objects under '<user.id>/' in 'chart-images'
//   - Calls atomic PostgreSQL RPC `reset_user_account_data` to clear user tables
//     and advance `user_reset_epochs.reset_epoch` while preserving `auth.users`
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const REQUIRED_CONFIRMATION = 'RESET ALL MY DATA';
const MAX_FRESH_AUTH_AGE_MS = 5 * 60 * 1000;

async function purgeUserStorageFolder(
  supabaseAdmin: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string
): Promise<number> {
  let removedCount = 0;
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data: items, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      throw new Error(`Storage list failed for ${prefix}: ${error.message}`);
    }
    if (!items || items.length === 0) break;

    const filesToDelete: string[] = [];
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        // Folder entry -> recurse
        removedCount += await purgeUserStorageFolder(supabaseAdmin, bucket, fullPath);
      } else {
        filesToDelete.push(fullPath);
      }
    }

    if (filesToDelete.length > 0) {
      const { error: remError } = await supabaseAdmin.storage
        .from(bucket)
        .remove(filesToDelete);
      if (remError) {
        throw new Error(`Storage remove failed for ${prefix}: ${remError.message}`);
      }
      removedCount += filesToDelete.length;
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return removedCount;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Safe read-only capability check (mutates nothing)
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        ok: true,
        deployed: true,
        action: 'reset-account-data',
        requiresFreshAuth: true,
        confirmationPhrase: REQUIRED_CONFIRMATION,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'unauthenticated',
          error: 'Unauthorized: Valid user session required.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'misconfigured',
          error: 'Server environment secrets are incomplete for account reset.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const token = authHeader.replace('Bearer ', '').trim();
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'unauthenticated',
          error: 'Invalid or expired Supabase user session.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      confirmationPhrase?: string;
      reauthPassword?: string;
      reauthVerifiedAt?: number;
    };

    if (body.confirmationPhrase !== REQUIRED_CONFIRMATION) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'confirmation_required',
          error: `Type exact confirmation phrase "${REQUIRED_CONFIRMATION}" to proceed.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enforce fresh authentication:
    // Case A: Password re-verification provided -> verify directly with Auth API
    let freshAuthVerified = false;
    if (typeof body.reauthPassword === 'string' && body.reauthPassword.length > 0 && user.email) {
      const scratchAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: reauthData, error: reauthErr } = await scratchAuthClient.auth.signInWithPassword({
        email: user.email,
        password: body.reauthPassword,
      });
      if (reauthErr || !reauthData.user || reauthData.user.id !== user.id) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: 'fresh_auth_failed',
            error: 'Fresh password verification failed. Account data was not modified.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      freshAuthVerified = true;
    } else {
      // Case B: OAuth / passwordless re-auth -> verify recent sign-in timestamp
      const lastSignInMs = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
      if (Number.isFinite(lastSignInMs) && Date.now() - lastSignInMs <= MAX_FRESH_AUTH_AGE_MS) {
        freshAuthVerified = true;
      }
    }

    if (!freshAuthVerified) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'fresh_auth_required',
          error: 'Recent re-authentication (within 5 minutes) is required before resetting account data.',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Purge private storage objects owned by this user
    const storageObjectsDeleted = await purgeUserStorageFolder(
      supabaseAdmin,
      'chart-images',
      user.id
    );

    // 2. Execute atomic DB reset & advance user reset_epoch via caller JWT
    const { data: rpcResult, error: rpcError } = await supabaseUser.rpc('reset_user_account_data', {
      p_confirmation: REQUIRED_CONFIRMATION,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'rpc_error',
          error: `Database reset failed: ${rpcError.message}`,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsed = (rpcResult || {}) as {
      reset_epoch?: number;
      reset_at?: string;
      deleted?: Record<string, number>;
    };

    return new Response(
      JSON.stringify({
        ok: true,
        resetEpoch: parsed.reset_epoch ?? 1,
        resetAt: parsed.reset_at ?? new Date().toISOString(),
        deletedCounts: {
          ...(parsed.deleted || {}),
          storageObjects: storageObjectsDeleted,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        status: 'internal_error',
        error: (err as Error)?.message || 'Unexpected server error during account reset.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
