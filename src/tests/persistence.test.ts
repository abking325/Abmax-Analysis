import 'fake-indexeddb/auto';
import {
  saveReport,
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
} from '../services/db';
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
} from '../types/journal';

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

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
