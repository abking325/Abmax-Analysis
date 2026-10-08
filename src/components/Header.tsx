import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sun, Moon } from 'lucide-react';

export type ActiveView = 'home' | 'analysis' | 'reports';

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  hasUnsavedDraft?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  theme,
  onToggleTheme,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [hasFocus, setHasFocus] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(54);

  const headerRef = useRef<HTMLElement>(null);
  const lastScrollYRef = useRef(0);
  const isScrollLockedRef = useRef(false);

  // Measure header height for layout spacer to prevent content jumps
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

  // When switching pages, ensure header is shown and scroll pos reset
  useEffect(() => {
    setIsVisible(true);
    lastScrollYRef.current = 0;
  }, [activeView]);

  // Scroll listener with threshold and direction detection
  const handleScroll = useCallback(() => {
    // If background scroll is locked (e.g. modal open), ignore
    if (document.body.style.overflow === 'hidden' || isScrollLockedRef.current) {
      return;
    }

    const currentScrollY = window.scrollY;
    const lastScrollY = lastScrollYRef.current;
    const delta = currentScrollY - lastScrollY;

    // Always show at top (<= 80px)
    if (currentScrollY <= 80) {
      setIsVisible(true);
      lastScrollYRef.current = currentScrollY;
      return;
    }

    // Ignore tiny scroll movements (< 8px) to prevent flickering
    if (Math.abs(delta) < 8) {
      return;
    }

    if (delta > 0) {
      // Scrolling down beyond 80px -> hide
      setIsVisible(false);
    } else {
      // Scrolling up -> reveal
      setIsVisible(true);
    }

    lastScrollYRef.current = currentScrollY;
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // Header should be visible if explicitly visible OR if any child control has keyboard focus
  const shouldShow = isVisible || hasFocus;

  return (
    <>
      {/* Layout Spacer to guarantee zero content jumps when header translates */}
      <div
        style={{ height: `${headerHeight}px` }}
        aria-hidden="true"
        className="w-full shrink-0 select-none pointer-events-none no-print"
      />

      {/* Fixed Header with smooth 200ms slide transition */}
      <header
        ref={headerRef}
        onFocus={() => setHasFocus(true)}
        onBlur={(e) => {
          // Check if focus moved to an element outside this header
          if (!headerRef.current?.contains(e.relatedTarget as Node)) {
            setHasFocus(false);
          }
        }}
        tabIndex={!shouldShow ? -1 : undefined}
        className={`fixed top-0 left-0 right-0 z-30 w-full border-b border-app bg-app-main/95 backdrop-blur-xs transition-transform duration-200 ease-in-out motion-reduce:transition-none no-print focus-within:translate-y-0 ${
          shouldShow ? 'translate-y-0 shadow-2xs' : '-translate-y-full'
        }`}
      >
        <div className="max-w-[1100px] mx-auto px-3.5 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
          {/* Brand Zone */}
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 text-left focus-visible:ring-2 focus-visible:ring-emerald-500 rounded group"
            title="Go to Home"
          >
            <span className="font-extrabold text-lg sm:text-xl tracking-tight text-emerald-theme group-hover:opacity-90 transition-opacity">
              ABMAX
            </span>
            <span className="font-semibold text-lg sm:text-xl tracking-tight text-app-main">
              ANALYSIS
            </span>
          </button>

          {/* Navigation & Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Main Navigation">
              <button
                type="button"
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

            {/* Small Light / Dark Mode Toggle */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className="p-1.5 rounded-md text-app-secondary hover:text-app-main hover:bg-app-field border border-app transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4 text-slate-600" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400" />
              )}
            </button>
          </div>
        </div>
      </header>
    </>
  );
};
