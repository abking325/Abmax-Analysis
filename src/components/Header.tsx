import React, { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';

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
  const [headerHeight, setHeaderHeight] = useState(54);
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
        <div className="max-w-[1100px] mx-auto px-3.5 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
          {/* Brand Zone */}
          <button
            type="button"
            tabIndex={buttonTabIndex}
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2 text-left focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-md transition-colors"
            title="Go to Home"
          >
            <span className="font-bold text-base sm:text-lg tracking-tight text-app-main">
              ABMAX <span className="text-emerald-theme font-semibold">ANALYSIS</span>
            </span>
          </button>

          {/* Navigation & Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Main Navigation">
              <button
                type="button"
                tabIndex={buttonTabIndex}
                onClick={() => onNavigate('home')}
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
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
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
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
                className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  activeView === 'reports'
                    ? 'bg-emerald-pale text-emerald-theme font-semibold'
                    : 'text-app-secondary hover:text-app-main hover:bg-app-field'
                }`}
              >
                Reports
              </button>
            </nav>

            <div className="h-4 w-px border-r border-app mx-1" aria-hidden="true" />

            {/* Settings button (clean outline gear icon with accessible label & desktop tooltip) */}
            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={onOpenSettings}
              aria-label="Open settings"
              title="Settings"
              className="min-w-[44px] min-h-[44px] w-11 h-11 inline-flex items-center justify-center rounded-md text-app-secondary hover:text-app-main hover:bg-app-field border border-app transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <Settings className="w-5 h-5 text-current" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>
    </>
  );
};
