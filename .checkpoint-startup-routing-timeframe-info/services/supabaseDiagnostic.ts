import { supabaseUrl, supabaseKey } from './supabase';

export type DiagnosticStatusLabel =
  | 'Service reachable'
  | 'Signed in'
  | 'Cloud save verified'
  | 'Checking'
  | 'Error'
  | 'Not configured';

export interface SupabaseDiagnosticDetails {
  status: DiagnosticStatusLabel;
  url: string;
  projectRef: string;
  statusCode?: number;
  latencyMs?: number;
  message: string;
  checkedAt: number;
}

// In-memory verification cache per user session
const verificationState = {
  cloudSaveVerified: false,
  screenshotStorageVerified: false,
  verifiedUserId: '',
  verifiedAt: 0,
};

export function setCloudVerifiedState(
  userId: string,
  cloudSave: boolean,
  screenshotStorage: boolean
) {
  verificationState.verifiedUserId = userId;
  verificationState.cloudSaveVerified = cloudSave;
  verificationState.screenshotStorageVerified = screenshotStorage;
  verificationState.verifiedAt = Date.now();
}

export function getCloudVerifiedState(userId?: string | null) {
  if (!userId || verificationState.verifiedUserId !== userId) {
    return {
      cloudSaveVerified: false,
      screenshotStorageVerified: false,
      verifiedAt: 0,
    };
  }
  return {
    cloudSaveVerified: verificationState.cloudSaveVerified,
    screenshotStorageVerified: verificationState.screenshotStorageVerified,
    verifiedAt: verificationState.verifiedAt,
  };
}

/**
 * Diagnostic utility that tests network reachability and HTTP response
 * from the configured Supabase instance using VITE_SUPABASE_URL.
 */
export async function checkSupabaseConnectivity(
  customUrl?: string,
  userSignedIn?: boolean,
  userId?: string | null
): Promise<SupabaseDiagnosticDetails> {
  const targetUrl = (
    customUrl ||
    supabaseUrl ||
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    ''
  )
    .trim()
    .replace(/\/rest\/v1\/?$/, '')
    .replace(/\/+$/, '');

  const key =
    supabaseKey || (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '';

  let projectRef = '';
  try {
    if (targetUrl.startsWith('http')) {
      const parsed = new URL(targetUrl);
      const hostParts = parsed.hostname.split('.');
      if (hostParts.length >= 3 && parsed.hostname.endsWith('supabase.co')) {
        projectRef = hostParts[0];
      }
    }
  } catch {
    // Ignore invalid URL format
  }

  if (!targetUrl) {
    return {
      status: 'Not configured',
      url: '',
      projectRef: '',
      message: 'VITE_SUPABASE_URL is not configured',
      checkedAt: Date.now(),
    };
  }

  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const headers: Record<string, string> = {};
    if (key) {
      headers['apikey'] = key;
    }

    const response = await fetch(`${targetUrl}/auth/v1/health`, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - startTime);
    const detectedRef = response.headers.get('sb-project-ref') || projectRef;

    const isReachable = response.ok || response.status === 401;

    if (!isReachable) {
      return {
        status: 'Error',
        url: targetUrl,
        projectRef: detectedRef,
        statusCode: response.status,
        latencyMs,
        message: `HTTP ${response.status} gateway error`,
        checkedAt: Date.now(),
      };
    }

    // Determine status according to exact requirements:
    // - "Service reachable" for successful gateway/Auth health check
    // - "Signed in" for authenticated session
    // - "Cloud save verified" only after authenticated database write/read succeeds
    const verified = getCloudVerifiedState(userId);

    let statusLabel: DiagnosticStatusLabel = 'Service reachable';
    if (userSignedIn) {
      if (verified.cloudSaveVerified) {
        statusLabel = 'Cloud save verified';
      } else {
        statusLabel = 'Signed in';
      }
    }

    return {
      status: statusLabel,
      url: targetUrl,
      projectRef: detectedRef,
      statusCode: response.status,
      latencyMs,
      message: `Gateway online (${latencyMs}ms)`,
      checkedAt: Date.now(),
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      status: 'Error',
      url: targetUrl,
      projectRef,
      latencyMs,
      message: err?.name === 'AbortError' ? 'Connection timed out (>8s)' : (err?.message || 'Network unreachable'),
      checkedAt: Date.now(),
    };
  }
}
