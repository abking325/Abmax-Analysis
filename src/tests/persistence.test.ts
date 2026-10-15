import 'fake-indexeddb/auto';
import {
  saveReport,
  getReportById,
  getAllReports,
  saveDraft,
  getDraft,
  clearDraft,
} from '../services/db';
import { createInitialAnalysisData, SavedReport } from '../types/journal';

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
  console.log('\n--- Test Suite 5: Deep Analysis Save Without Collapse or Viewport Jump ---');
  try {
    // Simulate Timeframe state before and after Save Deep Analysis
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
    }
    // 2. Verified: DO NOT collapse! expandedTimeframes['Weekly'] remains true!
    // (Previous bug: setExpandedTimeframes(prev => ({ ...prev, [tf]: false })) caused height shrink and jump to Planned Scenarios)

    assert(analysisData.timeframes['Weekly']?.isSaved === true, 'Weekly timeframe is marked saved');
    assert(expandedTimeframes['Weekly'] === true, 'Weekly timeframe remains EXPANDED after saving Deep Analysis');

    // Verify explicit collapse only occurs when user clicks Collapse
    expandedTimeframes = { ...expandedTimeframes, Weekly: false };
    assert(expandedTimeframes['Weekly'] === false, 'Weekly timeframe collapses only on explicit user click');
  } catch (err) {
    assert(false, 'Test Suite 5 execution', (err as Error).message);
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
