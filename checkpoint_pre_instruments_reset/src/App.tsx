import { useEffect, useState, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Download, RefreshCw } from 'lucide-react';
import { ActiveView, Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { AnalysisView } from './components/AnalysisView';
import { ReportsView } from './components/ReportsView';
import { JournalView } from './components/JournalView';
import { PerformanceView } from './components/PerformanceView';
import { LiveView } from './components/LiveView';
import { AuthModal } from './components/AuthModal';
import { MigrationModal } from './components/MigrationModal';
import { SettingsModal } from './components/SettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { hasMeaningfulAnalysisWork } from './utils/analysisUtils';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  onUpdateAvailable,
  onInstallable,
  promptPwaInstall,
  applyPwaUpdate,
} from './services/pwaService';
import {
  AnalysisData,
  DEFAULT_JOURNAL_VISIBILITY_CONFIG,
  DEFAULT_PERFORMANCE_VISIBILITY_CONFIG,
  DEFAULT_VISIBILITY_CONFIG,
  JournalVisibilityConfig,
  PerformanceVisibilityConfig,
  SavedReport,
  WorkspaceVisibilityConfig,
  createInitialAnalysisData,
} from './types/journal';
import {
  clearDraft,
  deleteReport,
  getAllReports,
  getDraft,
  getReportById,
  getUserJournalVisibilityConfig,
  getUserPerformanceVisibilityConfig,
  getUserVisibilityConfig,
  saveDraft,
  saveReport,
  saveTemplate,
  saveUserJournalVisibilityConfig,
  saveUserPerformanceVisibilityConfig,
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
import {
  sessionManager,
  registerLifecycleSessionListeners,
  restoreScrollPosition,
  WorkingSessionState,
} from './services/sessionRestoration';
import {
  dispatchTopmostBackHandler,
  registerBackHandler,
} from './utils/backNavigation';

function MainApp() {
  const { user, isPasswordRecovery, isRecoveryLinkExpired } = useAuth();
  const accountId = user?.id || 'local';
  const initialSession = sessionManager.loadSession(accountId);

  // Fresh cold launch or full reload always lands on HOME; in-memory app switching/resuming preserves state
  const [activeView, setActiveView] = useState<ActiveView>('home');

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('abmax_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  });

  const [visibilityConfig, setVisibilityConfig] = useState<WorkspaceVisibilityConfig>(() => {
    return JSON.parse(JSON.stringify(DEFAULT_VISIBILITY_CONFIG));
  });

  const [journalVisibilityConfig, setJournalVisibilityConfig] = useState<JournalVisibilityConfig>(() => {
    return JSON.parse(JSON.stringify(DEFAULT_JOURNAL_VISIBILITY_CONFIG));
  });

  const [performanceVisibilityConfig, setPerformanceVisibilityConfig] = useState<PerformanceVisibilityConfig>(() => {
    return JSON.parse(JSON.stringify(DEFAULT_PERFORMANCE_VISIBILITY_CONFIG));
  });

  const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'theme' | 'admin' | 'journal_visibility' | 'performance_visibility'>('general');

  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisData>(() =>
    createInitialAnalysisData('XAUUSD', DEFAULT_VISIBILITY_CONFIG)
  );
  const [savedDraft, setSavedDraft] = useState<AnalysisData | null>(null);
  const [isEditingExistingReport, setIsEditingExistingReport] = useState<boolean>(() => {
    return initialSession?.isEditingExistingReport || false;
  });
  const [isBoundToReport, setIsBoundToReport] = useState<boolean>(() => {
    return Boolean(initialSession?.isBoundToReport || initialSession?.isEditingExistingReport);
  });
  const [reportsList, setReportsList] = useState<SavedReport[]>([]);
  const analysisFlushHandlerRef = useRef<(() => Promise<void>) | null>(null);

  // Cold start splash state (genuine cold launch / full restart only)
  const [isColdStarting, setIsColdStarting] = useState(true);
  const [splashStage, setSplashStage] = useState<1 | 2>(1);
  const [splashFadingOut, setSplashFadingOut] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [showSlowFeedback, setShowSlowFeedback] = useState(false);
  const coldStartStartTimeRef = useRef<number>(Date.now());

  // Preload and decode both startup stage images early
  useEffect(() => {
    const img1 = new Image();
    img1.src = '/abmax-hero.png';
    if (img1.decode) {
      img1.decode().catch(() => {});
    }
    const img2 = new Image();
    img2.src = '/abmax-startup.png';
    if (img2.decode) {
      img2.decode().catch(() => {});
    }
  }, []);

  // Ref tracking full working session state to avoid UI churn during serialized debounce
  const sessionStateRef = useRef<WorkingSessionState>({
    version: 2,
    timestamp: Date.now(),
    accountId,
    activeView: 'home',
    isEditingExistingReport: initialSession?.isEditingExistingReport || false,
    isBoundToReport: Boolean(initialSession?.isBoundToReport || initialSession?.isEditingExistingReport),
    hasActiveAnalysisSession: initialSession?.hasActiveAnalysisSession || false,
    activeReportId: initialSession?.activeReportId,
    activePair: initialSession?.activePair,
    activeTitle: initialSession?.activeTitle,
    scrollPositions: initialSession?.scrollPositions || {},
    analysisUI: initialSession?.analysisUI,
    reportsUI: initialSession?.reportsUI,
    tradeModalDraft: initialSession?.tradeModalDraft,
  });

  // Modals state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isMigrationModalOpen, setIsMigrationModalOpen] = useState(false);
  const [showReplaceDraftDialog, setShowReplaceDraftDialog] = useState(false);

  // Report details state coordination with main header
  const [isReportDetailsOpen, setIsReportDetailsOpen] = useState(false);
  const [isOrganizedReportViewActive, setIsOrganizedReportViewActive] = useState(false);
  const [reportDetailsCloseTrigger, setReportDetailsCloseTrigger] = useState(0);

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

  // Update session account ID when user changes; account-scoped drafts remain isolated without deletion
  const prevAccountIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentAccountId = user?.id || 'local';
    prevAccountIdRef.current = currentAccountId;
    sessionStateRef.current.accountId = currentAccountId;
  }, [user?.id]);

  // Capacitor and browser lifecycle hook: immediate flush before suspension / app switch
  useEffect(() => {
    const unbind = registerLifecycleSessionListeners(
      () => {
        sessionStateRef.current.scrollPositions[activeView] = window.scrollY;
        const shouldPersistAnalysis =
          isBoundToReport ||
          isEditingExistingReport ||
          hasMeaningfulAnalysisWork(currentAnalysis, isEditingExistingReport);
        if (activeView === 'analysis' && analysisFlushHandlerRef.current) {
          analysisFlushHandlerRef.current().catch(() => {});
        }
        sessionManager.scheduleSave(
          sessionStateRef.current,
          shouldPersistAnalysis ? currentAnalysis : undefined,
          0
        );
        sessionManager.flushNow();
      },
      () => {
        // Active in-memory resume: preserve live user interface without remounting
      }
    );
    return unbind;
  }, [activeView, currentAnalysis, isBoundToReport, isEditingExistingReport]);

  // Save current active view on change (never persist untouched blank analysis forms)
  useEffect(() => {
    sessionStateRef.current.activeView = activeView;
    const shouldPersistAnalysis =
      isBoundToReport ||
      isEditingExistingReport ||
      hasMeaningfulAnalysisWork(currentAnalysis, isEditingExistingReport);
    if (!shouldPersistAnalysis) {
      sessionManager.clearPendingAnalysis();
    }
    sessionManager.scheduleSave(
      sessionStateRef.current,
      shouldPersistAnalysis ? currentAnalysis : undefined,
      300
    );
    localStorage.setItem('abmax_active_view', activeView);
  }, [activeView, currentAnalysis, isBoundToReport, isEditingExistingReport]);

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

  // If URL has recovery token (password reset link) or expired token error, open auth modal immediately
  useEffect(() => {
    if (isPasswordRecovery || isRecoveryLinkExpired) {
      setIsAuthModalOpen(true);
    }
  }, [isPasswordRecovery, isRecoveryLinkExpired]);

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

  const handleCloseReportDetails = useCallback(() => {
    setIsReportDetailsOpen(false);
    setIsOrganizedReportViewActive(false);
    if (sessionStateRef.current.reportsUI) {
      sessionStateRef.current.reportsUI.activeReportDetailsId = null;
    }
    setReportDetailsCloseTrigger((prev) => prev + 1);
  }, []);

  // Navigate helper that flushes active Analysis work, scrolls window to top, and switches view safely
  const navigateTo = useCallback(async (view: ActiveView) => {
    if (activeView === 'reports' && isReportDetailsOpen) {
      if (view === 'reports') {
        // User clicked "Reports" button in header while inside report details:
        // Closes details and returns to the Reports list!
        handleCloseReportDetails();
        return;
      } else {
        // User clicked another tab: dismiss details and proceed with navigation
        handleCloseReportDetails();
      }
    }

    if (activeView === 'analysis' && view !== 'analysis') {
      if (analysisFlushHandlerRef.current) {
        try {
          await analysisFlushHandlerRef.current();
        } catch (err) {
          console.warn('Flush before leaving analysis failed:', err);
        }
      }
      try {
        const [draft, reports] = await Promise.all([getDraft(), getAllReports()]);
        setSavedDraft(draft);
        setReportsList(reports);
      } catch {
        // Ignore refresh error on navigation
      }
    }

    if (view === 'analysis') {
      sessionStateRef.current.hasActiveAnalysisSession = true;
    }

    sessionStateRef.current.scrollPositions[activeView] = window.scrollY;
    sessionStateRef.current.activeView = view;
    setActiveView(view);
    const shouldPersistAnalysis =
      isBoundToReport ||
      isEditingExistingReport ||
      hasMeaningfulAnalysisWork(currentAnalysisRef.current, isEditingExistingReport);
    if (!shouldPersistAnalysis) {
      sessionManager.clearPendingAnalysis();
    }
    sessionManager.scheduleSave(
      sessionStateRef.current,
      shouldPersistAnalysis ? currentAnalysisRef.current : undefined,
      0
    );
    sessionManager.flushNow();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeView, handleCloseReportDetails, isBoundToReport, isEditingExistingReport, isReportDetailsOpen]);

  const currentAnalysisRef = useRef(currentAnalysis);
  useEffect(() => {
    currentAnalysisRef.current = currentAnalysis;
  }, [currentAnalysis]);

  const handleSessionUIChange = useCallback((ui: any) => {
    sessionStateRef.current.analysisUI = ui;
    const shouldPersist =
      isBoundToReport ||
      isEditingExistingReport ||
      hasMeaningfulAnalysisWork(currentAnalysisRef.current, isEditingExistingReport);
    if (!shouldPersist) {
      sessionManager.clearPendingAnalysis();
    }
    sessionManager.scheduleSave(
      sessionStateRef.current,
      shouldPersist ? currentAnalysisRef.current : undefined,
      500
    );
  }, [isBoundToReport, isEditingExistingReport]);

  const handleAnalysisDataChange = useCallback((updated: AnalysisData) => {
    setCurrentAnalysis(updated);
    currentAnalysisRef.current = updated;
    const shouldPersist =
      isBoundToReport ||
      isEditingExistingReport ||
      hasMeaningfulAnalysisWork(updated, isEditingExistingReport);
    if (!shouldPersist) {
      sessionManager.clearPendingAnalysis();
    }
    sessionManager.scheduleSave(
      sessionStateRef.current,
      shouldPersist ? updated : undefined,
      400
    );
  }, [isBoundToReport, isEditingExistingReport]);

  const handleReportsSessionChange = useCallback((ui: any) => {
    sessionStateRef.current.reportsUI = ui;
    sessionManager.scheduleSave(sessionStateRef.current, undefined, 500);
  }, []);

  const handleTradeDraftChange = useCallback((tradeDraft: any) => {
    sessionStateRef.current.tradeModalDraft = tradeDraft;
    sessionManager.scheduleSave(sessionStateRef.current, undefined, 400);
  }, []);

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

  // Keep live refs for single global Capacitor hardware backButton listener
  const activeViewRef = useRef(activeView);
  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  const isColdStartingRef = useRef(isColdStarting);
  useEffect(() => {
    isColdStartingRef.current = isColdStarting;
  }, [isColdStarting]);

  const navigateToRef = useRef(navigateTo);
  useEffect(() => {
    navigateToRef.current = navigateTo;
  }, [navigateTo]);

  // Register replace-draft dialog on back LIFO stack when open
  useEffect(() => {
    if (!showReplaceDraftDialog) return;
    return registerBackHandler(() => setShowReplaceDraftDialog(false));
  }, [showReplaceDraftDialog]);

  // Single global Android hardware back button listener:
  // 1. Dismisses topmost open drawer/modal in strict LIFO order
  // 2. Otherwise returns cleanly from any sub-view to Home (flushing active Analysis edits)
  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    let disposed = false;
    try {
      CapApp.addListener('backButton', () => {
        if (isColdStartingRef.current) {
          return;
        }
        if (dispatchTopmostBackHandler()) {
          return;
        }
        if (activeViewRef.current !== 'home') {
          void navigateToRef.current('home');
        }
      })
        .then((h) => {
          if (disposed) {
            h.remove();
          } else {
            handle = h;
          }
        })
        .catch(() => {});
    } catch {
      // Non-native environment
    }
    return () => {
      disposed = true;
      handle?.remove();
    };
  }, []);

  // Hydrate on mount: restores latest persisted working state before empty defaults or autosave can overwrite
  useEffect(() => {
    let isMounted = true;
    coldStartStartTimeRef.current = Date.now();
    setSplashStage(1);

    const slowTimer = setTimeout(() => {
      if (isMounted) setShowSlowFeedback(true);
    }, 3200);

    // Coordinate cold start launch screen to display two-stage startup for ~3s on initial launch:
    // Stage 1 (0 to ~1.4s): A emblem first
    // Stage 2 (~1.4s to ~3.0s): A emblem with "AbMax Analysis" lettering
    const stage2Timer = setTimeout(() => {
      if (isMounted) {
        setSplashStage(2);
      }
    }, 1400);

    (async () => {
      try {
        const [draft, reports, userJournalVis, userPerfVis] = await Promise.all([
          getDraft(),
          getAllReports(),
          getUserJournalVisibilityConfig(),
          getUserPerformanceVisibilityConfig(),
        ]);
        if (!isMounted) return;
        setSavedDraft(draft);
        setReportsList(reports);
        if (userJournalVis) setJournalVisibilityConfig(userJournalVis);
        if (userPerfVis) setPerformanceVisibilityConfig(userPerfVis);

        const sess = sessionStateRef.current;
        if (draft) {
          // Prefer persisted draft so unsaved edits made while bound/modifying a report survive cold restart,
          // while rejecting untouched phantom drafts whose originalId was only stamped by saveDraft().
          const restoredDraft: AnalysisData = { ...draft };
          const candidateBoundId =
            restoredDraft.originalId &&
            restoredDraft.originalId !== 'active_draft' &&
            restoredDraft.originalId !== 'draft'
              ? restoredDraft.originalId
              : sess.isBoundToReport && sess.activeReportId
              ? sess.activeReportId
              : undefined;
          const matchedReportOnDisk = candidateBoundId
            ? reports.find((r) => r.id === candidateBoundId)
            : undefined;
          const draftBound = Boolean(
            matchedReportOnDisk ||
              restoredDraft.isModified ||
              (sess.isBoundToReport && candidateBoundId && matchedReportOnDisk)
          );
          if (!draftBound && !hasMeaningfulAnalysisWork(restoredDraft, false)) {
            setSavedDraft(null);
            setIsBoundToReport(false);
            setIsEditingExistingReport(false);
            sess.isBoundToReport = false;
            sess.isEditingExistingReport = false;
            sess.hasActiveAnalysisSession = false;
            sess.activeReportId = undefined;
            clearDraft(restoredDraft.updatedAt).catch(() => {});
          } else {
            if (draftBound && candidateBoundId) {
              restoredDraft.originalId = candidateBoundId;
              restoredDraft.sourceRevision =
                restoredDraft.sourceRevision || sess.sourceRevision || restoredDraft.revision || 1;
              setIsBoundToReport(true);
              sess.isBoundToReport = true;
              sess.activeReportId = candidateBoundId;
              sess.hasActiveAnalysisSession = true;
            } else {
              setIsBoundToReport(false);
              sess.isBoundToReport = false;
              sess.activeReportId = undefined;
            }
            if (sess.isEditingExistingReport || restoredDraft.isModified) {
              setIsEditingExistingReport(true);
              sess.isEditingExistingReport = true;
            }
            setCurrentAnalysis(restoredDraft);
          }
        } else if ((sess.isEditingExistingReport || sess.isBoundToReport) && sess.activeReportId) {
          const matched = reports.find((r) => r.id === sess.activeReportId);
          if (matched) {
            const copy = JSON.parse(JSON.stringify(matched));
            copy.originalId = matched.id;
            copy.sourceRevision = matched.revision || 1;
            setCurrentAnalysis(copy);
            setIsBoundToReport(true);
            sess.isBoundToReport = true;
          } else {
            // Referenced report was deleted: clear stale binding so Home does not show a phantom session
            setIsBoundToReport(false);
            setIsEditingExistingReport(false);
            sess.isBoundToReport = false;
            sess.isEditingExistingReport = false;
            sess.activeReportId = undefined;
            sess.hasActiveAnalysisSession = false;
          }
        }

        sessionManager.setHydrated(true);

        // Restore scroll position after DOM paint
        const targetScroll = sess.scrollPositions[sess.activeView];
        if (targetScroll && targetScroll > 0) {
          restoreScrollPosition(targetScroll);
        }

        const elapsed = Date.now() - coldStartStartTimeRef.current;
        const remainingTime = Math.max(0, 3000 - elapsed);
        setTimeout(() => {
          if (isMounted) {
            clearTimeout(slowTimer);
            setSplashFadingOut(true);
            setTimeout(() => {
              if (isMounted) {
                setIsColdStarting(false);
              }
            }, 300);
          }
        }, remainingTime);
      } catch (e) {
        console.error('Failed to hydrate storage on initial mount', e);
        if (isMounted) {
          clearTimeout(slowTimer);
          setInitError((e as Error)?.message || 'Database initialization error');
          // Allow app to still render after reporting error
          setTimeout(() => {
            if (isMounted) {
              setSplashFadingOut(true);
              setTimeout(() => {
                if (isMounted) setIsColdStarting(false);
              }, 200);
            }
          }, 800);
        }
      }
    })();

    // Absolute fallback: ensure launch overlay never traps user if hydration takes unexpectedly long (>7s)
    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        setSplashFadingOut(true);
        setTimeout(() => {
          if (isMounted) setIsColdStarting(false);
        }, 300);
      }
    }, 7000);

    return () => {
      isMounted = false;
      clearTimeout(stage2Timer);
      clearTimeout(slowTimer);
      clearTimeout(safetyTimer);
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
    const userId = user?.id;
    if (userId) {
      fetchPreferencesFromCloud(userId).then((cloudPref) => {
        if (cloudPref?.preferences?.visibilityConfig) {
          setVisibilityConfig(cloudPref.preferences.visibilityConfig);
          saveUserVisibilityConfig(cloudPref.preferences.visibilityConfig);
        }
        if (cloudPref?.preferences?.journalVisibilityConfig) {
          setJournalVisibilityConfig(cloudPref.preferences.journalVisibilityConfig);
          saveUserJournalVisibilityConfig(cloudPref.preferences.journalVisibilityConfig);
        }
        if (cloudPref?.preferences?.performanceVisibilityConfig) {
          setPerformanceVisibilityConfig(cloudPref.preferences.performanceVisibilityConfig);
          saveUserPerformanceVisibilityConfig(cloudPref.preferences.performanceVisibilityConfig);
        }
      });
    }
  }, [user?.id]);

  const handleUpdateVisibilityConfig = (newCfg: WorkspaceVisibilityConfig) => {
    setVisibilityConfig(newCfg);
    saveUserVisibilityConfig(newCfg);
    setCurrentAnalysis((prev) => ({
      ...prev,
      visibilityConfig: JSON.parse(JSON.stringify(newCfg)),
    }));
    if (user) {
      uploadPreferencesToCloud(user.id, theme, {
        visibilityConfig: newCfg,
        journalVisibilityConfig,
        performanceVisibilityConfig,
      });
    }
  };

  const handleUpdateJournalVisibilityConfig = (newCfg: JournalVisibilityConfig) => {
    setJournalVisibilityConfig(newCfg);
    saveUserJournalVisibilityConfig(newCfg);
    if (user) {
      uploadPreferencesToCloud(user.id, theme, {
        visibilityConfig,
        journalVisibilityConfig: newCfg,
        performanceVisibilityConfig,
      });
    }
  };

  const handleUpdatePerformanceVisibilityConfig = (newCfg: PerformanceVisibilityConfig) => {
    setPerformanceVisibilityConfig(newCfg);
    saveUserPerformanceVisibilityConfig(newCfg);
    if (user) {
      uploadPreferencesToCloud(user.id, theme, {
        visibilityConfig,
        journalVisibilityConfig,
        performanceVisibilityConfig: newCfg,
      });
    }
  };

  const handleOpenSettingsWithTab = (
    tab: 'general' | 'theme' | 'admin' | 'journal_visibility' | 'performance_visibility' = 'general'
  ) => {
    setSettingsInitialTab(tab);
    setIsSettingsModalOpen(true);
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

  const isSavedDraftBoundToReport = Boolean(
    savedDraft &&
      (savedDraft.isModified ||
        (savedDraft.originalId &&
          reportsList.some((r) => r.id === savedDraft.originalId)))
  );

  const hasResumableSession = Boolean(
    (savedDraft &&
      hasMeaningfulAnalysisWork(savedDraft, isSavedDraftBoundToReport)) ||
      (sessionStateRef.current.hasActiveAnalysisSession &&
        (isBoundToReport ||
          isEditingExistingReport ||
          hasMeaningfulAnalysisWork(currentAnalysis, isEditingExistingReport)))
  );

  // Start fresh analysis
  const handleStartAnalysisClick = () => {
    if (hasResumableSession) {
      setShowReplaceDraftDialog(true);
    } else {
      const fresh = createInitialAnalysisData('XAUUSD', visibilityConfig);
      setCurrentAnalysis(fresh);
      setIsEditingExistingReport(false);
      setIsBoundToReport(false);
      sessionStateRef.current.isEditingExistingReport = false;
      sessionStateRef.current.isBoundToReport = false;
      sessionStateRef.current.hasActiveAnalysisSession = true;
      sessionStateRef.current.activeReportId = undefined;
      sessionStateRef.current.sourceRevision = undefined;
      sessionStateRef.current.analysisUI = undefined;
      navigateTo('analysis');
    }
  };

  const confirmStartFreshAnalysis = async () => {
    sessionManager.clearPendingAnalysis();
    await clearDraft();
    setSavedDraft(null);
    const fresh = createInitialAnalysisData('XAUUSD', visibilityConfig);
    setCurrentAnalysis(fresh);
    setIsEditingExistingReport(false);
    setIsBoundToReport(false);
    sessionStateRef.current.isEditingExistingReport = false;
    sessionStateRef.current.isBoundToReport = false;
    sessionStateRef.current.hasActiveAnalysisSession = true;
    sessionStateRef.current.activeReportId = undefined;
    sessionStateRef.current.sourceRevision = undefined;
    sessionStateRef.current.analysisUI = undefined;
    sessionManager.scheduleSave(sessionStateRef.current, undefined, 0);
    sessionManager.flushNow();
    setShowReplaceDraftDialog(false);
    navigateTo('analysis');
  };

  // Continue existing analysis: preserves content and editing/bound context (source report ID and revision)
  const handleContinueAnalysis = async () => {
    const draft = await getDraft();
    if (draft) {
      const draftBoundToSaved = Boolean(
        draft.isModified ||
          (draft.originalId && reportsList.some((r) => r.id === draft.originalId))
      );
      const isModifying = Boolean(
        sessionStateRef.current.isEditingExistingReport ||
          (draft as any).isEditingExistingReport ||
          ((draft as any).originalId && (draft as any).isModified)
      );
      const isBound = Boolean(
        isModifying ||
          sessionStateRef.current.isBoundToReport ||
          draftBoundToSaved
      );
      const activeId = isBound
        ? sessionStateRef.current.activeReportId ||
          (draft as any).originalId ||
          draft.id
        : undefined;
      const sourceRev =
        sessionStateRef.current.sourceRevision ||
        (draft as any).sourceRevision ||
        (draft as any).revision ||
        1;
      setCurrentAnalysis(draft);
      setIsEditingExistingReport(isModifying);
      setIsBoundToReport(isBound);
      sessionStateRef.current.isEditingExistingReport = isModifying;
      sessionStateRef.current.isBoundToReport = isBound;
      sessionStateRef.current.hasActiveAnalysisSession = true;
      sessionStateRef.current.activeReportId = activeId;
      sessionStateRef.current.sourceRevision = isBound ? sourceRev : undefined;
      navigateTo('analysis');
      return;
    }

    const fallbackReportId = sessionStateRef.current.activeReportId;
    if (fallbackReportId) {
      const matched = await getReportById(fallbackReportId);
      if (matched) {
        const copy = JSON.parse(JSON.stringify(matched));
        copy.originalId = matched.id;
        copy.sourceRevision = matched.revision || 1;
        setCurrentAnalysis(copy);
        setIsEditingExistingReport(sessionStateRef.current.isEditingExistingReport);
        setIsBoundToReport(true);
        sessionStateRef.current.isBoundToReport = true;
        sessionStateRef.current.hasActiveAnalysisSession = true;
        navigateTo('analysis');
        return;
      }
    }

    handleStartAnalysisClick();
  };

  // When a report is saved and navigated to View Report
  const handleReportSavedSuccessfully = async (savedReportId?: string) => {
    await refreshStorageData();
    const targetReportId = savedReportId || sessionStateRef.current.activeReportId;
    setIsEditingExistingReport(false);
    setIsBoundToReport(false);
    sessionStateRef.current.isEditingExistingReport = false;
    sessionStateRef.current.isBoundToReport = false;
    sessionStateRef.current.hasActiveAnalysisSession = false;
    sessionStateRef.current.activeReportId = undefined;
    sessionStateRef.current.sourceRevision = undefined;
    sessionStateRef.current.analysisUI = undefined;

    if (targetReportId) {
      sessionStateRef.current.reportsUI = {
        selectedPair: sessionStateRef.current.reportsUI?.selectedPair || 'All',
        searchQuery: sessionStateRef.current.reportsUI?.searchQuery || '',
        activeReportDetailsId: targetReportId,
      };
    }
    sessionManager.scheduleSave(sessionStateRef.current, undefined, 0);
    sessionManager.flushNow();
    navigateTo('reports');
  };

  // Modify report from Reports view: loads all data into Analysis view with authoritative editing context
  const handleModifyReport = async (report: SavedReport) => {
    const reportCopy = JSON.parse(JSON.stringify(report));
    reportCopy.originalId = report.id;
    reportCopy.sourceRevision = report.revision || 1;
    reportCopy.isModified = true;
    setCurrentAnalysis(reportCopy);
    setIsEditingExistingReport(true);
    setIsBoundToReport(true);
    sessionStateRef.current.isEditingExistingReport = true;
    sessionStateRef.current.isBoundToReport = true;
    sessionStateRef.current.hasActiveAnalysisSession = true;
    sessionStateRef.current.activeReportId = report.id;
    sessionStateRef.current.sourceRevision = report.revision || 1;
    await saveDraft(reportCopy).catch(console.error);
    sessionManager.scheduleSave(sessionStateRef.current, reportCopy, 0);
    sessionManager.flushNow();
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
        hasUnsavedDraft={hasResumableSession}
        hidden={isOrganizedReportViewActive}
        isReportDetailsOpen={isReportDetailsOpen}
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
            hasDraft={hasResumableSession}
            isAnimationPaused={isAnimationPaused}
            draftSummary={
              savedDraft && hasResumableSession
                ? {
                    pair: savedDraft.pair,
                    date: savedDraft.date,
                    time: savedDraft.time,
                  }
                : hasResumableSession
                ? {
                    pair: currentAnalysis.pair,
                    date: currentAnalysis.date,
                    time: currentAnalysis.time,
                  }
                : null
            }
          />
        )}

        {activeView === 'analysis' && (
          <AnalysisView
            initialData={currentAnalysis}
            isEditingExistingReport={isEditingExistingReport}
            initialIsBoundReport={isBoundToReport}
            registerFlushHandler={(fn) => {
              analysisFlushHandlerRef.current = fn;
            }}
            onEditingExistingChange={(val) => {
              setIsEditingExistingReport(val);
              sessionStateRef.current.isEditingExistingReport = val;
            }}
            onBoundReportChange={(bound, activeId) => {
              setIsBoundToReport(bound);
              sessionStateRef.current.isBoundToReport = bound;
              sessionStateRef.current.activeReportId = activeId;
              sessionManager.scheduleSave(sessionStateRef.current, currentAnalysisRef.current, 0);
              sessionManager.flushNow();
            }}
            onNavigateHome={() => {
              navigateTo('home');
            }}
            onReportSavedSuccessfully={handleReportSavedSuccessfully}
            workspaceVisibility={visibilityConfig}
            initialSessionUI={sessionStateRef.current.analysisUI}
            onSessionUIChange={handleSessionUIChange}
            onAnalysisDataChange={handleAnalysisDataChange}
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
            initialSession={sessionStateRef.current.reportsUI}
            onSessionChange={handleReportsSessionChange}
            initialTradeDraft={sessionStateRef.current.tradeModalDraft}
            onTradeDraftChange={handleTradeDraftChange}
            reportDetailsCloseTrigger={reportDetailsCloseTrigger}
            onReportDetailsStateChange={(isOpen, isOrganized) => {
              setIsReportDetailsOpen(isOpen);
              setIsOrganizedReportViewActive(isOrganized);
            }}
            onNavigateToJournal={() => navigateTo('journal')}
            onNavigateToPerformance={() => navigateTo('performance')}
          />
        )}

        {activeView === 'live' && (
          <LiveView
            userId={user?.id}
            onOpenReport={(reportId) => {
              const matched = reportsList.find((r) => r.id === reportId);
              sessionStateRef.current.reportsUI = {
                selectedPair: matched?.pair || 'All',
                searchQuery: '',
                activeReportDetailsId: reportId,
              };
              navigateTo('reports');
            }}
          />
        )}

        {activeView === 'journal' && (
          <JournalView
            reportsList={reportsList}
            onOpenReport={(reportId) => {
              const matched = reportsList.find((r) => r.id === reportId);
              sessionStateRef.current.reportsUI = {
                selectedPair: matched?.pair || 'All',
                searchQuery: '',
                activeReportDetailsId: reportId,
              };
              navigateTo('reports');
            }}
            userId={user?.id}
            journalVisibilityConfig={journalVisibilityConfig}
            onOpenSettings={handleOpenSettingsWithTab}
          />
        )}

        {activeView === 'performance' && (
          <PerformanceView
            reportsList={reportsList}
            onOpenReport={(reportId) => {
              const matched = reportsList.find((r) => r.id === reportId);
              sessionStateRef.current.reportsUI = {
                selectedPair: matched?.pair || 'All',
                searchQuery: '',
                activeReportDetailsId: reportId,
              };
              navigateTo('reports');
            }}
            userId={user?.id}
            performanceVisibilityConfig={performanceVisibilityConfig}
            onOpenSettings={handleOpenSettingsWithTab}
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
        journalVisibilityConfig={journalVisibilityConfig}
        onChangeJournalVisibilityConfig={handleUpdateJournalVisibilityConfig}
        performanceVisibilityConfig={performanceVisibilityConfig}
        onChangePerformanceVisibilityConfig={handleUpdatePerformanceVisibilityConfig}
        initialTab={settingsInitialTab}
      />

      {/* Local to Cloud Journal Migration Modal */}
      <MigrationModal
        isOpen={isMigrationModalOpen}
        onClose={() => setIsMigrationModalOpen(false)}
        onMigrationComplete={() => {
          refreshStorageData();
        }}
      />

      {/* Cold Launch / Full Restart Startup Screen (Shown on cold start only) */}
      {isColdStarting && (
        <div
          role="dialog"
          aria-label="AbMax Analysis Launch Screen"
          aria-modal="true"
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#000000] select-none transition-opacity duration-300 ${
            splashFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
            {/* Stage 1: A emblem first */}
            <div
              className={`absolute inset-0 flex items-center justify-center p-4 transition-opacity duration-500 ${
                splashStage === 1 ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <img
                src="/abmax-hero.png"
                alt="AbMax Analysis Emblem"
                className="w-44 h-44 sm:w-56 sm:h-56 max-h-[50vh] max-w-[280px] object-contain drop-shadow-2xl"
              />
            </div>

            {/* Stage 2: A emblem with "AbMax Analysis" lettering */}
            <div
              className={`absolute inset-0 flex items-center justify-center p-4 transition-opacity duration-500 ${
                splashStage === 2 ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <img
                src="/abmax-startup.png"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (!img.src.includes('/splash-launch.png')) {
                    img.src = '/splash-launch.png';
                  }
                }}
                alt="AbMax Analysis"
                className="w-full h-full max-h-[90vh] max-w-[480px] object-contain"
              />
            </div>

            {showSlowFeedback && !initError && (
              <div className="absolute bottom-8 flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900/90 border border-slate-700 text-slate-300 text-xs shadow-lg backdrop-blur-md z-10">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>Restoring session workspace...</span>
              </div>
            )}
            {initError && (
              <div className="absolute bottom-8 flex flex-col items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-950/90 border border-rose-800 text-rose-200 text-xs shadow-xl max-w-sm text-center z-10">
                <span>Failed to initialize workspace data: {initError}</span>
                <button
                  type="button"
                  onClick={() => setIsColdStarting(false)}
                  className="mt-1 px-3 py-1 bg-rose-700 hover:bg-rose-600 rounded text-white font-semibold text-xs transition-colors cursor-pointer"
                >
                  Continue to App
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="ABMAX Analysis encountered a display issue">
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
