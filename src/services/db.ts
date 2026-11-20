import {
  AnalysisData,
  BackupData,
  DEFAULT_INSTRUMENTS_CONFIG,
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  DEFAULT_REPORT_PRESENTATION,
  DEFAULT_REPORT_VISIBILITY,
  ImageAttachment,
  InstrumentsConfig,
  JournalEntry,
  JournalVisibilityConfig,
  LiveWorkspaceData,
  PerformanceVisibilityConfig,
  ReportPresentationConfig,
  SavedReport,
  SavedTemplate,
  TradingStrategy,
  WorkspaceVisibilityConfig,
  createEmptyLiveInstrumentState,
  createInitialLiveWorkspace,
  normalizeInstrumentsConfig,
  normalizeJournalVisibilityConfig,
  normalizePerformanceVisibilityConfig,
  normalizeWorkspaceVisibilityConfig,
  normalizeReportVisibilityConfig,
} from '../types/journal';

const DB_NAME = 'abmax_analysis_db';
const DB_VERSION = 5; // Version 5 adds live_workspace store

interface DBStores {
  reports: SavedReport;
  draft: AnalysisData & { id: string };
  templates: SavedTemplate;
  images: ImageAttachment;
  preferences: { key: string; value: unknown };
  journal: JournalEntry;
  journal_draft: { id: string; data: Partial<JournalEntry> | Partial<TradingStrategy> };
  strategies: TradingStrategy;
  live_workspace: LiveWorkspaceData;
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

      if (!db.objectStoreNames.contains('strategies')) {
        const strStore = db.createObjectStore('strategies', { keyPath: 'id' });
        strStore.createIndex('userId', 'userId', { unique: false });
        strStore.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains('live_workspace')) {
        const liveStore = db.createObjectStore('live_workspace', { keyPath: 'id' });
        liveStore.createIndex('ownerScope', 'ownerScope', { unique: false });
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
        try {
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
        } catch (innerErr) {
          try {
            tx.abort();
          } catch {
            // Transaction may already be inactive
          }
          reject(innerErr);
        }
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
        try {
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
        } catch (innerErr) {
          try {
            tx.abort();
          } catch {
            // Transaction may already be inactive
          }
          reject(innerErr);
        }
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
        try {
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
        } catch (innerErr) {
          try {
            tx.abort();
          } catch {
            // Transaction may already be inactive
          }
          reject(innerErr);
        }
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

/* ================= USER INSTRUMENTS PREFERENCES (SCOPED) ================= */

export function getInstrumentsPreferenceKey(accountId?: string | null): string {
  const scope = normalizeAccountScope(accountId);
  return `instruments_config_${scope}`;
}

export async function getUserInstrumentsConfig(accountId?: string | null): Promise<InstrumentsConfig> {
  try {
    const key = getInstrumentsPreferenceKey(accountId);
    const scope = normalizeAccountScope(accountId);
    let record = await runTransaction<{ key: string; value: Partial<InstrumentsConfig> } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get(key)
    );
    if (!record && scope === 'guest') {
      record = await runTransaction<{ key: string; value: Partial<InstrumentsConfig> } | undefined>(
        'preferences',
        'readonly',
        (store) => store.get('instruments_config')
      );
    }
    return record?.value
      ? normalizeInstrumentsConfig(record.value)
      : normalizeInstrumentsConfig(DEFAULT_INSTRUMENTS_CONFIG);
  } catch {
    return normalizeInstrumentsConfig(DEFAULT_INSTRUMENTS_CONFIG);
  }
}

export async function saveUserInstrumentsConfig(
  config: Partial<InstrumentsConfig>,
  accountId?: string | null
): Promise<InstrumentsConfig> {
  const key = getInstrumentsPreferenceKey(accountId);
  const normalized: InstrumentsConfig = {
    ...normalizeInstrumentsConfig(config),
    updatedAt: Date.now(),
  };
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key, value: safeClone(normalized) })
  );
  return normalized;
}

export async function getAllScopedInstrumentsConfigs(): Promise<Record<string, InstrumentsConfig>> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('preferences', 'readonly');
      const store = tx.objectStore('preferences');
      const req = store.getAll();
      req.onsuccess = () => {
        const result: Record<string, InstrumentsConfig> = {};
        for (const rec of req.result || []) {
          if (!rec?.key) continue;
          if (typeof rec.key === 'string' && rec.key.startsWith('instruments_config_')) {
            const scope = rec.key.replace('instruments_config_', '');
            result[scope] = normalizeInstrumentsConfig(rec.value);
          } else if (rec.key === 'instruments_config' && !result['guest']) {
            result['guest'] = normalizeInstrumentsConfig(rec.value);
          }
        }
        resolve(result);
      };
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

/* ================= ACCOUNT RESET EPOCH & SCOPED WIPE ================= */

export function getAccountResetEpochKey(accountId?: string | null): string {
  return `account_reset_epoch_${normalizeAccountScope(accountId)}`;
}

export async function getLocalAccountResetEpoch(accountId?: string | null): Promise<number> {
  try {
    const key = getAccountResetEpochKey(accountId);
    const rec = await runTransaction<{ key: string; value: number } | undefined>(
      'preferences',
      'readonly',
      (store) => store.get(key)
    );
    return typeof rec?.value === 'number' && Number.isFinite(rec.value) ? rec.value : 0;
  } catch {
    return 0;
  }
}

