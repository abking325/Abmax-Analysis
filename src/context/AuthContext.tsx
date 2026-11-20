import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import {
  supabase,
  isSupabaseConfigured,
  getAppRedirectUrl,
  getOAuthRedirectUrl,
  REMEMBER_ME_STORAGE_KEY,
} from '../services/supabase';
import { parseOAuthCallbackParams } from '../utils/authErrorUtils';

const OAUTH_RETURN_VIEW_KEY = 'abmax_oauth_return_view';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsEmailConfirmation?: boolean }>;
  verifySignupOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>;
  resendSignupOtp: (email: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: (returnView?: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  isRecoveryLinkExpired: boolean;
  clearRecoveryLinkExpired: () => void;
  oauthError: string | null;
  clearOAuthError: () => void;
  isGoogleAuthInFlight: boolean;
  consumeOAuthReturnView: () => string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function scrubWebAuthUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const cleanUrl = window.location.pathname || '/';
  window.history.replaceState(null, '', cleanUrl);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [isRecoveryLinkExpired, setIsRecoveryLinkExpired] = useState(false);
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [isGoogleAuthInFlight, setIsGoogleAuthInFlight] = useState(false);

  const processedUrlsRef = React.useRef<Set<string>>(new Set());
  const oauthInFlightRef = React.useRef<boolean>(false);
  const browserFinishTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const setGoogleAuthInFlightState = React.useCallback((val: boolean) => {
    oauthInFlightRef.current = val;
    setIsGoogleAuthInFlight(val);
  }, []);

  const handleDeepLinkUrl = React.useCallback(
    async (url: string) => {
      if (!url || !supabase) return;
      if (processedUrlsRef.current.has(url)) return;

      const parsed = parseOAuthCallbackParams(url);
      if (!parsed.hasAuthPayload && !url.includes('auth/callback')) {
        return;
      }

      processedUrlsRef.current.add(url);
      if (browserFinishTimerRef.current) {
        clearTimeout(browserFinishTimerRef.current);
        browserFinishTimerRef.current = null;
      }

      try {
        await Browser.close().catch(() => {});
      } catch {
        // Safe ignore on web or unsupported environment
      }

      if (parsed.type === 'recovery') {
        setIsPasswordRecovery(true);
        setGoogleAuthInFlightState(false);
        return;
      }

      if (parsed.error || parsed.errorCode || parsed.errorDescription) {
        const combined = `${parsed.error || ''} ${parsed.errorCode || ''} ${parsed.errorDescription || ''}`.toLowerCase();
        if (combined.includes('otp_expired') || combined.includes('email+link') || combined.includes('email link')) {
          setIsRecoveryLinkExpired(true);
        } else if (parsed.error === 'access_denied' && !url.includes('auth/callback') && combined.includes('otp')) {
          setIsRecoveryLinkExpired(true);
        } else if (parsed.error === 'access_denied' || combined.includes('cancelled')) {
          setOAuthError('oauth_cancelled: Google sign-in was cancelled.');
        } else {
          setOAuthError(parsed.errorDescription || parsed.error || parsed.errorCode || 'Google sign-in failed.');
        }
        setGoogleAuthInFlightState(false);
        return;
      }

      try {
        if (parsed.accessToken && parsed.refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: parsed.accessToken,
            refresh_token: parsed.refreshToken,
          });
          if (error) {
            setOAuthError(error.message);
          } else if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
            setOAuthError(null);
          }
        } else if (parsed.code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code);
          if (error) {
            setOAuthError(error.message);
          } else if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
            setOAuthError(null);
          }
        }
      } catch (err) {
        setOAuthError((err as Error)?.message || 'Failed to complete Google sign-in.');
      } finally {
        setGoogleAuthInFlightState(false);
      }
    },
    [setGoogleAuthInFlightState]
  );

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isRecoveryFromUrl = false;
    let shouldScrubWebUrl = false;

    // Inspect initial Web URL for OAuth callback, error, or password recovery parameters
    if (typeof window !== 'undefined') {
      const parsed = parseOAuthCallbackParams(window.location.href);
      if (parsed.type === 'recovery') {
        isRecoveryFromUrl = true;
        setIsPasswordRecovery(true);
      } else if (parsed.error || parsed.errorCode || parsed.errorDescription) {
        const combined = `${parsed.error || ''} ${parsed.errorCode || ''} ${parsed.errorDescription || ''}`.toLowerCase();
        if (
          combined.includes('otp_expired') ||
          combined.includes('email link') ||
          (parsed.error === 'access_denied' && combined.includes('otp'))
        ) {
          setIsRecoveryLinkExpired(true);
        } else if (parsed.error === 'access_denied' || combined.includes('cancelled')) {
          setOAuthError('oauth_cancelled: Google sign-in was cancelled.');
        } else {
          setOAuthError(parsed.errorDescription || parsed.error || parsed.errorCode || 'Google sign-in failed.');
        }
        shouldScrubWebUrl = true;
      } else if (parsed.code || parsed.accessToken) {
        shouldScrubWebUrl = true;
      }

      if (shouldScrubWebUrl && !(parsed.code || parsed.accessToken)) {
        scrubWebAuthUrl();
      }
    }

    // Initial session extraction (Supabase detectSessionInUrl handles PKCE ?code or #access_token on web)
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (error && !isRecoveryFromUrl) {
        setOAuthError(error.message);
      }
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      setLoading(false);
      if (typeof window !== 'undefined') {
        const parsedNow = parseOAuthCallbackParams(window.location.href);
        if (parsedNow.hasAuthPayload && !isRecoveryFromUrl) {
          scrubWebAuthUrl();
        }
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);

      if (event === 'SIGNED_IN') {
        setOAuthError(null);
        setGoogleAuthInFlightState(false);
      }

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      if (typeof window !== 'undefined') {
        const parsedNow = parseOAuthCallbackParams(window.location.href);
        if (parsedNow.hasAuthPayload && parsedNow.type !== 'recovery') {
          scrubWebAuthUrl();
        }
      }
    });

    // Capacitor native listeners for OAuth callback return & browser cancellation
    let appUrlPluginHandle: { remove: () => void } | null = null;
    let browserFinishHandle: { remove: () => void } | null = null;
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      App.getLaunchUrl()
        .then((launch) => {
          if (launch?.url) {
            handleDeepLinkUrl(launch.url);
          }
        })
        .catch(() => {});

      App.addListener('appUrlOpen', ({ url }) => {
        handleDeepLinkUrl(url);
      }).then((handle) => {
        appUrlPluginHandle = handle;
      });

      Browser.addListener('browserFinished', () => {
        if (!oauthInFlightRef.current) return;
        if (browserFinishTimerRef.current) {
          clearTimeout(browserFinishTimerRef.current);
        }
        // Wait briefly in case appUrlOpen arrives right alongside browserFinished
        browserFinishTimerRef.current = setTimeout(() => {
          if (oauthInFlightRef.current) {
            setGoogleAuthInFlightState(false);
            setOAuthError('oauth_cancelled: Google sign-in was cancelled.');
          }
        }, 650);
      })
        .then((handle) => {
          browserFinishHandle = handle;
        })
        .catch(() => {});
    }

    return () => {
      subscription.unsubscribe();
      appUrlPluginHandle?.remove();
      browserFinishHandle?.remove();
      if (browserFinishTimerRef.current) {
        clearTimeout(browserFinishTimerRef.current);
      }
    };
  }, [handleDeepLinkUrl, setGoogleAuthInFlightState]);

  const signIn = async (email: string, password: string, rememberMe: boolean = true) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured in environment variables.',
        } as AuthError,
      };
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(REMEMBER_ME_STORAGE_KEY, String(rememberMe));
      } catch {
        // safe fallback
      }
    }

    const res = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: res.error };
  };

  const signUp = async (email: string, password: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured in environment variables.',
        } as AuthError,
      };
    }
    const redirectUrl = getAppRedirectUrl();
    const res = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    const needsEmailConfirmation = Boolean(res.data?.user && !res.data?.session);
    return { error: res.error, needsEmailConfirmation };
  };

  const verifySignupOtp = async (email: string, token: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured in environment variables.',
        } as AuthError,
      };
    }
    const cleanEmail = email.trim();
    const cleanToken = token.trim();
    let res = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'signup',
    });
    if (
      res.error &&
      (res.error.message.toLowerCase().includes('type') ||
        res.error.message.toLowerCase().includes('invalid'))
    ) {
      const fallback = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'email',
      });
      if (!fallback.error) {
        res = fallback;
      }
    }
    if (!res.error && res.data.session) {
      setSession(res.data.session);
      setUser(res.data.session.user);
    }
    return { error: res.error };
  };

  const resendSignupOtp = async (email: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured.',
        } as AuthError,
      };
    }
    const redirectUrl = getAppRedirectUrl();
    const res = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    return { error: res.error };
  };

  const signInWithGoogle = async (returnView?: string): Promise<{ error: AuthError | null }> => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured.',
        } as AuthError,
      };
    }

    if (oauthInFlightRef.current) {
      return { error: null };
    }

    setOAuthError(null);
    setGoogleAuthInFlightState(true);

    if (typeof window !== 'undefined' && returnView) {
      try {
        window.sessionStorage.setItem(OAUTH_RETURN_VIEW_KEY, returnView);
      } catch {
        // safe ignore
      }
    }

    try {
      const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();
      const redirectUrl = getOAuthRedirectUrl(isNative);

      if (isNative) {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
            queryParams: {
              prompt: 'select_account',
            },
          },
        });
        if (error) {
          setGoogleAuthInFlightState(false);
          return { error };
        }
        if (data?.url) {
          await Browser.open({ url: data.url, presentationStyle: 'popover' });
        } else {
          setGoogleAuthInFlightState(false);
        }
        return { error: null };
      } else {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            queryParams: {
              prompt: 'select_account',
            },
          },
        });
        if (error || !data?.url) {
          setGoogleAuthInFlightState(false);
        }
        return { error };
      }
    } catch (err) {
      setGoogleAuthInFlightState(false);
      return {
        error: {
          name: 'GoogleAuthError',
          message: (err as Error).message || 'Google sign-in could not be initiated.',
        } as AuthError,
      };
    }
  };

  const signOut = async () => {
    if (!supabase) return { error: null };
    const res = await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('abmax_supabase_auth');
        window.sessionStorage.removeItem('abmax_supabase_auth');
      } catch {
        // safe fallback
      }
    }
    return { error: res.error };
  };

  const resetPassword = async (email: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured.',
        } as AuthError,
      };
    }
    const redirectUrl = getAppRedirectUrl();
    const res = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectUrl,
    });
    return { error: res.error };
  };

  const updatePassword = async (newPassword: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured.',
        } as AuthError,
      };
    }
    const {
      data: { session: activeSession },
    } = await supabase.auth.getSession();
    if (!activeSession) {
      return {
        error: {
          name: 'NoRecoverySession',
          message:
            'Your password reset session has expired or is invalid. Please request a new password reset link.',
        } as AuthError,
      };
    }
    const res = await supabase.auth.updateUser({ password: newPassword });
    if (!res.error) {
      setIsPasswordRecovery(false);
      scrubWebAuthUrl();
    }
    return { error: res.error };
  };

  const clearPasswordRecovery = () => {
    setIsPasswordRecovery(false);
    scrubWebAuthUrl();
  };

  const clearRecoveryLinkExpired = () => {
    setIsRecoveryLinkExpired(false);
  };

  const clearOAuthError = () => {
    setOAuthError(null);
  };

  const consumeOAuthReturnView = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      const val = window.sessionStorage.getItem(OAUTH_RETURN_VIEW_KEY);
      if (val) {
        window.sessionStorage.removeItem(OAUTH_RETURN_VIEW_KEY);
        return val;
      }
      return null;
    } catch {
      return null;
    }
  };

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      isConfigured: isSupabaseConfigured,
      signIn,
      signUp,
      verifySignupOtp,
      resendSignupOtp,
      signInWithGoogle,
      signOut,
      resetPassword,
      updatePassword,
      isPasswordRecovery,
      clearPasswordRecovery,
      isRecoveryLinkExpired,
      clearRecoveryLinkExpired,
      oauthError,
      clearOAuthError,
      isGoogleAuthInFlight,
      consumeOAuthReturnView,
    }),
    [user, session, loading, isPasswordRecovery, isRecoveryLinkExpired, oauthError, isGoogleAuthInFlight]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

