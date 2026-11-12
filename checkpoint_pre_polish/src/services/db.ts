import {
  AnalysisData,
  BackupData,
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  DEFAULT_REPORT_PRESENTATION,
  DEFAULT_REPORT_VISIBILITY,
  ImageAttachment,
  JournalEntry,
  JournalVisibilityConfig,
  PerformanceVisibilityConfig,
  ReportPresentationConfig,
  SavedReport,
  SavedTemplate,
  WorkspaceVisibilityConfig,
  normalizeJournalVisibilityConfig,
  normalizePerformanceVisibilityConfig,
  normalizeWorkspaceVisibilityConfig,
  normalizeReportVisibilityConfig,
} from '../types/journal';

const DB_NAME = 'abmax_analysis_db';
const DB_VERSION = 3; // Version 3 adds journal and journal_draft stores

interface DBStores {
  reports: SavedReport;
  draft: AnalysisData & { id: string };
  templates: SavedTemplate;
  images: ImageAttachment;
  preferences: { key: string; value: unknown };
  journal: JournalEntry;
  journal_draft: { id: string; data: Partial<JournalEntry> };
}

let cachedDB: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;

export function getCachedDB(): IDBDatabase | null {
  return cachedDB;
}

export function closeDBConnection(): void {
  if (cachedDB) {
    try {
      cachedDB.close();
    } catch {
      // Ignore
    }
    cachedDB = null;
  }
  dbOpenPromise = null;
}

function openDB(): Promise<IDBDatabase> {
  if (cachedDB) {
    return Promise.resolve(cachedDB);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    // Request persistent storage on PWA and Android WebView to prevent OS eviction
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }

    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available on this platform.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Ensure all stores exist even if upgrading from an earlier version
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

      if (!db.objectStoreNames.contains('journal')) {
        const jrnStore = db.createObjectStore('journal', { keyPath: 'id' });
        jrnStore.createIndex('date', 'date', { unique: false });
        jrnStore.createIndex('createdAt', 'createdAt', { unique: false });
        jrnStore.createIndex('pair', 'pair', { unique: false });
        jrnStore.createIndex('session', 'session', { unique: false });
      }

      if (!db.objectStoreNames.contains('journal_draft')) {
        db.createObjectStore('journal_draft', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      cachedDB = request.result;
      cachedDB.onclose = () => {
        cachedDB = null;
        dbOpenPromise = null;
      };
      cachedDB.onversionchange = () => {
        closeDBConnection();
      };
      resolve(cachedDB);
    };

    request.onerror = () => {
      cachedDB = null;
      dbOpenPromise = null;
      reject(request.error ?? new Error('Failed to open database'));
    };

    request.onblocked = () => {
      console.warn('[DB] Database open blocked by another open connection.');
    };
  });

  return dbOpenPromise;
}

/**
 * Deep clones an object safely, removing non-cloneable symbols/prototypes
 * without throwing or losing valid JSON data.
 */
export function safeClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (err) {
    console.warn('[DB] Fallback clone used for non-strictly serializable payload:', err);
    if (Array.isArray(obj)) {
      return [...obj] as unknown as T;
    }
    return { ...obj };
  }
}

