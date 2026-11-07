import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { supabase, isSupabaseConfigured, getAppRedirectUrl, REMEMBER_ME_STORAGE_KEY } from '../services/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsEmailConfirmation?: boolean }>;
  verifySignupOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>;
  resendSignupOtp: (email: string) => Promise<{ error: AuthError | null }>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  isRecoveryLinkExpired: boolean;
  clearRecoveryLinkExpired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [isRecoveryLinkExpired, setIsRecoveryLinkExpired] = useState(false);

  const processedUrlsRef = React.useRef<Set<string>>(new Set());

  const handleDeepLinkUrl = React.useCallback(async (url: string) => {
    if (!url || !supabase) return;
    if (processedUrlsRef.current.has(url)) return;
    processedUrlsRef.current.add(url);

    try {
      await Browser.close().catch(() => {});
    } catch {
      // safe ignore
    }

    // Check if password recovery deep link or expired token
    if (url.includes('type=recovery')) {
      setIsPasswordRecovery(true);
    } else if (
      url.includes('error_code=otp_expired') ||
      url.includes('error=access_denied') ||
      url.includes('otp_expired')
    ) {
      setIsRecoveryLinkExpired(true);
    }

    // Process OAuth tokens or code from deep link callback
    if (url.includes('access_token=') || url.includes('code=')) {
      const hashOrSearch = url.includes('#') ? url.split('#')[1] : url.split('?')[1] || '';
      const params = new URLSearchParams(hashOrSearch);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');

      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error && data.session) {
          setSession(data.session);
          setUser(data.session.user);
        }
      } else if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error && data.session) {
          setSession(data.session);
          setUser(data.session.user);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Inspect URL for password recovery or expired link tokens on Web
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const fullUrlParams = hash + search;

      if (
        fullUrlParams.includes('error_code=otp_expired') ||
        fullUrlParams.includes('error=access_denied') ||
        fullUrlParams.includes('Email+link+is+invalid') ||
        fullUrlParams.includes('otp_expired')
      ) {
        setIsRecoveryLinkExpired(true);
        // Clean error tokens from address bar without exposing tokens in history
        window.history.replaceState(null, '', window.location.pathname);
      } else if (fullUrlParams.includes('type=recovery')) {
        setIsPasswordRecovery(true);
      }
    }

    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      // Clean tokens from address bar only after session extraction completes
      if (typeof window !== 'undefined' && (window.location.hash || window.location.search.includes('code='))) {
        if (!window.location.hash.includes('type=recovery')) {
          window.history.replaceState(null, '', window.location.pathname);
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

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      // Secure address bar cleanup after Supabase handles authentication tokens
      if (typeof window !== 'undefined' && window.location.hash && !window.location.hash.includes('type=recovery')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    });

    // Capacitor native URL listener for OAuth return & password recovery deep links
    let appUrlPluginHandle: { remove: () => void } | null = null;
    if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
      // Check cold-start launch URL
      App.getLaunchUrl()
        .then((launch) => {
          if (launch?.url) {
            handleDeepLinkUrl(launch.url);
          }
        })
        .catch(() => {});

      // Listen for runtime deep link open
      App.addListener('appUrlOpen', ({ url }) => {
        handleDeepLinkUrl(url);
      }).then((handle) => {
        appUrlPluginHandle = handle;
      });
    }

    return () => {
      subscription.unsubscribe();
      appUrlPluginHandle?.remove();
    };
  }, [handleDeepLinkUrl]);

  const signIn = async (email: string, password: string, rememberMe: boolean = true) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured in environment variables.',
        } as AuthError,
      };
    }

    // Persist remember preference for the auth storage adapter
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

  const signInWithGoogle = async (): Promise<{ error: AuthError | null }> => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured.',
        } as AuthError,
      };
    }

    try {
      const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();
      const redirectUrl = isNative
        ? 'com.abmax.analysis://auth/callback'
        : getAppRedirectUrl();

      if (isNative) {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
            skipBrowserRedirect: true,
          },
        });
        if (error) {
          if (
            error.message?.toLowerCase().includes('not enabled') ||
            error.message?.toLowerCase().includes('unsupported')
          ) {
            return {
              error: new AuthError(
                'Google sign-in is not yet enabled in the Supabase project. Please sign in with email/password or enable Google provider in the Supabase Dashboard.'
              ),
            };
          }
          return { error };
        }
        if (data?.url) {
          await Browser.open({ url: data.url, windowName: '_system' });
        }
        return { error: null };
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
          },
        });
        if (error) {
          if (
            error.message?.toLowerCase().includes('not enabled') ||
            error.message?.toLowerCase().includes('unsupported')
          ) {
            return {
              error: new AuthError(
                'Google sign-in is not yet enabled in the Supabase project. Please sign in with email/password or enable Google provider in the Supabase Dashboard.'
              ),
            };
          }
        }
        return { error };
      }
    } catch (err) {
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
      if (typeof window !== 'undefined' && window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    return { error: res.error };
  };

  const clearPasswordRecovery = () => {
    setIsPasswordRecovery(false);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const clearRecoveryLinkExpired = () => {
    setIsRecoveryLinkExpired(false);
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
    }),
    [user, session, loading, isPasswordRecovery, isRecoveryLinkExpired]
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
