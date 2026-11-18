import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Download,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Database,
  Filter,
  FileText,
  BookOpen,
  TrendingUp,
  Calendar,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Tag,
  Link as LinkIcon,
  Plus,
} from 'lucide-react';
import { JournalEntry, SavedReport } from '../types/journal';
import {
  calculateOverallAlignment,
  formatReadableAnalysisDate,
  generateReportsCsv,
  getReportBiasSummary,
} from '../utils/analysisUtils';
import { exportTextOrDownload } from '../utils/nativeExport';
import { ReportDetailsModal } from './ReportDetailsModal';
import { BackupModal } from './BackupModal';
import { PeriodExportModal } from './PeriodExportModal';
import { SyncStatusBadge } from './SyncStatusBadge';
import { useAuth } from '../context/AuthContext';
import { getAllJournalEntries, deleteJournalEntry } from '../services/db';

interface ReportsViewProps {
  reports: SavedReport[];
  onModifyReport: (report: SavedReport) => void;
  onCopyReport: (report: SavedReport) => void;
  onDeleteReport: (id: string) => void;
  onUpdateReport?: (updated: SavedReport) => Promise<void>;
  onRefreshData: () => void;
  initialSession?: {
    selectedPair?: string;
    searchQuery?: string;
    activeReportDetailsId?: string | null;
  };
  onSessionChange?: (session: {
    selectedPair: string;
    searchQuery: string;
    activeReportDetailsId: string | null;
  }) => void;
  initialTradeDraft?: any;
  onTradeDraftChange?: (draft: any) => void;
  reportDetailsCloseTrigger?: number;
  onReportDetailsStateChange?: (isOpen: boolean, isOrganized: boolean) => void;
  onNavigateToJournal?: () => void;
  onNavigateToPerformance?: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  reports,
  onModifyReport,
  onCopyReport,
  onDeleteReport,
  onUpdateReport,
  onRefreshData,
  initialSession,
  onSessionChange,
  initialTradeDraft,
  onTradeDraftChange,
  reportDetailsCloseTrigger,
  onReportDetailsStateChange,
  onNavigateToJournal,
  onNavigateToPerformance,
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'analysis' | 'journal' | 'performance'>('analysis');
  const [selectedPair, setSelectedPair] = useState<string>(initialSession?.selectedPair || 'All');
  const [searchQuery, setSearchQuery] = useState(initialSession?.searchQuery || '');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeReportDetails, setActiveReportDetails] = useState<SavedReport | null>(null);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isPeriodExportModalOpen, setIsPeriodExportModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Journal entries state for tab 2 & period export
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalTypeFilter, setJournalTypeFilter] = useState<string>('all');
  const [deleteJournalConfirmId, setDeleteJournalConfirmId] = useState<string | null>(null);

  const consumedReportIdRef = useRef<string | null>(null);
  const isOrganizedViewRef = useRef<boolean>(false);

  const onReportDetailsStateChangeRef = useRef(onReportDetailsStateChange);
  useEffect(() => {
    onReportDetailsStateChangeRef.current = onReportDetailsStateChange;
  }, [onReportDetailsStateChange]);

  const onSessionChangeRef = useRef(onSessionChange);
  useEffect(() => {
    onSessionChangeRef.current = onSessionChange;
  }, [onSessionChange]);

  // Restore activeReportDetails on mount or when returning from modify, consuming target ID once
  useEffect(() => {
    const targetId = initialSession?.activeReportDetailsId;
    if (targetId && targetId !== consumedReportIdRef.current && reports.length > 0) {
      const found = reports.find((r) => r.id === targetId);
      if (found) {
        consumedReportIdRef.current = targetId;
        setActiveReportDetails(found);
        onReportDetailsStateChangeRef.current?.(true, isOrganizedViewRef.current);
      }
    }
  }, [initialSession?.activeReportDetailsId, reports]);

  // Authoritative close function: clears active details, consumed ID, and notifies parent session
  const handleCloseReportDetails = () => {
    consumedReportIdRef.current = null;
    isOrganizedViewRef.current = false;
    setActiveReportDetails(null);
    if (initialSession) {
      initialSession.activeReportDetailsId = null;
    }
    onSessionChangeRef.current?.({
      selectedPair,
      searchQuery,
      activeReportDetailsId: null,
    });
    onReportDetailsStateChangeRef.current?.(false, false);
  };

  // Authoritative open function: marks ID as consumed, updates state and notifies parent
  const handleOpenReportDetails = (report: SavedReport) => {
    consumedReportIdRef.current = report.id;
    isOrganizedViewRef.current = false;
    setActiveReportDetails(report);
    onSessionChangeRef.current?.({
      selectedPair,
      searchQuery,
      activeReportDetailsId: report.id,
    });
    onReportDetailsStateChangeRef.current?.(true, false);
  };

  // Handle external close trigger from App header
  useEffect(() => {
    if (reportDetailsCloseTrigger && reportDetailsCloseTrigger > 0) {
      handleCloseReportDetails();
    }
  }, [reportDetailsCloseTrigger]);

  const handleViewModeChange = (mode: 'standard' | 'organized') => {
    const isOrganized = mode === 'organized';
    isOrganizedViewRef.current = isOrganized;
    onReportDetailsStateChangeRef.current?.(Boolean(activeReportDetails), isOrganized);
  };

  // Notify parent of reports UI session change
  useEffect(() => {
    onSessionChangeRef.current?.({
      selectedPair,
      searchQuery,
      activeReportDetailsId: activeReportDetails?.id || null,
    });
  }, [selectedPair, searchQuery, activeReportDetails?.id]);

  // Keep activeReportDetails in sync when reports array updates
  useEffect(() => {
    if (activeReportDetails) {
      const refreshed = reports.find((r) => r.id === activeReportDetails.id);
      if (refreshed) {
        setActiveReportDetails(refreshed);
      }
    }
  }, [reports]);

  // Fetch journal entries on mount and refresh
  const loadJournalData = useCallback(async () => {
    try {
      const list = await getAllJournalEntries();
      setJournalEntries(list);
    } catch (err) {
      console.error('Failed to load journal entries in ReportsView', err);
    }
  }, []);

  useEffect(() => {
    loadJournalData();
  }, [loadJournalData]);

  // Keep parent refresh hooked
  const handleDataRefreshWithJournal = useCallback(() => {
    loadJournalData();
    onRefreshData();
  }, [loadJournalData, onRefreshData]);

  const handleDeleteJournal = async (id: string) => {
    try {
      await deleteJournalEntry(id);
      setDeleteJournalConfirmId(null);
      await loadJournalData();
    } catch (err) {
      console.error('Failed to delete journal entry', err);
    }
  };

  // Filter reports
  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      // Pair filter
      if (selectedPair !== 'All' && r.pair !== selectedPair) {
        return false;
      }
      // Search query across title, pair, notes, session, date, id
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = (r.title || '').toLowerCase().includes(q);
        const matchesPair = (r.pair || '').toLowerCase().includes(q);
        const matchesNotes = (r.overallNotes || '').toLowerCase().includes(q);
        const matchesSession = (r.session || '').toLowerCase().includes(q);
        const matchesDate = (r.date || '').toLowerCase().includes(q);
        const matchesId = (r.id || '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesPair && !matchesNotes && !matchesSession && !matchesDate && !matchesId) {
          return false;
        }
      }
      return true;
    });
  }, [reports, selectedPair, searchQuery]);

  // Filtered Journal Entries
  const filteredJournalEntries = useMemo(() => {
    return journalEntries.filter((entry) => {
      if (journalTypeFilter !== 'all' && entry.entryType !== journalTypeFilter) {
        return false;
      }
      if (selectedPair !== 'All' && entry.pair && entry.pair !== selectedPair) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesDate = (entry.date || '').toLowerCase().includes(q);
        const matchesPair = (entry.pair || '').toLowerCase().includes(q);
        const matchesSession = (entry.session || '').toLowerCase().includes(q);
        const matchesNotes = (entry.notes || '').toLowerCase().includes(q);
        const matchesTitle = (entry.title || '').toLowerCase().includes(q);
        const matchesTag = entry.tags?.some((t) => t.toLowerCase().includes(q));
        if (!matchesDate && !matchesPair && !matchesSession && !matchesNotes && !matchesTitle && !matchesTag) {
          return false;
        }
      }
      return true;
    });
  }, [journalEntries, journalTypeFilter, selectedPair, searchQuery]);

  // Performance quick metrics calculation for tab 3
  const performanceSummary = useMemo(() => {
    const allTrades = reports.flatMap((r) => r.trades || []);
    const winCount = allTrades.filter((t) => t.outcome === 'Win').length;
    const lossCount = allTrades.filter((t) => t.outcome === 'Loss').length;
    const beCount = allTrades.filter((t) => t.outcome === 'Break-even').length;
    const openCount = allTrades.filter((t) => t.outcome === 'Open').length;
    const closedCount = winCount + lossCount + beCount;
    const winRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;

    // Discipline rules followed from journal & trades
    let rulesFollowed = 0;
    let rulesBroken = 0;
    journalEntries.forEach((entry) => {
      if (entry.entryType === 'post-trade' && entry.postTrade) {
        if (entry.postTrade.followedRules === 'yes') rulesFollowed++;
        else if (entry.postTrade.followedRules === 'no') rulesBroken++;
      }
    });

    const reviewedCount = rulesFollowed + rulesBroken;
    const disciplineRate = reviewedCount > 0 ? (rulesFollowed / reviewedCount) * 100 : 100;

    return {
      totalReports: reports.length,
      totalTrades: allTrades.length,
      closedTrades: closedCount,
      winCount,
      lossCount,
      beCount,
      openCount,
      winRate: Math.round(winRate),
      rulesFollowed,
      rulesBroken,
      reviewedCount,
      disciplineRate: Math.round(disciplineRate),
    };
  }, [reports, journalEntries]);

  // Group filtered reports by analysis date (newest day first)
  const groupedReports = useMemo(() => {
    const groups: Record<string, SavedReport[]> = {};
    for (const r of filteredReports) {
      const dateKey = r.date?.trim() || (r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : 'Unspecified Date');
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(r);
    }

    // Sort dates descending
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return sortedDates.map((date) => ({
      date,
      items: groups[date],
    }));
  }, [filteredReports]);

  const handleExportCsv = async () => {
    if (filteredReports.length === 0) return;
    const csvData = generateReportsCsv(filteredReports);
    const filename = `abmax_reports_${selectedPair}_${new Date().toISOString().slice(0, 10)}.csv`;
    await exportTextOrDownload(csvData, filename, 'text/csv;charset=utf-8;', 'Export Reports CSV');
  };

  const getBiasTextColor = (bias: string) => {
    if (bias === 'Bullish') return 'text-bullish font-semibold';
    if (bias === 'Bearish') return 'text-bearish font-semibold';
    if (bias === 'Neutral') return 'text-slate-500 dark:text-slate-400 font-semibold';
    if (bias === 'Not sure' || bias === 'Incomplete') return 'text-amber-theme font-semibold';
    return 'text-app-main font-semibold';
  };

  return (
    <div className="max-w-[1100px] mx-auto px-3.5 sm:px-6 py-6 sm:py-8">
      {/* Top section: Heading, Sync badge, Tabs & Action buttons */}
      <div className="flex flex-col gap-4 mb-6 pb-4 border-b border-app">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-app-main">
                {activeTab === 'analysis'
                  ? 'Analysis Reports'
                  : activeTab === 'journal'
                  ? 'Journal Reports'
                  : 'Performance Reports'}
              </h2>
              <SyncStatusBadge status={user ? 'synced' : 'local'} />
            </div>
            <p className="text-xs text-app-secondary mt-0.5">
              {activeTab === 'analysis'
                ? 'Archived multi-timeframe analysis records sorted by session date.'
                : activeTab === 'journal'
                ? 'Trading execution logs, pre-market preparation, and daily reflections.'
                : 'Execution discipline, rule adherence metrics, and trade outcome review.'}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Download Period Report (Always visible) */}
            <button
              type="button"
              onClick={() => setIsPeriodExportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-theme hover:bg-emerald-700 text-white rounded transition-colors shadow-2xs"
              title="Download combined Period PDF Report"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Period Report</span>
            </button>

            {/* Pair filter (for analysis and journal tabs) */}
            {activeTab !== 'performance' && (
              <div className="flex items-center gap-1.5 bg-app-field border border-app rounded px-2.5 py-1.5">
                <Filter className="w-3.5 h-3.5 text-app-secondary" />
                <select
                  value={selectedPair}
                  onChange={(e) => setSelectedPair(e.target.value)}
                  className="bg-transparent text-xs text-app-main focus:outline-hidden font-medium cursor-pointer"
                >
                  <option value="All">All pairs</option>
                  <option value="XAUUSD">XAUUSD</option>
                  <option value="BTCUSD">BTCUSD</option>
                  <option value="EURUSD">EURUSD</option>
                </select>
              </div>
            )}

            {/* Journal Type filter (when on journal tab) */}
            {activeTab === 'journal' && (
              <div className="flex items-center gap-1.5 bg-app-field border border-app rounded px-2.5 py-1.5">
                <Tag className="w-3.5 h-3.5 text-app-secondary" />
                <select
                  value={journalTypeFilter}
                  onChange={(e) => setJournalTypeFilter(e.target.value)}
                  className="bg-transparent text-xs text-app-main focus:outline-hidden font-medium cursor-pointer"
                >
                  <option value="all">All Entry Types</option>
                  <option value="prep">Preparation</option>
                  <option value="pre-trade">Pre-Trade</option>
                  <option value="in-trade">In-Trade</option>
                  <option value="post-trade">Post-Trade</option>
                  <option value="daily-reflection">Reflection</option>
                  <option value="no-trade-day">No-Trade Day</option>
                </select>
              </div>
            )}

            {/* Search (for analysis and journal tabs) */}
            {activeTab !== 'performance' && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-app-secondary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes, dates..."
                  className="pl-8 pr-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main w-32 sm:w-40 focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
                />
              </div>
            )}

            {/* Export CSV (Only for Analysis tab) */}
            {activeTab === 'analysis' && (
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredReports.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-app-main border border-app hover:bg-app-field rounded text-app-main transition-colors disabled:opacity-40"
                title="Export filtered reports to CSV"
              >
                <Download className="w-3.5 h-3.5 text-app-secondary" />
                Export CSV
              </button>
            )}

            {/* Secondary backup/import controls */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field border border-app rounded transition-colors"
                title="Backup & Restore Data"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showMoreMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowMoreMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-48 bg-app-main border border-app rounded shadow-lg py-1 z-30">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        setIsBackupModalOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 text-xs text-app-main hover:bg-app-field flex items-center gap-2"
                    >
                      <Database className="w-3.5 h-3.5 text-emerald-theme" />
                      Backup &amp; Restore (JSON)
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3 Tabs Selector */}
        <div className="flex items-center gap-1 p-1 bg-app-field border border-app rounded-md w-full sm:w-auto self-start overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('analysis')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'analysis'
                ? 'bg-app-main text-emerald-theme shadow-2xs border border-app/60'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Analysis Reports</span>
            <span className="px-1.5 py-0.2 bg-app-secondary rounded-full text-[10px] text-app-secondary font-mono">
              {reports.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('journal')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'journal'
                ? 'bg-app-main text-emerald-theme shadow-2xs border border-app/60'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Journal Reports</span>
            <span className="px-1.5 py-0.2 bg-app-secondary rounded-full text-[10px] text-app-secondary font-mono">
              {journalEntries.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('performance')}
            className={`flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'performance'
                ? 'bg-app-main text-emerald-theme shadow-2xs border border-app/60'
                : 'text-app-secondary hover:text-app-main'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Performance Reports</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ANALYSIS REPORTS */}
      {activeTab === 'analysis' && (
        <>
          {/* Active Filter Summary Bar */}
          {reports.length > 0 && (selectedPair !== 'All' || searchQuery.trim() !== '') && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 mb-4 bg-app-field border border-app rounded text-xs">
              <span className="text-app-main font-medium">
                Showing <strong className="text-emerald-theme">{filteredReports.length}</strong> of{' '}
                <strong className="text-app-main">{reports.length}</strong> total saved reports
                {selectedPair !== 'All' ? ` (Pair: ${selectedPair})` : ''}
                {searchQuery.trim() ? ` (Search: “${searchQuery}”)` : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedPair('All');
                  setSearchQuery('');
                }}
                className="text-xs font-semibold text-emerald-theme hover:underline cursor-pointer"
              >
                Show All
              </button>
            </div>
          )}

          {/* Reports List */}
          {reports.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-app rounded-lg bg-app-secondary/30">
              <p className="text-sm text-app-secondary font-medium">No analysis reports saved yet.</p>
              <p className="text-xs text-app-secondary mt-1">
                Complete a multi-timeframe review in the Analysis tab and click “Save Report”.
              </p>
            </div>
          ) : groupedReports.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-app rounded-lg space-y-3 bg-app-secondary/20">
              <p className="text-sm font-semibold text-app-main">No reports match the current filter or search.</p>
              <p className="text-xs text-app-secondary">
                You have {reports.length} saved {reports.length === 1 ? 'report' : 'reports'} in your journal.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedPair('All');
                  setSearchQuery('');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme hover:bg-emerald-700 rounded transition-colors cursor-pointer"
              >
                Clear Filters &amp; Show All ({reports.length})
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {groupedReports.map(({ date, items }, groupIdx) => (
                <React.Fragment key={date}>
                  {/* Bold orange separator between distinct date groups */}
                  {groupIdx > 0 && (
                    <div
                      className="border-t-4 border-[#F97316] my-8 rounded-full shadow-xs"
                      role="separator"
                      aria-orientation="horizontal"
                    />
                  )}
                  <div className="space-y-2.5">
                    {/* One bold boxed date heading per day */}
                    <div className="inline-block px-3 py-1 bg-app-secondary border border-app rounded text-xs font-bold text-app-main tracking-wide">
                      {(() => {
                        const readable = formatReadableAnalysisDate(date);
                        return (
                          <span>
                            <span>{readable.primary}</span>
                            {readable.secondary && (
                              <span className="text-app-secondary font-normal ml-1.5 opacity-80 text-[11px]">
                                {readable.secondary}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Compact full-width report cards beneath each date */}
                    <div className="space-y-2">
                      {items.map((r) => {
                        const alignment = calculateOverallAlignment(r.timeframes);
                        const biasSummary = getReportBiasSummary(r);

                        return (
                          <div
                            key={r.id}
                            className="border border-app rounded-md p-3 sm:px-4 sm:py-3.5 bg-app-main hover:border-emerald-600/40 transition-colors shadow-2xs"
                          >
                            {/* First line: title (if any), pair, overall bias, alignment */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-app/60">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                {r.title && (
                                  <>
                                    <span className="font-extrabold text-base text-app-main tracking-tight">
                                      {r.title}
                                    </span>
                                    <span className="text-app-secondary text-xs select-none">·</span>
                                  </>
                                )}
                                <span className="font-bold text-sm text-app-main tracking-tight">
                                  {r.pair}
                                </span>
                                <span className="text-app-secondary text-xs select-none">·</span>
                                <span className="text-xs text-app-main">
                                  Bias:{' '}
                                  <span className={getBiasTextColor(biasSummary.summary)}>
                                    {biasSummary.summary}
                                  </span>
                                </span>
                                <span className="text-app-secondary text-xs select-none">·</span>
                                <span className="text-xs text-app-main">
                                  Alignment: <span className="font-medium">{alignment.label}</span>
                                </span>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenReportDetails(r)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-theme bg-emerald-pale hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded transition-colors"
                                >
                                  <Eye className="w-3 h-3" /> View Details
                                </button>

                                <button
                                  type="button"
                                  onClick={() => onModifyReport(r)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-app-main bg-app-field hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors"
                                >
                                  <Edit className="w-3 h-3 text-app-secondary" /> Modify
                                </button>

                                {deleteConfirmId === r.id ? (
                                  <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 p-0.5 rounded border border-rose-300">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onDeleteReport(r.id);
                                        setDeleteConfirmId(null);
                                      }}
                                      className="px-2 py-0.5 text-[11px] bg-rose-600 text-white rounded font-medium"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDeleteConfirmId(null)}
                                      className="px-1 text-[11px] text-app-secondary"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirmId(r.id)}
                                    className="p-1 text-app-secondary hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
                                    title="Delete report"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Second line: session, Analysis Made, creation time, Original/Modified status */}
                            <div className="pt-2 flex flex-wrap items-center justify-between gap-y-1 gap-x-3 text-xs text-app-secondary">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span>{r.session}</span>
                                <span className="select-none">·</span>
                                <span>{r.analysisTiming}</span>
                                <span className="select-none">·</span>
                                <span>
                                  Created{' '}
                                  <span className="font-mono">
                                    {new Date(r.createdAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </span>
                                <span className="select-none">·</span>
                                <span
                                  className={
                                    r.status === 'Modified'
                                      ? 'text-amber-theme font-medium'
                                      : 'text-emerald-theme font-medium'
                                  }
                                >
                                  {r.status || 'Original Analysis'}
                                </span>
                              </div>

                              {r.copiedFromId && (
                                <span className="text-[10px] text-app-secondary">
                                  (Copied)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </>
      )}

      {/* TAB 2: JOURNAL REPORTS */}
      {activeTab === 'journal' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2">
            <span className="text-xs text-app-secondary">
              Showing <strong className="text-app-main">{filteredJournalEntries.length}</strong> of{' '}
              <strong className="text-app-main">{journalEntries.length}</strong> journal entries
            </span>
            {onNavigateToJournal && (
              <button
                type="button"
                onClick={onNavigateToJournal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-theme hover:bg-emerald-700 text-white rounded transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Journal Entry</span>
              </button>
            )}
          </div>

          {journalEntries.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-app rounded-lg bg-app-secondary/30 space-y-3">
              <BookOpen className="w-8 h-8 text-app-secondary mx-auto opacity-70" />
              <p className="text-sm text-app-main font-semibold">No journal entries recorded yet.</p>
              <p className="text-xs text-app-secondary max-w-md mx-auto">
                Log pre-market prep, trade executions, rule checklists, and daily reflections to build your disciplined track record.
              </p>
              {onNavigateToJournal && (
                <button
                  type="button"
                  onClick={onNavigateToJournal}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-emerald-theme hover:bg-emerald-700 text-white rounded transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Open Journal Workspace</span>
                </button>
              )}
            </div>
          ) : filteredJournalEntries.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-app rounded-lg space-y-2 bg-app-secondary/20">
              <p className="text-sm font-semibold text-app-main">No journal entries match current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedPair('All');
                  setJournalTypeFilter('all');
                  setSearchQuery('');
                }}
                className="text-xs text-emerald-theme font-semibold hover:underline"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJournalEntries.map((entry) => {
                const isNoTrade = entry.entryType === 'no-trade-day';
                const hasRules = entry.postTrade?.followedRules;
                const rulesOk = hasRules === 'yes';
                const rulesFail = hasRules === 'no';

                return (
                  <div
                    key={entry.id}
                    className="border border-app rounded-lg p-3.5 sm:p-4 bg-app-main hover:border-emerald-600/40 transition-colors shadow-2xs space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {/* Type badge */}
                        <span className="px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[10px] bg-emerald-pale text-emerald-theme border border-emerald-500/20">
                          {entry.entryType.replace('-', ' ')}
                        </span>
                        <span className="font-bold text-app-main">{entry.date}</span>
                        {entry.session && (
                          <>
                            <span className="text-app-secondary select-none">·</span>
                            <span className="text-app-secondary">{entry.session}</span>
                          </>
                        )}
                        {entry.pair && (
                          <>
                            <span className="text-app-secondary select-none">·</span>
                            <span className="font-mono font-semibold text-app-main">{entry.pair}</span>
                          </>
                        )}
                      </div>

                      {/* Quiet Delete */}
                      <div className="flex items-center gap-2">
                        {deleteJournalConfirmId === entry.id ? (
                          <div className="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/40 p-0.5 rounded border border-rose-300">
                            <button
                              type="button"
                              onClick={() => handleDeleteJournal(entry.id)}
                              className="px-2 py-0.5 text-[11px] bg-rose-600 text-white rounded font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteJournalConfirmId(null)}
                              className="px-1 text-[11px] text-app-secondary"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteJournalConfirmId(entry.id)}
                            className="p-1 text-app-secondary hover:text-rose-600 rounded transition-colors"
                            title="Delete entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Title or primary headline */}
                    {entry.title && (
                      <h4 className="text-sm font-bold text-app-main tracking-tight">
                        {entry.title}
                      </h4>
                    )}

                    {/* Status & tags row */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {entry.emotionalState && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-app-field border border-app text-app-main font-medium">
                          Mindset: {entry.emotionalState}
                        </span>
                      )}

                      {hasRules && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            rulesOk
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 text-emerald-theme'
                              : rulesFail
                              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 text-rose-600 dark:text-rose-400'
                              : 'bg-app-field border-app text-app-secondary'
                          }`}
                        >
                          {rulesOk && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                          {rulesFail && <XCircle className="w-3 h-3 text-rose-600" />}
                          Rules: {rulesOk ? 'Followed' : rulesFail ? 'Broken' : 'Not Reviewed'}
                        </span>
                      )}

                      {entry.postTrade?.outcome && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                            entry.postTrade.outcome === 'win'
                              ? 'bg-emerald-pale text-emerald-theme'
                              : entry.postTrade.outcome === 'loss'
                              ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                              : 'bg-app-field text-app-secondary'
                          }`}
                        >
                          {entry.postTrade.outcome}
                        </span>
                      )}

                      {isNoTrade && (
                        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                          Deliberate No-Trade Day
                        </span>
                      )}
                    </div>

                    {/* Notes preview */}
                    {entry.notes && (
                      <p className="text-xs text-app-secondary line-clamp-3 leading-relaxed whitespace-pre-wrap">
                        {entry.notes}
                      </p>
                    )}

                    {/* Linked Analysis Report Badge */}
                    {entry.linkedReportId && (
                      <div className="pt-1 flex items-center gap-1.5 text-xs text-app-secondary">
                        <LinkIcon className="w-3 h-3 text-emerald-theme" />
                        <span>Linked Analysis:</span>
                        {(() => {
                          const matched = reports.find((r) => r.id === entry.linkedReportId);
                          if (matched) {
                            return (
                              <button
                                type="button"
                                onClick={() => handleOpenReportDetails(matched)}
                                className="font-semibold text-emerald-theme hover:underline cursor-pointer"
                              >
                                {matched.title || `${matched.pair} (${matched.date})`}
                              </button>
                            );
                          }
                          return (
                            <span className="font-mono text-app-secondary">
                              {entry.linkedReportTitle || entry.linkedReportId}
                            </span>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PERFORMANCE REPORTS */}
      {activeTab === 'performance' && (
        <div className="space-y-6">
          {/* Executive Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border border-app rounded-lg p-3.5 bg-app-main shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-app-secondary uppercase tracking-wider">
                Total Analyses
              </span>
              <div className="text-2xl font-extrabold text-app-main tracking-tight font-mono">
                {performanceSummary.totalReports}
              </div>
              <p className="text-[11px] text-app-secondary">
                {performanceSummary.totalTrades} recorded {performanceSummary.totalTrades === 1 ? 'trade' : 'trades'}
              </p>
            </div>

            <div className="border border-app rounded-lg p-3.5 bg-app-main shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-app-secondary uppercase tracking-wider">
                Discipline Rate
              </span>
              <div className="text-2xl font-extrabold text-emerald-theme tracking-tight font-mono">
                {performanceSummary.disciplineRate}%
              </div>
              <p className="text-[11px] text-app-secondary">
                {performanceSummary.rulesFollowed} of {performanceSummary.reviewedCount} rules followed
              </p>
            </div>

            <div className="border border-app rounded-lg p-3.5 bg-app-main shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-app-secondary uppercase tracking-wider">
                Win Rate
              </span>
              <div className="text-2xl font-extrabold text-app-main tracking-tight font-mono">
                {performanceSummary.winRate}%
              </div>
              <p className="text-[11px] text-app-secondary">
                {performanceSummary.winCount}W / {performanceSummary.lossCount}L / {performanceSummary.beCount}BE
              </p>
            </div>

            <div className="border border-app rounded-lg p-3.5 bg-app-main shadow-2xs space-y-1">
              <span className="text-[11px] font-semibold text-app-secondary uppercase tracking-wider">
                Journal Entries
              </span>
              <div className="text-2xl font-extrabold text-app-main tracking-tight font-mono">
                {journalEntries.length}
              </div>
              <p className="text-[11px] text-app-secondary">Logged reflections &amp; setups</p>
            </div>
          </div>

          {/* Action Callout Bar */}
          <div className="border border-emerald-500/30 rounded-lg p-4 sm:p-5 bg-emerald-50/40 dark:bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-app-main">
                Export Detailed Performance &amp; Journal Report
              </h3>
              <p className="text-xs text-app-secondary max-w-xl">
                Generate a clean, professional PDF containing discipline compliance, trade outcomes, timeframe alignments, and journal entries across any chosen time period.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsPeriodExportModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-theme hover:bg-emerald-700 text-white rounded transition-colors shadow-xs"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Export Period PDF</span>
              </button>
              {onNavigateToPerformance && (
                <button
                  type="button"
                  onClick={onNavigateToPerformance}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-app-main border border-app hover:bg-app-field text-app-main rounded transition-colors"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-theme" />
                  <span>Open Full Analytics</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Report Details Modal */}
      <ReportDetailsModal
        isOpen={Boolean(activeReportDetails)}
        onClose={handleCloseReportDetails}
        onViewModeChange={handleViewModeChange}
        report={activeReportDetails}
        onModify={(r) => {
          handleCloseReportDetails();
          onModifyReport(r);
        }}
        onCopy={(r) => {
          handleCloseReportDetails();
          onCopyReport(r);
        }}
        onDelete={(id) => {
          handleCloseReportDetails();
          onDeleteReport(id);
        }}
        onUpdateReport={async (updated) => {
          setActiveReportDetails(updated);
          if (onUpdateReport) {
            await onUpdateReport(updated);
          }
        }}
        initialTradeDraft={initialTradeDraft}
        onTradeDraftChange={onTradeDraftChange}
      />

      {/* Backup and Restore Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        onDataChanged={handleDataRefreshWithJournal}
      />

      {/* Combined Period Export Modal */}
      <PeriodExportModal
        isOpen={isPeriodExportModalOpen}
        onClose={() => setIsPeriodExportModalOpen(false)}
        reports={reports}
        journalEntries={journalEntries}
        userId={user?.id}
      />
    </div>
  );
};
