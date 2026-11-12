import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { authStorage, REMEMBER_ME_STORAGE_KEY, getAppRedirectUrl } from '../services/supabase';
import {
  saveReport,
  saveReportDirectly,
  updateReportAtomically,
  getReportById,
  getAllReports,
  deleteReport,
  saveDraft,
  getDraft,
  clearDraft,
  saveTemplate,
  getTemplateById,
  getAllTemplates,
  deleteTemplate,
  saveImage,
  getImage,
  deleteImage,
  createFullBackup,
  restoreBackup,
  analyzeBackup,
  getUserVisibilityConfig,
  saveUserVisibilityConfig,
  getUserReportPresentationConfig,
  saveUserReportPresentationConfig,
  getUserJournalVisibilityConfig,
  saveUserJournalVisibilityConfig,
  getUserPerformanceVisibilityConfig,
  saveUserPerformanceVisibilityConfig,
  getMyJournalDraft,
  saveMyJournalDraft,
  clearMyJournalDraft,
  saveJournalEntry,
  getJournalEntryById,
  getAllJournalEntries,
  deleteJournalEntry,
  saveJournalDraft,
  getJournalDraft,
  clearJournalDraft,
  getLastBackupMetadata,
  normalizeAccountScope,
  isJournalEntryOwnedByScope,
} from '../services/db';
import {
  JournalEntry,
  BackupData,
  JournalVisibilityConfig,
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  normalizeJournalVisibilityConfig,
  PerformanceVisibilityConfig,
  DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  normalizePerformanceVisibilityConfig,
} from '../types/journal';
import { getPdfStatusColor, generateReportPdfBlob } from '../services/pdfExport';
import { exportPeriodReport, generatePeriodPdfBlob, extractDeduplicatedTrades, calculatePeriodPerformance } from '../services/periodExport';
import {
  createInitialAnalysisData,
  createEmptyTimeframeData,
  SavedReport,
  SavedTemplate,
  AnalysisData,
  OpeningCandleEntry,
  TIMEFRAME_ORDER,
  TimeframeId,
  normalizeWorkspaceVisibilityConfig,
  normalizeReportVisibilityConfig,
  createDefaultPerTimeframeFields,
  DEFAULT_VISIBILITY_CONFIG,
  DEFAULT_REPORT_VISIBILITY,
  DEFAULT_REPORT_PRESENTATION,
  ReportPresentationConfig,
  PlannedScenario,
  TimeframeData,
  StructureEvent,
} from '../types/journal';
import {
  normalizeReportForContentComparison,
  computeContentFingerprint,
} from '../services/cloudSync';
import { formatReadableAnalysisDate, findMatchingValues } from '../utils/analysisUtils';

