import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  inline?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught unhandled component error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.inline) {
        return (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-800 dark:text-rose-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{this.props.fallbackTitle || 'Component encountered an error'}</span>
            </div>
            <p className="text-[11px] text-rose-700 dark:text-rose-300">
              {this.state.error?.message || 'An unexpected issue occurred.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded text-xs transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        );
      }

      return (
        <div className="min-h-[220px] flex items-center justify-center p-6 text-center">
          <div className="max-w-md w-full bg-app-main border border-app rounded-xl p-6 shadow-xl space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-app-main">
                {this.props.fallbackTitle || 'Something went wrong in this view'}
              </h3>
              <p className="text-xs text-app-secondary mt-1">
                Your data is safe in local storage. Click below to recover without reloading.
              </p>
              {this.state.error?.message && (
                <div className="mt-3 p-2 bg-app-field border border-app rounded text-[11px] font-mono text-app-secondary text-left overflow-x-auto">
                  {this.state.error.message}
                </div>
              )}
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-theme hover:bg-emerald-700 text-white font-semibold rounded-md text-xs transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recover View
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
