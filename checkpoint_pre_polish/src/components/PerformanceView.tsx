import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingUp,
  Award,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Calendar,
  Layers,
  BarChart2,
  AlertTriangle,
  Info,
  Clock,
  Compass,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Sliders,
} from 'lucide-react';
import {
  DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  JournalEntry,
  PerformanceVisibilityConfig,
  RecordedTrade,
  SavedReport,
  TimeframeId,
  TradingPair,
  TradingSession,
} from '../types/journal';
import { getAllJournalEntries, isJournalEntryOwnedByScope } from '../services/db';
import { extractDeduplicatedTrades } from '../services/periodExport';

interface PerformanceViewProps {
  reportsList: SavedReport[];
  onOpenReport?: (reportId: string) => void;
  userId?: string | null;
  performanceVisibilityConfig?: PerformanceVisibilityConfig;
  onOpenSettings?: (tab?: 'general' | 'journal_visibility' | 'performance_visibility' | 'admin') => void;
}

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  reportsList,
  onOpenReport,
  userId,
  performanceVisibilityConfig = DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  onOpenSettings,
}) => {
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [periodFilter, setPeriodFilter] = useState<'today' | 'week' | 'month' | 'all' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showMetricDefinitions, setShowMetricDefinitions] = useState(false);
  const [selectedDrilldown, setSelectedDrilldown] = useState<string | null>(null);

  // Check if all performance sections are hidden
  const isAllHidden = useMemo(() => {
    return Object.values(performanceVisibilityConfig).every((val) => val === false);
  }, [performanceVisibilityConfig]);

  useEffect(() => {
    getAllJournalEntries().then(setJournalEntries).catch(() => {});
  }, []);

  // Calculate Date Bounds
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    if (periodFilter === 'today') {
      return { startDate: todayStr, endDate: todayStr };
    }

    if (periodFilter === 'week') {
      // Monday-start week
      const day = today.getDay(); // 0 is Sunday
      const diffToMonday = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diffToMonday));
      return {
        startDate: monday.toISOString().slice(0, 10),
        endDate: todayStr,
      };
    }

    if (periodFilter === 'month') {
      const monthStart = `${today.toISOString().slice(0, 7)}-01`;
      return { startDate: monthStart, endDate: todayStr };
    }

    if (periodFilter === 'custom' && customStartDate && customEndDate) {
      return { startDate: customStartDate, endDate: customEndDate };
    }

    return { startDate: '', endDate: '' };
  }, [periodFilter, customStartDate, customEndDate]);

  const scopedJournalEntries = useMemo(() => {
    return journalEntries.filter((j) => {
      const isMyJournal = j.entryType === 'my-journal' || (j.entryType as string) === 'my_journal';
      if (isMyJournal) return false;
      return isJournalEntryOwnedByScope(j, userId);
    });
  }, [journalEntries, userId]);

  // Filter Reports and Trades within Period
  const { filteredReports, allTrades, uniqueAnalysisDays, uniqueTradingDays } = useMemo(() => {
    const rpts = reportsList.filter((r) => {
      if (!startDate || !endDate) return true;
      return r.date >= startDate && r.date <= endDate;
    });

    const deduplicatedTrades = extractDeduplicatedTrades(rpts);
    const analysisDaysSet = new Set<string>();
    const tradingDaysSet = new Set<string>();

    for (const r of rpts) {
      if (r.date) {
        analysisDaysSet.add(r.date);
      }
    }

    for (const trade of deduplicatedTrades) {
      if (trade.date || trade.sourceReportDate) {
        tradingDaysSet.add(trade.date || trade.sourceReportDate!);
      }
    }

    // Incorporate account-owned trading journal reflections into trading days
    for (const j of scopedJournalEntries) {
      if (!startDate || !endDate || (j.date >= startDate && j.date <= endDate)) {
        if (!j.reflection?.noTradesDay) {
          tradingDaysSet.add(j.date);
        }
      }
    }

    return {
      filteredReports: rpts,
      allTrades: deduplicatedTrades,
      uniqueAnalysisDays: analysisDaysSet.size,
      uniqueTradingDays: tradingDaysSet.size,
    };
  }, [reportsList, scopedJournalEntries, startDate, endDate]);

  // Discipline & Execution Quality Calculations
  const disciplineStats = useMemo(() => {
    let rulesFollowed = 0;
    let rulesBroken = 0;
    let unreviewed = 0;

    for (const t of allTrades) {
      if (t.rulesFollowed === true) {
        rulesFollowed++;
      } else if (t.rulesFollowed === false) {
        rulesBroken++;
      } else {
        unreviewed++;
      }
    }

    // Also include standalone journal post-trade entries if not linked to an existing trade ID
    for (const j of scopedJournalEntries) {
      if (!startDate || !endDate || (j.date >= startDate && j.date <= endDate)) {
        if (j.postTrade?.rulesFollowedStatus) {
          // If not linked to a trade already in allTrades
          if (!j.linkedTradeId || !allTrades.some((t) => t.id === j.linkedTradeId)) {
            if (j.postTrade.rulesFollowedStatus === 'Followed') {
              rulesFollowed++;
            } else if (j.postTrade.rulesFollowedStatus === 'Broken') {
              rulesBroken++;
            } else if (j.postTrade.rulesFollowedStatus === 'Unreviewed') {
              unreviewed++;
            }
          }
        }
      }
    }

    const totalTrades = allTrades.length;
    const reviewedTrades = rulesFollowed + rulesBroken;
    const disciplineRate = reviewedTrades > 0 ? Math.round((rulesFollowed / reviewedTrades) * 100) : null;
    const reviewRate = totalTrades > 0 ? Math.round((reviewedTrades / totalTrades) * 100) : null;

    return {
      rulesFollowed,
      rulesBroken,
      unreviewed,
      reviewedTrades,
      totalTrades,
      disciplineRate,
      reviewRate,
    };
  }, [allTrades, scopedJournalEntries, startDate, endDate]);

  // Outcome Distributions
  const outcomeStats = useMemo(() => {
    let win = 0;
    let loss = 0;
    let be = 0;
    let open = 0;
    let unknown = 0;

    for (const t of allTrades) {
      const o = (t.outcome || '').toLowerCase();
      if (o === 'win') win++;
      else if (o === 'loss') loss++;
      else if (o === 'breakeven' || o === 'break-even') be++;
      else if (o === 'open') open++;
      else unknown++;
    }

    const closedDecided = win + loss;
    const winRate = closedDecided > 0 ? Math.round((win / closedDecided) * 100) : null;

    return { win, loss, be, open, unknown, closedDecided, winRate };
  }, [allTrades]);

  // Distributions by Pair, Session, and Direction
  const distributions = useMemo(() => {
    const pairs: Record<string, number> = { XAUUSD: 0, BTCUSD: 0, EURUSD: 0 };
    const sessions: Record<string, number> = { Asia: 0, London: 0, 'NY AM': 0, 'NY PM': 0 };
    const directions: Record<string, number> = { Buy: 0, Sell: 0 };
    const mistakes: Record<string, number> = {};
    const lessons: Record<string, number> = {};

    for (const t of allTrades) {
      if (t.pair && pairs[t.pair] !== undefined) pairs[t.pair]++;
      const sessionKey = t.session === 'Asian' ? 'Asia' : t.session;
      if (sessionKey && sessions[sessionKey] !== undefined) sessions[sessionKey]++;
      if (t.direction && directions[t.direction] !== undefined) directions[t.direction]++;
    }

    // Tally mistakes and lessons from account-owned trading journal entries
    for (const j of scopedJournalEntries) {
      if (!startDate || !endDate || (j.date >= startDate && j.date <= endDate)) {
        for (const m of j.postTrade?.mistakeTags || []) {
          mistakes[m] = (mistakes[m] || 0) + 1;
        }
        for (const l of j.postTrade?.lessonTags || []) {
          lessons[l] = (lessons[l] || 0) + 1;
        }
      }
    }

    const sortedMistakes = Object.entries(mistakes).sort((a, b) => b[1] - a[1]);
    const sortedLessons = Object.entries(lessons).sort((a, b) => b[1] - a[1]);

    return { pairs, sessions, directions, sortedMistakes, sortedLessons };
  }, [allTrades, scopedJournalEntries, startDate, endDate]);

  if (isAllHidden) {
    return (
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-12">
        <div className="p-8 text-center border border-dashed border-app rounded-xl bg-app-main space-y-3 max-w-lg mx-auto">
          <EyeOff className="w-10 h-10 text-app-secondary mx-auto opacity-60" />
          <h2 className="text-base font-bold text-app-main">All Performance sections are currently hidden</h2>
          <p className="text-xs text-app-secondary leading-relaxed">
            All analytics cards, compliance charts, and distribution breakdowns are hidden by your current visibility preferences. All calculations and underlying trade data remain completely preserved.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onOpenSettings?.('performance_visibility')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Adjust Visibility in Settings</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showVisualsGrid =
    performanceVisibilityConfig.disciplineCompliance !== false ||
    performanceVisibilityConfig.outcomeDistribution !== false;

  const showDistributionsGrid =
    performanceVisibilityConfig.sessionBreakdown !== false ||
    performanceVisibilityConfig.instrumentBreakdown !== false ||
    performanceVisibilityConfig.mistakesAndLessons !== false;

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 space-y-6">
      {/* Header & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-app">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-app-main tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-emerald-theme" />
            <span>Execution &amp; Performance Review</span>
          </h1>
          <p className="text-xs text-app-secondary mt-0.5">
            Objective metrics on trading activity, rule discipline, session breakdown, and execution quality.
          </p>
        </div>

        {/* Period Selector Tabs */}
        {performanceVisibilityConfig.activityCalendar !== false && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-app-field border border-app shrink-0 text-xs">
            <button
              type="button"
              onClick={() => setPeriodFilter('today')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                periodFilter === 'today'
                  ? 'bg-app-main text-emerald-theme font-bold shadow-2xs'
                  : 'text-app-secondary hover:text-app-main'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('week')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                periodFilter === 'week'
                  ? 'bg-app-main text-emerald-theme font-bold shadow-2xs'
                  : 'text-app-secondary hover:text-app-main'
              }`}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('month')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                periodFilter === 'month'
                  ? 'bg-app-main text-emerald-theme font-bold shadow-2xs'
                  : 'text-app-secondary hover:text-app-main'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setPeriodFilter('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                periodFilter === 'all'
                  ? 'bg-app-main text-emerald-theme font-bold shadow-2xs'
                  : 'text-app-secondary hover:text-app-main'
              }`}
            >
              All Time
            </button>
          </div>
        )}
      </div>

      {/* Top Metric Cards */}
      {performanceVisibilityConfig.totalsSummary !== false && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Discipline Rate */}
          <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-xs text-app-secondary">
              <span className="font-semibold">Discipline Rate</span>
              <Award className="w-4 h-4 text-emerald-theme" />
            </div>
            <div className={disciplineStats.disciplineRate !== null ? "text-2xl font-extrabold text-app-main" : "text-base font-bold text-app-secondary py-1"}>
              {disciplineStats.disciplineRate !== null ? `${disciplineStats.disciplineRate}%` : 'No reviewed trades'}
            </div>
            <div className="text-[11px] text-app-secondary">
              {disciplineStats.reviewedTrades > 0
                ? `${disciplineStats.rulesFollowed} of ${disciplineStats.reviewedTrades} reviewed followed rules`
                : 'No reviewed trades in period'}
            </div>
          </div>

          {/* Card 2: Total Trades & Decisions */}
          <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-xs text-app-secondary">
              <span className="font-semibold">Trades Recorded</span>
              <Layers className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-extrabold text-app-main">
              {disciplineStats.totalTrades}
            </div>
            {performanceVisibilityConfig.activeDays !== false && (
              <div className="text-[11px] text-app-secondary">
                Across {uniqueTradingDays} active trading day{uniqueTradingDays === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {/* Card 3: Market Analyses */}
          <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-xs text-app-secondary">
              <span className="font-semibold">Analyses Created</span>
              <Compass className="w-4 h-4 text-purple-500" />
            </div>
            <div className="text-2xl font-extrabold text-app-main">
              {filteredReports.length}
            </div>
            {performanceVisibilityConfig.activeDays !== false && (
              <div className="text-[11px] text-app-secondary">
                Across {uniqueAnalysisDays} active analysis day{uniqueAnalysisDays === 1 ? '' : 's'}
              </div>
            )}
          </div>

          {/* Card 4: Win Rate (Closed Trades) */}
          <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-1">
            <div className="flex items-center justify-between text-xs text-app-secondary">
              <span className="font-semibold">Outcome Win Rate</span>
              <BarChart2 className="w-4 h-4 text-emerald-theme" />
            </div>
            <div className={outcomeStats.winRate !== null ? "text-2xl font-extrabold text-app-main" : "text-base font-bold text-app-secondary py-1"}>
              {outcomeStats.winRate !== null ? `${outcomeStats.winRate}%` : 'No decided trades'}
            </div>
            <div className="text-[11px] text-app-secondary">
              {outcomeStats.closedDecided > 0
                ? `${outcomeStats.win} wins / ${outcomeStats.loss} losses (${outcomeStats.closedDecided} decided)`
                : 'No decided trades in period'}
            </div>
          </div>
        </div>
      )}

      {/* Primary Visualizations Grid */}
      {showVisualsGrid && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Visual 1: Discipline & Compliance Breakdown */}
          {performanceVisibilityConfig.disciplineCompliance !== false && (
            <div className="p-4 sm:p-5 rounded-xl border border-app bg-app-main shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm text-app-main">Discipline Compliance</div>
                {performanceVisibilityConfig.reviewCompletion !== false && (
                  <span className="text-xs text-app-secondary">
                    Review completion: {disciplineStats.reviewRate !== null ? `${disciplineStats.reviewRate}%` : '0%'}
                  </span>
                )}
              </div>

              {disciplineStats.totalTrades === 0 ? (
                <div className="py-8 text-center text-xs text-app-secondary">
                  No trades recorded in this period.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Stacked Bar */}
                  <div className="h-4 w-full rounded-full bg-app-field overflow-hidden flex">
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (disciplineStats.rulesFollowed / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-emerald-500 transition-all duration-300"
                      title={`Rules Followed: ${disciplineStats.rulesFollowed}`}
                    />
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (disciplineStats.rulesBroken / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-rose-500 transition-all duration-300"
                      title={`Rules Broken: ${disciplineStats.rulesBroken}`}
                    />
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (disciplineStats.unreviewed / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-amber-400 transition-all duration-300"
                      title={`Unreviewed: ${disciplineStats.unreviewed}`}
                    />
                  </div>

                  {/* Legend & Details */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-300 dark:border-emerald-800">
                      <div className="font-bold text-emerald-700 dark:text-emerald-300">
                        {disciplineStats.rulesFollowed}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                        Rules Followed
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-rose-50/50 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-800">
                      <div className="font-bold text-rose-700 dark:text-rose-300">
                        {disciplineStats.rulesBroken}
                      </div>
                      <div className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                        Rules Broken
                      </div>
                    </div>

                    <div className="p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800">
                      <div className="font-bold text-amber-700 dark:text-amber-300">
                        {disciplineStats.unreviewed}
                      </div>
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        Unreviewed
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Visual 2: Outcome Distribution */}
          {performanceVisibilityConfig.outcomeDistribution !== false && (
            <div className="p-4 sm:p-5 rounded-xl border border-app bg-app-main shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm text-app-main">Outcome Distribution</div>
                <span className="text-xs text-app-secondary">
                  Total Decided: {outcomeStats.closedDecided}
                </span>
              </div>

              {disciplineStats.totalTrades === 0 ? (
                <div className="py-8 text-center text-xs text-app-secondary">
                  No trade outcomes recorded in this period.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Stacked Outcome Bar */}
                  <div className="h-4 w-full rounded-full bg-app-field overflow-hidden flex">
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (outcomeStats.win / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-emerald-500 transition-all duration-300"
                      title={`Wins: ${outcomeStats.win}`}
                    />
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (outcomeStats.loss / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-rose-500 transition-all duration-300"
                      title={`Losses: ${outcomeStats.loss}`}
                    />
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (outcomeStats.be / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-slate-400 transition-all duration-300"
                      title={`Breakeven: ${outcomeStats.be}`}
                    />
                    <div
                      style={{
                        width: `${disciplineStats.totalTrades ? (outcomeStats.open / disciplineStats.totalTrades) * 100 : 0}%`,
                      }}
                      className="bg-amber-400 transition-all duration-300"
                      title={`Open: ${outcomeStats.open}`}
                    />
                  </div>

                  {/* Legend & Details */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded bg-app-field border border-app">
                      <div className="font-bold text-emerald-600 dark:text-emerald-400">
                        {outcomeStats.win}
                      </div>
                      <div className="text-[10px] text-app-secondary">Wins</div>
                    </div>

                    <div className="p-2 rounded bg-app-field border border-app">
                      <div className="font-bold text-rose-600 dark:text-rose-400">
                        {outcomeStats.loss}
                      </div>
                      <div className="text-[10px] text-app-secondary">Losses</div>
                    </div>

                    <div className="p-2 rounded bg-app-field border border-app">
                      <div className="font-bold text-slate-700 dark:text-slate-300">
                        {outcomeStats.be}
                      </div>
                      <div className="text-[10px] text-app-secondary">Breakeven</div>
                    </div>

                    <div className="p-2 rounded bg-app-field border border-app">
                      <div className="font-bold text-amber-600 dark:text-amber-400">
                        {outcomeStats.open}
                      </div>
                      <div className="text-[10px] text-app-secondary">Open</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Secondary Distributions: Sessions, Pairs, Mistakes */}
      {showDistributionsGrid && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* By Session */}
          {performanceVisibilityConfig.sessionBreakdown !== false && (
            <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-3">
              <div className="font-bold text-sm text-app-main">Trades by Session</div>
              <div className="space-y-2">
                {Object.entries(distributions.sessions).map(([sess, count]) => {
                  const pct = disciplineStats.totalTrades > 0 ? Math.round((count / disciplineStats.totalTrades) * 100) : 0;
                  return (
                    <div key={sess} className="space-y-1">
                      <div className="flex items-center justify-between text-app-main">
                        <span>{sess}</span>
                        <span className="font-bold text-app-secondary">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-app-field overflow-hidden">
                        <div style={{ width: `${pct}%` }} className="h-full bg-emerald-500 rounded-full" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By Instrument */}
          {performanceVisibilityConfig.instrumentBreakdown !== false && (
            <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-3">
              <div className="font-bold text-sm text-app-main">Trades by Instrument</div>
              <div className="space-y-2">
                {Object.entries(distributions.pairs).map(([p, count]) => {
                  const pct = disciplineStats.totalTrades > 0 ? Math.round((count / disciplineStats.totalTrades) * 100) : 0;
                  return (
                    <div key={p} className="space-y-1">
                      <div className="flex items-center justify-between text-app-main">
                        <span className="font-bold">{p}</span>
                        <span className="text-app-secondary">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-app-field overflow-hidden">
                        <div style={{ width: `${pct}%` }} className="h-full bg-blue-500 rounded-full" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Frequent Mistakes & Discipline Opportunities */}
          {performanceVisibilityConfig.mistakesAndLessons !== false && (
            <div className="p-4 rounded-xl border border-app bg-app-main shadow-2xs space-y-3">
              <div className="font-bold text-sm text-app-main">Identified Mistake Patterns</div>
              {distributions.sortedMistakes.length === 0 ? (
                <div className="py-6 text-center text-app-secondary text-[11px]">
                  No mistake tags recorded in this period.
                </div>
              ) : (
                <div className="space-y-2">
                  {distributions.sortedMistakes.slice(0, 4).map(([tag, count]) => (
                    <div key={tag} className="flex items-center justify-between p-2 rounded bg-app-field border border-app">
                      <span className="text-rose-600 dark:text-rose-400 font-medium">{tag}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
                        {count}x
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Metric Definitions & Mathematical Transparency */}
      {performanceVisibilityConfig.metricDefinitions !== false && (
        <div className="rounded-xl border border-app bg-app-field/40 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setShowMetricDefinitions((prev) => !prev)}
            className="w-full flex items-center justify-between p-3.5 text-left text-app-main font-semibold hover:bg-app-field transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-theme" />
              <span>Metric Definitions &amp; Accuracy Invariants</span>
            </div>
            {showMetricDefinitions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showMetricDefinitions && (
            <div className="p-4 border-t border-app space-y-2.5 text-app-secondary leading-relaxed bg-app-main">
              <div>
                <strong className="text-app-main block mb-0.5">Discipline Rate Formula:</strong>
                <p className="font-mono text-emerald-theme bg-app-field px-2.5 py-1 rounded inline-block">
                  Discipline rate = compliant reviewed trades / all reviewed trades × 100
                </p>
                <p className="mt-1">
                  Qualifying records: Compliant reviewed trades are those marked <em>Followed</em>. All reviewed trades is the sum of <em>Followed</em> and <em>Broken</em>. Unreviewed trades are excluded from the denominator so missing reviews never penalize or inflate adherence. When there are zero reviewed trades, the card shows &ldquo;No reviewed trades&rdquo;.
                </p>
              </div>

              <div>
                <strong className="text-app-main block mb-0.5">Win Rate Formula:</strong>
                <p className="font-mono text-emerald-theme bg-app-field px-2.5 py-1 rounded inline-block">
                  Win rate = wins / (wins + losses) × 100
                </p>
                <p className="mt-1">
                  Qualifying records: Only closed, decided trades (wins and losses) are counted in the denominator. Breakeven, open, and unstated outcomes are excluded from the win-rate denominator. When there are zero decided trades, the card shows &ldquo;No decided trades&rdquo;.
                </p>
              </div>

              <div>
                <strong className="text-app-main">Copied &amp; Conflict Reports: </strong>
                Analyses and trades are tracked and deduplicated by their permanent unique IDs (<code>tradeMap</code> by <code>trade.id</code>). Copying or editing an analysis never duplicates trade counts or skews historical statistics.
              </div>

              <div>
                <strong className="text-app-main">Personal Reflections Independence: </strong>
                Personal notes from My Journal (<code>entryType: &apos;my-journal&apos;</code>) are strictly independent and are never counted as market analyses, trades, or execution reviews.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
