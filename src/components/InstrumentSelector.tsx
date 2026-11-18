import React, { useMemo } from 'react';
import { InstrumentDefinition } from '../types/journal';
import {
  buildEditorInstrumentOptions,
  buildFilterInstrumentOptions,
  normalizeInstrumentSymbol,
} from '../services/instruments';

interface InstrumentSelectorProps {
  instruments: InstrumentDefinition[];
  value: string;
  onChange: (symbol: string) => void;
  mode?: 'editor' | 'filter';
  historicalPairs?: Array<string | undefined | null>;
  allValue?: string;
  allLabel?: string;
  id?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export const InstrumentSelector: React.FC<InstrumentSelectorProps> = ({
  instruments,
  value,
  onChange,
  mode = 'editor',
  historicalPairs = [],
  allValue = 'All',
  allLabel = 'All pairs',
  id,
  className = 'w-full px-3 py-1.5 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main font-semibold focus:outline-hidden focus:border-emerald-600 cursor-pointer',
  ariaLabel = 'Instrument',
  disabled = false,
}) => {
  const options = useMemo(() => {
    if (mode === 'filter') {
      return buildFilterInstrumentOptions(instruments, historicalPairs);
    }
    return buildEditorInstrumentOptions(instruments, value);
  }, [instruments, mode, historicalPairs, value]);

  // Ensure selected historical value stays aligned with option values
  const normalizedValue = useMemo(() => {
    if (mode === 'filter' && value === allValue) return allValue;
    const norm = normalizeInstrumentSymbol(value);
    const exact = options.find((o) => o.symbol === value);
    if (exact) return exact.symbol;
    const caseMatch = options.find((o) => normalizeInstrumentSymbol(o.symbol) === norm);
    return caseMatch ? caseMatch.symbol : value;
  }, [mode, allValue, value, options]);

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={normalizedValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    >
      {mode === 'filter' && <option value={allValue}>{allLabel}</option>}
      {options.map((opt) => (
        <option key={opt.symbol} value={opt.symbol}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};
