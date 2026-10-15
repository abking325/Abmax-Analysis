# ABMAX ANALYSIS — Trading Analysis Journal

Professional multi-timeframe market analysis and trading journal with structured Smart Money Concepts (SMC) framework, institutional alignment verification, planned scenarios, and execution reports.

---

## 🚀 Pushing to GitHub & GitHub Actions

This repository is fully configured with **GitHub Actions CI/CD workflows**:
1. **Deploy to GitHub Pages** (`.github/workflows/deploy.yml`): Automatically builds and publishes your live web application to GitHub Pages whenever you push to `main` or `master`.
2. **Build & Package App** (`.github/workflows/build-app.yml`): Automatically checks types, compiles the production code, and packages a downloadable web app bundle artifact under the GitHub Actions run summary.

### Step 1: Initialize Git and Push to GitHub

In your project folder, run the following terminal commands:

```bash
# Initialize git if not already done
git init

# Stage all files (including .github/workflows)
git add .

# Create your commit
git commit -m "feat: complete ABMAX Analysis app with GitHub Actions build workflows"

# Set default branch to main
git branch -M main

# Link to your remote GitHub repository
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY_NAME>.git

# Push your code to GitHub
git push -u origin main
```

---

## ⚡ Where to Find the Build & App in GitHub Actions

Once pushed:

1. Open your repository on GitHub (`https://github.com/<username>/<repo>`).
2. Click the **Actions** tab at the top.
3. You will see two active workflows:
   - **`Build & Package App`**: Compiles your app and creates a downloadable zip file under **Artifacts** (`abmax-analysis-built-app`).
   - **`Deploy to GitHub Pages`**: Automatically builds and hosts the live website.

### How to Enable GitHub Pages (Free Live Hosting)

To let GitHub host your app live on the web:
1. In your GitHub repository, click **Settings** (top right tab).
2. On the left menu, click **Pages**.
3. Under **Build and deployment** > **Source**, change from `Deploy from a branch` to **`GitHub Actions`**.
4. That's it! GitHub will now automatically build and publish your app at:
   ```
   https://<YOUR_GITHUB_USERNAME>.github.io/<YOUR_REPOSITORY_NAME>/
   ```

---

## 📱 How to Convert to a Standalone App (Mobile & Desktop)

ABMAX ANALYSIS includes a Web App Manifest (`public/manifest.json`), custom application icons (`public/icon.svg`), and mobile configuration:

- **On iPhone / iPad (Safari)**:
  1. Open your deployed GitHub Pages URL in Safari.
  2. Tap the **Share** button (box with upward arrow).
  3. Scroll down and tap **Add to Home Screen**.
  4. The app will launch full-screen like a native iOS app.

- **On Android (Chrome / Brave / Edge)**:
  1. Open your deployed URL in Chrome.
  2. Tap the menu (three dots) > **Add to Home Screen** or click the banner **Install App**.
  3. The app is installed as a standalone mobile application.

- **On Desktop (Chrome, Edge, Brave)**:
  1. Open your deployed URL.
  2. Click the **Install** icon in the right side of the address bar.
  3. The app opens in its own clean window without browser chrome.

---

## 🛠 Local Development

### Requirements
- Node.js 18+ (Node.js 20 recommended)
- npm 9+

### Commands

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start local development server (http://localhost:3000)
npm run dev

# Run TypeScript type-checking / linting
npm run lint

# Build production bundle to dist/
npm run build

# Preview production build locally
npm run preview
```

---

## 🌐 Environment Variables (Optional Supabase Cloud Sync)

The application works 100% offline out-of-the-box using the browser's IndexedDB.

If you want cloud synchronization and account authentication across multiple devices:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in your Supabase project keys:
   ```env
   VITE_SUPABASE_URL="https://your-project.supabase.co"
   VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-or-publishable-key"
   ```
3. Run the SQL migration script located in:
   `supabase/migrations/20261008000000_init_abmax_schema.sql`
   in your Supabase SQL Editor.
