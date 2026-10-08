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
  saveTemplate,
  saveDraft,
  saveImage,
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

    const currentRevision = (report as SavedReport & { revision?: number }).revision || 1;

    // Check existing cloud record for optimistic concurrency
    const { data: existing } = await supabase
      .from('analyses')
      .select('revision, updated_at')
      .eq('user_id', userId)
      .eq('id', report.id)
      .maybeSingle();

    if (existing && existing.revision > currentRevision) {
      // Cloud has a newer revision!
      return { success: false, conflict: true };
    }

    const payload = {
      ...report,
      timeframes: sanitizedTimeframes,
      revision: currentRevision + 1,
    };

    const row = {
      id: report.id,
      user_id: userId,
      pair: report.pair,
      date: report.date,
      time: report.time,
      session: report.session,
      analysis_timing: report.analysisTiming,
      overall_alignment: report.timeframes ? 'RECORDED' : 'PENDING',
      status: report.status || 'Original',
      is_modified: report.isModified || false,
      copied_from_id: report.copiedFromId || null,
      payload,
      revision: currentRevision + 1,
      created_at: new Date(report.createdAt).toISOString(),
      updated_at: new Date(report.updatedAt).toISOString(),
    };

    const { error } = await supabase.from('analyses').upsert(row, {
      onConflict: 'user_id,id',
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
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
      .select('payload')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
    supabase.from('templates').select('payload').eq('user_id', userId),
    supabase.from('drafts').select('payload').eq('user_id', userId).maybeSingle(),
  ]);

  const reports: SavedReport[] = (reportsRes.data || [])
    .map((r) => r.payload as SavedReport)
    .filter(Boolean);

  const templates: SavedTemplate[] = (tmplsRes.data || [])
    .map((t) => t.payload as SavedTemplate)
    .filter(Boolean);

  const draft: AnalysisData | null = draftRes.data?.payload || null;

  return { reports, templates, draft };
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
