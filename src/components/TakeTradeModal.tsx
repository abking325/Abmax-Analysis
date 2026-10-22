import React, { useState, useEffect } from 'react';
import { X, TrendingUp, AlertCircle, Edit3, Image as ImageIcon } from 'lucide-react';
import {
  ImageAttachment,
  PlannedScenario,
  RecordedTrade,
  SavedReport,
  TimeframeId,
  TradingSession,
  TradeOutcome,
} from '../types/journal';
import { ImageAttachmentManager } from './ImageAttachmentManager';
import { ImageViewerModal } from './ImageViewerModal';

interface TakeTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport;
  tradeToEdit?: RecordedTrade | null;
  onSaveTrade: (trade: RecordedTrade) => Promise<void>;
  initialTradeDraft?: {
    selectedScenarioId: string;
    direction: 'Buy' | 'Sell';
    session: TradingSession;
    timeframeTaken: TimeframeId;
    entryPrice: string;
    stopLoss: string;
    takeProfit: string;
    exitPrice: string;
    riskReward: string;
    outcome: TradeOutcome;
    rulesFollowed: boolean;
    notes: string;
    tradeDate: string;
    tradeTime: string;
  } | null;
  onTradeDraftChange?: (draft: any) => void;
}

export const TakeTradeModal: React.FC<TakeTradeModalProps> = ({
  isOpen,
  onClose,
  report,
  tradeToEdit = null,
  onSaveTrade,
  initialTradeDraft,
  onTradeDraftChange,
}) => {
  const isEditing = Boolean(tradeToEdit);
  const scenarios = report.scenarios || [];

  // Form state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(
    initialTradeDraft?.selectedScenarioId || 'manual'
  );
  const [direction, setDirection] = useState<'Buy' | 'Sell'>(
    initialTradeDraft?.direction || 'Buy'
  );
  const [session, setSession] = useState<TradingSession>(
    initialTradeDraft?.session || report.session || 'London'
  );
  const [timeframeTaken, setTimeframeTaken] = useState<TimeframeId>(
    initialTradeDraft?.timeframeTaken || '5M'
  );
  const [entryPrice, setEntryPrice] = useState(initialTradeDraft?.entryPrice || '');
  const [stopLoss, setStopLoss] = useState(initialTradeDraft?.stopLoss || '');
  const [takeProfit, setTakeProfit] = useState(initialTradeDraft?.takeProfit || '');
  const [exitPrice, setExitPrice] = useState(initialTradeDraft?.exitPrice || '');
  const [riskReward, setRiskReward] = useState(initialTradeDraft?.riskReward || '');
  const [outcome, setOutcome] = useState<TradeOutcome>(initialTradeDraft?.outcome || 'Open');
  const [rulesFollowed, setRulesFollowed] = useState<boolean>(
    initialTradeDraft?.rulesFollowed !== undefined ? initialTradeDraft.rulesFollowed : true
  );
  const [notes, setNotes] = useState(initialTradeDraft?.notes || '');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [activeViewerImage, setActiveViewerImage] = useState<{ url: string; title: string } | null>(
    null
  );
  const [tradeDate, setTradeDate] = useState(() => initialTradeDraft?.tradeDate || report.date || new Date().toISOString().slice(0, 10));
  const [tradeTime, setTradeTime] = useState(() => {
    return initialTradeDraft?.tradeTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  useEffect(() => {
    if (isOpen) {
      onTradeDraftChange?.({
        isOpen: true,
        reportId: report.id,
        tradeToEditId: tradeToEdit?.id || null,
        selectedScenarioId,
        direction,
        session,
        timeframeTaken,
        entryPrice,
        stopLoss,
        takeProfit,
        exitPrice,
        riskReward,
        outcome,
        rulesFollowed,
        notes,
        tradeDate,
        tradeTime,
      });
    }
  }, [
    isOpen,
    report.id,
    tradeToEdit?.id,
    selectedScenarioId,
    direction,
    session,
    timeframeTaken,
    entryPrice,
    stopLoss,
    takeProfit,
    exitPrice,
    riskReward,
    outcome,
    rulesFollowed,
    notes,
    tradeDate,
    tradeTime,
    onTradeDraftChange,
  ]);

  // Prepopulate form when modal opens or tradeToEdit changes
  useEffect(() => {
    if (!isOpen || initialTradeDraft) return;

    if (tradeToEdit) {
      // Editing existing trade
      setSelectedScenarioId(tradeToEdit.scenarioId || 'manual');
      setDirection((tradeToEdit.direction as 'Buy' | 'Sell') || 'Buy');
      setSession(tradeToEdit.session || report.session || 'London');
      setTimeframeTaken((tradeToEdit.timeframeTaken as TimeframeId) || '5M');
      setEntryPrice(tradeToEdit.entryPrice || '');
      setStopLoss(tradeToEdit.stopLoss || '');
      setTakeProfit(tradeToEdit.takeProfit || '');
      setExitPrice(tradeToEdit.exitPrice || '');
      setRiskReward(tradeToEdit.riskReward || '');
      setOutcome(tradeToEdit.outcome || 'Open');
      setRulesFollowed(tradeToEdit.rulesFollowed !== false);
      setNotes(tradeToEdit.notes || '');
      setImages(tradeToEdit.images ? JSON.parse(JSON.stringify(tradeToEdit.images)) : []);
      setTradeDate(tradeToEdit.date || report.date || new Date().toISOString().slice(0, 10));
      setTradeTime(tradeToEdit.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    } else {
      // New trade mode
      const defaultScnId = scenarios.length > 0 ? scenarios[0].id : 'manual';
      setSelectedScenarioId(defaultScnId);
      if (scenarios.length > 0 && scenarios[0].direction) {
        setDirection(scenarios[0].direction as 'Buy' | 'Sell');
      } else {
        setDirection('Buy');
      }
      setSession(report.session || 'London');
      setTimeframeTaken('5M');
      setEntryPrice('');
      setStopLoss('');
      setTakeProfit('');
      setExitPrice('');
      setRiskReward('');
      setOutcome('Open');
      setRulesFollowed(true);
      setNotes('');
      setImages([]);
      setTradeDate(report.date || new Date().toISOString().slice(0, 10));
      setTradeTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    }
    setError(null);
    setShowUnsavedWarning(false);
  }, [isOpen, tradeToEdit, report]);

  if (!isOpen) return null;

  // Detect dirty state for dismissal warning
  const isDirty = () => {
    if (isEditing && tradeToEdit) {
      const origImagesJson = JSON.stringify(tradeToEdit.images || []);
      const curImagesJson = JSON.stringify(images);
      return (
        direction !== tradeToEdit.direction ||
        session !== (tradeToEdit.session || report.session) ||
        timeframeTaken !== (tradeToEdit.timeframeTaken || '5M') ||
        entryPrice !== (tradeToEdit.entryPrice || '') ||
        stopLoss !== (tradeToEdit.stopLoss || '') ||
        takeProfit !== (tradeToEdit.takeProfit || '') ||
        exitPrice !== (tradeToEdit.exitPrice || '') ||
        riskReward !== (tradeToEdit.riskReward || '') ||
        outcome !== (tradeToEdit.outcome || 'Open') ||
        rulesFollowed !== (tradeToEdit.rulesFollowed !== false) ||
        notes !== (tradeToEdit.notes || '') ||
        tradeDate !== (tradeToEdit.date || '') ||
        tradeTime !== (tradeToEdit.time || '') ||
        curImagesJson !== origImagesJson
      );
    }
    return Boolean(entryPrice || stopLoss || takeProfit || exitPrice || notes || images.length > 0);
  };

  const handleAttemptClose = () => {
    if (isDirty() && !showUnsavedWarning) {
      setShowUnsavedWarning(true);
      return;
    }
    setShowUnsavedWarning(false);
    onClose();
  };

  // When scenario changes in New Trade mode, auto-fill direction if the scenario has one
  const handleScenarioChange = (scnId: string) => {
    if (isEditing) return; // Keep scenario selection read-only in Edit mode
    setSelectedScenarioId(scnId);
    if (scnId !== 'manual') {
      const found = scenarios.find((s) => s.id === scnId);
      if (found && found.direction) {
        setDirection(found.direction as 'Buy' | 'Sell');
      }
    }
  };

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return; // Prevent repeated submission
    setIsSaving(true);
    setError(null);

    try {
      if (isEditing && tradeToEdit) {
        // Save Changes: Update existing trade with original ID and preserved timestamps/snapshots
        const updatedTrade: RecordedTrade = {
          ...tradeToEdit,
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
          images,
          date: tradeDate,
          time: tradeTime,
          updatedAt: Date.now(),
        };

        await onSaveTrade(updatedTrade);
        onClose();
      } else {
        // New Trade: Capture scenario snapshot and fresh ID
        const capturedSnapshot =
          selectedScenarioId !== 'manual' && selectedScenario
            ? {
                strategy: selectedScenario.strategy,
                direction: selectedScenario.direction,
                description: selectedScenario.description,
                entryConditions: selectedScenario.entryConditions,
                invalidationConditions: selectedScenario.invalidationConditions,
                images: selectedScenario.images ? [...selectedScenario.images] : undefined,
              }
            : undefined;

        const newTrade: RecordedTrade = {
          id: `trd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          scenarioId: selectedScenarioId !== 'manual' ? selectedScenarioId : undefined,
          scenarioLabel:
            selectedScenarioId !== 'manual' && selectedScenario
              ? selectedScenario.label || 'Planned Scenario'
              : 'Discretionary / No Scenario',
          scenarioSnapshot: capturedSnapshot,
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
          images,
          date: tradeDate,
          time: tradeTime,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await onSaveTrade(newTrade);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save trade.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Edit Trade' : 'Record Trade'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={handleAttemptClose}
    >
      <div
        className="w-full max-w-xl bg-app-main border border-app rounded-lg shadow-xl overflow-hidden max-h-[92vh] flex flex-col text-app-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-app bg-app-secondary shrink-0">
          <div>
            <div className="text-sm font-bold text-app-main flex items-center gap-2">
              {isEditing ? (
                <>
                  <Edit3 className="w-4 h-4 text-emerald-theme" />
                  <span>Edit Trade</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 text-emerald-theme" />
                  <span>Record Executed Trade</span>
                </>
              )}
              <span className="text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                {report.pair}
              </span>
            </div>
            <p className="text-[11px] text-app-secondary mt-0.5">
              {isEditing
                ? `Updating trade record (ID: ${tradeToEdit?.id}). Scenario snapshot remains linked.`
                : 'Disciplined logging: link this execution to your pre-market planned scenario.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleAttemptClose}
            className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Unsaved changes warning alert if user tries to close with unsaved edits */}
        {showUnsavedWarning && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>You have unsaved changes. Discard edits and close?</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-[11px] cursor-pointer"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setShowUnsavedWarning(false)}
                className="px-2 py-1 text-app-secondary hover:text-app-main text-[11px] cursor-pointer"
              >
                Keep Editing
              </button>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {error && (
            <div className="p-2.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Scenario Selection Section */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/40 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-app-main uppercase tracking-wider">
                {isEditing ? 'Linked Planned Scenario (Read-Only)' : 'Which scenario was executed?'}
              </label>
              {isEditing && (
                <span className="text-[10px] text-app-secondary font-medium uppercase tracking-wider">
                  Locked to captured snapshot
                </span>
              )}
            </div>

            {isEditing ? (
              // In Edit mode: Scenario is read-only, showing the captured scenario snapshot
              <div className="p-2.5 rounded bg-app-main border border-app text-[11px] space-y-1.5 text-app-secondary">
                <div className="font-bold text-app-main text-xs flex items-center gap-2">
                  <span>{tradeToEdit?.scenarioLabel || 'Planned Execution'}</span>
                  {tradeToEdit?.scenarioSnapshot?.strategy && (
                    <span className="font-normal text-app-secondary">
                      — {tradeToEdit.scenarioSnapshot.strategy}
                    </span>
                  )}
                </div>
                {tradeToEdit?.scenarioSnapshot?.description && (
                  <div>
                    <span className="font-semibold text-app-main">Plan: </span>
                    {tradeToEdit.scenarioSnapshot.description}
                  </div>
                )}
                {tradeToEdit?.scenarioSnapshot?.entryConditions && (
                  <div>
                    <span className="font-semibold text-app-main">Entry Rules: </span>
                    {tradeToEdit.scenarioSnapshot.entryConditions}
                  </div>
                )}
                {tradeToEdit?.scenarioSnapshot?.invalidationConditions && (
                  <div>
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      Invalidation:
                    </span>{' '}
                    {tradeToEdit.scenarioSnapshot.invalidationConditions}
                  </div>
                )}
                {tradeToEdit?.scenarioSnapshot?.images &&
                  tradeToEdit.scenarioSnapshot.images.length > 0 && (
                    <div className="pt-1.5 border-t border-app/60">
                      <span className="font-semibold text-app-main block mb-1">
                        Captured Setup Charts ({tradeToEdit.scenarioSnapshot.images.length}):
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {tradeToEdit.scenarioSnapshot.images.map((img, i) => (
                          <button
                            key={img.id || i}
                            type="button"
                            onClick={() =>
                              setActiveViewerImage({
                                url: img.dataUrl,
                                title: img.caption || img.name || 'Setup Chart',
                              })
                            }
                            className="w-16 h-11 rounded border border-app overflow-hidden hover:opacity-80 transition-opacity bg-black/10 relative group cursor-pointer"
                            title="View Setup Chart"
                          >
                            <img
                              src={img.dataUrl}
                              alt={img.caption || 'Setup'}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                {!tradeToEdit?.scenarioSnapshot && selectedScenario && (
                  <div>
                    <span className="font-semibold text-app-main">Strategy: </span>
                    {selectedScenario.strategy || selectedScenario.description || 'No strategy detail'}
                  </div>
                )}
              </div>
            ) : scenarios.length > 0 ? (
              // In New Trade mode: Select which scenario was executed
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

          {/* Execution Timing & Direction */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">
                Execution Date
              </label>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-app-secondary mb-1">
                Execution Time
              </label>
              <input
                type="text"
                value={tradeTime}
                onChange={(e) => setTradeTime(e.target.value)}
                placeholder="HH:MM:SS"
                className="w-full px-3 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>
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
                    className={`py-1 text-xs font-semibold rounded border transition-colors cursor-pointer ${
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

          {/* Rules followed checklist */}
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
                className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
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

          {/* Trade Images & Screenshots */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/30">
            <ImageAttachmentManager
              attachments={images}
              onChange={setImages}
              onViewImage={(url, title) => setActiveViewerImage({ url, title })}
              label="Trade Charts & Screenshots (Entry, Exit, Execution)"
            />
          </div>

          {/* Actions Bar */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
            <button
              type="button"
              onClick={handleAttemptClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs disabled:opacity-50 cursor-pointer transition-colors"
            >
              {isSaving
                ? isEditing
                  ? 'Saving Changes...'
                  : 'Recording Trade...'
                : isEditing
                ? 'Save Changes'
                : 'Record Trade'}
            </button>
          </div>
        </form>
      </div>

      {/* Image Viewer Zoom Modal */}
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
