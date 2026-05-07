import { Link } from 'react-router-dom';
import { Plus, FileText, Inbox } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

// In Week 2, this fetches from Supabase. For now it's a placeholder.
export default function SubmissionsListPage() {
  const { isCloudMode, profile } = useAuth();

  return (
    <main className="max-w-5xl mx-auto p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="display-font font-bold text-2xl text-slate-900 tracking-wider">SUBMISSIONS</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isCloudMode
              ? `Welcome back, ${profile?.full_name?.split(' ')[0]}.`
              : 'Local mode — submissions are not yet persisted.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/form?type=pm"
            className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md flex items-center gap-2 transition shadow"
          >
            <Plus className="w-4 h-4" /> PM
          </Link>
          <Link
            to="/form?type=sc"
            className="px-4 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-md flex items-center gap-2 transition shadow"
          >
            <Plus className="w-4 h-4" /> Service Call
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="display-font font-bold text-lg text-slate-700 tracking-wider mb-2">NO SUBMISSIONS YET</h2>
        <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
          {isCloudMode
            ? 'Pick a job type below to start your first field report. Saved submissions will appear here.'
            : 'In local mode, submissions exist only during the current session. Switch to cloud mode (see WEEK1_BACKEND.md) to enable saved submissions.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/form?type=pm"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md transition shadow"
          >
            <FileText className="w-4 h-4" /> Start a PM
          </Link>
          <Link
            to="/form?type=sc"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-700 text-white font-bold rounded-md transition"
          >
            <FileText className="w-4 h-4" /> Start a Service Call
          </Link>
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400 text-center">
        Week 2 wires this page to fetch from Supabase. See <code className="font-mono bg-slate-200 px-1.5 py-0.5 rounded">README.md</code> for the roadmap.
      </div>
    </main>
  );
}
