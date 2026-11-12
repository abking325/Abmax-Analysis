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
