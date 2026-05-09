import { Link, useLocation } from 'react-router-dom';
import { Flame, LogOut, ShieldCheck, Settings } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function Layout({ children }) {
  const { profile, signOut, isCloudMode, isAdmin } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="no-print bg-slate-900 text-white sticky top-0 z-30 shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-orange-600 flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="display-font font-bold text-base leading-none">RELIABLETRACK</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {profile?.full_name || ' '}
                {!isCloudMode && <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] font-bold uppercase tracking-wider">Local</span>}
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/admin" className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold transition ${
                location.pathname === '/admin' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
              }`} title="Admin View">
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin
              </Link>
            )}
            {isAdmin && (
              <Link to="/settings" className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold transition ${
                location.pathname === '/settings' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
              }`} title="Settings">
                <Settings className="w-3.5 h-3.5" />
                Settings
              </Link>
            )}
            {isCloudMode && (
              <button onClick={signOut} className="p-2 text-slate-400 hover:text-white transition" title="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
