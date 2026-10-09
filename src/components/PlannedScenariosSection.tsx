import React, { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { PlannedScenario } from '../types/journal';

interface PlannedScenariosSectionProps {
  scenarios: PlannedScenario[];
  onChange: (scenarios: PlannedScenario[]) => void;
}

export const PlannedScenariosSection: React.FC<PlannedScenariosSectionProps> = ({
  scenarios = [],
  onChange,
}) => {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const handleAddScenario = () => {
    const nextIndex = scenarios.length + 1;
    const newScenario: PlannedScenario = {
      id: `scn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      label: `Scenario ${nextIndex}`,
      strategy: '',
      direction: '',
      description: '',
      entryConditions: '',
      invalidationConditions: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onChange([...scenarios, newScenario]);
    // Expand newly added scenario
    setExpandedMap((prev) => ({ ...prev, [newScenario.id]: true }));
  };

  const handleUpdateScenario = (id: string, updates: Partial<PlannedScenario>) => {
    const updated = scenarios.map((s) => {
      if (s.id === id) {
        return {
          ...s,
          ...updates,
          updatedAt: Date.now(),
        };
      }
      return s;
    });
    onChange(updated);
  };

  const handleRemoveScenario = (id: string) => {
    const filtered = scenarios.filter((s) => s.id !== id);
    // Renumber scenario labels to keep them orderly (Scenario 1, Scenario 2...)
    const renumbered = filtered.map((s, idx) => ({
      ...s,
      label: `Scenario ${idx + 1}`,
    }));
    onChange(renumbered);
    setDeleteConfirmId(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }));
  };

  return (
    <div className="border border-app rounded-lg bg-app-main p-4 sm:p-5 mb-6 shadow-2xs">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-bold text-app-main uppercase tracking-wider flex items-center gap-2">
            <span>Planned Scenarios</span>
            {scenarios.length > 0 && (
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                {scenarios.length} {scenarios.length === 1 ? 'scenario' : 'scenarios'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-app-secondary mt-0.5">
            Pre-define strategic execution rules, confirmation criteria, and invalidation boundaries before placing trades.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAddScenario}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Scenario
        </button>
      </div>

      {scenarios.length === 0 ? (
        <div className="p-4 rounded border border-dashed border-app bg-app-secondary/30 text-center">
          <p className="text-xs text-app-secondary">
            No planned scenarios added yet. Click &ldquo;Add Scenario&rdquo; to outline your setup playbook.
          </p>
        </div>
      ) : (
        <div className="space-y-3.5 mt-3">
          {scenarios.map((scenario, index) => {
            const isExpanded = expandedMap[scenario.id] !== false; // default open
            const isDeleting = deleteConfirmId === scenario.id;

            return (
              <div
                key={scenario.id}
                className="border border-app rounded-md bg-app-secondary/30 overflow-hidden transition-all"
              >
                {/* Header bar of the scenario card */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-app-secondary/60 border-b border-app/60">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-xs font-bold text-app-main">
                      {scenario.label || `Scenario ${index + 1}`}
                    </span>

                    {/* Direction badge if selected */}
                    {scenario.direction && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                          scenario.direction === 'Buy'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
                        }`}
                      >
                        {scenario.direction}
                      </span>
                    )}

                    {scenario.strategy && (
                      <span className="text-[11px] text-app-secondary truncate max-w-[200px]">
                        ({scenario.strategy})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Delete confirmation */}
                    {isDeleting ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/40 p-1 rounded border border-rose-200 dark:border-rose-800 text-[11px]">
                        <span className="text-rose-700 dark:text-rose-300">Remove?</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveScenario(scenario.id)}
                          className="px-2 py-0.5 bg-rose-600 text-white rounded font-medium text-[10px]"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-1.5 py-0.5 text-app-secondary hover:text-app-main text-[10px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(scenario.id)}
                        className="p-1 text-app-secondary hover:text-rose-600 rounded transition-colors"
                        title="Remove scenario"
                        aria-label={`Remove ${scenario.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(scenario.id)}
                      className="p-1 text-app-secondary hover:text-app-main rounded transition-colors"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                      aria-label={isExpanded ? 'Collapse scenario' : 'Expand scenario'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Body fields */}
                {isExpanded && (
                  <div className="p-3.5 sm:p-4 space-y-3.5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* Strategy Used */}
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-app-secondary mb-1">
                          Strategy Used
                        </label>
                        <input
                          type="text"
                          value={scenario.strategy}
                          onChange={(e) =>
                            handleUpdateScenario(scenario.id, { strategy: e.target.value })
                          }
                          placeholder="e.g. 15M CHoCH + 5M FVG Tap, Asia Range Sweep Reversal..."
                          className="w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                        />
                      </div>

                      {/* Direction Selection */}
                      <div>
                        <label className="block text-xs font-medium text-app-secondary mb-1">
                          Direction
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateScenario(scenario.id, {
                                direction: scenario.direction === 'Buy' ? '' : 'Buy',
                              })
                            }
                            className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer text-center ${
                              scenario.direction === 'Buy'
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                                : 'bg-app-field text-app-main border-app hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                            }`}
                          >
                            Buy
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateScenario(scenario.id, {
                                direction: scenario.direction === 'Sell' ? '' : 'Sell',
                              })
                            }
                            className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer text-center ${
                              scenario.direction === 'Sell'
                                ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                                : 'bg-app-field text-app-main border-app hover:bg-rose-50 dark:hover:bg-rose-950/30'
                            }`}
                          >
                            Sell
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Scenario Description */}
                    <div>
                      <label className="block text-xs font-medium text-app-secondary mb-1">
                        Scenario Description
                      </label>
                      <textarea
                        rows={2}
                        value={scenario.description}
                        onChange={(e) =>
                          handleUpdateScenario(scenario.id, { description: e.target.value })
                        }
                        placeholder="Expected narrative and context: how price delivers into the POI..."
                        className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                      />
                    </div>

                    {/* Two-column layout for Entry & Invalidation */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Entry Conditions / Rules */}
                      <div>
                        <label className="block text-xs font-medium text-app-secondary mb-1">
                          Entry Conditions / Rules
                        </label>
                        <textarea
                          rows={2}
                          value={scenario.entryConditions}
                          onChange={(e) =>
                            handleUpdateScenario(scenario.id, { entryConditions: e.target.value })
                          }
                          placeholder="e.g. Wait for 5M displacement body close, limit order at 50% discount..."
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                        />
                      </div>

                      {/* Invalidation Conditions */}
                      <div>
                        <label className="block text-xs font-medium text-app-secondary mb-1">
                          Invalidation Conditions
                        </label>
                        <textarea
                          rows={2}
                          value={scenario.invalidationConditions}
                          onChange={(e) =>
                            handleUpdateScenario(scenario.id, {
                              invalidationConditions: e.target.value,
                            })
                          }
                          placeholder="e.g. Candle close below prior swing low, clean breach without rejection..."
                          className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-rose-500 resize-y"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
