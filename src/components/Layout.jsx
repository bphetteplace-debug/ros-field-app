import { useEffect, useState } from 'react';
import { getQueueCount } from '../lib/offlineSync';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { isPushSupported, getNotificationPermission, isPushSubscribed, subscribeToPush } from '../lib/pushSubscription';
import DispatchTrackingBar from './DispatchTrackingBar';
import AssistantDrawer from './AssistantDrawer';

// Slim banner that offers OS-level push notifications when supported,
// the user hasn't decided yet, and they haven't dismissed it this session.
// Shown alongside the ConnectionBanner so it doesn't push the main app
// content around mid-flow.
function NotificationPermissionBanner() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) { setShow(false); return; }
      if (!isPushSupported()) { setShow(false); return; }
      if (getNotificationPermission() !== 'default') { setShow(false); return; }
      try {
        if (sessionStorage.getItem('push-banner-dismissed') === '1') { setShow(false); return; }
      } catch (_) {}
      const already = await isPushSubscribed();
      if (cancelled) return;
      setShow(!already);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const enable = async () => {
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);
    if (result.ok) {
      toast.success('🔔 Notifications enabled');
      setShow(false);
    } else if (result.reason === 'denied') {
      toast.warning('Notifications blocked. To re-enable: tap the lock icon in your browser address bar.');
      setShow(false);
    } else if (result.reason === 'not-configured') {
      toast.error('Push not yet configured — VAPID env vars missing.');
      setShow(false);
    } else if (result.reason === 'unsupported') {
      setShow(false);
    } else {
      toast.error('Could not enable notifications. Try again later.');
    }
  };

  const dismiss = () => {
    try { sessionStorage.setItem('push-banner-dismissed', '1'); } catch (_) {}
    setShow(false);
  };

  if (!show) return null;
  return (
    <div
      role="status"
      style={{
        background: '#0f1f38',
        color: '#fff',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        fontSize: 13,
        lineHeight: 1.35,
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontWeight: 600 }}>🔔 Get push alerts for new jobs &amp; dispatches</span>
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        style={{ background: '#e65c00', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontWeight: 800, fontSize: 12, cursor: busy ? 'wait' : 'pointer', boxShadow: '0 2px 6px rgba(230,92,0,0.4)' }}
      >
        {busy ? 'Enabling…' : 'Enable'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        style={{ background: 'transparent', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '5px 10px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
      >
        Later
      </button>
    </div>
  );
}

// In-app real-time notifications. Subscribes to Supabase Realtime for
// rows targeting the current user so techs get an immediate toast when:
//   1) An admin assigns them a new job (submissions INSERT with
//      data.assignedBy set, created_by = this user, status='draft')
//   2) An admin starts a customer-tracking dispatch for them
//      (active_dispatch INSERT with tech_id = this user)
//
// Also vibrates the phone briefly so a tech keeping the app in the
// background mid-job gets a tactile cue, not just a silent toast.
// OS-level web push (when the app is closed) is a separate, future feature.
function NotificationListener() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id || !supabase) return;
    let cancelled = false;
    const buzz = () => { try { navigator.vibrate && navigator.vibrate([100, 60, 100]); } catch (_) {} };

    const assignChannel = supabase
      .channel('inbound-assignments-' + user.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'submissions', filter: 'created_by=eq.' + user.id },
        (payload) => {
          if (cancelled) return;
          const row = payload?.new;
          // Only toast assignments — skip the tech's own submissions.
          if (!row || row.status !== 'draft' || !row.data?.assignedBy) return;
          const wo = row.work_order || row.pm_number;
          const customer = row.customer_name || 'Service Call';
          toast.success('📤 New job assigned: ' + customer + (wo ? ' (#' + wo + ')' : ''), 8000);
          buzz();
        }
      )
      .subscribe();

    const dispatchChannel = supabase
      .channel('inbound-dispatches-' + user.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'active_dispatch', filter: 'tech_id=eq.' + user.id },
        (payload) => {
          if (cancelled) return;
          const row = payload?.new;
          if (!row) return;
          const where = row.destination_label || row.customer_name || 'customer site';
          toast.success('📍 New dispatch: heading to ' + where, 8000);
          buzz();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(assignChannel); } catch (_) {}
      try { supabase.removeChannel(dispatchChannel); } catch (_) {}
    };
  }, [user?.id]);
  return null;
}

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
      <NotificationPermissionBanner />
      <NotificationListener />
      <DispatchTrackingBar />
      {children}
      <AssistantDrawer />
    </div>
  );
}
