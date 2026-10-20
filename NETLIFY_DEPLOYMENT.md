# Netlify Deployment Guide for ABMAX ANALYSIS

This repository is pre-configured for continuous deployment on **Netlify** directly from GitHub.

---

## 1. Quick Deploy via Netlify Dashboard

1. Log in to [Netlify](https://app.netlify.com/).
2. Click **Add new site** → **Import an existing project**.
3. Connect your **GitHub** account and select your **ABMAX Analysis** repository.
4. Netlify will automatically detect configuration from `netlify.toml`:
   - **Base directory:** *(Leave blank / root)*
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Node version:** `20`

---

## 2. Environment Variables Configuration

In Netlify Dashboard, navigate to **Site configuration** → **Environment variables** → **Add a variable**:

| Variable Name | Value | Purpose |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | `https://fxzurpdymuhlfkdxfgel.supabase.co` | Public Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | *(Your project anon/publishable key)* | Public client key for auth and sync |

> **Security Note:** Never add `SUPABASE_SERVICE_ROLE_KEY` or `TELEGRAM_BOT_TOKEN` to Netlify frontend variables. These are server-side secrets reserved exclusively for Supabase Edge Functions.

---

## 3. Post-Deployment Supabase Auth Allowlist

Once Netlify builds your site and assigns your live URL (e.g., `https://abmax-analysis.netlify.app` or a custom domain):

1. Open your [Supabase Dashboard](https://supabase.com/dashboard/project/fxzurpdymuhlfkdxfgel).
2. Go to **Authentication** → **URL Configuration**.
3. Set **Site URL** to your Netlify production URL:
   ```
   https://your-site.netlify.app
   ```
4. In **Redirect URLs**, add:
   ```
   https://your-site.netlify.app/**
   https://localhost/**
   http://localhost:3000/**
   ```
5. Click **Save**.

This ensures login magic links, password recovery redirects, and OAuth flows navigate back to your deployed Netlify application without security rejections.
