// ============================================================================
// Supabase Edge Function: send-telegram-report
// Purpose: Secure, authenticated Telegram report delivery for ABMAX Analysis
// Target Bot: @Abmaxanalysisbot
// Server-Configured Destination: -1004337945630
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_TARGET_CHAT_ID = '-1004337945630';

serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2. Verify Authorization Header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'unauthenticated',
          error: 'Unauthorized: A valid Supabase authentication session is required to send reports to Telegram.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Initialize Supabase Clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || supabaseAnonKey;

    // User client (respects user JWT)
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Admin client (bypasses RLS for atomic reservations and audit logs)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 4. Verify user identity
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'unauthenticated',
          error: 'Authentication failed: Invalid or expired Supabase user session.',
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5. Strict Allowed-User Restriction for Personal Bot
    // Missing configuration MUST deny sending rather than allow every registered account
    const allowedEmailsConfig = Deno.env.get('ALLOWED_USER_EMAILS') || '';
    const allowedIdsConfig = Deno.env.get('ALLOWED_USER_IDS') || '';
    const combinedConfig = `${allowedEmailsConfig},${allowedIdsConfig}`.trim();

    if (!combinedConfig || combinedConfig === ',') {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'forbidden',
          error:
            'Security restriction: Neither ALLOWED_USER_EMAILS nor ALLOWED_USER_IDS is configured in Supabase secrets. Dispatch is denied by default for personal bot protection.',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allowedTokens = combinedConfig
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const callerEmail = (user.email || '').trim().toLowerCase();
    const callerId = (user.id || '').trim().toLowerCase();
    const isAuthorized = (callerEmail && allowedTokens.includes(callerEmail)) || (callerId && allowedTokens.includes(callerId));

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'forbidden',
          error: `Access denied: Account '${user.email || user.id || 'unknown'}' is not authorized to dispatch to this Telegram channel.`,
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6. Retrieve Bot Secret
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return new Response(
        JSON.stringify({
          ok: false,
          status: 'missing_config',
          error:
            'TELEGRAM_BOT_TOKEN is not configured in Supabase secrets. Please set TELEGRAM_BOT_TOKEN in your Supabase project dashboard secrets.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Server-enforced target chat ID (Clients cannot override to arbitrary recipients)
    const targetChatId = Deno.env.get('TELEGRAM_CHAT_ID') || DEFAULT_TARGET_CHAT_ID;

    // 7. Parse multipart form data
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invalid request format: Expected multipart/form-data with report PDF file.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formData = await req.formData();
    const reportId = (formData.get('reportId') as string) || '';
    const requestId = (formData.get('requestId') as string) || `req_${Date.now()}`;
    const file = formData.get('file') as File | Blob | null;
    const pair = (formData.get('pair') as string) || 'UNKNOWN';
    const date = (formData.get('date') as string) || '';
    const alignment = (formData.get('alignment') as string) || '';
    const title = (formData.get('title') as string) || '';

    if (!file) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Missing PDF file attachment in request.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 8. Strict PDF validation: MIME type, extension, size, and header signature (magic bytes)
    const fileName = (file as File).name || '';
    const fileType = (file as File).type || '';

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invalid file extension: Document filename must end with .pdf.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (fileType && !fileType.includes('pdf')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Invalid MIME type (${fileType}): Expected application/pdf.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (file.size < 100 || file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Invalid PDF file size (${file.size} bytes). Size must be between 100 bytes and 20MB.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate PDF magic bytes: genuine PDF files must begin with %PDF- (0x25 0x50 0x44 0x46 0x2D)
    const fileBuffer = await file.arrayBuffer();
    const headerBytes = new Uint8Array(fileBuffer.slice(0, 5));
    const headerStr = String.fromCharCode(...headerBytes);
    if (headerStr !== '%PDF-') {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Invalid PDF content: File missing genuine PDF header signature (%PDF-).',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9. Check report ownership in Supabase database if reportId is provided
    if (reportId && reportId !== 'draft') {
      const { data: reportData, error: reportError } = await supabase
        .from('analyses')
        .select('id, user_id')
        .eq('id', reportId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (reportError) {
        console.warn('Could not verify report ownership query:', reportError);
      } else if (!reportData) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: 'forbidden',
            error: `Report ${reportId} not found or does not belong to your account in Supabase cloud. Please ensure the report is synchronized before dispatching.`,
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 10. Rate Limiting: Max 10 deliveries per user per 5 minutes
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from('telegram_delivery_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', fiveMinutesAgo);

      if (count && count >= 10) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Rate limit exceeded: You can send at most 10 reports per 5 minutes. Please wait before sending again.',
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (_rateErr) {
      // Table may not exist yet if migration has not run
    }

    // 11. ATOMIC RESERVATION BEFORE CALLING TELEGRAM
    // Check if (user_id, request_id) already exists to preserve state and prevent concurrent duplicate sends
    try {
      const { data: existingLog } = await supabaseAdmin
        .from('telegram_delivery_logs')
        .select('id, status, telegram_message_id, error_message')
        .eq('user_id', user.id)
        .eq('request_id', requestId)
        .maybeSingle();

      if (existingLog) {
        if (existingLog.status === 'success' || existingLog.status === 'sent') {
          return new Response(
            JSON.stringify({
              ok: true,
              messageId: existingLog.telegram_message_id,
              alreadyDelivered: true,
              chatId: targetChatId,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (existingLog.status === 'processing') {
          return new Response(
            JSON.stringify({
              ok: false,
              status: 'processing',
              error:
                'A delivery attempt is already actively in progress for this request ID. Concurrent requests are blocked.',
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (existingLog.status === 'uncertain') {
          return new Response(
            JSON.stringify({
              ok: false,
              status: 'uncertain',
              error:
                'Delivery status remains uncertain from a previous timed-out attempt. Check the Telegram group before starting a new request.',
            }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // If previously failed, transition status back to 'processing' for retry
        await supabaseAdmin
          .from('telegram_delivery_logs')
          .update({
            status: 'processing',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingLog.id);
      } else {
        // Atomically reserve via insert with status 'processing'
        // Relies on UNIQUE (user_id, request_id) constraint in database
        const { error: reserveError } = await supabaseAdmin
          .from('telegram_delivery_logs')
          .insert({
            user_id: user.id,
            report_id: reportId || 'draft',
            request_id: requestId,
            chat_id: targetChatId,
            status: 'processing',
          });

        if (reserveError) {
          if (reserveError.code === '23505' || reserveError.message?.includes('duplicate key')) {
            return new Response(
              JSON.stringify({
                ok: false,
                status: 'processing',
                error: 'Concurrent delivery blocked: Another process is already handling this request ID.',
              }),
              { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }
    } catch (_dbReserveErr) {
      // Continue safely if table does not yet exist
    }

    // 12. Prepare Telegram Bot API payload
    const captionLines = [
      `📊 *ABMAX ANALYSIS REPORT*`,
      `*Pair:* ${pair}`,
      date ? `*Date:* ${date}` : '',
      alignment ? `*Alignment:* ${alignment}` : '',
      title ? `*Title:* ${title}` : '',
      `*Sent by:* ${user.email || 'Authorized User'}`,
    ].filter(Boolean);

    const caption = captionLines.join('\n');

    // Create validated blob from the checked buffer
    const verifiedPdfBlob = new Blob([fileBuffer], { type: 'application/pdf' });
    const tgFormData = new FormData();
    tgFormData.append('chat_id', targetChatId);
    tgFormData.append('document', verifiedPdfBlob, fileName || `ABMAX_${pair}_${date}.pdf`);
    tgFormData.append('caption', caption);
    tgFormData.append('parse_mode', 'Markdown');

    // 13. Dispatch document to Telegram Bot API
    const tgUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
    let tgResponse: Response;
    let tgResult: { ok?: boolean; description?: string; result?: { message_id?: number; chat?: { title?: string } } };

    try {
      tgResponse = await fetch(tgUrl, {
        method: 'POST',
        body: tgFormData,
      });
      tgResult = await tgResponse.json().catch(() => ({}));
    } catch (fetchErr: unknown) {
      // Network failure / timeout communicating with Telegram
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Connection to Telegram failed';
      console.error('Telegram dispatch connection error:', msg);

      try {
        await supabaseAdmin
          .from('telegram_delivery_logs')
          .update({
            status: 'uncertain',
            error_message: msg,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('request_id', requestId);
      } catch (_logErr) {
        // Safe ignore
      }

      return new Response(
        JSON.stringify({
          ok: false,
          status: 'uncertain',
          error: `Connection to Telegram timed out: ${msg}. Check Telegram channel before retrying.`,
        }),
        { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strict validation: HTTP response must be ok AND Telegram body ok === true
    if (!tgResponse.ok) {
      const errorDetail = tgResult?.description || `Telegram API HTTP error status ${tgResponse.status}`;
      console.error('Telegram API HTTP error:', errorDetail);

      try {
        await supabaseAdmin
          .from('telegram_delivery_logs')
          .update({
            status: 'failed',
            error_message: errorDetail,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('request_id', requestId);
      } catch (_logErr) {
        // Safe ignore
      }

      return new Response(
        JSON.stringify({
          ok: false,
          status: 'telegram_rejected',
          error: `Telegram server error (HTTP ${tgResponse.status}): ${errorDetail}`,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (tgResult.ok !== true) {
      const errorDetail = tgResult.description || 'Telegram rejected the document request';
      console.error('Telegram delivery rejected:', errorDetail);

      try {
        await supabaseAdmin
          .from('telegram_delivery_logs')
          .update({
            status: 'failed',
            error_message: errorDetail,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('request_id', requestId);
      } catch (_logErr) {
        // Safe ignore
      }

      return new Response(
        JSON.stringify({
          ok: false,
          status: 'telegram_rejected',
          error: `Telegram rejected delivery: ${errorDetail}`,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const telegramMessageId = tgResult.result?.message_id;
    if (!telegramMessageId) {
      try {
        await supabaseAdmin
          .from('telegram_delivery_logs')
          .update({
            status: 'uncertain',
            error_message: 'Telegram accepted request but returned no confirmed message_id.',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)
          .eq('request_id', requestId);
      } catch (_logErr) {
        // Safe ignore
      }

      return new Response(
        JSON.stringify({
          ok: false,
          status: 'uncertain',
          error: 'Telegram accepted request but returned no confirmed message_id.',
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 14. Delivery Confirmed by Telegram with message_id
    const chatTitle = tgResult.result?.chat?.title || 'ABMAX Group';

    try {
      await supabaseAdmin
        .from('telegram_delivery_logs')
        .update({
          status: 'success',
          telegram_message_id: telegramMessageId,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('request_id', requestId);
    } catch (_logErr) {
      // Safe ignore
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: 'success',
        messageId: telegramMessageId,
        chatTitle,
        chatId: targetChatId,
        deliveredAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('Unexpected error in send-telegram-report function:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        status: 'failed',
        error: `Edge function exception: ${errorMsg}`,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
