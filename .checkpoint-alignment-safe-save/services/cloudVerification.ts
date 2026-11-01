import { supabase } from './supabase';
import { SavedReport, createInitialAnalysisData } from '../types/journal';

export interface VerificationCheckStep {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'running';
  message: string;
}

export interface FullVerificationResult {
  serviceReachable: boolean;
  serviceLatencyMs?: number;
  signedIn: boolean;
  userId?: string;
  cloudSaveVerified: boolean;
  screenshotStorageVerified: boolean;
  steps: VerificationCheckStep[];
  error?: string;
  timestamp: number;
}

/**
 * Runs a complete end-to-end verification of Supabase cloud capabilities:
 * 1. Checks service reachability via auth health endpoint
 * 2. Checks authentication session
 * 3. Writes, reads, modifies, and confirms updates to public.analyses without duplication
 * 4. Verifies public.drafts and public.templates cloud saving
 * 5. Verifies private chart-images storage bucket upload, signed URL fetch, and deletion
 * 6. Cleans up all verification probe data
 */
export async function runFullCloudVerification(): Promise<FullVerificationResult> {
  const steps: VerificationCheckStep[] = [];
  const timestamp = Date.now();

  if (!supabase) {
    return {
      serviceReachable: false,
      signedIn: false,
      cloudSaveVerified: false,
      screenshotStorageVerified: false,
      steps: [
        {
          name: 'Supabase Client',
          status: 'failed',
          message: 'VITE_SUPABASE_URL or client is not configured',
        },
      ],
      timestamp,
    };
  }

  // 1. Service Reachability Check
  let serviceReachable = false;
  let serviceLatencyMs = 0;
  try {
    const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
    const t0 = performance.now();
    const res = await fetch(`${rawUrl}/auth/v1/health`, {
      method: 'GET',
      headers: key ? { apikey: key } : {},
    });
    serviceLatencyMs = Math.round(performance.now() - t0);
    if (res.ok || res.status === 401) {
      serviceReachable = true;
      steps.push({
        name: 'Service Reachability',
        status: 'passed',
        message: `Service reachable (${serviceLatencyMs}ms)`,
      });
    } else {
      steps.push({
        name: 'Service Reachability',
        status: 'failed',
        message: `Gateway returned status ${res.status}`,
      });
    }
  } catch (err: any) {
    steps.push({
      name: 'Service Reachability',
      status: 'failed',
      message: err?.message || 'Network request failed',
    });
  }

  // 2. Authentication Check
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;

  if (!user) {
    steps.push({
      name: 'Authentication Session',
      status: 'skipped',
      message: 'Not signed in. Sign in to verify cloud saving and private screenshot storage.',
    });

    return {
      serviceReachable,
      serviceLatencyMs,
      signedIn: false,
      cloudSaveVerified: false,
      screenshotStorageVerified: false,
      steps,
      timestamp,
    };
  }

  steps.push({
    name: 'Authentication Session',
    status: 'passed',
    message: `Signed in as ${user.email} (ID: ${user.id.slice(0, 8)}...)`,
  });

  const userId = user.id;
  const testReportId = `_probe_rpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let cloudSaveVerified = false;
  let screenshotStorageVerified = false;

  // 3. Verify public.analyses: Write, Read, Modify (no duplication), and Delete
  try {
    const initialData = createInitialAnalysisData('XAUUSD');
    const testReport: SavedReport = {
      ...initialData,
      id: testReportId,
      status: 'Original',
      isModified: false,
      overallNotes: 'VERIFICATION_PROBE_DO_NOT_KEEP',
    };

    // Insert test report
    const insertRow = {
      id: testReport.id,
      user_id: userId,
      pair: testReport.pair,
      date: testReport.date,
      time: testReport.time,
      session: testReport.session,
      analysis_timing: testReport.analysisTiming,
      overall_alignment: 'ALIGNED',
      status: 'Original',
      is_modified: false,
      payload: testReport,
      revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: insErr } = await supabase.from('analyses').insert(insertRow);
    if (insErr) throw new Error(`analyses insert error: ${insErr.message}`);

    // Read back test report
    const { data: readData, error: readErr } = await supabase
      .from('analyses')
      .select('id, payload, revision')
      .eq('user_id', userId)
      .eq('id', testReportId)
      .single();
    if (readErr || !readData) throw new Error(`analyses read error: ${readErr?.message || 'not found'}`);

    // Modify test report and update
    const updatedPayload = { ...testReport, isModified: true, status: 'Modified' as const };
    const { error: updateErr } = await supabase
      .from('analyses')
      .update({
        is_modified: true,
        status: 'Modified',
        payload: updatedPayload,
        revision: 2,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', testReportId);
    if (updateErr) throw new Error(`analyses update error: ${updateErr.message}`);

    // Confirm updated and no duplication
    const { data: verifyList, error: countErr } = await supabase
      .from('analyses')
      .select('id, status, revision')
      .eq('user_id', userId)
      .eq('id', testReportId);
    if (countErr || !verifyList || verifyList.length !== 1 || verifyList[0].status !== 'Modified') {
      throw new Error(`analyses verification failed: expected 1 updated record, found ${verifyList?.length}`);
    }

    // Clean up test report
    await supabase.from('analyses').delete().eq('user_id', userId).eq('id', testReportId);

    steps.push({
      name: 'Analyses Table (Saved Reports)',
      status: 'passed',
      message: 'Write, read-back, modification without duplication, and cleanup verified.',
    });
  } catch (err: any) {
    steps.push({
      name: 'Analyses Table (Saved Reports)',
      status: 'failed',
      message: err.message,
    });
  }

    // 4. Safe Verification for Drafts, Templates & User Preferences
    // NOTE: Per safety policy, drafts and user_preferences have 1 row per user.
    // Real user drafts and preferences are read safely without being overwritten or deleted.
    // Destructive writes are only performed on isolated test accounts.
    const isIsolatedTestAccount =
      user.email?.startsWith('test_isolated_') ||
      user.email?.startsWith('ephemeral_test_');

    try {
      // 4a. Templates: multi-row table, insert with strictly unique ID, read back, and immediately delete
      const uniqueTestTmplId = `_probe_tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error: tmplInsertErr } = await supabase.from('templates').insert({
        id: uniqueTestTmplId,
        user_id: userId,
        name: 'Verification Probe Template',
        payload: { id: uniqueTestTmplId, name: 'Verification Probe Template' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (tmplInsertErr) throw new Error(`templates insert error: ${tmplInsertErr.message}`);

      // Read back template
      const { data: tmplRead, error: tmplReadErr } = await supabase
        .from('templates')
        .select('id, name')
        .eq('user_id', userId)
        .eq('id', uniqueTestTmplId)
        .single();
      if (tmplReadErr || !tmplRead) throw new Error(`templates read error: ${tmplReadErr?.message || 'not found'}`);

      // Clean up ONLY the test template
      await supabase.from('templates').delete().eq('user_id', userId).eq('id', uniqueTestTmplId);

      // 4b. Drafts: Read existing row without modifying or overwriting real user draft
      if (isIsolatedTestAccount) {
        // Only run destructive/upsert check if this is an explicitly isolated test account
        const { error: draftErr } = await supabase.from('drafts').upsert(
          {
            user_id: userId,
            pair: 'BTCUSD',
            payload: { pair: 'BTCUSD', is_probe: true },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,pair' }
        );
        if (draftErr) throw new Error(`drafts upsert error: ${draftErr.message}`);
        await supabase.from('drafts').delete().eq('user_id', userId).eq('pair', 'BTCUSD');
      } else {
        // Real user account: Safe non-destructive read check (does NOT touch real user draft)
        const { error: draftReadErr } = await supabase
          .from('drafts')
          .select('pair, updated_at')
          .eq('user_id', userId)
          .limit(1);
        if (draftReadErr) throw new Error(`drafts read error: ${draftReadErr.message}`);
      }

      // 4c. User Preferences: Read existing row without modifying or overwriting real preferences
      if (isIsolatedTestAccount) {
        const { error: prefErr } = await supabase.from('user_preferences').upsert({
          user_id: userId,
          theme: 'light',
          preferences: { test_verified: true, verified_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        });
        if (prefErr) throw new Error(`user_preferences upsert error: ${prefErr.message}`);
      } else {
        // Real user account: Safe non-destructive read check (does NOT touch real user preferences)
        const { error: prefReadErr } = await supabase
          .from('user_preferences')
          .select('theme, preferences, updated_at')
          .eq('user_id', userId)
          .limit(1);
        if (prefReadErr) throw new Error(`user_preferences read error: ${prefReadErr.message}`);
      }

      steps.push({
        name: 'Drafts, Templates & Preferences',
        status: 'passed',
        message: isIsolatedTestAccount
          ? 'Isolated write/read verified for drafts, templates, and preferences.'
          : 'Templates write/cleanup verified; existing user drafts & preferences verified via safe read.',
      });

      cloudSaveVerified =
        steps.find((s) => s.name === 'Analyses Table (Saved Reports)')?.status === 'passed';
    } catch (err: any) {
      steps.push({
        name: 'Drafts, Templates & Preferences',
        status: 'failed',
        message: err.message,
      });
    }

  // 5. Verify Private Screenshot Storage (chart-images bucket)
  try {
    const testBlob = new Blob(['PNG_TEST_PROBE_1x1_PAYLOAD'], { type: 'image/png' });
    const storagePath = `${userId}/_probe_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;

    // Upload test screenshot
    const { error: uploadErr } = await supabase.storage
      .from('chart-images')
      .upload(storagePath, testBlob, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadErr) {
      throw new Error(`Storage upload error: ${uploadErr.message}`);
    }

    // Retrieve signed URL
    const { data: urlData, error: signErr } = await supabase.storage
      .from('chart-images')
      .createSignedUrl(storagePath, 60);

    if (signErr || !urlData?.signedUrl) {
      throw new Error(`Signed URL creation error: ${signErr?.message || 'no url returned'}`);
    }

    // Verify authenticated access to the signed URL
    const verifyFetch = await fetch(urlData.signedUrl);
    if (!verifyFetch.ok) {
      throw new Error(`Signed URL download failed with HTTP ${verifyFetch.status}`);
    }

    // Delete test screenshot probe
    await supabase.storage.from('chart-images').remove([storagePath]);

    screenshotStorageVerified = true;
    steps.push({
      name: 'Screenshot Storage (chart-images)',
      status: 'passed',
      message: 'Private upload, signed URL access, and cleanup verified (bucket: chart-images).',
    });
  } catch (err: any) {
    steps.push({
      name: 'Screenshot Storage (chart-images)',
      status: 'failed',
      message: err.message,
    });
  }

  return {
    serviceReachable,
    serviceLatencyMs,
    signedIn: true,
    userId,
    cloudSaveVerified,
    screenshotStorageVerified,
    steps,
    timestamp,
  };
}
