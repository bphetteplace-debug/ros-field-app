import { createContext, useContext, useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { supabase, isCloudMode } from './supabase.js';

const AuthContext = createContext(null);

// Admin email list — add/remove as needed
const ADMIN_EMAILS = [
  'bphetteplace@reliableoilfieldservices.net',
  'cphetteplace@reliableoilfieldservices.net', // Caryl — update if email differs
  'demo@reliable-oilfield-services.com', // Demo / Guest account
]

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isCloudMode()) {
      setUser({ id: 'local-user', email: 'local@ros.dev' });
      setProfile({ full_name: 'Local Mode', role: 'admin', truck_number: '0003' });
      setLoading(false);
      return;
    }

    // Safety timeout — never hang longer than 3s
    const timeout = setTimeout(() => setLoading(false), 3000);

    // Check for existing session on mount
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        clearTimeout(timeout);
        if (session?.user) {
          setUser(session.user);
          await loadProfile(session.user.id);
        }
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        await loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
        Sentry.setUser(null);
      }
      setLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  async function loadProfile(userId) {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = key ? JSON.parse(localStorage.getItem(key))?.access_token : null;
    const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
    try {
      const res = await fetch(SUPA_URL + '/rest/v1/profiles?id=eq.' + userId + '&select=*&limit=1', {
        headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + (token || SUPA_KEY) }
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setProfile(data[0]);
        // Attribute Sentry issues + replays to this tech. Safe to call even
        // if Sentry init was a no-op (no DSN set) — setUser is a noop too.
        Sentry.setUser({
          id: userId,
          email: data[0].email || undefined,
          username: data[0].full_name || undefined,
        });
      }
    } catch (e) {
      console.warn('loadProfile error:', e);
    }
  }

  async function signIn(email, password) {
    if (!isCloudMode()) throw new Error('Sign-in requires Supabase env vars. See WEEK1_BACKEND.md.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!isCloudMode()) return;
    try {
      // Attempt Supabase signOut (may fail if session already expired on mobile)
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('signOut error (non-fatal):', e);
    }
    // Always clear localStorage session tokens — critical for mobile
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('sb-') && (k.endsWith('-auth-token') || k.includes('-auth-'))) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
    // Always clear React state
    setUser(null);
    setProfile(null);
  }

  const DEMO_EMAIL = 'demo@reliable-oilfield-services.com';
  const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.includes(user?.email || '');
  const isDemo = user?.email === DEMO_EMAIL;

  const value = {
    user, profile, loading,
    isCloudMode: isCloudMode(),
    signIn, signOut, isAdmin, isDemo,
    // Convenience: tech name from profile for auto-fill
    techName: profile?.full_name || null,
    truckNumber: profile?.truck_number || null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
