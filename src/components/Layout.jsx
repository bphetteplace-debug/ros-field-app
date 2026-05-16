import { useEffect, useState } from 'react';
import { getQueueCount } from '../lib/offlineSync';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import DispatchTrackingBar from './DispatchTrackingBar';
import AssistantDrawer from './AssistantDrawer';

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
      <NotificationListener />
      <DispatchTrackingBar />
      {children}
      <AssistantDrawer />
    </div>
  );
}
