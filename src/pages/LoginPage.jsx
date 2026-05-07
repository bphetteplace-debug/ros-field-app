import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { signIn, isCloudMode } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Flame className="w-9 h-9 text-white" />
          </div>
          <h1 className="display-font font-bold text-2xl text-white tracking-wider">RELIABLETRACK</h1>
          <p className="text-slate-400 text-sm mt-1">Field Operations</p>
          <p className="text-slate-500 text-xs mt-1">by Reliable Oilfield Services</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-2xl p-6 space-y-4">
          {!isCloudMode && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Cloud mode not configured. Set <code className="font-mono bg-amber-100 px-1">VITE_SUPABASE_URL</code> and{' '}
                <code className="font-mono bg-amber-100 px-1">VITE_SUPABASE_ANON_KEY</code> in <code className="font-mono bg-amber-100 px-1">.env.local</code>. See <code className="font-mono bg-amber-100 px-1">WEEK1_BACKEND.md</code>.
              </span>
            </div>
          )}

          <div>
            <label className="ros-label">Email</label>
            <input
              type="email"
              autoComplete="email"
              className="ros-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="ros-label">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              className="ros-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !isCloudMode}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-md display-font tracking-wider transition"
          >
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>
      </div>
    </div>
  );
}
