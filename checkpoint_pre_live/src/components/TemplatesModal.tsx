import React, { useEffect, useState, useRef } from 'react';
import { X, Bookmark, Edit2, Trash2, Check, Clock, AlertCircle } from 'lucide-react';
import { SavedTemplate } from '../types/journal';
import { getAllTemplates, deleteTemplate, renameTemplate } from '../services/db';
import { ErrorBoundary } from './ErrorBoundary';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onReplaceExisting?: (template: SavedTemplate) => Promise<void>;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onReplaceExisting,
}) => {
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const [name, setName] = useState('');
  const [availableTemplates, setAvailableTemplates] = useState<SavedTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
      setMode('new');
      setSelectedTemplateId('');
      isSubmittingRef.current = false;
      setLoadingTemplates(true);
      getAllTemplates()
        .then((tmpls) => {
          setAvailableTemplates(tmpls);
          if (tmpls.length > 0) {
            setSelectedTemplateId(tmpls[0].id);
          }
        })
        .catch((e) => {
          console.error('[SaveTemplate] Error fetching templates:', e);
        })
        .finally(() => {
          setLoadingTemplates(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedTemplate = availableTemplates.find((t) => t.id === selectedTemplateId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || saving) return;

    if (mode === 'new') {
      const trimmed = name.trim();
      if (!trimmed) {
        setError('Please enter a template name.');
        return;
      }

      isSubmittingRef.current = true;
      setSaving(true);
      setError(null);

      try {
        await onSave(trimmed);
        onClose();
      } catch (err) {
        console.error('[SaveTemplate] Error saving template:', err);
        setError((err as Error).message || 'Failed to save template. Please try again.');
      } finally {
        setSaving(false);
        isSubmittingRef.current = false;
      }
    } else {
      if (!selectedTemplate) {
        setError('Please select an existing template to replace.');
        return;
      }
      if (!onReplaceExisting) {
        setError('Replacing templates is not supported in this view.');
        return;
      }

      isSubmittingRef.current = true;
      setSaving(true);
      setError(null);

      try {
        await onReplaceExisting(selectedTemplate);
        onClose();
      } catch (err) {
        console.error('[SaveTemplate] Error replacing template:', err);
        setError((err as Error).message || 'Failed to replace template. Please try again.');
      } finally {
        setSaving(false);
        isSubmittingRef.current = false;
      }
    }
  };

  return (
    <ErrorBoundary fallbackTitle="Template save encountered an issue" onReset={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save Analysis Template"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl overflow-hidden text-app-main"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-app bg-app-secondary">
            <div className="flex items-center gap-2 text-sm font-bold text-app-main">
              <Bookmark className="w-4 h-4 text-emerald-theme" />
              Save Analysis Template
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-app-secondary hover:text-app-main rounded min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
            {/* Mode selection buttons */}
            <div className="flex items-center p-1 bg-app-field rounded-lg border border-app text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setMode('new');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-center rounded-md transition-colors cursor-pointer ${
                  mode === 'new'
                    ? 'bg-app-main text-app-main font-bold shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                Save as New Template
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('replace');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-center rounded-md transition-colors cursor-pointer ${
                  mode === 'replace'
                    ? 'bg-app-main text-app-main font-bold shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                Replace Existing
              </button>
            </div>

            {mode === 'new' ? (
              <>
                <p className="text-xs text-app-secondary leading-normal">
                  Save all current analytical fields, bias selections, liquidity marks,
                  supply/demand levels, and notes as a brand new starting template.
                </p>

                <div>
                  <label className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1.5">
                    Template Name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. London Open SMC Baseline, XAU Trend Setup"
                    className="w-full px-3 py-2 text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-app-secondary leading-normal">
                  Update an existing template with your current analysis configuration. Its unique template ID will be preserved.
                </p>

                {loadingTemplates ? (
                  <div className="py-6 text-center text-xs text-app-secondary">
                    Loading saved templates...
                  </div>
                ) : availableTemplates.length === 0 ? (
                  <div className="p-3 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                    <p className="font-semibold">No saved templates found to replace.</p>
                    <p>Please switch to &ldquo;Save as New Template&rdquo; to create your first template.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-app-main uppercase tracking-wider mb-1.5">
                        Select Template to Replace
                      </label>
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 cursor-pointer"
                      >
                        {availableTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.data?.pair ? `(${t.data.pair})` : ''} — {new Date(t.updatedAt || t.createdAt).toLocaleDateString()}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedTemplate && (
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                        <span className="font-bold flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                          Confirmation Notice
                        </span>
                        <p>
                          Are you sure you want to replace template <strong className="font-semibold text-app-main">&ldquo;{selectedTemplate.name}&rdquo;</strong>?
                          Its starting setup will be overwritten with your current workspace data.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer min-h-[36px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || (mode === 'replace' && (!selectedTemplate || availableTemplates.length === 0))}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-40 cursor-pointer min-h-[36px]"
              >
                {saving
                  ? 'Saving...'
                  : mode === 'new'
                  ? 'Save Template'
                  : 'Replace Template'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
};

interface LoadTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: SavedTemplate) => void;
}

export const LoadTemplateModal: React.FC<LoadTemplateModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
}) => {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const isSelectingRef = useRef(false);

  const fetchTemplates = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await getAllTemplates();
      setTemplates(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[LoadTemplate] Failed to fetch templates', err);
      setLoadError('Failed to load templates from local storage.');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setRenamingId(null);
      setConfirmDeleteId(null);
      isSelectingRef.current = false;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartRename = (t: SavedTemplate) => {
    setRenamingId(t.id);
    setNewName(t.name || '');
  };

  const handleSaveRename = async (id: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await renameTemplate(id, trimmed);
      await fetchTemplates();
      setRenamingId(null);
    } catch (err) {
      console.error('Failed to rename template', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id);
      await fetchTemplates();
      setConfirmDeleteId(null);
    } catch (err) {
      console.error('Failed to delete template', err);
    }
  };

  const handleSelectSafe = (tmpl: SavedTemplate) => {
    if (isSelectingRef.current) return;
    isSelectingRef.current = true;
    try {
      onSelectTemplate(tmpl);
    } finally {
      setTimeout(() => {
        isSelectingRef.current = false;
      }, 300);
    }
  };

  return (
    <ErrorBoundary fallbackTitle="Template browser encountered an issue" onReset={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Load Analysis Template"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-app bg-app-secondary">
            <div className="flex items-center gap-2 text-sm font-bold text-app-main">
              <Bookmark className="w-4 h-4 text-emerald-theme" />
              Load Analysis Template
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-app-secondary hover:text-app-main rounded min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
            <p className="text-xs text-app-secondary leading-normal mb-2">
              Select a saved template. It will load into your editor as a fresh analysis with
              today&apos;s date without modifying the template.
            </p>

            {loadError && (
              <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{loadError}</span>
              </div>
            )}

            {loading ? (
              <div className="text-center py-8 text-xs text-app-secondary">Loading templates...</div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-app rounded p-4 text-xs text-app-secondary">
                No saved templates found. You can save your current analysis as a template anytime.
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((tmpl) => {
                  const pairDisplay = tmpl?.data?.pair || 'Unspecified';
                  const dateDisplay = tmpl?.updatedAt ? new Date(tmpl.updatedAt).toLocaleDateString() : '—';
                  const nameDisplay = tmpl?.name || 'Unnamed Template';

                  return (
                    <div
                      key={tmpl.id}
                      className="p-3 rounded border border-app bg-app-secondary/50 hover:bg-app-secondary transition-colors"
                    >
                      {renamingId === tmpl.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(tmpl.id)}
                            className="p-1 bg-emerald-theme text-white rounded hover:bg-emerald-hover cursor-pointer"
                            aria-label="Save new name"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="p-1 text-app-secondary hover:bg-app-field rounded cursor-pointer"
                            aria-label="Cancel rename"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-app-main">
                              {nameDisplay}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-app-secondary mt-0.5">
                              <span>Pair: {pairDisplay}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {dateDisplay}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSelectSafe(tmpl)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors cursor-pointer min-h-[32px]"
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStartRename(tmpl)}
                              className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
                              title="Rename template"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {confirmDeleteId === tmpl.id ? (
                              <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 p-0.5 rounded border border-rose-300">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(tmpl.id)}
                                  className="px-2 py-0.5 text-[11px] bg-rose-600 text-white rounded font-medium cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-1 text-[11px] text-app-secondary cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(tmpl.id)}
                                className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
                                title="Delete template"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-app bg-app-secondary flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer min-h-[36px]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};
