import {
  AnalysisData,
  BackupData,
  DEFAULT_REPORT_PRESENTATION,
  DEFAULT_REPORT_VISIBILITY,
  ImageAttachment,
  ReportPresentationConfig,
  SavedReport,
  SavedTemplate,
} from '../types/journal';

const DB_NAME = 'abmax_analysis_db';
const DB_VERSION = 1;

interface DBStores {
  reports: SavedReport;
  draft: AnalysisData & { id: string };
  templates: SavedTemplate;
  images: ImageAttachment;
  preferences: { key: string; value: unknown };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Migration for version 1
      if (!db.objectStoreNames.contains('reports')) {
        const reportStore = db.createObjectStore('reports', { keyPath: 'id' });
        reportStore.createIndex('date', 'date', { unique: false });
        reportStore.createIndex('pair', 'pair', { unique: false });
        reportStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains('draft')) {
        db.createObjectStore('draft', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('templates')) {
        const tmplStore = db.createObjectStore('templates', { keyPath: 'id' });
        tmplStore.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open database'));
  });
}

function runTransaction<T>(
  storeName: keyof DBStores,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result: T;
        const request = callback(store);

        request.onsuccess = () => {
          result = request.result;
          if (mode === 'readonly') {
            resolve(result);
          }
        };
        request.onerror = () => reject(request.error ?? new Error(`Request failed on store: ${storeName}`));

        tx.oncomplete = () => {
          if (mode === 'readwrite') {
            resolve(result);
          }
        };
        tx.onerror = () => reject(tx.error ?? new Error(`Transaction failed on store: ${storeName}`));
        tx.onabort = () => reject(tx.error ?? new Error(`Transaction aborted on store: ${storeName}`));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/* ================= REPORTS ================= */

export async function getAllReports(): Promise<SavedReport[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const request = store.getAll();

    request.onsuccess = () => {
      const reports = (request.result as SavedReport[]) || [];
      // Sort newest date first, then newest createdAt
      reports.sort((a, b) => {
        if (a.date !== b.date) {
          return (b.date || '').localeCompare(a.date || '');
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      resolve(reports);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getReportById(id: string): Promise<SavedReport | null> {
  try {
    const report = await runTransaction<SavedReport | undefined>('reports', 'readonly', (store) =>
      store.get(id)
    );
    return report || null;
  } catch (err) {
    console.error(`[DB] Error fetching report by ID ${id}:`, err);
    return null;
  }
}

/**
 * Saves a report to IndexedDB, awaits transaction completion, and verifies read-back.
 */
export async function saveReport(report: SavedReport): Promise<SavedReport> {
  if (!report.id || report.id === 'active_draft' || report.id === 'draft') {
    throw new Error('Invalid report ID: cannot save report with draft identity.');
  }

  // Ensure revision is tracked and incremented
  const existing = await getReportById(report.id);
  const targetRevision = Math.max(existing?.revision || 0, report.revision || 0) + 1;
  const sanitizedReport: SavedReport = {
    ...report,
    revision: targetRevision,
    openingCandles: report.openingCandles || [],
    updatedAt: report.updatedAt || Date.now(),
    createdAt: report.createdAt || Date.now(),
    pair: report.pair || 'XAUUSD',
    date: report.date || new Date().toISOString().slice(0, 10),
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('reports', 'readwrite');
      const store = tx.objectStore('reports');
      const req = store.put(sanitizedReport);

      req.onerror = () => reject(req.error ?? new Error('Failed to put report record'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Report save transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Report save transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });

  // Read-back verification: verify identity, revision, and persistence before reporting success
  const verified = await getReportById(sanitizedReport.id);
  if (!verified || verified.id !== sanitizedReport.id || verified.revision !== targetRevision) {
    throw new Error(`Storage integrity check failed: report ${sanitizedReport.id} could not be verified with revision ${targetRevision} after save.`);
  }

  // Ensure deletion tombstone is cleared if re-saving, and track pending cloud sync
  await removeDeletedReportId(sanitizedReport.id);
  await addPendingCloudItem({ id: sanitizedReport.id, type: 'report', timestamp: Date.now() });

  return verified;
}

/**
 * Saves a report directly (e.g. from cloud sync) preserving exact revision without incrementing.
 */
export async function saveReportDirectly(report: SavedReport): Promise<SavedReport> {
  if (!report.id || report.id === 'active_draft' || report.id === 'draft') {
    throw new Error('Invalid report ID: cannot save report with draft identity.');
  }

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('reports', 'readwrite');
      const store = tx.objectStore('reports');
      const req = store.put(report);

      req.onerror = () => reject(req.error ?? new Error('Failed to put report record directly'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Report direct save transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Report direct save transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });

  return report;
}

/* ================= INTENTIONAL DELETION TRACKING & PENDING CLOUD QUEUE ================= */

export interface PendingCloudItem {
  id: string;
  type: 'report' | 'delete' | 'template';
  timestamp: number;
}

export async function getDeletedReportIds(): Promise<string[]> {
  try {
    const record = await runTransaction<{ key: string; value: string[] } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('deleted_report_ids')
    );
    return Array.isArray(record?.value) ? record.value : [];
  } catch {
    return [];
  }
}

export async function markReportDeleted(id: string): Promise<void> {
  try {
    const existing = await getDeletedReportIds();
    if (!existing.includes(id)) {
      const updated = [...existing, id];
      await runTransaction('preferences', 'readwrite', (store) =>
        store.put({ key: 'deleted_report_ids', value: updated })
      );
    }
  } catch (err) {
    console.warn('[DB] Could not record intentional deletion tombstone:', err);
  }
}

export async function removeDeletedReportId(id: string): Promise<void> {
  try {
    const existing = await getDeletedReportIds();
    if (existing.includes(id)) {
      const updated = existing.filter((item) => item !== id);
      await runTransaction('preferences', 'readwrite', (store) =>
        store.put({ key: 'deleted_report_ids', value: updated })
      );
    }
  } catch (err) {
    console.warn('[DB] Could not remove deletion tombstone:', err);
  }
}

export async function getPendingCloudQueue(): Promise<PendingCloudItem[]> {
  try {
    const record = await runTransaction<{ key: string; value: PendingCloudItem[] } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('pending_cloud_queue')
    );
    return Array.isArray(record?.value) ? record.value : [];
  } catch {
    return [];
  }
}

export async function addPendingCloudItem(item: PendingCloudItem): Promise<void> {
  try {
    const queue = await getPendingCloudQueue();
    const filtered = queue.filter((i) => i.id !== item.id);
    filtered.push(item);
    await runTransaction('preferences', 'readwrite', (store) =>
      store.put({ key: 'pending_cloud_queue', value: filtered })
    );
  } catch (err) {
    console.warn('[DB] Could not record pending cloud queue item:', err);
  }
}

export async function removePendingCloudItem(id: string): Promise<void> {
  try {
    const queue = await getPendingCloudQueue();
    const filtered = queue.filter((i) => i.id !== id);
    await runTransaction('preferences', 'readwrite', (store) =>
      store.put({ key: 'pending_cloud_queue', value: filtered })
    );
  } catch (err) {
    console.warn('[DB] Could not remove pending cloud queue item:', err);
  }
}

export async function deleteReport(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('reports', 'readwrite');
      const store = tx.objectStore('reports');
      const req = store.delete(id);

      req.onerror = () => reject(req.error ?? new Error('Failed to delete report record'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Report delete transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Report delete transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });

  // Track intentional deletion so bidirectional cloud synchronization does not resurrect it
  await markReportDeleted(id);
  await addPendingCloudItem({ id, type: 'delete', timestamp: Date.now() });
}

/* ================= DRAFT ================= */

const DRAFT_KEY = 'active_draft';

export async function getDraft(): Promise<AnalysisData | null> {
  try {
    const raw = await runTransaction<(AnalysisData & { id: string; originalId?: string }) | undefined>(
      'draft',
      'readonly',
      (store) => store.get(DRAFT_KEY)
    );
    if (!raw) return null;
    // Restore the genuine report ID if preserved, or keep a stable originalId
    const stableId = raw.originalId && raw.originalId !== DRAFT_KEY
      ? raw.originalId
      : (raw.id && raw.id !== DRAFT_KEY ? raw.id : `rep_${raw.createdAt || Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

    return {
      ...raw,
      id: stableId,
      originalId: stableId,
    };
  } catch (err) {
    console.error('[DB] Error fetching draft:', err);
    return null;
  }
}

export async function saveDraft(draft: AnalysisData): Promise<void> {
  const originalId = draft.originalId || (draft.id && draft.id !== DRAFT_KEY ? draft.id : `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  const payload = {
    ...draft,
    originalId,
    id: DRAFT_KEY, // required by keyPath in indexedDB draft store
    updatedAt: Date.now(),
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('draft', 'readwrite');
      const store = tx.objectStore('draft');
      const req = store.put(payload);

      req.onerror = () => reject(req.error ?? new Error('Failed to save draft'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Draft transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Draft transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function clearDraft(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('draft', 'readwrite');
      const store = tx.objectStore('draft');
      const req = store.delete(DRAFT_KEY);

      req.onerror = () => reject(req.error ?? new Error('Failed to clear draft'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Clear draft transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Clear draft transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

/* ================= USER VISIBILITY PREFERENCES ================= */

export async function getUserVisibilityConfig(): Promise<any | null> {
  try {
    const record = await runTransaction<{ key: string; value: any } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('workspace_visibility')
    );
    return record ? record.value : null;
  } catch {
    return null;
  }
}

export async function saveUserVisibilityConfig(config: any): Promise<void> {
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key: 'workspace_visibility', value: config })
  );
}

/* ================= USER REPORT PRESENTATION PREFERENCES ================= */

export async function getUserReportPresentationConfig(): Promise<ReportPresentationConfig> {
  try {
    const record = await runTransaction<{ key: string; value: ReportPresentationConfig } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('report_presentation_config')
    );
    if (!record?.value) {
      return DEFAULT_REPORT_PRESENTATION;
    }
    const val = record.value;
    return {
      ...DEFAULT_REPORT_PRESENTATION,
      ...val,
      sectionVisibility: {
        general: {
          ...DEFAULT_REPORT_VISIBILITY.general,
          ...(val.sectionVisibility?.general || {}),
        },
        timeframes: {
          ...DEFAULT_REPORT_VISIBILITY.timeframes,
          ...(val.sectionVisibility?.timeframes || {}),
        },
        timeframeFields: {
          ...DEFAULT_REPORT_VISIBILITY.timeframeFields,
          ...(val.sectionVisibility?.timeframeFields || {}),
        },
        notesAndLevels: {
          ...DEFAULT_REPORT_VISIBILITY.notesAndLevels,
          ...(val.sectionVisibility?.notesAndLevels || {}),
        },
        scenariosAndTrades: {
          ...DEFAULT_REPORT_VISIBILITY.scenariosAndTrades,
          ...(val.sectionVisibility?.scenariosAndTrades || {}),
        },
      },
      pdfImages: {
        ...DEFAULT_REPORT_PRESENTATION.pdfImages,
        ...(val.pdfImages || {}),
      },
    };
  } catch {
    return { ...DEFAULT_REPORT_PRESENTATION };
  }
}

export async function saveUserReportPresentationConfig(
  config: ReportPresentationConfig
): Promise<void> {
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key: 'report_presentation_config', value: config })
  );
}

/* ================= TEMPLATES ================= */

export async function getAllTemplates(): Promise<SavedTemplate[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('templates', 'readonly');
    const store = tx.objectStore('templates');
    const req = store.getAll();

    req.onsuccess = () => {
      const list = (req.result as SavedTemplate[]) || [];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getTemplateById(id: string): Promise<SavedTemplate | null> {
  const record = await runTransaction<SavedTemplate | undefined>('templates', 'readonly', (store) =>
    store.get(id)
  );
  return record || null;
}

export async function saveTemplate(template: SavedTemplate): Promise<void> {
  await runTransaction('templates', 'readwrite', (store) => store.put(template));
}

export async function renameTemplate(id: string, newName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('templates', 'readwrite');
    const store = tx.objectStore('templates');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const tmpl = getReq.result as SavedTemplate | undefined;
      if (!tmpl) {
        reject(new Error('Template not found'));
        return;
      }
      tmpl.name = newName.trim();
      tmpl.updatedAt = Date.now();
      const putReq = store.put(tmpl);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await runTransaction('templates', 'readwrite', (store) => store.delete(id));
}

/* ================= IMAGES ================= */

export async function saveImage(dataUrl: string, name?: string): Promise<string> {
  const id = `img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const item: ImageAttachment = {
    id,
    dataUrl,
    name,
    createdAt: Date.now(),
  };
  await runTransaction('images', 'readwrite', (store) => store.put(item));
  return id;
}

export async function getImage(id: string): Promise<string | null> {
  try {
    const item = await runTransaction<ImageAttachment | undefined>('images', 'readonly', (store) =>
      store.get(id)
    );
    return item ? item.dataUrl : null;
  } catch (err) {
    console.error('Error fetching image', err);
    return null;
  }
}

export async function deleteImage(id: string): Promise<void> {
  try {
    await runTransaction('images', 'readwrite', (store) => store.delete(id));
  } catch (err) {
    console.error('Error deleting image', err);
  }
}

export async function getAllImages(): Promise<ImageAttachment[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readonly');
    const store = tx.objectStore('images');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as ImageAttachment[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/* ================= BACKUP & RESTORE ================= */

export async function createFullBackup(): Promise<BackupData> {
  const [reports, templates, draft, images, presentationConfig] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
    getUserReportPresentationConfig(),
  ]);

  const theme =
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('abmax_theme') as 'light' | 'dark')
      : null) || 'light';

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'ABMAX_ANALYSIS',
    reports,
    templates,
    draft,
    images,
    preferences: {
      theme,
      presentationConfig,
    },
  };
}

export interface RestorePreview {
  totalReportsInBackup: number;
  newReportsCount: number;
  skippedReportsCount: number;
  totalTemplatesInBackup: number;
  newTemplatesCount: number;
  skippedTemplatesCount: number;
  hasDraft: boolean;
  imagesCount: number;
}

export async function analyzeBackup(backup: BackupData): Promise<RestorePreview> {
  const existingReports = await getAllReports();
  const existingTemplates = await getAllTemplates();

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));

  let newReportsCount = 0;
  let skippedReportsCount = 0;
  for (const r of backup.reports || []) {
    if (existingReportIds.has(r.id)) {
      skippedReportsCount++;
    } else {
      newReportsCount++;
    }
  }

  let newTemplatesCount = 0;
  let skippedTemplatesCount = 0;
  for (const t of backup.templates || []) {
    if (existingTemplateIds.has(t.id)) {
      skippedTemplatesCount++;
    } else {
      newTemplatesCount++;
    }
  }

  return {
    totalReportsInBackup: backup.reports?.length || 0,
    newReportsCount,
    skippedReportsCount,
    totalTemplatesInBackup: backup.templates?.length || 0,
    newTemplatesCount,
    skippedTemplatesCount,
    hasDraft: Boolean(backup.draft),
    imagesCount: backup.images?.length || 0,
  };
}

export async function restoreBackup(
  backup: BackupData,
  options: { restoreDraft?: boolean } = {}
): Promise<{ addedReports: number; addedTemplates: number; addedImages: number }> {
  const db = await openDB();
  const existingReports = await getAllReports();
  const existingTemplates = await getAllTemplates();

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));

  let addedReports = 0;
  let addedTemplates = 0;
  let addedImages = 0;

  // Add reports that don't already exist
  const reportTx = db.transaction('reports', 'readwrite');
  const reportStore = reportTx.objectStore('reports');
  for (const r of backup.reports || []) {
    if (!existingReportIds.has(r.id)) {
      reportStore.put(r);
      addedReports++;
    }
  }
  await new Promise<void>((res, rej) => {
    reportTx.oncomplete = () => res();
    reportTx.onerror = () => rej(reportTx.error);
  });

  // Add templates that don't already exist
  const tmplTx = db.transaction('templates', 'readwrite');
  const tmplStore = tmplTx.objectStore('templates');
  for (const t of backup.templates || []) {
    if (!existingTemplateIds.has(t.id)) {
      tmplStore.put(t);
      addedTemplates++;
    }
  }
  await new Promise<void>((res, rej) => {
    tmplTx.oncomplete = () => res();
    tmplTx.onerror = () => rej(tmplTx.error);
  });

  // Restore images
  const imgTx = db.transaction('images', 'readwrite');
  const imgStore = imgTx.objectStore('images');
  for (const img of backup.images || []) {
    imgStore.put(img);
    addedImages++;
  }
  await new Promise<void>((res, rej) => {
    imgTx.oncomplete = () => res();
    imgTx.onerror = () => rej(imgTx.error);
  });

  // Optionally restore draft if requested and available
  if (options.restoreDraft && backup.draft) {
    await saveDraft(backup.draft);
  }

  // Restore theme preference
  if (backup.preferences?.theme && typeof localStorage !== 'undefined') {
    localStorage.setItem('abmax_theme', backup.preferences.theme);
  }

  // Restore report presentation preference if present
  if (backup.preferences?.presentationConfig) {
    await saveUserReportPresentationConfig(backup.preferences.presentationConfig);
  }

  return { addedReports, addedTemplates, addedImages };
}