export async function setLocalAccountResetEpoch(accountId: string | null | undefined, epoch: number): Promise<void> {
  const key = getAccountResetEpochKey(accountId);
  await runTransaction('preferences', 'readwrite', (store) =>
    store.put({ key, value: epoch })
  );
}

function isRecordOwnedByTargetResetScope(recordAccountId: string | undefined | null, targetScope: string): boolean {
  const normalized = recordAccountId ? normalizeAccountScope(recordAccountId) : null;
  if (normalized === targetScope) return true;
  // Unscoped or 'local' records belong to active workspace unless owned by a distinct foreign account
  if (!recordAccountId || recordAccountId === 'local') return true;
  return false;
}

function collectReferencedImageIdsFromAnalysis(item: Partial<AnalysisData> | null | undefined, out: Set<string>): void {
  if (!item) return;
  if (item.timeframes) {
    for (const tf of Object.values(item.timeframes)) {
      if (tf?.chartImageId && !tf.chartImageId.includes('/')) {
        out.add(tf.chartImageId);
      }
    }
  }
  for (const scn of item.scenarios || []) {
    for (const img of scn.images || []) {
      if (img?.id) out.add(img.id);
    }
  }
  for (const trd of item.trades || []) {
    for (const img of trd.images || []) {
      if (img?.id) out.add(img.id);
    }
  }
}

export interface LocalResetScopeCounts {
  reportsCount: number;
  templatesCount: number;
  journalCount: number;
  strategiesCount: number;
  hasLiveWorkspace: boolean;
  hasActiveAnalysisDraft: boolean;
  scopedDraftsCount: number;
  estimatedImagesCount: number;
  preservedForeignAccountsCount: number;
}

export async function getLocalResetScopeCounts(accountId?: string | null): Promise<LocalResetScopeCounts> {
  const targetScope = normalizeAccountScope(accountId);
  const [reports, templates, draft, images, journalEntries, strategies, liveWorkspaces, scopedDrafts] =
    await Promise.all([
      getAllReports(),
      getAllTemplates(),
      getDraft(),
      getAllImages(),
      getAllJournalEntries(),
      getAllStrategies(),
      getAllLiveWorkspaces(),
      getAllScopedJournalDrafts(),
    ]);

  const foreignAccounts = new Set<string>();
  const targetReports = reports.filter((r) => {
    if (isRecordOwnedByTargetResetScope(r.accountId, targetScope)) return true;
    if (r.accountId) foreignAccounts.add(normalizeAccountScope(r.accountId));
    return false;
  });

  const targetTemplates = templates.filter((t) => {
    const owner = (t as any).accountId || (t as any).userId;
    if (isRecordOwnedByTargetResetScope(owner, targetScope)) return true;
    if (owner) foreignAccounts.add(normalizeAccountScope(owner));
    return false;
  });

  const targetJournal = journalEntries.filter((j) => {
    if (isJournalEntryOwnedByScope(j, targetScope)) return true;
    foreignAccounts.add(normalizeAccountScope(j.userId));
    return false;
  });

  const targetStrategies = strategies.filter((s) => {
    if (isStrategyOwnedByScope(s, targetScope)) return true;
    foreignAccounts.add(normalizeAccountScope(s.userId));
    return false;
  });

  const hasLiveWorkspace = liveWorkspaces.some((lw) => {
    if (normalizeAccountScope(lw.ownerScope) === targetScope) return true;
    foreignAccounts.add(normalizeAccountScope(lw.ownerScope));
    return false;
  });

  const hasActiveAnalysisDraft = Boolean(
    draft && isRecordOwnedByTargetResetScope(draft.accountId, targetScope)
  );

  let scopedDraftsCount = 0;
  if (scopedDrafts.scopedJournalDrafts[targetScope]) scopedDraftsCount++;
  if (scopedDrafts.scopedMyJournalDrafts[targetScope]) scopedDraftsCount++;
  if (scopedDrafts.scopedStrategyDrafts[targetScope]) scopedDraftsCount++;

  const targetImageRefs = new Set<string>();
  const preservedImageRefs = new Set<string>();

  for (const r of targetReports) collectReferencedImageIdsFromAnalysis(r, targetImageRefs);
  for (const r of reports) {
    if (!isRecordOwnedByTargetResetScope(r.accountId, targetScope)) {
      collectReferencedImageIdsFromAnalysis(r, preservedImageRefs);
    }
  }
  for (const j of targetJournal) {
    for (const img of j.images || []) {
      if (img?.id) targetImageRefs.add(img.id);
    }
  }
  for (const j of journalEntries) {
    if (!isJournalEntryOwnedByScope(j, targetScope)) {
      for (const img of j.images || []) {
        if (img?.id) preservedImageRefs.add(img.id);
      }
    }
  }
  if (hasActiveAnalysisDraft && draft) {
    collectReferencedImageIdsFromAnalysis(draft, targetImageRefs);
  }

  let estimatedImagesCount = 0;
  for (const img of images) {
    if (targetImageRefs.has(img.id) && !preservedImageRefs.has(img.id)) {
      estimatedImagesCount++;
    } else if (preservedImageRefs.size === 0 && targetReports.length + targetJournal.length > 0 && !preservedImageRefs.has(img.id)) {
      estimatedImagesCount++;
    }
  }

  return {
    reportsCount: targetReports.length,
    templatesCount: targetTemplates.length,
    journalCount: targetJournal.length,
    strategiesCount: targetStrategies.length,
    hasLiveWorkspace,
    hasActiveAnalysisDraft,
    scopedDraftsCount,
    estimatedImagesCount,
    preservedForeignAccountsCount: foreignAccounts.size,
  };
}

