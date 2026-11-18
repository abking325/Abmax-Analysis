import { supabase, supabaseUrl, supabaseKey, isSupabaseConfigured } from './supabase';
import { SavedReport, ReportPresentationConfig } from '../types/journal';
import { calculateOverallAlignment } from '../utils/analysisUtils';
import { uploadReportToCloud } from './cloudSync';

export interface SendTelegramOptions {
  report: SavedReport;
  pdfBlob: Blob;
  filename: string;
  requestId?: string;
  presentationConfig?: ReportPresentationConfig;
}

export type TelegramDeliveryStatus =
  | 'success'
  | 'failed'
  | 'uncertain'
  | 'offline'
  | 'unauthenticated'
  | 'unsynced'
  | 'unreachable'
  | 'missing_config'
  | 'forbidden'
  | 'telegram_rejected';

export interface TelegramDeliveryResult {
  ok: boolean;
  status: TelegramDeliveryStatus;
  requestId?: string;
  messageId?: number;
  chatId?: string;
  chatTitle?: string;
  deliveredAt?: string;
  alreadyDelivered?: boolean;
  error?: string;
}

/**
 * Sends a generated analysis report PDF directly to Telegram via the secure Supabase Edge Function.
 *
 * Security & Reliability guarantees:
 * - Bot token is strictly server-side in Supabase Secrets (never in client).
 * - Target group ID is enforced server-side (-1004337945630).
 * - Requires an authenticated Supabase user session.
 * - Report must be synchronized to Supabase cloud before sending, respecting revision conflicts.
 * - Client passes public API key and session Bearer token to gateway.
 * - Idempotency request tracking to prevent double-click duplicates.
 * - Explicit timeout handling to prevent duplicate posts on network lags.
 */
export async function sendReportToTelegram({
  report,
  pdfBlob,
  filename,
  requestId: providedRequestId,
}: SendTelegramOptions): Promise<TelegramDeliveryResult> {
  // 1. Check network connectivity
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      status: 'offline',
      requestId: providedRequestId,
      error: 'You are currently offline. An active internet connection is required to send reports to Telegram. Your report remains safely saved locally.',
    };
  }

  // 2. Check Supabase configuration
  if (!isSupabaseConfigured || !supabase) {
    return {
      ok: false,
      status: 'missing_config',
      requestId: providedRequestId,
      error: 'Supabase cloud is not configured. Please check your Supabase URL and Publishable Key in Settings.',
    };
  }

  // 3. Verify user session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    return {
      ok: false,
      status: 'unauthenticated',
      requestId: providedRequestId,
      error: 'Supabase authentication required. Please sign in with your Supabase account to send reports to Telegram.',
    };
  }

  // 4. Ensure report is synchronized to Supabase cloud before sending (respects revision conflicts)
  if (session.user?.id) {
    try {
      const syncRes = await uploadReportToCloud(session.user.id, report);
      if (syncRes.conflict) {
        return {
          ok: false,
          status: 'unsynced',
          requestId: providedRequestId,
          error:
            'Revision conflict detected: A newer version of this report exists in your Supabase cloud. Pre-send synchronization aborted to protect newer cloud data. Please reload or sync the report first.',
        };
      }
      if (!syncRes.success) {
        return {
          ok: false,
          status: 'unsynced',
          requestId: providedRequestId,
          error:
            syncRes.error ||
            'Report could not be synchronized with Supabase cloud before sending. Please ensure cloud connection is active and retry.',
        };
      }
    } catch (syncErr) {
      console.warn('Pre-dispatch report cloud synchronization error:', syncErr);
      return {
        ok: false,
        status: 'unsynced',
        requestId: providedRequestId,
        error:
          'Report synchronization failed prior to dispatch. Please ensure cloud connection is active and retry.',
      };
    }
  }

  // 5. Reuse provided request ID or generate unique ID for this delivery attempt
  const requestId =
    providedRequestId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  // 6. Construct FormData
  const formData = new FormData();
  formData.append('reportId', report.id);
  formData.append('requestId', requestId);
  formData.append('pair', report.pair || 'UNKNOWN');
  formData.append('date', report.date || '');
  formData.append('alignment', calculateOverallAlignment(report.timeframes).label);
  formData.append('title', report.title || '');
  formData.append('file', pdfBlob, filename || `ABMAX_${report.pair}_${report.date}.pdf`);

  // 7. Execute fetch with timeout controller (25 seconds)
  const controller = new AbortController();
  const timeoutMs = 25000;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const functionUrl = `${supabaseUrl}/functions/v1/send-telegram-report`;

  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${session.access_token}`,
        'x-request-id': requestId,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.ok) {
      const errorMsg = result?.error || `Server responded with status ${response.status}: ${response.statusText}`;
      let status: TelegramDeliveryStatus = 'failed';
      if (response.status === 401) {
        status = 'unauthenticated';
      } else if (response.status === 403) {
        status = 'forbidden';
      } else if (response.status === 404) {
        status = 'unreachable';
      } else if (response.status === 409) {
        status = result?.status === 'processing' ? 'failed' : 'uncertain';
      } else if (response.status === 500 && errorMsg.includes('TELEGRAM_BOT_TOKEN')) {
        status = 'missing_config';
      } else if (response.status === 502 || errorMsg.includes('Telegram rejected') || errorMsg.includes('Telegram API')) {
        status = 'telegram_rejected';
      }

      return {
        ok: false,
        status,
        requestId,
        error: errorMsg,
      };
    }

    return {
      ok: true,
      status: 'success',
      requestId,
      messageId: result.messageId,
      chatId: result.chatId,
      chatTitle: result.chatTitle,
      deliveredAt: result.deliveredAt || new Date().toISOString(),
      alreadyDelivered: Boolean(result.alreadyDelivered),
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof DOMException && err.name === 'AbortError') {
      // Ambiguous timeout: the request was received by the server and might have already posted to Telegram!
      return {
        ok: false,
        status: 'uncertain',
        requestId,
        error: 'Delivery uncertain—the request timed out while waiting for Telegram. Please check the Telegram group before retrying to prevent duplicate posts.',
      };
    }

    const networkError = err instanceof Error ? err.message : 'Network request failed';
    const isUnreachable =
      networkError.includes('Failed to fetch') ||
      networkError.includes('NetworkError') ||
      networkError.includes('Load failed');

    return {
      ok: false,
      status: isUnreachable ? 'unreachable' : 'failed',
      requestId,
      error: isUnreachable
        ? `Could not reach the Telegram dispatch Edge Function (${functionUrl}). This occurs when the 'send-telegram-report' function has not yet been deployed to your Supabase project (run: supabase functions deploy send-telegram-report) or when your Supabase project is paused.`
        : `Could not reach the Telegram dispatch function: ${networkError}`,
    };
  }
}
