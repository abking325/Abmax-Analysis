import { Capacitor } from '@capacitor/core';
import { getDraft, saveDraft } from './db';
import { AnalysisData } from '../types/journal';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let updateWaitingWorker: ServiceWorker | null = null;
const updateListeners = new Set<(available: boolean) => void>();
const installListeners = new Set<(canInstall: boolean) => void>();

/**
 * Registers the service worker only in browser environments (disabled in native Capacitor APK).
 */
export function registerPwaServiceWorker(): void {
  // CRITICAL: Disable website service-worker registration inside Capacitor APK where it would interfere with bundled assets
  if (Capacitor.isNativePlatform()) {
    console.info('[PWA] Running on native Capacitor platform. Service worker registration disabled to preserve bundled local assets.');
    return;
  }

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.info('[PWA] ServiceWorker registered with scope:', registration.scope);

        // Check if an updated worker is already waiting
        if (registration.waiting) {
          updateWaitingWorker = registration.waiting;
          notifyUpdateAvailable(true);
        }

        // Listen for new updates found
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available and will be used when all tabs close or on skipWaiting
              updateWaitingWorker = newWorker;
              notifyUpdateAvailable(true);
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[PWA] ServiceWorker registration failed:', error);
      });

    // Handle controller change (when new SW takes control)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });

  // Capture beforeinstallprompt event for install guidance
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyInstallable(true);
  });

  // Track appinstalled event
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstallable(false);
    console.info('[PWA] ABMAX Analysis installed successfully to home screen.');
  });
}

function notifyUpdateAvailable(available: boolean): void {
  for (const listener of updateListeners) {
    try {
      listener(available);
    } catch (e) {
      console.warn('[PWA] Update listener error:', e);
    }
  }
}

function notifyInstallable(canInstall: boolean): void {
  for (const listener of installListeners) {
    try {
      listener(canInstall);
    } catch (e) {
      console.warn('[PWA] Install listener error:', e);
    }
  }
}

export function onUpdateAvailable(callback: (available: boolean) => void): () => void {
  updateListeners.add(callback);
  if (updateWaitingWorker) {
    callback(true);
  }
  return () => {
    updateListeners.delete(callback);
  };
}

export function onInstallable(callback: (canInstall: boolean) => void): () => void {
  installListeners.add(callback);
  if (deferredPrompt) {
    callback(true);
  }
  return () => {
    installListeners.delete(callback);
  };
}

/**
 * Triggers the native install prompt dialog.
 */
export async function promptPwaInstall(): Promise<boolean> {
  if (!deferredPrompt) {
    return false;
  }
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    notifyInstallable(false);
    return outcome === 'accepted';
  } catch (err) {
    console.warn('[PWA] Failed to show install prompt:', err);
    return false;
  }
}

/**
 * Applies a pending update safely:
 * - Awaits persisting current work so no unsaved edits are lost.
 * - Activates the waiting service worker.
 */
export async function applyPwaUpdate(persistWorkCallback?: () => Promise<void>): Promise<void> {
  try {
    if (persistWorkCallback) {
      await persistWorkCallback();
    }
  } catch (err) {
    console.warn('[PWA] Error persisting work before update:', err);
  }

  if (updateWaitingWorker) {
    updateWaitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}
