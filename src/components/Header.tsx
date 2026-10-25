import React, { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';

export type ActiveView = 'home' | 'analysis' | 'reports';

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  onOpenSettings: () => void;
  hasUnsavedDraft?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  onOpenSettings,
}) => {
  // Local state tracking whether header is visible (only when on top of page <= 80px)
  const [isVisible, setIsVisible] = useState(true);
  const [headerHeight, setHeaderHeight] = useState(58);
  const headerRef = useRef<HTMLElement>(null);

  // Measure header height for layout spacer to prevent page content jumps
  useEffect(() => {
    if (!headerRef.current) return;
    const updateHeight = () => {
      if (headerRef.current) {
        setHeaderHeight(headerRef.current.offsetHeight);
      }
    };
    updateHeight();

    const ro = new ResizeObserver(() => {
      updateHeight();
    });
    ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  // Reset to visible whenever navigating to a view
  useEffect(() => {
    setIsVisible(true);
  }, [activeView]);

  // Scroll event listener tracking window.scrollY:
  // Nav bar is visible only when at the top of the page (scrollY <= 80px) on Analysis & Reports.
  // Home view always keeps the header visible.
  useEffect(() => {
    const handleScroll = () => {
      // Home page header remains stationary and visible
      if (activeView === 'home') {
        setIsVisible(true);
        return;
      }

      // Do not alter header visibility when background scrolling is locked by a modal
      if (document.body.style.overflow === 'hidden') return;

      const currentScrollY = window.scrollY;
      if (currentScrollY <= 80) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial position
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [activeView]);

  // Keyboard focus management: blur active element if header hides
  useEffect(() => {
    if (!isVisible && headerRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
    }
  }, [isVisible]);

  // Tab index for interactive elements: -1 when hidden so hidden elements cannot be focused
  const buttonTabIndex = isVisible ? 0 : -1;

  return (
    <>
      {/* Layout Spacer to guarantee zero content jumps */}
      <div
        style={{ height: `${headerHeight}px` }}
        aria-hidden="true"
        className="w-full shrink-0 select-none pointer-events-none no-print"
      />

      {/* Header container applying header-visible / header-hidden & pointer-events: none when hidden */}
      <header
        ref={headerRef}
        inert={!isVisible ? true : undefined}
        aria-hidden={!isVisible ? 'true' : undefined}
        className={`fixed top-0 left-0 right-0 z-30 w-full border-b border-app bg-app-main/95 backdrop-blur-xs header-transition no-print ${
          isVisible ? 'header-visible shadow-2xs' : 'header-hidden pointer-events-none'
        }`}
      >
        <div className="w-full px-3 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-x-2 sm:gap-x-4 pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))]">
          {/* Left: Brand Zone - Two-line wordmark with right-aligned smaller Analysis */}
          <button
            type="button"
            tabIndex={buttonTabIndex}
            onClick={() => onNavigate('home')}
            className="flex flex-col items-end justify-center text-right focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-md transition-opacity hover:opacity-90 shrink-0 cursor-pointer select-none group py-0.5"
            title="AbMax Analysis - Go to Home"
            aria-label="AbMax Analysis Home"
          >
            <span className="font-extrabold text-[21px] sm:text-[25px] leading-none tracking-tight text-emerald-theme whitespace-nowrap block">
              AbMax
            </span>
            <span className="text-[9px] sm:text-[10px] font-semibold tracking-[0.18em] uppercase text-app-secondary dark:text-slate-400 -mt-0.5 block self-end whitespace-nowrap">
              Analysis
            </span>
          </button>

          {/* Center / Navigation */}
          <nav className="flex items-center gap-1 sm:gap-1.5 shrink-0" aria-label="Main Navigation">
            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={() => onNavigate('home')}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                activeView === 'home'
                  ? 'bg-emerald-pale text-emerald-theme font-semibold'
                  : 'text-app-secondary hover:text-app-main hover:bg-app-field'
              }`}
            >
              Home
            </button>

            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={() => onNavigate('analysis')}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                activeView === 'analysis'
                  ? 'bg-emerald-pale text-emerald-theme font-semibold'
                  : 'text-app-secondary hover:text-app-main hover:bg-app-field'
              }`}
            >
              Analysis
            </button>

            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={() => onNavigate('reports')}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                activeView === 'reports'
                  ? 'bg-emerald-pale text-emerald-theme font-semibold'
                  : 'text-app-secondary hover:text-app-main hover:bg-app-field'
              }`}
            >
              Reports
            </button>
          </nav>

          {/* Right: High-contrast 19px SVG Settings Gear Button with >=44x44px Tap Target */}
          <div className="flex items-center shrink-0 z-20">
            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={onOpenSettings}
              aria-label="Open settings"
              title="Settings"
              className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 shrink-0 relative pointer-events-auto shadow-2xs"
            >
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-[19px] h-[19px] shrink-0 text-slate-800 dark:text-slate-100 pointer-events-none"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </header>
    </>
  );
};