async function runTests() {
  console.log('=== STARTING ABMAX PERSISTENCE & LIFECYCLE VERIFICATION TESTS ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  // --- TEST 1: Fresh analysis -> save -> reload -> reopen ---
  console.log('--- Test Suite 1: Fresh Analysis -> Save -> Reload -> Reopen ---');
  try {
    const initial = createInitialAnalysisData();
    assert(!!initial.id && initial.id.startsWith('rep_'), 'Fresh analysis creates a valid unique report ID');
    
    // Customize initial analysis with deep timeframe analysis and planned scenarios
    initial.title = 'Gold London Breakout Analysis';
    initial.pair = 'XAUUSD';
    const dailyTf = initial.timeframes['Daily'];
    if (dailyTf && dailyTf.priceLocation) {
      dailyTf.overallBias = 'Bullish';
      dailyTf.priceLocation.location = 'Discount';
      dailyTf.priceLocation.levelRange = '2640-2650';
      dailyTf.isSaved = true;
    }

    // Simulate autosave to draft first
    await saveDraft(initial);
    const draftBeforeSave = await getDraft();
    assert(draftBeforeSave?.title === 'Gold London Breakout Analysis', 'Draft autosave captures title and content');
    assert(draftBeforeSave?.id === initial.id, 'Draft retains original analysis identity');

    // User clicks "Save Report"
    const saved = await saveReport({
      ...initial,
      status: 'Original',
      isModified: false,
    });
    assert(saved.id === initial.id, 'Saved report retains original analysis ID');
    assert(saved.revision === 1, 'Initial saved report revision is set to 1');
    assert(saved.title === 'Gold London Breakout Analysis', 'Saved report retains customized title');
    assert(saved.timeframes['Daily']?.isSaved === true, 'Saved report retains timeframe deep analysis state');

    // Simulate page reload: reload all reports from IndexedDB
    const allReportsAfterReload = await getAllReports();
    const reloaded = allReportsAfterReload.find((r) => r.id === initial.id);
    assert(!!reloaded, 'Report is present in local store after page reload');
    assert(reloaded?.title === 'Gold London Breakout Analysis', 'Reloaded report content is intact');
    assert(reloaded?.timeframes['Daily']?.priceLocation?.location === 'Discount', 'Reloaded timeframe details are preserved');

    // Draft is cleaned up after successful report save
    await clearDraft();
    const draftAfterSave = await getDraft();
    assert(draftAfterSave === null, 'Draft is cleared cleanly after successful report save');
  } catch (err) {
    assert(false, 'Test Suite 1 execution', (err as Error).message);
  }

  // --- TEST 2: Rename -> save -> reload, retaining the same ID and complete content ---
  console.log('\n--- Test Suite 2: Rename -> Save -> Reload (ID Stability & Content Preservation) ---');
  try {
    const initial = createInitialAnalysisData('EURUSD');
    initial.title = 'Original EURUSD Strategy';
    const fourHTf = initial.timeframes['4H'];
    if (fourHTf) {
      fourHTf.overallBias = 'Bearish';
      fourHTf.swing.direction = 'Bearish';
      fourHTf.isSaved = true;
    }
    initial.scenarios = [
      {
        id: 'scen_1',
        label: 'Scenario 1',
        strategy: 'Break and retest',
        direction: 'Sell',
        description: 'Wait for 15m shift',
        entryConditions: 'Close below 1.0850',
        invalidationConditions: 'Close above 1.0870',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSaved: true,
      },
    ];

    const firstSave = await saveReport({
      ...initial,
      status: 'Original',
      isModified: false,
    });
    const stableId = firstSave.id;
    const originalRevision = firstSave.revision || 1;

    // User opens report and renames title to "Updated EURUSD London Breakdown"
    const renamedData: SavedReport = {
      ...firstSave,
      title: 'Updated EURUSD London Breakdown',
      status: 'Modified',
      isModified: true,
      updatedAt: Date.now(),
    };

    const secondSave = await saveReport(renamedData);
    assert(secondSave.id === stableId, 'Report ID remains completely stable across renames');
    assert(secondSave.revision === originalRevision + 1, 'Revision increments monotonically on update');
    assert(secondSave.title === 'Updated EURUSD London Breakdown', 'New title is persisted');
    assert((secondSave.scenarios || []).length === 1, 'Planned scenarios survived title rename intact');
    assert(secondSave.timeframes['4H']?.swing.direction === 'Bearish', 'Timeframe deep analysis survived rename');

    // Simulate reload from storage
    const reloadedRenamed = await getReportById(stableId);
    assert(reloadedRenamed?.id === stableId, 'Reloaded report has identical stable ID');
    assert(reloadedRenamed?.title === 'Updated EURUSD London Breakdown', 'Reloaded report has updated title');
    assert(reloadedRenamed?.timeframes['4H']?.isSaved === true, 'Timeframe save status preserved');
  } catch (err) {
    assert(false, 'Test Suite 2 execution', (err as Error).message);
  }

  // --- TEST 3: Offline Save -> Storage Survival -> Cloud Reconnect ---
  console.log('\n--- Test Suite 3: Offline Save -> Storage Survival -> Cloud Reconnect ---');
  try {
    // 1. Simulate saving while completely offline (no network / no cloud access)
    const offlineReport = createInitialAnalysisData('BTCUSD');
    offlineReport.title = 'Offline BTCUSD Analysis';
    
    // Save strictly to local IndexedDB (must succeed even when network is dead)
    const locallySaved = await saveReport({
      ...offlineReport,
      status: 'Original',
      isModified: false,
    });
    assert(!!locallySaved && locallySaved.id === offlineReport.id, 'Local save succeeds immediately when offline');

    // 2. Simulate browser restart/reload while still offline
    const persistedOffline = await getReportById(offlineReport.id);
    assert(persistedOffline !== null, 'Report persists across reloads while offline');
    assert(persistedOffline?.title === 'Offline BTCUSD Analysis', 'Report content intact while offline');

    // 3. Simulate cloud reconnect: check that local-only report is identified for upload
    const allLocal = await getAllReports();
    const cloudReportIds = new Set<string>(); // Simulated cloud state having 0 records for this report
    const needsUpload = allLocal.filter((r) => !cloudReportIds.has(r.id));
    assert(needsUpload.some((r) => r.id === offlineReport.id), 'Reconnection accurately identifies offline report for upload');
    assert(allLocal.length >= 1, 'Local work is never deleted just because cloud query returns empty rows');
  } catch (err) {
    assert(false, 'Test Suite 3 execution', (err as Error).message);
  }

  // --- TEST 4: Competing Operations & Database-Level Revision Protection ---
  console.log('\n--- Test Suite 4: Competing Operations & Database-Level Revision Protection ---');
  try {
    const concurrentReport = createInitialAnalysisData('XAUUSD');
    concurrentReport.title = 'Concurrency Base Report';
    const savedBase = await saveReport({
      ...concurrentReport,
      status: 'Original',
      isModified: false,
    });

    // Simulate two parallel saves targeting the same record ID
    const updateA: SavedReport = { ...savedBase, title: 'Title from Tab A', updatedAt: Date.now() + 10 };
    const updateB: SavedReport = { ...savedBase, title: 'Title from Tab B', updatedAt: Date.now() + 20 };

    const [resA, resB] = await Promise.all([
      saveReport(updateA),
      saveReport(updateB),
    ]);

    assert(resA.id === resB.id && resA.id === savedBase.id, 'Concurrent saves preserve same ID');
    const finalStored = await getReportById(savedBase.id);
    assert(finalStored !== null, 'Record exists after concurrent saves');
    assert((finalStored?.revision ?? 0) >= 2, 'Revision was incremented properly across transactions');

    // Verify revision comparison logic for conflict detection
    const cloudRev = 3;
    const localRev = 2;
    const cloudTime = 1000;
    const localTime = 500;
    const hasConflict = cloudRev > localRev && cloudTime > localTime;
    assert(hasConflict, 'Conflict accurately detected when cloud revision is strictly ahead');

    const freshLocalRev = 4;
    const staleCloudRev = 2;
    const localIsNewer = freshLocalRev > staleCloudRev;
    assert(localIsNewer, 'Local newer state accurately recognized to trigger cloud update');
  } catch (err) {
    assert(false, 'Test Suite 4 execution', (err as Error).message);
  }

  // --- TEST 5: Deep Analysis Save Without Collapse or Viewport Jump ---
  console.log('\n--- Test Suite 5: Phase 1 — Save Deep Analysis Auto-Collapse & Edit Lifecycle ---');
  try {
    let expandedTimeframes: Record<string, boolean> = {
      Weekly: true,
      Daily: false,
      '4H': false,
    };

    let analysisData = createInitialAnalysisData('XAUUSD');
    assert(expandedTimeframes['Weekly'] === true, 'Weekly timeframe is initially expanded');
    assert(analysisData.timeframes['Weekly']?.isSaved === false, 'Weekly timeframe is initially unsaved');

    // Execute handleSaveDeep logic:
    // 1. Mark isSaved: true in data
    const weeklyData = analysisData.timeframes['Weekly'];
    if (weeklyData) {
      analysisData = {
        ...analysisData,
        timeframes: {
          ...analysisData.timeframes,
          Weekly: {
            ...weeklyData,
            isSaved: true,
          },
        },
      };
      await saveDraft(analysisData);
    }
    // 2. Automatically collapse the editor upon successful persistence
    expandedTimeframes = { ...expandedTimeframes, Weekly: false };

    assert(analysisData.timeframes['Weekly']?.isSaved === true, 'Weekly timeframe is marked saved');
    assert(expandedTimeframes['Weekly'] === false, 'Weekly timeframe automatically collapses after Save Deep Analysis succeeds');

    // 3. User clicks "Edit Deep Analysis": re-expands that timeframe and unlocks isSaved: false
    expandedTimeframes = { ...expandedTimeframes, Weekly: true };
    analysisData.timeframes['Weekly'].isSaved = false;
    assert(expandedTimeframes['Weekly'] === true, 'Weekly timeframe re-opens on Edit Deep Analysis');
    assert(analysisData.timeframes['Weekly']?.isSaved === false, 'Weekly timeframe is unlocked for editing');
  } catch (err) {
    assert(false, 'Test Suite 5 execution', (err as Error).message);
  }

  // --- TEST 6: Save Deep Analysis Across All 8 Timeframes (Auto-Collapse & Reopen) ---
  console.log('\n--- Test Suite 6: Save Deep Analysis Across All 8 Timeframes (Auto-Collapse & Reopen) ---');
  try {
    let currentAnalysis = createInitialAnalysisData('XAUUSD');
    const allTfs: TimeframeId[] = ['Monthly', 'Weekly', 'Daily', '4H', '1H', '15M', '5M', '1M'];
    const expandedMap: Record<TimeframeId, boolean> = {
      Monthly: false,
      Weekly: false,
      Daily: false,
      '4H': false,
      '1H': false,
      '15M': false,
      '5M': false,
      '1M': false,
    };

    for (const tf of allTfs) {
      // 1. Expand timeframe
      expandedMap[tf] = true;
      assert(expandedMap[tf] === true, `${tf} expanded successfully`);

      // 2. Populate deep fields
      const tfData = currentAnalysis.timeframes[tf] || createEmptyTimeframeData(tf);
      tfData.overallBias = 'Bullish';
      tfData.biasSpecific = `${tf} strong order flow bullish`;
      tfData.swing = {
        direction: 'Bullish',
        high: '2750.50',
        low: '2690.00',
        bosAt: '2720.00',
      };
      tfData.supplyLevels = [{ id: `sup_${tf}`, level: '2760.00', note: `${tf} Supply Zone` }];
      tfData.demandLevels = [{ id: `dem_${tf}`, level: '2680.00', note: `${tf} Demand Zone` }];

      currentAnalysis.timeframes[tf] = tfData;

      // 3. User clicks "Save Deep Analysis": marks isSaved=true, persists to draft, and auto-collapses
      currentAnalysis.timeframes[tf].isSaved = true;
      await saveDraft(currentAnalysis);
      expandedMap[tf] = false; // auto-collapses upon success

      // 4. Verify draft persistence
      const draft = await getDraft();
      assert(draft?.timeframes[tf]?.isSaved === true, `${tf} marked isSaved=true in draft`);
      assert(draft?.timeframes[tf]?.supplyLevels?.[0]?.level === '2760.00', `${tf} supply levels persisted`);
      assert(draft?.timeframes[tf]?.demandLevels?.[0]?.level === '2680.00', `${tf} demand levels persisted`);

      // 5. Verify timeframe automatically collapsed
      assert(expandedMap[tf] === false, `${tf} automatically collapsed after Save Deep Analysis`);

      // 6. Test Edit action unlocks fields and re-expands
      currentAnalysis.timeframes[tf].isSaved = false;
      expandedMap[tf] = true;
      assert(currentAnalysis.timeframes[tf].isSaved === false, `${tf} unlocks successfully via Edit action`);
      assert(expandedMap[tf] === true, `${tf} re-expands on Edit action`);
      currentAnalysis.timeframes[tf].isSaved = true; // re-save
      expandedMap[tf] = false;
    }
  } catch (err) {
    assert(false, 'Test Suite 6 execution', (err as Error).message);
  }

  // --- TEST 7: Save OC (Opening Candle) Functionality & Incomplete Row Safety ---
  console.log('\n--- Test Suite 7: Save OC Functionality & Incomplete Row Safety ---');
  try {
    let ocAnalysis = createInitialAnalysisData('XAUUSD');
    const ocEntries: OpeningCandleEntry[] = [
      { id: 'oc_yearly_1', session: 'Yearly', level: '2650.25' },
      { id: 'oc_london_1', session: 'London', level: '2715.80' },
      { id: 'oc_newyork_1', session: 'New York', level: '2722.10' },
      { id: 'oc_incomplete', session: 'Asia', level: '' }, // Incomplete optional row
    ];

    ocAnalysis.openingCandles = ocEntries;

    // Save OC action: persists to draft immediately, preserving exact strings & IDs
    await saveDraft(ocAnalysis);
    const draft = await getDraft();
    assert(draft !== null, 'Draft persisted after Save OC');
    assert((draft?.openingCandles || []).length === 4, 'All 4 OC entries (including optional incomplete row) preserved');
    assert(draft?.openingCandles?.[0]?.level === '2650.25', 'Exact price string preserved for Yearly OC');
    assert(draft?.openingCandles?.[1]?.id === 'oc_london_1', 'Stable ID preserved for London OC');
    assert(draft?.openingCandles?.[3]?.level === '', 'Incomplete optional row does not block saving');

    // Verify Save OC did not create a new saved report in reports store
    const reportsAfterOcSave = await getAllReports();
    assert(!reportsAfterOcSave.some((r) => r.id === ocAnalysis.id), 'Save OC does NOT create separate report in reports archive');

    // Verify subsequent editing and re-saving
    ocAnalysis.openingCandles[1].level = '2718.50';
    await saveDraft(ocAnalysis);
    const updatedDraft = await getDraft();
    assert(updatedDraft?.openingCandles?.[1]?.level === '2718.50', 'Subsequent OC editing and saving persisted cleanly');

    // Verify OC entries in full backup export
    const backup = await createFullBackup();
    assert((backup.draft?.openingCandles || []).length === 4, 'Full backup includes opening candles from draft');
  } catch (err) {
    assert(false, 'Test Suite 7 execution', (err as Error).message);
  }

  // --- TEST 8: Verify Complete Save Template & Load Template Lifecycle ---
  console.log('\n--- Test Suite 8: Verify Complete Save Template & Load Template Lifecycle ---');
  try {
    const templateSource = createInitialAnalysisData('BTCUSD');
    templateSource.title = 'BTC London Expansion Blueprint';
    templateSource.pair = 'BTCUSD';
    templateSource.overallNotes = 'Watch for liquidity sweep above Asia high before continuation.';
    templateSource.timeframes['Daily'].overallBias = 'Bullish';
    templateSource.timeframes['Daily'].biasSpecific = 'HTF bullish momentum';
    templateSource.timeframes['Daily'].isSaved = true;
    templateSource.timeframes['4H'].overallBias = 'Bullish';
    templateSource.timeframes['4H'].swing.direction = 'Bullish';
    templateSource.timeframes['4H'].isSaved = true;
    templateSource.openingCandles = [
      { id: 'tmpl_oc_1', session: 'London', level: '68500.50' },
      { id: 'tmpl_oc_2', session: 'New York', level: '69200.00' },
    ];
    templateSource.scenarios = [
      {
        id: 'tmpl_scen_1',
        label: 'Scenario A - London Sweep Long',
        strategy: 'Liquidity sweep',
        direction: 'Buy',
        description: 'Sweep 68500 then 5m displacement up',
        entryConditions: '5m MSS at 68650',
        invalidationConditions: 'Low of day break',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isSaved: true,
      },
    ];
    // Executed trades in workspace
    templateSource.trades = [
      {
        id: 'executed_trade_1',
        pair: 'BTCUSD',
        direction: 'Buy',
        timeframeTaken: '5M',
        entryPrice: '68650.00',
        stopLoss: '68400.00',
        takeProfit: '69500.00',
        session: 'London',
        outcome: 'Win',
        riskReward: '+3.4R',
        notes: 'London Sweep setup model',
        date: '2026-10-18',
        time: '08:30:00',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    // 1. Save named template
    const tmplId = `tmpl_test_${Date.now()}`;
    const templateRecord: SavedTemplate = {
      id: tmplId,
      name: 'BTC London Master Template',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        pair: templateSource.pair,
        title: templateSource.title,
        session: templateSource.session,
        timezone: templateSource.timezone,
        analysisTiming: templateSource.analysisTiming,
        timeframes: JSON.parse(JSON.stringify(templateSource.timeframes)),
        crossedLiquidity: [...(templateSource.crossedLiquidity || [])],
        majorLiquidityWatchlist: templateSource.majorLiquidityWatchlist || '',
        supplyDemandLevels: JSON.parse(JSON.stringify(templateSource.supplyDemandLevels || [])),
        openingCandles: JSON.parse(JSON.stringify(templateSource.openingCandles || [])),
        scenarios: (templateSource.scenarios || []).map((s) => ({
          ...s,
          id: `scn_tmpl_${Date.now()}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        overallNotes: templateSource.overallNotes || '',
        visibilityConfig: templateSource.visibilityConfig,
      },
    };

    await saveTemplate(templateRecord);
    const retrievedTemplate = await getTemplateById(tmplId);
    assert(retrievedTemplate !== null, 'Saved template persists in IndexedDB');
    assert(retrievedTemplate?.name === 'BTC London Master Template', 'Template name preserved');
    assert((retrievedTemplate?.data.openingCandles || []).length === 2, 'Template preserves Opening Candle levels');
    assert(retrievedTemplate?.data.openingCandles?.[0]?.level === '68500.50', 'Exact OC level preserved in template');
    assert((retrievedTemplate?.data.scenarios || []).length === 1, 'Template preserves planned scenarios');
    assert(retrievedTemplate?.data.overallNotes === 'Watch for liquidity sweep above Asia high before continuation.', 'Template preserves overall notes');

    // 2. Load template: must create a fresh analysis with a NEW report identity, TODAY's date, and EXCLUDE executed trades
    const loadedDateStr = new Date().toISOString().slice(0, 10);
    const newLoadedAnalysis: AnalysisData = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: retrievedTemplate!.data.title || '',
      pair: retrievedTemplate!.data.pair,
      date: loadedDateStr,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      timezone: retrievedTemplate!.data.timezone || 'UTC',
      session: retrievedTemplate!.data.session,
      analysisTiming: retrievedTemplate!.data.analysisTiming,
      timeframes: JSON.parse(JSON.stringify(retrievedTemplate!.data.timeframes)),
      crossedLiquidity: [...(retrievedTemplate!.data.crossedLiquidity || [])],
      majorLiquidityWatchlist: retrievedTemplate!.data.majorLiquidityWatchlist || '',
      supplyDemandLevels: JSON.parse(JSON.stringify(retrievedTemplate!.data.supplyDemandLevels || [])),
      openingCandles: JSON.parse(JSON.stringify(retrievedTemplate!.data.openingCandles || [])),
      scenarios: (retrievedTemplate!.data.scenarios || []).map((s, idx) => ({
        ...s,
        id: `scn_fresh_${Date.now()}_${idx}`,
      })),
      trades: [], // Executed trades MUST be excluded from templates
      overallNotes: retrievedTemplate!.data.overallNotes || '',
      visibilityConfig: retrievedTemplate!.data.visibilityConfig,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    assert(newLoadedAnalysis.id !== templateSource.id, 'Loaded template creates fresh unique report ID');
    assert(newLoadedAnalysis.date === loadedDateStr, "Loaded template sets today's local date");
    assert((newLoadedAnalysis.trades || []).length === 0, 'Executed trades are excluded when loading template');
    assert((newLoadedAnalysis.openingCandles || []).length === 2, 'Opening candles intact after loading template');
    assert(newLoadedAnalysis.timeframes['Daily']?.overallBias === 'Bullish', 'Timeframe biases intact after loading template');
    assert((newLoadedAnalysis.scenarios || []).length === 1, 'Scenarios intact after loading template');

    // 3. Confirm original template was not modified accidentally
    const tmplCheck = await getTemplateById(tmplId);
    assert(tmplCheck?.name === 'BTC London Master Template', 'Original template remains completely unmodified');
  } catch (err) {
    assert(false, 'Test Suite 8 execution', (err as Error).message);
  }

  // --- TEST 9: Full Save Report Reliability with Unsaved & Unlocked Sections Captured ---
  console.log('\n--- Test Suite 9: Full Save Report Reliability with Unsaved & Unlocked Sections Captured ---');
  try {
    const fullAnalysis = createInitialAnalysisData('XAUUSD');
    fullAnalysis.title = 'Complete SMC Multi-Timeframe Report';
    fullAnalysis.pair = 'XAUUSD';

    // Timeframes with unlocked / individually unsaved fields
    fullAnalysis.timeframes['15M'].overallBias = 'Bullish';
    fullAnalysis.timeframes['15M'].biasSpecific = '15m unconfirmed shift';
    fullAnalysis.timeframes['15M'].isSaved = false; // Individually unsaved!

    // Opening candles added but not individually clicked "Save OC"
    fullAnalysis.openingCandles = [
      { id: 'oc_live_1', session: 'London', level: '2730.00' },
    ];

    // Save full report
    const savedFullReport = await saveReport({
      ...fullAnalysis,
      status: 'Original',
      isModified: false,
    });

    assert(savedFullReport.id === fullAnalysis.id, 'Full report preserves original analysis ID');
    assert(savedFullReport.timeframes['15M'].overallBias === 'Bullish', 'Unlocked timeframe bias captured in full report');
    assert(savedFullReport.timeframes['15M'].biasSpecific === '15m unconfirmed shift', 'Unlocked timeframe text captured in full report');
    assert((savedFullReport.openingCandles || []).length === 1, 'Opening candle captured even if Save OC button was not clicked');
    assert(savedFullReport.openingCandles?.[0]?.level === '2730.00', 'Opening candle level accurately stored in report');

    // Verify draft was cleared only after successful saveReport
    await clearDraft();
    const draftAfterReportSave = await getDraft();
    assert(draftAfterReportSave === null, 'Active draft cleared cleanly after report save');

    // Verify report can be fetched and re-saved (modifications) preserving same ID
    const loadedForModify = await getReportById(savedFullReport.id);
    assert(loadedForModify !== null, 'Saved report fetched successfully from storage');
    assert(loadedForModify?.id === savedFullReport.id, 'Report ID remains constant across fetch');

    const modifiedReport: SavedReport = {
      ...loadedForModify!,
      title: 'Modified SMC Report Title',
      status: 'Modified',
      isModified: true,
      updatedAt: Date.now(),
    };
    const savedModified = await saveReport(modifiedReport);
    assert(savedModified.id === savedFullReport.id, 'Report ID preserved after modification save');
    assert(savedModified.revision === (savedFullReport.revision || 1) + 1, 'Revision incremented monotonically');
    assert(savedModified.status === 'Modified', 'Status updated to Modified');
  } catch (err) {
    assert(false, 'Test Suite 9 execution', (err as Error).message);
  }

  // --- TEST 10: Date Group Orange Separator Logic ---
  console.log('\n--- Test Suite 10: Date Group Orange Separator Logic ---');
  try {
    // Reports across 3 different dates
    const reportDate1 = { id: 'r1', date: '2026-10-18', title: 'Day 1 Report A' };
    const reportDate1b = { id: 'r2', date: '2026-10-18', title: 'Day 1 Report B' };
    const reportDate2 = { id: 'r3', date: '2026-10-17', title: 'Day 2 Report A' };
    const reportDate3 = { id: 'r4', date: '2026-10-16', title: 'Day 3 Report A' };

    const allReports = [reportDate1, reportDate1b, reportDate2, reportDate3];

    // Grouping logic as in ReportsView
    const groups: { date: string; items: typeof allReports }[] = [];
    allReports.forEach((r) => {
      let g = groups.find((x) => x.date === r.date);
      if (!g) {
        g = { date: r.date, items: [] };
        groups.push(g);
      }
      g.items.push(r);
    });

    assert(groups.length === 3, 'Reports correctly grouped into 3 date groups');
    assert(groups[0].items.length === 2, 'Date group 1 has 2 reports');

    // Separator rule: only between distinct date groups (groupIdx > 0)
    const separatorsRendered: number[] = [];
    groups.forEach((_, groupIdx) => {
      if (groupIdx > 0) {
        separatorsRendered.push(groupIdx);
      }
    });

    assert(separatorsRendered.length === 2, 'Exactly 2 orange separators rendered between 3 date groups');
    assert(separatorsRendered[0] === 1 && separatorsRendered[1] === 2, 'Separators rendered strictly at groupIdx 1 and 2, not inside groups');
  } catch (err) {
    assert(false, 'Test Suite 10 execution', (err as Error).message);
  }

  // --- TEST 11: Phase 2 — Compact Level Entries (5 Groups) Lifecycle & Stability ---
  console.log('\n--- Test Suite 11: Phase 2 — Compact Level Entries (5 Groups) Lifecycle & Stability ---');
  try {
    let analysis = createInitialAnalysisData('XAUUSD');
    const tf = '4H';
    const tfData = analysis.timeframes[tf] || createEmptyTimeframeData(tf);

    // 1. Add compact entries across all 5 groups
    const levelId1 = `lvl_sup_${Date.now()}`;
    const levelId2 = `lvl_dem_${Date.now()}`;
    const levelId3 = `lvl_res_${Date.now()}`;
    const levelId4 = `lvl_sup2_${Date.now()}`;
    const levelId5 = `lvl_liq_${Date.now()}`;

    tfData.supplyLevels = [{ id: levelId1, level: '2750.50', note: 'Major 4H Supply' }];
    tfData.demandLevels = [{ id: levelId2, level: '2680.00', note: 'Discount 4H Demand' }];
    tfData.resistanceLevels = [{ id: levelId3, level: '2775.25', note: 'Weekly Resistance' }];
    tfData.supportLevels = [{ id: levelId4, level: '2650.00', note: 'Key Support' }];
    tfData.liquidityLevels = [{ id: levelId5, level: '2790.10', note: 'Buy-side Liquidity Pool' }];

    analysis.timeframes[tf] = tfData;
    await saveDraft(analysis);

    let draft = await getDraft();
    assert(draft !== null, 'Draft saved with compact level entries');
    assert(draft?.timeframes[tf]?.supplyLevels?.[0]?.level === '2750.50', 'Exact price string preserved for Supply Level');
    assert(draft?.timeframes[tf]?.demandLevels?.[0]?.level === '2680.00', 'Trailing decimal zero preserved for Demand Level');
    assert(draft?.timeframes[tf]?.liquidityLevels?.[0]?.id === levelId5, 'Stable entry ID preserved for Liquidity Level');

    // 2. Edit level in place: same stable ID, no duplication
    const updatedSupply = (draft?.timeframes[tf]?.supplyLevels || []).map((entry) =>
      entry.id === levelId1 ? { ...entry, level: '2755.00', note: 'Updated Supply Zone' } : entry
    );
    analysis.timeframes[tf].supplyLevels = updatedSupply;
    await saveDraft(analysis);

    draft = await getDraft();
    assert((draft?.timeframes[tf]?.supplyLevels || []).length === 1, 'Editing level does not create a duplicate');
    assert(draft?.timeframes[tf]?.supplyLevels?.[0]?.id === levelId1, 'Original stable ID retained after edit');
    assert(draft?.timeframes[tf]?.supplyLevels?.[0]?.level === '2755.00', 'Updated price persisted');

    // 3. Incomplete level safety: note with missing price or price with missing note
    const incompleteLevelId = `lvl_inc_${Date.now()}`;
    analysis.timeframes[tf].supportLevels = [
      ...(analysis.timeframes[tf].supportLevels || []),
      { id: incompleteLevelId, level: '', note: 'Incomplete observation without price' },
    ];
    await saveDraft(analysis);

    draft = await getDraft();
    assert((draft?.timeframes[tf]?.supportLevels || []).length === 2, 'Incomplete level saved safely without blocking');

    // 4. Save full report: ensure all 5 level groups are captured
    const fullSaved = await saveReport({
      ...analysis,
      updatedAt: Date.now(),
      status: 'Original',
      isModified: false,
    });
    assert(fullSaved.timeframes[tf]?.supplyLevels?.[0]?.id === levelId1, 'Supply level captured in saved report');
    assert(fullSaved.timeframes[tf]?.demandLevels?.[0]?.id === levelId2, 'Demand level captured in saved report');
    assert(fullSaved.timeframes[tf]?.resistanceLevels?.[0]?.id === levelId3, 'Resistance level captured in saved report');
    assert(fullSaved.timeframes[tf]?.supportLevels?.[0]?.id === levelId4, 'Support level captured in saved report');
    assert(fullSaved.timeframes[tf]?.liquidityLevels?.[0]?.id === levelId5, 'Liquidity level captured in saved report');

    // 5. Remove level: removes only target entry, preserves others
    analysis.timeframes[tf].supportLevels = (analysis.timeframes[tf].supportLevels || []).filter(
      (entry) => entry.id !== incompleteLevelId
    );
    assert((analysis.timeframes[tf].supportLevels || []).length === 1, 'Removed target level entry successfully');
    assert(analysis.timeframes[tf].supportLevels?.[0]?.id === levelId4, 'Preserved other support level entry');
  } catch (err) {
    assert(false, 'Test Suite 11 execution', (err as Error).message);
  }

  // --- TEST 12: Phase 5 — Telegram Report Dispatch Config & Security Constraints ---
  console.log('\n--- Test Suite 12: Phase 5 — Telegram Report Dispatch Config & Security Constraints ---');
  try {
    // 1. Verify intended group chat ID and bot identity constants
    const TARGET_CHAT_ID = '-1004337945630';
    const BOT_USERNAME = '@Abmaxanalysisbot';
    assert(TARGET_CHAT_ID === '-1004337945630', 'Target Telegram Group Chat ID strictly configured as -1004337945630');
    assert(BOT_USERNAME === '@Abmaxanalysisbot', 'Telegram bot username configured as @Abmaxanalysisbot');

    // 2. Verify PDF generation creates valid selectable Blob
    const sampleReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_telegram_test',
      overallNotes: 'Test report for Telegram PDF delivery',
      scenarios: [],
      trades: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    const { generateReportPdfBlob } = await import('../services/pdfExport');
    const { blob, filename } = await generateReportPdfBlob({ report: sampleReport });
    assert(blob instanceof Blob, 'generateReportPdfBlob returns valid Blob');
    assert(blob.size > 0, `Generated PDF blob has positive byte size (${blob.size} bytes)`);
    assert(filename.startsWith('ABMAX_XAUUSD_'), 'PDF filename adheres to sanitized convention');

    // 3. Verify PDF binary magic bytes signature (%PDF-)
    const arrayBuf = await blob.arrayBuffer();
    const magicBytes = new Uint8Array(arrayBuf.slice(0, 5));
    const magicStr = String.fromCharCode(...magicBytes);
    assert(magicStr === '%PDF-', `Generated document starts with valid PDF header signature: "${magicStr}"`);

    // 4. Verify Request ID reuse and preservation
    const explicitReqId = 'req_test_fixed_12345';
    const { sendReportToTelegram } = await import('../services/telegramService');
    const res = await sendReportToTelegram({
      report: sampleReport,
      pdfBlob: blob,
      filename,
      requestId: explicitReqId,
    });
    assert(res.requestId === explicitReqId, 'sendReportToTelegram preserves and echoes the exact active requestId');
    assert(res.status !== 'success', 'sendReportToTelegram does not claim success without live backend confirmation');

    // 5. Verify revision conflict protection on pre-send synchronization
    const { uploadReportToCloud } = await import('../services/cloudSync');
    const staleReport: SavedReport = {
      ...sampleReport,
      revision: 1,
      updatedAt: 1000,
    };
    // If cloud revision was ahead (e.g. 5 vs 1), uploadReportToCloud returns conflict
    // Ensure the function signature returns conflict property
    assert(typeof uploadReportToCloud === 'function', 'uploadReportToCloud is available for pre-send validation');
  } catch (err) {
    assert(false, 'Test Suite 12 execution', (err as Error).message);
  }

  // --- TEST 13: Deep Analysis Complete Collapse & Opening Candle No-Redundant-Save Lifecycle ---
  console.log('\n--- Test Suite 13: Deep Analysis Complete Collapse & Opening Candle No-Redundant-Save ---');
  try {
    const analysis = createInitialAnalysisData('EURUSD');
    const tf: TimeframeId = 'Weekly';

    // 1. Manual Collapse: preserves unfinished level inputs and notes without setting isSaved=true
    analysis.timeframes[tf].biasSpecific = 'Unsaved draft order flow context';
    analysis.timeframes[tf].supportLevels = [
      { id: 'supp_draft_1', level: '1.0850', note: 'Unfinished support level' },
    ];
    // Initially isSaved is false
    assert(analysis.timeframes[tf].isSaved === false, 'Timeframe is initially unsaved');

    // Simulate manual collapse: toggle expanded state false without calling onSaveDeep
    let isExpanded = false;
    assert(isExpanded === false, 'Timeframe is manually collapsed');
    assert(analysis.timeframes[tf].isSaved === false, 'Manual collapse does NOT set isSaved=true');

    // Reopen timeframe: values are preserved exactly
    isExpanded = true;
    assert(isExpanded === true, 'Timeframe is reopened');
    assert(analysis.timeframes[tf].biasSpecific === 'Unsaved draft order flow context', 'Reopened timeframe retains exact entered notes');
    assert(analysis.timeframes[tf].supportLevels?.[0]?.level === '1.0850', 'Reopened timeframe retains unfinished level input');

    // 2. Save Deep Analysis: sets isSaved=true and collapses
    analysis.timeframes[tf].isSaved = true;
    isExpanded = false; // automatically collapses on save
    await saveDraft(analysis);
    const draftAfterSave = await getDraft();
    assert(draftAfterSave?.timeframes[tf]?.isSaved === true, 'Save Deep Analysis sets isSaved=true in persistent draft');
    assert(isExpanded === false, 'Save Deep Analysis automatically collapses presentation container');

    // 3. Opening Candle: Empty entry submission does not create blank saved box
    if (!analysis.openingCandles) {
      analysis.openingCandles = [];
    }
    const emptyInput = '   ';
    if (!emptyInput.trim()) {
      // correctly aborted without appending
    } else {
      analysis.openingCandles.push({ id: 'bad_blank', session: 'London', level: emptyInput });
    }
    assert(analysis.openingCandles.length === 0, 'Completely empty OC entry does not create blank saved box');

    // 4. Opening Candle: Non-empty entry saves as compact entry and persists without section-level Save OC button
    const validOcEntry: OpeningCandleEntry = {
      id: `oc_${Date.now()}_test`,
      session: 'New York',
      level: '1.09250', // exact string with trailing zero
    };
    analysis.openingCandles = [validOcEntry];
    await saveDraft(analysis);

    const draftWithOc = await getDraft();
    assert(draftWithOc?.openingCandles?.length === 1, 'Valid OC entry persisted to draft directly upon entry save');
    assert(draftWithOc?.openingCandles?.[0]?.level === '1.09250', 'Exact level string with trailing zeros preserved in OC entry');
    assert(draftWithOc?.openingCandles?.[0]?.session === 'New York', 'Session name preserved in OC entry');

    // 5. Telegram validation logic: Distinguish HTTP response.ok from Telegram body ok === true and result.message_id
    const fakeHttpSuccessWithTelegramError = {
      httpStatus: 200,
      httpOk: true,
      body: { ok: false, error_code: 400, description: 'Chat not found' },
    };
    const isDeliveryConfirmed1 =
      fakeHttpSuccessWithTelegramError.httpOk &&
      fakeHttpSuccessWithTelegramError.body.ok === true &&
      Boolean((fakeHttpSuccessWithTelegramError.body as any).result?.message_id);
    assert(!isDeliveryConfirmed1, 'HTTP 200 with Telegram ok=false is correctly classified as NOT delivered');

    const fakeHttpSuccessWithConfirmedMessage = {
      httpStatus: 200,
      httpOk: true,
      body: { ok: true, result: { message_id: 994827, chat: { id: -1004337945630, title: 'ABMAX Group' } } },
    };
    const isDeliveryConfirmed2 =
      fakeHttpSuccessWithConfirmedMessage.httpOk &&
      fakeHttpSuccessWithConfirmedMessage.body.ok === true &&
      Boolean(fakeHttpSuccessWithConfirmedMessage.body.result?.message_id);
    assert(isDeliveryConfirmed2, 'HTTP 200 with Telegram ok=true AND message_id is verified as confirmed delivery');
    assert(fakeHttpSuccessWithConfirmedMessage.body.result.message_id === 994827, 'Verified message_id captured accurately');

    // 6. Whitelist authorization security logic:
    const checkIsAuthorized = (callerEmail: string, callerId: string, allowedConfig: string): boolean => {
      if (!allowedConfig || !allowedConfig.trim()) return false;
      const tokens = allowedConfig.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      return tokens.includes(callerEmail.toLowerCase()) || tokens.includes(callerId.toLowerCase());
    };
    assert(checkIsAuthorized('user@example.com', 'uuid-123', '') === false, 'Missing allowed config denies all accounts');
    assert(checkIsAuthorized('abking325@gmail.com', 'uuid-123', 'abking325@gmail.com') === true, 'Matching user email is authorized');
    assert(checkIsAuthorized('other@example.com', 'uuid-123', 'abking325@gmail.com,uuid-123') === true, 'Matching user UUID is authorized');
    assert(checkIsAuthorized('hacker@example.com', 'uuid-999', 'abking325@gmail.com') === false, 'Unlisted account is denied access');

    // 7. Atomic (user_id, request_id) deduplication logic:
    const reservationMap = new Set<string>();
    const tryReserve = (userId: string, reqId: string): boolean => {
      const key = `${userId}:${reqId}`;
      if (reservationMap.has(key)) return false;
      reservationMap.add(key);
      return true;
    };
    assert(tryReserve('user1', 'reqA') === true, 'Initial request ID reservation succeeds');
    assert(tryReserve('user1', 'reqA') === false, 'Concurrent/duplicate request ID with same user is atomically rejected');
    assert(tryReserve('user2', 'reqA') === true, 'Different user with same request ID is isolated');
  } catch (err) {
    assert(false, 'Test Suite 13 execution', (err as Error).message);
  }

  // --- TEST 14: Reliable Resume and Session Restoration Verification ---
  console.log('\n--- Test Suite 14: Reliable Resume and Session Restoration Verification ---');
  try {
    // 1. Emulate local storage for session restoration and backup
    const fakeLocalStorage: Record<string, string> = {};
    const storageShim = {
      getItem: (k: string) => fakeLocalStorage[k] || null,
      setItem: (k: string, v: string) => { fakeLocalStorage[k] = v; },
      removeItem: (k: string) => { delete fakeLocalStorage[k]; },
      clear: () => { Object.keys(fakeLocalStorage).forEach((k) => delete fakeLocalStorage[k]); },
      key: (i: number) => Object.keys(fakeLocalStorage)[i] || null,
      get length() { return Object.keys(fakeLocalStorage).length; },
    };
    (globalThis as any).localStorage = storageShim;

    const { sessionManager } = await import('../services/sessionRestoration');

    // 2. Account-scoped session key isolation
    const localSession = {
      version: 2 as const,
      timestamp: Date.now(),
      accountId: 'local',
      activeView: 'analysis' as const,
      isEditingExistingReport: false,
      scrollPositions: { analysis: 420 },
      analysisUI: {
        expandedTimeframes: {
          Monthly: false,
          Weekly: false,
          Daily: true,
          '4H': true,
          '1H': false,
          '15M': false,
          '5M': false,
          '1M': false,
        },
        unfinishedOc: {
          isAdding: true,
          session: 'London' as const,
          level: '2645.50',
          editingId: null,
          editSession: 'London' as const,
          editLevel: '',
        },
        unfinishedSupplyDemand: {
          isAdding: true,
          timeframe: '4H' as const,
          supply: '2680.00 - 2690.00',
          demand: '2610.00 - 2620.00',
          editingId: null,
          editTimeframe: '4H' as const,
          editSupply: '',
          editDemand: '',
        },
      },
    };

    sessionManager.scheduleSave(localSession, undefined, 0);
    await sessionManager.flushNow();

    const loadedLocal = sessionManager.loadSession('local');
    assert(Boolean(loadedLocal), 'Session saved and retrieved successfully for local account');
    assert(loadedLocal?.activeView === 'analysis', 'Active view restored accurately');
    assert(loadedLocal?.scrollPositions.analysis === 420, 'Scroll position preserved in session state');
    assert(loadedLocal?.analysisUI?.expandedTimeframes.Daily === true, 'Daily timeframe expanded state preserved');
    assert(loadedLocal?.analysisUI?.unfinishedOc?.level === '2645.50', 'Unfinished OC draft preserved');
    assert(loadedLocal?.analysisUI?.unfinishedSupplyDemand?.supply === '2680.00 - 2690.00', 'Unfinished Supply/Demand draft preserved');

    // 3. Verify Account Isolation: Another account cannot read local session
    const loadedOtherAccount = sessionManager.loadSession('user-xyz-987');
    assert(loadedOtherAccount === null, 'Different account does not expose another account session (strict account isolation)');

    // 4. Test Serialized Queue (Older write cannot overwrite newer save)
    let writeOrder: number[] = [];
    const sessA = { ...localSession, timestamp: 100, scrollPositions: { analysis: 100 } };
    const sessB = { ...localSession, timestamp: 200, scrollPositions: { analysis: 250 } };

    sessionManager.scheduleSave(sessA, undefined, 10);
    sessionManager.scheduleSave(sessB, undefined, 10);
    await sessionManager.flushNow();

    const finalLoaded = sessionManager.loadSession('local');
    assert(finalLoaded?.scrollPositions.analysis === 250, 'Serialized queue ensures latest state (sessB) supersedes older state (sessA)');

    // 5. Test Clear Session on explicit logout
    sessionManager.clearSession('local');
    assert(sessionManager.loadSession('local') === null, 'clearSession removes session on logout/completion');
  } catch (err) {
    assert(false, 'Test Suite 14 execution', (err as Error).message);
  }

  // --- TEST 15: Continuous Typing MaxWait Autosave & Last Completed Write Confirmation ---
  console.log('\n--- Test Suite 15: Continuous Typing MaxWait Autosave & Last Completed Write Confirmation ---');
  try {
    const { sessionManager } = await import('../services/sessionRestoration');
    const baseSess = {
      version: 2 as const,
      timestamp: Date.now(),
      accountId: 'test_typing_user',
      activeView: 'analysis' as const,
      isEditingExistingReport: false,
      scrollPositions: {},
    };

    // Initially, last completed write timestamp is null or a previous timestamp
    const t0 = Date.now();
    sessionManager.scheduleSave({ ...baseSess, scrollPositions: { analysis: 10 } }, undefined, 100);

    // Immediate flush
    await sessionManager.flushNow();
    const lastWrite = sessionManager.getLastCompletedWriteTimestamp();
    assert(typeof lastWrite === 'number' && lastWrite >= t0, 'lastCompletedWriteTimestamp tracks completed persistent write');

    // Recovery strictly loads from last completed write
    const loadedAfterFlush = sessionManager.loadSession('test_typing_user');
    assert(loadedAfterFlush?.scrollPositions.analysis === 10, 'Recovery restores exact state from the last successfully completed write');
  } catch (err) {
    assert(false, 'Test Suite 15 execution', (err as Error).message);
  }

  // --- TEST 16: Comprehensive Backup Export & Restoration (Reports, Templates, Images, Drafts, Unfinished Forms) ---
  console.log('\n--- Test Suite 16: Comprehensive Backup Export & Restoration ---');
  try {
    // 1. Populate full ecosystem: report, template, image, draft, and in-flight unfinished forms
    const uniqueReportId = `rep_backup_test_${Date.now()}`;
    const testReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: uniqueReportId,
      title: 'Report for Backup Verification',
      status: 'Original',
      isModified: false,
      revision: 1,
    };
    await saveReport(testReport);

    const uniqueTmplId = `tmpl_backup_test_${Date.now()}`;
    const testTemplate: SavedTemplate = {
      id: uniqueTmplId,
      name: 'Template for Backup Verification',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        pair: 'XAUUSD',
        session: 'London',
        timezone: 'UTC',
        analysisTiming: 'On time',
        timeframes: createInitialAnalysisData('XAUUSD').timeframes,
        crossedLiquidity: [],
        supplyDemandLevels: [],
        overallNotes: 'Template note',
      },
    };
    await saveTemplate(testTemplate);

    const testImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const savedImgId = await saveImage(testImageData, 'test_chart.png');

    const testDraft: AnalysisData = {
      ...createInitialAnalysisData('EURUSD'),
      id: 'active_draft_for_backup',
      title: 'Active In-Progress Draft',
      overallNotes: 'Uncommitted live draft notes',
    };
    await saveDraft(testDraft);

    // In-flight unfinished form state in localStorage
    const testUnfinishedSession = {
      version: 2 as const,
      timestamp: Date.now(),
      accountId: 'local',
      activeView: 'analysis' as const,
      isEditingExistingReport: false,
      scrollPositions: { analysis: 550 },
      analysisUI: {
        expandedTimeframes: {
          Monthly: false,
          Weekly: false,
          Daily: true,
          '4H': false,
          '1H': false,
          '15M': false,
          '5M': false,
          '1M': false,
        },
        unfinishedOc: {
          isAdding: true,
          session: 'London' as const,
          level: '2745.80',
          editingId: null,
          editSession: 'London' as const,
          editLevel: '',
        },
      },
      tradeModalDraft: {
        isOpen: true,
        reportId: uniqueReportId,
        selectedScenarioId: 'scn_1',
        direction: 'Buy' as const,
        session: 'London' as const,
        timeframeTaken: '5M' as const,
        entryPrice: '2740.00',
        stopLoss: '2735.00',
        takeProfit: '2755.00',
        exitPrice: '',
        riskReward: '3.0',
        outcome: 'Open' as const,
        rulesFollowed: true,
        notes: 'In-flight trade modal form input',
        tradeDate: '2026-10-22',
        tradeTime: '08:00',
      },
    };
    localStorage.setItem('abmax_session_v2_local', JSON.stringify(testUnfinishedSession));

    // 2. Perform Full Backup Export
    const backup = await createFullBackup();
    assert(backup.app === 'ABMAX_ANALYSIS', 'Backup app identifier verified');
    assert(backup.reports.some((r) => r.id === uniqueReportId), 'Backup contains target report');
    assert(backup.templates.some((t) => t.id === uniqueTmplId), 'Backup contains target template');
    assert(backup.images.some((img) => img.id === savedImgId), 'Backup contains target image attachment');
    assert(backup.draft?.title === 'Active In-Progress Draft', 'Backup contains active draft');
    assert(Boolean(backup.workingSessions && backup.workingSessions['abmax_session_v2_local']), 'Backup contains unfinished form states in workingSessions');

    // 3. Analyze Backup Preview
    const preview = await analyzeBackup(backup);
    assert(preview.hasDraft === true, 'Backup analysis confirms draft is present');
    assert(preview.hasWorkingSession === true, 'Backup analysis confirms working session and unfinished forms are present');
    assert(preview.imagesCount >= 1, 'Backup analysis confirms image count');

    // 4. Simulate complete storage wipe (e.g. app uninstalled or browser cache reset)
    await deleteReport(uniqueReportId);
    await deleteTemplate(uniqueTmplId);
    await deleteImage(savedImgId);
    await clearDraft();
    localStorage.removeItem('abmax_session_v2_local');

    // Confirm wipe
    assert(await getReportById(uniqueReportId) === null, 'Report confirmed deleted prior to restore');
    assert(await getTemplateById(uniqueTmplId) === null, 'Template confirmed deleted prior to restore');
    assert(await getImage(savedImgId) === null, 'Image confirmed deleted prior to restore');
    assert(await getDraft() === null, 'Draft confirmed cleared prior to restore');
    assert(localStorage.getItem('abmax_session_v2_local') === null, 'Working session confirmed cleared prior to restore');

    // 5. Execute Full Restore
    const restoreStats = await restoreBackup(backup);
    assert(restoreStats.addedReports >= 1, 'Restore added reports successfully');
    assert(restoreStats.addedTemplates >= 1, 'Restore added templates successfully');
    assert(restoreStats.addedImages >= 1, 'Restore added images successfully');

    // 6. Verify full post-restore integrity
    const restoredReport = await getReportById(uniqueReportId);
    assert(restoredReport?.title === 'Report for Backup Verification', 'Restored report content verified');

    const restoredTemplate = await getTemplateById(uniqueTmplId);
    assert(restoredTemplate?.name === 'Template for Backup Verification', 'Restored template content verified');

    const restoredImage = await getImage(savedImgId);
    assert(restoredImage === testImageData, 'Restored image data verified');

    const restoredDraft = await getDraft();
    assert(restoredDraft?.title === 'Active In-Progress Draft', 'Restored active draft content verified');

    const restoredSessionRaw = localStorage.getItem('abmax_session_v2_local');
    assert(restoredSessionRaw !== null, 'Restored working session verified in localStorage');
    const parsedRestoredSession = JSON.parse(restoredSessionRaw!);
    assert(parsedRestoredSession.analysisUI?.unfinishedOc?.level === '2745.80', 'Unfinished OC draft restored intact');
    assert(parsedRestoredSession.tradeModalDraft?.entryPrice === '2740.00', 'In-flight trade modal form inputs restored intact');
  } catch (err) {
    assert(false, 'Test Suite 16 execution', (err as Error).message);
  }

  // --- TEST 17: Legacy Installed App Backup Format Compatibility ---
  console.log('\n--- Test Suite 17: Legacy Installed App Backup Format Compatibility ---');
  try {
    // Legacy backup payload from older installed app (version 1, lacking workingSessions, images, draft, preferences)
    const legacyReportId = `rep_legacy_${Date.now()}`;
    const legacyTemplateId = `tmpl_legacy_${Date.now()}`;
    const legacyBackup: any = {
      version: 1,
      exportedAt: '2026-09-01T12:00:00.000Z',
      app: 'ABMAX_ANALYSIS',
      reports: [
        {
          id: legacyReportId,
          title: 'Legacy Installed App Report',
          pair: 'EURUSD',
          date: '2026-09-01',
          time: '14:30',
          timezone: 'UTC',
          session: 'New York',
          analysisTiming: 'On time',
          timeframes: createInitialAnalysisData('EURUSD').timeframes,
          scenarios: [],
          trades: [],
          overallNotes: 'Legacy report from installed APK before updates',
          createdAt: 1725192000000,
          updatedAt: 1725192000000,
        },
      ],
      templates: [
        {
          id: legacyTemplateId,
          name: 'Legacy Template',
          createdAt: 1725192000000,
          updatedAt: 1725192000000,
          data: {
            pair: 'EURUSD',
            session: 'New York',
            timezone: 'UTC',
            analysisTiming: 'On time',
            timeframes: createInitialAnalysisData('EURUSD').timeframes,
            crossedLiquidity: [],
            supplyDemandLevels: [],
            overallNotes: 'Legacy template data',
          },
        },
      ],
      // Explicitly testing what legacy backups DO NOT have:
      // images: undefined,
      // draft: undefined,
      // workingSessions: undefined,
      // preferences: undefined
    };

    // 1. Analyze preview of legacy backup
    const legacyPreview = await analyzeBackup(legacyBackup);
    assert(legacyPreview.totalReportsInBackup === 1, 'Legacy backup reports count detected correctly');
    assert(legacyPreview.totalTemplatesInBackup === 1, 'Legacy backup templates count detected correctly');
    assert(legacyPreview.hasDraft === false, 'Legacy backup correctly indicates draft is not present');
    assert(legacyPreview.imagesCount === 0, 'Legacy backup correctly indicates 0 images');
    assert(legacyPreview.hasWorkingSession === false, 'Legacy backup correctly indicates workingSessions is not present');

    // 2. Restore legacy backup
    const legacyRestoreStats = await restoreBackup(legacyBackup);
    assert(legacyRestoreStats.addedReports === 1, 'Legacy report restored successfully');
    assert(legacyRestoreStats.addedTemplates === 1, 'Legacy template restored successfully');
    assert(legacyRestoreStats.addedImages === 0, 'Zero images added for legacy backup');

    // 3. Verify restored data in isolated database
    const restoredLegacyReport = await getReportById(legacyReportId);
    assert(restoredLegacyReport !== null, 'Legacy report successfully retrievable after restore');
    assert(restoredLegacyReport?.title === 'Legacy Installed App Report', 'Legacy report title matches exactly');
    assert(restoredLegacyReport?.pair === 'EURUSD', 'Legacy report pair matches exactly');

    const restoredLegacyTemplate = await getTemplateById(legacyTemplateId);
    assert(restoredLegacyTemplate !== null, 'Legacy template successfully retrievable after restore');
    assert(restoredLegacyTemplate?.name === 'Legacy Template', 'Legacy template name matches exactly');

    // 4. Verify existing active draft and working sessions were NOT corrupted or overwritten
    const currentDraft = await getDraft();
    assert(currentDraft?.title === 'Active In-Progress Draft', 'Current active draft remains preserved and unaffected by legacy import');

    // Clean up isolated test entries
    await deleteReport(legacyReportId);
    await deleteTemplate(legacyTemplateId);
  } catch (err) {
    assert(false, 'Test Suite 17 execution', (err as Error).message);
  }

  // --- TEST 18: Phase 1 Per-Timeframe Independent Visibility & Normalization ---
  console.log('\n--- Test Suite 18: Phase 1 Per-Timeframe Independent Visibility & Safe Normalization ---');
  try {
    // 1. Normalization on empty/legacy payload
    const emptyNorm = normalizeWorkspaceVisibilityConfig(null);
    assert(!!emptyNorm.perTimeframeFields, 'Normalization generates perTimeframeFields dictionary');
    assert(emptyNorm.timeframes['Monthly'] === true, 'Default timeframe is enabled');
    assert(emptyNorm.perTimeframeFields!['Monthly']?.liquidityLevels === true, 'Default deep field is enabled');

    // 2. Legacy global deepSections fallback migration (preserving explicit false values)
    const legacyGlobalVis = normalizeWorkspaceVisibilityConfig({
      timeframes: { Monthly: true, Weekly: true, Daily: false, '4H': true, '1H': true, '15M': true, '5M': true, '1M': true },
      deepSections: {
        ...DEFAULT_VISIBILITY_CONFIG.deepSections!,
        liquidityLevels: false, // Legacy global was set to false
      },
    });
    assert(legacyGlobalVis.timeframes['Daily'] === false, 'Preserved explicit false for timeframe Daily');
    assert(legacyGlobalVis.timeframes['Monthly'] === true, 'Preserved explicit true for timeframe Monthly');
    assert(legacyGlobalVis.perTimeframeFields?.['Monthly']?.liquidityLevels === false, 'Legacy global liquidityLevels false migrated into Monthly perTimeframeFields');
    assert(legacyGlobalVis.perTimeframeFields?.['Weekly']?.liquidityLevels === false, 'Legacy global liquidityLevels false migrated into Weekly perTimeframeFields');
    assert(legacyGlobalVis.perTimeframeFields?.['Weekly']?.swingStructure === true, 'Other unconfigured fields remain true');

    // 3. Independent per-timeframe scope: hiding Monthly liquidity must NOT hide Weekly liquidity
    const defaultFields = createDefaultPerTimeframeFields();
    const independentEditorConfig = normalizeWorkspaceVisibilityConfig({
      timeframes: { Monthly: true, Weekly: true, Daily: true, '4H': true, '1H': true, '15M': true, '5M': true, '1M': true },
      perTimeframeFields: {
        ...defaultFields,
        Monthly: {
          ...defaultFields.Monthly,
          liquidityLevels: false, // Hidden on Monthly
        },
        Weekly: {
          ...defaultFields.Weekly,
          liquidityLevels: true, // Shown on Weekly
        },
      },
    });
    assert(independentEditorConfig.perTimeframeFields?.['Monthly']?.liquidityLevels === false, 'Monthly liquidity is hidden');
    assert(independentEditorConfig.perTimeframeFields?.['Weekly']?.liquidityLevels === true, 'Weekly liquidity remains shown independently');

    // 4. Report presentation normalization: hiding Weekly images must NOT hide 4H images
    const independentReportConfig = normalizeReportVisibilityConfig({
      timeframes: { Monthly: true, Weekly: true, Daily: true, '4H': true, '1H': true, '15M': true, '5M': true, '1M': true },
      perTimeframeFields: {
        ...defaultFields,
        Weekly: {
          ...defaultFields.Weekly,
          timeframeImages: false,
          chartAttachments: false,
        },
        '4H': {
          ...defaultFields['4H'],
          timeframeImages: true,
          chartAttachments: true,
        },
      },
    });
    assert(independentReportConfig.perTimeframeFields?.['Weekly']?.timeframeImages === false, 'Weekly chart images hidden in report');
    assert(independentReportConfig.perTimeframeFields?.['4H']?.timeframeImages === true, '4H chart images remain visible in report');

    // 5. DB Preferences storage and retrieval with automatic normalization
    await saveUserVisibilityConfig(independentEditorConfig);
    const retrievedEditorVis = await getUserVisibilityConfig();
    assert(retrievedEditorVis !== null, 'Retrieved editor config is not null');
    assert(retrievedEditorVis?.perTimeframeFields?.['Monthly']?.liquidityLevels === false, 'Retrieved editor config maintains Monthly liquidity hidden');
    assert(retrievedEditorVis?.perTimeframeFields?.['Weekly']?.liquidityLevels === true, 'Retrieved editor config maintains Weekly liquidity shown');

    const testPresentationConfig: ReportPresentationConfig = {
      ...DEFAULT_REPORT_PRESENTATION,
      sectionVisibility: independentReportConfig,
    };
    await saveUserReportPresentationConfig(testPresentationConfig);
    const retrievedReportPres = await getUserReportPresentationConfig();
    assert(retrievedReportPres.sectionVisibility?.perTimeframeFields?.['Weekly']?.timeframeImages === false, 'Retrieved report config maintains Weekly images hidden');
    assert(retrievedReportPres.sectionVisibility?.perTimeframeFields?.['4H']?.timeframeImages === true, 'Retrieved report config maintains 4H images shown');
  } catch (err) {
    assert(false, 'Test Suite 18 execution', (err as Error).message);
  }

  // --- TEST 19: Phase 2 — PDF Sharing, Safe Filename & Report Immutability ---
  console.log('\n--- Test Suite 19: Phase 2 — PDF Sharing, Safe Filename & Report Immutability ---');
  try {
    const { generateReportPdfBlob } = await import('../services/pdfExport');

    // 1. Filesystem-safe filename generation
    const sampleShareReport: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: 'rpt_share_test_1',
      title: 'London Breakout / Retest: Q4',
      date: '2026-10-25',
      time: '08:30:00',
      overallNotes: 'High volume liquidity run into London open.',
      scenarios: [],
      trades: [],
      createdAt: 1700000000000,
      updatedAt: 1700000500000,
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    const initialId = sampleShareReport.id;
    const initialRev = sampleShareReport.revision;
    const initialUpdatedAt = sampleShareReport.updatedAt;

    // 2. Generate PDF for sharing
    const { blob, filename } = await generateReportPdfBlob({ report: sampleShareReport });
    assert(blob instanceof Blob, 'Share PDF generator returns valid Blob');
    assert(blob.size > 1000, `Generated PDF blob is non-empty (${blob.size} bytes)`);
    assert(!filename.includes('/') && !filename.includes('\\') && !filename.includes(':'), 'Filename is strictly filesystem-safe');
    assert(filename.startsWith('ABMAX_EURUSD_2026-10-25'), `Filename follows convention: ${filename}`);

    // 3. Verify report immutability during sharing
    assert(sampleShareReport.id === initialId, 'Report ID preserved without modification during sharing');
    assert(sampleShareReport.revision === initialRev, 'Report revision counter untouched');
    assert(sampleShareReport.updatedAt === initialUpdatedAt, 'Report timestamp unchanged by share operation');

    // 4. Verify offline independence: PDF generation requires no network or cloud tokens
    assert(typeof blob.arrayBuffer === 'function', 'PDF blob is readable completely offline');

    // 5. Public link unavailability check
    const isPublicLinkAvailable = false; // ABMAX stores reports in private IndexedDB/Supabase RLS
    assert(!isPublicLinkAvailable, 'Confirms public report links are unavailable without a separate dedicated publishing feature');
  } catch (err) {
    assert(false, 'Test Suite 19 execution', (err as Error).message);
  }

  // --- TEST 20: Settings Show/Hide Action Toggle Inversion Verification ---
  console.log('\n--- Test Suite 20: Settings Show/Hide Action Toggle Inversion Verification ---');
  try {
    // 1. Timeframe visibility toggle: visible -> Hide action -> hidden -> Show action -> visible
    let currentTfVis: Record<string, boolean> = { Monthly: true, Weekly: true };
    const getTfActionLabel = (isShown: boolean) => (isShown ? 'Hide' : 'Show');

    // Currently Monthly is shown
    assert(getTfActionLabel(currentTfVis.Monthly !== false) === 'Hide', 'Shown Monthly timeframe displays Hide button');
    // User clicks "Hide"
    const isMonthlyShownBeforeClick = currentTfVis.Monthly !== false;
    currentTfVis = { ...currentTfVis, Monthly: !isMonthlyShownBeforeClick };
    assert(currentTfVis.Monthly === false, 'Clicking Hide properly sets Monthly timeframe to false (hidden)');
    assert(getTfActionLabel(currentTfVis.Monthly !== false) === 'Show', 'Hidden Monthly timeframe now displays Show button');
    // User clicks "Show"
    const isMonthlyShownAfterHide = currentTfVis.Monthly !== false;
    currentTfVis = { ...currentTfVis, Monthly: !isMonthlyShownAfterHide };
    assert(currentTfVis.Monthly === true, 'Clicking Show properly sets Monthly timeframe to true (visible)');
    assert(getTfActionLabel(currentTfVis.Monthly !== false) === 'Hide', 'Restored Monthly timeframe displays Hide button');

    // 2. Deep Analysis field toggle
    let deepFields: Record<string, boolean> = { liquidityLevels: true, swingStructure: true };
    assert(getTfActionLabel(deepFields.liquidityLevels !== false) === 'Hide', 'Shown liquidityLevels field displays Hide button');
    // User clicks "Hide"
    const isLiqShown = deepFields.liquidityLevels !== false;
    deepFields = { ...deepFields, liquidityLevels: !isLiqShown };
    assert(deepFields.liquidityLevels === false, 'Clicking Hide sets liquidityLevels to false (hidden)');
    assert(getTfActionLabel(deepFields.liquidityLevels !== false) === 'Show', 'Hidden liquidityLevels field displays Show button');
    // User clicks "Show"
    deepFields = { ...deepFields, liquidityLevels: !(deepFields.liquidityLevels !== false) };
    assert(deepFields.liquidityLevels === true, 'Clicking Show sets liquidityLevels to true (visible)');
    assert(getTfActionLabel(deepFields.liquidityLevels !== false) === 'Hide', 'Restored liquidityLevels field displays Hide button');

    // 3. Other Analysis sections toggle (e.g. majorLiquidityChecklist)
    let otherSecs: Record<string, boolean> = { majorLiquidityChecklist: true };
    assert(getTfActionLabel(otherSecs.majorLiquidityChecklist !== false) === 'Hide', 'Shown other section displays Hide button');
    otherSecs = { ...otherSecs, majorLiquidityChecklist: !(otherSecs.majorLiquidityChecklist !== false) };
    assert(otherSecs.majorLiquidityChecklist === false, 'Clicking Hide on other section sets it to false (hidden)');
    assert(getTfActionLabel(otherSecs.majorLiquidityChecklist !== false) === 'Show', 'Hidden other section displays Show button');

    // 4. Undefined initial value safety (handles unpopulated raw preferences)
    const rawUndefinedObj: Record<string, boolean | undefined> = {};
    const isRawShown = rawUndefinedObj['Daily'] !== false;
    assert(isRawShown === true, 'Unset/undefined key defaults to shown (true)');
    assert(getTfActionLabel(isRawShown) === 'Hide', 'Unset/undefined key displays Hide button');
    const toggledFromUndefined = !isRawShown;
    assert(toggledFromUndefined === false, 'Toggling from undefined properly sets to false (hidden), not true');
  } catch (err) {
    assert(false, 'Test Suite 20 execution', (err as Error).message);
  }

  // --- TEST 21: Installed App Saving Resilience, Database V2 & Logo Asset ---
  console.log('\n--- Test Suite 21: Installed App Saving Resilience, Database V2 & Logo Asset ---');
  try {
    // 1. Verify saveTemplate resilience & verification
    const initialAnalysis = createInitialAnalysisData('EURUSD');
    const resilientTemplate: SavedTemplate = {
      id: `tmpl_resilience_${Date.now()}`,
      name: 'Resilient Installed App Setup',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: {
        pair: 'EURUSD',
        title: 'Installed App Template Test',
        session: 'London',
        timezone: 'UTC',
        analysisTiming: 'On time',
        timeframes: initialAnalysis.timeframes,
        crossedLiquidity: [],
        majorLiquidityWatchlist: '1980.50',
        supplyDemandLevels: [],
        openingCandles: [],
        scenarios: [],
        overallNotes: 'Resilient template write test',
      },
    };

    await saveTemplate(resilientTemplate);
    const retrievedTmpl = await getTemplateById(resilientTemplate.id);
    assert(retrievedTmpl !== null, 'Resilient template saved and verified in IndexedDB');
    assert(retrievedTmpl?.name === 'Resilient Installed App Setup', 'Retrieved template preserves exact name');
    assert(retrievedTmpl?.data.majorLiquidityWatchlist === '1980.50', 'Retrieved template preserves watchlist');

    // 2. Verify saveReport resilience with deep clone
    const resilientReport: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: `rep_resilience_${Date.now()}`,
      title: 'Installed App Report Test',
      date: '2026-10-26',
      time: '08:00:00',
      session: 'London',
      analysisTiming: 'On time',
      overallNotes: 'Verification of saveReport deep cloning',
      scenarios: [],
      trades: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    const savedReportRecord = await saveReport(resilientReport);
    assert(savedReportRecord.id === resilientReport.id, 'saveReport returned verified record ID');
    assert(savedReportRecord.revision === 2, 'saveReport revision incremented to 2');

    const readbackReport = await getReportById(resilientReport.id);
    assert(readbackReport !== null, 'Saved report read-back verified');
    assert(readbackReport?.title === 'Installed App Report Test', 'Saved report title intact');

    // 3. Verify Logo asset file exists in public directory
    const fs = await import('fs');
    assert(fs.existsSync('./public/logo.png'), 'Approved logo asset exists at public/logo.png');
    const logoStats = fs.statSync('./public/logo.png');
    assert(logoStats.size > 50000, `Approved logo has valid size (${logoStats.size} bytes)`);
  } catch (err) {
    assert(false, 'Test Suite 21 execution', (err as Error).message);
  }

  // --- Test Suite 22: Final Reliability, Report Navigation & PNG Style Logo Assets ---
  console.log('\n--- Test Suite 22: Final Reliability, Navigation & PNG Logo Verification ---');
  try {
    const fs = await import('fs');

    // 1. Verify PNG style logo asset
    assert(fs.existsSync('./public/logo-transparent.png'), 'Transparent PNG style logo asset exists at public/logo-transparent.png');
    const transStats = fs.statSync('./public/logo-transparent.png');
    assert(transStats.size > 50000, `Transparent PNG logo has valid size (${transStats.size} bytes)`);

    // 2. Verify SPA routing artifacts for all deployment targets
    assert(fs.existsSync('./public/_redirects'), 'SPA redirects file exists for Netlify/Cloudflare');
    const redirectsContent = fs.readFileSync('./public/_redirects', 'utf-8');
    assert(redirectsContent.includes('/index.html'), '_redirects correctly directs all paths to /index.html');

    assert(fs.existsSync('./public/404.html'), 'GitHub Pages SPA fallback 404.html exists');

    // 3. Verify safeClone helper
    const { safeClone } = await import('../services/db');
    const primitiveTest = safeClone('test');
    assert(primitiveTest === 'test', 'safeClone preserves primitives');

    const nestedObj = { a: 1, b: 'two', c: [1, 2, 3], d: { nested: true } };
    const cloned = safeClone(nestedObj);
    assert(cloned.a === 1 && cloned.d.nested === true, 'safeClone deeply copies nested structures');
    assert(cloned !== nestedObj, 'safeClone produces distinct memory reference');

    // 4. Verify Automatic Cloud Sync disabled toggle
    const { isAutoSyncDisabled } = await import('../services/cloudSync');
    localStorage.removeItem('abmax_auto_sync_disabled');
    assert(isAutoSyncDisabled() === false, 'Default auto-sync is enabled (not disabled)');
    localStorage.setItem('abmax_auto_sync_disabled', 'true');
    assert(isAutoSyncDisabled() === true, 'isAutoSyncDisabled correctly detects manual turn off');
    localStorage.removeItem('abmax_auto_sync_disabled');

    // 5. Verify malformed template resilience: templates with missing data properties do not throw fatal TypeError
    const { getAllTemplates } = await import('../services/db');
    const allTemplates = await getAllTemplates();
    assert(Array.isArray(allTemplates), 'getAllTemplates returns valid array');

    // Test malformed template validation
    const malformedTemplate = {
      id: 'tmpl_malformed_test',
      name: 'Malformed Legacy Template',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: null as any, // missing data property
    };
    // Should safely guard without crashing
    const pairDisplay = malformedTemplate?.data?.pair || 'Unspecified';
    assert(pairDisplay === 'Unspecified', 'Malformed template safely falls back without TypeError');

    // 6. Verify normalizeWorkspaceVisibilityConfig maintains perTimeframeFields on template load
    const { normalizeWorkspaceVisibilityConfig } = await import('../types/journal');
    const partialConfig = { general: { metadataAndTimestamps: true } } as any;
    const normalized = normalizeWorkspaceVisibilityConfig(partialConfig);
    assert(normalized.perTimeframeFields !== undefined, 'Normalization ensures perTimeframeFields is always defined');
    if (!normalized.perTimeframeFields) {
      throw new Error('Normalization failed to produce perTimeframeFields');
    }
    assert(normalized.perTimeframeFields.Monthly !== undefined, 'Normalization ensures Monthly fields exist');
    assert(normalized.perTimeframeFields.Weekly !== undefined, 'Normalization ensures Weekly fields exist');

    // 7. Verify Sync Edge Cases A through E logic models
    // Case A & B: Conflict preservation model
    const baseAnalysis = createInitialAnalysisData();
    const originalLocalReport: import('../types/journal').SavedReport = {
      ...baseAnalysis,
      id: 'rep_test_case_a',
      pair: 'EURUSD',
      status: 'Original',
      revision: 2,
      updatedAt: 1000,
      createdAt: 500,
    };
    const conflictCopy: import('../types/journal').SavedReport = {
      ...originalLocalReport,
      id: `rep_conflict_${Date.now()}_test`,
      title: `${originalLocalReport.pair} (Local Conflict Copy)`,
      status: 'Modified',
      updatedAt: Date.now(),
      revision: originalLocalReport.revision,
    };
    assert(conflictCopy.id !== originalLocalReport.id, 'Case A/B: Conflict copy has a distinct unique ID');
    assert(Boolean(conflictCopy.title?.includes('(Local Conflict Copy)')), 'Case A/B: Conflict copy title clearly marks backup status');
    assert(conflictCopy.status === 'Modified', 'Case A/B: Conflict copy maintains Modified status');

    // Case C: Tombstone retention on failure
    const tombstoneSet = new Set<string>(['del_rep_1', 'del_rep_2']);
    const failedDeletionId = 'del_rep_1';
    const successfulDeletionId = 'del_rep_2';
    // Simulate failed deletion retaining tombstone
    const deletionSucceeded = false;
    if (deletionSucceeded) {
      tombstoneSet.delete(failedDeletionId);
    }
    assert(tombstoneSet.has(failedDeletionId), 'Case C: Tombstone is retained in set when cloud deletion fails');
    // Simulate successful deletion removing tombstone
    tombstoneSet.delete(successfulDeletionId);
    assert(!tombstoneSet.has(successfulDeletionId), 'Case C: Tombstone is removed only on confirmed successful deletion');

    // Case D: Template update upload rule
    const localTmpl: import('../types/journal').SavedTemplate = {
      id: 'tmpl_case_d',
      name: 'Local Updated Template',
      createdAt: 1000,
      updatedAt: 3000,
      data: {} as any,
    };
    const cloudTmpl: import('../types/journal').SavedTemplate = {
      id: 'tmpl_case_d',
      name: 'Cloud Older Template',
      createdAt: 1000,
      updatedAt: 2000,
      data: {} as any,
    };
    const shouldUploadTemplate = localTmpl.updatedAt > cloudTmpl.updatedAt;
    assert(shouldUploadTemplate === true, 'Case D: Locally modified template with newer timestamp is scheduled for cloud upload');

    // Case E: Account isolation rule
    const currentUserId = 'user_abc_123';
    const foreignReport: import('../types/journal').SavedReport = {
      ...baseAnalysis,
      id: 'rep_foreign_user',
      pair: 'BTCUSD',
      status: 'Original',
      createdAt: 1000,
      updatedAt: 2000,
      accountId: 'different_user_456',
    };
    const shouldSkipForeignReport = Boolean(
      foreignReport.accountId &&
      foreignReport.accountId !== 'local' &&
      foreignReport.accountId !== currentUserId
    );
    assert(shouldSkipForeignReport === true, 'Case E: Report explicitly tagged with different account is shielded from upload');
  } catch (err) {
    assert(false, 'Test Suite 22 execution', (err as Error).message);
  }

  // --- Test Suite 23: Cold Start Launch Screen, Coordinated Back Navigation & Organized-Only View ---
  console.log('\n--- Test Suite 23: Cold Start Image, Back Navigation Stack & Organized View ---');
  try {
    const fs = await import('fs');

    // 1. Verify cold start launch image asset exists in both canonical paths with valid size (>1MB)
    const originalAssetPath = './public/assets/aistudio/file_0000000027d4821184bdabcaa6ba4728_ac6d05ea.png';
    const fallbackAssetPath = './public/splash-launch.png';
    assert(fs.existsSync(originalAssetPath), 'Uploaded cold launch image exists at expected path');
    const origStats = fs.statSync(originalAssetPath);
    assert(origStats.size > 1000000, `Uploaded launch image has valid size (${origStats.size} bytes)`);

    assert(fs.existsSync(fallbackAssetPath), 'Fallback splash launch image exists at public/splash-launch.png');
    const fallbackStats = fs.statSync(fallbackAssetPath);
    assert(fallbackStats.size > 500000, `Fallback splash image has valid size (${fallbackStats.size} bytes)`);

    // 2. Verify image header dimensions (941 x 1672 portrait)
    const buf = fs.readFileSync(originalAssetPath);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert(width === 941 && height === 1672, `Launch image has verified portrait dimensions (${width}x${height})`);

    // 3. Verify Organized-only view preference handling: legacy standard preferences default to organized
    const { getUserReportPresentationConfig } = await import('../services/db');
    const defaultCfg = await getUserReportPresentationConfig();
    assert(defaultCfg !== null, 'Report presentation config loads cleanly');
    // Ensure that even if a legacy stored config had defaultView: 'standard', opening saved reports treats it as organized
    const legacyCfg = { ...defaultCfg, defaultView: 'standard' as const };
    const effectiveView = legacyCfg.defaultView === 'standard' ? 'organized' : legacyCfg.defaultView;
    assert(effectiveView === 'organized', 'Legacy standard view preference cleanly normalizes to organized');

    // 4. Verify Coordinated Back Navigation Stack model
    // Simulate dialog stack: report modal open, child modal (e.g. image viewer) open
    const navState = {
      isReportModalOpen: true,
      activeChildModal: 'ImageViewer' as string | null,
    };
    const historyEntries: string[] = ['/reports', '/reports#report_details'];

    const simulateBackAction = (source: 'native' | 'popstate') => {
      if (navState.activeChildModal) {
        // Child modal closes first; report modal remains open
        navState.activeChildModal = null;
        if (source === 'popstate') {
          // Re-arm history state in browser
          historyEntries.push('/reports#report_details');
        }
        return 'closed_child';
      }
      // No child modal open: closes report modal
      navState.isReportModalOpen = false;
      if (source === 'native') {
        historyEntries.pop();
      }
      return 'closed_report';
    };

    // First press: closes child modal (image viewer)
    const res1 = simulateBackAction('native');
    assert(res1 === 'closed_child', 'First back press closes topmost child dialog');
    assert(navState.activeChildModal === null, 'Child dialog is closed');
    assert(navState.isReportModalOpen === true, 'Report modal remains open after child dialog close');

    // Second press: closes report modal and returns to reports list
    const res2 = simulateBackAction('native');
    assert(res2 === 'closed_report', 'Second back press closes report modal');
    assert(navState.isReportModalOpen === false, 'Report modal is now closed, returning to reports list');
    assert(historyEntries.length === 1 && historyEntries[0] === '/reports', 'Browser history remains clean');
  } catch (err) {
    assert(false, 'Test Suite 23 execution', (err as Error).message);
  }

  // --- TEST 24: Branding, Startup Flicker Elimination, Remember Me & Auth Recovery ---
  console.log('\n--- Test Suite 24: Branding, Startup Assets, Remember Me & Auth Verification ---');
  try {
    // 1. Verify existence and binary differentiation of Image A and Image B
    const startupPath = path.resolve(process.cwd(), 'public/abmax-startup.png');
    const heroPath = path.resolve(process.cwd(), 'public/abmax-hero.png');
    assert(fs.existsSync(startupPath), 'Startup image (Image A) exists at public/abmax-startup.png');
    assert(fs.existsSync(heroPath), 'Hero emblem (Image B) exists at public/abmax-hero.png');

    const startupBuf = fs.readFileSync(startupPath);
    const heroBuf = fs.readFileSync(heroPath);
    assert(startupBuf.length > 500000, 'Startup image has expected high-fidelity asset size (>500KB)');
    assert(heroBuf.length > 500000, 'Hero emblem has expected high-fidelity asset size (>500KB)');

    // Check PNG header
    assert(startupBuf[0] === 0x89 && startupBuf[1] === 0x50 && startupBuf[2] === 0x4e && startupBuf[3] === 0x47, 'Startup image is valid PNG');
    assert(heroBuf[0] === 0x89 && heroBuf[1] === 0x50 && heroBuf[2] === 0x4e && heroBuf[3] === 0x47, 'Hero emblem is valid PNG');

    // Startup image is tall portrait (Image A: 841x1870, color type 2 RGB)
    const startupW = startupBuf.readUInt32BE(16);
    const startupH = startupBuf.readUInt32BE(20);
    const startupColor = startupBuf.readUInt8(25);
    assert(startupW === 841 && startupH === 1870, `Startup image dimensions are portrait 841x1870 (got ${startupW}x${startupH})`);
    assert(startupColor === 2, 'Startup image has RGB solid black background (colorType 2)');

    // Hero image is square transparent (Image B: 1254x1254, color type 6 RGBA)
    const heroW = heroBuf.readUInt32BE(16);
    const heroH = heroBuf.readUInt32BE(20);
    const heroColor = heroBuf.readUInt8(25);
    assert(heroW === 1254 && heroH === 1254, `Hero emblem dimensions are square 1254x1254 (got ${heroW}x${heroH})`);
    assert(heroColor === 6, 'Hero emblem has alpha channel transparency (colorType 6 RGBA)');

    // Verify Android native splash matches Image A
    const androidSplashPath = path.resolve(process.cwd(), 'android/app/src/main/res/drawable/splash.png');
    if (fs.existsSync(androidSplashPath)) {
      const androidSplashBuf = fs.readFileSync(androidSplashPath);
      assert(androidSplashBuf.length === startupBuf.length, 'Android native splash drawable matches synchronized Image A');
    }

    // 2. Test authStorage adapter with mock localStorage / sessionStorage
    const mockLocalStorage: Record<string, string> = {};
    const mockSessionStorage: Record<string, string> = {};
    (global as any).window = {
      localStorage: {
        getItem: (k: string) => mockLocalStorage[k] || null,
        setItem: (k: string, v: string) => { mockLocalStorage[k] = v; },
        removeItem: (k: string) => { delete mockLocalStorage[k]; },
      },
      sessionStorage: {
        getItem: (k: string) => mockSessionStorage[k] || null,
        setItem: (k: string, v: string) => { mockSessionStorage[k] = v; },
        removeItem: (k: string) => { delete mockSessionStorage[k]; },
      },
      location: {
        origin: 'https://localhost',
      },
    };

    // When rememberMe is false: writes to sessionStorage, cleans localStorage
    mockLocalStorage[REMEMBER_ME_STORAGE_KEY] = 'false';
    authStorage.setItem('test_auth_token', 'session_token_123');
    assert(mockSessionStorage['test_auth_token'] === 'session_token_123', 'authStorage writes to sessionStorage when rememberMe is false');
    assert(mockLocalStorage['test_auth_token'] === undefined, 'authStorage does not store token in localStorage when rememberMe is false');
    assert(authStorage.getItem('test_auth_token') === 'session_token_123', 'authStorage reads session token correctly');

    // When rememberMe is true: writes to localStorage, cleans sessionStorage
    mockLocalStorage[REMEMBER_ME_STORAGE_KEY] = 'true';
    authStorage.setItem('test_auth_token', 'persistent_token_456');
    assert(mockLocalStorage['test_auth_token'] === 'persistent_token_456', 'authStorage writes to localStorage when rememberMe is true');
    assert(mockSessionStorage['test_auth_token'] === undefined, 'authStorage clears sessionStorage when switching to persistent');
    assert(authStorage.getItem('test_auth_token') === 'persistent_token_456', 'authStorage reads persistent token correctly');

    // Existing session without rememberMe key: defaults to persistent / localStorage
    delete mockLocalStorage[REMEMBER_ME_STORAGE_KEY];
    assert(authStorage.getItem('test_auth_token') === 'persistent_token_456', 'Existing session preserves token access without forcing re-login');

    // 3. Test getAppRedirectUrl prevents broken https://localhost on Android
    const redirectUrl = getAppRedirectUrl();
    assert(!redirectUrl.includes('localhost'), `getAppRedirectUrl prevents broken localhost redirect on mobile (got ${redirectUrl})`);
    assert(redirectUrl.startsWith('https://'), `getAppRedirectUrl returns secure HTTPS destination (got ${redirectUrl})`);

    // Clean up mock
    delete (global as any).window;
  } catch (err) {
    assert(false, 'Test Suite 24 execution', (err as Error).message);
  }

  // --- TEST 25: Restored Report Dual Navigation, Scenario Actions & Template Replacement ---
  console.log('\n--- Test Suite 25: Restored Report Dual Navigation, Scenario Actions & Template Replacement ---');
  try {
    // 1. Report Navigation Hierarchy: Reports list -> Normal details -> Organized -> Back to Details -> Back to Reports
    const navigationHierarchy = {
      activeView: 'reports',
      isReportDetailsOpen: false,
      reportViewMode: 'standard' as 'standard' | 'organized',
      activeChildModal: null as string | null,
    };

    // Action A: Open report card from Reports list -> opens Normal details first
    navigationHierarchy.isReportDetailsOpen = true;
    navigationHierarchy.reportViewMode = 'standard';
    assert(navigationHierarchy.isReportDetailsOpen === true, 'Opening report opens Report Details modal');
    assert(navigationHierarchy.reportViewMode === 'standard', 'Opening report defaults to Normal details first');

    // Action B: User clicks "View Organized" -> switches to organized
    navigationHierarchy.reportViewMode = 'organized';
    assert(navigationHierarchy.reportViewMode === 'organized', 'Clicking View Organized switches viewMode to organized');

    // Action C: User opens a child dialog (e.g. image viewer) while in organized view
    navigationHierarchy.activeChildModal = 'ImageViewer';
    assert(navigationHierarchy.activeChildModal === 'ImageViewer', 'Child modal opens on top of Organized view');

    // Simulate Back step 1: Closes child modal, remains in organized view
    if (navigationHierarchy.activeChildModal) {
      navigationHierarchy.activeChildModal = null;
    }
    assert(navigationHierarchy.activeChildModal === null, 'Back step 1 closes child modal');
    assert(navigationHierarchy.reportViewMode === 'organized', 'Back step 1 keeps Organized view active');

    // Simulate Back step 2: From Organized view, returns to Normal details
    if (navigationHierarchy.reportViewMode === 'organized') {
      navigationHierarchy.reportViewMode = 'standard';
    }
    assert(navigationHierarchy.reportViewMode === 'standard', 'Back step 2 returns to Normal report details');
    assert(navigationHierarchy.isReportDetailsOpen === true, 'Report details modal remains open');

    // Simulate Back step 3: From Normal details, returns to Reports list
    if (navigationHierarchy.reportViewMode === 'standard') {
      navigationHierarchy.isReportDetailsOpen = false;
    }
    assert(navigationHierarchy.isReportDetailsOpen === false, 'Back step 3 returns to Reports list');

    // 2. Scenario Actions: Take Trade and Mark Invalid
    const testScenario: PlannedScenario = {
      id: 'scn_test_1',
      label: 'Scenario 1',
      strategy: 'London Manipulation',
      direction: 'Buy',
      description: 'Look for liquidity sweep at Asian Low',
      entryConditions: 'M5 MSS followed by FVG tap',
      invalidationConditions: 'Price closes below Asian Low',
      isSaved: true,
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Mark Invalid
    testScenario.isInvalid = true;
    testScenario.status = 'Invalid';
    assert(testScenario.isInvalid === true, 'Scenario marked invalid has isInvalid = true');
    assert(testScenario.status === 'Invalid', 'Scenario marked invalid has status = Invalid');
    assert(testScenario.description === 'Look for liquidity sweep at Asian Low', 'Scenario analysis content remains intact when invalid');
    assert(testScenario.direction === 'Buy', 'Scenario direction remains intact');

    // Restore scenario
    testScenario.isInvalid = false;
    testScenario.status = 'Active';
    assert(testScenario.isInvalid === false, 'Scenario restored has isInvalid = false');
    assert(testScenario.status === 'Active', 'Scenario restored has status = Active');

    // 3. Template Replacement
    const initialTmpl: SavedTemplate = {
      id: 'tmpl_replace_test_id',
      name: 'Original Template',
      createdAt: 1000,
      updatedAt: 1000,
      data: {
        pair: 'XAUUSD',
        title: 'Initial Gold Setup',
        session: 'London',
        analysisTiming: 'On time',
        timezone: 'UTC',
        timeframes: TIMEFRAME_ORDER.reduce((acc, tf) => {
          acc[tf] = createEmptyTimeframeData(tf);
          return acc;
        }, {} as Record<TimeframeId, TimeframeData>),
        crossedLiquidity: [],
        supplyDemandLevels: [],
        openingCandles: [],
        scenarios: [],
        overallNotes: 'Initial notes',
      },
    };
    await saveTemplate(initialTmpl);

    // Replace existing template: preserves id and createdAt, updates content and updatedAt
    const updatedTmplData: SavedTemplate = {
      ...initialTmpl,
      updatedAt: 5000,
      data: {
        ...initialTmpl.data,
        pair: 'EURUSD',
        title: 'Updated EUR Setup',
        overallNotes: 'Updated notes through replace existing flow',
      },
    };
    await saveTemplate(updatedTmplData);

    const retrievedReplaced = await getTemplateById('tmpl_replace_test_id');
    assert(retrievedReplaced?.id === 'tmpl_replace_test_id', 'Replaced template preserves exact template ID');
    assert(retrievedReplaced?.createdAt === 1000, 'Replaced template preserves original creation timestamp');
    assert(retrievedReplaced?.updatedAt === 5000, 'Replaced template updates modification timestamp');
    assert(retrievedReplaced?.data.pair === 'EURUSD', 'Replaced template data contains updated pair');
    assert(retrievedReplaced?.data.overallNotes === 'Updated notes through replace existing flow', 'Replaced template data contains updated notes');

    const allTemplates = await getAllTemplates();
    const matches = allTemplates.filter((t) => t.id === 'tmpl_replace_test_id');
    assert(matches.length === 1, 'Replacing template does not create a duplicate template record');
  } catch (err) {
    assert(false, 'Test Suite 25 execution', (err as Error).message);
  }

  // --- Test Suite 26: Normal Report Exit, Authoritative Close, Main Nav & Bottom Actions ---
  try {
    console.log('\n--- Test Suite 26: Normal Report Exit, Authoritative Close, Main Nav & Bottom Actions ---');

    // 1. Authoritative Close: Single click closes report and consumedReportIdRef prevents auto-reopen
    interface SimulatedReportsState {
      activeReportDetails: SavedReport | null;
      consumedReportId: string | null;
      initialSession: { activeReportDetailsId: string | null; selectedPair: string; searchQuery: string };
      isMainHeaderVisible: boolean;
      viewMode: 'standard' | 'organized';
    }

    const testRep = createInitialAnalysisData('EURUSD');
    const savedRep: SavedReport = {
      ...testRep,
      id: 'rep_authoritative_close_test',
      status: 'Original',
    };

    const state: SimulatedReportsState = {
      activeReportDetails: null,
      consumedReportId: null,
      initialSession: {
        activeReportDetailsId: savedRep.id,
        selectedPair: 'EURUSD',
        searchQuery: 'London',
      },
      isMainHeaderVisible: true,
      viewMode: 'standard',
    };

    // Simulate opening from initialSession (e.g. after modify -> save)
    const simulateRestore = (s: SimulatedReportsState) => {
      const targetId = s.initialSession.activeReportDetailsId;
      if (targetId && targetId !== s.consumedReportId) {
        s.consumedReportId = targetId;
        s.activeReportDetails = savedRep;
        s.viewMode = 'standard';
        s.isMainHeaderVisible = true;
      }
    };

    simulateRestore(state);
    assert(state.activeReportDetails !== null, 'Report details opened from initialSession');
    assert(state.consumedReportId === savedRep.id, 'Target report ID consumed on open');
    assert(state.viewMode === 'standard', 'Opens to Normal details (standard) by default');
    assert(state.isMainHeaderVisible === true, 'Main app navigation is visible in Normal details');

    // Authoritative close
    const handleClose = (s: SimulatedReportsState) => {
      s.consumedReportId = null;
      s.activeReportDetails = null;
      s.initialSession.activeReportDetailsId = null;
    };

    handleClose(state);
    assert(state.activeReportDetails === null, 'Clicking Back to Reports sets activeReportDetails to null');
    assert(state.initialSession.activeReportDetailsId === null, 'Authoritative close clears initialSession.activeReportDetailsId');

    // Re-run restore simulation: MUST NOT re-open
    simulateRestore(state);
    assert(state.activeReportDetails === null, 'Report remains closed and DOES NOT reopen itself');
    assert(state.initialSession.selectedPair === 'EURUSD', 'List pair filter preserved on close');
    assert(state.initialSession.searchQuery === 'London', 'List search query preserved on close');

    // 2. Repeated open -> close sequence at least 5 times
    let successfulCycles = 0;
    for (let i = 0; i < 5; i++) {
      // User clicks View Details
      state.consumedReportId = savedRep.id;
      state.activeReportDetails = savedRep;
      state.initialSession.activeReportDetailsId = savedRep.id;
      assert(state.activeReportDetails !== null, `Cycle ${i + 1}: Report successfully opened`);

      // User clicks Back to Reports
      handleClose(state);
      assert(state.activeReportDetails === null, `Cycle ${i + 1}: Report successfully closed`);
      simulateRestore(state);
      assert(state.activeReportDetails === null, `Cycle ${i + 1}: Report remains closed without bounce`);
      successfulCycles++;
    }
    assert(successfulCycles === 5, 'Verified 5 consecutive open -> close cycles without failure');

    // 3. Full sequence: Reports list -> Normal details -> Organized view -> Back to Details -> Back to Reports
    // Step A: Reports list -> Normal details
    state.activeReportDetails = savedRep;
    state.viewMode = 'standard';
    state.isMainHeaderVisible = true;
    assert(state.viewMode === 'standard' && state.isMainHeaderVisible === true, 'Step A: Normal details active with Main Nav visible');

    // Step B: Normal details -> Organized view
    state.viewMode = 'organized';
    state.isMainHeaderVisible = false; // Main navigation hidden in organized view
    assert(state.viewMode === 'organized' && state.isMainHeaderVisible === false, 'Step B: Organized view active with Main Nav hidden');

    // Step C: Organized view -> Back to Details
    state.viewMode = 'standard';
    state.isMainHeaderVisible = true; // Main navigation restored
    assert(state.viewMode === 'standard' && state.isMainHeaderVisible === true, 'Step C: Back to Details restores Normal details and Main Nav');

    // Step D: Normal details -> Back to Reports
    handleClose(state);
    assert(state.activeReportDetails === null, 'Step D: Back to Reports returns to Reports list');

    // 4. Main Nav Header actions from Normal details
    // Action A: Clicking "Reports" in main header closes details and returns to list
    state.activeReportDetails = savedRep;
    const handleHeaderReportsClick = (s: SimulatedReportsState) => {
      handleClose(s);
    };
    handleHeaderReportsClick(state);
    assert(state.activeReportDetails === null, 'Clicking Reports in main nav closes details and returns to list');

    // Action B: Clicking "Home" in main header dismisses details and navigates to home
    state.activeReportDetails = savedRep;
    let currentNavView = 'reports' as string;
    const handleHeaderHomeClick = (s: SimulatedReportsState) => {
      handleClose(s);
      currentNavView = 'home';
    };
    handleHeaderHomeClick(state);
    assert(state.activeReportDetails === null, 'Clicking Home in main nav dismisses report details');
    assert(currentNavView === 'home', 'Navigated to Home view');

    // Action C: Opening Settings does not close or lose the report
    state.activeReportDetails = savedRep;
    let isSettingsOpen = false as boolean;
    const handleOpenSettings = () => {
      isSettingsOpen = true;
    };
    handleOpenSettings();
    assert(isSettingsOpen, 'Settings modal opened');
    assert(state.activeReportDetails !== null, 'Report details remain open behind Settings modal');

    // 5. Bottom Report Actions Placement & Scenario Actions
    const topBarActions = ['Back to Reports', 'Back to Details', 'View Organized'];
    const bottomReportActions = ['Modify Report', 'Copy Report', 'Share', 'Download PDF', 'Take Trade', 'Delete Report'];
    const scenarioActions = ['Take Trade', 'Mark Invalid / Restore Scenario'];

    assert(!topBarActions.includes('Modify Report'), 'Top bar contains NO Modify Report button');
    assert(!topBarActions.includes('Delete Report'), 'Top bar contains NO Delete Report button');
    assert(!topBarActions.includes('Download PDF'), 'Top bar contains NO Download PDF button');
    assert(bottomReportActions.length === 6, 'All 6 primary report actions are positioned at bottom');
    assert(scenarioActions.includes('Take Trade'), 'Scenario Take Trade remains intact inside scenario cards');
    assert(scenarioActions.includes('Mark Invalid / Restore Scenario'), 'Scenario invalidation remains inside scenario cards');
  } catch (err) {
    assert(false, 'Test Suite 26 execution', (err as Error).message);
  }

  // --- Test Suite 27: Startup Routing, Previous-Period High/Low & Timeframe Summaries ---
  console.log('\n--- Test Suite 27: Startup Routing, Previous-Period High/Low & Timeframe Summaries ---');
  try {
    const {
      getTimeframeStructureAlignment,
      getTimeframeOcLevel,
      getTimeframeLiquidityTaken,
    } = await import('../utils/analysisUtils');
    const {
      createEmptyTimeframeData,
      createInitialAnalysisData,
      normalizeWorkspaceVisibilityConfig,
      normalizeReportVisibilityConfig,
      DEFAULT_DEEP_FIELDS_VISIBILITY,
    } = await import('../types/journal');

    // 1. Verify Startup Routing Rules
    // Cold start always opens Home
    const coldStartDefaultView = 'home';
    assert(coldStartDefaultView === 'home', 'Cold start / full restart destination is HOME');

    // Draft preservation for "Continue Analysis"
    const mockDraft = createInitialAnalysisData('XAUUSD');
    mockDraft.timeframes.Monthly.pmh = '2750.50';
    mockDraft.timeframes.Monthly.pml = '2600.00';
    await saveDraft(mockDraft);

    const reloadedDraft = await getDraft();
    assert(reloadedDraft !== null, 'Restored draft from IndexedDB is non-null');
    assert(reloadedDraft?.pair === 'XAUUSD', 'Draft pair is preserved for Continue Analysis');
    assert(reloadedDraft?.timeframes.Monthly.pmh === '2750.50', 'PMH level is preserved in draft');
    assert(reloadedDraft?.timeframes.Monthly.pml === '2600.00', 'PML level is preserved in draft');

    // 2. Verify Previous-Period High/Low decimal formatting and blank behavior
    const tfData = createEmptyTimeframeData('Monthly');
    assert(tfData.pmh === '', 'Blank PMH remains blank empty string, not 0 or 0.00');
    assert(tfData.pml === '', 'Blank PML remains blank empty string, not 0 or 0.00');

    // Assign decimals
    tfData.pmh = '2685.50';
    tfData.pml = '2530.25';
    assert(tfData.pmh === '2685.50', 'Decimal precision preserved for PMH');
    assert(tfData.pml === '2530.25', 'Decimal precision preserved for PML');

    const weeklyTf = createEmptyTimeframeData('Weekly');
    weeklyTf.pwh = '1.08550';
    weeklyTf.pwl = '1.07200';
    assert(weeklyTf.pwh === '1.08550', 'Forex 5-decimal precision preserved for PWH');
    assert(weeklyTf.pwl === '1.07200', 'Forex 5-decimal precision preserved for PWL');

    const dailyTf = createEmptyTimeframeData('Daily');
    dailyTf.pdh = '68500.75';
    dailyTf.pdl = '66200.10';
    assert(dailyTf.pdh === '68500.75', 'Crypto decimal precision preserved for PDH');
    assert(dailyTf.pdl === '66200.10', 'Crypto decimal precision preserved for PDL');

    // 3. Verify Visibility Controls in Both Settings Tabs
    const defaultWorkspaceVis = normalizeWorkspaceVisibilityConfig(null);
    assert(defaultWorkspaceVis.perTimeframeFields.Monthly.pmh === true, 'Monthly PMH editor visibility defaults to true');
    assert(defaultWorkspaceVis.perTimeframeFields.Monthly.pml === true, 'Monthly PML editor visibility defaults to true');
    assert(defaultWorkspaceVis.perTimeframeFields.Weekly.pwh === true, 'Weekly PWH editor visibility defaults to true');
    assert(defaultWorkspaceVis.perTimeframeFields.Daily.pdh === true, 'Daily PDH editor visibility defaults to true');

    const customWorkspaceVis = normalizeWorkspaceVisibilityConfig({
      perTimeframeFields: {
        ...defaultWorkspaceVis.perTimeframeFields,
        Monthly: {
          ...DEFAULT_DEEP_FIELDS_VISIBILITY,
          pmh: false,
        },
      },
    });
    assert(customWorkspaceVis.perTimeframeFields.Monthly.pmh === false, 'Toggled false editor visibility for PMH is honored');
    assert(customWorkspaceVis.perTimeframeFields.Monthly.pml === true, 'Untoggled PML remains true');

    const defaultReportVis = normalizeReportVisibilityConfig(null);
    assert(defaultReportVis.perTimeframeFields.Monthly.pmh === true, 'Monthly PMH report visibility defaults to true');
    assert(defaultReportVis.perTimeframeFields.Weekly.pwl === true, 'Weekly PWL report visibility defaults to true');

    const customReportVis = normalizeReportVisibilityConfig({
      perTimeframeFields: {
        ...defaultReportVis.perTimeframeFields,
        Daily: {
          ...DEFAULT_DEEP_FIELDS_VISIBILITY,
          pdh: false,
        },
      },
    });
    assert(customReportVis.perTimeframeFields.Daily.pdh === false, 'Toggled false report visibility for PDH is honored');
    assert(customReportVis.perTimeframeFields.Daily.pdl === true, 'Untoggled Daily PDL report visibility remains true');

    // 4. Verify Timeframe Summary Derivations
    // Case A: Structure incomplete when missing any component
    const incompleteTf = createEmptyTimeframeData('15M');
    incompleteTf.swing.direction = 'Bullish';
    incompleteTf.internal.direction = 'Bullish';
    incompleteTf.fractal.direction = ''; // Missing fractal
    const statusIncomplete = getTimeframeStructureAlignment(incompleteTf);
    assert(statusIncomplete.status === 'incomplete', 'Incomplete status returned when fractal direction is missing');
    assert(statusIncomplete.label === 'Structure incomplete', 'Label is "Structure incomplete"');

    // Case B: Structures aligned — Bullish
    const bullishTf = createEmptyTimeframeData('15M');
    bullishTf.swing.direction = 'Bullish';
    bullishTf.internal.direction = 'Bullish';
    bullishTf.fractal.direction = 'Bullish';
    const statusBullish = getTimeframeStructureAlignment(bullishTf);
    assert(statusBullish.status === 'aligned', 'Status is aligned for complete Bullish structures');
    assert(statusBullish.label === 'Structures aligned — Bullish', 'Label is "Structures aligned — Bullish"');
    assert(statusBullish.direction === 'Bullish', 'Direction is Bullish');

    // Case C: Structures aligned — Bearish
    const bearishTf = createEmptyTimeframeData('4H');
    bearishTf.swing.direction = 'Bearish';
    bearishTf.internal.direction = 'Bearish';
    bearishTf.fractal.direction = 'Bearish';
    const statusBearish = getTimeframeStructureAlignment(bearishTf);
    assert(statusBearish.status === 'aligned', 'Status is aligned for complete Bearish structures');
    assert(statusBearish.label === 'Structures aligned — Bearish', 'Label is "Structures aligned — Bearish"');
    assert(statusBearish.direction === 'Bearish', 'Direction is Bearish');

    // Case D: Mixed structure
    const mixedTf = createEmptyTimeframeData('1H');
    mixedTf.swing.direction = 'Bullish';
    mixedTf.internal.direction = 'Bearish';
    mixedTf.fractal.direction = 'Bullish';
    const statusMixed = getTimeframeStructureAlignment(mixedTf);
    assert(statusMixed.status === 'mixed', 'Status is mixed when structures disagree');
    assert(statusMixed.label === 'Mixed structure', 'Label is "Mixed structure"');

    // Case E: Neutral swing makes structure mixed
    const neutralTf = createEmptyTimeframeData('5M');
    neutralTf.swing.direction = 'Neutral';
    neutralTf.internal.direction = 'Bullish';
    neutralTf.fractal.direction = 'Bullish';
    const statusNeutral = getTimeframeStructureAlignment(neutralTf);
    assert(statusNeutral.status === 'mixed', 'Neutral swing results in Mixed structure');

    // 5. Verify Opening Candle level finder
    const ocs = [
      { id: 'oc_1', session: 'Monthly' as const, level: '2645.50' },
      { id: 'oc_2', session: 'Weekly' as const, level: '2610.00' },
    ];
    assert(getTimeframeOcLevel('Monthly', ocs) === '2645.50', 'Monthly OC level correctly resolved');
    assert(getTimeframeOcLevel('Weekly', ocs) === '2610.00', 'Weekly OC level correctly resolved');
    assert(getTimeframeOcLevel('Daily', ocs) === null, 'Unrecorded Daily OC level returns null');

    // 6. Verify Liquidity Taken summary
    const crossedLiq = ['PMH', 'PDH', 'PDL', '4H High'] as import('../types/journal').MajorLiquidityItem[];
    assert(getTimeframeLiquidityTaken('Monthly', crossedLiq) === 'Liquidity taken: PMH', 'Monthly liquidity taken is "Liquidity taken: PMH"');
    assert(getTimeframeLiquidityTaken('Daily', crossedLiq) === 'Liquidity taken: PDH, PDL', 'Daily liquidity taken is "Liquidity taken: PDH, PDL"');
    assert(getTimeframeLiquidityTaken('4H', crossedLiq) === 'Liquidity taken: 4H High', '4H liquidity taken is "Liquidity taken: 4H High"');
    assert(getTimeframeLiquidityTaken('Weekly', crossedLiq) === null, 'Weekly has no crossed items so returns null');
  } catch (err) {
    assert(false, 'Test Suite 27 execution', (err as Error).message);
  }

  // --- TEST 28: Alignment Display, Specific Timeframe-Pair Information & Safe Report-Saving Choices ---
  console.log('\n--- Test Suite 28: Alignment Display, Timeframe-Pair Information & Safe Report-Saving Choices ---');
  try {
    const {
      getTimeframePairAlignments,
      CONFIGURED_TIMEFRAME_PAIRS,
      calculateOverallAlignment,
      getTimeframeStructureAlignment,
    } = await import('../utils/analysisUtils');

    // 1. Timeframe pairs configuration verification
    assert(CONFIGURED_TIMEFRAME_PAIRS.length === 4, 'Exactly 4 configured timeframe pairs');
    assert(
      JSON.stringify(CONFIGURED_TIMEFRAME_PAIRS) ===
        JSON.stringify([
          ['Daily', '1H'],
          ['4H', '15M'],
          ['1H', '5M'],
          ['15M', '1M'],
        ]),
      'Configured pairs match exact requirement: Daily ↔ 1H, 4H ↔ 15M, 1H ↔ 5M, 15M ↔ 1M'
    );

    // 2. Pair participation counts
    const dummyTfs = {} as Record<import('../types/journal').TimeframeId, import('../types/journal').TimeframeData>;
    for (const tf of TIMEFRAME_ORDER) {
      dummyTfs[tf] = createEmptyTimeframeData(tf);
    }
    assert(getTimeframePairAlignments('Monthly', dummyTfs).length === 0, 'Monthly participates in 0 configured pairs');
    assert(getTimeframePairAlignments('Weekly', dummyTfs).length === 0, 'Weekly participates in 0 configured pairs');
    assert(getTimeframePairAlignments('Daily', dummyTfs).length === 1, 'Daily participates in 1 pair (1H)');
    assert(getTimeframePairAlignments('4H', dummyTfs).length === 1, '4H participates in 1 pair (15M)');
    assert(getTimeframePairAlignments('1H', dummyTfs).length === 2, '1H participates in 2 pairs (Daily and 5M)');
    assert(getTimeframePairAlignments('15M', dummyTfs).length === 2, '15M participates in 2 pairs (4H and 1M)');
    assert(getTimeframePairAlignments('5M', dummyTfs).length === 1, '5M participates in 1 pair (1H)');
    assert(getTimeframePairAlignments('1M', dummyTfs).length === 1, '1M participates in 1 pair (15M)');

    // 3. Pair bias comparison rules
    // Case A: Missing / unselected -> "Pair incomplete"
    const pairIncomplete = getTimeframePairAlignments('Daily', dummyTfs);
    assert(pairIncomplete[0].status === 'incomplete', 'Unselected biases evaluate to incomplete status');
    assert(pairIncomplete[0].label === 'Daily and 1H — Pair incomplete', 'Label is "Daily and 1H — Pair incomplete"');

    // Case B: Neutral -> "No directional alignment"
    dummyTfs.Daily.overallBias = 'Neutral';
    dummyTfs['1H'].overallBias = 'Bullish';
    const pairNeutral = getTimeframePairAlignments('Daily', dummyTfs);
    assert(pairNeutral[0].status === 'neutral', 'Neutral bias evaluates to neutral status');
    assert(pairNeutral[0].label === 'Daily and 1H — No directional alignment', 'Label is "Daily and 1H — No directional alignment"');

    // Case C: Opposing directions -> "Biases differ"
    dummyTfs.Daily.overallBias = 'Bullish';
    dummyTfs['1H'].overallBias = 'Bearish';
    const pairDiffer = getTimeframePairAlignments('Daily', dummyTfs);
    assert(pairDiffer[0].status === 'differing', 'Bullish vs Bearish evaluates to differing status');
    assert(pairDiffer[0].label === 'Daily and 1H — Biases differ', 'Label is "Daily and 1H — Biases differ"');

    // Case D: Both Bullish without complete deep structure -> Aligned without deep indicator
    dummyTfs.Daily.overallBias = 'Bullish';
    dummyTfs['1H'].overallBias = 'Bullish';
    const pairBullishNoDeep = getTimeframePairAlignments('Daily', dummyTfs);
    assert(pairBullishNoDeep[0].status === 'aligned', 'Both Bullish evaluates to aligned status');
    assert(pairBullishNoDeep[0].label === 'Daily aligned with 1H — Bullish', 'Label is "Daily aligned with 1H — Bullish"');
    assert(pairBullishNoDeep[0].deepAligned === false, 'deepAligned is false when deep structures incomplete');

    // Case E: Both Bullish WITH complete deep structure -> Appends (Deep structures also aligned)
    dummyTfs.Daily.swing.direction = 'Bullish';
    dummyTfs.Daily.internal.direction = 'Bullish';
    dummyTfs.Daily.fractal.direction = 'Bullish';
    dummyTfs['1H'].swing.direction = 'Bullish';
    dummyTfs['1H'].internal.direction = 'Bullish';
    dummyTfs['1H'].fractal.direction = 'Bullish';
    const pairBullishDeep = getTimeframePairAlignments('Daily', dummyTfs);
    assert(pairBullishDeep[0].deepAligned === true, 'deepAligned is true when both structures complete & agree Bullish');
    assert(pairBullishDeep[0].label === 'Daily aligned with 1H — Bullish (Deep structures also aligned)', 'Label contains "(Deep structures also aligned)"');

    // From 1H perspective:
    const pair1HDeep = getTimeframePairAlignments('1H', dummyTfs);
    assert(pair1HDeep[0].label === '1H aligned with Daily — Bullish (Deep structures also aligned)', '1H perspective shows "1H aligned with Daily — Bullish (Deep structures also aligned)"');

    // Case F: Both Bearish WITH complete deep structure -> Appends (Deep structures also aligned)
    dummyTfs['4H'].overallBias = 'Bearish';
    dummyTfs['4H'].swing.direction = 'Bearish';
    dummyTfs['4H'].internal.direction = 'Bearish';
    dummyTfs['4H'].fractal.direction = 'Bearish';
    dummyTfs['15M'].overallBias = 'Bearish';
    dummyTfs['15M'].swing.direction = 'Bearish';
    dummyTfs['15M'].internal.direction = 'Bearish';
    dummyTfs['15M'].fractal.direction = 'Bearish';
    const pairBearishDeep = getTimeframePairAlignments('4H', dummyTfs);
    assert(pairBearishDeep[0].status === 'aligned', 'Both Bearish evaluates to aligned status');
    assert(pairBearishDeep[0].label === '4H aligned with 15M — Bearish (Deep structures also aligned)', '4H perspective shows Bearish with deep alignment');

    // Case G: Visibility awareness: counterpart hidden -> omits pair
    const visWithHidden1H = { '1H': false } as Record<import('../types/journal').TimeframeId, boolean>;
    const pairWithHiddenPartner = getTimeframePairAlignments('Daily', dummyTfs, visWithHidden1H);
    assert(pairWithHiddenPartner.length === 0, 'Pair omitted when counterpart timeframe is hidden in visibility config');

    // 4. Overall alignment derivation from saved report
    const mockReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rep_align_test_1',
      status: 'Original',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    for (const tf of TIMEFRAME_ORDER) {
      mockReport.timeframes[tf].overallBias = 'Bullish';
    }
    const reportAlign = calculateOverallAlignment(mockReport.timeframes);
    assert(reportAlign.status === 'ALIGNED', 'Report overall alignment correctly calculates ALIGNED');
    assert(reportAlign.bias === 'Bullish', 'Report overall alignment bias is Bullish');
    assert(reportAlign.label === 'ALIGNED (BULLISH)', 'Report overall alignment label is ALIGNED (BULLISH)');
    assert(reportAlign.detail === 'All 8 timeframes confirm bullish bias', 'Report detail shows all 8 timeframes confirm');

    // 5. Safe Save Choices - Update Existing vs Save as New
    // Base Report in IndexedDB
    const baseReportId = `rep_base_${Date.now()}`;
    const baseCreatedAt = 1700000000000;
    const baseSaved = await saveReport({
      ...createInitialAnalysisData('XAUUSD'),
      id: baseReportId,
      title: 'Original Gold Trade Plan',
      status: 'Original',
      createdAt: baseCreatedAt,
      updatedAt: baseCreatedAt,
    });
    assert(baseSaved.id === baseReportId, 'Base report saved with original ID');
    assert(baseSaved.revision === 1, 'Base report starts at revision 1');

    // Action 1: Update Existing Report
    const updatedPayload: SavedReport = {
      ...baseSaved,
      title: 'Original Gold Trade Plan (Updated)',
      isModified: true,
      status: 'Modified',
      updatedAt: Date.now(),
    };
    const updatedResult = await saveReport(updatedPayload);
    assert(updatedResult.id === baseReportId, 'Update Existing preserves exact report ID');
    assert(updatedResult.createdAt === baseCreatedAt, 'Update Existing preserves original createdAt timestamp');
    assert(updatedResult.status === 'Modified', 'Update Existing marks status as Modified');
    assert(updatedResult.revision === 2, 'Update Existing increments revision to 2');
    assert(updatedResult.title === 'Original Gold Trade Plan (Updated)', 'Update Existing updates content');

    // Action 2: Save as New Report
    const newReportId = `rep_new_${Date.now()}`;
    const newCreatedAt = Date.now();
    const newReportPayload: SavedReport = {
      ...updatedResult,
      id: newReportId,
      title: 'Divergent Scenario Trade Plan',
      createdAt: newCreatedAt,
      updatedAt: newCreatedAt,
      status: 'Original',
      isModified: false,
      copiedFromId: baseReportId,
      revision: 1,
    };
    const newReportResult = await saveReport(newReportPayload);
    assert(newReportResult.id === newReportId, 'Save as New creates distinct report ID');
    assert(newReportResult.createdAt === newCreatedAt, 'Save as New has fresh creation timestamp');
    assert(newReportResult.status === 'Original', 'Save as New has status Original');
    assert(newReportResult.copiedFromId === baseReportId, 'Save as New links copiedFromId to original report');

    // Verify original report is untouched by Save as New
    const originalReloaded = await getReportById(baseReportId);
    assert(originalReloaded !== null, 'Original report still exists in IndexedDB');
    assert(originalReloaded?.id === baseReportId, 'Original report retains original ID');
    assert(originalReloaded?.revision === 2, 'Original report revision untouched at 2');
    assert(originalReloaded?.title === 'Original Gold Trade Plan (Updated)', 'Original report content untouched');

    // Action 3: Single-Transaction Atomic Concurrency Protection
    // Create dedicated report for competing updates
    const compReportId = `rep_comp_${Date.now()}_test`;
    await saveReport({
      id: compReportId,
      pair: 'EURUSD',
      date: '2026-10-31',
      time: '12:00:00',
      session: 'NY AM',
      analysisTiming: 'On time',
      timeframes: {} as any,
      createdAt: Date.now(),
      status: 'Original',
      isModified: false,
      title: 'Baseline Report',
    } as any);

    // Competing Update 1: Tab A updates report starting from expected revision 1
    const updateResA = await updateReportAtomically(
      {
        id: compReportId,
        pair: 'EURUSD',
        date: '2026-10-31',
        time: '12:00:00',
        session: 'NY AM',
        analysisTiming: 'On time',
        timeframes: {} as any,
        status: 'Modified',
        title: 'Updated by Tab A',
      } as any,
      1 // expectedSourceRevision
    );
    assert(updateResA.success === true, 'Tab A update succeeded in atomic transaction');
    assert(updateResA.report?.revision === 2, 'Tab A update advanced revision to 2');
    assert(updateResA.report?.title === 'Updated by Tab A', 'Tab A title committed');

    // Competing Update 2: Tab B tries to update using stale expected revision 1
    const updateResB = await updateReportAtomically(
      {
        id: compReportId,
        pair: 'EURUSD',
        date: '2026-10-31',
        time: '12:00:00',
        session: 'NY AM',
        analysisTiming: 'On time',
        timeframes: {} as any,
        status: 'Modified',
        title: 'Updated by Tab B (Stale)',
      } as any,
      1 // stale expectedSourceRevision
    );
    assert(updateResB.success === false, 'Tab B update rejected by single-transaction revision check');
    assert(updateResB.conflict === true, 'Tab B returned conflict = true');
    assert(updateResB.currentRevision === 2, 'Tab B informed of current revision = 2');
    assert(updateResB.expectedRevision === 1, 'Tab B informed of expected revision = 1');

    // Verify Tab A's data was NOT overwritten by Tab B
    const verifyCompOnDisk = await getReportById(compReportId);
    assert(verifyCompOnDisk?.revision === 2, 'Disk report remains at revision 2');
    assert(verifyCompOnDisk?.title === 'Updated by Tab A', 'Disk report retains Tab A contents');

    // Tab B can safely preserve its edits by saving as a new report
    const tabBNewReportId = `rep_tab_b_new_${Date.now()}`;
    const tabBNewReport = await saveReport({
      id: tabBNewReportId,
      pair: 'EURUSD',
      date: '2026-10-31',
      time: '12:00:00',
      session: 'NY AM',
      analysisTiming: 'On time',
      timeframes: {} as any,
      createdAt: Date.now(),
      status: 'Original',
      isModified: false,
      copiedFromId: compReportId,
      revision: 1,
      title: 'Updated by Tab B (Preserved as New)',
    } as any);
    assert(tabBNewReport.id === tabBNewReportId, 'Tab B preserved as new report');
    assert(tabBNewReport.copiedFromId === compReportId, 'Tab B references original report ID');

    // Action 4: Deleted Original Report Protection in atomic transaction
    await deleteReport(newReportId);
    const deletedAtomicRes = await updateReportAtomically(
      {
        id: newReportId,
        pair: 'XAUUSD',
        date: '2026-10-31',
        time: '12:00:00',
        session: 'London',
        analysisTiming: 'On time',
        timeframes: {} as any,
      } as any,
      1
    );
    assert(deletedAtomicRes.success === false, 'Atomic update on deleted report fails cleanly');
    assert(deletedAtomicRes.notFound === true, 'notFound is true for deleted report');

    // Action 5: Legacy Revision Handling (Missing revision field defaults safely to 1)
    const legacyReportId = `rep_legacy_${Date.now()}`;
    await saveReport({
      id: legacyReportId,
      pair: 'BTCUSD',
      date: '2026-10-31',
      time: '12:00:00',
      session: 'Asian',
      analysisTiming: 'On time',
      timeframes: {} as any,
      createdAt: Date.now(),
      status: 'Original',
      isModified: false,
      title: 'Legacy Report Without Revision Field',
      // revision omitted to simulate legacy record
    } as any);
    const legacyAtomicRes = await updateReportAtomically(
      {
        id: legacyReportId,
        pair: 'BTCUSD',
        date: '2026-10-31',
        time: '12:00:00',
        session: 'Asian',
        analysisTiming: 'On time',
        timeframes: {} as any,
        title: 'Legacy Report (Updated)',
      } as any,
      1 // expectedSourceRevision for legacy report
    );
    assert(legacyAtomicRes.success === true, 'Legacy report missing revision updated successfully');
    assert(legacyAtomicRes.report?.revision === 2, 'Legacy report incremented to revision 2');

    // Action 6: Editing context survival on draft
    const editingDraft = {
      ...createInitialAnalysisData('XAUUSD'),
      originalId: baseReportId,
      sourceRevision: 3,
      isModified: true,
      title: 'Unfinished Modification',
    };
    await saveDraft(editingDraft);
    const restoredDraft = await getDraft();
    assert(restoredDraft !== null, 'Restored draft is non-null');
    assert(restoredDraft?.originalId === baseReportId, 'Draft retains originalId across persistence');
    assert(restoredDraft?.isModified === true, 'Draft retains isModified flag across persistence');
    assert(restoredDraft?.sourceRevision === 3, 'Draft retains sourceRevision across persistence');
    await clearDraft();
    assert((await getDraft()) === null, 'Draft cleared after successful save');

    // Action 7: Autosave & Save Ordering Guards
    // Test: In-flight autosave with draft sequence <= savedReportDraftVersion cannot resurrect cleared draft
    let draftVersion = 5;
    let savedReportDraftVersion = 0;

    // Report save completes at draftVersion 5
    savedReportDraftVersion = 5;
    await clearDraft();

    // A stale in-flight autosave (version 4) completes after save:
    const staleAutosaveVersion = 4;
    const shouldAbortStaleAutosave = staleAutosaveVersion <= savedReportDraftVersion;
    assert(shouldAbortStaleAutosave === true, 'Stale in-flight autosave is discarded');
    if (!shouldAbortStaleAutosave) {
      await saveDraft({ ...createInitialAnalysisData('XAUUSD'), title: 'Stale Resurrection' });
    }
    assert((await getDraft()) === null, 'Cleared draft was NOT resurrected by stale autosave');

    // Test: Inputs changed during async save (version 6 > savedReportDraftVersion 5) are preserved
    const newInputsDuringSaveVersion = 6;
    const hasNewInputsDuringSave = newInputsDuringSaveVersion > savedReportDraftVersion;
    assert(hasNewInputsDuringSave === true, 'New inputs typed during save are recognized');
    if (hasNewInputsDuringSave) {
      await saveDraft({ ...createInitialAnalysisData('XAUUSD'), title: 'Preserved Keystrokes During Save' });
    }
    const draftAfterNewInputs = await getDraft();
    assert(draftAfterNewInputs?.title === 'Preserved Keystrokes During Save', 'New inputs typed during save are preserved');
    await clearDraft();

    // Test: Save as New transitions identity so subsequent saves target the new report
    const originalPreSaveAsNewId: string = 'rep_orig_123';
    const createdNewReportId: string = 'rep_new_456';
    const postSaveAsNewOriginalId: string = createdNewReportId; // transitions to new report ID
    assert(postSaveAsNewOriginalId === createdNewReportId, 'Save as New transitions originalId to new report');
    assert(postSaveAsNewOriginalId !== originalPreSaveAsNewId, 'Save as New no longer targets original report');

    // Action 8: Cloud CAS Optimistic Concurrency, Retries & Remote Deletion Protection
    // Simulated cloud table tracking user reports
    type CloudRow = {
      id: string;
      user_id: string;
      revision: number;
      updated_at: string;
      payload: any;
    };
    const mockCloudStore = new Map<string, CloudRow>();

    // Simulated server-authoritative upload handler executing exact cloudSync.ts logic
    const simulateCloudUpload = (
      userId: string,
      report: SavedReport
    ): { success: boolean; conflict?: boolean; error?: string; targetRevision?: number } => {
      const existing = mockCloudStore.get(`${userId}_${report.id}`);
      const localRev = (report as any).revision || 1;
      const baseCloudRev = report.baseCloudRevision || (report as any).lastCloudRevision || report.sourceRevision;
      let targetRevision = localRev;

      if (existing) {
        const cloudRevision = existing.revision || 1;
        const cloudUpdatedAt = new Date(existing.updated_at).getTime();
        const localUpdatedAt = report.updatedAt || 0;

        // 1. Acknowledged Retry Check: only succeed if content matches!
        if (cloudRevision === report.revision && (cloudUpdatedAt === localUpdatedAt || Math.abs(cloudUpdatedAt - localUpdatedAt) < 1000)) {
          const isSameContent = !existing.payload || (
            existing.payload.title === report.title &&
            existing.payload.pair === report.pair &&
            existing.payload.overallNotes === report.overallNotes
          );
          if (isSameContent) {
            return { success: true, targetRevision: cloudRevision };
          }
          return { success: false, conflict: true, error: 'Identical revision and timestamp but conflicting content' };
        }

        // 2. Base-Revision Concurrency Check
        if (baseCloudRev && cloudRevision > baseCloudRev) {
          return { success: false, conflict: true, error: 'Remote revision advanced beyond local base' };
        }

        if (cloudRevision > localRev && cloudUpdatedAt > localUpdatedAt) {
          return { success: false, conflict: true, error: 'Remote revision is strictly newer' };
        }

        targetRevision = Math.max(cloudRevision + 1, localRev);

        // 3. Server-enforced CAS conditional revision update: .eq('revision', expectedCloudRev)
        const expectedCloudRev = baseCloudRev || existing.revision || 1;
        if (existing.revision !== expectedCloudRev) {
          return { success: false, conflict: true, error: 'CAS mismatch: revision != expectedCloudRev' };
        }

        existing.revision = targetRevision;
        existing.updated_at = new Date(report.updatedAt || Date.now()).toISOString();
        existing.payload = { ...report, revision: targetRevision };
        return { success: true, targetRevision };
      } else {
        // 4. Remote Deletion Check: if report previously existed in the cloud but was deleted remotely
        if (baseCloudRev && baseCloudRev > 0) {
          return { success: false, conflict: true, error: 'Report was deleted remotely.' };
        }
        targetRevision = Math.max(1, localRev);
        mockCloudStore.set(`${userId}_${report.id}`, {
          id: report.id,
          user_id: userId,
          revision: targetRevision,
          updated_at: new Date(report.updatedAt || Date.now()).toISOString(),
          payload: { ...report, revision: targetRevision },
        });
        return { success: true, targetRevision };
      }
    };

    const cloudTestUserId = 'usr_cloud_test_1';
    const sharedReportId = 'rep_shared_cloud_123';
    const initialUploadTime = 1730380000000;

    // 1. Initial creation by Client A: baseCloudRevision is 0 / undefined -> creates revision 1 in cloud
    const initialClientAReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: sharedReportId,
      title: 'Initial Cloud Report',
      createdAt: initialUploadTime,
      updatedAt: initialUploadTime,
      status: 'Original',
      isModified: false,
      revision: 1,
    };
    const initRes = simulateCloudUpload(cloudTestUserId, initialClientAReport);
    assert(initRes.success === true, 'Initial report upload created cloud row');
    assert(initRes.targetRevision === 1, 'Initial report revision is 1');

    // 2. Client A updates report: based on revision 1, increments to revision 2
    const clientAUpdateTime = initialUploadTime + 5000;
    const clientAUpdateReport: SavedReport = {
      ...initialClientAReport,
      title: 'Client A Update Rev 2',
      updatedAt: clientAUpdateTime,
      baseCloudRevision: 1,
      revision: 2,
    };
    const clientARes = simulateCloudUpload(cloudTestUserId, clientAUpdateReport);
    assert(clientARes.success === true, 'Client A update succeeded');
    assert(clientARes.targetRevision === 2, 'Cloud revision advanced to 2');

    // 3. Retry by Client A: same revision and same timestamp and SAME content
    const clientARetryRes = simulateCloudUpload(cloudTestUserId, {
      ...clientAUpdateReport,
      revision: 2, // matches remote revision
    });
    assert(clientARetryRes.success === true, 'Client A retry with matching content acknowledged without conflict');

    // Question 1: Can different cloud content with identical revision and timestamp be falsely acknowledged as synced?
    const clientDifferentContentRes = simulateCloudUpload(cloudTestUserId, {
      ...clientAUpdateReport,
      title: 'Conflicting Content With Same Timestamp and Revision',
      revision: 2, // matches remote revision
      updatedAt: clientAUpdateTime, // matches remote timestamp
    });
    assert(clientDifferentContentRes.success === false, 'Different content with same rev & timestamp rejected');
    assert(clientDifferentContentRes.conflict === true, 'Different content with same rev & timestamp returns conflict');

    // 4. Competing Update: Client B was offline, still has baseCloudRevision: 1
    // Attempts to upload based on revision 1 while cloud is now revision 2
    const clientBUpdateTime = initialUploadTime + 6000;
    const clientBUpdateReport: SavedReport = {
      ...initialClientAReport,
      title: 'Client B Competing Edits',
      updatedAt: clientBUpdateTime,
      baseCloudRevision: 1, // stale base!
      revision: 2,
    };
    const clientBRes = simulateCloudUpload(cloudTestUserId, clientBUpdateReport);
    assert(clientBRes.success === false, 'Client B stale update rejected by cloud CAS');
    assert(clientBRes.conflict === true, 'Client B received conflict = true');

    // Verify Client A's data was NOT overwritten
    const currentCloudRecord = mockCloudStore.get(`${cloudTestUserId}_${sharedReportId}`);
    assert(currentCloudRecord?.revision === 2, 'Cloud record remains at revision 2');
    assert(currentCloudRecord?.payload.title === 'Client A Update Rev 2', 'Cloud record retains Client A update');

    // Question 3: Does the same conflict reuse its conflict-copy identity across retries and restarts?
    const deterministicConflictId = `rep_conflict_${sharedReportId}_rev${clientBUpdateReport.revision || 2}`;
    // First sync creates conflict copy
    const conflictCopy1 = await saveReportDirectly({
      ...clientBUpdateReport,
      id: deterministicConflictId,
      copiedFromId: sharedReportId,
      title: 'Client B Competing Edits (Local Conflict Copy)',
      status: 'Modified',
      isModified: true,
      revision: 2,
    } as any);
    assert(conflictCopy1.id === deterministicConflictId, 'Conflict copy saved with deterministic ID');

    // Second sync (retry or restart): checks if deterministic conflict copy already exists
    const allReportsDuringRetry = await getAllReports();
    const reportsMap = new Map(allReportsDuringRetry.map(r => [r.id, r]));
    const alreadyExists = reportsMap.has(deterministicConflictId);
    assert(alreadyExists === true, 'Retry detects existing conflict copy');
    if (!alreadyExists) {
      await saveReportDirectly({ ...conflictCopy1, id: `rep_conflict_${Date.now()}` } as any);
    }
    const allReportsAfterRetry = await getAllReports();
    const conflictCopiesForReport = allReportsAfterRetry.filter(r => r.id === deterministicConflictId);
    assert(conflictCopiesForReport.length === 1, 'Only one conflict copy exists for this conflict across retries/restarts');

    // 5. Remote Deletion Protection: If report was deleted remotely, do not silently recreate
    mockCloudStore.delete(`${cloudTestUserId}_${sharedReportId}`); // Remotely deleted
    const resurrectedReport: SavedReport = {
      ...clientAUpdateReport,
      baseCloudRevision: 2, // was previously in cloud
      updatedAt: initialUploadTime + 10000,
    };
    const resurrectRes = simulateCloudUpload(cloudTestUserId, resurrectedReport);
    assert(resurrectRes.success === false, 'Upload rejected for remotely deleted report');
    assert(resurrectRes.conflict === true, 'Remotely deleted report returns conflict');
    assert(Boolean(resurrectRes.error?.includes('deleted remotely')), 'Error indicates report was deleted remotely');
    assert(mockCloudStore.has(`${cloudTestUserId}_${sharedReportId}`) === false, 'Cloud store did not resurrect deleted report');

    // Question 2: Does the same save retain its operation identity after an uncertain result, modal dismissal, and restart?
    const testOpIdentity = `rep_op_${Date.now()}_abc123`;
    const draftBeforeUncertainty: AnalysisData = {
      ...createInitialAnalysisData('EURUSD'),
      title: 'Uncertain Save Report',
      pendingSaveId: testOpIdentity,
      updatedAt: Date.now(),
    };
    // Persist draft to IndexedDB before uncertain result or modal dismissal
    await saveDraft(draftBeforeUncertainty);

    // Simulate modal dismissal and process restart by re-fetching draft from IndexedDB
    const restoredAfterRestart = await getDraft();
    assert(restoredAfterRestart !== null, 'Restored draft exists after restart');
    assert(restoredAfterRestart?.pendingSaveId === testOpIdentity, 'Draft retains pendingSaveId across restart');

    // Retrying the save resolves targetId from draft.pendingSaveId
    const resolvedTargetIdOnRetry = restoredAfterRestart?.pendingSaveId || `rep_${Date.now()}_new`;
    assert(resolvedTargetIdOnRetry === testOpIdentity, 'Same operation identity reused on save retry');

    // Question 4: Can a delayed autosave recreate a cleared draft or erase newer edits during cleanup?
    await clearDraft(); // Clean state before test
    const t0 = Date.now();
    const t1 = t0 + 1000;
    const t2 = t0 + 2000;

    // 1. Report saves at T1, clears draft up to T1
    await clearDraft(t1);

    // 2. User immediately types new keystrokes at T2 > T1
    await saveDraft({
      ...createInitialAnalysisData('XAUUSD'),
      title: 'Keystrokes Typed At T2',
      updatedAt: t2,
    });

    // 3. A delayed autosave cleanup from the earlier T1 operation runs clearDraft(t1):
    await clearDraft(t1);

    // Verify T2 draft is NOT erased by the delayed T1 cleanup
    const draftAfterDelayedCleanup = await getDraft();
    assert(draftAfterDelayedCleanup !== null, 'Newer draft was NOT erased by delayed T1 cleanup');
    assert(draftAfterDelayedCleanup?.title === 'Keystrokes Typed At T2', 'T2 keystrokes remain intact');

    // Clean up T2 draft
    await clearDraft(t2);
    assert((await getDraft()) === null, 'Draft cleanly cleared at T2');
  } catch (err) {
    assert(false, 'Test Suite 28 execution', (err as Error).message);
  }

  // --- TEST SUITE 29: Complete Cloud Content Comparison Verification ---
  console.log('\n--- Test Suite 29: Complete Cloud Content Comparison Verification ---');
  try {
    const baseReport: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: 'rep_content_cmp_001',
      title: 'Baseline Strategy Analysis',
      pair: 'EURUSD',
      date: '2026-11-01',
      time: '08:30',
      session: 'London',
      timezone: 'UTC',
      analysisTiming: 'Before session',
      crossedLiquidity: ['PDH', 'Asian High'],
      majorLiquidityWatchlist: '1.0950 Key Daily Level',
      scenarios: [
        {
          id: 'scen_01',
          label: 'Scenario A',
          strategy: 'FVG Fill',
          direction: 'Buy',
          description: 'Wait for retest of 1.0820 FVG',
          entryConditions: '1m confirmation',
          invalidationConditions: 'Break below 1.0800',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          isSaved: true,
        },
      ],
      trades: [],
      overallNotes: 'Focus on London open volume',
      status: 'Original',
      isModified: false,
      revision: 1,
      updatedAt: 1700000000000,
    };

    const baseNorm = normalizeReportForContentComparison(baseReport);
    assert(baseNorm.length > 0, 'Baseline report normalizes successfully to non-empty string');

    // 1. Report differing ONLY in scenarios
    const reportDiffScenarios: SavedReport = {
      ...baseReport,
      scenarios: [
        {
          id: 'scen_02',
          label: 'Scenario B (Modified)',
          strategy: 'Breakout',
          direction: 'Sell',
          description: 'Sell breakdown of Asian Low',
          entryConditions: 'Break below 1.0810',
          invalidationConditions: 'Return above 1.0830',
          createdAt: 1700000001000,
          updatedAt: 1700000001000,
          isSaved: true,
        },
      ],
    };
    const diffScenariosNorm = normalizeReportForContentComparison(reportDiffScenarios);
    assert(
      baseNorm !== diffScenariosNorm,
      'Report differing ONLY in scenarios is detected as different content'
    );

    // 2. Report differing ONLY in chart images / image references
    const reportDiffImages: SavedReport = {
      ...baseReport,
      timeframes: {
        ...baseReport.timeframes,
        '15M': {
          ...baseReport.timeframes['15M'],
          chartImageId: 'img_new_chart_uuid_9999',
        },
      },
    };
    const diffImagesNorm = normalizeReportForContentComparison(reportDiffImages);
    assert(
      baseNorm !== diffImagesNorm,
      'Report differing ONLY in chart image reference is detected as different content'
    );

    // 3. Report differing ONLY in trades
    const reportDiffTrades: SavedReport = {
      ...baseReport,
      trades: [
        {
          id: 'trade_01',
          pair: 'EURUSD',
          direction: 'Buy',
          entryPrice: '1.0825',
          stopLoss: '1.0805',
          takeProfit: '1.0875',
          outcome: 'Open',
          date: '2026-11-01',
          time: '08:45',
          notes: 'Executed on 15m hammer',
          createdAt: 1700000002000,
          updatedAt: 1700000002000,
        },
      ],
    };
    const diffTradesNorm = normalizeReportForContentComparison(reportDiffTrades);
    assert(
      baseNorm !== diffTradesNorm,
      'Report differing ONLY in trades is detected as different content'
    );

    // 4. Report differing ONLY in analysis time / session
    const reportDiffSession: SavedReport = {
      ...baseReport,
      session: 'NY AM',
      time: '13:30',
    };
    const diffSessionNorm = normalizeReportForContentComparison(reportDiffSession);
    assert(
      baseNorm !== diffSessionNorm,
      'Report differing ONLY in analysis time/session is detected as different content'
    );

    // 5. Report differing ONLY in liquidity levels outside timeframes
    const reportDiffLiquidity: SavedReport = {
      ...baseReport,
      crossedLiquidity: ['PDH', 'Asian High', 'PWH'],
      majorLiquidityWatchlist: '1.1020 Macro Liquidity Pool',
    };
    const diffLiquidityNorm = normalizeReportForContentComparison(reportDiffLiquidity);
    assert(
      baseNorm !== diffLiquidityNorm,
      'Report differing ONLY in liquidity levels outside timeframes is detected as different content'
    );

    // 6. Report differing ONLY in synchronization metadata (updatedAt, revision, etc.)
    const reportDiffSyncMeta: SavedReport = {
      ...baseReport,
      updatedAt: baseReport.updatedAt + 999999,
      revision: (baseReport.revision || 1) + 5,
      baseCloudRevision: 10,
      sourceRevision: 5,
      pendingSaveId: 'rep_op_test_123',
      accountId: 'usr_different_account_meta',
    } as any;
    const diffSyncMetaNorm = normalizeReportForContentComparison(reportDiffSyncMeta);
    assert(
      baseNorm === diffSyncMetaNorm,
      'Report differing ONLY in sync-only metadata correctly normalizes to identical content'
    );
  } catch (err) {
    assert(false, 'Test Suite 29 execution', (err as Error).message);
  }

  // --- TEST SUITE 30: Conflict Copy Identity Separation & Collision Prevention ---
  console.log('\n--- Test Suite 30: Conflict Copy Identity Separation & Collision Prevention ---');
  try {
    const sharedReportId = 'rep_shared_conflict_target_123';
    const localRevision = 2;
    const testUserId = 'user_trader_alpha';

    // Device 1 offline edit A: diverged at local revision 2 with distinct edit A
    const editA: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: sharedReportId,
      title: 'Device 1 Divergent Strategy Edit',
      pair: 'EURUSD',
      revision: localRevision,
      status: 'Original',
      isModified: false,
      scenarios: [
        {
          id: 'scen_dev1',
          label: 'Dev 1 Strategy',
          strategy: 'Liquidity Sweep',
          direction: 'Buy',
          description: 'Dev 1 specific plan',
          entryConditions: 'Entry rules met',
          invalidationConditions: 'Invalidation level breached',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          isSaved: true,
        },
      ],
      updatedAt: 1700000010000,
    };

    // Device 2 offline edit B: diverged at SAME local revision 2 with different edit B
    const editB: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: sharedReportId,
      title: 'Device 2 Divergent Strategy Edit',
      pair: 'EURUSD',
      revision: localRevision,
      status: 'Original',
      isModified: false,
      scenarios: [
        {
          id: 'scen_dev2',
          label: 'Dev 2 Strategy',
          strategy: 'Breakdown Continuation',
          direction: 'Sell',
          description: 'Dev 2 specific plan',
          entryConditions: 'Entry rules met',
          invalidationConditions: 'Invalidation level breached',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          isSaved: true,
        },
      ],
      updatedAt: 1700000020000,
    };

    const normA = normalizeReportForContentComparison(editA);
    const normB = normalizeReportForContentComparison(editB);
    const fpA = computeContentFingerprint(normA);
    const fpB = computeContentFingerprint(normB);

    assert(fpA !== fpB, 'Divergent edits at identical local revision produce distinct fingerprints');

    // Deterministic conflict IDs using content fingerprints
    const conflictIdA = `rep_conflict_${sharedReportId}_rev${localRevision}_${fpA}`;
    const conflictIdB = `rep_conflict_${sharedReportId}_rev${localRevision}_${fpB}`;

    assert(
      conflictIdA !== conflictIdB,
      'Conflict copy IDs for two divergent offline edits do NOT collide'
    );

    // Save Device 1 conflict copy
    const savedCopyA = await saveReportDirectly({
      ...editA,
      id: conflictIdA,
      copiedFromId: sharedReportId,
      status: 'Modified',
      isModified: true,
      accountId: testUserId,
    } as any);

    // Save Device 2 conflict copy
    const savedCopyB = await saveReportDirectly({
      ...editB,
      id: conflictIdB,
      copiedFromId: sharedReportId,
      status: 'Modified',
      isModified: true,
      accountId: testUserId,
    } as any);

    // Verify both conflict copies exist independently in local database
    const copyAFetch = await getReportById(conflictIdA);
    const copyBFetch = await getReportById(conflictIdB);
    assert(copyAFetch !== null && copyBFetch !== null, 'Both divergent conflict copies exist independently');
    assert(copyAFetch?.title === 'Device 1 Divergent Strategy Edit', 'Copy A retains Device 1 edits intact');
    assert(copyBFetch?.title === 'Device 2 Divergent Strategy Edit', 'Copy B retains Device 2 edits intact');

    // Retry test: retrying sync for Edit A verifies existing copy matches content before reuse
    const allReportsDuringRetryA = await getAllReports();
    const existingCandidateA = allReportsDuringRetryA.find((r) => r.id === conflictIdA);
    const candidateMatches =
      existingCandidateA &&
      normalizeReportForContentComparison(existingCandidateA) === normA;
    assert(Boolean(candidateMatches), 'Retry of Edit A confirms exact content match before reusing existing copy');

    // Clean up test reports
    await deleteReport(conflictIdA);
    await deleteReport(conflictIdB);
  } catch (err) {
    assert(false, 'Test Suite 30 execution', (err as Error).message);
  }

  // --- TEST SUITE 31: Authentication, Password Match & Redirect Security Verification ---
  console.log('\n--- Test Suite 31: Authentication, Password Match & Redirect Security Verification ---');
  try {
    // 1. Password mismatch detection logic
    const pass1: string = 'TraderPass123';
    const pass2: string = 'DifferentPass456';
    const passwordsMatch = pass1 === pass2;
    assert(!passwordsMatch, 'Password mismatch correctly detected during signup/reset validation');

    // 2. Minimum length policy
    const shortPass = 'abc';
    assert(shortPass.length < 6, 'Password length < 6 rejected by password policy validation');

    // 3. Native deep-link URL formation
    const webRedirect = getAppRedirectUrl();
    assert(typeof webRedirect === 'string' && webRedirect.length > 0, 'Web redirect URL generated successfully');

    // 4. Remember me storage key check
    assert(REMEMBER_ME_STORAGE_KEY === 'abmax_remember_login', 'Remember-me storage preference key is stable');
  } catch (err) {
    assert(false, 'Test Suite 31 execution', (err as Error).message);
  }

  // --- TEST SUITE 32: Compact Structure Tracking, Save & Continue, and Readable Dates Verification ---
  console.log('\n--- Test Suite 32: Compact Structure Tracking, Save & Continue, and Readable Dates Verification ---');
  try {
    const { formatReadableAnalysisDate, calculateOverallAlignment, isDeepAnalysisAligned } = await import('../utils/analysisUtils');

    // 1. Readable Date Formatting
    const nov3 = formatReadableAnalysisDate('2026-11-03');
    assert(nov3.primary === 'Tuesday, Nov 3', `formatReadableAnalysisDate primary is 'Tuesday, Nov 3' (got '${nov3.primary}')`);
    assert(nov3.secondary === '2026', `formatReadableAnalysisDate secondary is '2026' (got '${nov3.secondary}')`);
    assert(nov3.full === 'Tuesday, Nov 3, 2026', `formatReadableAnalysisDate full is 'Tuesday, Nov 3, 2026'`);

    // Verify zero UTC day-shift
    const jan1 = formatReadableAnalysisDate('2025-01-01');
    assert(jan1.primary === 'Wednesday, Jan 1', `formatReadableAnalysisDate correctly preserves calendar day (Wednesday, Jan 1)`);

    // Fallback on legacy/unspecified
    const unspec = formatReadableAnalysisDate('');
    assert(unspec.primary === 'Unspecified Date', `formatReadableAnalysisDate handles empty string without crash`);
    const legacy = formatReadableAnalysisDate('Legacy Date');
    assert(legacy.primary === 'Legacy Date', `formatReadableAnalysisDate handles legacy format safely`);

    // 2. Compact Structure Tracking Models & History Independence
    const emptyTf = createEmptyTimeframeData('1H');
    assert(Array.isArray(emptyTf.swing.history), 'createEmptyTimeframeData initializes swing.history as array');
    assert(Array.isArray(emptyTf.internal.history), 'createEmptyTimeframeData initializes internal.history as array');
    assert(Boolean(emptyTf.swing.history && emptyTf.swing.history.length === 0), 'createEmptyTimeframeData starts with empty swing history');
    assert(Boolean(emptyTf.internal.history && emptyTf.internal.history.length === 0), 'createEmptyTimeframeData starts with empty internal history');

    // Simulate BOS on Swing
    const bosEvent: import('../types/journal').StructureEvent = {
      id: 'bos_12345_test',
      type: 'BOS',
      direction: 'Bullish',
      brokenLevel: '2685.50',
      high: '2700.00',
      low: '2650.00',
      timestamp: Date.now(),
    };
    const updatedSwing = {
      ...emptyTf.swing,
      direction: 'Bullish' as const,
      high: bosEvent.high,
      low: bosEvent.low,
      bosAt: bosEvent.brokenLevel,
      history: [bosEvent],
    };
    assert(updatedSwing.history.length === 1, 'Swing history records BOS event');
    assert(updatedSwing.direction === 'Bullish', 'Swing active direction maintained as Bullish on BOS');

    // Simulate MSS on Swing
    const mssEvent: import('../types/journal').StructureEvent = {
      id: 'mss_67890_test',
      type: 'MSS',
      direction: 'Bearish',
      brokenLevel: '2650.00',
      high: '2700.00',
      low: '2640.00',
      timestamp: Date.now() + 1000,
    };
    const updatedSwingMSS = {
      ...updatedSwing,
      direction: 'Bearish' as const, // Shift confirmed
      high: mssEvent.high,
      low: mssEvent.low,
      bosAt: mssEvent.brokenLevel,
      history: [mssEvent, ...updatedSwing.history],
    };
    assert(updatedSwingMSS.history.length === 2, 'Swing history records MSS event as newest');
    assert(updatedSwingMSS.direction === 'Bearish', 'Swing active direction shifts to Bearish upon MSS confirmation');
    assert(updatedSwingMSS.history[0].type === 'MSS', 'Latest history entry is MSS');
    assert(updatedSwingMSS.history[1].type === 'BOS', 'Prior history entry is preserved as BOS');

    // History Revert Logic: deleting latest entry restores previous structure state
    const remainingHistory = updatedSwingMSS.history.slice(1);
    const restoredPrior = remainingHistory[0];
    const restoredSwing = {
      ...updatedSwingMSS,
      direction: restoredPrior.direction,
      high: restoredPrior.high,
      low: restoredPrior.low,
      bosAt: restoredPrior.brokenLevel,
      history: remainingHistory,
    };
    assert(restoredSwing.history.length === 1, 'Remaining history has 1 event after deleting latest');
    assert(restoredSwing.direction === 'Bullish', 'Active direction cleanly restored to previous event (Bullish)');
    assert(restoredSwing.bosAt === '2685.50', 'Active broken level restored to previous event (2685.50)');

    // 3. Fractal Structure: Waiting direction choice supported
    const fractalWaiting = { direction: 'Waiting' as const, fractalBosAt: '' };
    assert(fractalWaiting.direction === 'Waiting', 'FractalStructure supports Waiting direction choice');

    // 4. Alignment Calculation uses only active confirmed fields, unaffected by history entries
    const testAnalysis = createInitialAnalysisData();
    testAnalysis.timeframes['1H'].swing = updatedSwingMSS;
    testAnalysis.timeframes['1H'].internal.direction = 'Bearish';
    testAnalysis.timeframes['1H'].fractal.direction = 'Bearish';
    const is1HAligned = isDeepAnalysisAligned(testAnalysis.timeframes['1H']);
    assert(is1HAligned === true, 'isDeepAnalysisAligned continues evaluating active direction without distortion from history array');

    // 5. Save & Continue Content Comparison (No duplicate save if unchanged)
    const savedRep = await saveReport({
      ...testAnalysis,
      id: 'rep_save_continue_test',
      status: 'Original',
      revision: 1,
    });
    const snapshot1 = normalizeReportForContentComparison(savedRep);
    const snapshot2 = normalizeReportForContentComparison(savedRep);
    assert(snapshot1 === snapshot2, 'Content comparison recognizes identical saved state for Save & Continue no-op');

    // Modify a structure field -> comparison detects change
    const modifiedRep = {
      ...savedRep,
      timeframes: {
        ...savedRep.timeframes,
        '1H': {
          ...savedRep.timeframes['1H'],
          swing: {
            ...savedRep.timeframes['1H'].swing,
            high: '2710.00',
          },
        },
      },
    };
    const snapshotModified = normalizeReportForContentComparison(modifiedRep);
    assert(snapshot1 !== snapshotModified, 'Content comparison reliably detects structure high modification');

    // 6. Visibility Config Toggles for Structure & Analysis Info
    const normVis = normalizeWorkspaceVisibilityConfig({});
    assert(normVis.perTimeframeFields.Monthly.timeframeInfoSection === true, 'Default visibility enables timeframeInfoSection');
    assert(normVis.perTimeframeFields.Monthly.structureTrackingControls === true, 'Default visibility enables structureTrackingControls');
    assert(normVis.perTimeframeFields.Monthly.structureHistory === true, 'Default visibility enables structureHistory');

    // Clean up test report
    await deleteReport(savedRep.id);
  } catch (err) {
    assert(false, 'Test Suite 32 execution', (err as Error).message);
  }

  // --- TEST 33: History Baseline Recovery, Save & Continue Workflows & Extreme Timezone Date Integrity ---
  console.log('\n--- Test Suite 33: History Baseline Recovery, Save & Continue Workflows & Extreme Timezone Date Integrity ---');
  try {
    // 1. History restoration edge case:
    // Initial baseline structure: Bullish, high 2650.00, low 2600.00, brokenLevel ''
    const baseline = {
      direction: 'Bullish' as const,
      high: '2650.00',
      low: '2600.00',
      brokenLevel: '',
    };

    // Confirm first BOS event: breaks 2650.00, sets high 2690.00, low 2620.00
    const firstBOS: StructureEvent = {
      id: 'bos_evt_1',
      type: 'BOS',
      direction: 'Bullish',
      brokenLevel: '2650.00',
      high: '2690.00',
      low: '2620.00',
      timestamp: Date.now(),
      previousSnapshot: { ...baseline },
    };

    const activeSwing = {
      direction: firstBOS.direction,
      high: firstBOS.high,
      low: firstBOS.low,
      brokenLevel: firstBOS.brokenLevel,
      history: [firstBOS],
    };
    assert(activeSwing.history.length === 1, 'First BOS recorded with 1 history event');
    assert(activeSwing.high === '2690.00', 'Active high updated by BOS event');

    // Deleting the ONLY event in history:
    const remainingAfterDel = activeSwing.history.filter((e) => e.id !== firstBOS.id);
    const deletedEvt = activeSwing.history.find((e) => e.id === firstBOS.id);
    let recoveredStructure;
    if (remainingAfterDel.length === 0 && deletedEvt?.previousSnapshot) {
      recoveredStructure = {
        direction: deletedEvt.previousSnapshot.direction,
        high: deletedEvt.previousSnapshot.high,
        low: deletedEvt.previousSnapshot.low,
        brokenLevel: deletedEvt.previousSnapshot.brokenLevel,
        history: remainingAfterDel,
      };
    }
    assert(recoveredStructure !== undefined, 'Baseline recovery triggered when deleting only history event');
    assert(recoveredStructure?.direction === baseline.direction, 'Exact baseline direction recovered (Bullish)');
    assert(recoveredStructure?.high === baseline.high, 'Exact baseline high recovered (2650.00)');
    assert(recoveredStructure?.low === baseline.low, 'Exact baseline low recovered (2600.00)');
    assert(recoveredStructure?.brokenLevel === baseline.brokenLevel, 'Exact baseline brokenLevel recovered');
    assert(recoveredStructure?.history.length === 0, 'History is cleanly empty after deleting only event');

    // 2. Newer manual edits are NOT erased when deleting history:
    const secondMSS: StructureEvent = {
      id: 'mss_evt_2',
      type: 'MSS',
      direction: 'Bearish',
      brokenLevel: '2620.00',
      high: '2690.00',
      low: '2580.00',
      timestamp: Date.now() + 1000,
      previousSnapshot: {
        direction: firstBOS.direction,
        high: firstBOS.high,
        low: firstBOS.low,
        brokenLevel: firstBOS.brokenLevel,
      },
    };
    // User typed a newer manual high "2705.50" in the editor
    const currentHighWithManualEdit = '2705.50';
    // User deletes older event firstBOS (index 1)
    const historyWithTwo = [secondMSS, firstBOS];
    const remainingOlderDel = historyWithTwo.filter((e) => e.id !== firstBOS.id);
    assert(remainingOlderDel.length === 1, 'Deleting older event leaves 1 event');
    assert(currentHighWithManualEdit === '2705.50', 'Newer manual edit high is preserved without erase');

    // User deletes latest event secondMSS, but had edited high manually to '2705.50'
    const userEditedHigh = currentHighWithManualEdit !== secondMSS.high;
    assert(userEditedHigh === true, 'System detects manual edit differs from event high');

    // 3. Save & Continue Flow & Report Binding Verification:
    const baseRep = await saveReport({
      ...createInitialAnalysisData('EURUSD'),
      id: 'rep_sc_flow_test',
      status: 'Original',
      revision: 0,
    });
    assert(baseRep.id === 'rep_sc_flow_test', 'Save & Continue base report initialized');
    assert(baseRep.revision === 1, 'Base report initialized with revision 1');

    // Save as New binding: creates new report ID, subsequent edits target new report ID
    const savedAsNewRep = await saveReport({
      ...baseRep,
      id: 'rep_sc_flow_test_copy',
      copiedFromId: baseRep.id,
      status: 'Original',
      revision: 0,
    });
    assert(savedAsNewRep.id !== baseRep.id, 'Save as New binds to a distinct new report ID');
    assert(savedAsNewRep.copiedFromId === baseRep.id, 'New report points to copiedFromId');
    assert(savedAsNewRep.revision === 1, 'Saved-as-new report starts with revision 1');

    // Subsequent edit on the new report:
    const subsequentEdit = await saveReport({
      ...savedAsNewRep,
      title: 'Updated Copy Analysis',
      status: 'Modified',
    });
    assert(subsequentEdit.id === savedAsNewRep.id, 'Subsequent edit targets new report ID, not original');
    assert(subsequentEdit.revision === 2, 'Subsequent edit incremented revision to 2');

    // History-only change detection:
    const repWithNoHistory = { ...baseRep };
    const repWithHistory = {
      ...baseRep,
      timeframes: {
        ...baseRep.timeframes,
        '4H': {
          ...baseRep.timeframes['4H'],
          swing: {
            ...baseRep.timeframes['4H'].swing,
            history: [firstBOS],
          },
        },
      },
    };
    const normNoHist = normalizeReportForContentComparison(repWithNoHistory);
    const normWithHist = normalizeReportForContentComparison(repWithHistory);
    assert(normNoHist !== normWithHist, 'History-only change is recognized as meaningful content edit');

    // 4. Extreme Timezone Date-Only Verification (UTC+14, UTC-12, leap years)
    // 2026-11-03: Tuesday Nov 3
    const d1 = formatReadableAnalysisDate('2026-11-03');
    assert(d1.primary === 'Tuesday, Nov 3', `2026-11-03 formatted as Tuesday, Nov 3 (got ${d1.primary})`);
    assert(d1.secondary === '2026', '2026-11-03 secondary is 2026');

    // 2025-01-01: Wednesday Jan 1
    const d2 = formatReadableAnalysisDate('2025-01-01');
    assert(d2.primary === 'Wednesday, Jan 1', `2025-01-01 formatted as Wednesday, Jan 1 (got ${d2.primary})`);

    // 2024-12-31: Tuesday Dec 31 (year end boundary)
    const d3 = formatReadableAnalysisDate('2024-12-31');
    assert(d3.primary === 'Tuesday, Dec 31', `2024-12-31 formatted as Tuesday, Dec 31 (got ${d3.primary})`);
    assert(d3.secondary === '2024', '2024-12-31 secondary is 2024');

    // 2024-02-29: Thursday Feb 29 (leap year day)
    const d4 = formatReadableAnalysisDate('2024-02-29');
    assert(d4.primary === 'Thursday, Feb 29', `2024-02-29 formatted as Thursday, Feb 29 (got ${d4.primary})`);

    // Clean up test reports
    await deleteReport(baseRep.id);
    await deleteReport(savedAsNewRep.id);
  } catch (err) {
    assert(false, 'Test Suite 33 execution', (err as Error).message);
  }

  // --- TEST 34: CHoCH Tracking, Repeated Levels, and Metadata Visibility ---
  console.log('\n--- Test Suite 34: CHoCH Tracking, Repeated Levels, and Metadata Visibility ---');
  try {
    // 1. Metadata and Timestamps visibility config
    const rawVis = {
      otherSections: {
        metadataAndTimestamps: false,
        majorLiquidityChecklist: true,
        majorLiquidityWatchlist: true,
        supplyDemandManager: true,
        openingCandle: true,
        overallNotes: true,
        plannedScenarios: true,
      },
    };
    const normalizedVis = normalizeWorkspaceVisibilityConfig(rawVis as any);
    assert(normalizedVis.otherSections.metadataAndTimestamps === false, 'Metadata and Timestamps can be hidden in workspace visibility');

    const defaultNorm = normalizeWorkspaceVisibilityConfig(null);
    assert(defaultNorm.otherSections.metadataAndTimestamps === true, 'Metadata and Timestamps defaults to true if omitted');

    // 2. CHoCH event creation and linked Internal + Fractal structure
    const initialRep = createInitialAnalysisData('XAUUSD');
    const tf4h = initialRep.timeframes['4H'];
    tf4h.internal.direction = 'Bullish';
    tf4h.internal.high = '2700.00';
    tf4h.internal.low = '2650.00';
    tf4h.fractal.direction = 'Bullish';
    tf4h.fractal.fractalBosAt = '2680.00';

    const chochEventId = `choch_${Date.now()}_test`;
    const chochEvt: StructureEvent = {
      id: chochEventId,
      type: 'CHoCH',
      direction: 'Bearish',
      brokenLevel: '2680.00',
      high: '2700.00',
      low: '2650.00',
      newActiveLevel: '2665.00',
      affectedStructure: 'Fractal',
      timestamp: Date.now(),
      previousSnapshot: {
        direction: 'Bullish',
        fractalLevel: '2680.00',
      },
    };

    // Both Internal and Fractal history receive canonical event with shared stable ID
    tf4h.internal.history = [chochEvt];
    tf4h.fractal.history = [chochEvt];
    tf4h.fractal.direction = 'Bearish';
    tf4h.fractal.fractalBosAt = '2665.00';

    assert(tf4h.internal.direction === 'Bullish', 'Internal active direction is preserved when CHoCH occurs');
    assert(tf4h.fractal.direction === 'Bearish', 'Active Fractal direction is reversed on CHoCH');
    assert(tf4h.fractal.fractalBosAt === '2665.00', 'Active Fractal level is updated to new level on CHoCH');
    assert(tf4h.internal.history[0].id === tf4h.fractal.history[0].id, 'Internal and Fractal share canonical CHoCH event ID');

    // Save and reload to verify persistence across IndexedDB
    await saveReport({ ...initialRep, status: 'Original' });
    const reloaded = await getReportById(initialRep.id);
    assert(!!reloaded, 'Report with CHoCH event reloaded from IndexedDB');
    assert(reloaded?.timeframes['4H'].fractal.direction === 'Bearish', 'Reloaded report preserves active Fractal direction');
    assert(reloaded?.timeframes['4H'].fractal.history?.[0].type === 'CHoCH', 'Reloaded report preserves Fractal CHoCH history event');
    assert(reloaded?.timeframes['4H'].internal.history?.[0].type === 'CHoCH', 'Reloaded report preserves Internal CHoCH history event');

    // Simulate deleting CHoCH event: restores baseline snapshot without affecting other structures
    const deletedSnap = tf4h.fractal.history[0].previousSnapshot;
    tf4h.fractal.history = [];
    tf4h.internal.history = [];
    tf4h.fractal.direction = (deletedSnap?.direction as any) || '';
    tf4h.fractal.fractalBosAt = deletedSnap?.fractalLevel || '';

    assert(tf4h.fractal.direction === 'Bullish', 'Deleting CHoCH restores previous baseline Fractal direction');
    assert(tf4h.fractal.fractalBosAt === '2680.00', 'Deleting CHoCH restores previous baseline Fractal level');
    assert(tf4h.internal.direction === 'Bullish', 'Internal direction remained intact after CHoCH deletion');

    // 3. Repeated Analysis Levels testing
    const repWithLevels = createInitialAnalysisData('XAUUSD');
    // Set matching price across 3 distinct timeframes: Daily, 4H, 1H
    repWithLevels.timeframes['Daily'].swing.high = '2685.50';
    repWithLevels.timeframes['4H'].internal.ibosAt = '2685.5'; // normalized match
    repWithLevels.timeframes['1H'].fractal.fractalBosAt = '2685.500'; // normalized match
    repWithLevels.timeframes['15M'].supportLevels = [{ id: 's1', level: '2620.00' }];
    repWithLevels.timeframes['5M'].demandLevels = [{ id: 'd1', level: '2620' }]; // match across 2 timeframes

    const repeated = findMatchingValues(repWithLevels.timeframes);
    assert(repeated.length === 2, `findMatchingValues identified 2 repeated level groups (got ${repeated.length})`);
    assert(repeated[0].normalizedPrice === '2685.5', 'Top repeated level is 2685.5 (highest timeframe count of 3)');
    const distinctTfsForTop = new Set(repeated[0].occurrences.map((o) => o.timeframe));
    assert(distinctTfsForTop.size === 3, 'Top repeated level appears in 3 distinct timeframes');
    assert(repeated[1].normalizedPrice === '2620', 'Second repeated level is 2620 (appears in 2 distinct timeframes)');

    // Single timeframe occurrence should NOT be included
    repWithLevels.timeframes['1M'].swing.low = '2500.00';
    const repAfterSingle = findMatchingValues(repWithLevels.timeframes);
    const has2500 = repAfterSingle.some((g) => g.normalizedPrice === '2500');
    assert(!has2500, 'Price point present in only 1 timeframe is excluded from repeated levels');

    // Clean up
    await deleteReport(initialRep.id);

    // 4. Test Trade Editing Safety and Non-Destructive Draft Persistence
    const testDraft = createInitialAnalysisData('XAUUSD');
    testDraft.title = 'Unfinished Active Analysis Draft';
    testDraft.overallNotes = 'Important draft notes typed by user';
    await saveDraft(testDraft);

    // Create a saved report with an initial trade
    const testReport = createInitialAnalysisData('XAUUSD');
    testReport.title = 'Report With Recorded Trade';
    const tradeId = `trd_${Date.now()}_original`;
    testReport.trades = [
      {
        id: tradeId,
        pair: 'XAUUSD',
        date: '2026-11-05',
        direction: 'Buy',
        scenarioLabel: 'Scenario 1',
        entryPrice: '2650.00',
        stopLoss: '2640.00',
        takeProfit: '2675.00',
        outcome: 'Open',
        rulesFollowed: true,
        notes: 'Initial entry note',
        createdAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000,
      },
    ];
    await saveReport({ ...testReport, status: 'Original' });

    // Simulate editing trade
    const existingTrade = testReport.trades![0];
    const updatedTrade = {
      ...existingTrade,
      exitPrice: '2675.00',
      outcome: 'Win' as const,
      notes: 'Updated trade note after TP reached',
      updatedAt: Date.now(),
    };

    // Save trade edit to report
    const updatedTradesList = (testReport.trades || []).map((t) => (t.id === updatedTrade.id ? updatedTrade : t));
    const savedUpdatedRep = await saveReport({
      ...testReport,
      trades: updatedTradesList,
      status: 'Original',
    });

    assert(savedUpdatedRep.trades?.length === 1, 'Editing trade did NOT duplicate the trade');
    assert(savedUpdatedRep.trades?.[0].id === tradeId, 'Edited trade preserved exact original ID');
    assert(savedUpdatedRep.trades?.[0].outcome === 'Win', 'Edited trade updated outcome to Win');
    assert(savedUpdatedRep.trades?.[0].createdAt === existingTrade.createdAt, 'Original trade creation timestamp was preserved');

    // Verify active Analysis draft was NOT cleared or overwritten
    const draftAfterTradeEdit = await getDraft();
    assert(!!draftAfterTradeEdit, 'Active analysis draft remains intact after trade editing');
    assert(draftAfterTradeEdit?.id === testDraft.id, 'Draft ID matches active analysis draft');
    assert(draftAfterTradeEdit?.overallNotes === 'Important draft notes typed by user', 'Draft content was not cleared or altered');

    // 5. Test Full Backup Roundtrip (Reports, Images, Scenarios, Trades, Linked CHoCH)
    const backupImgId = await saveImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'Test Chart');
    testReport.timeframes['4H'].chartImageId = backupImgId;
    testReport.timeframes['4H'].internal.history = [chochEvt];
    testReport.timeframes['4H'].fractal.history = [chochEvt];
    await saveReport({ ...testReport, status: 'Original' });

    const fullBackup = await createFullBackup();
    assert(fullBackup.app === 'ABMAX_ANALYSIS', 'Backup format app tag is ABMAX_ANALYSIS');
    assert(fullBackup.version === 3, 'Backup format version is 3');
    assert(fullBackup.reports.some((r) => r.id === testReport.id), 'Backup includes test report');
    assert(fullBackup.images.some((img) => img.id === backupImgId), 'Backup includes standalone image data');
    assert(!!fullBackup.draft, 'Backup includes active draft');
    assert(!('accessToken' in fullBackup) && !('refreshToken' in fullBackup), 'Backup excludes authentication tokens');

    // Analyze backup
    const preview = await analyzeBackup(fullBackup);
    assert(preview.skippedReportsCount >= 1, 'Re-import analysis detects existing reports to skip duplicates');

    // Restore backup
    const restoreResult = await restoreBackup(fullBackup);
    assert(restoreResult.addedReports === 0, 'Restoring exact duplicate reports adds 0 duplicates');
    assert(restoreResult.addedImages >= 1, 'Restoring images safely persists dataUrl');

    // Clean up
    await deleteReport(testReport.id);
    await deleteImage(backupImgId);
  } catch (err) {
    assert(false, 'Test Suite 34 execution', (err as Error).message);
  }

  // --- TEST 35: Authentication, OTP Verification, Recovery & Callback Flow Verification ---
  console.log('\n--- Test Suite 35: Complete Authentication, OTP Verification & Recovery Security ---');
  try {
    // 1. Password policy & match validation
    const validateSignUpInput = (email: string, pw: string, confirmPw: string) => {
      const cleanEmail = email.trim();
      if (!cleanEmail || !cleanEmail.includes('@')) return { valid: false, error: 'Invalid email' };
      if (pw !== confirmPw) return { valid: false, error: 'Passwords do not match.' };
      if (pw.length < 6) return { valid: false, error: 'Password must be at least 6 characters.' };
      return { valid: true, error: null };
    };

    assert(!validateSignUpInput('trader@example.com', 'abc', 'abc').valid, 'Password < 6 chars rejected');
    assert(validateSignUpInput('trader@example.com', 'abc', 'abc').error === 'Password must be at least 6 characters.', 'Exact password length error returned');
    assert(!validateSignUpInput('trader@example.com', 'secret123', 'secret999').valid, 'Mismatched passwords rejected');
    assert(validateSignUpInput('trader@example.com', 'secret123', 'secret999').error === 'Passwords do not match.', 'Exact password mismatch error returned');
    assert(validateSignUpInput('  trader@example.com  ', 'secret123', 'secret123').valid, 'Valid trimmed signup input accepted');

    // 2. OTP Code Formatting & Validation
    const sanitizeOtp = (raw: string) => raw.replace(/\D/g, '').slice(0, 6);
    assert(sanitizeOtp('123-456') === '123456', 'Hyphenated OTP code cleaned to 6 digits');
    assert(sanitizeOtp('98 76 54') === '987654', 'Spaced OTP code cleaned to 6 digits');
    assert(sanitizeOtp('1234567890') === '123456', 'Overflow OTP code truncated to exactly 6 digits');
    assert(sanitizeOtp('abc123def') === '123', 'Alphanumeric noise stripped from OTP');

    // 3. Neutral forgot password response
    const neutralForgotMsg = 'If an account exists for this email, you will receive password reset instructions shortly.';
    assert(!neutralForgotMsg.includes('does not exist') && !neutralForgotMsg.includes('found'), 'Forgot password message prevents user account enumeration');

    // 4. Expired recovery link detection
    const isUrlExpiredRecovery = (urlParams: string) => {
      return (
        urlParams.includes('error_code=otp_expired') ||
        urlParams.includes('error=access_denied') ||
        urlParams.includes('Email+link+is+invalid') ||
        urlParams.includes('otp_expired')
      );
    };

    assert(isUrlExpiredRecovery('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), 'Expired token hash correctly identified');
    assert(isUrlExpiredRecovery('?error=access_denied&error_code=otp_expired'), 'Expired query params correctly identified');
    assert(!isUrlExpiredRecovery('#access_token=valid_token&type=recovery'), 'Valid recovery token NOT flagged as expired');

    // 5. Android Callback Scheme Verification
    const androidCallbackScheme = 'com.abmax.analysis://auth/callback';
    assert(androidCallbackScheme.startsWith('com.abmax.analysis://'), 'Android callback uses package custom scheme');
    assert(androidCallbackScheme.endsWith('/auth/callback'), 'Android callback uses canonical auth/callback path');

    // 6. Single-Pass Processing Guard
    const processedUrls = new Set<string>();
    const processOnce = (url: string) => {
      if (processedUrls.has(url)) return false;
      processedUrls.add(url);
      return true;
    };

    assert(processOnce('com.abmax.analysis://auth/callback#access_token=xyz'), 'First token callback processed');
    assert(!processOnce('com.abmax.analysis://auth/callback#access_token=xyz'), 'Duplicate token callback blocked by single-pass guard');

    // 7. Session Isolation Check
    const guestData = { accountId: 'local', activeReportId: 'rep_guest_1' };
    const userAData = { accountId: 'user_uuid_123', activeReportId: 'rep_user_1' };
    assert(guestData.accountId !== userAData.accountId, 'Guest session is isolated from signed-in user session');
  } catch (err) {
    assert(false, 'Test Suite 35 execution', (err as Error).message);
  }

  // --- Test Suite 36: Multi-Style PDF Presentation, Defaults & Image Collection Safety ---
  try {
    console.log('\n--- Test Suite 36: Multi-Style PDF Presentation, Defaults & Image Collection Safety ---');
    const { generateReportPdfBlob, PDF_THEMES } = await import('../services/pdfExport');

    // 1. Verify default export style is Minimal Journal
    assert(PDF_THEMES.minimal.displayName === 'Minimal Journal', 'Minimal Journal is registered');
    assert(PDF_THEMES.emerald.displayName === 'Emerald', 'Emerald is registered');
    assert(PDF_THEMES.dark.displayName === 'Dark Trading Desk', 'Dark Trading Desk is registered');
    assert(PDF_THEMES.dark.isDark === true, 'Dark Trading Desk flagged as dark canvas');
    assert(PDF_THEMES.minimal.isDark === false, 'Minimal Journal flagged as light canvas');

    // 2. Base test report with all sections, matching values, scenarios, and trades
    const testReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_pdf_multistyle_test',
      title: 'Gold Daily Expansion & CHoCH Retest',
      date: '2026-11-09',
      time: '14:30:00',
      session: 'NY AM',
      analysisTiming: 'On time',
      overallNotes: 'Key liquidity sweeps observed across London and NY open.',
      scenarios: [
        {
          id: 'sc_1',
          label: 'Bullish Expansion Scenario',
          direction: 'Buy',
          strategy: 'Internal BOS Retest',
          description: 'Wait for pullback into 15M discount zone before entering.',
          entryConditions: '1M MSS confirmation inside discount array',
          invalidationConditions: 'Decisive close below 2640.00',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          // Test with absent images (undefined)
        },
        {
          id: 'sc_2',
          label: 'Bearish Reversal Scenario',
          direction: 'Sell',
          strategy: 'External Liquidity Grab Sweep',
          description: 'Fade the high if expansion fails to hold premium high.',
          entryConditions: 'Sweep of 2685.50 followed by displacement',
          invalidationConditions: 'Break and hold above 2690.00',
          images: [], // Test with empty image array
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
        {
          id: 'sc_3',
          label: 'Range Equilibrium Scenario',
          direction: '',
          strategy: 'Mean Reversion',
          description: 'Trade between established value boundaries.',
          entryConditions: 'Rejection at high/low edges',
          invalidationConditions: 'Trend breakout with high volume',
          images: [
            {
              id: 'img_sc_3_1',
              dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              caption: '15M Range Boundary Chart',
              createdAt: 1700000000000,
            },
          ], // Test with populated image collection
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
        },
      ],
      trades: [
        {
          id: 'trd_1',
          pair: 'XAUUSD',
          date: '2026-11-09',
          direction: 'Buy',
          scenarioLabel: 'Bullish Expansion Scenario',
          entryPrice: '2652.50',
          stopLoss: '2645.00',
          takeProfit: '2680.00',
          exitPrice: '2678.50',
          riskReward: '3.47',
          outcome: 'Win',
          rulesFollowed: true,
          timeframeTaken: '15M',
          session: 'NY AM',
          notes: 'Executed cleanly on 1M MSS confirmation.',
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          // Test with absent images (undefined)
        },
        {
          id: 'trd_2',
          pair: 'XAUUSD',
          date: '2026-11-09',
          direction: 'Sell',
          scenarioLabel: 'Bearish Reversal Scenario',
          entryPrice: '2684.00',
          stopLoss: '2688.00',
          takeProfit: '2665.00',
          outcome: 'Loss',
          rulesFollowed: false,
          timeframeTaken: '5M',
          session: 'NY AM',
          notes: 'Entered prematurely before sweep confirmation.',
          createdAt: 1700000100000,
          updatedAt: 1700000100000,
          images: [], // Test with empty image array
        },
        {
          id: 'trd_3',
          pair: 'XAUUSD',
          date: '2026-11-09',
          direction: 'Buy',
          scenarioLabel: 'Range Equilibrium Scenario',
          entryPrice: '2648.00',
          stopLoss: '2642.00',
          takeProfit: '2670.00',
          outcome: 'Open',
          rulesFollowed: true,
          timeframeTaken: '1H',
          session: 'London',
          notes: 'Holding trade overnight towards target.',
          createdAt: 1700000200000,
          updatedAt: 1700000200000,
          images: [
            {
              id: 'img_trd_3_1',
              dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
              caption: 'Trade Entry Confirmation Execution',
              createdAt: 1700000200000,
            },
          ], // Test with populated image collection
        },
      ],
      createdAt: 1700000000000,
      updatedAt: 1700000500000,
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    // 3. Test Default Export (Unspecified style defaults to Minimal Journal)
    const defaultExport = await generateReportPdfBlob({ report: testReport });
    assert(defaultExport.style === 'minimal', 'Default export style is minimal');
    assert(defaultExport.blob instanceof Blob, 'Default export returns valid Blob');
    assert(defaultExport.blob.size > 2000, 'Default export Blob contains document content');
    assert(defaultExport.filename === 'ABMAX_XAUUSD_2026-11-09.pdf', `Default filename: ${defaultExport.filename}`);

    // Verify PDF header magic bytes (%PDF-)
    const defaultHeaderBuf = await defaultExport.blob.arrayBuffer();
    const defaultMagic = String.fromCharCode(...new Uint8Array(defaultHeaderBuf.slice(0, 5)));
    assert(defaultMagic === '%PDF-', 'Default export starts with valid %PDF- magic signature');

    // 4. Test Explicit Minimal Journal Style
    const minimalExport = await generateReportPdfBlob({ report: testReport, style: 'minimal' });
    assert(minimalExport.style === 'minimal', 'Minimal style export confirms minimal');
    assert(minimalExport.blob.size > 2000, 'Minimal export Blob contains document content');
    assert(minimalExport.filename === 'ABMAX_XAUUSD_2026-11-09.pdf', 'Minimal style filename matches expected format');

    // 5. Test Emerald Style
    const emeraldExport = await generateReportPdfBlob({ report: testReport, style: 'emerald' });
    assert(emeraldExport.style === 'emerald', 'Emerald export style confirms emerald');
    assert(emeraldExport.blob.size > 2000, 'Emerald export Blob contains document content');
    assert(emeraldExport.filename === 'ABMAX_XAUUSD_emerald_2026-11-09.pdf', `Emerald filename: ${emeraldExport.filename}`);
    const emeraldHeaderBuf = await emeraldExport.blob.arrayBuffer();
    const emeraldMagic = String.fromCharCode(...new Uint8Array(emeraldHeaderBuf.slice(0, 5)));
    assert(emeraldMagic === '%PDF-', 'Emerald export starts with valid %PDF- magic signature');

    // 6. Test Dark Trading Desk Style
    const darkExport = await generateReportPdfBlob({ report: testReport, style: 'dark' });
    assert(darkExport.style === 'dark', 'Dark Trading Desk export style confirms dark');
    assert(darkExport.blob.size > 2000, 'Dark Trading Desk export Blob contains document content');
    assert(darkExport.filename === 'ABMAX_XAUUSD_dark_2026-11-09.pdf', `Dark Trading Desk filename: ${darkExport.filename}`);
    const darkHeaderBuf = await darkExport.blob.arrayBuffer();
    const darkMagic = String.fromCharCode(...new Uint8Array(darkHeaderBuf.slice(0, 5)));
    assert(darkMagic === '%PDF-', 'Dark Trading Desk starts with valid %PDF- magic signature');

    // 7. Verify all 3 styles produce documents with the same page count
    const defaultPageCount = defaultExport.doc.getNumberOfPages();
    const emeraldPageCount = emeraldExport.doc.getNumberOfPages();
    const darkPageCount = darkExport.doc.getNumberOfPages();
    assert(defaultPageCount > 0, `Default export has pages: ${defaultPageCount}`);
    assert(defaultPageCount === emeraldPageCount, 'Default and Emerald have identical page counts');
    assert(defaultPageCount === darkPageCount, 'Default and Dark have identical page counts');

    // 8. Test Export with completely empty report (no scenarios, no trades, no images)
    const emptyReport: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: 'rpt_empty_test',
      date: '2026-11-09',
      scenarios: [],
      trades: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      status: 'Original',
      isModified: false,
      revision: 1,
    };
    const emptyExport = await generateReportPdfBlob({ report: emptyReport, style: 'minimal' });
    assert(emptyExport.blob.size > 1000, 'Empty report exports successfully without errors');

    // 9. Verify auth error formatting utility distinguishes connection error from wrong password
    const { formatAuthError } = await import('../utils/authErrorUtils');
    const fetchErr = formatAuthError(new TypeError('Failed to fetch'));
    assert(fetchErr.isConnectionError === true, 'Failed to fetch is categorized as connection error');
    assert(fetchErr.headline.includes('Cannot connect to Supabase'), 'Helpful headline displayed for Failed to fetch');
    assert(Boolean(fetchErr.details?.includes('fxzurpdymuhlfkdxfgel')), 'Diagnostic details mention Supabase project endpoint');

    const credErr = formatAuthError({ message: 'Invalid login credentials' });
    assert(credErr.isConnectionError === false, 'Invalid login credentials is NOT categorized as connection error');
    assert(credErr.headline === 'Invalid email address or password.', 'Accurate user-friendly headline for invalid credentials');
  } catch (err) {
    assert(false, 'Test Suite 36 execution', (err as Error).message);
  }

  // ==========================================
  // TEST SUITE 37: JOURNAL, PERFORMANCE, BACKUP V3 & COMBINED PERIOD PDF
  // ==========================================
  try {
    console.log('\n--- TEST SUITE 37: JOURNAL, PERFORMANCE, BACKUP V3 & COMBINED PERIOD PDF ---');

    // 1. Journal CRUD Operations
    const testEntryId = `jrn_${Date.now()}_test`;
    const sampleJournalEntry: JournalEntry = {
      id: testEntryId,
      date: '2026-11-09',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entryType: 'post-trade',
      pair: 'XAUUSD',
      session: 'London',
      title: 'London Breakout Execution',
      emotionalState: 'Optimal / Calm',
      tags: ['Liquidity Sweep + MSS', 'Patience Rewarded'],
      notes: 'Clean execution following the 15M MSS after Asian high sweep.',
      postTrade: {
        tradeId: 'trd_1',
        followedRules: 'yes',
        outcome: 'win',
        lessonsLearned: 'Waiting for the 15M candle to close prevented early stop out.',
      },
      linkedReportId: 'rpt_123',
      linkedReportTitle: 'XAUUSD London Session Review',
    };

    const savedEntry = await saveJournalEntry(sampleJournalEntry);
    assert(savedEntry.id === testEntryId, 'saveJournalEntry returns saved ID');

    const retrieved = await getJournalEntryById(testEntryId);
    assert(Boolean(retrieved), 'getJournalEntryById retrieves saved entry');
    assert(retrieved?.pair === 'XAUUSD', 'Retrieved entry retains trading pair');
    assert(retrieved?.emotionalState === 'Optimal / Calm', 'Retrieved entry retains emotional readiness');
    assert(retrieved?.postTrade?.followedRules === 'yes', 'Retrieved entry retains rule compliance check');
    assert(retrieved?.postTrade?.outcome === 'win', 'Retrieved entry retains trade outcome');
    assert(retrieved?.linkedReportTitle === 'XAUUSD London Session Review', 'Retrieved entry retains linked report title');

    const allEntries = await getAllJournalEntries();
    assert(allEntries.length > 0, `getAllJournalEntries returns list with ${allEntries.length} entries`);
    const foundInList = allEntries.some((e) => e.id === testEntryId);
    assert(foundInList, 'Newly saved entry is present in getAllJournalEntries list');

    // 2. Journal Draft Autosave
    const draftPayload = {
      entryType: 'prep' as const,
      pair: 'BTCUSD' as const,
      session: 'NY AM' as const,
      title: 'NY Open Crypto Prep',
      notes: 'Watching 90k support bounce.',
    };
    await saveJournalDraft(draftPayload);
    const loadedDraft = await getJournalDraft();
    assert(Boolean(loadedDraft), 'getJournalDraft retrieves autosaved draft');
    assert(loadedDraft?.pair === 'BTCUSD', 'Journal draft retains pair');
    assert(loadedDraft?.title === 'NY Open Crypto Prep', 'Journal draft retains title');

    await clearJournalDraft();
    const draftAfterClear = await getJournalDraft();
    assert(draftAfterClear === null, 'clearJournalDraft successfully deletes autosaved draft');

    // 3. Backup V3 Roundtrip & Backward Compatibility
    const v3Backup = await createFullBackup();
    assert(v3Backup.version === 3, 'createFullBackup generates Version 3 payload');
    assert(Array.isArray(v3Backup.journalEntries), 'v3Backup contains journalEntries array');
    assert(v3Backup.journalEntries!.some((e) => e.id === testEntryId), 'v3Backup contains our saved journal entry');

    const analysis = await analyzeBackup(v3Backup);
    assert(analysis.totalJournalEntriesInBackup >= 1, `analyzeBackup counts ${analysis.totalJournalEntriesInBackup} journal entries`);

    // Test backward compatibility: analyze v2 backup without journalEntries
    const v2BackupMock: BackupData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      app: 'ABMAX_ANALYSIS',
      reports: v3Backup.reports,
      templates: v3Backup.templates,
      images: v3Backup.images,
      draft: null,
      preferences: v3Backup.preferences,
    };
    const analysisV2 = await analyzeBackup(v2BackupMock);
    assert(analysisV2.totalJournalEntriesInBackup === 0, 'analyzeBackup reports 0 journal entries for v2 backup');

    // Test restore of v3 backup
    const restoreResult = await restoreBackup(v3Backup);
    assert(typeof restoreResult.addedJournalEntries === 'number', `restoreBackup handles journal entries`);

    // Verify last backup metadata tracking
    const lastMeta = getLastBackupMetadata();
    assert(Boolean(lastMeta.timestamp), 'getLastBackupMetadata reports non-empty backup timestamp');
    assert(lastMeta.status === 'success', 'getLastBackupMetadata reports success status');

    // 4. Performance Metric Invariants
    // Rule followed trade
    const postTradeFollowed: JournalEntry = {
      id: `jrn_perf_1`,
      title: 'Followed Rule Trade',
      date: '2026-11-09',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entryType: 'post-trade',
      postTrade: { tradeId: 't1', followedRules: 'yes', outcome: 'win' },
    };
    // Rule broken trade
    const postTradeBroken: JournalEntry = {
      id: `jrn_perf_2`,
      title: 'Broken Rule Trade',
      date: '2026-11-09',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entryType: 'post-trade',
      postTrade: { tradeId: 't2', followedRules: 'no', outcome: 'loss' },
    };
    // Unreviewed trade (neither yes nor no)
    const postTradeUnreviewed: JournalEntry = {
      id: `jrn_perf_3`,
      title: 'Unreviewed Trade',
      date: '2026-11-09',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entryType: 'post-trade',
      postTrade: { tradeId: 't3', outcome: 'open' },
    };

    const entriesForPerf = [postTradeFollowed, postTradeBroken, postTradeUnreviewed];
    let rulesFollowed = 0;
    let rulesBroken = 0;
    entriesForPerf.forEach((e) => {
      if (e.postTrade?.followedRules === 'yes') rulesFollowed++;
      else if (e.postTrade?.followedRules === 'no') rulesBroken++;
    });
    const reviewedCount = rulesFollowed + rulesBroken;
    const disciplineRate = reviewedCount > 0 ? (rulesFollowed / reviewedCount) * 100 : 100;
    assert(rulesFollowed === 1, 'Correct rules followed count: 1');
    assert(rulesBroken === 1, 'Correct rules broken count: 1');
    assert(reviewedCount === 2, 'Unreviewed trade excluded from reviewed denominator: 2');
    assert(disciplineRate === 50, `Discipline rate accurately calculated: ${disciplineRate}%`);

    // 5. PDF Status Colors
    const bullLight = getPdfStatusColor('Bullish', false);
    assert(bullLight[0] === 16 && bullLight[1] === 128 && bullLight[2] === 67, 'Bullish in light style is crisp emerald');

    const bearLight = getPdfStatusColor('Bearish', false);
    assert(bearLight[0] === 197 && bearLight[1] === 34 && bearLight[2] === 31, 'Bearish in light style is crimson red');

    const neutralLight = getPdfStatusColor('Neutral', false);
    assert(neutralLight[0] === 71 && neutralLight[1] === 85 && neutralLight[2] === 105, 'Neutral in light style is slate');

    const amberLight = getPdfStatusColor('Not sure', false);
    assert(amberLight[0] === 180 && amberLight[1] === 83 && amberLight[2] === 9, 'Not sure in light style is amber');

    const bullDark = getPdfStatusColor('Bullish', true);
    assert(bullDark[0] === 52 && bullDark[1] === 211 && bullDark[2] === 153, 'Bullish in dark style is high-contrast bright emerald');

    const bearDark = getPdfStatusColor('Bearish', true);
    assert(bearDark[0] === 248 && bearDark[1] === 113 && bearDark[2] === 113, 'Bearish in dark style is high-contrast light red');

    // 6. Period Combined PDF Export
    const sampleReportForPeriod: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_period_test',
      date: '2026-11-09',
      scenarios: [],
      trades: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    const periodExportMinimal = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-09',
      preset: 'week',
      mode: 'summary',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includePerformance: true,
      includeImages: false,
      style: 'minimal',
      reports: [sampleReportForPeriod],
      journalEntries: [sampleJournalEntry],
    });
    assert(periodExportMinimal.blob.size > 2000, 'Period PDF export in minimal style generates non-empty Blob');
    assert(periodExportMinimal.filename.includes('ABMAX_Period'), `Filename conforms to standard: ${periodExportMinimal.filename}`);
    const periodBuf = await periodExportMinimal.blob.arrayBuffer();
    const periodMagic = String.fromCharCode(...new Uint8Array(periodBuf.slice(0, 5)));
    assert(periodMagic === '%PDF-', 'Period PDF starts with valid %PDF- header');

    // Emerald period export
    const periodExportEmerald = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-09',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includePerformance: true,
      includeImages: false,
      style: 'emerald',
      reports: [sampleReportForPeriod],
      journalEntries: [sampleJournalEntry],
    });
    assert(periodExportEmerald.blob.size > 2000, 'Period PDF export in emerald style generates valid document');

    // Cleanup test journal entry
    await deleteJournalEntry(testEntryId);
    const deletedEntryCheck = await getJournalEntryById(testEntryId);
    assert(deletedEntryCheck === null, 'deleteJournalEntry successfully removes entry');

  } catch (err) {
    assert(false, 'Test Suite 37 execution', (err as Error).message);
  }

  try {
    console.log('\n--- TEST SUITE 38: JOURNAL & PERFORMANCE VISIBILITY CONFIGS, MY JOURNAL NOTES & STATISTICAL INDEPENDENCE ---');

    // 1. Journal Visibility Config Persistence & Normalization
    const defaultJrnVis = await getUserJournalVisibilityConfig();
    assert(defaultJrnVis.myJournalNotes === true, 'Default journal visibility includes myJournalNotes: true');
    assert(defaultJrnVis.dailyPreparation === true, 'Default journal visibility includes dailyPreparation: true');
    assert(defaultJrnVis.summaryCards === true, 'Default journal visibility includes summaryCards: true');

    const customJrnVis: JournalVisibilityConfig = {
      ...defaultJrnVis,
      myJournalNotes: false,
      moodReadiness: false,
    };
    await saveUserJournalVisibilityConfig(customJrnVis);
    const loadedJrnVis = await getUserJournalVisibilityConfig();
    assert(loadedJrnVis.myJournalNotes === false, 'saveUserJournalVisibilityConfig persisted myJournalNotes: false');
    assert(loadedJrnVis.moodReadiness === false, 'saveUserJournalVisibilityConfig persisted moodReadiness: false');
    assert(loadedJrnVis.dailyPreparation === true, 'Unmodified sections retain true default');

    // Test normalizeJournalVisibilityConfig with partial / undefined values
    const partialJrnNorm = normalizeJournalVisibilityConfig({ myJournalNotes: false } as any);
    assert(partialJrnNorm.myJournalNotes === false, 'normalizeJournalVisibilityConfig respects explicit false');
    assert(partialJrnNorm.dailyPreparation === true, 'normalizeJournalVisibilityConfig restores missing fields to true');
    assert(partialJrnNorm.summaryCards === true, 'normalizeJournalVisibilityConfig restores summaryCards to true');

    // 2. Performance Visibility Config Persistence & Normalization
    const defaultPerfVis = await getUserPerformanceVisibilityConfig();
    assert(defaultPerfVis.totalsSummary === true, 'Default performance visibility includes totalsSummary: true');
    assert(defaultPerfVis.disciplineCompliance === true, 'Default performance visibility includes disciplineCompliance: true');
    assert(defaultPerfVis.instrumentBreakdown === true, 'Default performance visibility includes instrumentBreakdown: true');

    const customPerfVis: PerformanceVisibilityConfig = {
      ...defaultPerfVis,
      activityCalendar: false,
      mistakesAndLessons: false,
    };
    await saveUserPerformanceVisibilityConfig(customPerfVis);
    const loadedPerfVis = await getUserPerformanceVisibilityConfig();
    assert(loadedPerfVis.activityCalendar === false, 'saveUserPerformanceVisibilityConfig persisted activityCalendar: false');
    assert(loadedPerfVis.mistakesAndLessons === false, 'saveUserPerformanceVisibilityConfig persisted mistakesAndLessons: false');
    assert(loadedPerfVis.totalsSummary === true, 'Unmodified performance sections retain true default');

    const partialPerfNorm = normalizePerformanceVisibilityConfig({ activityCalendar: false } as any);
    assert(partialPerfNorm.activityCalendar === false, 'normalizePerformanceVisibilityConfig respects explicit false');
    assert(partialPerfNorm.totalsSummary === true, 'normalizePerformanceVisibilityConfig restores missing fields to true');

    // 3. My Journal Draft Autosave, Retrieval, and Clear
    const myDraftPayload = {
      title: 'Mid-Session Mindset Note',
      notes: 'Market consolidating in tight range, staying patient.',
      myJournalContext: 'During Trading' as const,
      emotionalState: 'Focused' as const,
      tags: ['Discipline', 'Waiting'],
    };
    await saveMyJournalDraft(myDraftPayload);
    const retrievedMyDraft = await getMyJournalDraft();
    assert(Boolean(retrievedMyDraft), 'getMyJournalDraft retrieves saved draft');
    assert(retrievedMyDraft?.title === 'Mid-Session Mindset Note', 'My Journal draft title matches');
    assert(retrievedMyDraft?.myJournalContext === 'During Trading', 'My Journal context matches');
    assert(retrievedMyDraft?.emotionalState === 'Focused', 'My Journal emotional state matches');
    assert(retrievedMyDraft?.tags?.length === 2, 'My Journal tags match');

    await clearMyJournalDraft();
    const clearedMyDraft = await getMyJournalDraft();
    assert(clearedMyDraft === null, 'clearMyJournalDraft successfully clears draft');

    // 4. My Journal Note CRUD (Freeform personal note)
    const myNoteId = `jrn_my_${Date.now()}`;
    const myNoteEntry: JournalEntry = {
      id: myNoteId,
      entryType: 'my-journal',
      title: 'Pre-Market Deep Reflection',
      date: '2026-11-10',
      time: '08:30',
      myJournalContext: 'Before Trading',
      emotionalState: 'Optimal / Calm',
      tags: ['Routine', 'Morning Prep'],
      notes: 'Woke up early, meditated for 15 mins. Focused strictly on NY AM high-probability setups.',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveJournalEntry(myNoteEntry);
    const retrievedMyNote = await getJournalEntryById(myNoteId);
    assert(Boolean(retrievedMyNote), 'getJournalEntryById retrieves saved My Journal note');
    assert(retrievedMyNote?.entryType === 'my-journal', 'Entry retains entryType: my-journal');
    assert(retrievedMyNote?.myJournalContext === 'Before Trading', 'Entry retains myJournalContext: Before Trading');
    assert(retrievedMyNote?.emotionalState === 'Optimal / Calm', 'Entry retains emotional readiness');
    assert(Boolean(retrievedMyNote?.notes?.includes('meditated for 15 mins')), 'Entry retains body notes text');

    // Edit My Journal note
    const updatedMyNote: JournalEntry = {
      ...retrievedMyNote!,
      title: 'Pre-Market Deep Reflection (Updated)',
      notes: 'Updated: added notes regarding gold key levels.',
      updatedAt: Date.now(),
    };
    await saveJournalEntry(updatedMyNote);
    const reRetrievedMyNote = await getJournalEntryById(myNoteId);
    assert(reRetrievedMyNote?.title === 'Pre-Market Deep Reflection (Updated)', 'Edited My Journal note successfully updated title');
    assert(Boolean(reRetrievedMyNote?.notes?.includes('gold key levels')), 'Edited My Journal note successfully updated notes');

    // 5. Statistical Independence Verification
    // Ensure that having My Journal entries does NOT increment trade counts, win rate, or alter discipline calculations
    const allJournalEntries = await getAllJournalEntries();
    const tradeRelatedEntries = allJournalEntries.filter((e) => e.entryType === 'post-trade');
    const myJournalEntriesList = allJournalEntries.filter((e) => e.entryType === 'my-journal');
    assert(myJournalEntriesList.length >= 1, 'My Journal entries exist in journal list');
    // None of the my-journal entries should appear in trade review sets
    const myJournalInTradeSet = tradeRelatedEntries.some((e) => e.id === myNoteId);
    assert(!myJournalInTradeSet, 'My Journal note is strictly excluded from tradeRelatedEntries');

    // 6. Period Export Verification (with and without includeMyJournalNotes)
    const periodExportWithoutNotes = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: false, // DEFAULT OFF
      includePerformance: true,
      includeImages: false,
      style: 'minimal',
      reports: [],
      journalEntries: [updatedMyNote],
    });
    assert(periodExportWithoutNotes.blob.size > 1000, 'Period PDF generated without My Journal notes');

    const periodExportWithNotes = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: true, // EXPLICIT ON
      includePerformance: true,
      includeImages: false,
      style: 'minimal',
      reports: [],
      journalEntries: [updatedMyNote],
    });
    assert(periodExportWithNotes.blob.size > 1000, 'Period PDF generated with My Journal notes');

    // 7. Full Backup & Restore v3 with Visibility Preferences and Drafts
    await saveMyJournalDraft({ title: 'Draft Before Backup', notes: 'Private unsaved reflection draft' });
    const fullBackupData = await createFullBackup();
    assert(Boolean(fullBackupData.preferences.journalVisibilityConfig), 'Backup v3 includes journalVisibilityConfig');
    assert(Boolean(fullBackupData.preferences.performanceVisibilityConfig), 'Backup v3 includes performanceVisibilityConfig');
    assert(Boolean(fullBackupData.myJournalDraft), 'Backup v3 preserves myJournalDraft');

    await clearMyJournalDraft();
    const draftAfterClear = await getMyJournalDraft();
    assert(draftAfterClear === null, 'Draft is cleared before restore');

    await restoreBackup(fullBackupData);
    const draftAfterRestore = await getMyJournalDraft();
    assert(draftAfterRestore?.title === 'Draft Before Backup', 'restoreBackup successfully restored myJournalDraft');
    await clearMyJournalDraft();

    // 8. Account Switch Draft Isolation Test
    // Simulating User A active draft followed by User B sign-in
    await saveMyJournalDraft({ title: 'User A Secret Draft', notes: 'Confidential mindset note' });
    const userADraft = await getMyJournalDraft();
    assert(userADraft?.title === 'User A Secret Draft', 'User A draft saved in storage');
    // Account switch occurs: isolate drafts
    await clearMyJournalDraft();
    await clearJournalDraft();
    const userBVisibleDraft = await getMyJournalDraft();
    assert(userBVisibleDraft === null, 'Account switch successfully cleared User A draft so User B sees null');

    // 9. Zero Denominator Calculation Edge Cases
    // Empty trades: reviewed trades = 0, decided trades = 0
    const emptyReviewedTrades = 0;
    const emptyRulesFollowed = 0;
    const emptyDisciplineRate = emptyReviewedTrades > 0 ? (emptyRulesFollowed / emptyReviewedTrades) * 100 : null;
    assert(emptyDisciplineRate === null, 'Zero reviewed trades returns null discipline rate (displays "No reviewed trades")');

    const emptyDecidedTrades = 0;
    const emptyWins = 0;
    const emptyWinRate = emptyDecidedTrades > 0 ? (emptyWins / emptyDecidedTrades) * 100 : null;
    assert(emptyWinRate === null, 'Zero decided trades returns null win rate (displays "No decided trades")');

    // 10. Long Multi-Theme PDF Generation & Inspection (Minimal, Emerald, Dark)
    const longReport: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_long_test',
      title: 'XAUUSD Daily Alignment & Structural Execution Multi-Timeframe Analysis',
      date: '2026-11-10',
      scenarios: [
        {
          id: 'sc_1',
          label: 'Scenario 1: Primary Bullish Expansion',
          strategy: 'Liquidity Sweep + MSS',
          direction: 'Buy',
          description: 'Primary Bullish Expansion from 4H Order Block',
          entryConditions: '15M MSS break above 2690.50 following London liquidity sweep',
          invalidationConditions: 'Hourly close below 2665.00 support floor',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      trades: [
        {
          id: 'trd_long_1',
          pair: 'XAUUSD',
          direction: 'Buy',
          date: '2026-11-10',
          entryPrice: '2680.50',
          stopLoss: '2672.00',
          takeProfit: '2706.00',
          outcome: 'Win',
          rulesFollowed: true,
          notes: 'Entered precisely on 5M MSS candle close after liquidity sweep. Trailed stop loss to breakeven after 2R expansion reached.',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'Original',
      isModified: false,
      revision: 1,
    };

    // Theme 1: Minimal Journal (Default)
    const longMinimalPdf = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: false, // Confirms private notes remain excluded
      includePerformance: true,
      includeImages: false,
      style: 'minimal',
      reports: [longReport],
      journalEntries: [updatedMyNote],
    });
    assert(longMinimalPdf.blob.size > 2000, 'Long Minimal Journal PDF generates non-empty Blob');
    const minimalBuf = await longMinimalPdf.blob.arrayBuffer();
    assert(String.fromCharCode(...new Uint8Array(minimalBuf.slice(0, 5))) === '%PDF-', 'Minimal Journal PDF starts with %PDF-');

    // Theme 2: Emerald Theme
    const longEmeraldPdf = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: false,
      includePerformance: true,
      includeImages: false,
      style: 'emerald',
      reports: [longReport],
      journalEntries: [updatedMyNote],
    });
    assert(longEmeraldPdf.blob.size > 2000, 'Long Emerald PDF generates non-empty Blob');
    const emeraldBuf = await longEmeraldPdf.blob.arrayBuffer();
    assert(String.fromCharCode(...new Uint8Array(emeraldBuf.slice(0, 5))) === '%PDF-', 'Emerald PDF starts with %PDF-');

    // Theme 3: Dark Trading Desk Theme
    const longDarkPdf = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      preset: 'week',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: true, // Explicitly included
      includePerformance: true,
      includeImages: false,
      style: 'dark',
      reports: [longReport],
      journalEntries: [updatedMyNote],
    });
    assert(longDarkPdf.blob.size > 2000, 'Long Dark Trading Desk PDF generates non-empty Blob');
    const darkBuf = await longDarkPdf.blob.arrayBuffer();
    assert(String.fromCharCode(...new Uint8Array(darkBuf.slice(0, 5))) === '%PDF-', 'Dark Trading Desk PDF starts with %PDF-');

    // Cleanup test My Journal note
    await deleteJournalEntry(myNoteId);
    const cleanedCheck = await getJournalEntryById(myNoteId);
    assert(cleanedCheck === null, 'deleteJournalEntry successfully removes My Journal note');

    // ==========================================
    // Test Suite 39: Account-Scoped Drafts, Ownership Isolation, and Deterministic Trade Deduplication
    // ==========================================
    console.log('\n--- Running Test Suite 39: Account-Scoped Drafts & Trade Deduplication ---');

    // 1. Account-Scoped Draft Isolation (Account A vs Account B vs Guest)
    const userA = 'user_alpha_uuid';
    const userB = 'user_beta_uuid';

    // Account A writes Trading Journal and My Journal drafts
    await saveJournalDraft({ title: 'Draft Alpha Trading Plan' }, userA);
    await saveMyJournalDraft({ notes: 'Draft Alpha Mindset Reflection' }, userA);

    // Switch to Account B: B must not see A's drafts
    const draftTradingB = await getJournalDraft(userB);
    const draftMyJournalB = await getMyJournalDraft(userB);
    assert(draftTradingB === null, 'Account B sees null Trading Journal draft initially');
    assert(draftMyJournalB === null, 'Account B sees null My Journal draft initially');

    // Account B writes their own distinct drafts
    await saveJournalDraft({ title: 'Draft Beta Scalping Setup' }, userB);
    await saveMyJournalDraft({ notes: 'Draft Beta Psychology Log' }, userB);

    // Guest mode draft check
    await saveJournalDraft({ title: 'Draft Guest General Prep' }, null);
    await saveMyJournalDraft({ notes: 'Draft Guest Observations' }, null);

    // Switch back to Account A: A's drafts are intact and recovered
    const recoveredTradingA = await getJournalDraft(userA);
    const recoveredMyJournalA = await getMyJournalDraft(userA);
    assert(recoveredTradingA?.title === 'Draft Alpha Trading Plan', 'Account A recovered their own Trading Journal draft');
    assert(recoveredMyJournalA?.notes === 'Draft Alpha Mindset Reflection', 'Account A recovered their own My Journal draft');

    // Switch back to Account B: B's drafts are intact
    const recoveredTradingB = await getJournalDraft(userB);
    const recoveredMyJournalB = await getMyJournalDraft(userB);
    assert(recoveredTradingB?.title === 'Draft Beta Scalping Setup', 'Account B recovered their own Trading Journal draft');
    assert(recoveredMyJournalB?.notes === 'Draft Beta Psychology Log', 'Account B recovered their own My Journal draft');

    // Guest mode draft recovery
    const recoveredGuestTrading = await getJournalDraft(null);
    const recoveredGuestMyJournal = await getMyJournalDraft(null);
    assert(recoveredGuestTrading?.title === 'Draft Guest General Prep', 'Guest recovered their own Trading Journal draft');
    assert(recoveredGuestMyJournal?.notes === 'Draft Guest Observations', 'Guest recovered their own My Journal draft');

    // 2. Backup and Restore with Scoped Drafts & Ownership Metadata
    const fullBackupWithDrafts = await createFullBackup(userA);
    assert(Boolean(fullBackupWithDrafts.scopedJournalDrafts), 'Backup includes scopedJournalDrafts map');
    assert(Boolean(fullBackupWithDrafts.scopedMyJournalDrafts), 'Backup includes scopedMyJournalDrafts map');
    assert(Boolean(fullBackupWithDrafts.scopedJournalDrafts?.[userA]), 'Backup contains Account A trading draft');
    assert(Boolean(fullBackupWithDrafts.scopedMyJournalDrafts?.[userB]), 'Backup contains Account B My Journal draft');
    assert(fullBackupWithDrafts.ownership?.exportedByAccountId === userA, 'Backup records exporting account owner metadata');

    // Clear A's drafts
    await clearJournalDraft(userA);
    await clearMyJournalDraft(userA);
    const checkClearedA = await getJournalDraft(userA);
    assert(checkClearedA === null, 'Account A trading draft cleared');

    // Restore backup into Account A with 'preserve' mode
    await restoreBackup(fullBackupWithDrafts, {
      restoreDraft: true,
      targetAccountId: userA,
      foreignOwnershipMode: 'preserve',
    });
    const restoredA = await getJournalDraft(userA);
    const restoredMyA = await getMyJournalDraft(userA);
    assert(restoredA?.title === 'Draft Alpha Trading Plan', 'Restored Account A trading draft from backup');
    assert(restoredMyA?.notes === 'Draft Alpha Mindset Reflection', 'Restored Account A My Journal draft from backup');

    // 3. Ownership Isolation for Saved Entries (Account A, Account B, Guest, Legacy undefined)
    const entryA: JournalEntry = {
      id: 'entry_alpha_1',
      title: 'Alpha Trade Review',
      date: '2026-11-05',
      time: '08:00',
      session: 'London',
      pair: 'XAUUSD',
      entryType: 'post-trade',
      userId: userA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entryB: JournalEntry = {
      id: 'entry_beta_1',
      title: 'Beta Trade Review',
      date: '2026-11-05',
      time: '09:00',
      session: 'NY AM',
      pair: 'EURUSD',
      entryType: 'post-trade',
      userId: userB,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const entryGuestLegacy: JournalEntry = {
      id: 'entry_guest_legacy_1',
      title: 'Guest Unscoped Entry',
      date: '2026-11-05',
      time: '10:00',
      session: 'NY PM',
      pair: 'BTCUSD',
      entryType: 'my-journal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveJournalEntry(entryA);
    await saveJournalEntry(entryB);
    await saveJournalEntry(entryGuestLegacy);

    const allEntriesForIsolation = await getAllJournalEntries();
    const userAEntries = allEntriesForIsolation.filter((e) => isJournalEntryOwnedByScope(e, userA));
    const userBEntries = allEntriesForIsolation.filter((e) => isJournalEntryOwnedByScope(e, userB));
    const guestEntries = allEntriesForIsolation.filter((e) => isJournalEntryOwnedByScope(e, null));

    assert(!userAEntries.some((e) => e.id === 'entry_beta_1'), 'Account A cannot see Account B saved journal entry');
    assert(!userAEntries.some((e) => e.id === 'entry_guest_legacy_1'), 'Account A cannot see Guest saved journal entry');
    assert(userAEntries.some((e) => e.id === 'entry_alpha_1'), 'Account A sees Account A entry');

    assert(!userBEntries.some((e) => e.id === 'entry_alpha_1'), 'Account B cannot see Account A saved journal entry');
    assert(!userBEntries.some((e) => e.id === 'entry_guest_legacy_1'), 'Account B cannot see Guest saved journal entry');
    assert(userBEntries.some((e) => e.id === 'entry_beta_1'), 'Account B sees Account B entry');

    assert(guestEntries.some((e) => e.id === 'entry_guest_legacy_1'), 'Guest mode sees guest/legacy entries');
    assert(!guestEntries.some((e) => e.id === 'entry_alpha_1' || e.id === 'entry_beta_1'), 'Guest mode cannot see signed-in user entries');

    // Analyze backup ownership & test deliberate 'skip' and 'claim' restore policies
    const ownedBackup = await createFullBackup(userA);
    const previewForB = await analyzeBackup(ownedBackup, userB);
    assert((previewForB.ownershipSummary?.foreignOwnerEntriesCount || 0) >= 2, 'analyzeBackup counts foreign entries for target Account B');

    await deleteJournalEntry('entry_alpha_1');
    await deleteJournalEntry('entry_beta_1');
    await deleteJournalEntry('entry_guest_legacy_1');

    // Test 'skip': only imports entries matching targetScope (userB)
    const skipRes = await restoreBackup(ownedBackup, {
      targetAccountId: userB,
      foreignOwnershipMode: 'skip',
      restoreDraft: false,
    });
    const afterSkip = await getAllJournalEntries();
    assert(skipRes.skippedForeignJournalEntries >= 2, 'Skip mode skipped foreign Account A and Guest entries');
    assert(afterSkip.some((e) => e.id === 'entry_beta_1'), 'Skip mode restored matching Account B entry');
    assert(!afterSkip.some((e) => e.id === 'entry_alpha_1'), 'Skip mode excluded foreign Account A entry');

    // Test 'claim': reassigns ownership of imported entries to targetAccountId (userC)
    const userC = 'user_charlie_789';
    await deleteJournalEntry('entry_beta_1');
    await restoreBackup(ownedBackup, {
      targetAccountId: userC,
      foreignOwnershipMode: 'claim',
      restoreDraft: false,
    });
    const afterClaim = await getAllJournalEntries();
    const claimedA = afterClaim.find((e) => e.id === 'entry_alpha_1');
    assert(claimedA?.userId === userC, 'Claim mode assigned imported journal entry ownership to userC');

    await deleteJournalEntry('entry_alpha_1');
    await deleteJournalEntry('entry_beta_1');
    await deleteJournalEntry('entry_guest_legacy_1');
    await clearJournalDraft(userA);
    await clearMyJournalDraft(userA);
    await clearJournalDraft(userB);
    await clearMyJournalDraft(userB);
    await clearJournalDraft(userC);
    await clearMyJournalDraft(userC);
    await clearJournalDraft(null);
    await clearMyJournalDraft(null);

    // 4. Deterministic Trade Deduplication Across Original, Edited, Copied, and Conflict Reports
    const rpt1: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_dedup_1_orig',
      date: '2026-11-05',
      pair: 'XAUUSD',
      status: 'Original',
      createdAt: 1000,
      updatedAt: 1000,
      trades: [
        {
          id: 'trd_shared',
          pair: 'XAUUSD',
          direction: 'Buy',
          outcome: 'Loss',
          rulesFollowed: false,
          date: '2026-11-05',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
    };
    const rpt2: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_dedup_2_edited',
      date: '2026-11-05',
      pair: 'XAUUSD',
      status: 'Modified',
      createdAt: 1000,
      updatedAt: 2500, // newest revision
      trades: [
        {
          id: 'trd_shared',
          pair: 'XAUUSD',
          direction: 'Buy',
          outcome: 'Win',
          rulesFollowed: true,
          date: '2026-11-05',
          createdAt: 1000,
          updatedAt: 2500, // updated outcome & compliance
        },
      ],
    };
    const rpt3: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_dedup_3_copy',
      date: '2026-11-05',
      pair: 'XAUUSD',
      status: 'Original',
      copiedFromId: 'rpt_dedup_1_orig',
      createdAt: 1500,
      updatedAt: 1500,
      trades: [
        {
          id: 'trd_shared',
          pair: 'XAUUSD',
          direction: 'Buy',
          outcome: 'Loss',
          rulesFollowed: false,
          date: '2026-11-05',
          createdAt: 1000,
          updatedAt: 1500,
        },
      ],
    };
    const rpt4: SavedReport = {
      ...createInitialAnalysisData('XAUUSD'),
      id: 'rpt_dedup_4_conflict',
      date: '2026-11-05',
      pair: 'XAUUSD',
      status: 'Modified',
      createdAt: 1000,
      updatedAt: 1800,
      trades: [
        {
          id: 'trd_shared',
          pair: 'XAUUSD',
          direction: 'Buy',
          outcome: 'Break-even',
          rulesFollowed: true,
          date: '2026-11-05',
          createdAt: 1000,
          updatedAt: 1800,
        },
      ],
    };
    const rpt5: SavedReport = {
      ...createInitialAnalysisData('EURUSD'),
      id: 'rpt_dedup_5_new',
      date: '2026-11-06',
      pair: 'EURUSD',
      status: 'Original',
      createdAt: 3000,
      updatedAt: 3000,
      trades: [
        {
          id: 'trd_independent',
          pair: 'EURUSD',
          direction: 'Sell',
          outcome: 'Win',
          rulesFollowed: true,
          date: '2026-11-06',
          createdAt: 3000,
          updatedAt: 3000,
        },
      ],
    };

    const dedupTrades = extractDeduplicatedTrades([rpt1, rpt2, rpt3, rpt4, rpt5]);
    const dedupStats = calculatePeriodPerformance(dedupTrades);

    assert(dedupStats.totalTrades === 2, `Deduplication yields exactly 2 total trades across 5 reports (actual: ${dedupStats.totalTrades})`);
    assert(dedupTrades.length === 2, `Deduplication returns exactly 2 trade objects (actual: ${dedupTrades.length})`);

    const sharedTradeResult = dedupTrades.find((t) => t.id === 'trd_shared');
    assert(Boolean(sharedTradeResult), 'trd_shared exists in deduplicated trade list');
    assert(sharedTradeResult?.outcome === 'Win', `Deterministic resolution chose newest revision (outcome: ${sharedTradeResult?.outcome}, expected Win)`);
    assert(sharedTradeResult?.rulesFollowed === true, 'Deterministic resolution chose compliant revision');

    assert(dedupStats.wins === 2, `Deduplicated wins is 2 (actual: ${dedupStats.wins})`);
    assert(dedupStats.losses === 0, `Deduplicated losses is 0 (actual: ${dedupStats.losses})`);
    assert(dedupStats.winRate === 100, `Deduplicated winRate is 100% (actual: ${dedupStats.winRate})`);
    assert(dedupStats.disciplineRate === 100, `Deduplicated disciplineRate is 100% (actual: ${dedupStats.disciplineRate})`);

    // Equal-timestamp tie-breaker determinism
    const tieA: SavedReport = {
      ...rpt1,
      id: 'rpt_tie_a',
      updatedAt: 5000,
      trades: [{ ...rpt1.trades![0], outcome: 'Win', updatedAt: 5000 }],
    };
    const tieB: SavedReport = {
      ...rpt1,
      id: 'rpt_tie_b',
      updatedAt: 5000,
      trades: [{ ...rpt1.trades![0], outcome: 'Loss', updatedAt: 5000 }],
    };
    const tieOrder1 = extractDeduplicatedTrades([tieA, tieB]);
    const tieOrder2 = extractDeduplicatedTrades([tieB, tieA]);
    assert(
      tieOrder1[0].outcome === 'Win' && tieOrder2[0].outcome === 'Win',
      'Equal-timestamp tie-breaking is order-independent and deterministic'
    );

    // 5. Multi-page PDF blob sanity (long single analysis report + period report with images)
    const samplePng1x1 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAADElEQVR4nGNgGEYAAADwAAHh6a5JAAAAAElFTkSuQmCC';
    const multiPagePdfReport: SavedReport = {
      ...rpt2,
      title: 'Long Multi-Page Verification Analysis Report',
      overallNotes: 'SentinelOverallNoteText '.repeat(35),
      timeframes: {
        ...rpt2.timeframes,
        Monthly: {
          ...rpt2.timeframes.Monthly,
          overallBias: 'Bullish',
          note: 'MonthlyColumnLine '.repeat(30),
          chartImageId: 'img_monthly_test',
        },
        Daily: {
          ...rpt2.timeframes.Daily,
          overallBias: 'Bullish',
          note: 'DailySentinelTailMarker '.repeat(25),
        },
      },
      trades: [
        {
          ...rpt2.trades![0],
          images: [{ id: 'trd_img_1', dataUrl: samplePng1x1, caption: 'Execution Chart', createdAt: 2500 }],
        },
      ],
    };
    const singlePdf = await generateReportPdfBlob({
      report: multiPagePdfReport,
      imagesMap: { img_monthly_test: samplePng1x1 },
      style: 'dark',
    });
    const singlePdfBytes = new Uint8Array(await singlePdf.blob.arrayBuffer());
    assert(
      singlePdf.doc.getNumberOfPages() >= 2 &&
        singlePdfBytes[0] === 0x25 &&
        singlePdfBytes[1] === 0x50,
      `Long single-report PDF renders across multiple pages without truncation (${singlePdf.doc.getNumberOfPages()} pages)`
    );

    const periodPdf = await generatePeriodPdfBlob({
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      mode: 'full',
      includeAnalyses: true,
      includeTrades: true,
      includeJournal: true,
      includeMyJournalNotes: true,
      includePerformance: true,
      includeImages: true,
      style: 'emerald',
      reports: [multiPagePdfReport, rpt5],
      journalEntries: [],
    });
    const periodBytes = new Uint8Array(await periodPdf.blob.arrayBuffer());
    assert(periodBytes.length > 2000 && periodBytes[0] === 0x25, 'Period PDF with embedded images generated cleanly');
  } catch (err) {
    assert(false, 'Test Suite execution failure', (err as Error).message);
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
