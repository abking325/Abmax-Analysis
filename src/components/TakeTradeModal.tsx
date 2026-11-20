import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  TrendingUp,
  AlertCircle,
  Edit3,
  ChevronDown,
  ChevronUp,
  Calculator,
  BookOpen,
} from 'lucide-react';
import {
  EmotionalReadiness,
  ImageAttachment,
  JournalEntry,
  PlannedRRChoice,
  PlannedScenario,
  RecordedTrade,
  SavedReport,
  SetupValidity,
  StrategySnapshot,
  TimeframeId,
  TradingSession,
  TradeOutcome,
} from '../types/journal';
import { ImageAttachmentManager } from './ImageAttachmentManager';
import { ImageViewerModal } from './ImageViewerModal';
import { StrategySelector } from './StrategySelector';
import { registerBackHandler } from '../utils/backNavigation';
import {
  calculateTakeProfitForPlannedRR,
  checkPlannedRRMismatch,
  computeLiveRRFromPrices,
  deepClone,
  getPlannedRRTargetMultiplier,
  sanitizeDecimalInput,
} from '../utils/analysisUtils';
import { normalizeAccountScope, saveJournalEntry } from '../services/db';

interface TakeTradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SavedReport;
  tradeToEdit?: RecordedTrade | null;
  onSaveTrade: (trade: RecordedTrade) => Promise<void>;
  onSavePreparationJournal?: (entry: JournalEntry) => Promise<void>;
  userId?: string | null;
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
    plannedRRChoice?: PlannedRRChoice | '';
    plannedRRRatio?: string;
    setupValidity?: SetupValidity;
    outcome: TradeOutcome;
    rulesFollowed: boolean;
    notes: string;
    tradeDate: string;
    tradeTime: string;
    closedDate?: string;
    closedTime?: string;
    strategy?: string;
    strategyId?: string;
    strategySnapshot?: StrategySnapshot;
    sourceReportId?: string;
    sourceReportTitle?: string;
  } | null;
  onTradeDraftChange?: (draft: any) => void;
}

const PLANNED_RR_PRESETS: PlannedRRChoice[] = ['1:1', '1:1.5', '1:2', '1:3', 'Custom'];
const SETUP_VALIDITY_OPTIONS: Array<{ value: SetupValidity; label: string }> = [
  { value: 'Valid', label: 'Valid' },
  { value: 'Invalid', label: 'Invalid' },
  { value: 'Not reviewed', label: 'Not reviewed' },
];
const PREP_READINESS_OPTIONS: EmotionalReadiness[] = [
  'Optimal / Calm',
  'Focused',
  'Anxious',
  'Fatigued',
  'Overconfident',
  'Distracted',
];

