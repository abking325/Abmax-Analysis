import React, { useEffect, useRef } from 'react';
import {
  X,
  User,
  Sun,
  Moon,
  LogOut,
  Play,
  Pause,
  ExternalLink,
  Shield,
  Monitor,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenAccount: () => void;
  isAnimationPaused: boolean;
  onTogglePauseAnimation: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  onOpenAccount,
  isAnimationPaused,
  onTogglePauseAnimation,
}) => {
  const { user, signOut } = useAuth();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus management and background scroll lock
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      // Set focus to close button
      setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown);

      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
          previouslyFocusedRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOpenAccountDialog = () => {
    // When opening Account from Settings, close Settings first so dialogs do not overlap
    onClose();
    onOpenAccount();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl overflow-hidden flex flex-col text-app-main animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-app bg-app-secondary">
          <h2 className="text-sm sm:text-base font-bold text-app-main tracking-tight">Settings</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 text-app-secondary hover:text-app-main hover:bg-app-field rounded-md transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Content */}
        <div className="p-4 sm:p-5 space-y-5 text-xs">
          {/* SECTION 1: ACCOUNT */}
          <section className="space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-emerald-theme" />
              <span>Account</span>
            </div>

            <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 space-y-3">
              {user ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <span className="text-[10px] text-app-secondary block uppercase font-medium">
                        Signed in as
                      </span>
                      <span className="font-semibold text-app-main truncate block text-xs sm:text-sm">
                        {user.email}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-pale text-emerald-theme border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-app/60">
                    <button
                      type="button"
                      onClick={handleOpenAccountDialog}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Manage Account
                    </button>

                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 bg-app-field border border-app hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-500"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-app-secondary text-[11px] leading-relaxed">
                    Sign in to synchronize analyses, chart screenshots, and templates securely to your cloud workspace.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenAccountDialog}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <User className="w-3.5 h-3.5" />
                    Sign In / Create Account
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2: APPEARANCE */}
          <section className="space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary flex items-center gap-1.5">
              <Monitor className="w-3.5 h-3.5 text-emerald-theme" />
              <span>Appearance</span>
            </div>

            <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 space-y-3">
              <label className="block text-xs font-medium text-app-secondary">
                Theme Chooser
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (theme !== 'light') onToggleTheme();
                  }}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                    theme === 'light'
                      ? 'bg-emerald-theme text-white border-emerald-600 shadow-2xs'
                      : 'bg-app-field text-app-main border-app hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                  aria-pressed={theme === 'light'}
                >
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Light</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (theme !== 'dark') onToggleTheme();
                  }}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-emerald-theme text-white border-emerald-600 shadow-2xs'
                      : 'bg-app-field text-app-main border-app hover:bg-slate-200 dark:hover:bg-slate-800'
                  }`}
                  aria-pressed={theme === 'dark'}
                >
                  <Moon className="w-4 h-4 text-slate-300" />
                  <span>Dark</span>
                </button>
              </div>

              <p className="text-[11px] text-app-secondary">
                Currently using <strong className="text-app-main font-semibold capitalize">{theme}</strong> theme. Preference is saved automatically.
              </p>
            </div>
          </section>

          {/* SECTION 3: ANIMATION (Pause / Play Moving Candle Chart) */}
          <section className="space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5 text-emerald-theme" />
              <span>Chart Animation</span>
            </div>

            <div className="p-3.5 rounded-lg border border-app bg-app-secondary/40 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-app-main text-xs">Hero Candlestick Motion</div>
                <div className="text-[11px] text-app-secondary">
                  {isAnimationPaused ? 'Chart motion is currently stopped' : 'Chart is moving continuously'}
                </div>
              </div>

              <button
                type="button"
                onClick={onTogglePauseAnimation}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                  isAnimationPaused
                    ? 'bg-emerald-theme text-white border-emerald-600 shadow-2xs'
                    : 'bg-app-field text-app-main border-app hover:bg-slate-200 dark:hover:bg-slate-800'
                }`}
                title={isAnimationPaused ? 'Play moving candle animation' : 'Pause moving candle animation'}
              >
                {isAnimationPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Play</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 sm:px-5 py-2.5 border-t border-app bg-app-secondary">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main hover:bg-app-field border border-app rounded-md transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