export async function clearLocalAccountDataForReset(
  accountId: string,
  newResetEpoch?: number
): Promise<{
  deletedReports: number;
  deletedTemplates: number;
  deletedJournalEntries: number;
  deletedStrategies: number;
  deletedLiveWorkspace: boolean;
  deletedDraft: boolean;
  deletedImages: number;
}> {
  const targetScope = normalizeAccountScope(accountId);
  const db = await openDB();

  const [reports, templates, draft, images, journalEntries] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
    getAllJournalEntries(),
  ]);
  const strategies = await getAllStrategies();

  const preservedImageRefs = new Set<string>();
  const reportsToDelete: string[] = [];
  for (const r of reports) {
    if (isRecordOwnedByTargetResetScope(r.accountId, targetScope)) {
      reportsToDelete.push(r.id);
    } else {
      collectReferencedImageIdsFromAnalysis(r, preservedImageRefs);
    }
  }

  const templatesToDelete: string[] = [];
  for (const t of templates) {
    const owner = (t as any).accountId || (t as any).userId;
    if (isRecordOwnedByTargetResetScope(owner, targetScope)) {
      templatesToDelete.push(t.id);
    } else if (t.imageMap) {
      for (const idOrPath of Object.values(t.imageMap)) {
        if (idOrPath && !idOrPath.includes('/')) preservedImageRefs.add(idOrPath);
      }
    }
  }

  const journalToDelete: string[] = [];
  for (const j of journalEntries) {
    if (isJournalEntryOwnedByScope(j, targetScope)) {
      journalToDelete.push(j.id);
    } else {
      for (const img of j.images || []) {
        if (img?.id) preservedImageRefs.add(img.id);
      }
    }
  }

  const strategiesToDelete: string[] = [];
  for (const s of strategies) {
    if (isStrategyOwnedByScope(s, targetScope)) {
      strategiesToDelete.push(s.id);
    }
  }

  const shouldDeleteDraft = Boolean(
    draft && isRecordOwnedByTargetResetScope(draft.accountId, targetScope)
  );
  if (draft && !shouldDeleteDraft) {
    collectReferencedImageIdsFromAnalysis(draft, preservedImageRefs);
  }

  const imagesToDelete = images
    .filter((img) => !preservedImageRefs.has(img.id))
    .map((img) => img.id);

  // Execute scoped deletions per store safely
  if (reportsToDelete.length > 0) {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    for (const id of reportsToDelete) store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  if (templatesToDelete.length > 0 && db.objectStoreNames.contains('templates')) {
    const tx = db.transaction('templates', 'readwrite');
    const store = tx.objectStore('templates');
    for (const id of templatesToDelete) store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  if (journalToDelete.length > 0 && db.objectStoreNames.contains('journal')) {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    for (const id of journalToDelete) store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  if (strategiesToDelete.length > 0 && db.objectStoreNames.contains('strategies')) {
    const tx = db.transaction('strategies', 'readwrite');
    const store = tx.objectStore('strategies');
    for (const id of strategiesToDelete) store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  if (db.objectStoreNames.contains('journal_draft')) {
    const tx = db.transaction('journal_draft', 'readwrite');
    const store = tx.objectStore('journal_draft');
    store.delete(getJournalDraftKey(targetScope));
    store.delete(getMyJournalDraftKey(targetScope));
    store.delete(getStrategyDraftKey(targetScope));
    if (targetScope === 'guest') {
      store.delete('active_journal_draft');
      store.delete('active_my_journal_draft');
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  let deletedLiveWorkspace = false;
  if (db.objectStoreNames.contains('live_workspace')) {
    const liveId = getLiveWorkspaceIdForScope(targetScope);
    const existingLive = await runTransaction<LiveWorkspaceData | undefined>('live_workspace', 'readonly', (s) =>
      s.get(liveId)
    );
    if (existingLive) {
      await runTransaction('live_workspace', 'readwrite', (s) => s.delete(liveId));
      deletedLiveWorkspace = true;
    }
  }

  if (shouldDeleteDraft) {
    await clearDraft();
  }

  if (imagesToDelete.length > 0) {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    for (const id of imagesToDelete) store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // Clear active user's pending sync queue, deletion tombstones, scoped instrument & visibility preferences,
  // and record the new authoritative reset epoch (while preserving foreign accounts' preferences/epochs)
  const prefTx = db.transaction('preferences', 'readwrite');
  const prefStore = prefTx.objectStore('preferences');
  prefStore.delete('pending_cloud_queue');
  prefStore.delete('deleted_report_ids');
  prefStore.delete(getInstrumentsPreferenceKey(targetScope));
  prefStore.delete('workspace_visibility');
  prefStore.delete('journal_visibility');
  prefStore.delete('performance_visibility');
  prefStore.delete('report_presentation_config');
  if (typeof newResetEpoch === 'number' && Number.isFinite(newResetEpoch) && newResetEpoch > 0) {
    prefStore.put({ key: getAccountResetEpochKey(targetScope), value: newResetEpoch });
  }
  await new Promise<void>((res, rej) => {
    prefTx.oncomplete = () => res();
    prefTx.onerror = () => rej(prefTx.error);
  });

  // Clear ONLY target account's working session & migration prompt keys in localStorage;
  // NEVER delete auth keys (abmax_supabase_auth / abmax_remember_login) or other accounts' sessions.
  if (typeof localStorage !== 'undefined') {
    try {
      const safeAcc = (accountId || 'local').replace(/[^a-zA-Z0-9_-]/g, '_');
      localStorage.removeItem(`abmax_session_v2_${safeAcc}`);
      if (targetScope === 'guest') {
        localStorage.removeItem('abmax_session_v2_local');
        localStorage.removeItem('abmax_session_v2_guest');
      } else {
        localStorage.removeItem(`abmax_migrated_prompt_${accountId}`);
      }
      localStorage.removeItem('abmax_active_view');
    } catch {
      // Ignore storage access errors
    }
  }

  return {
    deletedReports: reportsToDelete.length,
    deletedTemplates: templatesToDelete.length,
    deletedJournalEntries: journalToDelete.length,
    deletedStrategies: strategiesToDelete.length,
    deletedLiveWorkspace,
    deletedDraft: shouldDeleteDraft,
    deletedImages: imagesToDelete.length,
  };
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
  scopedStrategyDrafts: Record<string, Partial<TradingStrategy>>;
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
        const scopedStrategyDrafts: Record<string, Partial<TradingStrategy>> = {};
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
          } else if (item.id.startsWith('active_strategy_draft_')) {
            const scope = item.id.replace('active_strategy_draft_', '');
            scopedStrategyDrafts[scope] = item.data;
          }
        }
        resolve({ scopedJournalDrafts, scopedMyJournalDrafts, scopedStrategyDrafts });
      };
      req.onerror = () => resolve({ scopedJournalDrafts: {}, scopedMyJournalDrafts: {}, scopedStrategyDrafts: {} });
    });
  } catch {
    return { scopedJournalDrafts: {}, scopedMyJournalDrafts: {}, scopedStrategyDrafts: {} };
  }
}

