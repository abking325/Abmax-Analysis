import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Check,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  X,
} from 'lucide-react';
import {
  MAJOR_LIQUIDITY_ITEMS,
  MajorLiquidityItem,
  SupplyDemandLevel,
  TIMEFRAME_ORDER,
  TimeframeId,
} from '../types/journal';

/* ================= MAJOR LIQUIDITY COMPONENT ================= */

interface MajorLiquidityProps {
  selectedItems: MajorLiquidityItem[];
  onToggleItem: (item: MajorLiquidityItem) => void;
}

export const MajorLiquiditySection: React.FC<MajorLiquidityProps> = ({
  selectedItems,
  onToggleItem,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="border border-app rounded-lg bg-app-main mb-4 transition-colors shadow-2xs overflow-hidden">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="p-3 sm:p-4 bg-app-secondary border-b border-app/60 flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-app-main tracking-tight">
            Major Liquidity
          </h3>
          <span className="text-xs text-app-secondary">
            ({selectedItems.length} crossed)
          </span>
        </div>

        <button
          type="button"
          className="p-1 rounded text-app-secondary hover:text-app-main"
          aria-label={isOpen ? 'Collapse liquidity' : 'Expand liquidity'}
        >
          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {isOpen && (
        <div className="p-3.5 sm:p-5 bg-app-main">
          <p className="text-xs text-app-secondary mb-3 leading-normal">
            Toggle key liquidity pools that price has swept, mitigated, or crossed:
          </p>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {MAJOR_LIQUIDITY_ITEMS.map((item) => {
              const isSelected = selectedItems.includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onToggleItem(item)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border transition-colors ${
                    isSelected
                      ? 'bg-emerald-pale text-bullish border-emerald-500 font-semibold shadow-2xs'
                      : 'bg-app-field border-app text-app-main hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border text-[10px] ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-slate-400 dark:border-slate-600'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span className={isSelected ? 'line-through decoration-emerald-700 decoration-1' : ''}>
                    {item}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

/* ================= SUPPLY & DEMAND LEVELS COMPONENT ================= */

interface SupplyDemandProps {
  levels: SupplyDemandLevel[];
  onAddLevel: (level: SupplyDemandLevel) => void;
  onUpdateLevel: (level: SupplyDemandLevel) => void;
  onRemoveLevel: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

export const SupplyDemandSection: React.FC<SupplyDemandProps> = ({
  levels,
  onAddLevel,
  onUpdateLevel,
  onRemoveLevel,
  onToggleVisibility,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New level draft state
  const [newTimeframe, setNewTimeframe] = useState<TimeframeId>('4H');
  const [newSupply, setNewSupply] = useState('');
  const [newDemand, setNewDemand] = useState('');

  // Editing draft state
  const [editTimeframe, setEditTimeframe] = useState<TimeframeId>('4H');
  const [editSupply, setEditSupply] = useState('');
  const [editDemand, setEditDemand] = useState('');

  const handleStartEdit = (level: SupplyDemandLevel) => {
    setEditingId(level.id);
    setEditTimeframe(level.timeframe);
    setEditSupply(level.supply);
    setEditDemand(level.demand);
  };

  const handleSaveEdit = (level: SupplyDemandLevel) => {
    onUpdateLevel({
      ...level,
      timeframe: editTimeframe,
      supply: editSupply.trim(),
      demand: editDemand.trim(),
    });
    setEditingId(null);
  };

  const handleSaveNew = () => {
    if (!newSupply.trim() && !newDemand.trim()) return;
    const newEntry: SupplyDemandLevel = {
      id: `sd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timeframe: newTimeframe,
      supply: newSupply.trim(),
      demand: newDemand.trim(),
      showInTimeframe: true,
    };
    onAddLevel(newEntry);
    setNewSupply('');
    setDemandText();
    setIsAdding(false);
  };

  const setDemandText = () => {
    setNewDemand('');
  };

  return (
    <section className="border border-app rounded-lg bg-app-main mb-4 transition-colors shadow-2xs overflow-hidden">
      <div className="p-3 sm:p-4 bg-app-secondary border-b border-app/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base sm:text-lg font-bold text-app-main tracking-tight">
            Supply &amp; Demand Levels
          </h3>
          <span className="text-xs text-app-secondary">
            ({levels.length} active)
          </span>
        </div>

        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Level
          </button>
        )}
      </div>

      <div className="p-3.5 sm:p-5 bg-app-main">
        {/* Saved entries list appear above editor entries */}
        {levels.length > 0 ? (
          <div className="space-y-2 mb-4">
            {levels.map((level) => {
              if (editingId === level.id) {
                // Inline modification mode
                return (
                  <div
                    key={level.id}
                    className="p-3 rounded border border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={editTimeframe}
                        onChange={(e) => setEditTimeframe(e.target.value as TimeframeId)}
                        className="px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main"
                      >
                        {TIMEFRAME_ORDER.map((tf) => (
                          <option key={tf} value={tf}>
                            {tf}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={editSupply}
                        onChange={(e) => setEditSupply(e.target.value)}
                        placeholder="Supply level / range"
                        className="flex-1 min-w-[140px] px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums"
                      />

                      <input
                        type="text"
                        value={editDemand}
                        onChange={(e) => setEditDemand(e.target.value)}
                        placeholder="Demand level / range"
                        className="flex-1 min-w-[140px] px-2.5 py-1 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums"
                      />

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(level)}
                          className="px-2.5 py-1 text-xs bg-emerald-theme text-white rounded font-medium hover:bg-emerald-hover"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-xs text-app-secondary hover:bg-app-field rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Normal displayed row
              return (
                <div
                  key={level.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 sm:px-3 rounded border border-app bg-app-secondary/60 hover:bg-app-secondary transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-bold text-app-main px-1.5 py-0.5 rounded bg-app-main border border-app text-[11px]">
                      {level.timeframe}
                    </span>
                    {level.supply && (
                      <span className="text-app-main font-mono tabular-nums">
                        <strong className="text-bearish font-semibold">Supply:</strong>{' '}
                        {level.supply}
                      </span>
                    )}
                    {level.demand && (
                      <span className="text-app-main font-mono tabular-nums">
                        <strong className="text-bullish font-semibold">Demand:</strong>{' '}
                        {level.demand}
                      </span>
                    )}
                  </div>

                  {/* Actions: Show/Hide, Modify, Remove */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleVisibility(level.id)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                        level.showInTimeframe
                          ? 'text-emerald-theme bg-emerald-pale hover:bg-emerald-100'
                          : 'text-app-secondary bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800'
                      }`}
                      title={
                        level.showInTimeframe
                          ? 'Shown in timeframe section'
                          : 'Hidden in timeframe section'
                      }
                    >
                      {level.showInTimeframe ? (
                        <>
                          <Eye className="w-3 h-3" /> Hide here
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3 h-3" /> Show here
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStartEdit(level)}
                      className="p-1 text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors"
                      title="Modify level"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveLevel(level.id)}
                      className="p-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
                      title="Remove level"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          !isAdding && (
            <p className="text-xs text-app-secondary italic py-1">
              No supply/demand levels added yet. Click &ldquo;+ Add Level&rdquo; above.
            </p>
          )
        )}

        {/* New Level Editor Form */}
        {isAdding && (
          <div className="p-3.5 rounded border border-emerald-600/40 bg-emerald-50/15 dark:bg-emerald-950/15 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-app-main uppercase tracking-wider">
              <span>New Supply &amp; Demand Level</span>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="text-app-secondary hover:text-app-main p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Timeframe
                </label>
                <select
                  value={newTimeframe}
                  onChange={(e) => setNewTimeframe(e.target.value as TimeframeId)}
                  className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main"
                >
                  {TIMEFRAME_ORDER.map((tf) => (
                    <option key={tf} value={tf}>
                      {tf}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Supply level or range
                </label>
                <input
                  type="text"
                  value={newSupply}
                  onChange={(e) => setNewSupply(e.target.value)}
                  placeholder="e.g. 2680 - 2685"
                  className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Demand level or range
                </label>
                <input
                  type="text"
                  value={newDemand}
                  onChange={(e) => setNewDemand(e.target.value)}
                  placeholder="e.g. 2650 - 2655"
                  className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded transition-colors"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={handleSaveNew}
                disabled={!newSupply.trim() && !newDemand.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded transition-colors disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" /> Save Level
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
