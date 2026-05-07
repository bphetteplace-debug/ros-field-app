import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isCloudMode } from './supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Local mode: skip auth, simulate a logged-in tech for the UX
    if (!isCloudMode()) {
      setUser({ id: 'local-user', email: 'local@ros.dev' });
      setProfile({ full_name: 'Local Mode', role: 'admin', truck_number: '0003' });
      setLoading(false);
      return;
    }

    // Cloud mode: hydrate session from Supabase
  supabase.auth.getSession().catch(() => ({ data: { session: null } })).then(async ({ data: { session } }) => {
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

    return () => subscription.subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (!error) setProfile(data);
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
