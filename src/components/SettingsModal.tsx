import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  User,
  Sun,
  Moon,
  LogOut,
  Play,
  Pause,
  Shield,
  Monitor,
  Sliders,
  RotateCcw,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_VISIBILITY_CONFIG,
  TimeframeId,
  WorkspaceVisibilityConfig,
} from '../types/journal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenAccount: () => void;
  isAnimationPaused: boolean;
  onTogglePauseAnimation: () => void;
  visibilityConfig: WorkspaceVisibilityConfig;
  onChangeVisibilityConfig: (config: WorkspaceVisibilityConfig) => void;
  onApplyVisibilityToCurrentAnalysis?: () => void;
  hasActiveAnalysis?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  theme,
  onToggleTheme,
  onOpenAccount,
  isAnimationPaused,
  onTogglePauseAnimation,
  visibilityConfig,
  onChangeVisibilityConfig,
  onApplyVisibilityToCurrentAnalysis,
  hasActiveAnalysis = false,
}) => {
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'admin'>('general');
  const [appliedNotice, setAppliedNotice] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Focus management and background scroll lock
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

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

  const toggleTimeframeVis = (tf: TimeframeId) => {
    onChangeVisibilityConfig({
      ...visibilityConfig,
      timeframes: {
        ...visibilityConfig.timeframes,
        [tf]: !visibilityConfig.timeframes[tf],
      },
    });
  };

  const toggleDeepSectionVis = (key: keyof WorkspaceVisibilityConfig['deepSections']) => {
    onChangeVisibilityConfig({
      ...visibilityConfig,
      deepSections: {
        ...visibilityConfig.deepSections,
        [key]: !visibilityConfig.deepSections[key],
      },
    });
  };

  const toggleOtherSectionVis = (key: keyof WorkspaceVisibilityConfig['otherSections']) => {
    onChangeVisibilityConfig({
      ...visibilityConfig,
      otherSections: {
        ...visibilityConfig.otherSections,
        [key]: !visibilityConfig.otherSections[key],
      },
    });
  };

  const handleRestoreDefaults = () => {
    onChangeVisibilityConfig(JSON.parse(JSON.stringify(DEFAULT_VISIBILITY_CONFIG)));
  };

  const handleApplyToCurrent = () => {
    if (onApplyVisibilityToCurrentAnalysis) {
      onApplyVisibilityToCurrentAnalysis();
      setAppliedNotice(true);
      setTimeout(() => setAppliedNotice(false), 3000);
    }
  };

  const timeframesList: { id: TimeframeId; label: string }[] = [
    { id: 'Monthly', label: 'Monthly' },
    { id: 'Weekly', label: 'Weekly' },
    { id: 'Daily', label: 'Daily' },
    { id: '4H', label: '4H' },
    { id: '1H', label: '1H' },
    { id: '15M', label: '15M' },
    { id: '5M', label: '5M' },
    { id: '1M', label: '1M' },
  ];

  const deepSectionsList: { key: keyof WorkspaceVisibilityConfig['deepSections']; label: string }[] = [
    { key: 'overallInterpretation', label: '1. Overall Interpretation' },
    { key: 'priceLocation', label: '2. Equilibrium / Price Location' },
    { key: 'swingStructure', label: '3. Swing Structure' },
    { key: 'internalStructure', label: '4. Internal Structure' },
    { key: 'fractalStructure', label: '5. Fractal Structure' },
    { key: 'supplyLevels', label: '6. Supply Levels' },
    { key: 'demandLevels', label: '7. Demand Levels' },
    { key: 'supportLevels', label: '8. Support Levels' },
    { key: 'resistanceLevels', label: '9. Resistance Levels' },
    { key: 'liquidityLevels', label: '10. Liquidity Levels' },
    { key: 'timeframeNotes', label: '11. Timeframe Notes' },
    { key: 'chartAttachments', label: '12. Chart Attachments' },
  ];

  const otherSectionsList: { key: keyof WorkspaceVisibilityConfig['otherSections']; label: string }[] = [
    { key: 'majorLiquidityChecklist', label: 'Major Liquidity Checklist' },
    { key: 'majorLiquidityWatchlist', label: 'Major Liquidity Watchlist' },
    { key: 'supplyDemandManager', label: 'General Supply/Demand Manager' },
    { key: 'overallNotes', label: 'Overall Notes' },
    { key: 'plannedScenarios', label: 'Planned Scenarios' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-app-main border border-app rounded-lg shadow-xl overflow-hidden flex flex-col text-app-main animate-in fade-in zoom-in-95 duration-150 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-app bg-app-secondary shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-app-main tracking-tight">Settings</h2>
          </div>
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

        {/* Tab Navigation */}
        <div className="flex border-b border-app bg-app-secondary/40 shrink-0 px-4 sm:px-5">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'general'
                ? 'border-emerald-600 text-emerald-theme'
                : 'border-transparent text-app-secondary hover:text-app-main'
            }`}
          >
            General & Theme
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'admin'
                ? 'border-emerald-600 text-emerald-theme'
                : 'border-transparent text-app-secondary hover:text-app-main'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Admin Panel (Workspace)
          </button>
        </div>

        {/* Settings Content - Scrollable */}
        <div className="p-4 sm:p-5 space-y-5 text-xs overflow-y-auto flex-1">
          {activeTab === 'general' && (
            <>
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer"
                        >
                          <Shield className="w-3.5 h-3.5" />
                          Manage Account
                        </button>

                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 bg-app-field border border-app hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors cursor-pointer"
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
                        className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer"
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

              {/* SECTION 3: ANIMATION */}
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
            </>
          )}

          {activeTab === 'admin' && (
            <div className="space-y-5">
              {/* Workspace visibility notice */}
              <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Workspace Section Visibility
                </div>
                <p className="text-emerald-800 dark:text-emerald-300">
                  Toggle which timeframes and analysis blocks appear in your editor. Switching off hides sections but never erases existing content, images, scenarios, or trades.
                </p>
              </div>

              {/* Group 1: TIMEFRAMES */}
              <section className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary">
                  Timeframes (Enabled in Editor & Alignment)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {timeframesList.map(({ id, label }) => {
                    const isEnabled = visibilityConfig.timeframes[id] !== false;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleTimeframeVis(id)}
                        className={`flex items-center justify-between p-2 rounded border text-xs font-medium transition-colors cursor-pointer ${
                          isEnabled
                            ? 'bg-emerald-pale text-bullish border-emerald-500 font-semibold shadow-2xs'
                            : 'bg-app-field border-app text-app-secondary line-through opacity-70 hover:opacity-100'
                        }`}
                      >
                        <span>{label}</span>
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${
                            isEnabled
                              ? 'bg-emerald-600 text-white'
                              : 'border border-slate-400 dark:border-slate-600 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Group 2: DEEP ANALYSIS SECTIONS */}
              <section className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary">
                  Deep Analysis Sections
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {deepSectionsList.map(({ key, label }) => {
                    const isEnabled = visibilityConfig.deepSections[key] !== false;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleDeepSectionVis(key)}
                        className={`flex items-center justify-between p-2 rounded border text-xs font-medium transition-colors cursor-pointer ${
                          isEnabled
                            ? 'bg-app-main text-app-main border-emerald-500/60 shadow-2xs'
                            : 'bg-app-field border-app text-app-secondary opacity-60 hover:opacity-100'
                        }`}
                      >
                        <span className={isEnabled ? '' : 'line-through'}>{label}</span>
                        <span
                          className={`w-3 h-3 rounded-full flex items-center justify-center text-[9px] ${
                            isEnabled ? 'bg-emerald-600 text-white' : 'border border-slate-400'
                          }`}
                        >
                          {isEnabled ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Group 3: OTHER ANALYSIS SECTIONS */}
              <section className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-app-secondary">
                  Other Analysis Sections
                </div>
                <div className="space-y-1.5">
                  {otherSectionsList.map(({ key, label }) => {
                    const isEnabled = visibilityConfig.otherSections[key] !== false;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleOtherSectionVis(key)}
                        className={`w-full flex items-center justify-between p-2 rounded border text-xs font-medium transition-colors cursor-pointer ${
                          isEnabled
                            ? 'bg-app-main text-app-main border-emerald-500/60 shadow-2xs'
                            : 'bg-app-field border-app text-app-secondary opacity-60 hover:opacity-100'
                        }`}
                      >
                        <span className={isEnabled ? '' : 'line-through'}>{label}</span>
                        <span
                          className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] ${
                            isEnabled ? 'bg-emerald-600 text-white' : 'border border-slate-400'
                          }`}
                        >
                          {isEnabled ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Apply / Restore Controls */}
              <div className="pt-3 border-t border-app space-y-2">
                {hasActiveAnalysis && (
                  <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Applying changes hides selected sections on your active analysis without altering their stored values.
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleRestoreDefaults}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-app-secondary hover:text-app-main bg-app-field border border-app rounded transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Restore Default Visibility
                  </button>

                  {hasActiveAnalysis && (
                    <button
                      type="button"
                      onClick={handleApplyToCurrent}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-theme bg-emerald-theme-hover rounded shadow-2xs transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {appliedNotice ? 'Applied to Current!' : 'Apply to Current Analysis'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 sm:px-5 py-2.5 border-t border-app bg-app-secondary shrink-0">
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
