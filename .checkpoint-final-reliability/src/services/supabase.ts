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

export const REMEMBER_ME_STORAGE_KEY = 'abmax_remember_login';

export const authStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const remember = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
      if (remember === 'false') {
        return window.sessionStorage.getItem(key);
      }
      return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    try {
      const remember = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
      if (remember === 'false') {
        window.sessionStorage.setItem(key, value);
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // safe fallback if storage is restricted
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // safe fallback
    }
  },
};

// Singleton Supabase Client
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'abmax_supabase_auth',
        storage: authStorage,
      },
    })
  : null;

/**
 * Returns the active standalone website redirect URL for confirmation and password resets.
 * On native mobile or localhost development, routes to the production web app to prevent broken https://localhost links.
 */
export function getAppRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  const siteUrl = (env.VITE_SITE_URL || '').trim() || 'https://abmax-analysis.pages.dev';
  const origin = window.location.origin;
  if (!origin || origin.includes('localhost') || origin.startsWith('capacitor://') || origin.startsWith('ionic://')) {
    return siteUrl;
  }
  return origin;
}
