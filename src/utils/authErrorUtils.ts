import { supabaseUrl } from '../services/supabase';

export interface FormattedAuthError {
  headline: string;
  details?: string;
  isConnectionError: boolean;
  endpoint?: string;
}

/**
 * Distinguishes connection / network / DNS / project reachability problems
 * from authentication credential rejections and rate limits.
 * Sanitizes outputs to ensure no tokens or passwords are ever exposed.
 */
export function formatAuthError(err: { message?: string; name?: string; status?: number } | string | null): FormattedAuthError {
  if (!err) return { headline: '', isConnectionError: false };

  const rawMsg = (typeof err === 'string' ? err : err.message || '').trim();
  const lower = rawMsg.toLowerCase();

  // Detect connection, DNS, timeout, or unreachable gateway errors
  const isConn =
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('abort') ||
    lower.includes('enotfound') ||
    lower.includes('timeout') ||
    lower.includes('connection refused') ||
    lower.includes('gateway error') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('authretryablefetcherror');

  if (isConn) {
    return {
      headline: 'Cannot connect to Supabase authentication server (Failed to fetch).',
      details:
        `The app could not establish a connection to the cloud backend at ${supabaseUrl || 'the configured Supabase URL'}. ` +
        'This typically occurs when: (1) The device has no internet connection, (2) The Supabase free-tier project is paused due to inactivity (visit your Supabase Dashboard to unpause/restore it), or (3) DNS cannot resolve the project subdomain.',
      isConnectionError: true,
      endpoint: supabaseUrl,
    };
  }

  // Detect credential failures
  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid credentials') ||
    lower.includes('invalid email or password')
  ) {
    return {
      headline: 'Invalid email address or password.',
      details: 'Please check your email and password, or use "Forgot password?" to send a password reset link.',
      isConnectionError: false,
    };
  }

  // Detect unconfirmed email
  if (lower.includes('email not confirmed')) {
    return {
      headline: 'Email address has not been confirmed yet.',
      details: 'Please check your inbox or spam folder for the confirmation email or 6-digit verification code.',
      isConnectionError: false,
    };
  }

  // Detect already registered user
  if (lower.includes('user already registered') || lower.includes('already exists')) {
    return {
      headline: 'An account with this email address already exists.',
      details: 'Please switch to "Sign In" or request a password reset if you forgot your password.',
      isConnectionError: false,
    };
  }

  // Detect OAuth cancellation
  if (
    lower.includes('oauth_cancelled') ||
    lower.includes('user cancelled') ||
    lower.includes('access_denied') ||
    lower.includes('cancelled google sign-in')
  ) {
    return {
      headline: 'Google sign-in was cancelled.',
      details: 'No changes were made to your current session or unsaved drafts.',
      isConnectionError: false,
    };
  }

  // Detect unenabled or misconfigured OAuth provider
  if (
    lower.includes('not enabled') ||
    lower.includes('unsupported provider') ||
    lower.includes('provider is not enabled')
  ) {
    return {
      headline: 'Google sign-in is not enabled on the backend yet.',
      details:
        'Enable the Google OAuth provider in Supabase Authentication → Providers and configure your Google Cloud OAuth credentials, or sign in using email and password.',
      isConnectionError: false,
    };
  }

  // Detect redirect URL allowlist or mismatch errors
  if (
    lower.includes('redirect_uri_mismatch') ||
    lower.includes('redirect url') ||
    lower.includes('redirect_to') ||
    lower.includes('requested path is invalid')
  ) {
    return {
      headline: 'Google OAuth redirect URL is not allowlisted.',
      details:
        'Add your web origin and com.abmax.analysis://auth/callback to Supabase Authentication → URL Configuration → Redirect URLs, and authorize the Supabase callback URL in Google Cloud Console.',
      isConnectionError: false,
    };
  }

  // Detect expired OAuth code / state
  if (lower.includes('expired') || lower.includes('invalid_grant') || lower.includes('flow state')) {
    return {
      headline: 'Sign-in session expired or was already completed.',
      details: 'Please tap Continue with Google again to start a fresh sign-in.',
      isConnectionError: false,
    };
  }

  // Detect rate limits
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      headline: 'Security rate limit reached. Please wait a moment.',
      details: 'Too many requests were sent in a short window. Please wait 60 seconds before trying again.',
      isConnectionError: false,
    };
  }

  // Default fallback for other Supabase messages
  return {
    headline: rawMsg || 'Authentication failed. Please try again.',
    isConnectionError: false,
  };
}

export interface ParsedOAuthCallback {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  type: string | null;
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  hasAuthPayload: boolean;
}

/**
 * Safely parses OAuth and recovery parameters across both query string and URL hash fragments
 * without exposing or logging tokens.
 */
export function parseOAuthCallbackParams(rawUrl: string): ParsedOAuthCallback {
  const empty: ParsedOAuthCallback = {
    code: null,
    accessToken: null,
    refreshToken: null,
    type: null,
    error: null,
    errorCode: null,
    errorDescription: null,
    hasAuthPayload: false,
  };
  if (!rawUrl || typeof rawUrl !== 'string') return empty;

  let searchStr = '';
  let hashStr = '';

  const hashIdx = rawUrl.indexOf('#');
  const beforeHash = hashIdx >= 0 ? rawUrl.slice(0, hashIdx) : rawUrl;
  hashStr = hashIdx >= 0 ? rawUrl.slice(hashIdx + 1) : '';
  const queryIdx = beforeHash.indexOf('?');
  searchStr = queryIdx >= 0 ? beforeHash.slice(queryIdx + 1) : '';

  const searchParams = new URLSearchParams(searchStr);
  const hashParams = new URLSearchParams(hashStr);
  const getParam = (name: string): string | null =>
    hashParams.get(name) || searchParams.get(name) || null;

  const code = getParam('code');
  const accessToken = getParam('access_token');
  const refreshToken = getParam('refresh_token');
  const type = getParam('type');
  const error = getParam('error');
  const errorCode = getParam('error_code');
  const errorDescription = getParam('error_description');

  const hasAuthPayload = Boolean(
    code || accessToken || error || errorCode || errorDescription || type === 'recovery'
  );

  return {
    code,
    accessToken,
    refreshToken,
    type,
    error,
    errorCode,
    errorDescription,
    hasAuthPayload,
  };
}

