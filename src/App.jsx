import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import FormPage from './pages/FormPage.jsx';
import PreviewPage from './pages/PreviewPage.jsx';
import SubmissionsListPage from './pages/SubmissionsListPage.jsx';
import ViewSubmissionPage from './pages/ViewSubmissionPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  // Not logged in — only show login
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/submissions" element={<SubmissionsListPage />} />
        <Route path="/form" element={<FormPage />} />
        <Route path="/preview" element={<PreviewPage />} />
        <Route path="/view/:id" element={<ViewSubmissionPage />} />
        <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/submissions" replace />} />
        <Route path="/login" element={<Navigate to="/submissions" replace />} />
        <Route path="*" element={<Navigate to="/submissions" replace />} />
      </Routes>
    </Layout>
  );
}
