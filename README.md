# ABMAX ANALYSIS — Trading Analysis Journal

Professional multi-timeframe market analysis and trading journal with structured Smart Money Concepts (SMC) framework, institutional alignment verification, planned scenarios, and execution reports.

---

## 🚀 Quick Start & Pushing to GitHub

This repository is fully configured with automated **GitHub Actions CI/CD workflows** for both the production website and an Android APK.

### 1. Initialize Git and Push to GitHub

Run the following commands in your terminal:

```bash
# Verify or initialize git
git init -b main

# Stage all files
git add .

# Create the initial commit
git commit -m "feat: complete ABMAX Analysis app ready for GitHub, Netlify, and Android"

# Link to your remote GitHub repository
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY_NAME>.git

# Push your code to GitHub
git push -u origin main
```

---

## ⚡ GitHub Actions Workflows

Once pushed, navigate to the **Actions** tab in your GitHub repository. Two independent workflows will run:

1. **Build ABMAX Website (`.github/workflows/website.yml`)**:
   - Runs `npm ci` reproducible dependency installation
   - Performs TypeScript type-checking (`npm run lint`)
   - Executes all 13 persistence verification test suites (`npm test`)
   - Builds the production web app (`npm run build`)
   - Packages and uploads the deliverable artifact: **`ABMAX-Web-Build`**

2. **Build ABMAX Android APK (`.github/workflows/build-android-apk.yml`)**:
   - Sets up Java 21 (Temurin) and Android SDK tools
   - Compiles web assets and runs `npx cap sync android`
   - Executes Gradle `assembleDebug`
   - Uploads the direct sideloadable APK: **`ABMAX-Android-APK`** containing `ABMAX-ANALYSIS-personal-testing.apk`
   - Supports optional release signing via repository secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`)

*Note: Android APK build runs independently; any Android build notice will never block website testing or Netlify deployment.*

---

## 🌐 Netlify Deployment (Zero-Config)

This repository includes a production `netlify.toml` pre-configured with:
- Build command: `npm run build`
- Publish directory: `dist`
- Node.js version: `20`
- Cache headers: Instant revalidation for `index.html`, `manifest.json`, and `sw.js`; immutable 1-year caching for `/assets/*`
- SPA fallback routing: `/*` -> `/index.html` (with asset 404 guards)

### Deploying to Netlify in 3 Steps:
1. Log in to [Netlify](https://app.netlify.com/) and click **Add new site** → **Import an existing project**.
2. Select your GitHub repository. Netlify automatically detects `netlify.toml`.
3. Add the public environment variables under **Site configuration** → **Environment variables**:
   - `VITE_SUPABASE_URL`: `https://fxzurpdymuhlfkdxfgel.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: *(Your Supabase publishable/anon key)*
4. Click **Deploy Site**.

*For full details, see [`NETLIFY_DEPLOYMENT.md`](./NETLIFY_DEPLOYMENT.md).*

---

## 📱 Progressive Web App (PWA) & Offline Reliability

ABMAX ANALYSIS functions 100% offline out-of-the-box using browser IndexedDB:
- **Offline Shell**: Fully precaches core assets via `public/sw.js`.
- **Capacitor Isolation**: Website service worker is cleanly disabled on native Android Capacitor APK to prevent interference with local bundled assets.
- **Data Protection**: Local IndexedDB reports, drafts, and templates are never cleared during service worker cache updates.
- **Installability**: Meets all PWA criteria with standard, maskable, and Apple touch icons.

---

## 🤖 Telegram Report Dispatch & Supabase Edge Function

ABMAX ANALYSIS supports exporting and dispatching PDF analysis reports directly to your configured Telegram destination:
- **Bot**: `@Abmaxanalysisbot`
- **Destination Group**: `-1004337945630`
- **Security**: Server-side user authentication, atomic `(user_id, request_id)` reservation to prevent duplicate sends, PDF signature `%PDF-` validation, and revision conflict checking.

### Supabase Setup & Edge Function Deployment:

1. **Database Schema & Delivery Log Table**:
   Open your [Supabase SQL Editor](https://supabase.com/dashboard/project/fxzurpdymuhlfkdxfgel/sql) and run:
   - `supabase/migrations/20261008000000_init_abmax_schema.sql` (Core journal tables)
   - `supabase/migrations/20261018000000_telegram_delivery_log.sql` (Telegram atomic reservation log)

2. **Deploy the Edge Function**:
   Using the Supabase CLI:
   ```bash
   supabase functions deploy send-telegram-report --project-ref fxzurpdymuhlfkdxfgel
   ```

3. **Set Required Secrets**:
   Under Supabase Dashboard → **Project Settings** → **Edge Functions** → **Secrets**, configure:
   - `TELEGRAM_BOT_TOKEN`: Your private bot token obtained from `@BotFather`.
   - `ALLOWED_USER_IDS`: Comma-separated list of permitted Supabase user UUIDs (access is denied if empty).
   - `ALLOWED_GROUP_ID`: `-1004337945630`

---

## 🧪 Verification & Testing

Run all 13 persistence and workflow test suites locally:
```bash
npm test
```

Run TypeScript verification:
```bash
npm run lint
```
