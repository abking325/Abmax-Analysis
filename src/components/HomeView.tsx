import React, { useState } from 'react';
import { RefreshCw, BookOpen, PlusCircle, CheckCircle2 } from 'lucide-react';
import { DISCIPLINE_QUOTES, DisciplineQuote, getShuffledQuotes } from '../utils/analysisUtils';
import { HeroVisual } from './HeroVisual';

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
  const [quoteList, setQuoteList] = useState<DisciplineQuote[]>(() => getShuffledQuotes());
  const [quoteIndex, setQuoteIndex] = useState(0);

  const nextQuote = () => {
    setQuoteIndex((prev) => {
      const nextIdx = prev + 1;
      if (nextIdx >= quoteList.length) {
        // Reshuffle when reaching the end, ensuring no immediate repeat with the last shown author
        const lastAuthor = quoteList[prev]?.author;
        let freshShuffled = getShuffledQuotes();
        if (freshShuffled[0]?.author === lastAuthor && freshShuffled.length > 1) {
          const swapIdx = freshShuffled.findIndex((q) => q.author !== lastAuthor);
          if (swapIdx > 0) {
            [freshShuffled[0], freshShuffled[swapIdx]] = [freshShuffled[swapIdx], freshShuffled[0]];
          }
        }
        setQuoteList(freshShuffled);
        return 0;
      }
      return nextIdx;
    });
  };

  const currentQuote = quoteList[quoteIndex] || DISCIPLINE_QUOTES[0];

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between w-full h-full">
      <main className="max-w-[1100px] w-full mx-auto px-4 sm:px-6 py-2 sm:py-4 flex-1 flex flex-col items-center justify-center">
        <div className="max-w-2xl w-full mx-auto text-center flex flex-col items-center my-auto">
          {/* Tagline kicker */}
          <div className="text-[11px] sm:text-xs font-semibold tracking-widest uppercase text-app-secondary mb-1.5 sm:mb-2">
            PRECISION <span className="mx-1.5 opacity-60">•</span> DISCIPLINE{' '}
            <span className="mx-1.5 opacity-60">•</span> REVIEW
          </div>

          {/* Headline */}
          <h1 className="text-2xl xs:text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-app-main leading-tight mb-1 sm:mb-2">
            Trade with a <span className="text-emerald-theme">clearer framework.</span>
          </h1>

          {/* Polished Hero Illustration with subtle 3D / isometric depth */}
          <HeroVisual />

          {/* Rotating discipline quote */}
          <div className="w-full max-w-xl bg-app-secondary border border-app rounded-lg p-3 sm:p-4 my-2 sm:my-3 text-left relative transition-colors shadow-2xs">
            <div className="flex items-start justify-between gap-3">
              <blockquote className="text-sm sm:text-base font-bold text-app-main leading-snug sm:leading-relaxed pr-6 tracking-tight">
                “{currentQuote.quote}”
              </blockquote>
              <button
                type="button"
                onClick={nextQuote}
                title="Next random quote"
                aria-label="Show next random quote"
                className="p-1.5 rounded text-app-secondary hover:text-emerald-theme hover:bg-app-field transition-colors shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-2 text-xs font-semibold text-emerald-theme flex items-center flex-wrap gap-x-2 gap-y-0.5">
              <span>— {currentQuote.author}</span>
              {currentQuote.reference && (
                <>
                  <span className="text-app-secondary opacity-60">•</span>
                  <span className="text-app-secondary font-medium italic">
                    {currentQuote.reference}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons: Ordinary buttons sitting beside each other, wrapping on phones */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 w-full sm:w-auto mt-1 sm:mt-2">
            {hasDraft && (
              <button
                type="button"
                onClick={onContinueAnalysis}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded-md shadow-xs transition-all"
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
              className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-semibold rounded-md transition-all ${
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
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-app-main bg-app-secondary border border-app hover:bg-app-field rounded-md transition-colors"
            >
              <BookOpen className="w-4 h-4 text-app-secondary" />
              View Reports
            </button>
          </div>
        </div>
      </main>

      {/* Subtle minimalist footer */}
      <footer className="border-t border-app py-2.5 sm:py-3 text-center text-[11px] sm:text-xs text-app-secondary bg-app-main shrink-0">
        ABMAX ANALYSIS — Professional Trading Journal
      </footer>
    </div>
  );
};