/* ================= STRATEGIES REPOSITORY (LOCAL-ONLY) ================= */

export function isStrategyOwnedByScope(strategy: TradingStrategy, accountId?: string | null): boolean {
  const scope = normalizeAccountScope(accountId);
  const owner = normalizeAccountScope(strategy.userId);
  return owner === scope;
}

export function getStrategyDraftKey(accountId?: string | null): string {
  const scope = normalizeAccountScope(accountId);
  return `active_strategy_draft_${scope}`;
}

export async function saveStrategyDraft(draft: Partial<TradingStrategy>, accountId?: string | null): Promise<void> {
  const cloned = safeClone(draft);
  const key = getStrategyDraftKey(accountId);
  const scope = normalizeAccountScope(accountId);
  await runTransaction('journal_draft', 'readwrite', (store) =>
    store.put({ id: key, scope, data: cloned, updatedAt: Date.now() })
  );
}

export async function getStrategyDraft(accountId?: string | null): Promise<Partial<TradingStrategy> | null> {
  try {
    const key = getStrategyDraftKey(accountId);
    const item = await runTransaction<{ id: string; data: Partial<TradingStrategy> } | undefined>(
      'journal_draft',
      'readonly',
      (store) => store.get(key)
    );
    return item?.data ? safeClone(item.data) : null;
  } catch {
    return null;
  }
}

export async function clearStrategyDraft(accountId?: string | null): Promise<void> {
  try {
    const key = getStrategyDraftKey(accountId);
    await runTransaction('journal_draft', 'readwrite', (store) => store.delete(key));
  } catch {
    // Ignore
  }
}

export async function getAllStrategies(): Promise<TradingStrategy[]> {
  try {
    const items = await runTransaction<TradingStrategy[]>('strategies', 'readonly', (store) => store.getAll());
    return (items || []).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  } catch {
    return [];
  }
}

export async function getStrategiesForScope(accountId?: string | null): Promise<TradingStrategy[]> {
  const all = await getAllStrategies();
  return all.filter((s) => isStrategyOwnedByScope(s, accountId));
}

export async function getStrategyById(id: string): Promise<TradingStrategy | null> {
  if (!id) return null;
  try {
    const item = await runTransaction<TradingStrategy | undefined>('strategies', 'readonly', (store) => store.get(id));
    return item ? safeClone(item) : null;
  } catch {
    return null;
  }
}

export async function saveStrategy(strategy: TradingStrategy): Promise<TradingStrategy> {
  const now = Date.now();
  const normalized: TradingStrategy = safeClone({
    ...strategy,
    name: (strategy.name || '').trim(),
    userId: normalizeAccountScope(strategy.userId),
    createdAt: strategy.createdAt || now,
    updatedAt: now,
  });
  await runTransaction('strategies', 'readwrite', (store) => store.put(normalized));
  return normalized;
}

export async function archiveStrategy(id: string, isArchived = true): Promise<TradingStrategy | null> {
  const existing = await getStrategyById(id);
  if (!existing) return null;
  return saveStrategy({
    ...existing,
    isArchived,
    updatedAt: Date.now(),
  });
}

