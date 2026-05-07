import { Link, useLocation } from 'react-router-dom';
import { Flame, LogOut, ClipboardList, Plus } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function Layout({ children }) {
  const { profile, signOut, isCloudMode } = useAuth();
  const location = useLocation();
  const isFormView = location.pathname.startsWith('/form') || location.pathname.startsWith('/preview');

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
                {profile?.full_name}
                {!isCloudMode && <span className="ml-2 px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px] font-bold uppercase tracking-wider">Local</span>}
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            {!isFormView && (
              <>
                <Link
                  to="/form?type=pm"
                  className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold rounded-md flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> PM
                </Link>
                <Link
                  to="/form?type=sc"
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold rounded-md flex items-center gap-1.5 transition"
                >
                  <Plus className="w-4 h-4" /> Service Call
                </Link>
              </>
            )}
            {isCloudMode && (
              <button
                onClick={signOut}
                className="p-2 text-slate-400 hover:text-white transition"
                title="Sign out"
              >
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