function runTransaction<T>(
  storeName: keyof DBStores,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then((db) => {
    return new Promise((resolve, reject) => {
      try {
        if (!db.objectStoreNames.contains(storeName)) {
          reject(new Error(`Object store '${storeName}' does not exist in database.`));
          return;
        }

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

export interface AtomicUpdateResult {
  success: boolean;
  conflict?: boolean;
  notFound?: boolean;
  currentRevision?: number;
  expectedRevision?: number;
  report?: SavedReport;
  error?: string;
}

/**
 * Atomically updates an existing report within a SINGLE IndexedDB readwrite transaction.
 * 1. Reads the existing record from the store.
 * 2. Verifies the report exists.
 * 3. Enforces that current disk revision matches expectedSourceRevision strictly (handling legacy/missing revisions).
 * 4. Writes the incremented revision to the store.
 * If another tab or concurrent write modified the report, it safely halts without writing.
 */
export async function updateReportAtomically(
  report: SavedReport,
  expectedSourceRevision: number
): Promise<AtomicUpdateResult> {
  if (!report.id || report.id === 'active_draft' || report.id === 'draft') {
    throw new Error('Invalid report ID: cannot update report with draft identity.');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('reports', 'readwrite');
      const store = tx.objectStore('reports');
      const getReq = store.get(report.id);

      getReq.onerror = () => reject(getReq.error ?? new Error('Failed to read report in transaction'));

      getReq.onsuccess = () => {
        const existing: SavedReport | undefined = getReq.result;
        if (!existing) {
          resolve({
            success: false,
            notFound: true,
            error: `Original report ${report.id} not found in storage.`,
          });
          return;
        }

        // Handle missing or legacy revision values explicitly (default legacy to 1)
        const currentRevision = typeof existing.revision === 'number' && Number.isFinite(existing.revision)
          ? existing.revision
          : 1;

        if (currentRevision !== expectedSourceRevision) {
          resolve({
            success: false,
            conflict: true,
            currentRevision,
            expectedRevision: expectedSourceRevision,
            error: `Concurrency conflict on report ${report.id}: expected revision ${expectedSourceRevision}, found disk revision ${currentRevision}.`,
          });
          return;
        }

        const nextRevision = currentRevision + 1;
        const sanitized: SavedReport = JSON.parse(
          JSON.stringify({
            ...existing,
            ...report,
            id: existing.id,
            createdAt: existing.createdAt || report.createdAt || Date.now(),
            revision: nextRevision,
            updatedAt: Date.now(),
            status: 'Modified',
            isModified: true,
          })
        );

        const putReq = store.put(sanitized);
        putReq.onerror = () => reject(putReq.error ?? new Error('Failed to put updated report in transaction'));

        tx.oncomplete = () => {
          removeDeletedReportId(sanitized.id).catch(() => {});
          addPendingCloudItem({ id: sanitized.id, type: 'report', timestamp: Date.now() }).catch(() => {});
          resolve({ success: true, report: sanitized });
        };
      };

      tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Saves a report to IndexedDB within a SINGLE readwrite transaction, awaiting transaction completion.
 */
export async function saveReport(report: SavedReport): Promise<SavedReport> {
  if (!report.id || report.id === 'active_draft' || report.id === 'draft') {
    throw new Error('Invalid report ID: cannot save report with draft identity.');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('reports', 'readwrite');
      const store = tx.objectStore('reports');
      const getReq = store.get(report.id);

      getReq.onerror = () => reject(getReq.error ?? new Error('Failed to check existing report'));

      getReq.onsuccess = () => {
        const existing: SavedReport | undefined = getReq.result;
        const currentRev = typeof existing?.revision === 'number' ? existing.revision : 0;
        const reportRev = typeof report.revision === 'number' ? report.revision : 0;
        const targetRevision = Math.max(currentRev, reportRev) + 1;

        const sanitizedReport: SavedReport = JSON.parse(
          JSON.stringify({
            ...report,
            revision: targetRevision,
            openingCandles: report.openingCandles || [],
            updatedAt: report.updatedAt || Date.now(),
            createdAt: report.createdAt || Date.now(),
            pair: report.pair || 'XAUUSD',
            date: report.date || new Date().toISOString().slice(0, 10),
          })
        );

        const putReq = store.put(sanitizedReport);
        putReq.onerror = () => reject(putReq.error ?? new Error('Failed to put report record'));

        tx.oncomplete = () => {
          removeDeletedReportId(sanitizedReport.id).catch(() => {});
          addPendingCloudItem({ id: sanitizedReport.id, type: 'report', timestamp: Date.now() }).catch(() => {});
          resolve(sanitizedReport);
        };
      };

      tx.onerror = () => reject(tx.error ?? new Error('Report save transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Report save transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
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
    updatedAt: draft.updatedAt || Date.now(),
  };

  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('draft', 'readwrite');
      const store = tx.objectStore('draft');
      const getReq = store.get(DRAFT_KEY);

      getReq.onerror = () => reject(getReq.error ?? new Error('Failed to inspect existing draft'));

      getReq.onsuccess = () => {
        const existing = getReq.result;
        // If an existing draft on disk has a strictly newer timestamp, do not overwrite it
        if (existing && typeof existing.updatedAt === 'number' && typeof payload.updatedAt === 'number') {
          if (existing.updatedAt > payload.updatedAt) {
            resolve();
            return;
          }
        }

        const req = store.put(payload);
        req.onerror = () => reject(req.error ?? new Error('Failed to save draft'));
        tx.oncomplete = () => resolve();
      };

      tx.onerror = () => reject(tx.error ?? new Error('Draft transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Draft transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function clearDraft(maxUpdatedAtToClear?: number): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('draft', 'readwrite');
      const store = tx.objectStore('draft');

      if (typeof maxUpdatedAtToClear === 'number') {
        const getReq = store.get(DRAFT_KEY);
        getReq.onerror = () => reject(getReq.error ?? new Error('Failed to check draft timestamp'));
        getReq.onsuccess = () => {
          const existing = getReq.result;
          // If disk has newer changes written during or after the save snapshot, do NOT delete them!
          if (existing && typeof existing.updatedAt === 'number' && existing.updatedAt > maxUpdatedAtToClear) {
            resolve();
            return;
          }
          const delReq = store.delete(DRAFT_KEY);
          delReq.onerror = () => reject(delReq.error ?? new Error('Failed to clear draft'));
          tx.oncomplete = () => resolve();
        };
      } else {
        const req = store.delete(DRAFT_KEY);
        req.onerror = () => reject(req.error ?? new Error('Failed to clear draft'));
        tx.oncomplete = () => resolve();
      }

      tx.onerror = () => reject(tx.error ?? new Error('Clear draft transaction failed on commit'));
      tx.onabort = () => reject(tx.error ?? new Error('Clear draft transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

/* ================= USER VISIBILITY PREFERENCES ================= */

export async function getUserVisibilityConfig(): Promise<WorkspaceVisibilityConfig | null> {
  try {
    const record = await runTransaction<{ key: string; value: any } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('workspace_visibility')
    );
    return record?.value ? normalizeWorkspaceVisibilityConfig(record.value) : null;
  } catch {
    return null;
  }
}

export async function saveUserVisibilityConfig(config: any): Promise<void> {
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key: 'workspace_visibility', value: config })
  );
}

/* ================= JOURNAL & PERFORMANCE VISIBILITY PREFERENCES ================= */

export async function getUserJournalVisibilityConfig(): Promise<JournalVisibilityConfig> {
  try {
    const record = await runTransaction<{ key: string; value: unknown } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('journal_visibility')
    );
    return record?.value ? normalizeJournalVisibilityConfig(record.value) : DEFAULT_JOURNAL_VISIBILITY_CONFIG;
  } catch {
    return DEFAULT_JOURNAL_VISIBILITY_CONFIG;
  }
}

export async function saveUserJournalVisibilityConfig(config: JournalVisibilityConfig): Promise<void> {
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key: 'journal_visibility', value: normalizeJournalVisibilityConfig(config) })
  );
}

export async function getUserPerformanceVisibilityConfig(): Promise<PerformanceVisibilityConfig> {
  try {
    const record = await runTransaction<{ key: string; value: unknown } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get('performance_visibility')
    );
    return record?.value ? normalizePerformanceVisibilityConfig(record.value) : DEFAULT_PERFORMANCE_VISIBILITY_CONFIG;
  } catch {
    return DEFAULT_PERFORMANCE_VISIBILITY_CONFIG;
  }
}

export async function saveUserPerformanceVisibilityConfig(config: PerformanceVisibilityConfig): Promise<void> {
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key: 'performance_visibility', value: normalizePerformanceVisibilityConfig(config) })
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
      sectionVisibility: normalizeReportVisibilityConfig(val.sectionVisibility),
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
  if (!db.objectStoreNames.contains('templates')) {
    console.warn('[DB] templates store not present in active database schema, returning empty list');
    return [];
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('templates', 'readonly');
    const store = tx.objectStore('templates');
    const req = store.getAll();

    req.onsuccess = () => {
      const list = (req.result as SavedTemplate[]) || [];
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getTemplateById(id: string): Promise<SavedTemplate | null> {
  const db = await openDB();
  if (!db.objectStoreNames.contains('templates')) {
    return null;
  }
  const record = await runTransaction<SavedTemplate | undefined>('templates', 'readonly', (store) =>
    store.get(id)
  );
  return record || null;
}

export async function saveTemplate(template: SavedTemplate): Promise<void> {
  const safeTemplate: SavedTemplate = safeClone(template);
  await runTransaction('templates', 'readwrite', (store) => store.put(safeTemplate));
  const verified = await getTemplateById(safeTemplate.id);
  if (!verified) {
    throw new Error(`Storage integrity check failed: template ${safeTemplate.id} could not be verified after save.`);
  }
  await addPendingCloudItem({ id: safeTemplate.id, type: 'template', timestamp: Date.now() }).catch(() => {});
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

/* ================= JOURNAL CRUD ================= */

export async function saveJournalEntry(entry: JournalEntry): Promise<JournalEntry> {
  const cloned = safeClone(entry);
  const now = Date.now();
  if (!cloned.id) {
    cloned.id = `jrn_${now}_${Math.random().toString(36).substring(2, 9)}`;
  }
  if (!cloned.createdAt) {
    cloned.createdAt = now;
  }
  cloned.updatedAt = now;

  await runTransaction('journal', 'readwrite', (store) => store.put(cloned));
  return cloned;
}

export async function getJournalEntryById(id: string): Promise<JournalEntry | null> {
  try {
    const item = await runTransaction<JournalEntry | undefined>('journal', 'readonly', (store) =>
      store.get(id)
    );
    return item ? safeClone(item) : null;
  } catch (err) {
    console.error('Error fetching journal entry', err);
    return null;
  }
}

export async function getAllJournalEntries(): Promise<JournalEntry[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('journal', 'readonly');
      const store = tx.objectStore('journal');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result as JournalEntry[]) || [];
        // Sort descending by date, then by createdAt
        list.sort((a, b) => {
          if (a.date !== b.date) {
            return b.date.localeCompare(a.date);
          }
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Error fetching all journal entries', err);
    return [];
  }
}

export async function deleteJournalEntry(id: string): Promise<void> {
  try {
    await runTransaction('journal', 'readwrite', (store) => store.delete(id));
  } catch (err) {
    console.error('Error deleting journal entry', err);
  }
}

export function normalizeAccountScope(accountId?: string | null): string {
  const trimmed = accountId?.trim();
  if (!trimmed || trimmed === 'local' || trimmed === 'guest') {
    return 'guest';
  }
  return trimmed;
}

export function isJournalEntryOwnedByScope(entry: JournalEntry, accountId?: string | null): boolean {
  const scope = normalizeAccountScope(accountId);
  const entryOwner = normalizeAccountScope(entry.userId);
  return entryOwner === scope;
}

export function getJournalDraftKey(accountId?: string | null): string {
  const scope = normalizeAccountScope(accountId);
  return `active_journal_draft_${scope}`;
}

export function getMyJournalDraftKey(accountId?: string | null): string {
  const scope = normalizeAccountScope(accountId);
  return `active_my_journal_draft_${scope}`;
}

export async function saveJournalDraft(draft: Partial<JournalEntry>, accountId?: string | null): Promise<void> {
  const cloned = safeClone(draft);
  const key = getJournalDraftKey(accountId);
  const scope = normalizeAccountScope(accountId);
  await runTransaction('journal_draft', 'readwrite', (store) =>
    store.put({ id: key, scope, data: cloned, updatedAt: Date.now() })
  );
}

export async function getJournalDraft(accountId?: string | null): Promise<Partial<JournalEntry> | null> {
  try {
    const key = getJournalDraftKey(accountId);
    const scope = normalizeAccountScope(accountId);
    let item = await runTransaction<{ id: string; data: Partial<JournalEntry> } | undefined>(
      'journal_draft',
      'readonly',
      (store) => store.get(key)
    );
    // Legacy fallback for unscoped draft if looking up guest scope
    if (!item && scope === 'guest') {
      item = await runTransaction<{ id: string; data: Partial<JournalEntry> } | undefined>(
        'journal_draft',
        'readonly',
        (store) => store.get('active_journal_draft')
      );
    }
    return item?.data ? safeClone(item.data) : null;
  } catch {
    return null;
  }
}

export async function clearJournalDraft(accountId?: string | null): Promise<void> {
  try {
    const key = getJournalDraftKey(accountId);
    const scope = normalizeAccountScope(accountId);
    await runTransaction('journal_draft', 'readwrite', (store) => {
      if (scope === 'guest') {
        store.delete('active_journal_draft');
      }
      return store.delete(key);
    });
  } catch {
    // Ignore
  }
}

export async function saveMyJournalDraft(draft: Partial<JournalEntry>, accountId?: string | null): Promise<void> {
  const cloned = safeClone(draft);
  const key = getMyJournalDraftKey(accountId);
  const scope = normalizeAccountScope(accountId);
  await runTransaction('journal_draft', 'readwrite', (store) =>
    store.put({ id: key, scope, data: cloned, updatedAt: Date.now() })
  );
}

export async function getMyJournalDraft(accountId?: string | null): Promise<Partial<JournalEntry> | null> {
  try {
    const key = getMyJournalDraftKey(accountId);
    const scope = normalizeAccountScope(accountId);
    let item = await runTransaction<{ id: string; data: Partial<JournalEntry> } | undefined>(
      'journal_draft',
      'readonly',
      (store) => store.get(key)
    );
    // Legacy fallback for unscoped draft if looking up guest scope
    if (!item && scope === 'guest') {
      item = await runTransaction<{ id: string; data: Partial<JournalEntry> } | undefined>(
        'journal_draft',
        'readonly',
        (store) => store.get('active_my_journal_draft')
      );
    }
    return item?.data ? safeClone(item.data) : null;
  } catch {
    return null;
  }
}

export async function clearMyJournalDraft(accountId?: string | null): Promise<void> {
  try {
    const key = getMyJournalDraftKey(accountId);
    const scope = normalizeAccountScope(accountId);
    await runTransaction('journal_draft', 'readwrite', (store) => {
      if (scope === 'guest') {
        store.delete('active_my_journal_draft');
      }
      return store.delete(key);
    });
  } catch {
    // Ignore
  }
}

export async function getAllScopedJournalDrafts(): Promise<{
  scopedJournalDrafts: Record<string, Partial<JournalEntry>>;
  scopedMyJournalDrafts: Record<string, Partial<JournalEntry>>;
}> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('journal_draft', 'readonly');
      const store = tx.objectStore('journal_draft');
      const req = store.getAll();
      req.onsuccess = () => {
        const scopedJournalDrafts: Record<string, Partial<JournalEntry>> = {};
        const scopedMyJournalDrafts: Record<string, Partial<JournalEntry>> = {};
        for (const item of req.result || []) {
          if (!item?.id) continue;
          if (item.id.startsWith('active_journal_draft_')) {
            const scope = item.id.replace('active_journal_draft_', '');
            scopedJournalDrafts[scope] = item.data;
          } else if (item.id === 'active_journal_draft') {
            scopedJournalDrafts['guest'] = item.data;
          } else if (item.id.startsWith('active_my_journal_draft_')) {
            const scope = item.id.replace('active_my_journal_draft_', '');
            scopedMyJournalDrafts[scope] = item.data;
          } else if (item.id === 'active_my_journal_draft') {
            scopedMyJournalDrafts['guest'] = item.data;
          }
        }
        resolve({ scopedJournalDrafts, scopedMyJournalDrafts });
      };
      req.onerror = () => resolve({ scopedJournalDrafts: {}, scopedMyJournalDrafts: {} });
    });
  } catch {
    return { scopedJournalDrafts: {}, scopedMyJournalDrafts: {} };
  }
}

/* ================= BACKUP & RESTORE ================= */

export function getLastBackupMetadata(): { timestamp: number | null; status: string | null } {
  if (typeof localStorage === 'undefined') {
    return { timestamp: null, status: null };
  }
  try {
    const ts = localStorage.getItem('abmax_last_backup_timestamp');
    const status = localStorage.getItem('abmax_last_backup_status');
    return {
      timestamp: ts ? parseInt(ts, 10) : null,
      status: status || null,
    };
  } catch {
    return { timestamp: null, status: null };
  }
}

export async function createFullBackup(accountId?: string | null): Promise<BackupData> {
  const [
    reports,
    templates,
    draft,
    images,
    journalEntries,
    journalDraft,
    myJournalDraft,
    scopedDrafts,
    presentationConfig,
    visibilityConfig,
    journalVisibilityConfig,
    performanceVisibilityConfig,
  ] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
    getAllJournalEntries(),
    getJournalDraft(accountId),
    getMyJournalDraft(accountId),
    getAllScopedJournalDrafts(),
    getUserReportPresentationConfig(),
    getUserVisibilityConfig(),
    getUserJournalVisibilityConfig(),
    getUserPerformanceVisibilityConfig(),
  ]);

  const theme =
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem('abmax_theme') as 'light' | 'dark')
      : null) || 'light';

  // Capture all active working sessions and unfinished form states from localStorage
  const workingSessions: Record<string, unknown> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('abmax_session_v2_') || key === 'abmax_last_active_account')) {
          const val = localStorage.getItem(key);
          if (val) {
            try {
              workingSessions[key] = JSON.parse(val);
            } catch {
              workingSessions[key] = val;
            }
          }
        }
      }
    } catch {
      // Ignore storage read limitations
    }
  }

  // Normalize entry ownership metadata so imports can identify source account cleanly
  const normalizedJournalEntries = journalEntries.map((entry) => ({
    ...entry,
    userId: normalizeAccountScope(entry.userId),
  }));

  const entryOwners: Record<string, number> = {};
  for (const entry of normalizedJournalEntries) {
    const owner = normalizeAccountScope(entry.userId);
    entryOwners[owner] = (entryOwners[owner] || 0) + 1;
  }

  const scopedDraftAccountSet = new Set<string>([
    ...Object.keys(scopedDrafts.scopedJournalDrafts || {}),
    ...Object.keys(scopedDrafts.scopedMyJournalDrafts || {}),
  ]);

  const backup: BackupData = {
    version: 3,
    exportedAt: new Date().toISOString(),
    app: 'ABMAX_ANALYSIS',
    reports,
    templates,
    draft,
    images,
    journalEntries: normalizedJournalEntries,
    journalDraft: journalDraft || undefined,
    myJournalDraft: myJournalDraft || undefined,
    scopedJournalDrafts: scopedDrafts.scopedJournalDrafts,
    scopedMyJournalDrafts: scopedDrafts.scopedMyJournalDrafts,
    ownership: {
      exportedByAccountId: normalizeAccountScope(accountId),
      totalJournalEntries: normalizedJournalEntries.length,
      entryOwners,
      scopedDraftAccounts: Array.from(scopedDraftAccountSet),
    },
    preferences: {
      theme,
      presentationConfig,
      visibilityConfig: visibilityConfig || undefined,
      journalVisibilityConfig: journalVisibilityConfig || undefined,
      performanceVisibilityConfig: performanceVisibilityConfig || undefined,
    },
    workingSessions,
  };

  // Record successful local backup metadata
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('abmax_last_backup_timestamp', Date.now().toString());
      localStorage.setItem('abmax_last_backup_status', 'success');
    } catch {
      // Ignore
    }
  }

  return backup;
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
  totalJournalEntriesInBackup: number;
  newJournalEntriesCount: number;
  skippedJournalEntriesCount: number;
  hasWorkingSession?: boolean;
  ownershipSummary?: {
    currentScope: string;
    exportedByAccountId: string | null;
    matchingOwnerEntriesCount: number;
    foreignOwnerEntriesCount: number;
    foreignAccountIds: string[];
    scopedDraftCount: number;
    foreignScopedDraftCount: number;
  };
}