export async function deleteStrategy(id: string): Promise<void> {
  await runTransaction('strategies', 'readwrite', (store) => store.delete(id));
}

/* ================= LIVE WORKSPACE (SCOPED LOCAL-ONLY) ================= */

export function getLiveWorkspaceIdForScope(userId?: string | null): string {
  const scope = normalizeAccountScope(userId);
  return `live_workspace_${scope}`;
}

export async function getLiveWorkspace(userId?: string | null): Promise<LiveWorkspaceData> {
  const scope = normalizeAccountScope(userId);
  const id = getLiveWorkspaceIdForScope(scope);
  try {
    const existing = await runTransaction<LiveWorkspaceData | undefined>('live_workspace', 'readonly', (store) =>
      store.get(id)
    );
    if (existing && existing.instruments) {
      const cloned = safeClone(existing);
      if (!cloned.instruments['XAUUSD']) cloned.instruments['XAUUSD'] = createEmptyLiveInstrumentState('XAUUSD');
      if (!cloned.instruments['BTCUSD']) cloned.instruments['BTCUSD'] = createEmptyLiveInstrumentState('BTCUSD');
      if (!cloned.instruments['EURUSD']) cloned.instruments['EURUSD'] = createEmptyLiveInstrumentState('EURUSD');
      cloned.ownerScope = scope;
      cloned.id = id;
      return cloned;
    }
  } catch (err) {
    console.warn('[DB] Failed to load live workspace, initializing default:', err);
  }
  return createInitialLiveWorkspace(scope);
}

export async function saveLiveWorkspace(
  workspace: LiveWorkspaceData,
  userId?: string | null
): Promise<LiveWorkspaceData> {
  const scope = normalizeAccountScope(userId ?? workspace.ownerScope);
  const payload: LiveWorkspaceData = {
    ...safeClone(workspace),
    id: getLiveWorkspaceIdForScope(scope),
    ownerScope: scope,
    updatedAt: Date.now(),
  };
  await runTransaction('live_workspace', 'readwrite', (store) => store.put(payload));
  return payload;
}

export async function resetLiveInstrument(
  pair: string,
  userId?: string | null
): Promise<LiveWorkspaceData> {
  const ws = await getLiveWorkspace(userId);
  const next: LiveWorkspaceData = {
    ...ws,
    instruments: {
      ...ws.instruments,
      [pair]: createEmptyLiveInstrumentState(pair),
    },
    updatedAt: Date.now(),
  };
  return saveLiveWorkspace(next, userId);
}

export async function resetLiveWorkspace(userId?: string | null): Promise<LiveWorkspaceData> {
  const scope = normalizeAccountScope(userId);
  const fresh = createInitialLiveWorkspace(scope);
  return saveLiveWorkspace(fresh, scope);
}

