import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
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

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Inspect URL for password recovery or expired link tokens
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
        // Strip error token from browser address bar
        window.history.replaceState(null, '', window.location.pathname);
      } else if (fullUrlParams.includes('type=recovery')) {
        setIsPasswordRecovery(true);
        // Clean tokens from address bar history to protect against shoulder surfing or token leakage
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
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
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
    const res = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'signup',
    });
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
    const res = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
    });
    return { error: res.error };
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
    const res = await supabase.auth.updateUser({ password: newPassword });
    if (!res.error) {
      setIsPasswordRecovery(false);
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
