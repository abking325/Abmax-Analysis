-- ============================================================================
-- ABMAX ANALYSIS — Additive Migration: Telegram Delivery Logs
-- Version: 20261018000000
-- Purpose: Track Telegram report deliveries, prevent duplicate submissions, and maintain audit log
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    telegram_message_id BIGINT,
    status TEXT NOT NULL, -- 'processing', 'sent', 'success', 'failed', 'uncertain'
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_user_request UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_logs_user_report ON public.telegram_delivery_logs(user_id, report_id);
CREATE INDEX IF NOT EXISTS idx_tg_logs_request_id ON public.telegram_delivery_logs(request_id);

-- Enable Row Level Security
ALTER TABLE public.telegram_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own telegram delivery logs" ON public.telegram_delivery_logs;
CREATE POLICY "Users can view own telegram delivery logs"
    ON public.telegram_delivery_logs FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own telegram delivery logs" ON public.telegram_delivery_logs;
CREATE POLICY "Users can insert own telegram delivery logs"
    ON public.telegram_delivery_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own telegram delivery logs" ON public.telegram_delivery_logs;
CREATE POLICY "Users can update own telegram delivery logs"
    ON public.telegram_delivery_logs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
