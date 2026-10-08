-- ============================================================================
-- ABMAX ANALYSIS — Supabase Migration Script
-- Version: 20261008000000
-- Purpose: Schema, Row Level Security (RLS), and Private Storage Bucket for ABMAX
-- ============================================================================

-- 1. Enable UUID Extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Analyses Table (Saved Reports)
CREATE TABLE IF NOT EXISTS public.analyses (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pair TEXT NOT NULL,
    date DATE NOT NULL,
    time TEXT NOT NULL,
    session TEXT NOT NULL,
    analysis_timing TEXT NOT NULL,
    overall_alignment TEXT,
    status TEXT NOT NULL DEFAULT 'Original',
    is_modified BOOLEAN NOT NULL DEFAULT FALSE,
    copied_from_id TEXT,
    payload JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, id)
);

-- Search and sort indexes for analyses
CREATE INDEX IF NOT EXISTS idx_analyses_user_date ON public.analyses(user_id, date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_user_pair ON public.analyses(user_id, pair);
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON public.analyses(user_id, id);

-- 3. Drafts Table (Unfinished Active Analysis per user)
CREATE TABLE IF NOT EXISTS public.drafts (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    draft_id TEXT NOT NULL DEFAULT 'active_draft',
    pair TEXT NOT NULL DEFAULT 'XAUUSD',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Templates Table (Named Saved Setups)
CREATE TABLE IF NOT EXISTS public.templates (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_templates_user_updated ON public.templates(user_id, updated_at DESC);

-- 5. User Preferences Table (Theme & user settings)
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    theme TEXT NOT NULL DEFAULT 'light',
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ============================================================================
-- 6. Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- ANALYSES POLICIES
DROP POLICY IF EXISTS "Users can view own analyses" ON public.analyses;
CREATE POLICY "Users can view own analyses"
    ON public.analyses FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own analyses" ON public.analyses;
CREATE POLICY "Users can insert own analyses"
    ON public.analyses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own analyses" ON public.analyses;
CREATE POLICY "Users can update own analyses"
    ON public.analyses FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own analyses" ON public.analyses;
CREATE POLICY "Users can delete own analyses"
    ON public.analyses FOR DELETE
    USING (auth.uid() = user_id);

-- DRAFTS POLICIES
DROP POLICY IF EXISTS "Users can view own draft" ON public.drafts;
CREATE POLICY "Users can view own draft"
    ON public.drafts FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own draft" ON public.drafts;
CREATE POLICY "Users can insert own draft"
    ON public.drafts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own draft" ON public.drafts;
CREATE POLICY "Users can update own draft"
    ON public.drafts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own draft" ON public.drafts;
CREATE POLICY "Users can delete own draft"
    ON public.drafts FOR DELETE
    USING (auth.uid() = user_id);

-- TEMPLATES POLICIES
DROP POLICY IF EXISTS "Users can view own templates" ON public.templates;
CREATE POLICY "Users can view own templates"
    ON public.templates FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own templates" ON public.templates;
CREATE POLICY "Users can insert own templates"
    ON public.templates FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own templates" ON public.templates;
CREATE POLICY "Users can update own templates"
    ON public.templates FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own templates" ON public.templates;
CREATE POLICY "Users can delete own templates"
    ON public.templates FOR DELETE
    USING (auth.uid() = user_id);

-- USER PREFERENCES POLICIES
DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
CREATE POLICY "Users can view own preferences"
    ON public.user_preferences FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
CREATE POLICY "Users can insert own preferences"
    ON public.user_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
CREATE POLICY "Users can update own preferences"
    ON public.user_preferences FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 7. Private Storage Bucket Setup: chart-images
-- ============================================================================

-- Create private chart-images bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'chart-images',
    'chart-images',
    FALSE,
    10485760, -- 10MB limit per image
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Storage RLS Policies for chart-images (Scoped strictly beneath auth.uid() folder)
-- e.g. path must be '<auth.uid()>/<image_id>.png'

DROP POLICY IF EXISTS "Users can upload own chart images" ON storage.objects;
CREATE POLICY "Users can upload own chart images"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'chart-images' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can view own chart images" ON storage.objects;
CREATE POLICY "Users can view own chart images"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'chart-images' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can update own chart images" ON storage.objects;
CREATE POLICY "Users can update own chart images"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'chart-images' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can delete own chart images" ON storage.objects;
CREATE POLICY "Users can delete own chart images"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'chart-images' AND
        auth.uid()::text = (storage.foldername(name))[1]
    );
