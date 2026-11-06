import React, { useState } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Edit2,
  Trash2,
  Check,
  X,
  Clock,
  ArrowRight,
} from 'lucide-react';
import {
  StructureDirection,
  StructureEvent,
} from '../types/journal';

interface StructureTrackerProps {
  label: 'SWING' | 'INTERNAL';
  direction: StructureDirection;
  high: string;
  low: string;
  brokenLevel: string;
  history?: StructureEvent[];
  onChange: (updated: {
    direction: StructureDirection;
    high: string;
    low: string;
    brokenLevel: string;
    history?: StructureEvent[];
  }) => void;
  showTrackingControls?: boolean;
  showHistory?: boolean;
}

export const StructureTracker: React.FC<StructureTrackerProps> = ({
  label,
  direction,
  high,
  low,
  brokenLevel,
  history = [],
  onChange,
  showTrackingControls = true,
  showHistory = true,
}) => {
  // Panel toggles for inline BOS and MSS actions
  const [activeAction, setActiveAction] = useState<'bos' | 'mss' | null>(null);

  // BOS action state
  const [bosDirection, setBosDirection] = useState<'Bullish' | 'Bearish'>('Bullish');
  const [bosBrokenLevel, setBosBrokenLevel] = useState('');
  const [bosHigh, setBosHigh] = useState('');
  const [bosLow, setBosLow] = useState('');
  const [bosValidationError, setBosValidationError] = useState<string | null>(null);

  // MSS action state
  const [mssProposedDir, setMssProposedDir] = useState<'Bullish' | 'Bearish'>('Bullish');
  const [mssBrokenLevel, setMssBrokenLevel] = useState('');
  const [mssHigh, setMssHigh] = useState('');
  const [mssLow, setMssLow] = useState('');
  const [mssValidationError, setMssValidationError] = useState<string | null>(null);

  // History section expansion
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // History inline edit state
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editBrokenLevel, setEditBrokenLevel] = useState('');
  const [editHigh, setEditHigh] = useState('');
  const [editLow, setEditLow] = useState('');

  // History delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Format compact timestamp for history entries
  const formatCompactTime = (ts: number): string => {
    if (!ts) return '';
    const d = new Date(ts);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const monthStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${monthStr} ${timeStr}`;
  };

  // Helper: validate high > low if numeric
  const validatePriceLevels = (h: string, l: string): string | null => {
    const numH = parseFloat(h.trim());
    const numL = parseFloat(l.trim());
    if (!isNaN(numH) && !isNaN(numL)) {
      if (numH <= numL) {
        return 'High price must be strictly greater than Low price.';
      }
    }
    return null;
  };

  // Open BOS panel with smart prefilling based on active direction
  const handleOpenBOS = () => {
    if (activeAction === 'bos') {
      setActiveAction(null);
      return;
    }
    setBosValidationError(null);
    const activeDir: 'Bullish' | 'Bearish' = direction === 'Bearish' ? 'Bearish' : 'Bullish';
    setBosDirection(activeDir);

    if (activeDir === 'Bullish') {
      // In bullish BOS, price breaks the prior swing high to create a higher high
      // Broken level = current high; carry forward current low; open blank new high
      setBosBrokenLevel(high || '');
      setBosLow(low || '');
      setBosHigh('');
    } else {
      // In bearish BOS, price breaks the prior swing low to create a lower low
      // Broken level = current low; carry forward current high; open blank new low
      setBosBrokenLevel(low || '');
      setBosHigh(high || '');
      setBosLow('');
    }
    setActiveAction('bos');
  };

  // Confirm BOS
  const handleConfirmBOS = () => {
    const error = validatePriceLevels(bosHigh, bosLow);
    if (error) {
      setBosValidationError(error);
      return;
    }
    setBosValidationError(null);

    const now = Date.now();
    const newEvent: StructureEvent = {
      id: `bos_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'BOS',
      direction: bosDirection,
      brokenLevel: bosBrokenLevel.trim(),
      high: bosHigh.trim(),
      low: bosLow.trim(),
      timestamp: now,
      previousSnapshot: {
        direction,
        high,
        low,
        brokenLevel,
      },
    };

    const updatedHistory = [newEvent, ...(history || [])];

    onChange({
      direction: direction || bosDirection,
      high: bosHigh.trim() || high,
      low: bosLow.trim() || low,
      brokenLevel: bosBrokenLevel.trim(),
      history: updatedHistory,
    });

    setActiveAction(null);
  };

  // Open MSS panel with proposed direction reversal
  const handleOpenMSS = () => {
    if (activeAction === 'mss') {
      setActiveAction(null);
      return;
    }
    setMssValidationError(null);

    // Propose direction reversal: Bullish -> Bearish, Bearish -> Bullish
    if (direction === 'Bullish') {
      setMssProposedDir('Bearish');
      // Market shifts to bearish: breaks the swing low
      setMssBrokenLevel(low || '');
      setMssHigh(high || '');
      setMssLow('');
    } else if (direction === 'Bearish') {
      setMssProposedDir('Bullish');
      // Market shifts to bullish: breaks the swing high
      setMssBrokenLevel(high || '');
      setMssLow(low || '');
      setMssHigh('');
    } else {
      // Neutral or Waiting: default to Bullish proposal
      setMssProposedDir('Bullish');
      setMssBrokenLevel(high || low || '');
      setMssHigh(high || '');
      setMssLow(low || '');
    }

    setActiveAction('mss');
  };

  // Confirm MSS (requires explicit confirmation before changing active direction)
  const handleConfirmMSS = () => {
    const error = validatePriceLevels(mssHigh, mssLow);
    if (error) {
      setMssValidationError(error);
      return;
    }
    setMssValidationError(null);

    const now = Date.now();
    const newEvent: StructureEvent = {
      id: `mss_${now}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'MSS',
      direction: mssProposedDir,
      brokenLevel: mssBrokenLevel.trim(),
      high: mssHigh.trim(),
      low: mssLow.trim(),
      timestamp: now,
      previousSnapshot: {
        direction,
        high,
        low,
        brokenLevel,
      },
    };

    const updatedHistory = [newEvent, ...(history || [])];

    onChange({
      direction: mssProposedDir, // Structure direction reversed upon confirmed MSS
      high: mssHigh.trim() || high,
      low: mssLow.trim() || low,
      brokenLevel: mssBrokenLevel.trim(),
      history: updatedHistory,
    });

    setActiveAction(null);
  };

  // Start inline editing of history event
  const handleStartEditEvent = (evt: StructureEvent) => {
    setEditingEventId(evt.id);
    setEditBrokenLevel(evt.brokenLevel);
    setEditHigh(evt.high);
    setEditLow(evt.low);
    setConfirmDeleteId(null);
  };

  // Save inline edit of history event
  const handleSaveEditEvent = (evtId: string) => {
    const error = validatePriceLevels(editHigh, editLow);
    if (error) {
      alert(error);
      return;
    }

    const updatedHistory = (history || []).map((e) =>
      e.id === evtId
        ? {
            ...e,
            brokenLevel: editBrokenLevel.trim(),
            high: editHigh.trim(),
            low: editLow.trim(),
          }
        : e
    );

    // If the edited event is the latest one (index 0), synchronize active structure fields
    const isLatest = history[0]?.id === evtId;
    onChange({
      direction,
      high: isLatest ? editHigh.trim() : high,
      low: isLatest ? editLow.trim() : low,
      brokenLevel: isLatest ? editBrokenLevel.trim() : brokenLevel,
      history: updatedHistory,
    });

    setEditingEventId(null);
  };

  // Delete history event
  const handleConfirmDeleteEvent = (evtId: string) => {
    const isLatest = history[0]?.id === evtId;
    const deletedEvt = history.find((e) => e.id === evtId);
    const remaining = (history || []).filter((e) => e.id !== evtId);

    if (isLatest) {
      const previous = remaining[0];
      // Check if user made manual modifications that diverge from the deleted event
      const userEditedHigh = deletedEvt ? (high !== deletedEvt.high && high !== '') : false;
      const userEditedLow = deletedEvt ? (low !== deletedEvt.low && low !== '') : false;
      const userEditedDir = deletedEvt ? (direction !== deletedEvt.direction && direction !== '') : false;

      if (previous) {
        onChange({
          direction: userEditedDir ? direction : previous.direction,
          high: userEditedHigh ? high : previous.high,
          low: userEditedLow ? low : previous.low,
          brokenLevel: previous.brokenLevel,
          history: remaining,
        });
      } else if (deletedEvt?.previousSnapshot) {
        // Restoring baseline original structure before this only event was created
        onChange({
          direction: userEditedDir ? direction : deletedEvt.previousSnapshot.direction,
          high: userEditedHigh ? high : deletedEvt.previousSnapshot.high,
          low: userEditedLow ? low : deletedEvt.previousSnapshot.low,
          brokenLevel: deletedEvt.previousSnapshot.brokenLevel,
          history: remaining,
        });
      } else {
        onChange({
          direction,
          high,
          low,
          brokenLevel: '',
          history: remaining,
        });
      }
    } else {
      // Deleting older history event leaves current active structure and manual changes untouched
      onChange({
        direction,
        high,
        low,
        brokenLevel,
        history: remaining,
      });
    }

    setConfirmDeleteId(null);
  };

  // Map legacy 'Not sure' to 'Waiting' for display
  const normalizedDirection = direction === 'Not sure' ? 'Waiting' : direction;

  return (
    <div className="p-3 rounded border border-app bg-app-secondary/50 space-y-2.5">
      {/* Title & Active Direction Display */}
      <div className="text-xs font-bold uppercase tracking-wider text-app-main pb-1 border-b border-app/60 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span>{label}</span>
        </span>
        {normalizedDirection && (
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
              normalizedDirection === 'Bullish'
                ? 'bg-emerald-pale text-bullish border border-emerald-500/30'
                : normalizedDirection === 'Bearish'
                ? 'bg-bearish-pale text-bearish border border-rose-500/30'
                : normalizedDirection === 'Neutral'
                ? 'bg-slate-200 dark:bg-slate-700 text-app-main border border-slate-400/40'
                : 'bg-amber-100 dark:bg-amber-950/40 text-amber-theme border border-amber-400/40'
            }`}
          >
            {normalizedDirection}
          </span>
        )}
      </div>

      {/* Direction Choices & Action Buttons */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-app-secondary">
          Structure Direction &amp; Tracking
        </label>
        
        {/* Responsive flex wrapping container for ~360px mobile viewports */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Direction Buttons: Bullish, Bearish, Neutral, Waiting */}
          <div className="grid grid-cols-4 gap-1 flex-1 min-w-[210px]">
            {(['Bullish', 'Bearish', 'Neutral', 'Waiting'] as const).map((dir) => {
              const isSelected = normalizedDirection === dir;
              return (
                <button
                  key={dir}
                  type="button"
                  onClick={() =>
                    onChange({
                      direction: isSelected ? '' : dir,
                      high,
                      low,
                      brokenLevel,
                      history,
                    })
                  }
                  className={`py-1 px-1.5 text-xs rounded border transition-colors text-center truncate ${
                    isSelected
                      ? dir === 'Bullish'
                        ? 'bg-emerald-pale text-bullish border-emerald-500 font-semibold'
                        : dir === 'Bearish'
                        ? 'bg-bearish-pale text-bearish border-rose-500 font-semibold'
                        : dir === 'Neutral'
                        ? 'bg-slate-200 dark:bg-slate-700 text-app-main border-slate-400 font-semibold'
                        : 'bg-amber-100 dark:bg-amber-950/40 text-amber-theme border-amber-400 font-semibold'
                      : 'border-app text-app-secondary hover:bg-app-field'
                  }`}
                >
                  {dir}
                </button>
              );
            })}
          </div>

          {/* Action Buttons: + BOS, + MSS (Controlled by showTrackingControls toggle) */}
          {showTrackingControls && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleOpenBOS}
                className={`px-2 py-1 text-xs font-semibold rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                  activeAction === 'bos'
                    ? 'bg-emerald-theme text-white border-emerald-600 shadow-2xs'
                    : 'bg-app-field border-app text-app-main hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-500'
                }`}
                title="Record Break of Structure (BOS)"
              >
                <Plus className="w-3 h-3" />
                <span>BOS</span>
              </button>

              <button
                type="button"
                onClick={handleOpenMSS}
                className={`px-2 py-1 text-xs font-semibold rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                  activeAction === 'mss'
                    ? 'bg-purple-600 text-white border-purple-700 shadow-2xs'
                    : 'bg-app-field border-app text-app-main hover:bg-purple-50 dark:hover:bg-purple-950/30 hover:border-purple-500'
                }`}
                title="Record Market Structure Shift (MSS)"
              >
                <Plus className="w-3 h-3" />
                <span>MSS</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline BOS Configuration Panel */}
      {activeAction === 'bos' && (
        <div className="p-3 rounded-md bg-emerald-50/40 dark:bg-emerald-950/30 border border-emerald-500/50 space-y-2.5 animate-in fade-in duration-100">
          <div className="flex items-center justify-between pb-1.5 border-b border-emerald-500/30">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <span>+ Record Break of Structure (BOS)</span>
              <span className="text-[10px] font-normal text-app-secondary">
                ({bosDirection} continuation)
              </span>
            </span>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="text-app-secondary hover:text-app-main p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {bosValidationError && (
            <div className="p-1.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{bosValidationError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                Broken Level (Price)
              </label>
              <input
                type="text"
                value={bosBrokenLevel}
                onChange={(e) => setBosBrokenLevel(e.target.value)}
                placeholder="Broken price level"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                New High {bosDirection === 'Bullish' && '(Blank / Enter)'}
              </label>
              <input
                type="text"
                value={bosHigh}
                onChange={(e) => setBosHigh(e.target.value)}
                placeholder="High price"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600"
                autoFocus={bosDirection === 'Bullish'}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                New Low {bosDirection === 'Bearish' && '(Blank / Enter)'}
              </label>
              <input
                type="text"
                value={bosLow}
                onChange={(e) => setBosLow(e.target.value)}
                placeholder="Low price"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600"
                autoFocus={bosDirection === 'Bearish'}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmBOS}
              className="px-3 py-1 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-700 rounded transition-colors cursor-pointer shadow-2xs"
            >
              Confirm BOS
            </button>
          </div>
        </div>
      )}

      {/* Inline MSS Configuration Panel */}
      {activeAction === 'mss' && (
        <div className="p-3 rounded-md bg-purple-50/40 dark:bg-purple-950/30 border border-purple-500/50 space-y-2.5 animate-in fade-in duration-100">
          <div className="flex items-center justify-between pb-1.5 border-b border-purple-500/30">
            <span className="text-xs font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
              <span>+ Record Market Structure Shift (MSS)</span>
            </span>
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="text-app-secondary hover:text-app-main p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {mssValidationError && (
            <div className="p-1.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[11px] flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{mssValidationError}</span>
            </div>
          )}

          {/* Direction Shift Reversal Proposal */}
          <div>
            <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-1">
              Proposed Direction Shift (Requires Confirmation)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-app-secondary">Current:</span>
              <span className="font-bold text-xs text-app-main">{direction || 'None'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-purple-500" />
              <div className="inline-flex rounded border border-purple-500/40 overflow-hidden">
                {(['Bullish', 'Bearish'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setMssProposedDir(dir)}
                    className={`px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${
                      mssProposedDir === dir
                        ? dir === 'Bullish'
                          ? 'bg-emerald-theme text-white'
                          : 'bg-rose-600 text-white'
                        : 'bg-app-main text-app-secondary hover:bg-app-field'
                    }`}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                Shift Broken Level
              </label>
              <input
                type="text"
                value={mssBrokenLevel}
                onChange={(e) => setMssBrokenLevel(e.target.value)}
                placeholder="Shift break level"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-purple-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                High Price
              </label>
              <input
                type="text"
                value={mssHigh}
                onChange={(e) => setMssHigh(e.target.value)}
                placeholder="High price"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-purple-600"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase text-app-secondary mb-0.5">
                Low Price
              </label>
              <input
                type="text"
                value={mssLow}
                onChange={(e) => setMssLow(e.target.value)}
                placeholder="Low price"
                className="w-full px-2 py-1 text-xs bg-app-main border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-purple-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setActiveAction(null)}
              className="px-2.5 py-1 text-xs text-app-secondary hover:text-app-main rounded transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmMSS}
              className="px-3 py-1 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded transition-colors cursor-pointer shadow-2xs"
            >
              Confirm MSS Shift to {mssProposedDir}
            </button>
          </div>
        </div>
      )}

      {/* Standard Active High, Low, BOS inputs */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-app-secondary mb-1">
            {label} High
          </label>
          <input
            type="text"
            value={high}
            onChange={(e) =>
              onChange({
                direction,
                high: e.target.value,
                low,
                brokenLevel,
                history,
              })
            }
            placeholder="e.g. 2685.50"
            className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-app-secondary mb-1">
            {label} Low
          </label>
          <input
            type="text"
            value={low}
            onChange={(e) =>
              onChange({
                direction,
                high,
                low: e.target.value,
                brokenLevel,
                history,
              })
            }
            placeholder="e.g. 2652.00"
            className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-app-secondary mb-1">
          {label === 'SWING' ? 'BOS At' : 'iBOS At'}
        </label>
        <input
          type="text"
          value={brokenLevel}
          onChange={(e) =>
            onChange({
              direction,
              high,
              low,
              brokenLevel: e.target.value,
              history,
            })
          }
          placeholder={label === 'SWING' ? 'Break of Structure price' : 'Internal break of structure price'}
          className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main font-mono tabular-nums focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
        />
      </div>

      {/* History Section: Collapsed by default (Controlled by showHistory toggle) */}
      {showHistory && (
        <div className="pt-1.5 border-t border-app/40">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setIsHistoryOpen(!isHistoryOpen)}
              className="inline-flex items-center gap-1.5 text-xs text-app-secondary hover:text-app-main font-medium py-1 cursor-pointer transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-app-secondary" />
              <span>History ({history?.length || 0})</span>
              {isHistoryOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            {history && history.length > 0 && (
              <span className="text-[10px] text-app-secondary">
                Latest: {history[0].type} {history[0].direction}
              </span>
            )}
          </div>

          {/* Expanded History List */}
          {isHistoryOpen && (
            <div className="mt-2 space-y-1.5 animate-in fade-in duration-100">
              {(!history || history.length === 0) ? (
                <div className="p-2 text-center text-xs text-app-secondary bg-app-field/60 border border-dashed border-app/70 rounded">
                  No structure events recorded yet. Use <strong className="text-emerald-theme">+ BOS</strong> or <strong className="text-purple-600 dark:text-purple-400">+ MSS</strong> above.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {history.map((evt, idx) => {
                    const isLatest = idx === 0;
                    const isEditing = editingEventId === evt.id;
                    const isConfirmingDelete = confirmDeleteId === evt.id;

                    return (
                      <div
                        key={evt.id}
                        className={`p-2 rounded border text-xs transition-colors ${
                          isLatest
                            ? 'bg-app-main border-emerald-500/40 shadow-2xs'
                            : 'bg-app-field/60 border-app/60'
                        }`}
                      >
                        {!isEditing ? (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                            {/* Left: Type badge, direction, broken, high, low, timestamp */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Event Badge */}
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  evt.type === 'BOS'
                                    ? evt.direction === 'Bullish'
                                      ? 'bg-emerald-pale text-bullish border border-emerald-500/40'
                                      : 'bg-bearish-pale text-bearish border border-rose-500/40'
                                    : 'bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-500/40'
                                }`}
                              >
                                {evt.type}
                              </span>

                              <span
                                className={`text-[11px] font-semibold ${
                                  evt.direction === 'Bullish'
                                    ? 'text-bullish'
                                    : 'text-bearish'
                                }`}
                              >
                                {evt.direction}
                              </span>

                              {evt.brokenLevel && (
                                <span className="font-mono text-[11px] text-app-main bg-app-field px-1.5 py-0.5 rounded border border-app/50">
                                  Broken: {evt.brokenLevel}
                                </span>
                              )}

                              {(evt.high || evt.low) && (
                                <span className="font-mono text-[11px] text-app-secondary">
                                  H:{evt.high || '—'} L:{evt.low || '—'}
                                </span>
                              )}

                              <span className="text-[10px] text-app-secondary">
                                {formatCompactTime(evt.timestamp)}
                              </span>

                              {isLatest && (
                                <span className="text-[10px] font-semibold text-emerald-theme bg-emerald-pale px-1.5 py-0.2 rounded border border-emerald-500/30">
                                  Active State
                                </span>
                              )}
                            </div>

                            {/* Actions: Edit, Delete */}
                            <div className="flex items-center gap-1 self-end sm:self-center">
                              {!isConfirmingDelete ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditEvent(evt)}
                                    className="p-1 text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
                                    title="Edit event"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(evt.id)}
                                    className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors cursor-pointer"
                                    title="Delete event"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              ) : (
                                <div className="p-1.5 rounded bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-[11px] space-y-1">
                                  {isLatest && (
                                    <p className="text-rose-700 dark:text-rose-300 font-medium">
                                      Deleting the latest event restores previous structure. Continue?
                                    </p>
                                  )}
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmDeleteEvent(evt.id)}
                                      className="px-2 py-0.5 bg-rose-600 text-white rounded font-bold cursor-pointer"
                                    >
                                      Yes, Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="px-1.5 py-0.5 text-app-secondary hover:text-app-main cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Inline Edit Row */
                          <div className="space-y-2 p-1">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10px] text-app-secondary">Broken</label>
                                <input
                                  type="text"
                                  value={editBrokenLevel}
                                  onChange={(e) => setEditBrokenLevel(e.target.value)}
                                  className="w-full px-1.5 py-0.5 text-xs bg-app-field border border-app rounded font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-app-secondary">High</label>
                                <input
                                  type="text"
                                  value={editHigh}
                                  onChange={(e) => setEditHigh(e.target.value)}
                                  className="w-full px-1.5 py-0.5 text-xs bg-app-field border border-app rounded font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-app-secondary">Low</label>
                                <input
                                  type="text"
                                  value={editLow}
                                  onChange={(e) => setEditLow(e.target.value)}
                                  className="w-full px-1.5 py-0.5 text-xs bg-app-field border border-app rounded font-mono"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSaveEditEvent(evt.id)}
                                className="px-2 py-0.5 bg-emerald-theme text-white text-[11px] font-semibold rounded"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingEventId(null)}
                                className="px-2 py-0.5 text-app-secondary text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
