import React, { useState } from 'react';
import {
  SavedReport,
  TimeframeId,
  TIMEFRAME_ORDER,
} from '../types/journal';
import {
  calculateOverallAlignment,
  findMatchingValues,
  isDeepAnalysisAligned,
} from '../utils/analysisUtils';
import {
  Image as ImageIcon,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from 'lucide-react';

interface OrganizedReportViewProps {
  report: SavedReport;
  imagesMap?: Record<string, string>;
  onOpenViewer?: (url: string, title: string) => void;
}

const TIMEFRAME_DISPLAY_NAMES: Record<TimeframeId, string> = {
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
  imagesMap = {},
  onOpenViewer,
}) => {
  const [expandedCharts, setExpandedCharts] = useState<Record<string, boolean>>({});

  const toggleChart = (tf: TimeframeId) => {
    setExpandedCharts((prev) => ({ ...prev, [tf]: !prev[tf] }));
  };

  const overallAlign = calculateOverallAlignment(report.timeframes);
  const deepAlignedCount = TIMEFRAME_ORDER.filter(
    (tf) => report.timeframes[tf] && isDeepAnalysisAligned(report.timeframes[tf])
  ).length;
  const isAllDeepAligned = deepAlignedCount === 7;
  const matchingValues = findMatchingValues(report.timeframes);

  // Groupings for the 3 balanced columns on desktop (while DOM matches mobile order or column groups)
  const leftTfs: TimeframeId[] = ['Weekly', 'Daily'];
  const midTfs: TimeframeId[] = ['4H', '1H', '15M'];
  const rightTfs: TimeframeId[] = ['5M', '1M'];

  const getBiasBadgeClass = (bias: string) => {
    if (bias === 'Bullish') {
      return 'bg-emerald-50 text-emerald-800 border-emerald-300';
    }
    if (bias === 'Bearish') {
      return 'bg-rose-50 text-rose-800 border-rose-300';
    }
    if (bias === 'Neutral') {
      return 'bg-slate-100 text-slate-700 border-slate-300';
    }
    if (bias === 'Not sure') {
      return 'bg-amber-50 text-amber-800 border-amber-300';
    }
    return 'bg-gray-100 text-gray-600 border-gray-200';
  };

  const renderTimeframeSection = (tfId: TimeframeId) => {
    const tf = report.timeframes[tfId];
    const label = TIMEFRAME_DISPLAY_NAMES[tfId];

    if (!tf) {
      return (
        <section key={tfId} className="py-4 border-b border-gray-200">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h3 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
              {label} <span className="text-gray-400 font-normal">| —</span>
            </h3>
          </div>
          <p className="text-[11px] text-gray-400 italic">No detail recorded</p>
        </section>
      );
    }

    const imgId = tf.chartImageId;
    const chartUrl = imgId ? imagesMap[imgId] : null;

    const tfSdLevels = (report.supplyDemandLevels || []).filter(
      (sd) => sd.timeframe === tfId
    );

    const hasInterpretation = Boolean(tf.biasSpecific && tf.biasSpecific.trim());
    const hasSwing = Boolean(
      tf.swing.direction ||
      tf.swing.high?.trim() ||
      tf.swing.low?.trim() ||
      tf.swing.bosAt?.trim()
    );
    const hasInternal = Boolean(
      tf.internal.direction ||
      tf.internal.high?.trim() ||
      tf.internal.low?.trim() ||
      tf.internal.ibosAt?.trim()
    );
    const hasFractal = Boolean(
      tf.fractal.direction ||
      tf.fractal.fractalBosAt?.trim()
    );
    const hasSd = tfSdLevels.length > 0;
    const hasNote = Boolean(tf.note && tf.note.trim());
    const hasChart = Boolean(chartUrl);

    const hasAnyDetail =
      Boolean(tf.overallBias) ||
      hasInterpretation ||
      hasSwing ||
      hasInternal ||
      hasFractal ||
      hasSd ||
      hasNote ||
      hasChart;

    return (
      <section
        key={tfId}
        className="py-3.5 border-b border-gray-200 last:border-b-0 space-y-2"
      >
        {/* Section Header: [TIMEFRAME] | [recorded overall bias] */}
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
            {label}{' '}
            <span className="font-normal text-gray-700">
              | {tf.overallBias || '—'}
            </span>
          </h3>
          {tf.overallBias && (
            <span
              className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wider ${getBiasBadgeClass(
                tf.overallBias
              )}`}
            >
              {tf.overallBias}
            </span>
          )}
        </div>

        {!hasAnyDetail ? (
          <p className="text-[11px] text-gray-400 italic">No detail recorded</p>
        ) : (
          <div className="space-y-2 text-[11px] leading-relaxed text-gray-700">
            {/* Overall Interpretation */}
            {hasInterpretation && (
              <div className="bg-gray-50/70 p-2 rounded border border-gray-200/70">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-500 block mb-0.5">
                  Overall Interpretation
                </span>
                <p className="text-gray-900 whitespace-pre-wrap">{tf.biasSpecific}</p>
              </div>
            )}

            {/* Core Structures Grid */}
            {(hasSwing || hasInternal || hasFractal) && (
              <div className="space-y-1.5 bg-gray-50/50 p-2 rounded border border-gray-100 font-mono text-[10px]">
                {/* Swing */}
                {hasSwing && (
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-sans font-bold text-gray-600 text-[10px] tracking-wider uppercase">
                      SWING:
                    </span>
                    <span
                      className={`font-semibold ${
                        tf.swing.direction === 'Bullish'
                          ? 'text-emerald-700'
                          : tf.swing.direction === 'Bearish'
                          ? 'text-rose-700'
                          : 'text-gray-700'
                      }`}
                    >
                      {tf.swing.direction || '—'}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">High: {tf.swing.high || '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">Low: {tf.swing.low || '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">BOS: {tf.swing.bosAt || '—'}</span>
                  </div>
                )}

                {/* Internal */}
                {hasInternal && (
                  <div className="flex flex-wrap items-baseline gap-x-1.5 pt-1 border-t border-gray-100">
                    <span className="font-sans font-bold text-gray-600 text-[10px] tracking-wider uppercase">
                      INTERNAL:
                    </span>
                    <span
                      className={`font-semibold ${
                        tf.internal.direction === 'Bullish'
                          ? 'text-emerald-700'
                          : tf.internal.direction === 'Bearish'
                          ? 'text-rose-700'
                          : 'text-gray-700'
                      }`}
                    >
                      {tf.internal.direction || '—'}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">High: {tf.internal.high || '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">Low: {tf.internal.low || '—'}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">iBOS: {tf.internal.ibosAt || '—'}</span>
                  </div>
                )}

                {/* Fractal */}
                {hasFractal && (
                  <div className="flex flex-wrap items-baseline gap-x-1.5 pt-1 border-t border-gray-100">
                    <span className="font-sans font-bold text-gray-600 text-[10px] tracking-wider uppercase">
                      FRACTAL:
                    </span>
                    <span
                      className={`font-semibold ${
                        tf.fractal.direction === 'Bullish'
                          ? 'text-emerald-700'
                          : tf.fractal.direction === 'Bearish'
                          ? 'text-rose-700'
                          : 'text-gray-700'
                      }`}
                    >
                      {tf.fractal.direction || '—'}
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-700">
                      BOS: {tf.fractal.fractalBosAt || '—'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Supply & Demand Levels */}
            {hasSd && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 block mb-0.5">
                  Supply &amp; Demand
                </span>
                <div className="space-y-1">
                  {tfSdLevels.map((sd) => (
                    <div
                      key={sd.id}
                      className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] bg-gray-50/70 px-2 py-1 rounded border border-gray-100"
                    >
                      <span className="text-rose-800">
                        Supply: {sd.supply?.trim() || '—'}
                      </span>
                      <span className="text-gray-300">·</span>
                      <span className="text-emerald-800">
                        Demand: {sd.demand?.trim() || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Note */}
            {hasNote && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 block mb-0.5">
                  {tfId === 'Weekly' ? 'Weekly Note' : `${tfId} Note`}
                </span>
                <p className="text-gray-800 whitespace-pre-wrap break-words bg-gray-50/70 p-2 rounded border border-gray-100 font-sans text-[11px]">
                  {tf.note}
                </p>
              </div>
            )}

            {/* Attached Chart (expandable preserving aspect ratio) */}
            {chartUrl && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => toggleChart(tfId)}
                  className="flex items-center justify-between w-full text-[10px] font-semibold text-emerald-800 bg-emerald-50/70 hover:bg-emerald-100/70 px-2 py-1.5 rounded border border-emerald-200 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="w-3 h-3 text-emerald-700" />
                    Attached Chart ({label})
                  </span>
                  {expandedCharts[tfId] ? (
                    <ChevronUp className="w-3.5 h-3.5 text-emerald-700" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-emerald-700" />
                  )}
                </button>
                {expandedCharts[tfId] && (
                  <div className="mt-2 p-2 bg-gray-50 rounded border border-gray-200 space-y-1.5">
                    <img
                      src={chartUrl}
                      alt={`${report.pair} ${tfId} chart screenshot`}
                      className="w-full max-h-72 object-contain rounded bg-white border border-gray-200 cursor-pointer"
                      onClick={() =>
                        onOpenViewer?.(
                          chartUrl,
                          `${report.pair} - ${label} Chart Attachment`
                        )
                      }
                    />
                    {onOpenViewer && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenViewer(
                            chartUrl,
                            `${report.pair} - ${label} Chart Attachment`
                          )
                        }
                        className="inline-flex items-center gap-1 text-[10px] text-emerald-800 hover:underline font-medium"
                      >
                        <Maximize2 className="w-3 h-3" />
                        Open fullscreen
                      </button>
                    )}
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
      id="organized-report-sheet"
      className="bg-white text-gray-900 border border-gray-300 rounded-lg shadow-sm p-5 sm:p-7 lg:p-9 max-w-5xl mx-auto font-sans"
    >
      {/* A. Full-Width Document Header */}
      <header className="border-b border-gray-300 pb-4 mb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-900 uppercase">
            ABMAX | {report.pair || 'UNSPECIFIED'} ANALYSIS
          </h1>

          {/* Original / Modified status & provenance */}
          <div className="flex items-center gap-2 text-[10px]">
            {report.status === 'Modified' || report.isModified ? (
              <span className="px-2 py-0.5 rounded font-medium bg-amber-50 text-amber-800 border border-amber-300">
                Modified
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-700 border border-gray-200">
                Original
              </span>
            )}
            {report.copiedFromId && (
              <span className="text-gray-400 italic">
                Copy of {report.copiedFromId.slice(0, 8)}
              </span>
            )}
          </div>
        </div>

        {/* Compact metadata lines */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600 pt-2 border-t border-gray-100">
          <div>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-semibold">
              Analysis Date
            </span>
            <span className="font-medium text-gray-900">
              {report.date || 'Not specified'}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-semibold">
              Session
            </span>
            <span className="font-medium text-gray-900">
              {report.session || 'Not specified'}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-semibold">
              Analysis Time
            </span>
            <span className="font-medium text-gray-900">
              {report.time
                ? `${report.time}${report.timezone ? ` (${report.timezone})` : ''}`
                : '—'}
            </span>
          </div>

          <div>
            <span className="text-[9px] uppercase tracking-wider text-gray-400 block font-semibold">
              Timing Made
            </span>
            <span className="font-medium text-gray-900">
              {report.analysisTiming || '—'}
            </span>
          </div>
        </div>

        {/* Timeframe Alignment strip */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 p-2 bg-emerald-50/70 rounded border border-emerald-200 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">
              Timeframe Alignment:
            </span>
            <span
              className={`font-semibold ${
                overallAlign.status === 'ALIGNED'
                  ? overallAlign.bias === 'Bullish'
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                  : 'text-amber-700'
              }`}
            >
              {overallAlign.label}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            {isAllDeepAligned ? (
              <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                Deep Analysis Aligned
              </span>
            ) : (
              <span className="text-gray-500">
                Deep: {deepAlignedCount > 0 ? `${deepAlignedCount}/7 Aligned` : 'Mixed / Transition'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* B. Three-Column Document Body on Desktop (1 column on mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-start">
        {/* LEFT COLUMN: 1. External Liquidity, 2. Weekly, 3. Daily */}
        <div className="space-y-3 md:border-r md:border-gray-200 md:pr-6 lg:pr-8">
          {/* 1. External Liquidity */}
          <section className="pb-3.5 border-b border-gray-200 space-y-2">
            <h2 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
              1. EXTERNAL LIQUIDITY
            </h2>

            {report.crossedLiquidity && report.crossedLiquidity.length > 0 ? (
              <div className="space-y-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 block">
                  Liquidity Crossed
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {report.crossedLiquidity.map((liq) => (
                    <span
                      key={liq}
                      className="font-medium text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[10px]"
                    >
                      {liq}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 italic">No crossed liquidity recorded</p>
            )}
          </section>

          {/* 2. Weekly & 3. Daily */}
          {leftTfs.map((tfId) => renderTimeframeSection(tfId))}
        </div>

        {/* MIDDLE COLUMN: 4. 4-Hour, 5. 1-Hour, 6. 15-Minute */}
        <div className="space-y-3 md:border-r md:border-gray-200 md:pr-6 lg:pr-8">
          {midTfs.map((tfId) => renderTimeframeSection(tfId))}
        </div>

        {/* RIGHT COLUMN: 7. 5-Minute, 8. 1-Minute, 9. Overall Notes */}
        <div className="space-y-3">
          {rightTfs.map((tfId) => renderTimeframeSection(tfId))}

          {/* 9. Overall Notes */}
          <section className="pt-2 space-y-1.5">
            <h2 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
              OVERALL NOTES
            </h2>
            {report.overallNotes?.trim() ? (
              <p className="text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap break-words bg-gray-50/70 p-2.5 rounded border border-gray-200 font-sans">
                {report.overallNotes}
              </p>
            ) : (
              <p className="text-[11px] text-gray-400 italic">No notes recorded</p>
            )}
          </section>
        </div>
      </div>

      {/* PLANNED SCENARIOS SECTION (Appended below analysis content) */}
      <section className="mt-8 pt-6 border-t-2 border-emerald-800/20 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
            PLANNED SCENARIOS
          </h2>
          {report.scenarios && report.scenarios.length > 0 && (
            <span className="text-[10px] text-gray-500 font-medium">
              {report.scenarios.length} {report.scenarios.length === 1 ? 'scenario' : 'scenarios'} recorded
            </span>
          )}
        </div>

        {report.scenarios && report.scenarios.length > 0 ? (
          <div className="space-y-3">
            {report.scenarios.map((sc, idx) => (
              <div
                key={sc.id || idx}
                className="bg-gray-50/70 p-3 rounded border border-gray-200 space-y-2 text-[11px] leading-relaxed"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap pb-1.5 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">
                      {sc.label || `Scenario ${idx + 1}`}
                    </span>
                    {sc.strategy && (
                      <span className="text-gray-600 font-medium">— {sc.strategy}</span>
                    )}
                  </div>
                  {sc.direction && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                        sc.direction === 'Buy'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : 'bg-rose-50 text-rose-800 border-rose-300'
                      }`}
                    >
                      {sc.direction}
                    </span>
                  )}
                </div>

                {sc.description && (
                  <div>
                    <span className="font-bold text-gray-700">Description: </span>
                    <span className="text-gray-800 whitespace-pre-wrap">{sc.description}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  {sc.entryConditions && (
                    <div className="bg-white/80 p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-0.5">
                        Entry Conditions / Rules:
                      </span>
                      <span className="text-gray-800 whitespace-pre-wrap">
                        {sc.entryConditions}
                      </span>
                    </div>
                  )}
                  {sc.invalidationConditions && (
                    <div className="bg-white/80 p-2 rounded border border-gray-200">
                      <span className="font-bold text-rose-800 block mb-0.5">
                        Invalidation Conditions:
                      </span>
                      <span className="text-gray-800 whitespace-pre-wrap">
                        {sc.invalidationConditions}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 italic">No scenarios recorded.</p>
        )}
      </section>

      {/* TRADES TAKEN SECTION (Appended below Planned Scenarios) */}
      <section className="mt-6 pt-5 border-t border-gray-200 space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold tracking-wider text-emerald-800 uppercase">
            TRADES TAKEN
          </h2>
          {report.trades && report.trades.length > 0 && (
            <span className="text-[10px] text-gray-500 font-medium">
              {report.trades.length} {report.trades.length === 1 ? 'trade' : 'trades'} logged
            </span>
          )}
        </div>

        {report.trades && report.trades.length > 0 ? (
          <div className="space-y-2.5">
            {report.trades.map((trd, idx) => (
              <div
                key={trd.id || idx}
                className="bg-gray-50/70 p-3 rounded border border-gray-200 space-y-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                        trd.direction === 'Buy'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : 'bg-rose-50 text-rose-800 border-rose-300'
                      }`}
                    >
                      {trd.direction}
                    </span>
                    <span className="font-bold text-gray-900">
                      {trd.scenarioLabel || 'Planned Execution'}
                    </span>
                    {trd.timeframeTaken && (
                      <span className="text-gray-500 font-mono text-[10px]">
                        [{trd.timeframeTaken}]
                      </span>
                    )}
                    {trd.session && (
                      <span className="text-gray-500 text-[10px]">{trd.session}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {trd.outcome && (
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${
                          trd.outcome === 'Win'
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
                            : trd.outcome === 'Loss'
                            ? 'bg-rose-100 text-rose-900 border-rose-400'
                            : 'bg-gray-100 text-gray-800 border-gray-300'
                        }`}
                      >
                        {trd.outcome}
                      </span>
                    )}
                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${
                        trd.rulesFollowed !== false
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      {trd.rulesFollowed !== false ? 'Rules Followed' : 'Rules Broken'}
                    </span>
                  </div>
                </div>

                {/* Price parameters */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-gray-700 bg-white/70 p-2 rounded border border-gray-200">
                  {trd.entryPrice && (
                    <span>
                      Entry: <strong className="text-gray-900">{trd.entryPrice}</strong>
                    </span>
                  )}
                  {trd.stopLoss && (
                    <span>
                      SL: <strong className="text-rose-700">{trd.stopLoss}</strong>
                    </span>
                  )}
                  {trd.takeProfit && (
                    <span>
                      TP: <strong className="text-emerald-700">{trd.takeProfit}</strong>
                    </span>
                  )}
                  {trd.exitPrice && (
                    <span>
                      Exit: <strong className="text-gray-900">{trd.exitPrice}</strong>
                    </span>
                  )}
                  {trd.riskReward && (
                    <span>
                      R:R: <strong className="text-gray-900">{trd.riskReward}</strong>
                    </span>
                  )}
                </div>

                {trd.notes && (
                  <div className="text-gray-700 whitespace-pre-wrap italic pt-0.5">
                    &ldquo;{trd.notes}&rdquo;
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 italic">No trades recorded.</p>
        )}
      </section>

      {/* D. Document Footer & Cross-Timeframe Confluence */}
      <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-600">
        {/* Confluent Structural Price Points */}
        {matchingValues.length > 0 && (
          <div className="mb-4 p-3 bg-emerald-50/40 rounded-lg border border-emerald-200">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block mb-1">
              Confluent Structural Price Points ({matchingValues.length})
            </span>
            <div className="flex flex-wrap gap-2 text-[10px] font-mono">
              {matchingValues.map((group, idx) => (
                <span
                  key={idx}
                  className="bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-200"
                >
                  <strong className="font-bold">{group.displayPrice}</strong>
                  <span className="text-gray-500 ml-1">
                    ({group.occurrences.map((o) => `${o.timeframe} ${o.field}`).join(', ')})
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-400">
          <div>
            <span>Created: {new Date(report.createdAt).toLocaleString()}</span>
            {report.updatedAt !== report.createdAt && (
              <span className="ml-2">
                | Updated: {new Date(report.updatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div>
            <span>Report ID: {report.id}</span>
          </div>
        </div>
      </footer>
    </article>
  );
};
