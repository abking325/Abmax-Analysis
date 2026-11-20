import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables (safe for Vite browser and Node/tsx testing runtime)
const env = (typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env as Record<string, string | undefined>) : {}) as Record<string, string | undefined>;
const rawUrl = (env.VITE_SUPABASE_URL || 'https://fxzurpdymuhlfkdxfgel.supabase.co').trim();
// Normalize URL: remove any trailing /rest/v1 or trailing slashes to ensure base URL format
export const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

export const supabaseKey = (
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_4YIOKlRXAjiSiVlHVU7OaA_-hdCJi-_'
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
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'abmax_supabase_auth',
        storage: authStorage,
      },
    })
  : null;

export const NATIVE_OAUTH_CALLBACK_URL = 'com.abmax.analysis://auth/callback';

/**
 * Returns the active website redirect URL for email confirmations / password resets.
 * On native mobile Capacitor origins (capacitor:// or ionic://), routes to the production web app.
 * On localhost/preview/production web origins, preserves the active web origin + pathname cleanly.
 */
export function getAppRedirectUrl(): string {
  const siteUrl = (env.VITE_SITE_URL || '').trim() || 'https://abmax-analysis.pages.dev';
  if (typeof window === 'undefined' || !window.location) return siteUrl;
  const origin = window.location.origin;
  if (
    !origin ||
    origin === 'https://localhost' ||
    origin === 'http://localhost' ||
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin === 'file://'
  ) {
    return siteUrl;
  }
  const cleanPath = window.location.pathname && window.location.pathname !== '/'
    ? window.location.pathname
    : '';
  return `${origin}${cleanPath}`;
}

/**
 * Returns the exact OAuth redirect URL for Google Sign-In on Native vs Web.
 */
export function getOAuthRedirectUrl(isNative: boolean): string {
  if (isNative) {
    return NATIVE_OAUTH_CALLBACK_URL;
  }
  return getAppRedirectUrl();
}

