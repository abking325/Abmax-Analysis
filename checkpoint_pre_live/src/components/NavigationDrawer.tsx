import React, { useEffect, useRef } from 'react';
import {
  BookOpen,
  TrendingUp,
  Settings,
  X,
  ChevronRight,
} from 'lucide-react';
import { ActiveView } from './Header';

interface NavigationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
  onOpenSettings: () => void;
}

export const NavigationDrawer: React.FC<NavigationDrawerProps> = ({
  isOpen,
  onClose,
  activeView,
  onNavigate,
  onOpenSettings,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Android back button support via Capacitor
    interface PluginHandle {
      remove: () => Promise<void>;
    }
    let capHandle: PluginHandle | null = null;
    interface CapacitorWindow extends Window {
      Capacitor?: {
        isPluginAvailable?: (name: string) => boolean;
      };
    }
    const capWin = window as CapacitorWindow;
    if (typeof window !== 'undefined' && capWin.Capacitor?.isPluginAvailable?.('App')) {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('backButton', () => {
          onClose();
        }).then((h: PluginHandle) => {
          capHandle = h;
        }).catch(() => {});
      }).catch(() => {});
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (capHandle) {
        capHandle.remove().catch(() => {});
      }
      if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === 'function') {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleItemClick = (action: () => void) => {
    action();
    onClose();
  };

  const navItems = [
    {
      id: 'journal' as ActiveView,
      label: 'Journal',
      description: 'Trading journal, personal notes, and strategies',
      icon: BookOpen,
      onClick: () => handleItemClick(() => onNavigate('journal')),
    },
    {
      id: 'performance' as ActiveView,
      label: 'Performance',
      description: 'Execution quality, rule discipline, and setup breakdown',
      icon: TrendingUp,
      onClick: () => handleItemClick(() => onNavigate('performance')),
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Navigation Menu"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <div
        ref={drawerRef}
        className="w-full max-w-[320px] h-full bg-app-main border-l border-app shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div>
          <div className="flex items-center justify-between px-5 py-4 border-b border-app bg-app-secondary/60">
            <div className="flex flex-col">
              <span className="font-extrabold text-[20px] leading-tight text-emerald-theme tracking-tight">
                AbMax
              </span>
              <span className="text-[10px] font-semibold tracking-[0.16em] uppercase text-app-secondary">
                Navigation
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="w-9 h-9 min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-app-secondary hover:text-app-main hover:bg-app-field transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="p-3 space-y-1" aria-label="App Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-lg text-left transition-colors cursor-pointer group ${
                    isActive
                      ? 'bg-emerald-pale text-emerald-theme font-semibold shadow-2xs'
                      : 'text-app-main hover:bg-app-field hover:text-app-main'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-theme'
                          : 'bg-app-field text-app-secondary group-hover:text-app-main'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium leading-tight">{item.label}</div>
                      <div className="text-[11px] text-app-secondary truncate mt-0.5">
                        {item.description}
                      </div>
                    </div>
                  </div>

                  <ChevronRight
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isActive ? 'text-emerald-theme translate-x-0.5' : 'text-app-secondary opacity-40 group-hover:opacity-100'
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Drawer Zone: Settings */}
        <div className="p-3 border-t border-app bg-app-secondary/30">
          <button
            type="button"
            onClick={() => handleItemClick(onOpenSettings)}
            className="w-full flex items-center justify-between px-3.5 py-3 rounded-lg text-left text-app-main hover:bg-app-field hover:text-app-main transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-app-field flex items-center justify-center text-app-secondary group-hover:text-app-main shrink-0">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-medium leading-tight">Settings</div>
                <div className="text-[11px] text-app-secondary mt-0.5">
                  Preferences, visibility, account &amp; backup
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-app-secondary opacity-40 group-hover:opacity-100 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};
