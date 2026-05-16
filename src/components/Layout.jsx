import { useEffect, useState } from 'react';
import { getQueueCount } from '../lib/offlineSync';
import DispatchTrackingBar from './DispatchTrackingBar';

function ConnectionBanner() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  const [pending, setPending] = useState(0);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = null;

    const handleOnline = () => {
      if (cancelled) return;
      setOnline(true);
      setJustReconnected(true);
      // Auto-clear the "back online" toast after a few seconds if nothing
      // queues to sync.
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { if (!cancelled) setJustReconnected(false); }, 4000);
    };
    const handleOffline = () => { if (!cancelled) setOnline(false); };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const refreshQueue = () => {
      getQueueCount().then(n => { if (!cancelled) setPending(n); }).catch(() => {});
    };
    refreshQueue();
    const interval = setInterval(refreshQueue, 5000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
      clearTimeout(reconnectTimer);
    };
  }, []);

  // Decide what to render. Priority: offline > syncing > just-reconnected > nothing.
  let state = null;
  if (!online) {
    state = {
      bg: '#dc2626',
      text: pending > 0
        ? `📡 Offline — ${pending} submission${pending === 1 ? '' : 's'} saved locally, will sync when reconnected.`
        : '📡 Offline — your work is being saved locally and will sync when reconnected.',
    };
  } else if (pending > 0) {
    state = {
      bg: '#0891b2',
      text: `🔄 Syncing ${pending} pending submission${pending === 1 ? '' : 's'}…`,
    };
  } else if (justReconnected) {
    state = {
      bg: '#16a34a',
      text: '✓ Back online — all caught up.',
    };
  }

  if (!state) return null;

  return (
    <div
      role={!online ? 'alert' : 'status'}
      style={{
        background: state.bg,
        color: '#fff',
        padding: '8px 14px',
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 13,
        lineHeight: 1.35,
        letterSpacing: 0.1,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        position: 'sticky',
        top: 0,
        zIndex: 10000,
      }}
    >
      {state.text}
    </div>
  );
}

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <ConnectionBanner />
      <DispatchTrackingBar />
      {children}
    </div>
  );
}
