import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SharePage from './pages/SharePage.jsx';

// React.lazy wrapper that auto-reloads the page once if a chunk fetch
// fails. This happens when a user has stale HTML from a previous deploy
// in cache/memory and navigates to a route whose chunk filename changed
// after the new deploy. Without this they'd see a "Something went wrong"
// error boundary; with this they get a transparent reload onto the
// current build. Uses sessionStorage to limit retries to one per
// session — if the chunk genuinely 404s after a reload (rare), the
// error boundary takes over instead of looping.
const CHUNK_RELOAD_KEY = 'ros-chunk-reload-attempted';
function lazyWithRetry(loader) {
  return lazy(async () => {
    try {
      const mod = await loader();
      try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch {}
      return mod;
    } catch (err) {
      const msg = String((err && err.message) || err);
      const isChunkError = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(msg);
      let alreadyTried = false;
      try { alreadyTried = !!sessionStorage.getItem(CHUNK_RELOAD_KEY); } catch {}
      if (isChunkError && !alreadyTried) {
        try { sessionStorage.setItem(CHUNK_RELOAD_KEY, '1'); } catch {}
        window.location.reload();
        // Hang the import so React keeps showing the Suspense fallback
        // until the reload completes — avoids a flash of the error boundary.
        return new Promise(() => {});
      }
      throw err;
    }
  });
}

// TrackDispatchPage is lazy because it pulls in Leaflet (~155 KB) and we
// don't want that in the main bundle. It IS rendered from public branches
// (no user / loading), so each of those branches wraps Routes in a small
// Suspense boundary.
const TrackDispatchPage = lazyWithRetry(() => import('./pages/TrackDispatchPage.jsx'));

// Route-level code splitting: each authenticated page is its own chunk so the
// main bundle stays small. LoginPage and SharePage are eager because they
// render in the pre-auth / public branches without a Suspense wrapper.
const FormPage = lazyWithRetry(() => import('./pages/FormPage.jsx'));
const PreviewPage = lazyWithRetry(() => import('./pages/PreviewPage.jsx'));
const SubmissionsListPage = lazyWithRetry(() => import('./pages/SubmissionsListPage.jsx'));
const ViewSubmissionPage = lazyWithRetry(() => import('./pages/ViewSubmissionPage.jsx'));
const EditSubmissionPage = lazyWithRetry(() => import('./pages/EditSubmissionPage.jsx'));
const AdminPage = lazyWithRetry(() => import('./pages/AdminPage.jsx'));
const ExpenseReportPage = lazyWithRetry(() => import('./pages/ExpenseReportPage.jsx'));
const DailyInspectionPage = lazyWithRetry(() => import('./pages/DailyInspectionPage.jsx'));
const JHAPage = lazyWithRetry(() => import('./pages/JHAPage.jsx'));
const InventoryPage = lazyWithRetry(() => import('./pages/InventoryPage.jsx'));
const QuotePage = lazyWithRetry(() => import('./pages/QuotePage.jsx'));
const EndOfDayPage = lazyWithRetry(() => import('./pages/EndOfDayPage.jsx'));

function PageFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-slate-500 text-sm">Loading…</div>
    </div>
  );
}

export default function App() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-100">
          <div className="text-slate-500 text-sm">Loading…</div>
        </div>
      }>
        <Routes>
          {/* Share links + tracking links are public — never gated by auth */}
          <Route path="/share/:token" element={<SharePage />} />
          <Route path="/track/:token" element={<TrackDispatchPage />} />
          <Route path="*" element={
            <div className="min-h-screen flex items-center justify-center bg-slate-100">
              <div className="text-slate-500 text-sm">Loading…</div>
            </div>
          } />
        </Routes>
      </Suspense>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-100">
          <div className="text-slate-500 text-sm">Loading…</div>
        </div>
      }>
        <Routes>
          <Route path="/share/:token" element={<SharePage />} />
          <Route path="/track/:token" element={<TrackDispatchPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public share + tracking — work whether or not the visitor is logged in */}
          <Route path="/share/:token" element={<SharePage />} />
          <Route path="/track/:token" element={<TrackDispatchPage />} />
          <Route path="/submissions" element={<SubmissionsListPage />} />
          <Route path="/form" element={<FormPage />} />
          <Route path="/expense" element={<ExpenseReportPage />} />
          <Route path="/inspection" element={<DailyInspectionPage />} />
          <Route path="/jha" element={<JHAPage />} />
              <Route path="/inventory" element={user ? <InventoryPage /> : <Navigate to="/login" replace />} />
              <Route path="/quote" element={user ? <QuotePage /> : <Navigate to="/login" replace />} />
          <Route path="/end-of-day" element={<EndOfDayPage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/view/:id" element={<ViewSubmissionPage />} />
          {/* Techs can edit their own submissions; admins can edit any. Access is enforced inside EditSubmissionPage. */}
          <Route path="/edit/:id" element={<EditSubmissionPage />} />
          <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/submissions" replace />} />
          <Route path="/settings" element={<Navigate to="/admin" replace />} />
          <Route path="/login" element={<Navigate to="/submissions" replace />} />
          <Route path="*" element={<Navigate to="/submissions" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
