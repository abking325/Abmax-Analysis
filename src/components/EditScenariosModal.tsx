import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PlannedScenario } from '../types/journal';
import { deepClone } from '../utils/analysisUtils';
import { ImageAttachmentManager } from './ImageAttachmentManager';
import { ImageViewerModal } from './ImageViewerModal';
import { StrategySelector } from './StrategySelector';
import { registerBackHandler } from '../utils/backNavigation';

interface EditScenariosModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenarios: PlannedScenario[];
  onSave: (scenarios: PlannedScenario[]) => Promise<void>;
  userId?: string | null;
}

export const EditScenariosModal: React.FC<EditScenariosModalProps> = ({
  isOpen,
  onClose,
  scenarios: initialScenarios,
  onSave,
  userId,
}) => {
  const [scenarios, setScenarios] = useState<PlannedScenario[]>(() =>
    deepClone(initialScenarios || [])
  );
  const baselineJsonRef = useRef<string>(JSON.stringify(initialScenarios || []));
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) return;
    const cloned = deepClone(initialScenarios || []);
    setScenarios(cloned);
    baselineJsonRef.current = JSON.stringify(cloned);
    setDeleteConfirmId(null);
    setShowUnsavedWarning(false);
    setError(null);
  }, [isOpen, initialScenarios]);

  const isDirty = useCallback(() => {
    return JSON.stringify(scenarios) !== baselineJsonRef.current;
  }, [scenarios]);

  const handleAttemptClose = useCallback(() => {
    if (isSaving) return;
    if (isDirty() && !showUnsavedWarning) {
      setShowUnsavedWarning(true);
      return;
    }
    setShowUnsavedWarning(false);
    onClose();
  }, [isSaving, isDirty, showUnsavedWarning, onClose]);

  const backActionRef = useRef<() => void>(() => {});
  backActionRef.current = () => {
    if (activeViewerImage) {
      setActiveViewerImage(null);
    } else if (showUnsavedWarning) {
      setShowUnsavedWarning(false);
    } else {
      handleAttemptClose();
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        backActionRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unregBack = registerBackHandler(() => backActionRef.current());
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unregBack();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddScenario = () => {
    const nextIndex = scenarios.length + 1;
    const newScn: PlannedScenario = {
      id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      label: `Scenario ${nextIndex}`,
      strategy: '',
      direction: '',
      description: '',
      entryConditions: '',
      invalidationConditions: '',
      images: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setScenarios([...scenarios, newScn]);
  };

  const handleUpdate = (id: string, updates: Partial<PlannedScenario>) => {
    setScenarios(
      scenarios.map((s) => (s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s))
    );
  };

  const handleRemove = (id: string) => {
    const filtered = scenarios.filter((s) => s.id !== id);
    const renumbered = filtered.map((s, idx) => ({
      ...s,
      label: `Scenario ${idx + 1}`,
    }));
    setScenarios(renumbered);
    setDeleteConfirmId(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(deepClone(scenarios));
      setShowUnsavedWarning(false);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to update scenarios');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Planned Scenarios"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={handleAttemptClose}
    >
      <div
        className="w-full max-w-2xl bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-app bg-app-secondary">
          <div>
            <div className="text-sm font-bold text-app-main">Edit Planned Scenarios</div>
            <p className="text-[11px] text-app-secondary">
              Update existing setups or add scenarios directly to this report.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAttemptClose}
            className="p-1 text-app-secondary hover:text-app-main rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {showUnsavedWarning && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>Discard unsaved scenario changes?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowUnsavedWarning(false)}
                className="px-2.5 py-1 bg-app-main border border-app text-app-main rounded text-[11px] font-medium cursor-pointer"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUnsavedWarning(false);
                  onClose();
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-[11px] cursor-pointer"
              >
                Discard changes
              </button>
            </div>
          </div>
        )}

        {/* Content body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs text-app-main flex-1">
          {error && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="font-semibold text-app-main">
              {scenarios.length} {scenarios.length === 1 ? 'Scenario' : 'Scenarios'} Defined
            </span>
            <button
              type="button"
              onClick={handleAddScenario}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Scenario
            </button>
          </div>

          {scenarios.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-app rounded bg-app-secondary/30">
              <p className="text-app-secondary text-xs">
                No scenarios in this report. Click &ldquo;Add Scenario&rdquo; above.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {scenarios.map((s, idx) => (
                <div
                  key={s.id}
                  className="p-3.5 rounded border border-app bg-app-secondary/40 space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-app/60">
                    <span className="font-bold text-app-main text-xs">{s.label || `Scenario ${idx + 1}`}</span>

                    {deleteConfirmId === s.id ? (
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-rose-600">Remove?</span>
                        <button
                          type="button"
                          onClick={() => handleRemove(s.id)}
                          className="px-2 py-0.5 bg-rose-600 text-white rounded text-[10px]"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-1.5 py-0.5 text-app-secondary text-[10px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(s.id)}
                        className="p-1 text-app-secondary hover:text-rose-600 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <StrategySelector
                        compact
                        userId={userId}
                        strategyId={s.strategyId}
                        strategy={s.strategy}
                        strategySnapshot={s.strategySnapshot}
                        onChange={({ strategyId, strategy, strategySnapshot }) =>
                          handleUpdate(s.id, { strategyId, strategy, strategySnapshot })
                        }
                        hasExistingTargetContent={Boolean(
                          s.description.trim() ||
                            s.entryConditions.trim() ||
                            s.invalidationConditions.trim()
                        )}
                        onApplyStrategyRules={(selectedStrat, mode) => {
                          const nextDescription =
                            mode === 'replace'
                              ? selectedStrat.description || s.description
                              : s.description.trim()
                                ? s.description
                                : selectedStrat.description || '';
                          const nextEntry =
                            mode === 'replace'
                              ? selectedStrat.entryRules || s.entryConditions
                              : s.entryConditions.trim()
                                ? s.entryConditions
                                : selectedStrat.entryRules || '';
                          const nextInvalidation =
                            mode === 'replace'
                              ? selectedStrat.invalidationConditions || s.invalidationConditions
                              : s.invalidationConditions.trim()
                                ? s.invalidationConditions
                                : selectedStrat.invalidationConditions || '';
                          handleUpdate(s.id, {
                            description: nextDescription,
                            entryConditions: nextEntry,
                            invalidationConditions: nextInvalidation,
                          });
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Direction
                      </label>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdate(s.id, { direction: s.direction === 'Buy' ? '' : 'Buy' })
                          }
                          className={`py-1 text-xs font-semibold rounded border ${
                            s.direction === 'Buy'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-app-field text-app-main border-app'
                          }`}
                        >
                          Buy
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdate(s.id, { direction: s.direction === 'Sell' ? '' : 'Sell' })
                          }
                          className={`py-1 text-xs font-semibold rounded border ${
                            s.direction === 'Sell'
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-app-field text-app-main border-app'
                          }`}
                        >
                          Sell
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-app-secondary mb-1">
                      Scenario Description
                    </label>
                    <textarea
                      rows={2}
                      spellCheck
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      value={s.description}
                      onChange={(e) => handleUpdate(s.id, { description: e.target.value })}
                      placeholder="Expected market narrative..."
                      className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Entry Conditions / Rules
                      </label>
                      <textarea
                        rows={2}
                        spellCheck
                        autoCorrect="on"
                        autoCapitalize="sentences"
                        value={s.entryConditions}
                        onChange={(e) => handleUpdate(s.id, { entryConditions: e.target.value })}
                        placeholder="Confirmation trigger..."
                        className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-app-secondary mb-1">
                        Invalidation Conditions
                      </label>
                      <textarea
                        rows={2}
                        spellCheck
                        autoCorrect="on"
                        autoCapitalize="sentences"
                        value={s.invalidationConditions}
                        onChange={(e) =>
                          handleUpdate(s.id, { invalidationConditions: e.target.value })
                        }
                        placeholder="Boundary or price failure..."
                        className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-rose-500 resize-y"
                      />
                    </div>
                  </div>

                  {/* Scenario Charts & Markups */}
                  <div className="pt-2 border-t border-app/60">
                    <ImageAttachmentManager
                      attachments={s.images || []}
                      onChange={(imgs) => handleUpdate(s.id, { images: imgs })}
                      onViewImage={(url, title) => setActiveViewerImage({ url, title })}
                      label="Scenario Charts & Setup Markups"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 border-t border-app bg-app-secondary">
          <button
            type="button"
            onClick={handleAttemptClose}
            className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Scenarios'}
          </button>
        </div>
      </div>

      {/* Fullscreen Image Viewer Modal */}
      {activeViewerImage && (
        <ImageViewerModal
          isOpen={Boolean(activeViewerImage)}
          onClose={() => setActiveViewerImage(null)}
          imageUrl={activeViewerImage.url}
          title={activeViewerImage.title}
        />
      )}
    </div>
  );
};
