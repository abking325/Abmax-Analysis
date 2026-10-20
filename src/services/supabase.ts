import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables (safe for Vite browser and Node/tsx testing runtime)
const env = (typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env as Record<string, string | undefined>) : {}) as Record<string, string | undefined>;
const rawUrl = (env.VITE_SUPABASE_URL || '').trim();
// Normalize URL: remove any trailing /rest/v1 or trailing slashes to ensure base URL format
export const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

export const supabaseKey = (
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseKey &&
  supabaseUrl.startsWith('https://') &&
  supabaseUrl.includes('.supabase.co')
);

// Singleton Supabase Client
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'abmax_supabase_auth',
      },
    })
  : null;

/**
 * Returns the active standalone website redirect URL for confirmation and password resets.
 */
export function getAppRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}`;
}
