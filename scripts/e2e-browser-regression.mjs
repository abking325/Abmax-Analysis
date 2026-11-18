#!/usr/bin/env node
/**
 * Repeatable Headless Chromium Browser Lifecycle & Upgrade Regression Suite
 *
 * Covers:
 * - Untouched blank form Back / reload isolation (no false Continue Analysis)
 * - New Save, Update Save, rapid double-tap deduplication, Save as New Report, Retry Save after storage failure
 * - Back -> Home -> Cold Reload -> Continue Analysis bound identity & unsaved edit preservation
 * - Nested Scenario Edit -> Cancel -> Discard with 1200ms post-debounce non-resurrection check
 * - LIFO Escape / Back stack dismissal across SettingsModal + BackupModal
 * - Live workspace independence (zero "Convert to Report / Trade", Copy into Live isolation, Reset isolation)
 * - Live Coinbase BTC-USD spot feed HTTP & UI honesty labels + Manual EURUSD/XAUUSD disclosure
 * - Populated IndexedDB V1 -> V5 upgrade preservation in Chromium
 *
 * Usage:
 *   npm run build && npm run test:e2e
 * Optional env overrides:
 *   E2E_BASE_URL=http://127.0.0.1:4179
 *   PLAYWRIGHT_CORE_PATH=/path/to/playwright-core
 *   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium
 */

import { createRequire } from 'module';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';

const require = createRequire(import.meta.url);

function loadPlaywrightChromium() {
  const candidateModules = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
    'playwright',
    '/usr/local/share/bun-global/node_modules/playwright-core',
  ].filter(Boolean);

  for (const mod of candidateModules) {
    try {
      const loaded = require(mod);
      if (loaded?.chromium) return loaded.chromium;
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    'Unable to locate playwright-core or playwright. Install playwright or set PLAYWRIGHT_CORE_PATH.'
  );
}

