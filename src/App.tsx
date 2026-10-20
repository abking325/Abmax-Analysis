import { useEffect, useState, useCallback } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { ActiveView, Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { AnalysisView } from './components/AnalysisView';
import { ReportsView } from './components/ReportsView';
import { AuthModal } from './components/AuthModal';
import { MigrationModal } from './components/MigrationModal';
import { SettingsModal } from './components/SettingsModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  onUpdateAvailable,
  onInstallable,
  promptPwaInstall,
  applyPwaUpdate,
} from './services/pwaService';
import {
  AnalysisData,
  DEFAULT_VISIBILITY_CONFIG,
  SavedReport,
  WorkspaceVisibilityConfig,
  createInitialAnalysisData,
} from './types/journal';
import {
  clearDraft,
  deleteReport,
  getAllReports,
  getDraft,
  getUserVisibilityConfig,
  saveDraft,
  saveReport,
  saveTemplate,
  saveUserVisibilityConfig,
} from './services/db';
import {
  deleteReportFromCloud,
  fetchAllUserCloudData,
  fetchPreferencesFromCloud,
  getLocalDataCounts,
  syncBidirectionalWithCloud,
  clearDraftFromCloud,
  uploadPreferencesToCloud,
  uploadReportToCloud,
} from './services/cloudSync';

