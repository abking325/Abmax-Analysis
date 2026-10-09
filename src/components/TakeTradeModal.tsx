import React, { useState } from 'react';
import { X, CheckCircle2, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react';
import {
  PlannedScenario,
  RecordedTrade,
  SavedReport,
  TimeframeId,
  TradingPair,
  TradingSession,
  TradeOutcome,
} from '../types/journal';

interface TakeTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport;
  onSaveTrade: (trade: RecordedTrade) => Promise<void>;
}

export const TakeTradeModal: React.FC<TakeTradeModalProps> = ({
  isOpen,
  onClose,
  report,
  onSaveTrade,
}) => {
  const scenarios = report.scenarios || [];

  // Form state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    scenarios.length > 0 ? scenarios[0].id : 'manual'
  );
  const [direction, setDirection] = useState<'Buy' | 'Sell'>(() => {
    if (scenarios.length > 0 && scenarios[0].direction) {
      return scenarios[0].direction;
    }
    return 'Buy';
  });
  const [session, setSession] = useState<TradingSession>(report.session || 'London');
  const [timeframeTaken, setTimeframeTaken] = useState<TimeframeId>('5M');
  const [entryPrice, setEntryPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [riskReward, setRiskReward] = useState('');
  const [outcome, setOutcome] = useState<TradeOutcome>('Open');
  const [rulesFollowed, setRulesFollowed] = useState<boolean>(true);
  const [notes, setNotes] = useState('');
  const [tradeDate, setTradeDate] = useState(() => report.date || new Date().toISOString().slice(0, 10));
  const [tradeTime, setTradeTime] = useState(() => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // When scenario changes, auto-fill direction if the scenario has one
  const handleScenarioChange = (scnId: string) => {
    setSelectedScenarioId(scnId);
    if (scnId !== 'manual') {
      const found = scenarios.find((s) => s.id === scnId);
      if (found && found.direction) {
        setDirection(found.direction);
      }
    }
  };

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const newTrade: RecordedTrade = {
        id: `trd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        scenarioId: selectedScenarioId !== 'manual' ? selectedScenarioId : undefined,
        scenarioLabel:
          selectedScenarioId !== 'manual' && selectedScenario
            ? selectedScenario.label || 'Planned Scenario'
            : 'Discretionary / No Scenario',
        pair: report.pair,
        direction,
        session,
        timeframeTaken,
        entryPrice: entryPrice.trim(),
        stopLoss: stopLoss.trim(),
        takeProfit: takeProfit.trim(),
        exitPrice: exitPrice.trim(),
        riskReward: riskReward.trim(),
        outcome,
        rulesFollowed,
        notes: notes.trim(),
        date: tradeDate,
        time: tradeTime,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await onSaveTrade(newTrade);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to record trade.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Take Trade Dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-app bg-app-secondary">
          <div>
            <div className="text-sm font-bold text-app-main flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-theme" />
              <span>Record Executed Trade</span>
              <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                {report.pair}
              </span>
            </div>
            <p className="text-[11px] text-app-secondary mt-0.5">
              Disciplined logging: link this execution to your pre-market planned scenario.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-app-secondary hover:text-app-main rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {error && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs">
              {error}
            </div>
          )}

          {/* First question: Which scenario was executed? */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/40 space-y-2">
            <label className="block text-xs font-bold text-app-main uppercase tracking-wider">
              Which scenario was executed?
            </label>

            {scenarios.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={selectedScenarioId}
                  onChange={(e) => handleScenarioChange(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-app-field border border-app rounded text-app-main font-medium focus:outline-hidden focus:border-emerald-600"
                >
                  {scenarios.map((s, idx) => (
                    <option key={s.id} value={s.id}>
                      {s.label || `Scenario ${idx + 1}`} {s.direction ? `(${s.direction})` : ''} -{' '}
                      {s.strategy || 'No strategy name'}
                    </option>
                  ))}
                  <option value="manual">-- None / Discretionary Trade --</option>
                </select>

                {selectedScenario && (
                  <div className="p-2.5 rounded bg-app-main border border-app text-[11px] space-y-1 text-app-secondary">
                    {selectedScenario.description && (
                      <div>
                        <span className="font-semibold text-app-main">Plan: </span>
                        {selectedScenario.description}
                      </div>
                    )}
                    {selectedScenario.entryConditions && (
                      <div>
                        <span className="font-semibold text-app-main">Entry Rules: </span>
                        {selectedScenario.entryConditions}
                      </div>
                    )}
                    {selectedScenario.invalidationConditions && (
                      <div>
                        <span className="font-semibold text-rose-600 dark:text-rose-400">
                          Invalidation:
                        </span>{' '}
                        {selectedScenario.invalidationConditions}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-app-secondary italic p-2 rounded bg-app-main border border-app">
                No planned scenarios in this report. This trade will be recorded as a discretionary execution.
              </div>
            )}
          </div>

          {/* Direction & Session & Execution Timeframe */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Direction */}
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">Direction</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDirection('Buy')}
                  className={`py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer text-center ${
                    direction === 'Buy'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-app-field text-app-main border-app hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('Sell')}
                  className={`py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer text-center ${
                    direction === 'Sell'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                      : 'bg-app-field text-app-main border-app hover:bg-rose-50 dark:hover:bg-rose-950/30'
                  }`}
                >
                  Sell
                </button>
              </div>
            </div>

            {/* Session */}
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">Session</label>
              <select
                value={session}
                onChange={(e) => setSession(e.target.value as TradingSession)}
                className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              >
                <option value="Asian">Asian</option>
                <option value="London">London</option>
                <option value="NY AM">NY AM</option>
                <option value="NY PM">NY PM</option>
              </select>
            </div>

            {/* Timeframe Taken */}
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">
                Trigger Timeframe
              </label>
              <select
                value={timeframeTaken}
                onChange={(e) => setTimeframeTaken(e.target.value as TimeframeId)}
                className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              >
                <option value="1M">1M</option>
                <option value="5M">5M</option>
                <option value="15M">15M</option>
                <option value="1H">1H</option>
                <option value="4H">4H</option>
                <option value="Daily">Daily</option>
              </select>
            </div>
          </div>

          {/* Pricing Parameters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-app-secondary mb-1">
                Entry Price
              </label>
              <input
                type="text"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="e.g. 2680.50"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-app-secondary mb-1">
                Stop Loss
              </label>
              <input
                type="text"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="e.g. 2676.00"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-rose-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-app-secondary mb-1">
                Take Profit
              </label>
              <input
                type="text"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="e.g. 2694.00"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-app-secondary mb-1">
                Risk : Reward
              </label>
              <input
                type="text"
                value={riskReward}
                onChange={(e) => setRiskReward(e.target.value)}
                placeholder="e.g. 1:3.0"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Outcome & Exit price */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">Trade Status / Outcome</label>
              <div className="grid grid-cols-4 gap-1">
                {(['Open', 'Win', 'Loss', 'Break-even'] as TradeOutcome[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setOutcome(st)}
                    className={`py-1 text-xs font-semibold rounded border transition-colors ${
                      outcome === st
                        ? st === 'Win'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : st === 'Loss'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : st === 'Break-even'
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-blue-600 text-white border-blue-600'
                        : 'bg-app-field text-app-main border-app hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">
                Exit Price (Optional)
              </label>
              <input
                type="text"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="e.g. 2692.20"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Rules followed checkbox */}
          <div className="p-3 rounded border border-app bg-app-field flex items-center justify-between">
            <div>
              <div className="font-semibold text-app-main text-xs">Plan Discipline Checklist</div>
              <div className="text-[11px] text-app-secondary">
                Did this trade strictly adhere to the planned scenario rules?
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer font-medium text-xs text-app-main">
              <input
                type="checkbox"
                checked={rulesFollowed}
                onChange={(e) => setRulesFollowed(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
              />
              <span>{rulesFollowed ? 'Rules Followed' : 'Rules Broken'}</span>
            </label>
          </div>

          {/* Trade Notes */}
          <div>
            <label className="block text-xs font-medium text-app-secondary mb-1">
              Execution / Psychology Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mental state, fill quality, slippage, management during news..."
              className="w-full px-3 py-2 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
            />
          </div>

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
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Recording Trade...' : 'Record Trade'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
