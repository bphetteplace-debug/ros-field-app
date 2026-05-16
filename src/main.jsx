import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './index.css';

// Sentry init is guarded by VITE_SENTRY_DSN. Without that env var, init is
// skipped entirely and the app behaves exactly as it did pre-Sentry.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    integrations: [
      // Session Replay: records DOM mutations / clicks / network for sessions
      // that fire an error. maskAllInputs stays true (default) so login
      // passwords are never captured; page text + media stay visible so the
      // recording is useful for diagnosing what the tech actually saw.
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Don't record routine sessions; do record any session where an error
    // fires, including the ~60s buffer leading up to the error.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Strip auth tokens from any error data
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[REDACTED]';
      }
      return event;
    },
  });
}

function ErrorFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 16 }}>
      <div style={{ maxWidth: 420, background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
          The app hit an unexpected error. Reloading usually fixes it. If it keeps happening, message the office.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '10px 18px', background: '#1a2332', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Reload app
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registered, scope:', reg.scope);
        // Listen for sync messages from the SW
        navigator.serviceWorker.addEventListener('message', event => {
          if (event.data && event.data.type === 'SYNC_QUEUE') {
            // Dispatch a custom event so FormPage / SubmissionsListPage can handle it
            window.dispatchEvent(new CustomEvent('ros-sync-queue'));
          }
        });
      })
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
