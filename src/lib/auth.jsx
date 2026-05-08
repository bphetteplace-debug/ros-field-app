import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isCloudMode } from './supabase.js';

const AuthContext = createContext(null);

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

    const timeout = setTimeout(() => setLoading(false), 4000);

    supabase.auth.getSession()
      .catch(() => ({ data: { session: null } }))
      .then(async ({ data: { session } }) => {
        clearTimeout(timeout);
        if (session?.user) {
          setUser(session.user);
          await loadProfile(session.user.id);
        }
        setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(session.user);
        await loadProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => {
      clearTimeout(timeout);
      subscription.subscription.unsubscribe();
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
    if (Array.isArray(data) && data.length > 0) setProfile(data[0]);
  } catch (e) {
    console.warn('loadProfile error:', e);
  }
}
  }

  async function signIn(email, password) {
    if (!isCloudMode()) {
      throw new Error('Sign-in requires Supabase env vars. See WEEK1_BACKEND.md.');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!isCloudMode()) return;
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  const value = {
    user,
    profile,
    loading,
    isCloudMode: isCloudMode(),
    signIn,
    signOut,
    isAdmin: profile?.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
            }
