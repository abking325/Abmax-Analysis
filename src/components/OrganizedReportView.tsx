import React, { useState } from 'react';
import {
  SavedReport,
  TimeframeId,
  SupplyDemandLevel,
} from '../types/journal';
import {
  calculateOverallAlignment,
  findMatchingValues,
  isDeepAnalysisAligned,
} from '../utils/analysisUtils';
import {
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from 'lucide-react';

interface OrganizedReportViewProps {
  report: SavedReport;
  imagesMap: Record<string, string>;
  onOpenViewer: (url: string, title: string) => void;
}

const TIMEFRAME_TITLE_MAP: Record<TimeframeId, string> = {
  Weekly: 'WEEKLY',
  Daily: 'DAILY',
  '4H': '4-HOUR',
  '1H': '1-HOUR',
  '15M': '15-MINUTE',
  '5M': '5-MINUTE',
  '1M': '1-MINUTE',
};

export const OrganizedReportView: React.FC<OrganizedReportViewProps> = ({
  report,
  imagesMap,
  onOpenViewer,
}) => {
  const [expandedCharts, setExpandedCharts] = useState<Record<TimeframeId, boolean>>({
    Weekly: false,
    Daily: false,
    '4H': false,
    '1H': false,
    '15M': false,
    '5M': false,
    '1M': false,
  });

  const toggleChart = (tf: TimeframeId) => {
    setExpandedCharts((prev) => ({ ...prev, [tf]: !prev[tf] }));
  };

  const alignment = calculateOverallAlignment(report.timeframes);
  const matchingValues = findMatchingValues(report.timeframes);

  // Helper: check if timeframe has any recorded detail
  const hasTimeframeDetail = (tf: TimeframeId) => {
    const d = report.timeframes[tf];
    if (!d) return false;
    const hasBias = Boolean(d.overallBias || d.biasSpecific);
    const hasSwing = Boolean(d.swing.direction || d.swing.high || d.swing.low || d.swing.bosAt);
    const hasInternal = Boolean(
      d.internal.direction || d.internal.high || d.internal.low || d.internal.ibosAt
    );
    const hasFractal = Boolean(d.fractal.direction || d.fractal.fractalBosAt);
    const hasNote = Boolean(d.note && d.note.trim());
    const hasChart = Boolean(d.chartImageId);
    const hasSD = (report.supplyDemandLevels || []).some((sd) => sd.timeframe === tf);
    return hasBias || hasSwing || hasInternal || hasFractal || hasNote || hasChart || hasSD;
  };

  // Render timeframe section
  const renderTimeframeSection = (tf: TimeframeId) => {
    const d = report.timeframes[tf];
    const tfTitle = TIMEFRAME_TITLE_MAP[tf];
    const recordedBias = d?.overallBias || '—';
    const isPopulated = d && hasTimeframeDetail(tf);

    // Deep alignment logic
    let deepAlignmentText: string | null = null;
    if (d && d.swing.direction && d.internal.direction && d.fractal.direction) {
      if (isDeepAnalysisAligned(d)) {
        deepAlignmentText = `Aligned (${d.swing.direction})`;
      } else {
        deepAlignmentText = 'Mixed / Divergent';
      }
    }

    // Supply/Demand assigned to this timeframe (including when editor visibility was off)
    const sdList: SupplyDemandLevel[] = (report.supplyDemandLevels || []).filter(
      (sd) => sd.timeframe === tf
    );

    const chartUrl = d?.chartImageId ? imagesMap[d.chartImageId] : undefined;
    const isChartExpanded = expandedCharts[tf];

    return (
      <section className="py-3.5 border-b border-slate-200 last:border-b-0 space-y-2 text-slate-800">
        {/* Bold Emerald Heading */}
        <h3 className="text-sm sm:text-base font-bold text-[#065f46] tracking-tight flex items-center justify-between">
          <span>
            {tfTitle} | <span className="font-semibold">{recordedBias}</span>
          </span>
        </h3>

        {!isPopulated ? (
          <p className="text-xs sm:text-[13px] text-slate-400 italic">No detail recorded</p>
        ) : (
          <div className="space-y-1.5 text-xs sm:text-[13px] leading-relaxed break-words">
            {/* 1. Bias */}
            <div>
              <span className="font-semibold text-slate-700">Bias:</span>{' '}
              <span>{d.biasSpecific?.trim() || d.overallBias || '—'}</span>
            </div>

            {/* 2. Swing */}
            <div>
              <span className="font-semibold text-slate-700">Swing:</span>{' '}
              <span>
                {d.swing.direction || '—'} | High {d.swing.high || '—'} | Low {d.swing.low || '—'} | BOS {d.swing.bosAt || '—'}
              </span>
            </div>

            {/* 3. Internal */}
            <div>
              <span className="font-semibold text-slate-700">Internal:</span>{' '}
              <span>
                {d.internal.direction || '—'} | High {d.internal.high || '—'} | Low {d.internal.low || '—'} | iBOS {d.internal.ibosAt || '—'}
              </span>
            </div>

            {/* 4. Fractal */}
            <div>
              <span className="font-semibold text-slate-700">Fractal:</span>{' '}
              <span>
                {d.fractal.direction || '—'} | BOS {d.fractal.fractalBosAt || '—'}
              </span>
            </div>

            {/* 5. Deep alignment (when applicable) */}
            {deepAlignmentText && (
              <div>
                <span className="font-semibold text-slate-700">Deep alignment:</span>{' '}
                <span className={deepAlignmentText.startsWith('Aligned') ? 'text-[#065f46] font-medium' : 'text-slate-600'}>
                  {deepAlignmentText}
                </span>
              </div>
            )}

            {/* 6. Supply / Demand */}
            <div>
              <span className="font-semibold text-slate-700">Supply / Demand:</span>{' '}
              {sdList.length > 0 ? (
                <div className="mt-0.5 space-y-0.5 pl-2 border-l border-slate-200">
                  {sdList.map((sd, i) => (
                    <div key={sd.id || i} className="text-xs text-slate-700">
                      Level {i + 1}: {sd.supply ? `Supply ${sd.supply}` : ''}
                      {sd.supply && sd.demand ? ' | ' : ''}
                      {sd.demand ? `Demand ${sd.demand}` : ''}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500">None recorded</span>
              )}
            </div>

            {/* 7. Note */}
            <div>
              <span className="font-semibold text-slate-700">Note:</span>{' '}
              {d.note?.trim() ? (
                <span className="text-slate-800 whitespace-pre-wrap">{d.note.trim()}</span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </div>

            {/* 8. Chart */}
            {chartUrl && (
              <div className="pt-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">Chart:</span>
                  <button
                    type="button"
                    onClick={() => toggleChart(tf)}
                    className="inline-flex items-center gap-1 text-xs text-[#065f46] hover:underline font-medium cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{isChartExpanded ? 'Collapse preview' : 'View chart preview'}</span>
                    {isChartExpanded ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenViewer(chartUrl, `${report.pair} — ${tfTitle} Chart`)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 transition-colors ml-1"
                    title="Open full resolution"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Full view</span>
                  </button>
                </div>

                {isChartExpanded && (
                  <div className="mt-2 p-1 bg-slate-50 border border-slate-200 rounded">
                    <img
                      src={chartUrl}
                      alt={`${tfTitle} chart screenshot`}
                      className="w-full max-h-56 object-contain rounded cursor-pointer hover:opacity-95"
                      onClick={() => onOpenViewer(chartUrl, `${report.pair} — ${tfTitle} Chart`)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <article
      className="organized-report-sheet bg-white text-slate-900 border border-slate-200 rounded-md shadow-xs p-5 sm:p-8 md:p-10 max-w-5xl mx-auto space-y-6"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }}
    >
      {/* ================= A. FULL-WIDTH DOCUMENT HEADER ================= */}
      <header className="space-y-2 border-b border-slate-200 pb-5">
        {/* Status and Provenance line */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span
              className={`font-semibold tracking-wide uppercase text-[11px] px-2 py-0.5 rounded ${
                report.status === 'Modified'
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-emerald-50 text-[#065f46] border border-emerald-200'
              }`}
            >
              {report.status === 'Modified' ? 'Modified Analysis' : 'Original Analysis'}
            </span>
            {report.copiedFromId && (
              <span className="text-slate-500 text-[11px]">· Copied entry ({report.copiedFromId})</span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            ID: {report.id}
          </div>
        </div>

        {/* Document Title: ABMAX | [PAIR] ANALYSIS */}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#065f46]">
          ABMAX | {report.pair} ANALYSIS
        </h1>

        {/* Compact metadata lines */}
        <div className="text-xs sm:text-sm text-slate-800 font-medium flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-mono">{report.date}</span>
          <span className="text-slate-300">•</span>
          <span>{report.session} Session</span>
          {report.time && (
            <>
              <span className="text-slate-300">•</span>
              <span className="font-mono">
                {report.time}
                {report.timezone ? ` (${report.timezone})` : ''}
              </span>
            </>
          )}
          <span className="text-slate-300">•</span>
          <span>Analysis Made: {report.analysisTiming || 'On time'}</span>
          <span className="text-slate-300">•</span>
          <span>
            Overall Alignment:{' '}
            <strong className="text-[#065f46] font-bold">{alignment.label}</strong>
          </span>
        </div>

        {/* Timestamps */}
        <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {report.createdAt && (
            <span>Created: {new Date(report.createdAt).toLocaleString()}</span>
          )}
          {report.updatedAt && (
            <>
              <span>·</span>
              <span>Last modified: {new Date(report.updatedAt).toLocaleString()}</span>
            </>
          )}
        </div>
      </header>

      {/* ================= B. THREE-COLUMN DOCUMENT BODY ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        {/* LEFT COLUMN: 1. External Liquidity, 2. Weekly, 3. Daily */}
        <div className="space-y-2 lg:pr-6 lg:border-r lg:border-slate-200">
          {/* 1. EXTERNAL LIQUIDITY */}
          <section className="pb-3.5 border-b border-slate-200 space-y-1.5">
            <h3 className="text-sm sm:text-base font-bold text-[#065f46] tracking-tight">
              EXTERNAL LIQUIDITY
            </h3>
            {report.crossedLiquidity && report.crossedLiquidity.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {report.crossedLiquidity.map((item) => (
                  <span
                    key={item}
                    className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800 rounded border border-slate-200"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs sm:text-[13px] text-slate-500 italic">None recorded</p>
            )}
          </section>

          {/* 2. WEEKLY */}
          {renderTimeframeSection('Weekly')}

          {/* 3. DAILY */}
          {renderTimeframeSection('Daily')}
        </div>

        {/* MIDDLE COLUMN: 4. 4-Hour, 5. 1-Hour, 6. 15-Minute */}
        <div className="space-y-2 lg:px-6 lg:border-r lg:border-slate-200">
          {/* 4. 4-HOUR */}
          {renderTimeframeSection('4H')}

          {/* 5. 1-HOUR */}
          {renderTimeframeSection('1H')}

          {/* 6. 15-MINUTE */}
          {renderTimeframeSection('15M')}
        </div>

        {/* RIGHT COLUMN: 7. 5-Minute, 8. 1-Minute, 9. Overall Notes */}
        <div className="space-y-2 lg:pl-6">
          {/* 7. 5-MINUTE */}
          {renderTimeframeSection('5M')}

          {/* 8. 1-MINUTE */}
          {renderTimeframeSection('1M')}

          {/* 9. OVERALL NOTES */}
          <section className="py-3.5 border-b border-slate-200 last:border-b-0 space-y-2 text-slate-800">
            <h3 className="text-sm sm:text-base font-bold text-[#065f46] tracking-tight">
              OVERALL NOTES
            </h3>
            {report.overallNotes && report.overallNotes.trim() ? (
              <p className="text-xs sm:text-[13px] text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
                {report.overallNotes.trim()}
              </p>
            ) : (
              <p className="text-xs sm:text-[13px] text-slate-500 italic">None recorded</p>
            )}
          </section>
        </div>
      </div>

      {/* ================= E. FULL-WIDTH ENDING ================= */}
      <footer className="pt-6 border-t border-slate-200 space-y-4">
        {/* Matching Values */}
        <div className="space-y-2">
          <h3 className="text-sm sm:text-base font-bold text-[#065f46] tracking-tight">
            MATCHING VALUES
          </h3>
          {matchingValues.length > 0 ? (
            <div className="space-y-1.5 text-xs sm:text-[13px] text-slate-800">
              {matchingValues.map((group) => (
                <div key={group.normalizedPrice} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-semibold font-mono text-[#065f46]">
                    {group.displayPrice}:
                  </span>
                  <span className="text-slate-600">
                    {group.occurrences
                      .map((occ) => `${occ.timeframe} ${occ.field}`)
                      .join(', ')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs sm:text-[13px] text-slate-500 italic">None detected</p>
          )}
        </div>

        {/* Document Footer */}
        <div className="pt-4 border-t border-slate-200 text-center text-xs text-slate-500">
          ABMAX ANALYSIS — Trading Journal
        </div>
      </footer>
    </article>
  );
};
