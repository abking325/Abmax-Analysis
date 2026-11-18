import React, { useState } from 'react';
import {
  X,
  Download,
  Calendar,
  Layers,
  FileText,
  BookOpen,
  TrendingUp,
  Image as ImageIcon,
  Check,
  CheckCircle2,
} from 'lucide-react';
import { JournalEntry, SavedReport } from '../types/journal';
import { PdfExportStyle } from '../services/pdfExport';
import { exportPeriodReport } from '../services/periodExport';

interface PeriodExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reports: SavedReport[];
  journalEntries: JournalEntry[];
  userId?: string | null;
}

export const PeriodExportModal: React.FC<PeriodExportModalProps> = ({
  isOpen,
  onClose,
  reports,
  journalEntries,
  userId,
}) => {
  const [periodPreset, setPeriodPreset] = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    return monday.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [mode, setMode] = useState<'summary' | 'full'>('summary');
  const [includeAnalyses, setIncludeAnalyses] = useState(true);
  const [includeTrades, setIncludeTrades] = useState(true);
  const [includeJournal, setIncludeJournal] = useState(true);
  const [includeMyJournalNotes, setIncludeMyJournalNotes] = useState(false);
  const [includePerformance, setIncludePerformance] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);
  const [style, setStyle] = useState<PdfExportStyle>('minimal');
  const [exporting, setExporting] = useState(false);

  if (!isOpen) return null;

  const handlePresetChange = (preset: 'today' | 'week' | 'month' | 'custom') => {
    setPeriodPreset(preset);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'week') {
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diff));
      setStartDate(monday.toISOString().slice(0, 10));
      setEndDate(todayStr);
    } else if (preset === 'month') {
      setStartDate(`${today.toISOString().slice(0, 7)}-01`);
      setEndDate(todayStr);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const label =
        startDate === endDate
          ? startDate
          : `${startDate} to ${endDate}`;

      await exportPeriodReport({
        startDate,
        endDate,
        periodLabel: label,
        mode,
        includeAnalyses,
        includeTrades,
        includeJournal,
        includeMyJournalNotes,
        includePerformance,
        includeImages,
        style,
        reports,
        journalEntries,
        userId,
      });
      onClose();
    } catch (err) {
      console.error('Failed to export period report', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Download Period Report"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col text-xs text-app-main"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app bg-app-secondary/60">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Download className="w-4 h-4 text-emerald-theme" />
            <span>Download Combined Period Report</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-app-secondary hover:text-app-main"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Period Selection */}
          <div className="space-y-2">
            <label className="font-bold text-xs uppercase tracking-wider text-app-secondary block">
              Reporting Period
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 rounded-lg bg-app-field border border-app">
              <button
                type="button"
                onClick={() => handlePresetChange('today')}
                className={`py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  periodPreset === 'today'
                    ? 'bg-app-main text-emerald-theme shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('week')}
                className={`py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  periodPreset === 'week'
                    ? 'bg-app-main text-emerald-theme shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('month')}
                className={`py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  periodPreset === 'month'
                    ? 'bg-app-main text-emerald-theme shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('custom')}
                className={`py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  periodPreset === 'custom'
                    ? 'bg-app-main text-emerald-theme shadow-2xs'
                    : 'text-app-secondary hover:text-app-main'
                }`}
              >
                Custom
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-[10px] text-app-secondary block mb-0.5">Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPeriodPreset('custom');
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-app-secondary block mb-0.5">End Date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPeriodPreset('custom');
                  }}
                  className="w-full px-2.5 py-1.5 rounded border border-app bg-app-field text-app-main text-xs"
                />
              </div>
            </div>
          </div>

          {/* Mode: Summary vs Full Detail */}
          <div className="space-y-1.5">
            <label className="font-bold text-xs uppercase tracking-wider text-app-secondary block">
              Report Detail Level
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('summary')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  mode === 'summary'
                    ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20'
                    : 'border-app bg-app-field'
                }`}
              >
                <div className="font-bold text-app-main">Executive Summary</div>
                <div className="text-[11px] text-app-secondary mt-0.5">
                  High-level activity metrics, discipline rates, and key reflection commitments.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('full')}
                className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  mode === 'full'
                    ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20'
                    : 'border-app bg-app-field'
                }`}
              >
                <div className="font-bold text-app-main">Full Detail Record</div>
                <div className="text-[11px] text-app-secondary mt-0.5">
                  Includes full analysis notes, all executed trades, and detailed journal reviews.
                </div>
              </button>
            </div>
          </div>

          {/* Inclusions */}
          <div className="space-y-1.5">
            <label className="font-bold text-xs uppercase tracking-wider text-app-secondary block">
              Include In Export
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 rounded bg-app-field border border-app cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePerformance}
                  onChange={(e) => setIncludePerformance(e.target.checked)}
                  className="rounded text-emerald-theme focus:ring-emerald-500"
                />
                <span className="font-medium">Performance Metrics</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded bg-app-field border border-app cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAnalyses}
                  onChange={(e) => setIncludeAnalyses(e.target.checked)}
                  className="rounded text-emerald-theme focus:ring-emerald-500"
                />
                <span className="font-medium">Market Analyses</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded bg-app-field border border-app cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTrades}
                  onChange={(e) => setIncludeTrades(e.target.checked)}
                  className="rounded text-emerald-theme focus:ring-emerald-500"
                />
                <span className="font-medium">Recorded Trades</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded bg-app-field border border-app cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeJournal}
                  onChange={(e) => setIncludeJournal(e.target.checked)}
                  className="rounded text-emerald-theme focus:ring-emerald-500"
                />
                <span className="font-medium">Journal Reflections</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded bg-app-field border border-app cursor-pointer col-span-2">
                <input
                  type="checkbox"
                  checked={includeMyJournalNotes}
                  onChange={(e) => setIncludeMyJournalNotes(e.target.checked)}
                  className="rounded text-emerald-theme focus:ring-emerald-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">My Journal Notes</span>
                  <span className="text-[10px] text-app-secondary">(Private reflections — Default OFF)</span>
                </div>
              </label>
            </div>
          </div>

          {/* Style Selection */}
          <div className="space-y-1.5">
            <label className="font-bold text-xs uppercase tracking-wider text-app-secondary block">
              PDF Visual Style
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStyle('minimal')}
                className={`p-2.5 rounded-lg border text-center transition-colors cursor-pointer ${
                  style === 'minimal'
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-theme font-bold'
                    : 'border-app bg-app-field text-app-secondary hover:text-app-main'
                }`}
              >
                <div>Minimal Journal</div>
                <div className="text-[10px] text-app-secondary mt-0.5">(Default)</div>
              </button>

              <button
                type="button"
                onClick={() => setStyle('emerald')}
                className={`p-2.5 rounded-lg border text-center transition-colors cursor-pointer ${
                  style === 'emerald'
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-theme font-bold'
                    : 'border-app bg-app-field text-app-secondary hover:text-app-main'
                }`}
              >
                <div>Emerald</div>
                <div className="text-[10px] text-app-secondary mt-0.5">Forest Accents</div>
              </button>

              <button
                type="button"
                onClick={() => setStyle('dark')}
                className={`p-2.5 rounded-lg border text-center transition-colors cursor-pointer ${
                  style === 'dark'
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-theme font-bold'
                    : 'border-app bg-app-field text-app-secondary hover:text-app-main'
                }`}
              >
                <div>Dark Desk</div>
                <div className="text-[10px] text-app-secondary mt-0.5">Dark Canvas</div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-app bg-app-secondary/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 font-semibold text-app-secondary hover:text-app-main"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-white bg-emerald-theme hover:bg-emerald-theme-hover shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{exporting ? 'Generating PDF...' : 'Download Period Report'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
