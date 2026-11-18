import React, { useState } from 'react';
import {
  X,
  FileText,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { PdfExportStyle } from '../services/pdfExport';

interface PdfStyleChooserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (style: PdfExportStyle) => Promise<void>;
  reportPair: string;
  reportDate: string;
}

interface StyleOption {
  id: PdfExportStyle;
  title: string;
  tagline: string;
  isDefault?: boolean;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    id: 'minimal',
    title: 'Minimal Journal',
    tagline: 'White background, clean typography, restrained black/slate headings, thin dividers.',
    isDefault: true,
  },
  {
    id: 'emerald',
    title: 'Emerald',
    tagline: 'White background, deep emerald headers, subtle tinted sections, and clear hierarchy.',
  },
  {
    id: 'dark',
    title: 'Dark Trading Desk',
    tagline: 'Charcoal background, readable light text, restrained accents, and trading-desk feel.',
  },
];

export const PdfStyleChooserModal: React.FC<PdfStyleChooserModalProps> = ({
  isOpen,
  onClose,
  onDownload,
  reportPair,
  reportDate,
}) => {
  // Minimal Journal is always selected by default
  const [selectedStyle, setSelectedStyle] = useState<PdfExportStyle>('minimal');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportError(null);
    try {
      await onDownload(selectedStyle);
      onClose();
    } catch (err) {
      console.error('[PdfStyleChooserModal] Export failed:', err);
      setExportError((err as Error).message || 'Failed to generate PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCancel = () => {
    if (isExporting) return;
    setExportError(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-chooser-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={handleCancel}
    >
      <div
        className="w-full max-w-md bg-app-main border border-app rounded-xl shadow-2xl overflow-hidden text-app-main flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app bg-app-secondary">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-emerald-theme shrink-0" />
            <div className="min-w-0">
              <h3
                id="pdf-chooser-title"
                className="font-bold text-xs text-app-main truncate"
              >
                Download PDF
              </h3>
              <p className="text-[10px] text-app-secondary truncate">
                {reportPair} Analysis • {reportDate}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isExporting}
            aria-label="Close"
            className="p-1 text-app-secondary hover:text-app-main rounded transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5 max-h-[75vh] overflow-y-auto">
          <p className="text-xs text-app-secondary leading-relaxed">
            Select a presentation style for your exported PDF. Every style includes identical content, notes, scenarios, trades, and compact charts.
          </p>

          {/* Style Option Cards */}
          <div className="space-y-2.5">
            {STYLE_OPTIONS.map((opt) => {
              const isSelected = selectedStyle === opt.id;
              return (
                <div
                  key={opt.id}
                  onClick={() => !isExporting && setSelectedStyle(opt.id)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer select-none flex items-start gap-3 ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-xs ring-1 ring-emerald-500/30'
                      : 'border-app bg-app-field hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {/* Style Preview Graphic */}
                  <div className="shrink-0 pt-0.5">
                    {opt.id === 'minimal' && (
                      <div className="w-12 h-14 bg-white rounded border border-slate-300 shadow-2xs p-1 flex flex-col justify-between">
                        <div className="space-y-0.5">
                          <div className="w-8 h-1 bg-slate-800 rounded-full" />
                          <div className="w-10 h-0.5 bg-slate-300 rounded-full" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="w-9 h-0.5 bg-slate-200 rounded-full" />
                          <div className="w-7 h-0.5 bg-slate-200 rounded-full" />
                        </div>
                        <div className="w-6 h-0.5 bg-slate-400 rounded-full" />
                      </div>
                    )}

                    {opt.id === 'emerald' && (
                      <div className="w-12 h-14 bg-white rounded border border-emerald-300 shadow-2xs p-1 flex flex-col justify-between">
                        <div className="space-y-0.5">
                          <div className="w-8 h-1 bg-emerald-700 rounded-full" />
                          <div className="w-10 h-0.5 bg-emerald-200 rounded-full" />
                        </div>
                        <div className="bg-emerald-50 rounded p-0.5 space-y-0.5">
                          <div className="w-7 h-0.5 bg-emerald-500 rounded-full" />
                          <div className="w-6 h-0.5 bg-emerald-300 rounded-full" />
                        </div>
                        <div className="w-5 h-0.5 bg-emerald-600 rounded-full" />
                      </div>
                    )}

                    {opt.id === 'dark' && (
                      <div className="w-12 h-14 bg-slate-900 rounded border border-slate-700 shadow-2xs p-1 flex flex-col justify-between">
                        <div className="space-y-0.5">
                          <div className="w-8 h-1 bg-sky-400 rounded-full" />
                          <div className="w-10 h-0.5 bg-slate-700 rounded-full" />
                        </div>
                        <div className="bg-slate-800 rounded p-0.5 space-y-0.5">
                          <div className="w-7 h-0.5 bg-emerald-400 rounded-full" />
                          <div className="w-6 h-0.5 bg-slate-600 rounded-full" />
                        </div>
                        <div className="w-6 h-0.5 bg-sky-300 rounded-full" />
                      </div>
                    )}
                  </div>

                  {/* Card Description */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs text-app-main">
                        {opt.title}
                      </span>
                      {opt.isDefault && (
                        <span className="px-1.5 py-0.2 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[9px] font-semibold rounded uppercase tracking-wider inline-flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5" />
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-app-secondary mt-1 leading-normal">
                      {opt.tagline}
                    </p>
                  </div>

                  {/* Selection Indicator */}
                  <div className="shrink-0 pt-0.5">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-app bg-app-main'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error Message */}
          {exportError && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Export Failed</div>
                <div className="text-[11px]">{exportError}</div>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="mt-1 text-[11px] font-bold text-emerald-theme hover:underline inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry Export</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-app bg-app-secondary/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isExporting}
            className="px-3.5 py-2 text-xs font-semibold text-app-secondary hover:text-app-main hover:bg-app-field rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-theme hover:bg-emerald-theme-hover rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Generating PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Download PDF</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
