import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SharePage from './pages/SharePage.jsx';
// TrackDispatchPage is lazy because it pulls in Leaflet (~155 KB) and we
// don't want that in the main bundle. It IS rendered from public branches
// (no user / loading), so each of those branches wraps Routes in a small
// Suspense boundary.
const TrackDispatchPage = lazy(() => import('./pages/TrackDispatchPage.jsx'));

// Route-level code splitting: each authenticated page is its own chunk so the
// main bundle stays small. LoginPage and SharePage are eager because they
// render in the pre-auth / public branches without a Suspense wrapper.
const FormPage = lazy(() => import('./pages/FormPage.jsx'));
const PreviewPage = lazy(() => import('./pages/PreviewPage.jsx'));
const SubmissionsListPage = lazy(() => import('./pages/SubmissionsListPage.jsx'));
const ViewSubmissionPage = lazy(() => import('./pages/ViewSubmissionPage.jsx'));
const EditSubmissionPage = lazy(() => import('./pages/EditSubmissionPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const ExpenseReportPage = lazy(() => import('./pages/ExpenseReportPage.jsx'));
const DailyInspectionPage = lazy(() => import('./pages/DailyInspectionPage.jsx'));
const JHAPage = lazy(() => import('./pages/JHAPage.jsx'));
const InventoryPage = lazy(() => import('./pages/InventoryPage.jsx'));
const QuotePage = lazy(() => import('./pages/QuotePage.jsx'));

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