export async function analyzeBackup(
  backup: BackupData,
  currentAccountId?: string | null
): Promise<RestorePreview> {
  const [existingReports, existingTemplates, existingJournal] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getAllJournalEntries(),
  ]);

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));
  const existingJournalIds = new Set(existingJournal.map((j) => j.id));

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

  const currentScope = normalizeAccountScope(currentAccountId);
  let newJournalEntriesCount = 0;
  let skippedJournalEntriesCount = 0;
  let matchingOwnerEntriesCount = 0;
  let foreignOwnerEntriesCount = 0;
  const foreignAccountsSet = new Set<string>();

  for (const j of backup.journalEntries || []) {
    if (existingJournalIds.has(j.id)) {
      skippedJournalEntriesCount++;
    } else {
      newJournalEntriesCount++;
    }
    const owner = normalizeAccountScope(j.userId);
    if (owner === currentScope) {
      matchingOwnerEntriesCount++;
    } else {
      foreignOwnerEntriesCount++;
      foreignAccountsSet.add(owner);
    }
  }

  const draftScopes = new Set<string>([
    ...Object.keys(backup.scopedJournalDrafts || {}),
    ...Object.keys(backup.scopedMyJournalDrafts || {}),
  ]);
  let foreignScopedDraftCount = 0;
  for (const sc of draftScopes) {
    if (normalizeAccountScope(sc) !== currentScope) {
      foreignScopedDraftCount++;
      foreignAccountsSet.add(normalizeAccountScope(sc));
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
    totalJournalEntriesInBackup: backup.journalEntries?.length || 0,
    newJournalEntriesCount,
    skippedJournalEntriesCount,
    hasWorkingSession: Boolean(backup.workingSessions && Object.keys(backup.workingSessions).length > 0),
    ownershipSummary: {
      currentScope,
      exportedByAccountId: backup.ownership?.exportedByAccountId || null,
      matchingOwnerEntriesCount,
      foreignOwnerEntriesCount,
      foreignAccountIds: Array.from(foreignAccountsSet),
      scopedDraftCount: draftScopes.size,
      foreignScopedDraftCount,
    },
  };
}

