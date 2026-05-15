import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import FormPage from './pages/FormPage.jsx';
import PreviewPage from './pages/PreviewPage.jsx';
import SubmissionsListPage from './pages/SubmissionsListPage.jsx';
import ViewSubmissionPage from './pages/ViewSubmissionPage.jsx';
import EditSubmissionPage from './pages/EditSubmissionPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import SharePage from './pages/SharePage.jsx';
import ExpenseReportPage from './pages/ExpenseReportPage.jsx';
import DailyInspectionPage from './pages/DailyInspectionPage.jsx';
import JHAPage from './pages/JHAPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import QuotePage from './pages/QuotePage.jsx';

export default function App() {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <Routes>
        {/* Share links are public — never gated by auth */}
        <Route path="/share/:token" element={<SharePage />} />
        <Route path="*" element={
          <div className="min-h-screen flex items-center justify-center bg-slate-100">
            <div className="text-slate-500 text-sm">Loading…</div>
          </div>
        } />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/share/:token" element={<SharePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        {/* Public share — works whether or not the visitor is logged in */}
        <Route path="/share/:token" element={<SharePage />} />
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
    </Layout>
  );
}
