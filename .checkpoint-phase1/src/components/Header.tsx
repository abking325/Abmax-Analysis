import React, { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import settingsGearPng from '../assets/settings-gear.png';

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
  const [imgFailed, setImgFailed] = useState(false);
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

          {/* Right: Locally Bundled Transparent PNG Settings Gear Button with SVG Fallback */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={onOpenSettings}
              aria-label="Open settings"
              title="Settings"
              className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg border border-app bg-app-field/60 hover:bg-app-field text-app-main transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500 shrink-0 relative z-10 pointer-events-auto"
            >
              {!imgFailed ? (
                <img
                  src={settingsGearPng}
                  alt="Settings"
                  onError={() => setImgFailed(true)}
                  className="w-[20px] h-[20px] max-w-[20px] max-h-[20px] object-contain dark:invert opacity-80 hover:opacity-100 transition-opacity select-none pointer-events-none"
                />
              ) : (
                <SettingsIcon
                  className="w-[20px] h-[20px] text-app-main opacity-80 hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        </div>
      </header>
    </>
  );
};