function resolveChromiumExecutable(chromium) {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && existsSync(defaultPath)) return defaultPath;
  } catch {
    // Fallback below
  }
  return undefined;
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
  console.log(`[PASS] ${msg}`);
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for preview server at ${url}`);
}

function startEphemeralPreview(port = 4179) {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!existsSync(distDir)) {
    throw new Error('Production build dist/ not found. Run "npm run build" before "npm run test:e2e".');
  }
  const proc = spawn(
    process.execPath,
    [path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
    { stdio: 'ignore', env: process.env }
  );
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    },
  };
}

async function dismissSplash(page) {
  await page
    .waitForSelector('div[aria-label="AbMax Analysis Launch Screen"]', {
      state: 'detached',
      timeout: 8000,
    })
    .catch(() => {});
  await page.waitForSelector('button:has-text("Start Analysis")', { timeout: 10000 });
}

async function inspectIDB(page) {
  return page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('abmax_analysis_db');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const version = db.version;
        const stores = Array.from(db.objectStoreNames);
        const readAll = (storeName) =>
          new Promise((res, rej) => {
            if (!stores.includes(storeName)) return res([]);
            const tx = db.transaction(storeName, 'readonly');
            const st = tx.objectStore(storeName);
            const r = st.getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
        Promise.all([
          readAll('reports'),
          readAll('draft'),
          readAll('templates'),
          readAll('images'),
          readAll('live_workspace'),
        ])
          .then(([reports, drafts, templates, images, liveWorkspaces]) => {
            db.close();
            resolve({ version, stores, reports, drafts, templates, images, liveWorkspaces });
          })
          .catch((e) => {
            db.close();
            reject(e);
          });
      };
    });
  });
}

async function run() {
  const chromium = loadPlaywrightChromium();
  const executablePath = resolveChromiumExecutable(chromium);

  let serverHandle = null;
  const baseUrl = process.env.E2E_BASE_URL || (() => {
    serverHandle = startEphemeralPreview(4179);
    return serverHandle.baseUrl;
  })();

  await waitForServer(baseUrl);

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const pageErrors = [];
  const consoleErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    // =========================================================================
    // SUITE A: Save Lifecycle, Continue/Reload, Nested Cancel & Debounce
    // =========================================================================
    const pageA = await context.newPage();
    pageA.setDefaultTimeout(10000);
    pageA.on('pageerror', (err) => {
      console.error('[PAGEERROR pageA]', err.message);
      pageErrors.push(`pageA: ${err.message}`);
    });
    pageA.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await dismissSplash(pageA);

    // 1. Untouched blank form -> Back -> NO Continue Analysis (even across reload)
    await pageA.getByRole('button', { name: /Start Analysis/i }).click();
    await pageA.waitForSelector('input[placeholder*="Optional — name this analysis"]');
    await pageA.getByRole('button', { name: /^Back$/i }).click();
    await pageA.waitForSelector('button:has-text("Start Analysis")');
    assert(
      (await pageA.locator('button:has-text("Continue Analysis")').count()) === 0,
      'Untouched blank form does not show false Continue Analysis on Home'
    );

    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await dismissSplash(pageA);
    assert(
      (await pageA.locator('button:has-text("Continue Analysis")').count()) === 0,
      'Untouched blank form still shows no Continue Analysis after reload'
    );

    // 2. New Save + Subsequent Update Save + Double-tap dedupe
    await pageA.getByRole('button', { name: /Start Analysis/i }).click();
    const titleInput = pageA.locator('input[placeholder*="Optional — name this analysis"]');
    await titleInput.fill('E2E First Report');
    await pageA.waitForTimeout(1000);
    await pageA.getByRole('button', { name: /^Save$/i }).click();
    await pageA.waitForTimeout(600);

    let dbState = await inspectIDB(pageA);
    assert(dbState.reports.length === 1, `New analysis -> Save creates exactly 1 report (got ${dbState.reports.length})`);
    const id1 = dbState.reports[0].id;
    assert(dbState.reports[0].title === 'E2E First Report', 'Saved report 1 title matches input');

    await titleInput.fill('E2E First Report Updated');
    await pageA.waitForTimeout(300);
    const saveBtn = pageA.getByRole('button', { name: /^Save$/i });
    await saveBtn.click();
    await saveBtn.click().catch(() => {});
    await pageA.waitForTimeout(700);

    dbState = await inspectIDB(pageA);
    assert(dbState.reports.length === 1, `Subsequent Save + double-tap keeps count at 1 (got ${dbState.reports.length})`);
    assert(dbState.reports[0].id === id1, 'Subsequent Save updated the exact same report ID');
    assert(dbState.reports[0].title === 'E2E First Report Updated', 'Updated title persisted in IDB');

    // 3. Back -> Reload -> Continue Analysis restores bound identity
    await pageA.getByRole('button', { name: /^Back$/i }).click();
    await pageA.waitForSelector('button:has-text("Continue Analysis")');
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await dismissSplash(pageA);
    await pageA.getByRole('button', { name: /Continue Analysis/i }).click();
    await pageA.waitForSelector('input[placeholder*="Optional — name this analysis"]');
    assert(
      (await titleInput.inputValue()) === 'E2E First Report Updated',
      'Continue Analysis after cold reload restores bound report title'
    );

    // 4. Save as New Report creates distinct ID, leaves original untouched, subsequent Save targets new ID
    await pageA.getByRole('button', { name: /Save as New Report/i }).click();
    await pageA.waitForTimeout(700);
    dbState = await inspectIDB(pageA);
    assert(dbState.reports.length === 2, `Save as New Report creates 2nd report (got ${dbState.reports.length})`);
    const rOrig = dbState.reports.find((r) => r.id === id1);
    const rNew = dbState.reports.find((r) => r.id !== id1);
    assert(Boolean(rOrig && rNew), 'Distinct original and new report IDs exist in IDB');
    const id2 = rNew.id;

    await titleInput.fill('E2E Second Copy Edited');
    await pageA.waitForTimeout(200);
    await pageA.getByRole('button', { name: /^Save$/i }).click();
    await pageA.waitForTimeout(700);
    dbState = await inspectIDB(pageA);
    assert(dbState.reports.length === 2, 'Subsequent Save after Save as New keeps count at 2');
    assert(
      dbState.reports.find((r) => r.id === id1)?.title === 'E2E First Report Updated',
      'Original report id1 remained untouched'
    );
    assert(
      dbState.reports.find((r) => r.id === id2)?.title === 'E2E Second Copy Edited',
      'New report id2 updated cleanly'
    );

    // 5. Unsaved edit on bound report -> Back -> Reload -> Continue -> Save updates bound report
    await titleInput.fill('E2E Unsaved On Bound');
    await pageA.getByRole('button', { name: /^Back$/i }).click();
    await pageA.waitForSelector('button:has-text("Continue Analysis")');
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await dismissSplash(pageA);
    await pageA.getByRole('button', { name: /Continue Analysis/i }).click();
    await pageA.waitForSelector('input[placeholder*="Optional — name this analysis"]');
    assert(
      (await titleInput.inputValue()) === 'E2E Unsaved On Bound',
      'Continue Analysis after reload preserved unsaved edit on top of bound report'
    );
    await pageA.getByRole('button', { name: /^Save$/i }).click();
    await pageA.waitForTimeout(700);
    dbState = await inspectIDB(pageA);
    assert(dbState.reports.length === 2, 'Saving resumed bound draft updates id2 without duplicating');
    assert(
      dbState.reports.find((r) => r.id === id2)?.title === 'E2E Unsaved On Bound',
      'Bound report id2 updated cleanly after Continue + reload'
    );

    // 6. Failed save retains entered data and Retry Save succeeds
    await titleInput.fill('E2E Failed Save Retention');
    await pageA.evaluate(() => {
      window.__origPut = IDBObjectStore.prototype.put;
      window.__failNextReportsPut = true;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__failNextReportsPut && this.name === 'reports') {
          window.__failNextReportsPut = false;
          throw new DOMException('Simulated storage failure', 'QuotaExceededError');
        }
        return window.__origPut.apply(this, args);
      };
    });
    await pageA.getByRole('button', { name: /^Save$/i }).click();
    await pageA.waitForSelector('text=Save failed — your analysis is still open', { timeout: 5000 });
    assert(
      (await titleInput.inputValue()) === 'E2E Failed Save Retention',
      'Failed save retains all entered title text in the editor'
    );
    await pageA.evaluate(() => {
      if (window.__origPut) {
        IDBObjectStore.prototype.put = window.__origPut;
      }
    });
    await pageA.getByRole('button', { name: /Retry Save/i }).click();
    await pageA.waitForTimeout(700);
    dbState = await inspectIDB(pageA);
    assert(
      dbState.reports.length === 2 && dbState.reports.find((r) => r.id === id2)?.title === 'E2E Failed Save Retention',
      'Retry Save after failure succeeds cleanly and updates id2'
    );

    // 7. Nested Scenario Edit -> Cancel -> Discard + 1200ms debounce non-resurrection check
    await pageA.getByRole('button', { name: /Add Scenario/i }).click();
    const scenarioDescTextarea = pageA
      .locator('textarea[placeholder*="Expected narrative and context"]')
      .first();
    await scenarioDescTextarea.fill('Saved Baseline Description');
    await pageA.getByRole('button', { name: /Save Scenario/i }).first().click();
    await pageA.waitForTimeout(300);

    await pageA.getByRole('button', { name: /Edit Scenario/i }).first().click();
    await scenarioDescTextarea.fill('UNSAVED_SCENARIO_EDIT_SHOULD_VANISH');
    await pageA.locator('button:visible').filter({ hasText: /^Cancel$/ }).first().click();
    await pageA.getByRole('button', { name: /Discard changes/i }).click();

    await pageA.waitForTimeout(1200);
    await pageA.getByRole('button', { name: /Edit Scenario/i }).first().click();
    const postCancelDesc = await scenarioDescTextarea.inputValue();
    assert(
      postCancelDesc === 'Saved Baseline Description' &&
        !postCancelDesc.includes('UNSAVED_SCENARIO_EDIT_SHOULD_VANISH'),
      'Nested Scenario Cancel discarded edits and did NOT resurrect after 1200ms debounce'
    );
    await pageA.locator('button:visible').filter({ hasText: /^Cancel$/ }).first().click();

    // Save Scenario baseline into id2
    await pageA.getByRole('button', { name: /^Save$/i }).click();
    await pageA.waitForTimeout(500);

    // =========================================================================
    // SUITE B: LIFO Back Stack, Live Isolation, Real Coinbase Feed, V1->V5 IDB Upgrade
    // =========================================================================
    await pageA.evaluate(() => window.scrollTo(0, 0));
    await pageA.getByRole('button', { name: 'Open navigation menu' }).click();
    await pageA.waitForSelector('div[role="dialog"][aria-label="Navigation Menu"]');
    await pageA.locator('div[role="dialog"][aria-label="Navigation Menu"] button:has-text("Settings")').click();
    await pageA.waitForSelector('div[role="dialog"][aria-label="Settings"]');
    await pageA.getByRole('button', { name: /Export Report Backup/i }).click();
    await pageA.waitForSelector('div[role="dialog"][aria-label="Backup & Restore Data"]');

    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(150);
    assert(
      (await pageA.locator('div[role="dialog"][aria-label="Backup & Restore Data"]').count()) === 0 &&
        (await pageA.locator('div[role="dialog"][aria-label="Settings"]').count()) === 1,
      'First Escape closed child BackupModal while keeping parent SettingsModal open (LIFO)'
    );
    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(150);
    assert(
      (await pageA.locator('div[role="dialog"][aria-label="Settings"]').count()) === 0,
      'Second Escape closed SettingsModal cleanly'
    );

    // Copy into Live -> Navigate to Live -> Reset isolation
    await pageA.getByRole('button', { name: /Copy into Live/i }).first().click();
    await pageA.waitForSelector('text=Copied to Live', { timeout: 3000 });
    await pageA.evaluate(() => window.scrollTo(0, 0));
    await pageA.getByRole('button', { name: 'Open navigation menu' }).click();
    await pageA.locator('div[role="dialog"][aria-label="Navigation Menu"] button:has-text("Live")').click();
    await pageA.waitForSelector('button:has-text("Reset Live")', { timeout: 5000 });

    const liveBodyText = await pageA.locator('#root').innerText();
    assert(
      !/Convert to Report|Convert to Trade/i.test(liveBodyText),
      'Live workspace has ZERO "Convert to Report / Trade" UI controls'
    );

    await pageA.getByRole('button', { name: /Reset XAUUSD/i }).click();
    await pageA.getByRole('button', { name: /Confirm Reset XAUUSD/i }).click();
    await pageA.waitForTimeout(300);
    dbState = await inspectIDB(pageA);
    const rep2AfterReset = dbState.reports.find((r) => r.id === id2);
    assert(
      Boolean(
        dbState.reports.length === 2 &&
          rep2AfterReset?.scenarios?.length === 1 &&
          rep2AfterReset.scenarios[0].description === 'Saved Baseline Description'
      ),
      'Resetting Live XAUUSD left source Analysis report and scenario completely untouched'
    );

    // Real Coinbase BTC-USD spot feed check & Manual EURUSD honesty
    let coinbaseResponse = null;
    pageA.on('response', async (res) => {
      if (res.url().includes('api.coinbase.com/v2/prices/BTC-USD/spot')) {
        try {
          coinbaseResponse = { status: res.status(), body: await res.json() };
        } catch {
          coinbaseResponse = { status: res.status(), body: null };
        }
      }
    });

    await pageA.getByRole('button', { name: /^BTCUSD$/i }).click();
    await pageA.getByRole('button', { name: /^Public Feed$/i }).click();
    await pageA.getByRole('button', { name: /Refresh Quote/i }).click();
    await pageA.waitForTimeout(2500);

    const btcLiveText = await pageA.locator('#root').innerText();
    console.log('[INFO] Observed Coinbase network result:', JSON.stringify(coinbaseResponse));
    assert(
      btcLiveText.includes('Coinbase BTC-USD') &&
        btcLiveText.includes('Spot (last)') &&
        btcLiveText.includes('not Exness bid/ask') &&
        (btcLiveText.includes('Retrieval time:') || btcLiveText.includes('Provider timestamp:')),
      'BTCUSD Public Feed displays honest Coinbase BTC-USD, Spot (last), not Exness bid/ask, and explicit timestamp labels'
    );
    if (coinbaseResponse && coinbaseResponse.status === 200) {
      assert(
        Boolean(coinbaseResponse.body?.data?.amount),
        `Live Coinbase API returned HTTP 200 with BTC-USD spot price: ${coinbaseResponse.body?.data?.amount}`
      );
    }

    await pageA.getByRole('button', { name: /^EURUSD$/i }).click();
    await pageA.waitForTimeout(200);
    const eurText = await pageA.locator('#root').innerText();
    assert(
      eurText.includes('Source: Manual (EURUSD)') && eurText.includes('Quote type: Manual'),
      'EURUSD defaults to clear Manual labeling without fabricating a live price feed'
    );

    await pageA.close();

    // Populated IndexedDB V1 -> V5 Upgrade in Chromium
    const v1Page = await context.newPage();
    v1Page.setDefaultTimeout(10000);
    v1Page.on('pageerror', (err) => {
      console.error('[PAGEERROR v1Page]', err.message);
      pageErrors.push(`v1Page: ${err.message}`);
    });
    await v1Page.goto(`${baseUrl}/abmax-hero.png`, { waitUntil: 'domcontentloaded' });
    await v1Page.evaluate(async () => {
      await new Promise((res, rej) => {
        const del = indexedDB.deleteDatabase('abmax_analysis_db');
        del.onsuccess = () => res(true);
        del.onerror = () => rej(del.error);
        del.onblocked = () => res(true);
      });
      await new Promise((res, rej) => {
        const open = indexedDB.open('abmax_analysis_db', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('draft')) db.createObjectStore('draft', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['reports', 'draft', 'templates', 'images'], 'readwrite');
          tx.objectStore('reports').put({
            id: 'v1_rep_1',
            title: 'Legacy V1 Chromium Report',
            pair: 'XAUUSD',
            date: '2025-11-01',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            timeframes: {},
            ocEntries: [],
            scenarios: [],
          });
          tx.objectStore('draft').put({
            id: 'active_draft',
            title: 'Legacy V1 Chromium Draft',
            pair: 'EURUSD',
            date: '2025-11-02',
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            timeframes: {},
            ocEntries: [],
            scenarios: [],
          });
          tx.objectStore('templates').put({
            id: 'v1_tpl_1',
            name: 'V1 Legacy Template',
            pair: 'XAUUSD',
            timeframes: {},
            scenarios: [],
            createdAt: 1700000000000,
          });
          tx.objectStore('images').put({
            id: 'v1_img_1',
            dataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          });
          tx.oncomplete = () => {
            db.close();
            res(true);
          };
          tx.onerror = () => rej(tx.error);
        };
        open.onerror = () => rej(open.error);
      });
    });

    await v1Page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await dismissSplash(v1Page);
    await v1Page.waitForTimeout(400);
    const upgradedDb = await inspectIDB(v1Page);
    assert(
      upgradedDb.version === 5,
      `Chromium IndexedDB V1 upgraded cleanly to version 5 (got ${upgradedDb.version})`
    );
    assert(upgradedDb.stores.includes('live_workspace'), 'Upgraded V5 database contains live_workspace object store');
    assert(
      upgradedDb.reports.some((r) => r.id === 'v1_rep_1' && r.title === 'Legacy V1 Chromium Report'),
      'V1 report survived Chromium IDB V1->V5 upgrade intact'
    );
    assert(
      upgradedDb.drafts.some((d) => d.id === 'active_draft' && d.title === 'Legacy V1 Chromium Draft'),
      'V1 active_draft survived Chromium IDB V1->V5 upgrade intact'
    );
    assert(
      upgradedDb.templates.some((t) => t.id === 'v1_tpl_1') &&
        upgradedDb.images.some((im) => im.id === 'v1_img_1'),
      'V1 template & image survived Chromium IDB V1->V5 upgrade intact'
    );

    // -------------------------------------------------------------------------
    // Chromium E2E: Settings -> Instruments + Propagation + Historical Preservation + Reset Gate
    // -------------------------------------------------------------------------
    const instContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const instPage = await instContext.newPage();
    instPage.setDefaultTimeout(10000);
    instPage.on('pageerror', (err) => {
      console.error('[PAGEERROR instPage]', err.message);
      pageErrors.push(`instPage: ${err.message}`);
    });
    await instPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await dismissSplash(instPage);

    // Open Settings via hamburger drawer
    await instPage.getByRole('button', { name: 'Open navigation menu' }).click();
    await instPage.locator('div[role="dialog"][aria-label="Navigation Menu"] button:has-text("Settings")').click();
    await instPage.getByRole('dialog', { name: /^Settings$/i }).waitFor({ state: 'visible' });

    // General tab shows Full Account-Data Reset gated cleanly for signed-out / guest users
    const resetTriggerBtn = instPage.getByRole('button', { name: /Review Full Account Reset/i });
    await resetTriggerBtn.waitFor({ state: 'visible' });
    assert(
      await resetTriggerBtn.isDisabled(),
      'Chromium Settings -> General disables Full Account Reset button when signed out'
    );

    // Navigate to Instruments tab and add GBPUSD & US30
    await instPage.getByRole('button', { name: /^Instruments$/i }).click();
    const symbolInput = instPage.getByLabel('New instrument symbol');
    await symbolInput.fill('gbp/usd');
    await instPage.getByLabel('New instrument category').selectOption('Forex');
    await instPage.getByRole('button', { name: /^Add Instrument$/i }).click();
    await instPage.getByRole('button', { name: 'Disable GBPUSD' }).waitFor({ state: 'visible' });

    await symbolInput.fill('US30');
    await instPage.getByLabel('New instrument category').selectOption('Indices');
    await instPage.getByRole('button', { name: /^Add Instrument$/i }).click();
    await instPage.getByRole('button', { name: 'Disable US30' }).waitFor({ state: 'visible' });

    const instrumentsTabText = await instPage.getByRole('dialog', { name: /^Settings$/i }).innerText();
    assert(
      instrumentsTabText.includes('XAUUSD') &&
        instrumentsTabText.includes('EURUSD') &&
        instrumentsTabText.includes('BTCUSD') &&
        instrumentsTabText.includes('GBPUSD') &&
        instrumentsTabText.includes('US30') &&
        instrumentsTabText.includes('does not imply a live price feed'),
      'Settings -> Instruments renders defaults, adds normalized custom symbols, and discloses Live feed boundary'
    );
    await instPage.getByRole('button', { name: /^Done$/i }).click();

    // Verify GBPUSD & US30 appear in Analysis pair selector and save a GBPUSD report
    await instPage.getByRole('button', { name: /Start Analysis/i }).click();
    await instPage.getByLabel('Analysis Pair').waitFor({ state: 'visible' });
    const pairOptionsText = await instPage.getByLabel('Analysis Pair').innerText();
    assert(
      pairOptionsText.includes('GBPUSD') && pairOptionsText.includes('US30'),
      'Analysis Pair dropdown dynamically includes custom GBPUSD and US30'
    );
    await instPage.getByLabel('Analysis Pair').selectOption('GBPUSD');
    await instPage.getByPlaceholder('Optional — name this analysis').fill('GBPUSD Custom Pair Test');
    await instPage.getByRole('button', { name: /^Save$/i }).click();
    await instPage.waitForTimeout(500);
    await instPage.evaluate(() => window.scrollTo(0, 0));
    await instPage.getByRole('button', { name: /^Reports$/i }).click();
    await instPage.getByText('GBPUSD Custom Pair Test').first().waitFor({ state: 'visible' });

    // Check Live tab renders GBPUSD & US30 tabs without fabricating a live feed
    await instPage.evaluate(() => window.scrollTo(0, 0));
    await instPage.getByRole('button', { name: 'Open navigation menu' }).click();
    await instPage.locator('div[role="dialog"][aria-label="Navigation Menu"] button:has-text("Live")').click();
    await instPage.getByRole('button', { name: /^GBPUSD$/i }).click();
    await instPage.waitForTimeout(150);
    const liveCustomText = await instPage.locator('#root').innerText();
    assert(
      liveCustomText.includes('Source: Manual (GBPUSD)') &&
        liveCustomText.includes('Quote type: Manual'),
      'Live workspace renders custom GBPUSD tab honestly as Manual observation'
    );

    // Disable GBPUSD in Settings -> Instruments and verify historical GBPUSD report remains preserved & filterable
    await instPage.evaluate(() => window.scrollTo(0, 0));
    await instPage.getByRole('button', { name: 'Open navigation menu' }).click();
    await instPage.locator('div[role="dialog"][aria-label="Navigation Menu"] button:has-text("Settings")').click();
    await instPage.getByRole('button', { name: /^Instruments$/i }).click();
    await instPage.getByRole('button', { name: 'Disable GBPUSD' }).click();
    await instPage.getByRole('button', { name: /^Done$/i }).click();

    await instPage.getByRole('button', { name: /^Reports$/i }).click();
    await instPage.waitForTimeout(200);
    const filterOptsText = await instPage.getByLabel('Filter reports by instrument').innerText();
    assert(
      (await instPage.locator('#root').innerText()).includes('GBPUSD Custom Pair Test') &&
        filterOptsText.includes('GBPUSD (Historical)'),
      'Disabling custom GBPUSD preserves historical report intact and keeps it filterable in Reports'
    );

    await instPage.close();
    await instContext.close();
    await v1Page.close();

    assert(
      pageErrors.length === 0,
      `Zero uncaught page errors in Chromium (got ${pageErrors.length}: ${JSON.stringify(pageErrors)})`
    );
    console.log(`[INFO] Console errors count: ${consoleErrors.length}`);
    console.log('=== ALL CHROMIUM REGRESSION CHECKS PASSED ===');
  } finally {
    await browser.close();
    if (serverHandle) serverHandle.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
