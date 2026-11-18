-- ============================================================================
-- ABMAX ANALYSIS — Protected Full Account-Data Reset & Non-Resurrection Barrier
-- Version: 20261115000000
-- Purpose:
--   1. Authoritative per-user reset epoch tombstone table (`public.user_reset_epochs`)
--   2. Server-side trigger barrier rejecting stale pre-reset writes from other devices
--   3. Atomic SECURITY DEFINER RPC (`public.reset_user_account_data`) clearing user
--      cloud data while preserving login identity (`auth.users`) and other users' data.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_reset_epochs (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    reset_epoch BIGINT NOT NULL DEFAULT 0,
    reset_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.user_reset_epochs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reset epoch" ON public.user_reset_epochs;
CREATE POLICY "Users can view own reset epoch"
    ON public.user_reset_epochs FOR SELECT
    USING (auth.uid() = user_id);

-- Prevent direct client tampering with reset_epoch; only SECURITY DEFINER RPC mutates it.
REVOKE INSERT, UPDATE, DELETE ON public.user_reset_epochs FROM anon, authenticated;

-- Track reset_epoch on synced user tables so stale offline devices cannot re-upload deleted rows
ALTER TABLE public.analyses
    ADD COLUMN IF NOT EXISTS reset_epoch BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.drafts
    ADD COLUMN IF NOT EXISTS reset_epoch BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.templates
    ADD COLUMN IF NOT EXISTS reset_epoch BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS reset_epoch BIGINT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.enforce_reset_epoch_barrier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_epoch BIGINT;
    v_reset_at TIMESTAMPTZ;
BEGIN
    SELECT reset_epoch, reset_at
      INTO v_epoch, v_reset_at
      FROM public.user_reset_epochs
     WHERE user_id = NEW.user_id;

    IF v_epoch IS NOT NULL AND v_epoch > 0 THEN
        IF COALESCE(NEW.reset_epoch, 0) < v_epoch THEN
            RAISE EXCEPTION 'ABMAX_PRE_RESET_WRITE_REJECTED: Client reset_epoch (%) predates authoritative account reset_epoch (%).',
                COALESCE(NEW.reset_epoch, 0), v_epoch
                USING ERRCODE = 'P0001';
        END IF;

        IF NEW.updated_at IS NOT NULL AND NEW.updated_at < v_reset_at THEN
            RAISE EXCEPTION 'ABMAX_PRE_RESET_WRITE_REJECTED: Record timestamp (%) predates latest account reset (%).',
                NEW.updated_at, v_reset_at
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_analyses_reset_barrier ON public.analyses;
CREATE TRIGGER trg_analyses_reset_barrier
    BEFORE INSERT OR UPDATE ON public.analyses
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_reset_epoch_barrier();

DROP TRIGGER IF EXISTS trg_drafts_reset_barrier ON public.drafts;
CREATE TRIGGER trg_drafts_reset_barrier
    BEFORE INSERT OR UPDATE ON public.drafts
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_reset_epoch_barrier();

DROP TRIGGER IF EXISTS trg_templates_reset_barrier ON public.templates;
CREATE TRIGGER trg_templates_reset_barrier
    BEFORE INSERT OR UPDATE ON public.templates
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_reset_epoch_barrier();

DROP TRIGGER IF EXISTS trg_preferences_reset_barrier ON public.user_preferences;
CREATE TRIGGER trg_preferences_reset_barrier
    BEFORE INSERT OR UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_reset_epoch_barrier();

CREATE OR REPLACE FUNCTION public.reset_user_account_data(p_confirmation TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_deleted_analyses INTEGER := 0;
    v_deleted_drafts INTEGER := 0;
    v_deleted_templates INTEGER := 0;
    v_deleted_preferences INTEGER := 0;
    v_deleted_telegram_logs INTEGER := 0;
    v_new_epoch BIGINT := 1;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to reset account data.'
            USING ERRCODE = '42501';
    END IF;

    IF p_confirmation IS DISTINCT FROM 'RESET ALL MY DATA' THEN
        RAISE EXCEPTION 'Destructive confirmation phrase mismatch.'
            USING ERRCODE = '22023';
    END IF;

    -- Perform transactional wipe scoped strictly to caller auth.uid()
    DELETE FROM public.analyses WHERE user_id = v_uid;
    GET DIAGNOSTICS v_deleted_analyses = ROW_COUNT;

    DELETE FROM public.drafts WHERE user_id = v_uid;
    GET DIAGNOSTICS v_deleted_drafts = ROW_COUNT;

    DELETE FROM public.templates WHERE user_id = v_uid;
    GET DIAGNOSTICS v_deleted_templates = ROW_COUNT;

    DELETE FROM public.user_preferences WHERE user_id = v_uid;
    GET DIAGNOSTICS v_deleted_preferences = ROW_COUNT;

    IF to_regclass('public.telegram_delivery_logs') IS NOT NULL THEN
        DELETE FROM public.telegram_delivery_logs WHERE user_id = v_uid;
        GET DIAGNOSTICS v_deleted_telegram_logs = ROW_COUNT;
    END IF;

    INSERT INTO public.user_reset_epochs (user_id, reset_epoch, reset_at, updated_at)
    VALUES (v_uid, 1, v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE
        SET reset_epoch = public.user_reset_epochs.reset_epoch + 1,
            reset_at = v_now,
            updated_at = v_now
    RETURNING reset_epoch INTO v_new_epoch;

    RETURN jsonb_build_object(
        'success', TRUE,
        'user_id', v_uid,
        'reset_epoch', v_new_epoch,
        'reset_at', v_now,
        'deleted', jsonb_build_object(
            'analyses', v_deleted_analyses,
            'drafts', v_deleted_drafts,
            'templates', v_deleted_templates,
            'user_preferences', v_deleted_preferences,
            'telegram_delivery_logs', v_deleted_telegram_logs
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_user_account_data(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_user_account_data(TEXT) TO authenticated;
