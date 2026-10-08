import React, { useEffect, useState } from 'react';
import { X, Bookmark, Edit2, Trash2, Check, Clock } from 'lucide-react';
import { SavedTemplate } from '../types/journal';
import { getAllTemplates, deleteTemplate, renameTemplate } from '../services/db';

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter a template name.');
      return;
    }
    setSaving(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save Analysis Template"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl overflow-hidden"
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
            className="p-1 text-app-secondary hover:text-app-main rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          <p className="text-xs text-app-secondary leading-normal">
            This will save all current analytical fields, bias selections, liquidity marks,
            supply/demand levels, and notes as a reusable starting setup.
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

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const list = await getAllTemplates();
      setTemplates(list);
    } catch (err) {
      console.error('Failed to fetch templates', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
      setRenamingId(null);
      setConfirmDeleteId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartRename = (t: SavedTemplate) => {
    setRenamingId(t.id);
    setNewName(t.name);
  };

  const handleSaveRename = async (id: string) => {
    if (!newName.trim()) return;
    try {
      await renameTemplate(id, newName.trim());
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

  return (
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
            className="p-1 text-app-secondary hover:text-app-main rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
          <p className="text-xs text-app-secondary leading-normal mb-2">
            Select a saved template. It will load into your editor as a fresh analysis with
            today&apos;s date without modifying the template.
          </p>

          {loading ? (
            <div className="text-center py-8 text-xs text-app-secondary">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-app rounded p-4 text-xs text-app-secondary">
              No saved templates found. You can save your current analysis as a template anytime.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((tmpl) => (
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
                        className="p-1 bg-emerald-theme text-white rounded hover:bg-emerald-hover"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="p-1 text-app-secondary hover:bg-app-field rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-app-main">
                          {tmpl.name}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-app-secondary mt-0.5">
                          <span>Pair: {tmpl.data.pair}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(tmpl.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectTemplate(tmpl)}
                          className="px-3 py-1 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartRename(tmpl)}
                          className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded"
                          title="Rename template"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteId === tmpl.id ? (
                          <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 p-0.5 rounded border border-rose-300">
                            <button
                              type="button"
                              onClick={() => handleDelete(tmpl.id)}
                              className="px-2 py-0.5 text-[11px] bg-rose-600 text-white rounded font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1 text-[11px] text-app-secondary"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(tmpl.id)}
                            className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded"
                            title="Delete template"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-app bg-app-secondary flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
