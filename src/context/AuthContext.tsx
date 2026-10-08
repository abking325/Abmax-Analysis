import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getAppRedirectUrl } from '../services/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null; needsEmailConfirmation?: boolean }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check for password recovery hash in URL (e.g. #access_token=...&type=recovery)
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setIsPasswordRecovery(true);
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
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      return {
        error: {
          name: 'NotConfigured',
          message: 'Supabase credentials are not configured in environment variables.',
        } as AuthError,
      };
    }
    const res = await supabase.auth.signInWithPassword({ email, password });
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
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    const needsEmailConfirmation = Boolean(res.data?.user && !res.data?.session);
    return { error: res.error, needsEmailConfirmation };
  };

  const signOut = async () => {
    if (!supabase) return { error: null };
    const res = await supabase.auth.signOut();
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
    const res = await supabase.auth.resetPasswordForEmail(email, {
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

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      isConfigured: isSupabaseConfigured,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      isPasswordRecovery,
      clearPasswordRecovery,
    }),
    [user, session, loading, isPasswordRecovery]
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
