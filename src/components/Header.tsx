import React, { useEffect, useRef, useState } from 'react';
import { Sun, Moon, User, Cloud } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getCloudVerifiedState } from '../services/supabaseDiagnostic';

export type ActiveView = 'home' | 'analysis' | 'reports';

interface HeaderProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenAuth: () => void;
  hasUnsavedDraft?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onNavigate,
  theme,
  onToggleTheme,
  onOpenAuth,
}) => {
  const { user } = useAuth();

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
  // Nav bar is visible only when at the top of the page (scrollY <= 80px)
  useEffect(() => {
    const handleScroll = () => {
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
  }, []);

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

            {/* Account & Cloud Sync Control */}
            <button
              type="button"
              tabIndex={buttonTabIndex}
              onClick={onOpenAuth}
              title={
                user
                  ? `Signed in as ${user.email}${getCloudVerifiedState(user?.id).cloudSaveVerified ? ' • Cloud Sync Verified' : ' • Cloud Active'}`
                  : 'Sign in to Account'
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-app-secondary hover:text-app-main hover:bg-app-field border border-app transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {user ? (
                <>
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      getCloudVerifiedState(user?.id).cloudSaveVerified
                        ? 'bg-emerald-500'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span className="max-w-[100px] truncate hidden sm:inline text-app-main font-medium">
                    {user.email?.split('@')[0]}
                  </span>
                  <Cloud className="w-3.5 h-3.5 text-emerald-theme shrink-0" />
                </>
              ) : (
                <>
                  <User className="w-3.5 h-3.5 text-app-secondary shrink-0" />
                  <span className="hidden sm:inline">Sign In</span>
                </>
              )}
            </button>

            {/* Small Light / Dark Mode Toggle */}
            <button
              type="button"
              tabIndex={buttonTabIndex}
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
