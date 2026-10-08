import React, { useState } from 'react';
import { ArrowRight, RefreshCw, BookOpen, PlusCircle, CheckCircle2 } from 'lucide-react';
import { DISCIPLINE_QUOTES } from '../utils/analysisUtils';

interface HomeViewProps {
  onStartAnalysis: () => void;
  onContinueAnalysis: () => void;
  onViewReports: () => void;
  hasDraft: boolean;
  draftSummary?: {
    pair: string;
    date: string;
    time: string;
  } | null;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onStartAnalysis,
  onContinueAnalysis,
  onViewReports,
  hasDraft,
  draftSummary,
}) => {
  const [quoteIndex, setQuoteIndex] = useState(0);

  const nextQuote = () => {
    setQuoteIndex((prev) => (prev + 1) % DISCIPLINE_QUOTES.length);
  };

  const currentQuote = DISCIPLINE_QUOTES[quoteIndex];

  return (
    <div className="flex flex-col min-h-[calc(100vh-65px)] justify-between">
      <main className="max-w-[1100px] w-full mx-auto px-3.5 sm:px-6 pt-10 pb-16">
        <div className="max-w-2xl mx-auto text-center flex flex-col items-center">
          {/* Tagline kicker */}
          <div className="text-xs sm:text-sm font-semibold tracking-widest uppercase text-app-secondary mb-3">
            PRECISION <span className="mx-1.5 opacity-60">•</span> DISCIPLINE{' '}
            <span className="mx-1.5 opacity-60">•</span> REVIEW
          </div>

          {/* Headline */}
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-app-main mb-6 leading-tight">
            Trade with a <span className="text-emerald-theme">clearer framework.</span>
          </h1>

          {/* Value subtitle */}
          <p className="text-sm sm:text-base text-app-secondary max-w-lg mb-8 leading-relaxed">
            Multi-timeframe Smart Money alignment from Weekly down to 1-Minute. Document swing,
            internal, and fractal mechanics without noise or distractions.
          </p>

          {/* Rotating discipline quote */}
          <div className="w-full bg-app-secondary border border-app rounded-lg p-4 sm:p-5 mb-8 text-left relative transition-colors shadow-2xs">
            <div className="flex items-start justify-between gap-3">
              <blockquote className="text-sm italic text-app-main font-medium leading-relaxed pr-6">
                “{currentQuote.quote}”
              </blockquote>
              <button
                type="button"
                onClick={nextQuote}
                title="Next discipline quote"
                className="p-1 rounded text-app-secondary hover:text-emerald-theme hover:bg-app-field transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 text-xs font-semibold text-emerald-theme">
              — {currentQuote.author}
            </div>
          </div>

          {/* Action Buttons: Ordinary buttons sitting beside each other, wrapping on phones */}
          <div className="flex flex-wrap items-center justify-center gap-3 w-full sm:w-auto">
            {hasDraft && (
              <button
                type="button"
                onClick={onContinueAnalysis}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded-md shadow-xs transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                Continue Analysis
                {draftSummary && (
                  <span className="text-xs font-normal opacity-90 ml-1">
                    ({draftSummary.pair})
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onStartAnalysis}
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-md transition-all ${
                hasDraft
                  ? 'bg-app-field text-app-main border border-app hover:bg-slate-200 dark:hover:bg-slate-800'
                  : 'text-white bg-emerald-theme bg-emerald-theme-hover shadow-xs'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              Start Analysis
            </button>

            <button
              type="button"
              onClick={onViewReports}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-app-main bg-app-secondary border border-app hover:bg-app-field rounded-md transition-colors"
            >
              <BookOpen className="w-4 h-4 text-app-secondary" />
              View Reports
            </button>
          </div>

          {/* Small feature overview note */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full text-left pt-6 border-t border-app">
            <div className="p-3 rounded bg-app-secondary/60 border border-app">
              <div className="text-xs font-semibold text-emerald-theme uppercase tracking-wider mb-1">
                7 Timeframes
              </div>
              <p className="text-xs text-app-secondary leading-normal">
                Weekly down to 1M with Swing, Internal, and Fractal structure logging.
              </p>
            </div>
            <div className="p-3 rounded bg-app-secondary/60 border border-app">
              <div className="text-xs font-semibold text-emerald-theme uppercase tracking-wider mb-1">
                Local IndexedDB
              </div>
              <p className="text-xs text-app-secondary leading-normal">
                Private, persistent journal storage in your browser with offline chart screenshots.
              </p>
            </div>
            <div className="p-3 rounded bg-app-secondary/60 border border-app">
              <div className="text-xs font-semibold text-emerald-theme uppercase tracking-wider mb-1">
                Numeric Matching
              </div>
              <p className="text-xs text-app-secondary leading-normal">
                Auto-detect matching key structural price points across multiple timeframes.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Small footer as requested */}
      <footer className="border-t border-app py-4 text-center text-xs text-app-secondary bg-app-main">
        ABMAX ANALYSIS — Professional Trading Journal
      </footer>
    </div>
  );
};