export const TakeTradeModal: React.FC<TakeTradeModalProps> = ({
  isOpen,
  onClose,
  report,
  tradeToEdit = null,
  onSaveTrade,
  onSavePreparationJournal,
  userId,
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
  const [plannedRRChoice, setPlannedRRChoice] = useState<PlannedRRChoice | ''>(
    initialTradeDraft?.plannedRRChoice || ''
  );
  const [plannedRRRatio, setPlannedRRRatio] = useState(initialTradeDraft?.plannedRRRatio || '');
  const [setupValidity, setSetupValidity] = useState<SetupValidity>(
    initialTradeDraft?.setupValidity || 'Not reviewed'
  );
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
  const [closedDate, setClosedDate] = useState(initialTradeDraft?.closedDate || '');
  const [closedTime, setClosedTime] = useState(initialTradeDraft?.closedTime || '');
  const [strategy, setStrategy] = useState<string>(initialTradeDraft?.strategy || '');
  const [strategyId, setStrategyId] = useState<string | undefined>(initialTradeDraft?.strategyId);
  const [strategySnapshot, setStrategySnapshot] = useState<StrategySnapshot | undefined>(() =>
    initialTradeDraft?.strategySnapshot ? deepClone(initialTradeDraft.strategySnapshot) : undefined
  );
  const hasManualStrategyRef = useRef(false);

  // Collapsible Preparation & Mindset state (optional)
  const [isPrepOpen, setIsPrepOpen] = useState(false);
  const [prepIntention, setPrepIntention] = useState('');
  const [prepReadiness, setPrepReadiness] = useState<EmotionalReadiness>('');
  const [prepNotes, setPrepNotes] = useState('');
  const [alsoSavePrepToJournal, setAlsoSavePrepToJournal] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  const onTradeDraftChangeRef = useRef(onTradeDraftChange);
  useEffect(() => {
    onTradeDraftChangeRef.current = onTradeDraftChange;
  }, [onTradeDraftChange]);

  useEffect(() => {
    if (isOpen) {
      onTradeDraftChangeRef.current?.({
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
        plannedRRChoice,
        plannedRRRatio,
        setupValidity,
        outcome,
        rulesFollowed,
        notes,
        tradeDate,
        tradeTime,
        closedDate,
        closedTime,
        strategy,
        strategyId,
        strategySnapshot,
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
    plannedRRChoice,
    plannedRRRatio,
    setupValidity,
    outcome,
    rulesFollowed,
    notes,
    tradeDate,
    tradeTime,
    closedDate,
    closedTime,
    strategy,
    strategyId,
    strategySnapshot,
  ]);

  // Prepopulate form when modal opens or tradeToEdit changes
  useEffect(() => {
    if (!isOpen) return;
    hasManualStrategyRef.current = false;
    setIsPrepOpen(false);
    setPrepIntention('');
    setPrepReadiness('');
    setPrepNotes('');
    setAlsoSavePrepToJournal(false);

    if (tradeToEdit) {
      // Editing existing trade: load tradeToEdit directly
      setSelectedScenarioId(tradeToEdit.scenarioId || 'manual');
      setDirection((tradeToEdit.direction as 'Buy' | 'Sell') || 'Buy');
      setSession(tradeToEdit.session || report.session || 'London');
      setTimeframeTaken((tradeToEdit.timeframeTaken as TimeframeId) || '5M');
      setEntryPrice(tradeToEdit.entryPrice || '');
      setStopLoss(tradeToEdit.stopLoss || '');
      setTakeProfit(tradeToEdit.takeProfit || '');
      setExitPrice(tradeToEdit.exitPrice || '');
      setRiskReward(tradeToEdit.riskReward || '');
      setPlannedRRChoice(tradeToEdit.plannedRRChoice || '');
      setPlannedRRRatio(tradeToEdit.plannedRRRatio || '');
      setSetupValidity(tradeToEdit.setupValidity || 'Not reviewed');
      setOutcome(tradeToEdit.outcome || 'Open');
      setRulesFollowed(tradeToEdit.rulesFollowed !== false);
      setNotes(tradeToEdit.notes || '');
      setImages(tradeToEdit.images ? JSON.parse(JSON.stringify(tradeToEdit.images)) : []);
      setTradeDate(tradeToEdit.date || report.date || new Date().toISOString().slice(0, 10));
      setTradeTime(tradeToEdit.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      setClosedDate(tradeToEdit.closedDate || '');
      setClosedTime(tradeToEdit.closedTime || '');
      setStrategy(tradeToEdit.strategy || tradeToEdit.strategySnapshot?.name || '');
      setStrategyId(tradeToEdit.strategyId);
      setStrategySnapshot(
        tradeToEdit.strategySnapshot ? deepClone(tradeToEdit.strategySnapshot) : undefined
      );
    } else if (initialTradeDraft) {
      // New trade mode with active in-memory draft
      return;
    } else {
      // New trade mode without initial draft
      const defaultScnId = scenarios.length > 0 ? scenarios[0].id : 'manual';
      setSelectedScenarioId(defaultScnId);
      if (scenarios.length > 0 && scenarios[0].direction) {
        setDirection(scenarios[0].direction as 'Buy' | 'Sell');
      } else {
        setDirection('Buy');
      }
      if (scenarios.length > 0) {
        setStrategy(scenarios[0].strategy || scenarios[0].strategySnapshot?.name || '');
        setStrategyId(scenarios[0].strategyId);
        setStrategySnapshot(
          scenarios[0].strategySnapshot ? deepClone(scenarios[0].strategySnapshot) : undefined
        );
      } else {
        setStrategy('');
        setStrategyId(undefined);
        setStrategySnapshot(undefined);
      }
      setSession(report.session || 'London');
      setTimeframeTaken('5M');
      setEntryPrice('');
      setStopLoss('');
      setTakeProfit('');
      setExitPrice('');
      setRiskReward('');
      setPlannedRRChoice('');
      setPlannedRRRatio('');
      setSetupValidity('Not reviewed');
      setOutcome('Open');
      setRulesFollowed(true);
      setNotes('');
      setImages([]);
      setTradeDate(report.date || new Date().toISOString().slice(0, 10));
      setTradeTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      setClosedDate('');
      setClosedTime('');
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
        plannedRRChoice !== (tradeToEdit.plannedRRChoice || '') ||
        plannedRRRatio !== (tradeToEdit.plannedRRRatio || '') ||
        setupValidity !== (tradeToEdit.setupValidity || 'Not reviewed') ||
        outcome !== (tradeToEdit.outcome || 'Open') ||
        rulesFollowed !== (tradeToEdit.rulesFollowed !== false) ||
        notes !== (tradeToEdit.notes || '') ||
        tradeDate !== (tradeToEdit.date || '') ||
        tradeTime !== (tradeToEdit.time || '') ||
        closedDate !== (tradeToEdit.closedDate || '') ||
        closedTime !== (tradeToEdit.closedTime || '') ||
        strategy !== (tradeToEdit.strategy || tradeToEdit.strategySnapshot?.name || '') ||
        strategyId !== tradeToEdit.strategyId ||
        curImagesJson !== origImagesJson
      );
    }
    return Boolean(
      entryPrice ||
        stopLoss ||
        takeProfit ||
        exitPrice ||
        notes ||
        plannedRRChoice ||
        plannedRRRatio ||
        prepIntention ||
        prepNotes ||
        images.length > 0 ||
        hasManualStrategyRef.current
    );
  };

  const handleAttemptClose = () => {
    if (isDirty() && !showUnsavedWarning) {
      setShowUnsavedWarning(true);
      return;
    }
    setShowUnsavedWarning(false);
    onTradeDraftChangeRef.current?.(null);
    onClose();
  };

  const handleAttemptCloseRef = useRef<() => void>(() => {});
  handleAttemptCloseRef.current = () => {
    if (activeViewerImage) {
      setActiveViewerImage(null);
      return;
    }
    handleAttemptClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleAttemptCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unregBack = registerBackHandler(() => handleAttemptCloseRef.current());
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unregBack();
    };
  }, [isOpen]);

  // When scenario changes in New Trade mode, auto-fill direction & strategy (unless user manually picked one)
  const handleScenarioChange = (scnId: string) => {
    if (isEditing) return; // Keep scenario selection read-only in Edit mode
    setSelectedScenarioId(scnId);
    if (scnId !== 'manual') {
      const found = scenarios.find((s) => s.id === scnId);
      if (found) {
        if (found.direction) {
          setDirection(found.direction as 'Buy' | 'Sell');
        }
        if (!hasManualStrategyRef.current) {
          setStrategy(found.strategy || found.strategySnapshot?.name || '');
          setStrategyId(found.strategyId);
          setStrategySnapshot(found.strategySnapshot);
        }
      }
    } else if (!hasManualStrategyRef.current) {
      setStrategy('');
      setStrategyId(undefined);
      setStrategySnapshot(undefined);
    }
  };

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);
  const liveRR = computeLiveRRFromPrices({
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
  });
  const targetMultiplier = getPlannedRRTargetMultiplier(plannedRRChoice, plannedRRRatio);
  const calculatedTP =
    targetMultiplier !== null
      ? calculateTakeProfitForPlannedRR({
          direction,
          entryPrice,
          stopLoss,
          targetMultiplier,
        })
      : null;
  const rrMismatch = checkPlannedRRMismatch({
    plannedRRChoice: plannedRRChoice || undefined,
    plannedRRRatio,
    computedRatio: liveRR.ratio,
  });

  const handleOutcomeSelect = (nextOutcome: TradeOutcome) => {
    setOutcome(nextOutcome);
    if (nextOutcome && nextOutcome !== 'Open') {
      if (!closedDate) {
        setClosedDate(new Date().toISOString().slice(0, 10));
      }
      if (!closedTime) {
        setClosedTime(
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        );
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRef.current || isSaving) return; // Prevent synchronous & async repeated submission
    isSavingRef.current = true;
    setIsSaving(true);
    setError(null);

    try {
      const isClosedOutcome = Boolean(outcome && outcome !== 'Open');
      const nowMs = Date.now();
      const resolvedClosedDate = isClosedOutcome ? closedDate || new Date().toISOString().slice(0, 10) : undefined;
      const resolvedClosedTime = isClosedOutcome
        ? closedTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : undefined;
      const resolvedClosedAt = isClosedOutcome
        ? tradeToEdit?.closedAt || nowMs
        : undefined;

      if (isEditing && tradeToEdit) {
        // Save Changes: Update existing trade with original ID and preserved timestamps/snapshots
        const updatedTrade: RecordedTrade = {
          ...tradeToEdit,
          strategy: strategy.trim() || undefined,
          strategyId,
          strategySnapshot,
          direction,
          session,
          timeframeTaken,
          entryPrice: entryPrice.trim(),
          stopLoss: stopLoss.trim(),
          takeProfit: takeProfit.trim(),
          exitPrice: exitPrice.trim(),
          riskReward: riskReward.trim(),
          plannedRRChoice: plannedRRChoice || undefined,
          plannedRRRatio: plannedRRChoice === 'Custom' ? plannedRRRatio.trim() || undefined : undefined,
          setupValidity,
          outcome,
          rulesFollowed,
          notes: notes.trim(),
          images,
          date: tradeDate,
          time: tradeTime,
          closedAt: resolvedClosedAt,
          closedDate: resolvedClosedDate,
          closedTime: resolvedClosedTime,
          updatedAt: nowMs,
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
          id: `trd_${nowMs}_${Math.random().toString(36).substring(2, 9)}`,
          scenarioId: selectedScenarioId !== 'manual' ? selectedScenarioId : undefined,
          scenarioLabel:
            selectedScenarioId !== 'manual' && selectedScenario
              ? selectedScenario.label || 'Planned Scenario'
              : 'Discretionary / No Scenario',
          scenarioSnapshot: capturedSnapshot,
          strategy: strategy.trim() || undefined,
          strategyId,
          strategySnapshot,
          pair: report.pair,
          direction,
          session,
          timeframeTaken,
          entryPrice: entryPrice.trim(),
          stopLoss: stopLoss.trim(),
          takeProfit: takeProfit.trim(),
          exitPrice: exitPrice.trim(),
          riskReward: riskReward.trim(),
          plannedRRChoice: plannedRRChoice || undefined,
          plannedRRRatio: plannedRRChoice === 'Custom' ? plannedRRRatio.trim() || undefined : undefined,
          setupValidity,
          outcome,
          rulesFollowed,
          notes: notes.trim(),
          images,
          date: tradeDate,
          time: tradeTime,
          closedAt: resolvedClosedAt,
          closedDate: resolvedClosedDate,
          closedTime: resolvedClosedTime,
          sourceReportId: initialTradeDraft?.sourceReportId || report.id,
          sourceReportTitle: initialTradeDraft?.sourceReportTitle || report.title,
          createdAt: nowMs,
          updatedAt: nowMs,
        };

        await onSaveTrade(newTrade);

        // Only persist optional linked preparation note when checkbox is checked AND trade submission succeeded
        if (
          alsoSavePrepToJournal &&
          (prepIntention.trim() || prepNotes.trim() || prepReadiness)
        ) {
          const scopeOwner = normalizeAccountScope(userId);
          const prepEntry: JournalEntry = {
            id: `jrn_prep_${nowMs}_${Math.random().toString(36).substring(2, 7)}`,
            userId: scopeOwner,
            title: `Pre-Trade Prep — ${report.pair} (${newTrade.direction || 'Trade'})`,
            entryType: 'prep',
            date: tradeDate,
            time: tradeTime,
            timezone: report.timezone,
            pair: report.pair,
            session,
            linkedReportId: initialTradeDraft?.sourceReportId || report.id,
            linkedReportTitle: initialTradeDraft?.sourceReportTitle || report.title || `${report.pair} Analysis`,
            linkedScenarioId: newTrade.scenarioId,
            linkedScenarioLabel: newTrade.scenarioLabel,
            linkedTradeId: newTrade.id,
            ...(strategy.trim() ? { preTrade: { setupTag: strategy.trim() } } : {}),
            prep: {
              sessionIntention: prepIntention.trim() || undefined,
              readinessState: prepReadiness || '',
              readinessStates: prepReadiness ? [prepReadiness] : [],
              dailyPlanNotes: prepNotes.trim() || undefined,
            },
            tags: ['Pre-Trade Prep'],
            createdAt: nowMs,
            updatedAt: nowMs,
          };
          if (onSavePreparationJournal) {
            await onSavePreparationJournal(prepEntry);
          } else {
            await saveJournalEntry(prepEntry);
          }
        }

        onClose();
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save trade.');
    } finally {
      isSavingRef.current = false;
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
                onClick={() => {
                  setShowUnsavedWarning(false);
                  onTradeDraftChangeRef.current?.(null);
                  onClose();
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold text-[11px] cursor-pointer"
              >
                Discard changes
              </button>
              <button
                type="button"
                onClick={() => setShowUnsavedWarning(false)}
                className="px-2 py-1 text-app-secondary hover:text-app-main text-[11px] cursor-pointer"
              >
                Keep editing
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

          {/* Optional Collapsible Preparation & Mindset Section */}
          {!isEditing && (
            <div className="rounded border border-app bg-app-secondary/30 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsPrepOpen((prev) => !prev)}
                className="w-full px-3.5 py-2.5 min-h-[44px] flex items-center justify-between text-left hover:bg-app-field/50 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 text-xs font-bold text-app-main uppercase tracking-wider">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-theme" />
                  <span>Preparation &amp; Mindset (Optional)</span>
                </span>
                {isPrepOpen ? (
                  <ChevronUp className="w-4 h-4 text-app-secondary" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-app-secondary" />
                )}
              </button>

              {isPrepOpen && (
                <div className="p-3.5 pt-2 border-t border-app/60 space-y-3 bg-app-main/40">
                  <div>
                    <label className="block text-[11px] font-medium text-app-secondary mb-1">
                      Readiness / Mental State
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {PREP_READINESS_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setPrepReadiness((prev) => (prev === opt ? '' : opt))}
                          className={`px-2.5 py-1 min-h-[34px] text-[11px] font-medium rounded border cursor-pointer transition-colors ${
                            prepReadiness === opt
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-app-field text-app-main border-app hover:bg-app-secondary'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-app-secondary mb-1">
                      Pre-Trade Intention
                    </label>
                    <input
                      type="text"
                      value={prepIntention}
                      onChange={(e) => setPrepIntention(e.target.value)}
                      spellCheck
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      placeholder="Wait for candle close confirmation at key POI..."
                      className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-app-secondary mb-1">
                      Preparation Note
                    </label>
                    <textarea
                      rows={2}
                      value={prepNotes}
                      onChange={(e) => setPrepNotes(e.target.value)}
                      spellCheck
                      autoCorrect="on"
                      autoCapitalize="sentences"
                      placeholder="Any mindset cue or pre-entry discipline reminder..."
                      className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600 resize-y"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-[11px] font-medium text-app-main cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={alsoSavePrepToJournal}
                      onChange={(e) => setAlsoSavePrepToJournal(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-app cursor-pointer"
                    />
                    <span>Also save preparation note to Trading Journal</span>
                  </label>
                </div>
              )}
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

          {/* Strategy Used Selector (linked Strategy Library or custom text) */}
          <div className="p-3.5 rounded border border-app bg-app-secondary/30">
            <StrategySelector
              compact
              label="Strategy Used"
              userId={userId}
              strategyId={strategyId}
              strategy={strategy}
              strategySnapshot={strategySnapshot}
              onChange={({ strategyId: nextId, strategy: nextStr, strategySnapshot: nextSnap }) => {
                hasManualStrategyRef.current = true;
                setStrategyId(nextId);
                setStrategy(nextStr);
                setStrategySnapshot(nextSnap);
              }}
            />
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

          {/* Pricing Parameters & Planned R:R */}
          <div className="space-y-3 p-3.5 rounded border border-app bg-app-secondary/20">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Entry Price
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(sanitizeDecimalInput(e.target.value))}
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
                  inputMode="decimal"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(sanitizeDecimalInput(e.target.value))}
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
                  inputMode="decimal"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(sanitizeDecimalInput(e.target.value))}
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
                  inputMode="decimal"
                  value={riskReward}
                  onChange={(e) => setRiskReward(e.target.value)}
                  placeholder={liveRR.formatted || 'e.g. 1:3.0'}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                />
              </div>
            </div>

            {/* Planned R:R Selector & Live Indicator */}
            <div className="pt-2 border-t border-app/60 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-app-main">
                  Planned R:R (Target only — separate from realized outcome)
                </span>
                {liveRR.formatted && (
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                    Price R:R: {liveRR.formatted}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PLANNED_RR_PRESETS.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() =>
                      setPlannedRRChoice((prev) => (prev === choice ? '' : choice))
                    }
                    className={`px-2.5 py-1 min-h-[34px] text-[11px] font-mono font-semibold rounded border transition-colors cursor-pointer ${
                      plannedRRChoice === choice
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-app-field text-app-main border-app hover:bg-app-secondary'
                    }`}
                  >
                    {choice}
                  </button>
                ))}

                {plannedRRChoice === 'Custom' && (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={plannedRRRatio}
                    onChange={(e) => setPlannedRRRatio(e.target.value)}
                    placeholder="e.g. 2.5 or 1:2.5"
                    aria-label="Custom Planned R:R"
                    className="w-28 px-2 py-1 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                  />
                )}

                {calculatedTP && (
                  <button
                    type="button"
                    onClick={() => {
                      setTakeProfit(calculatedTP);
                      if (!riskReward.trim() && targetMultiplier !== null) {
                        setRiskReward(`1:${targetMultiplier}`);
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 min-h-[34px] text-[11px] font-semibold bg-app-main border border-emerald-500/40 text-emerald-theme hover:bg-emerald-pale rounded cursor-pointer transition-colors"
                    title="Calculate and fill Take Profit using Entry, Stop Loss, and Planned R:R"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    <span>Calculate TP ({calculatedTP})</span>
                  </button>
                )}
              </div>

              {liveRR.invalidReason && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{liveRR.invalidReason}</span>
                </p>
              )}

              {rrMismatch.hasMismatch && rrMismatch.message && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded p-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{rrMismatch.message}</span>
                </p>
              )}
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
                    onClick={() => handleOutcomeSelect(st)}
                    className={`py-1.5 min-h-[36px] text-xs font-semibold rounded border transition-colors cursor-pointer ${
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
                inputMode="decimal"
                value={exitPrice}
                onChange={(e) => setExitPrice(sanitizeDecimalInput(e.target.value))}
                placeholder="e.g. 2692.20"
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Closed Date & Time when trade outcome is closed */}
          {outcome && outcome !== 'Open' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded border border-app bg-app-secondary/20">
              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Closed Date
                </label>
                <input
                  type="date"
                  value={closedDate}
                  onChange={(e) => setClosedDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-app-secondary mb-1">
                  Closed Time
                </label>
                <input
                  type="text"
                  value={closedTime}
                  onChange={(e) => setClosedTime(e.target.value)}
                  placeholder="HH:MM"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-app-field border border-app rounded text-app-main focus:outline-hidden focus:border-emerald-600"
                />
              </div>
            </div>
          )}

          {/* Setup Validity (independent of Win/Loss outcome) */}
          <div className="p-3 rounded border border-app bg-app-secondary/30 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-semibold text-app-main text-xs">Setup Validity</div>
                <div className="text-[11px] text-app-secondary">
                  Evaluate setup quality independently of outcome (a Valid setup can still hit SL).
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {SETUP_VALIDITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSetupValidity(opt.value)}
                    className={`px-2.5 py-1 min-h-[34px] text-[11px] font-semibold rounded border transition-colors cursor-pointer ${
                      setupValidity === opt.value
                        ? opt.value === 'Valid'
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : opt.value === 'Invalid'
                          ? 'bg-rose-600 text-white border-rose-600'
                          : 'bg-slate-600 text-white border-slate-600'
                        : 'bg-app-field text-app-main border-app hover:bg-app-secondary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
              spellCheck
              autoCorrect="on"
              autoCapitalize="sentences"
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