function MainApp() {
  const { user, isPasswordRecovery } = useAuth();
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('abmax_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  });

  const [visibilityConfig, setVisibilityConfig] = useState<WorkspaceVisibilityConfig>(() => {
    return JSON.parse(JSON.stringify(DEFAULT_VISIBILITY_CONFIG));
  });

  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisData>(() =>
    createInitialAnalysisData('XAUUSD', DEFAULT_VISIBILITY_CONFIG)
  );
  const [savedDraft, setSavedDraft] = useState<AnalysisData | null>(null);
  const [isEditingExistingReport, setIsEditingExistingReport] = useState(false);
  const [reportsList, setReportsList] = useState<SavedReport[]>([]);

  // Modals state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [showReplaceDraftDialog, setShowReplaceDraftDialog] = useState(false);

  // Animation pause state (persisted in localStorage)
  const [isAnimationPaused, setIsAnimationPaused] = useState<boolean>(() => {
    return localStorage.getItem('abmax_anim_paused') === 'true';
  });

  // PWA update and install states
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [dismissUpdateBanner, setDismissUpdateBanner] = useState(false);
  const [dismissInstallBanner, setDismissInstallBanner] = useState(false);

  useEffect(() => {
    const unsubUpdate = onUpdateAvailable((available) => {
      setIsUpdateAvailable(available);
    });
    const unsubInstall = onInstallable((canInstall) => {
      setIsInstallable(canInstall);
    });
    return () => {
      unsubUpdate();
      unsubInstall();
    };
  }, []);

  // Restore working view from localStorage after tab recreation
  useEffect(() => {
    const savedView = localStorage.getItem('abmax_active_view') as ActiveView;
    if (savedView && ['home', 'analysis', 'reports'].includes(savedView)) {
      setActiveView(savedView);
    }
  }, []);

  // Save current active view on change
  useEffect(() => {
    localStorage.setItem('abmax_active_view', activeView);
  }, [activeView]);

  // Tab suspension & process recreation safeguard: persist in-memory work on hide
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && currentAnalysis) {
        saveDraft(currentAnalysis).catch(console.warn);
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handleVisibilityChange);
    };
  }, [currentAnalysis]);

  // Load visibility preferences from local DB on mount
  useEffect(() => {
    getUserVisibilityConfig().then((cfg) => {
      if (cfg) {
        setVisibilityConfig(cfg);
      }
    });
  }, []);

  const togglePauseAnimation = () => {
    setIsAnimationPaused((prev) => {
      const next = !prev;
      localStorage.setItem('abmax_anim_paused', String(next));
      return next;
    });
  };

  // If URL has recovery token (password reset link), open auth modal immediately
  useEffect(() => {
    if (isPasswordRecovery) {
      setIsAuthModalOpen(true);
    }
  }, [isPasswordRecovery]);

  // Sync theme to HTML class & localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('abmax_theme', theme);
  }, [theme]);

  // Navigate helper that scrolls window to top and switches view
  const navigateTo = (view: ActiveView) => {
    setActiveView(view);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };

  // Load draft and reports from IndexedDB without overriding active analysis
  const refreshStorageData = useCallback(async () => {
    try {
      const [draft, reports] = await Promise.all([getDraft(), getAllReports()]);
      setSavedDraft(draft);
      setReportsList(reports);
    } catch (e) {
      console.error('Failed to load storage data from IndexedDB', e);
    }
  }, []);

  // Hydrate on mount
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [draft, reports] = await Promise.all([getDraft(), getAllReports()]);
        if (!isMounted) return;
        setSavedDraft(draft);
        setReportsList(reports);
        if (draft) {
          setCurrentAnalysis(draft);
        }
      } catch (e) {
        console.error('Failed to hydrate storage on initial mount', e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle user authentication change: fetch cloud data & check migration offer
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;

    let isMounted = true;
    const syncAccountData = async () => {
      try {
        // Run safe bidirectional sync: preserves all newer local data and uploads unsynced work
        await syncBidirectionalWithCloud(userId);
        if (!isMounted) return;

        await refreshStorageData();

        // Check if user has unmigrated local records
        const migrationKey = `abmax_migrated_prompt_${userId}`;
        const hasPrompted = localStorage.getItem(migrationKey);

        if (!hasPrompted) {
          const counts = await getLocalDataCounts();
          if (counts.reportsCount > 0 || counts.templatesCount > 0 || counts.imagesCount > 0) {
            setIsMigrationModalOpen(true);
            localStorage.setItem(migrationKey, 'true');
          }
        }
      } catch (err) {
        console.error('Error syncing cloud data on sign-in', err);
      }
    };

    syncAccountData();

    return () => {
      isMounted = false;
    };
  }, [user?.id, refreshStorageData]);

  // When user signs in, load cloud preferences if any
  useEffect(() => {
    if (user) {
      fetchPreferencesFromCloud(user.id).then((cloudPref) => {
        if (cloudPref?.preferences?.visibilityConfig) {
          setVisibilityConfig(cloudPref.preferences.visibilityConfig);
          saveUserVisibilityConfig(cloudPref.preferences.visibilityConfig);
        }
      });
    }
  }, [user]);

  const handleUpdateVisibilityConfig = (newCfg: WorkspaceVisibilityConfig) => {
    setVisibilityConfig(newCfg);
    saveUserVisibilityConfig(newCfg);
    if (user) {
      uploadPreferencesToCloud(user.id, theme, { visibilityConfig: newCfg });
    }
  };

  const handleApplyVisibilityToCurrentAnalysis = () => {
    setCurrentAnalysis((prev) => {
      const updated = {
        ...prev,
        visibilityConfig: JSON.parse(JSON.stringify(visibilityConfig)),
      };
      saveDraft(updated).catch(console.error);
      return updated;
    });
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Start fresh analysis
  const handleStartAnalysisClick = () => {
    if (savedDraft) {
      setShowReplaceDraftDialog(true);
    } else {
      const fresh = createInitialAnalysisData('XAUUSD', visibilityConfig);
      setCurrentAnalysis(fresh);
      setIsEditingExistingReport(false);
      navigateTo('analysis');
    }
  };

  const confirmStartFreshAnalysis = async () => {
    await clearDraft();
    setSavedDraft(null);
    const fresh = createInitialAnalysisData('XAUUSD', visibilityConfig);
    setCurrentAnalysis(fresh);
    setIsEditingExistingReport(false);
    setShowReplaceDraftDialog(false);
    navigateTo('analysis');
  };

  // Continue existing analysis
  const handleContinueAnalysis = async () => {
    const draft = await getDraft();
    if (draft) {
      setCurrentAnalysis(draft);
      setIsEditingExistingReport(false);
      navigateTo('analysis');
    } else {
      handleStartAnalysisClick();
    }
  };

  // When a report is saved successfully
  const handleReportSavedSuccessfully = async () => {
    await refreshStorageData();
    setIsEditingExistingReport(false);
    navigateTo('reports');
  };

  // Modify report from Reports view: loads all data into Analysis view
  const handleModifyReport = (report: SavedReport) => {
    setCurrentAnalysis(JSON.parse(JSON.stringify(report)));
    setIsEditingExistingReport(true);
    navigateTo('analysis');
  };

  // Copy report: creates independent report with new ID, today's local date, new creation timestamp
  const handleCopyReport = async (sourceReport: SavedReport) => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const newReportId = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const copiedReport: SavedReport = {
      ...JSON.parse(JSON.stringify(sourceReport)),
      id: newReportId,
      date: dateStr,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'Original',
      copiedFromId: sourceReport.id,
    };

    try {
      await saveReport(copiedReport);
      if (user) {
        await uploadReportToCloud(user.id, copiedReport);
      }
      await refreshStorageData();
    } catch (e) {
      console.error('Failed to copy report', e);
    }
  };

  // Update report in-place (e.g. from scenario editor or recording trade)
  const handleUpdateReportDirectly = async (updatedReport: SavedReport) => {
    try {
      const saved = await saveReport(updatedReport);
      if (user) {
        await uploadReportToCloud(user.id, saved);
      }
      await refreshStorageData();
    } catch (e) {
      console.error('Failed to update report directly', e);
    }
  };

  // Delete report
  const handleDeleteReport = async (id: string) => {
    try {
      await deleteReport(id);
      if (user) {
        await deleteReportFromCloud(user.id, id);
      }
      await refreshStorageData();
    } catch (e) {
      console.error('Failed to delete report', e);
    }
  };

  return (
    <div
      className={`min-h-screen min-h-[100dvh] flex flex-col bg-app-main text-app-main transition-colors ${
        activeView === 'home' ? 'h-screen h-[100dvh] overflow-hidden' : ''
      }`}
    >
      {/* PWA Update Notification Banner */}
      {isUpdateAvailable && !dismissUpdateBanner && (
        <div className="bg-emerald-theme text-white text-xs px-4 py-2 flex items-center justify-between gap-2 shadow-md z-50">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>An update for ABMAX Analysis is ready.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                applyPwaUpdate(async () => {
                  if (currentAnalysis) {
                    await saveDraft(currentAnalysis);
                  }
                })
              }
              className="px-2.5 py-1 bg-white text-emerald-800 font-semibold rounded text-xs hover:bg-emerald-50 transition-colors cursor-pointer"
            >
              Update Now
            </button>
            <button
              type="button"
              onClick={() => setDismissUpdateBanner(true)}
              className="text-white/80 hover:text-white text-xs px-1.5 py-1 cursor-pointer"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* PWA In-App Install Banner */}
      {isInstallable && !dismissInstallBanner && (
        <div className="bg-app-field border-b border-app text-app-main text-xs px-4 py-2 flex items-center justify-between gap-2 z-40">
          <div className="flex items-center gap-2">
            <Download className="w-3.5 h-3.5 text-emerald-theme" />
            <span>Install ABMAX App for full offline access and home screen launch.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => promptPwaInstall()}
              className="px-2.5 py-1 bg-emerald-theme text-white font-semibold rounded text-xs hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              Install App
            </button>
            <button
              type="button"
              onClick={() => setDismissInstallBanner(true)}
              className="text-app-secondary hover:text-app-main text-xs px-1.5 py-1 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Compact Header with scroll hide / reveal & Settings Control */}
      <Header
        activeView={activeView}
        onNavigate={navigateTo}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        hasUnsavedDraft={Boolean(savedDraft)}
      />

      {/* Main Content Area - Shows only the selected view */}
      <div
        className={`flex-1 ${
          activeView === 'home' ? 'min-h-0 flex flex-col overflow-y-auto' : ''
        }`}
      >
        {activeView === 'home' && (
          <HomeView
            onStartAnalysis={handleStartAnalysisClick}
            onContinueAnalysis={handleContinueAnalysis}
            onViewReports={() => navigateTo('reports')}
            hasDraft={Boolean(savedDraft)}
            isAnimationPaused={isAnimationPaused}
            draftSummary={
              savedDraft
                ? {
                    pair: savedDraft.pair,
                    date: savedDraft.date,
                    time: savedDraft.time,
                  }
                : null
            }
          />
        )}

        {activeView === 'analysis' && (
          <AnalysisView
            initialData={currentAnalysis}
            isEditingExistingReport={isEditingExistingReport}
            onNavigateHome={() => {
              refreshStorageData();
              navigateTo('home');
            }}
            onReportSavedSuccessfully={handleReportSavedSuccessfully}
            workspaceVisibility={visibilityConfig}
          />
        )}

        {activeView === 'reports' && (
          <ReportsView
            reports={reportsList}
            onModifyReport={handleModifyReport}
            onCopyReport={handleCopyReport}
            onDeleteReport={handleDeleteReport}
            onUpdateReport={handleUpdateReportDirectly}
            onRefreshData={refreshStorageData}
          />
        )}
      </div>

      {/* Replace Unfinished Work Confirmation Dialog */}
      {showReplaceDraftDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Replace Unfinished Analysis"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-app-main border border-app rounded-lg shadow-xl p-5 space-y-4">
            <h3 className="text-base font-bold text-app-main">
              Replace Unfinished Analysis?
            </h3>
            <p className="text-xs text-app-secondary leading-relaxed">
              You have an unfinished analysis draft for{' '}
              <strong className="text-app-main">{savedDraft?.pair}</strong> saved at{' '}
              <span className="font-mono">{savedDraft?.time}</span>. Starting a new analysis will
              replace this saved draft.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
              <button
                type="button"
                onClick={() => setShowReplaceDraftDialog(false)}
                className="px-3.5 py-1.5 text-xs text-app-secondary hover:bg-app-field rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmStartFreshAnalysis}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors"
              >
                Yes, Start New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supabase Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onOpenMigration={() => setIsMigrationModalOpen(true)}
      />

      {/* Settings Modal (Account, Theme Chooser, Admin Panel Workspace Visibility, Candle Animation) */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenAccount={() => setIsAuthModalOpen(true)}
        isAnimationPaused={isAnimationPaused}
        onTogglePauseAnimation={togglePauseAnimation}
        visibilityConfig={visibilityConfig}
        onChangeVisibilityConfig={handleUpdateVisibilityConfig}
        onApplyVisibilityToCurrentAnalysis={handleApplyVisibilityToCurrentAnalysis}
        hasActiveAnalysis={Boolean(currentAnalysis)}
      />

      {/* Local to Cloud Journal Migration Modal */}
      <MigrationModal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        onMigrationComplete={() => {
          refreshStorageData();
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
