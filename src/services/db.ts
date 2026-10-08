import {
  AnalysisData,
  BackupData,
  ImageAttachment,
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
        const request = callback(store);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Transaction request failed'));
        tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
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
          return b.date.localeCompare(a.date);
        }
        return b.createdAt - a.createdAt;
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
    console.error('Error fetching report by ID', err);
    return null;
  }
}

export async function saveReport(report: SavedReport): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const req = store.put(report);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function deleteReport(id: string): Promise<void> {
  await runTransaction('reports', 'readwrite', (store) => store.delete(id));
}

/* ================= DRAFT ================= */

const DRAFT_KEY = 'active_draft';

export async function getDraft(): Promise<AnalysisData | null> {
  try {
    const raw = await runTransaction<AnalysisData & { id: string } | undefined>(
      'draft',
      'readonly',
      (store) => store.get(DRAFT_KEY)
    );
    return raw || null;
  } catch (err) {
    console.error('Error fetching draft', err);
    return null;
  }
}

export async function saveDraft(draft: AnalysisData): Promise<void> {
  const payload = {
    ...draft,
    id: DRAFT_KEY,
    updatedAt: Date.now(),
  };
  await runTransaction('draft', 'readwrite', (store) => store.put(payload));
}

export async function clearDraft(): Promise<void> {
  await runTransaction('draft', 'readwrite', (store) => store.delete(DRAFT_KEY));
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
  const [reports, templates, draft, images] = await Promise.all([
    getAllReports(),
    getAllTemplates(),
    getDraft(),
    getAllImages(),
  ]);

  const theme = (localStorage.getItem('abmax_theme') as 'light' | 'dark') || 'light';

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
  if (backup.preferences?.theme) {
    localStorage.setItem('abmax_theme', backup.preferences.theme);
  }

  return { addedReports, addedTemplates, addedImages };
}
