import React, { useEffect, useState } from 'react';
import { BookMarked, Check, Sparkles } from 'lucide-react';
import {
  StrategySnapshot,
  TradingStrategy,
  createStrategySnapshot,
} from '../types/journal';
import { getStrategiesForScope, getStrategyById } from '../services/db';

export interface StrategySelectionChange {
  strategyId?: string;
  strategy: string;
  strategySnapshot?: StrategySnapshot;
}

interface StrategySelectorProps {
  strategyId?: string;
  strategy: string;
  strategySnapshot?: StrategySnapshot;
  userId?: string | null;
  onChange: (change: StrategySelectionChange) => void;
  /** Optional helper to populate target scenario fields ONLY on explicit user confirmation */
  hasExistingTargetContent?: boolean;
  onApplyStrategyRules?: (
    strategy: TradingStrategy | StrategySnapshot,
    mode: 'fill-empty' | 'replace'
  ) => void;
  label?: string;
  compact?: boolean;
}

const CUSTOM_SENTINEL = '__custom__';
const NONE_SENTINEL = '';

export const StrategySelector: React.FC<StrategySelectorProps> = ({
  strategyId,
  strategy,
  strategySnapshot,
  userId,
  onChange,
  hasExistingTargetContent = false,
  onApplyStrategyRules,
  label = 'Strategy Used',
  compact = false,
}) => {
  const [strategies, setStrategies] = useState<TradingStrategy[]>([]);
  const [referencedStrategy, setReferencedStrategy] = useState<TradingStrategy | null>(null);
  const [isCustomMode, setIsCustomMode] = useState<boolean>(() =>
    Boolean(!strategyId && strategy && strategy.trim().length > 0)
  );
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    getStrategiesForScope(userId)
      .then((list) => {
        if (mounted) setStrategies(list);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!strategyId) {
      setReferencedStrategy(null);
      if (strategy && strategy.trim().length > 0) {
        setIsCustomMode(true);
      }
      return;
    }
    setIsCustomMode(false);
    const localFound = strategies.find((s) => s.id === strategyId);
    if (localFound) {
      setReferencedStrategy(localFound);
      return;
    }
    let mounted = true;
    getStrategyById(strategyId)
      .then((found) => {
        if (mounted && found) setReferencedStrategy(found);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [strategyId, strategies, strategy]);

  const activeStrategies = strategies.filter((s) => !s.isArchived);
  const showArchivedLinked =
    Boolean(strategyId) && !activeStrategies.some((s) => s.id === strategyId);

  const selectedStrategyObj: TradingStrategy | StrategySnapshot | null =
    (strategyId && (strategies.find((s) => s.id === strategyId) || referencedStrategy || strategySnapshot)) ||
    null;

  const selectValue = isCustomMode
    ? CUSTOM_SENTINEL
    : strategyId || NONE_SENTINEL;

  const handleSelectChange = (val: string) => {
    setConfirmApplyOpen(false);
    if (val === NONE_SENTINEL) {
      setIsCustomMode(false);
      onChange({
        strategyId: undefined,
        strategy: '',
        strategySnapshot: undefined,
      });
      return;
    }

    if (val === CUSTOM_SENTINEL) {
      setIsCustomMode(true);
      onChange({
        strategyId: undefined,
        strategy: strategy || '',
        strategySnapshot: undefined,
      });
      return;
    }

    const picked =
      strategies.find((s) => s.id === val) ||
      (referencedStrategy?.id === val ? referencedStrategy : null);

    if (picked) {
      setIsCustomMode(false);
      onChange({
        strategyId: picked.id,
        strategy: picked.name,
        strategySnapshot: createStrategySnapshot(picked),
      });
    } else if (strategySnapshot && val === strategyId) {
      setIsCustomMode(false);
      onChange({
        strategyId,
        strategy: strategySnapshot.name || strategy,
        strategySnapshot,
      });
    }
  };

  const canApplyRules = Boolean(
    onApplyStrategyRules &&
      selectedStrategyObj &&
      (selectedStrategyObj.description ||
        selectedStrategyObj.entryRules ||
        selectedStrategyObj.invalidationConditions)
  );

  const handleApplyClick = () => {
    if (!selectedStrategyObj || !onApplyStrategyRules) return;
    if (hasExistingTargetContent) {
      setConfirmApplyOpen(true);
    } else {
      onApplyStrategyRules(selectedStrategyObj, 'fill-empty');
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label
          className={`block font-medium text-app-secondary ${
            compact ? 'text-[11px]' : 'text-xs'
          }`}
        >
          {label}
        </label>
        {canApplyRules && (
          <button
            type="button"
            onClick={handleApplyClick}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-theme hover:underline cursor-pointer"
          >
            <BookMarked className="w-3 h-3" />
            <span>Apply strategy rules</span>
          </button>
        )}
      </div>

      <select
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        className={`w-full bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 cursor-pointer ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm'
        }`}
        aria-label={label}
      >
        <option value={NONE_SENTINEL}>No strategy selected</option>
        {activeStrategies.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {showArchivedLinked && strategyId && (
          <option value={strategyId}>
            {referencedStrategy?.name || strategySnapshot?.name || strategy || 'Linked Strategy'} (Archived)
          </option>
        )}
        <option value={CUSTOM_SENTINEL}>Custom / type manually</option>
      </select>

      {isCustomMode && (
        <input
          type="text"
          value={strategy}
          onChange={(e) =>
            onChange({
              strategyId: undefined,
              strategy: e.target.value,
              strategySnapshot: undefined,
            })
          }
          placeholder="Type custom strategy name..."
          className={`w-full bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 ${
            compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-xs sm:text-sm'
          }`}
        />
      )}

      {confirmApplyOpen && selectedStrategyObj && onApplyStrategyRules && (
        <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-[11px] space-y-1.5">
          <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>Existing scenario fields contain text. How would you like to apply strategy rules?</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onApplyStrategyRules(selectedStrategyObj, 'fill-empty');
                setConfirmApplyOpen(false);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-theme text-white font-semibold cursor-pointer"
            >
              <Check className="w-3 h-3" />
              Fill empty fields only
            </button>
            <button
              type="button"
              onClick={() => {
                onApplyStrategyRules(selectedStrategyObj, 'replace');
                setConfirmApplyOpen(false);
              }}
              className="px-2 py-0.5 rounded bg-amber-600 text-white font-semibold cursor-pointer"
            >
              Replace existing fields
            </button>
            <button
              type="button"
              onClick={() => setConfirmApplyOpen(false)}
              className="px-2 py-0.5 text-app-secondary hover:text-app-main cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
