import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
// Normalize URL: remove any trailing /rest/v1 or trailing slashes to ensure base URL format
export const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

export const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
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
