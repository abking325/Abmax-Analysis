import {
  AnalysisData,
  SavedReport,
  SavedTemplate,
  TimeframeId,
  TIMEFRAME_ORDER,
} from '../types/journal';
import { supabase } from './supabase';
import {
  getAllReports,
  getAllTemplates,
  getDraft,
  getAllImages,
  getImage,
  saveReport,
  saveReportDirectly,
  saveTemplate,
  saveDraft,
  saveImage,
  getDeletedReportIds,
  removeDeletedReportId,
  getPendingCloudQueue,
  removePendingCloudItem,
} from './db';

export type SyncState = 'local' | 'syncing' | 'synced' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  errorMessage?: string;
  pendingCount: number;
}

// Convert base64 data URL to Blob for upload to Supabase Storage
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(parts[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

// In-memory cache for temporary signed image URLs
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Gets a signed URL for a private chart image stored in Supabase chart-images bucket.
 * Falls back to local IndexedDB image if cloud fetch fails or user is offline.
 */
export async function getChartImageUrl(
  userId: string | null,
  imageIdOrPath: string
): Promise<string | null> {
  // If it's a direct local image ID or user not signed in
  if (!supabase || !userId) {
    return getImage(imageIdOrPath);
  }

  const storagePath = imageIdOrPath.includes('/')
    ? imageIdOrPath
    : `${userId}/${imageIdOrPath}.png`;

  // Check cache (valid for 50 minutes out of 60)
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  try {
    const { data, error } = await supabase.storage
      .from('chart-images')
      .createSignedUrl(storagePath, 3600);

    if (error || !data?.signedUrl) {
      // Fallback to local image in IndexedDB
      return getImage(imageIdOrPath);
    }

    signedUrlCache.set(storagePath, {
      url: data.signedUrl,
      expiresAt: Date.now() + 50 * 60 * 1000,
    });
    return data.signedUrl;
  } catch (err) {
    console.warn('Failed to generate signed URL, falling back to local image', err);
    return getImage(imageIdOrPath);
  }
}

/**
 * Uploads an image data URL to Supabase private storage and returns the stable object path.
 */
export async function uploadChartImageToCloud(
  userId: string,
  imageId: string,
  dataUrl: string
): Promise<string | null> {
  if (!supabase) return null;

  try {
    const blob = dataUrlToBlob(dataUrl);
    const storagePath = `${userId}/${imageId}.png`;

    const { error } = await supabase.storage
      .from('chart-images')
      .upload(storagePath, blob, {
        contentType: blob.type || 'image/png',
        upsert: true,
      });

    if (error) {
      console.error('Error uploading chart image to Supabase', error);
      return null;
    }

    return storagePath;
  } catch (err) {
    console.error('Failed to convert and upload image', err);
    return null;
  }
}

/* ================= CLOUD CRUD OPERATIONS ================= */

export async function uploadReportToCloud(
  userId: string,
  report: SavedReport
): Promise<{ success: boolean; conflict?: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Supabase not configured' };

  try {
    // 1. Upload any attached images to cloud storage if they haven't been uploaded yet
    const sanitizedTimeframes = { ...report.timeframes };
    for (const tf of TIMEFRAME_ORDER) {
      const imgId = sanitizedTimeframes[tf]?.chartImageId;
      if (imgId && !imgId.includes('/')) {
        const localDataUrl = await getImage(imgId);
        if (localDataUrl && localDataUrl.startsWith('data:image')) {
          const cloudPath = await uploadChartImageToCloud(userId, imgId, localDataUrl);
          if (cloudPath) {
            sanitizedTimeframes[tf] = {
              ...sanitizedTimeframes[tf],
              chartImageId: cloudPath,
            };
          }
        }
      }
    }

    const localRevision = (report as SavedReport & { revision?: number }).revision || 1;
    let targetRevision = localRevision;

    // Check existing cloud record for optimistic concurrency
    const { data: existing } = await supabase
      .from('analyses')
      .select('revision, updated_at')
      .eq('user_id', userId)
      .eq('id', report.id)
      .maybeSingle();

    if (existing) {
      const cloudRevision = existing.revision || 1;
      const cloudUpdatedAt = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
      const localUpdatedAt = report.updatedAt || 0;

      // Only reject as conflict if cloud is strictly newer in BOTH revision and timestamp
      if (cloudRevision > localRevision && cloudUpdatedAt > localUpdatedAt) {
        return { success: false, conflict: true };
      }

      // Increment above the max of cloud and local revision
      targetRevision = Math.max(cloudRevision, localRevision) + 1;
    } else {
      targetRevision = Math.max(1, localRevision);
    }

    const payload: SavedReport = {
      ...report,
      timeframes: sanitizedTimeframes,
      revision: targetRevision,
    };

    const row = {
      id: report.id,
      user_id: userId,
      pair: report.pair || 'XAUUSD',
      date: report.date || new Date().toISOString().slice(0, 10),
      time: report.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      session: report.session || 'London',
      analysis_timing: report.analysisTiming || 'On time',
      overall_alignment: report.timeframes ? 'RECORDED' : 'PENDING',
      status: report.status || 'Original',
      is_modified: report.isModified || false,
      copied_from_id: report.copiedFromId || null,
      payload,
      revision: targetRevision,
      created_at: new Date(report.createdAt || Date.now()).toISOString(),
      updated_at: new Date(report.updatedAt || Date.now()).toISOString(),
    };

    if (existing) {
      // Database-level conditional revision update: only update if remote revision <= existing.revision
      const { data: updateData, error: updateError } = await supabase
        .from('analyses')
        .update(row)
        .eq('user_id', userId)
        .eq('id', report.id)
        .lte('revision', existing.revision || 1)
        .select('id, revision');

      if (updateError) {
        console.warn(`[CloudSync] Conditional update failed for report ${report.id}:`, updateError);
        return { success: false, error: updateError.message };
      }

      if (!updateData || updateData.length === 0) {
        console.warn(`[CloudSync] Optimistic concurrency conflict for report ${report.id}: remote revision advanced concurrently.`);
        return { success: false, conflict: true };
      }
    } else {
      const { error: insertError } = await supabase.from('analyses').insert(row);
      if (insertError) {
        // If conflict on concurrent insert, fall back to upsert
        const { error: upsertError } = await supabase.from('analyses').upsert(row, {
          onConflict: 'user_id,id',
        });
        if (upsertError) {
          console.warn(`[CloudSync] Upsert failed for report ${report.id}:`, upsertError);
          return { success: false, error: upsertError.message };
        }
      }
    }

    // Update local IndexedDB with assigned targetRevision to ensure local and cloud stay locked in step
    try {
      await saveReportDirectly(payload);
    } catch (e) {
      console.warn(`[CloudSync] Could not update local revision for report ${report.id}:`, e);
    }

    return { success: true };
  } catch (err) {
    console.error(`[CloudSync] Exception uploading report ${report.id}:`, err);
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteReportFromCloud(
  userId: string,
  reportId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false };

  try {
    const { error } = await supabase
      .from('analyses')
      .delete()
      .eq('user_id', userId)
      .eq('id', reportId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function uploadDraftToCloud(
  userId: string,
  draft: AnalysisData
): Promise<void> {
  if (!supabase) return;

  try {
    const row = {
      user_id: userId,
      draft_id: 'active_draft',
      pair: draft.pair,
      payload: draft,
      updated_at: new Date().toISOString(),
    };

    await supabase.from('drafts').upsert(row, { onConflict: 'user_id' });
  } catch (err) {
    console.error('Failed to sync draft to cloud', err);
  }
}

export async function clearDraftFromCloud(userId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('drafts').delete().eq('user_id', userId);
  } catch (err) {
    console.error('Failed to clear cloud draft', err);
  }
}

export async function uploadTemplateToCloud(
  userId: string,
  template: SavedTemplate
): Promise<void> {
  if (!supabase) return;

  try {
    const row = {
      id: template.id,
      user_id: userId,
      name: template.name,
      payload: template,
      created_at: new Date(template.createdAt).toISOString(),
      updated_at: new Date(template.updatedAt).toISOString(),
    };

    await supabase.from('templates').upsert(row, { onConflict: 'user_id,id' });
  } catch (err) {
    console.error('Failed to upload template to cloud', err);
  }
}

export async function deleteTemplateFromCloud(
  userId: string,
  templateId: string
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('templates').delete().eq('user_id', userId).eq('id', templateId);
  } catch (err) {
    console.error('Failed to delete cloud template', err);
  }
}

/* ================= FETCH ALL FROM CLOUD ================= */

export async function fetchAllUserCloudData(userId: string): Promise<{
  reports: SavedReport[];
  templates: SavedTemplate[];
  draft: AnalysisData | null;
}> {
  if (!supabase) return { reports: [], templates: [], draft: null };

  const [reportsRes, tmplsRes, draftRes] = await Promise.all([
    supabase
      .from('analyses')
      .select('id, revision, updated_at, payload')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
    supabase.from('templates').select('payload').eq('user_id', userId),
    supabase.from('drafts').select('payload').eq('user_id', userId).maybeSingle(),
  ]);

  if (reportsRes.error) {
    throw new Error(`Cloud query failed for analyses: ${reportsRes.error.message}`);
  }
  if (tmplsRes.error) {
    throw new Error(`Cloud query failed for templates: ${tmplsRes.error.message}`);
  }

  const reports: SavedReport[] = (reportsRes.data || [])
    .map((r) => {
      const p = r.payload as SavedReport;
      if (!p) return null;
      return {
        ...p,
        id: r.id || p.id,
        revision: r.revision || p.revision || 1,
      };
    })
    .filter(Boolean) as SavedReport[];

  const templates: SavedTemplate[] = (tmplsRes.data || [])
    .map((t) => t.payload as SavedTemplate)
    .filter(Boolean);

  const draft: AnalysisData | null = draftRes.data?.payload || null;

  return { reports, templates, draft };
}

/**
 * Safely synchronizes local IndexedDB and Supabase:
 * - Never overwrites newer local reports with older cloud data.
 * - Never deletes local work if cloud returns empty.
 * - Automatically uploads unsynced local reports to cloud.
 */
let activeSyncPromise: Promise<{ downloaded: number; uploaded: number; conflicts: number }> | null = null;

async function executeSyncOperation(userId: string): Promise<{
  downloaded: number;
  uploaded: number;
  conflicts: number;
}> {
  const [cloudData, localReports, localTemplates, deletedReportIdsList, pendingQueue] = await Promise.all([
    fetchAllUserCloudData(userId),
    getAllReports(),
    getAllTemplates(),
    getDeletedReportIds(),
    getPendingCloudQueue(),
  ]);

  let downloaded = 0;
  let uploaded = 0;
  let conflicts = 0;

  const deletedReportIds = new Set(deletedReportIdsList);
  const pendingReportIds = new Set(
    pendingQueue.filter((p) => p.type === 'report').map((p) => p.id)
  );

  // 1. Process pending intentional deletions to cloud only removing tombstone on confirmed success (Case C)
  for (const delId of deletedReportIds) {
    if (cloudData.reports.some((r) => r.id === delId)) {
      const delRes = await deleteReportFromCloud(userId, delId);
      if (delRes.success) {
        await removeDeletedReportId(delId);
        await removePendingCloudItem(delId);
      } else {
        console.warn(`[CloudSync] Cloud deletion failed for ${delId}, retaining tombstone for retry:`, delRes.error);
      }
    } else {
      // Already absent from cloud, clean up local tombstone safely
      await removeDeletedReportId(delId);
      await removePendingCloudItem(delId);
    }
  }

  const localReportsMap = new Map<string, SavedReport>();
  for (const rep of localReports) {
    localReportsMap.set(rep.id, rep);
  }

  // 2. Process cloud reports into local store with conflict preservation (Cases A & B)
  for (const cloudRep of cloudData.reports) {
    if (deletedReportIds.has(cloudRep.id)) {
      continue; // Intentionally deleted on this client; do not resurrect
    }

    const localRep = localReportsMap.get(cloudRep.id);
    if (!localRep) {
      // Cloud has report not present locally -> download to local
      await saveReportDirectly(cloudRep);
      downloaded++;
    } else {
      const cloudRev = cloudRep.revision || 1;
      const localRev = localRep.revision || 1;
      const cloudTime = cloudRep.updatedAt || 0;
      const localTime = localRep.updatedAt || 0;
      const hasPendingLocalEdit = pendingReportIds.has(localRep.id);

      if (cloudRev > localRev) {
        if (hasPendingLocalEdit) {
          // Case A Conflict: cloud has higher revision, but local user has unmerged edits!
          // Preserve BOTH: save local edits as an explicit backup copy so work is never silently lost
          const conflictCopy: SavedReport = {
            ...localRep,
            id: `rep_conflict_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            title: `${localRep.title || localRep.pair} (Local Conflict Copy)`,
            status: 'Modified',
            updatedAt: Date.now(),
            revision: localRev,
          };
          await saveReportDirectly(conflictCopy);
          await saveReportDirectly(cloudRep);
          await removePendingCloudItem(localRep.id);
          downloaded++;
          conflicts++;
          console.warn(`[CloudSync] Conflict detected for report ${localRep.id}. Preserved local edits as ${conflictCopy.id}.`);
        } else {
          // Clean cloud update: local has no pending edits
          await saveReportDirectly(cloudRep);
          downloaded++;
        }
      } else if (localRev > cloudRev) {
        // Local is newer -> upload to cloud
        const res = await uploadReportToCloud(userId, localRep);
        if (res.success) {
          uploaded++;
          await removePendingCloudItem(localRep.id);
        } else if (res.conflict) {
          conflicts++;
        }
      } else {
        // Case B: Equal revision numbers (cloudRev === localRev)
        if (cloudTime !== localTime && hasPendingLocalEdit) {
          // Divergent edits with same revision counter: preserve local edits as backup
          const conflictCopy: SavedReport = {
            ...localRep,
            id: `rep_conflict_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            title: `${localRep.title || localRep.pair} (Local Conflict Copy)`,
            status: 'Modified',
            updatedAt: Date.now(),
          };
          await saveReportDirectly(conflictCopy);
          await saveReportDirectly(cloudRep);
          await removePendingCloudItem(localRep.id);
          downloaded++;
          conflicts++;
        } else if (localTime > cloudTime) {
          const res = await uploadReportToCloud(userId, localRep);
          if (res.success) {
            uploaded++;
            await removePendingCloudItem(localRep.id);
          }
        }
      }
    }
  }

  // 3. Upload local reports absent from cloud, respecting account isolation (Case E)
  const cloudReportIds = new Set(cloudData.reports.map((r) => r.id));
  for (const localRep of localReports) {
    if (deletedReportIds.has(localRep.id)) continue;
    // Account isolation: do not automatically upload reports explicitly owned by a different account
    if (localRep.accountId && localRep.accountId !== 'local' && localRep.accountId !== userId) {
      continue;
    }
    if (!cloudReportIds.has(localRep.id)) {
      const res = await uploadReportToCloud(userId, { ...localRep, accountId: userId });
      if (res.success) {
        uploaded++;
        await removePendingCloudItem(localRep.id);
      }
    }
  }

  // 4. Process templates (Case D: upload both brand new and locally updated templates)
  const localTemplatesMap = new Map<string, SavedTemplate>();
  for (const t of localTemplates) {
    localTemplatesMap.set(t.id, t);
  }
  for (const cloudTmpl of cloudData.templates) {
    const localTmpl = localTemplatesMap.get(cloudTmpl.id);
    if (!localTmpl || (cloudTmpl.updatedAt || 0) > (localTmpl.updatedAt || 0)) {
      await saveTemplate(cloudTmpl);
      downloaded++;
    }
  }
  for (const localTmpl of localTemplates) {
    const cloudTmpl = cloudData.templates.find((ct) => ct.id === localTmpl.id);
    // Upload if absent from cloud OR if local template was updated more recently than cloud
    if (!cloudTmpl || (localTmpl.updatedAt || 0) > (cloudTmpl.updatedAt || 0)) {
      await uploadTemplateToCloud(userId, localTmpl);
      await removePendingCloudItem(localTmpl.id);
      uploaded++;
    }
  }

  return { downloaded, uploaded, conflicts };
}

export function isAutoSyncDisabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem('abmax_auto_sync_disabled') === 'true';
}

export async function syncBidirectionalWithCloud(userId: string): Promise<{
  downloaded: number;
  uploaded: number;
  conflicts: number;
}> {
  if (!supabase || !userId) return { downloaded: 0, uploaded: 0, conflicts: 0 };

  // Respect Automatic Sync Off preference
  if (isAutoSyncDisabled()) {
    return { downloaded: 0, uploaded: 0, conflicts: 0 };
  }

  // 1. In-tab deduplication: If a sync is already running in this tab, return it
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  // 2. Create the promise for in-tab callers
  activeSyncPromise = (async () => {
    try {
      // Verify account session hasn't switched before running
      const currentSession = await supabase.auth.getSession();
      if (currentSession?.data.session?.user.id !== userId) {
        return { downloaded: 0, uploaded: 0, conflicts: 0 };
      }

      // 3. Cross-tab coordination via standard Web Locks API (navigator.locks)
      if (typeof navigator !== 'undefined' && 'locks' in navigator && typeof navigator.locks?.request === 'function') {
        try {
          return await navigator.locks.request(`abmax_cloud_sync_${userId}`, async () => {
            return await executeSyncOperation(userId);
          });
        } catch (lockErr) {
          console.warn('[CloudSync] Web Locks request threw, executing sync with local coordination:', lockErr);
          return await executeSyncOperation(userId);
        }
      }

      // If Web Locks is not supported in the browser environment, execute directly
      return await executeSyncOperation(userId);
    } catch (err) {
      console.error('[CloudSync] Bidirectional sync error:', err);
      return { downloaded: 0, uploaded: 0, conflicts: 0 };
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

// Bounded reconnect handler: retry pending sync on network reconnect without infinite loops
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setTimeout(async () => {
      try {
        if (!isAutoSyncDisabled() && supabase) {
          const session = await supabase.auth.getSession();
          const uid = session?.data.session?.user.id;
          if (uid) {
            syncBidirectionalWithCloud(uid);
          }
        }
      } catch {
        // Best effort
      }
    }, 2000);
  });
}

/* ================= LOCAL DATA MIGRATION ENGINE ================= */

export interface MigrationPreview {
  reportsCount: number;
  templatesCount: number;
  hasDraft: boolean;
  imagesCount: number;
}

export async function getLocalDataCounts(): Promise<MigrationPreview> {
  const [reports, templates, draft, images] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
  ]);

  return {
    reportsCount: reports.length,
    templatesCount: templates.length,
    hasDraft: Boolean(draft),
    imagesCount: images.length,
  };
}

export async function migrateLocalDataToCloud(
  userId: string,
  onProgress?: (step: string, percent: number) => void
): Promise<{
  uploadedReports: number;
  uploadedTemplates: number;
  uploadedImages: number;
  skippedReports: number;
}> {
  if (!supabase) throw new Error('Supabase is not configured.');

  onProgress?.('Reading local journal records...', 10);
  const [reports, templates, draft, images] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
  ]);

  let uploadedImages = 0;
  let uploadedReports = 0;
  let skippedReports = 0;
  let uploadedTemplates = 0;

  // 1. Upload screenshots first
  const imageMap = new Map<string, string>(); // localId -> cloudPath
  const totalImages = images.length;
  for (let i = 0; i < totalImages; i++) {
    const img = images[i];
    onProgress?.(`Uploading chart image ${i + 1}/${totalImages}...`, 10 + Math.round((i / (totalImages || 1)) * 30));
    try {
      const cloudPath = await uploadChartImageToCloud(userId, img.id, img.dataUrl);
      if (cloudPath) {
        imageMap.set(img.id, cloudPath);
        uploadedImages++;
      }
    } catch (e) {
      console.warn(`Could not upload image ${img.id}`, e);
    }
  }

  // 2. Upload reports (avoid duplicate overwriting of newer cloud records)
  const totalReports = reports.length;
  for (let i = 0; i < totalReports; i++) {
    const rep = reports[i];
    onProgress?.(`Uploading report ${i + 1}/${totalReports}...`, 40 + Math.round((i / (totalReports || 1)) * 35));

    // Remap local image IDs to cloud paths in payload
    const updatedTfs = { ...rep.timeframes };
    for (const tf of TIMEFRAME_ORDER) {
      const imgId = updatedTfs[tf]?.chartImageId;
      if (imgId && imageMap.has(imgId)) {
        updatedTfs[tf] = {
          ...updatedTfs[tf],
          chartImageId: imageMap.get(imgId),
        };
      }
    }

    const payloadToUpload: SavedReport = {
      ...rep,
      timeframes: updatedTfs,
    };

    const res = await uploadReportToCloud(userId, payloadToUpload);
    if (res.success) {
      uploadedReports++;
    } else {
      skippedReports++;
    }
  }

  // 3. Upload templates
  const totalTmpls = templates.length;
  for (let i = 0; i < totalTmpls; i++) {
    const tmpl = templates[i];
    onProgress?.(`Uploading template ${i + 1}/${totalTmpls}...`, 75 + Math.round((i / (totalTmpls || 1)) * 15));
    await uploadTemplateToCloud(userId, tmpl);
    uploadedTemplates++;
  }

  // 4. Upload draft if any
  if (draft) {
    onProgress?.('Syncing active draft...', 95);
    await uploadDraftToCloud(userId, draft);
  }

  onProgress?.('Migration completed successfully!', 100);

  return {
    uploadedReports,
    uploadedTemplates,
    uploadedImages,
    skippedReports,
  };
}

/* ================= USER PREFERENCES SYNC ================= */

export async function uploadPreferencesToCloud(
  userId: string,
  theme: 'light' | 'dark',
  preferences: Record<string, any>
): Promise<void> {
  if (!supabase) return;
  try {
    const row = {
      user_id: userId,
      theme,
      preferences,
      updated_at: new Date().toISOString(),
    };
    await supabase.from('user_preferences').upsert(row, { onConflict: 'user_id' });
  } catch (err) {
    console.warn('Failed to upload user preferences to cloud', err);
  }
}

export async function fetchPreferencesFromCloud(
  userId: string
): Promise<{ theme?: 'light' | 'dark'; preferences?: Record<string, any> } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('theme, preferences')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      theme: data.theme as 'light' | 'dark',
      preferences: data.preferences,
    };
  } catch {
    return null;
  }
}

