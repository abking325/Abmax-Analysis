-- ============================================================================
-- ABMAX ANALYSIS — Account Data Reset & Monotonic Reset Version Migration
-- Version: 20261114000000
-- Purpose:
--   1. Add user_account_state tracking authoritative monotonic reset_version
--   2. Add DELETE RLS policy for user_preferences
--   3. Provide SECURITY DEFINER reset_my_abmax_data() RPC for atomic server reset
-- ============================================================================

-- 1. Account State Table (Tracks authoritative server reset epochs)
CREATE TABLE IF NOT EXISTS public.user_account_state (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    reset_version BIGINT NOT NULL DEFAULT 0,
    last_reset_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.user_account_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own account state" ON public.user_account_state;
CREATE POLICY "Users can view own account state"
    ON public.user_account_state FOR SELECT
    USING (auth.uid() = user_id);

-- 2. Add DELETE policy on user_preferences (was missing from initial schema)
DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;
CREATE POLICY "Users can delete own preferences"
    ON public.user_preferences FOR DELETE
    USING (auth.uid() = user_id);

-- 3. Authoritative Per-Account Data Reset RPC (Preserves auth.users account)
CREATE OR REPLACE FUNCTION public.reset_my_abmax_data(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller UUID := auth.uid();
    v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
    v_deleted_analyses INTEGER := 0;
    v_deleted_drafts INTEGER := 0;
    v_deleted_templates INTEGER := 0;
    v_next_version BIGINT := 1;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Target user_id is required';
    END IF;

    -- Allow either the authenticated owner (auth.uid() = p_user_id) or server service_role
    IF v_role <> 'service_role' AND (v_caller IS NULL OR v_caller <> p_user_id) THEN
        RAISE EXCEPTION 'Forbidden: caller cannot reset another account';
    END IF;

    DELETE FROM public.analyses WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_deleted_analyses = ROW_COUNT;

    DELETE FROM public.drafts WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_deleted_drafts = ROW_COUNT;

    DELETE FROM public.templates WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_deleted_templates = ROW_COUNT;

    INSERT INTO public.user_account_state (user_id, reset_version, last_reset_at, updated_at)
    VALUES (p_user_id, 1, timezone('utc'::text, now()), timezone('utc'::text, now()))
    ON CONFLICT (user_id) DO UPDATE SET
        reset_version = public.user_account_state.reset_version + 1,
        last_reset_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    RETURNING reset_version INTO v_next_version;

    -- Reset user_preferences back to defaults while stamping authoritative resetVersion
    INSERT INTO public.user_preferences (user_id, theme, preferences, updated_at)
    VALUES (
        p_user_id,
        'light',
        jsonb_build_object('resetVersion', v_next_version),
        timezone('utc'::text, now())
    )
    ON CONFLICT (user_id) DO UPDATE SET
        theme = 'light',
        preferences = jsonb_build_object('resetVersion', v_next_version),
        updated_at = timezone('utc'::text, now());

    RETURN jsonb_build_object(
        'reset_version', v_next_version,
        'deleted_analyses', v_deleted_analyses,
        'deleted_drafts', v_deleted_drafts,
        'deleted_templates', v_deleted_templates
    );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_my_abmax_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_my_abmax_data(UUID) TO authenticated, service_role;