export async function getAllLiveWorkspaces(): Promise<LiveWorkspaceData[]> {
  try {
    const all = await runTransaction<LiveWorkspaceData[]>('live_workspace', 'readonly', (store) => store.getAll());
    return Array.isArray(all) ? all.map((w) => safeClone(w)) : [];
  } catch {
    return [];
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
    strategies,
    liveWorkspaces,
    journalDraft,
    myJournalDraft,
    scopedDrafts,
    presentationConfig,
    visibilityConfig,
    journalVisibilityConfig,
    performanceVisibilityConfig,
    instrumentsConfig,
    scopedInstrumentsConfigs,
  ] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
    getAllJournalEntries(),
    getAllStrategies(),
    getAllLiveWorkspaces(),
    getJournalDraft(accountId),
    getMyJournalDraft(accountId),
    getAllScopedJournalDrafts(),
    getUserReportPresentationConfig(),
    getUserVisibilityConfig(),
    getUserJournalVisibilityConfig(),
    getUserPerformanceVisibilityConfig(),
    getUserInstrumentsConfig(accountId),
    getAllScopedInstrumentsConfigs(),
  ]);

  const rawTheme =
    typeof localStorage !== 'undefined' ? localStorage.getItem('abmax_theme') : null;
  const theme: 'light' | 'dark' | 'system' =
    rawTheme === 'dark' || rawTheme === 'system' ? rawTheme : 'light';

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

  // Normalize entry & strategy ownership metadata so imports can identify source account cleanly
  const normalizedJournalEntries = journalEntries.map((entry) => ({
    ...entry,
    userId: normalizeAccountScope(entry.userId),
  }));

  const normalizedStrategies = strategies.map((str) => ({
    ...str,
    userId: normalizeAccountScope(str.userId),
  }));

  const normalizedLiveWorkspaces = liveWorkspaces.map((lw) => ({
    ...lw,
    ownerScope: normalizeAccountScope(lw.ownerScope),
  }));

  const entryOwners: Record<string, number> = {};
  for (const entry of normalizedJournalEntries) {
    const owner = normalizeAccountScope(entry.userId);
    entryOwners[owner] = (entryOwners[owner] || 0) + 1;
  }

  const strategyOwners: Record<string, number> = {};
  for (const str of normalizedStrategies) {
    const owner = normalizeAccountScope(str.userId);
    strategyOwners[owner] = (strategyOwners[owner] || 0) + 1;
  }

  const liveWorkspaceOwners: Record<string, number> = {};
  for (const lw of normalizedLiveWorkspaces) {
    const owner = normalizeAccountScope(lw.ownerScope);
    liveWorkspaceOwners[owner] = (liveWorkspaceOwners[owner] || 0) + 1;
  }

  const scopedDraftAccountSet = new Set<string>([
    ...Object.keys(scopedDrafts.scopedJournalDrafts || {}),
    ...Object.keys(scopedDrafts.scopedMyJournalDrafts || {}),
    ...Object.keys(scopedDrafts.scopedStrategyDrafts || {}),
  ]);

  const backup: BackupData = {
    version: 5,
    exportedAt: new Date().toISOString(),
    app: 'ABMAX_ANALYSIS',
    reports,
    templates,
    draft,
    images,
    journalEntries: normalizedJournalEntries,
    strategies: normalizedStrategies,
    liveWorkspaces: normalizedLiveWorkspaces,
    journalDraft: journalDraft || undefined,
    myJournalDraft: myJournalDraft || undefined,
    scopedJournalDrafts: scopedDrafts.scopedJournalDrafts,
    scopedMyJournalDrafts: scopedDrafts.scopedMyJournalDrafts,
    scopedStrategyDrafts: scopedDrafts.scopedStrategyDrafts,
    scopedInstrumentsConfigs:
      Object.keys(scopedInstrumentsConfigs).length > 0 ? scopedInstrumentsConfigs : undefined,
    ownership: {
      exportedByAccountId: normalizeAccountScope(accountId),
      totalJournalEntries: normalizedJournalEntries.length,
      entryOwners,
      scopedDraftAccounts: Array.from(scopedDraftAccountSet),
      totalStrategies: normalizedStrategies.length,
      strategyOwners,
      totalLiveWorkspaces: normalizedLiveWorkspaces.length,
      liveWorkspaceOwners,
    },
    preferences: {
      theme,
      presentationConfig,
      visibilityConfig: visibilityConfig || undefined,
      journalVisibilityConfig: journalVisibilityConfig || undefined,
      performanceVisibilityConfig: performanceVisibilityConfig || undefined,
      instrumentsConfig,
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
  totalStrategiesInBackup: number;
  newStrategiesCount: number;
  skippedStrategiesCount: number;
  totalLiveWorkspacesInBackup?: number;
  hasWorkingSession?: boolean;
  ownershipSummary?: {
    currentScope: string;
    exportedByAccountId: string | null;
    matchingOwnerEntriesCount: number;
    foreignOwnerEntriesCount: number;
    foreignOwnerStrategiesCount: number;
    foreignOwnerLiveWorkspacesCount: number;
    foreignAccountIds: string[];
    scopedDraftCount: number;
    foreignScopedDraftCount: number;
  };
}

export async function analyzeBackup(
  backup: BackupData,
  currentAccountId?: string | null
): Promise<RestorePreview> {
  const [existingReports, existingTemplates, existingJournal, existingStrategies] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getAllJournalEntries(),
    getAllStrategies(),
  ]);

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));
  const existingJournalIds = new Set(existingJournal.map((j) => j.id));
  const existingStrategyIds = new Set(existingStrategies.map((s) => s.id));

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

  let newStrategiesCount = 0;
  let skippedStrategiesCount = 0;
  let foreignOwnerStrategiesCount = 0;
  for (const s of backup.strategies || []) {
    if (existingStrategyIds.has(s.id)) {
      skippedStrategiesCount++;
    } else {
      newStrategiesCount++;
    }
    const owner = normalizeAccountScope(s.userId);
    if (owner !== currentScope) {
      foreignOwnerStrategiesCount++;
      foreignAccountsSet.add(owner);
    }
  }

  let foreignOwnerLiveWorkspacesCount = 0;
  for (const lw of backup.liveWorkspaces || []) {
    const owner = normalizeAccountScope(lw?.ownerScope);
    if (owner !== currentScope) {
      foreignOwnerLiveWorkspacesCount++;
      foreignAccountsSet.add(owner);
    }
  }

  const draftScopes = new Set<string>([
    ...Object.keys(backup.scopedJournalDrafts || {}),
    ...Object.keys(backup.scopedMyJournalDrafts || {}),
    ...Object.keys(backup.scopedStrategyDrafts || {}),
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
    totalStrategiesInBackup: backup.strategies?.length || 0,
    newStrategiesCount,
    skippedStrategiesCount,
    totalLiveWorkspacesInBackup: backup.liveWorkspaces?.length || 0,
    hasWorkingSession: Boolean(backup.workingSessions && Object.keys(backup.workingSessions).length > 0),
    ownershipSummary: {
      currentScope,
      exportedByAccountId: backup.ownership?.exportedByAccountId || null,
      matchingOwnerEntriesCount,
      foreignOwnerEntriesCount,
      foreignOwnerStrategiesCount,
      foreignOwnerLiveWorkspacesCount,
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
  addedStrategies: number;
  skippedForeignStrategies: number;
  restoredLiveWorkspaces: number;
}> {
  const db = await openDB();
  const [existingReports, existingTemplates, existingJournal, existingStrategies, existingLiveWorkspaces] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getAllJournalEntries(),
    getAllStrategies(),
    getAllLiveWorkspaces(),
  ]);

  const existingReportIds = new Set(existingReports.map((r) => r.id));
  const existingTemplateIds = new Set(existingTemplates.map((t) => t.id));
  const existingJournalIds = new Set(existingJournal.map((j) => j.id));
  const existingStrategyIds = new Set(existingStrategies.map((s) => s.id));
  const existingLiveMap = new Map(existingLiveWorkspaces.map((lw) => [lw.id, lw]));

  const targetScope = normalizeAccountScope(options.targetAccountId);
  const ownershipMode = options.foreignOwnershipMode || 'preserve';

  let addedReports = 0;
  let addedTemplates = 0;
  let addedImages = 0;
  let addedJournalEntries = 0;
  let skippedForeignJournalEntries = 0;
  let addedStrategies = 0;
  let skippedForeignStrategies = 0;
  let restoredLiveWorkspaces = 0;

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

  // Restore saved trading strategies strictly by ID (never merge by name) & ownership policy
  if (backup.strategies && backup.strategies.length > 0) {
    const strTx = db.transaction('strategies', 'readwrite');
    const strStore = strTx.objectStore('strategies');
    for (const s of backup.strategies) {
      if (!s?.id || existingStrategyIds.has(s.id)) continue;
      const owner = normalizeAccountScope(s.userId);
      if (ownershipMode === 'skip' && owner !== targetScope) {
        skippedForeignStrategies++;
        continue;
      }
      const strToStore: TradingStrategy =
        ownershipMode === 'claim'
          ? { ...s, userId: targetScope }
          : { ...s, userId: owner };
      strStore.put(strToStore);
      addedStrategies++;
    }
    await new Promise<void>((res, rej) => {
      strTx.oncomplete = () => res();
      strTx.onerror = () => rej(strTx.error);
    });
  }

  // Restore live workspaces (v5) honoring account ownership isolation and non-clobbering merge
  if (backup.liveWorkspaces && backup.liveWorkspaces.length > 0) {
    const liveTx = db.transaction('live_workspace', 'readwrite');
    const liveStore = liveTx.objectStore('live_workspace');
    for (const lw of backup.liveWorkspaces) {
      if (!lw) continue;
      const srcScope = normalizeAccountScope(lw.ownerScope);
      if (ownershipMode === 'skip' && srcScope !== targetScope) {
        continue;
      }
      const destScope = ownershipMode === 'claim' ? targetScope : srcScope;
      const destId = getLiveWorkspaceIdForScope(destScope);
      const existingLw = existingLiveMap.get(destId);

      if (!existingLw) {
        const cloned: LiveWorkspaceData = {
          ...safeClone(lw),
          id: destId,
          ownerScope: destScope,
        };
        liveStore.put(cloned);
        existingLiveMap.set(destId, cloned);
        restoredLiveWorkspaces++;
      } else {
        // Non-destructive merge per instrument: add missing keyLevels, scenarios, events by ID
        const mergedInstruments = { ...safeClone(existingLw.instruments) };
        for (const [pairKey, incomingInst] of Object.entries(lw.instruments || {})) {
          const curInst = mergedInstruments[pairKey];
          if (!curInst) {
            mergedInstruments[pairKey] = safeClone(incomingInst);
            continue;
          }
          const levelIds = new Set((curInst.keyLevels || []).map((l) => l.id));
          const scenIds = new Set((curInst.scenarios || []).map((s) => s.id));
          const eventIds = new Set((curInst.events || []).map((e) => e.id));
          mergedInstruments[pairKey] = {
            ...curInst,
            marketConditionSummary:
              curInst.marketConditionSummary || incomingInst.marketConditionSummary || '',
            keyLevels: [
              ...(curInst.keyLevels || []),
              ...(incomingInst.keyLevels || []).filter((l) => !levelIds.has(l.id)),
            ],
            scenarios: [
              ...(curInst.scenarios || []),
              ...(incomingInst.scenarios || []).filter((s) => !scenIds.has(s.id)),
            ],
            events: [
              ...(curInst.events || []),
              ...(incomingInst.events || []).filter((e) => !eventIds.has(e.id)),
            ],
            updatedAt: Math.max(curInst.updatedAt || 0, incomingInst.updatedAt || 0),
          };
        }
        const mergedLw: LiveWorkspaceData = {
          ...existingLw,
          instruments: mergedInstruments,
          updatedAt: Date.now(),
        };
        liveStore.put(mergedLw);
        existingLiveMap.set(destId, mergedLw);
        restoredLiveWorkspaces++;
      }
    }
    await new Promise<void>((res, rej) => {
      liveTx.oncomplete = () => res();
      liveTx.onerror = () => rej(liveTx.error);
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

  // Restore scoped strategy drafts
  if (backup.scopedStrategyDrafts && Object.keys(backup.scopedStrategyDrafts).length > 0) {
    for (const [scope, draftData] of Object.entries(backup.scopedStrategyDrafts)) {
      await restoreScopedDraftEntry(scope, draftData, getStrategyDraft, saveStrategyDraft);
    }
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

  // Restore scoped instrument configurations honoring ownership policy (non-clobbering merge of custom instruments)
  const mergeInstrumentConfigs = (existingCfg: InstrumentsConfig, incomingCfg: InstrumentsConfig): InstrumentsConfig => {
    const normExisting = normalizeInstrumentsConfig(existingCfg);
    const normIncoming = normalizeInstrumentsConfig(incomingCfg);
    const existingSymbols = new Set(normExisting.items.map((i) => i.symbol));
    const mergedItems = [...normExisting.items];
    for (const item of normIncoming.items) {
      if (!existingSymbols.has(item.symbol)) {
        mergedItems.push(item);
      }
    }
    return normalizeInstrumentsConfig({ items: mergedItems });
  };

  if (backup.scopedInstrumentsConfigs && Object.keys(backup.scopedInstrumentsConfigs).length > 0) {
    for (const [scope, cfg] of Object.entries(backup.scopedInstrumentsConfigs)) {
      if (!cfg) continue;
      const normalizedScope = normalizeAccountScope(scope);
      if (ownershipMode === 'skip' && normalizedScope !== targetScope) {
        continue;
      }
      const destScope = ownershipMode === 'claim' ? targetScope : normalizedScope;
      const existingCfg = await getUserInstrumentsConfig(destScope);
      await saveUserInstrumentsConfig(mergeInstrumentConfigs(existingCfg, cfg), destScope);
    }
  } else if (backup.preferences?.instrumentsConfig) {
    const legacyOwner = normalizeAccountScope(backup.ownership?.exportedByAccountId || targetScope);
    if (!(ownershipMode === 'skip' && legacyOwner !== targetScope)) {
      const destScope = ownershipMode === 'claim' ? targetScope : legacyOwner;
      const existingCfg = await getUserInstrumentsConfig(destScope);
      await saveUserInstrumentsConfig(
        mergeInstrumentConfigs(existingCfg, backup.preferences.instrumentsConfig),
        destScope
      );
    }
  }

  return {
    addedReports,
    addedTemplates,
    addedImages,
    addedJournalEntries,
    skippedForeignJournalEntries,
    addedStrategies,
    skippedForeignStrategies,
    restoredLiveWorkspaces,
  };
}

export interface ScopedContextualSuggestions {
  setupTags: string[];
  mistakeTags: string[];
  lessonTags: string[];
  tags: string[];
  strategies: string[];
  usedInstruments: string[];
}

/**
 * Returns non-sensitive autocomplete suggestions derived strictly from the active account's
 * own reports, strategies, and trading-journal entries (excluding private My Journal notes and foreign accounts).
 */
export async function getScopedContextualSuggestions(
  accountId?: string | null
): Promise<ScopedContextualSuggestions> {
  const scope = normalizeAccountScope(accountId);
  const isGuestScope = scope === 'guest';

  try {
    const [reports, strategies, journalEntries] = await Promise.all([
      getAllReports(),
      getStrategiesForScope(accountId),
      getAllJournalEntries(),
    ]);

    const setupTags = new Set<string>();
    const mistakeTags = new Set<string>();
    const lessonTags = new Set<string>();
    const tags = new Set<string>();
    const strategyNames = new Set<string>();
    const usedInstruments = new Set<string>();

    for (const st of strategies) {
      if (st?.name && !st.isArchived) {
        strategyNames.add(st.name.trim());
      }
      for (const tg of st?.tags || []) {
        if (tg && tg.trim()) tags.add(tg.trim());
      }
    }

    for (const r of reports) {
      const rOwner = r.accountId ? normalizeAccountScope(r.accountId) : 'guest';
      const belongsToScope = isGuestScope
        ? !r.accountId || rOwner === 'guest'
        : rOwner === scope || (!r.accountId && false);
      if (!belongsToScope) continue;

      if (r.pair) usedInstruments.add(r.pair);
      for (const scn of r.scenarios || []) {
        if (scn.strategy && scn.strategy.trim()) strategyNames.add(scn.strategy.trim());
      }
      for (const trd of r.trades || []) {
        if (trd.pair) usedInstruments.add(trd.pair);
        if (trd.strategy && trd.strategy.trim()) strategyNames.add(trd.strategy.trim());
      }
    }

    for (const j of journalEntries) {
      if (!isJournalEntryOwnedByScope(j, accountId)) continue;
      // Strictly exclude private My Journal entries from suggestion pools
      if (j.entryType === 'my_journal' || j.entryType === 'my-journal') continue;

      if (j.pair) usedInstruments.add(j.pair);
      if (j.preTrade?.setupTag && j.preTrade.setupTag.trim()) {
        setupTags.add(j.preTrade.setupTag.trim());
      }
      for (const m of j.postTrade?.mistakeTags || []) {
        if (m && m.trim()) mistakeTags.add(m.trim());
      }
      for (const l of j.postTrade?.lessonTags || []) {
        if (l && l.trim()) lessonTags.add(l.trim());
      }
      for (const tg of j.tags || []) {
        if (tg && tg.trim()) tags.add(tg.trim());
      }
    }

    return {
      setupTags: Array.from(setupTags).slice(0, 20),
      mistakeTags: Array.from(mistakeTags).slice(0, 20),
      lessonTags: Array.from(lessonTags).slice(0, 20),
      tags: Array.from(tags).slice(0, 20),
      strategies: Array.from(strategyNames).slice(0, 20),
      usedInstruments: Array.from(usedInstruments).slice(0, 20),
    };
  } catch {
    return {
      setupTags: [],
      mistakeTags: [],
      lessonTags: [],
      tags: [],
      strategies: [],
      usedInstruments: [],
    };
  }
}

