import React, { useMemo, useState, useEffect } from 'react';
import {
  Search,
  Download,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Database,
  Filter,
} from 'lucide-react';
import { SavedReport } from '../types/journal';
import {
  calculateOverallAlignment,
  generateReportsCsv,
  getReportBiasSummary,
} from '../utils/analysisUtils';
import { exportTextOrDownload } from '../utils/nativeExport';
import { ReportDetailsModal } from './ReportDetailsModal';
import { BackupModal } from './BackupModal';
import { SyncStatusBadge } from './SyncStatusBadge';
import { useAuth } from '../context/AuthContext';

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
}) => {
  const { user } = useAuth();
  const [selectedPair, setSelectedPair] = useState<string>(initialSession?.selectedPair || 'All');
  const [searchQuery, setSearchQuery] = useState(initialSession?.searchQuery || '');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeReportDetails, setActiveReportDetails] = useState<SavedReport | null>(null);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Restore activeReportDetails on mount from initialSession
  useEffect(() => {
    if (initialSession?.activeReportDetailsId && !activeReportDetails && reports.length > 0) {
      const found = reports.find((r) => r.id === initialSession.activeReportDetailsId);
      if (found) {
        setActiveReportDetails(found);
      }
    }
  }, [initialSession?.activeReportDetailsId, reports, activeReportDetails]);

  // Notify parent of reports UI session change
  useEffect(() => {
    onSessionChange?.({
      selectedPair,
      searchQuery,
      activeReportDetailsId: activeReportDetails?.id || null,
    });
  }, [selectedPair, searchQuery, activeReportDetails?.id, onSessionChange]);

  // Keep activeReportDetails in sync when reports array updates
  useEffect(() => {
    if (activeReportDetails) {
      const refreshed = reports.find((r) => r.id === activeReportDetails.id);
      if (refreshed) {
        setActiveReportDetails(refreshed);
      }
    }
  }, [reports]);

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
      {/* Top section: Heading, Pair filter, Search, Export CSV, Secondary backup/import */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6 pb-4 border-b border-app">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-app-main">
              Analysis Reports
            </h2>
            <SyncStatusBadge status={user ? 'synced' : 'local'} />
          </div>
          <p className="text-xs text-app-secondary mt-0.5">
            Archived journal records sorted by session date.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Pair filter */}
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

          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-app-secondary absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes, dates..."
              className="pl-8 pr-2.5 py-1.5 text-xs bg-app-field border border-app rounded text-app-main w-36 sm:w-44 focus:outline-hidden focus:border-emerald-600 focus:bg-app-main"
            />
          </div>

          {/* Export CSV */}
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

      {/* Active Filter Summary Bar */}
      {reports.length > 0 && (selectedPair !== 'All' || searchQuery.trim() !== '') && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 mb-4 bg-app-field border border-app rounded text-xs">
          <span className="text-app-main font-medium">
            Showing <strong className="text-emerald-theme">{filteredReports.length}</strong> of{' '}
            <strong className="text-app-main">{reports.length}</strong> total saved reports
            {selectedPair !== 'All' ? ` (Pair: ${selectedPair})` : ''}
            {searchQuery.trim() ? ` (Search: &ldquo;${searchQuery}&rdquo;)` : ''}
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
            Complete a multi-timeframe review in the Analysis tab and click &ldquo;Save Report&rdquo;.
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
                  {date}
                </div>

                {/* Compact full-width report cards beneath each date (not repeating analysis date inside) */}
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

                        {/* Actions: View Details, Modify, and quiet Delete */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setActiveReportDetails(r)}
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

                          {/* Quiet Delete */}
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

      {/* Report Details Modal */}
      <ReportDetailsModal
        isOpen={Boolean(activeReportDetails)}
        onClose={() => setActiveReportDetails(null)}
        report={activeReportDetails}
        onModify={(r) => {
          setActiveReportDetails(null);
          onModifyReport(r);
        }}
        onCopy={(r) => {
          setActiveReportDetails(null);
          onCopyReport(r);
        }}
        onDelete={(id) => {
          setActiveReportDetails(null);
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
        onDataChanged={onRefreshData}
      />
    </div>
  );
};