export interface RestoreBackupOptions {
  restoreDraft?: boolean;
  targetAccountId?: string | null;
  foreignOwnershipMode?: 'preserve' | 'claim' | 'skip';
  overwriteDrafts?: boolean;
}

export async function restoreBackup(
  backup: BackupData,
  options: RestoreBackupOptions = {}
): Promise<{
  addedReports: number;
  addedTemplates: number;
  addedImages: number;
  addedJournalEntries: number;
  skippedForeignJournalEntries: number;
}> {
  const db = await openDB();
  const [existingReports, existingTemplates, existingJournal] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getAllJournalEntries(),
  ]);

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));
  const existingJournalIds = new Set(existingJournal.map((j) => j.id));

  const targetScope = normalizeAccountScope(options.targetAccountId);
  const ownershipMode = options.foreignOwnershipMode || 'preserve';

  let addedReports = 0;
  let addedTemplates = 0;
  let addedImages = 0;
  let addedJournalEntries = 0;
  let skippedForeignJournalEntries = 0;

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

  // Restore journal entries deliberately honoring ownership policy
  if (backup.journalEntries && backup.journalEntries.length > 0) {
    const jrnTx = db.transaction('journal', 'readwrite');
    const jrnStore = jrnTx.objectStore('journal');
    for (const j of backup.journalEntries) {
      if (existingJournalIds.has(j.id)) continue;
      const entryOwner = normalizeAccountScope(j.userId);
      if (ownershipMode === 'skip' && entryOwner !== targetScope) {
        skippedForeignJournalEntries++;
        continue;
      }
      const entryToStore: JournalEntry =
        ownershipMode === 'claim'
          ? { ...j, userId: targetScope }
          : { ...j, userId: entryOwner };
      jrnStore.put(entryToStore);
      addedJournalEntries++;
    }
    await new Promise<void>((res, rej) => {
      jrnTx.oncomplete = () => res();
      jrnTx.onerror = () => rej(jrnTx.error);
    });
  }

  // Restore draft: default to true whenever backup.draft is present unless explicitly set to false
  const shouldRestoreDraft = options.restoreDraft !== false && Boolean(backup.draft);
  if (shouldRestoreDraft && backup.draft) {
    await saveDraft(backup.draft);
  }

  // Helper to restore scoped draft honoring ownership policy & non-clobbering merge
  const restoreScopedDraftEntry = async (
    scope: string,
    draftData: any,
    getter: (id?: string | null) => Promise<any>,
    saver: (d: any, id?: string | null) => Promise<void>
  ) => {
    if (!draftData) return;
    const normalizedScope = normalizeAccountScope(scope);
    if (ownershipMode === 'skip' && normalizedScope !== targetScope) {
      return;
    }
    const destScope = ownershipMode === 'claim' ? targetScope : normalizedScope;
    if (!options.overwriteDrafts) {
      const existing = await getter(destScope);
      if (existing && Object.keys(existing).length > 0) {
        return; // Preserve existing active draft in destination scope
      }
    }
    await saver(draftData, destScope);
  };

  // Restore scoped journal drafts or legacy single draft
  if (backup.scopedJournalDrafts && Object.keys(backup.scopedJournalDrafts).length > 0) {
    for (const [scope, draftData] of Object.entries(backup.scopedJournalDrafts)) {
      await restoreScopedDraftEntry(scope, draftData, getJournalDraft, saveJournalDraft);
    }
  } else if (backup.journalDraft) {
    const legacyOwner = backup.ownership?.exportedByAccountId || 'guest';
    await restoreScopedDraftEntry(legacyOwner, backup.journalDraft, getJournalDraft, saveJournalDraft);
  }

  // Restore scoped personal drafts or legacy single draft
  if (backup.scopedMyJournalDrafts && Object.keys(backup.scopedMyJournalDrafts).length > 0) {
    for (const [scope, draftData] of Object.entries(backup.scopedMyJournalDrafts)) {
      await restoreScopedDraftEntry(scope, draftData, getMyJournalDraft, saveMyJournalDraft);
    }
  } else if (backup.myJournalDraft) {
    const legacyOwner = backup.ownership?.exportedByAccountId || 'guest';
    await restoreScopedDraftEntry(legacyOwner, backup.myJournalDraft, getMyJournalDraft, saveMyJournalDraft);
  }

  // Restore working sessions and unfinished forms into localStorage
  if (backup.workingSessions && typeof localStorage !== 'undefined') {
    try {
      for (const [key, val] of Object.entries(backup.workingSessions)) {
        if (key.startsWith('abmax_session_v2_') || key === 'abmax_last_active_account') {
          const serialized = typeof val === 'string' ? val : JSON.stringify(val);
          localStorage.setItem(key, serialized);
        }
      }
    } catch (e) {
      console.warn('[DB] Warning restoring working sessions:', e);
    }
  }

  // Restore theme preference
  if (backup.preferences?.theme && typeof localStorage !== 'undefined') {
    localStorage.setItem('abmax_theme', backup.preferences.theme);
  }

  // Restore report presentation preference if present
  if (backup.preferences?.presentationConfig) {
    await saveUserReportPresentationConfig(backup.preferences.presentationConfig);
  }

  // Restore workspace visibility config if present
  if (backup.preferences?.visibilityConfig) {
    await saveUserVisibilityConfig(backup.preferences.visibilityConfig);
  }

  // Restore journal visibility config if present
  if (backup.preferences?.journalVisibilityConfig) {
    await saveUserJournalVisibilityConfig(backup.preferences.journalVisibilityConfig);
  }

  // Restore performance visibility config if present
  if (backup.preferences?.performanceVisibilityConfig) {
    await saveUserPerformanceVisibilityConfig(backup.preferences.performanceVisibilityConfig);
  }

  return {
    addedReports,
    addedTemplates,
    addedImages,
    addedJournalEntries,
    skippedForeignJournalEntries,
  };
}
