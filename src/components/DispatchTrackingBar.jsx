// Tech-side floating bar that appears when the logged-in tech has an active
// dispatch. Lets the tech start/stop sharing their location and mark
// "I've arrived". GPS updates are throttled to one POST per ~30s even if
// the watchPosition callback fires more frequently.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  fetchMyActiveDispatches,
  updateDispatchLocation,
  setDispatchStatus,
} from '../lib/dispatch'
import { toast } from '../lib/toast'

const MIN_UPDATE_INTERVAL_MS = 25_000 // post at most once every 25s
const POLL_DISPATCH_INTERVAL_MS = 60_000

export default function DispatchTrackingBar() {
  const { user } = useAuth()
  const [dispatch, setDispatch] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [permState, setPermState] = useState('unknown') // 'unknown' | 'granted' | 'denied' | 'unsupported'
  const [busy, setBusy] = useState(false)
  const watchIdRef = useRef(null)
  const lastPostRef = useRef(0)

  // Poll for active dispatches
  useEffect(() => {
    if (!user) return
    let cancelled = false
    let timer = null

    async function poll() {
      const rows = await fetchMyActiveDispatches(user.id)
      if (cancelled) return
      const open = (rows || []).find(
        (r) => r.status === 'en_route' || r.status === 'arrived',
      )
      setDispatch(open || null)
      if (!cancelled) timer = setTimeout(poll, POLL_DISPATCH_INTERVAL_MS)
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [user?.id])

  // Stop watching GPS when dispatch ends or component unmounts
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // If the dispatch goes away (completed by admin / 24h auto-expire),
    // stop sharing.
    if (!dispatch && watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
      setSharing(false)
    }
  }, [dispatch?.id])

  function startSharing() {
    if (!navigator.geolocation) {
      setPermState('unsupported')
      toast.error('This device does not support location sharing.')
      return
    }
    if (!dispatch) return
    setBusy(true)

    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        setPermState('granted')
        setSharing(true)
        setBusy(false)
        const now = Date.now()
        if (now - lastPostRef.current < MIN_UPDATE_INTERVAL_MS) return
        lastPostRef.current = now
        try {
          await updateDispatchLocation(dispatch.id, {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          })
        } catch (e) {
          console.warn('Failed to post location update:', e)
        }
      },
      (err) => {
        console.warn('Geolocation error:', err)
        setBusy(false)
        if (err.code === 1) {
          setPermState('denied')
          toast.error('Location permission was denied. The customer won\'t see your position.')
        } else {
          toast.warning('Could not get your location: ' + err.message)
        }
        setSharing(false)
        if (watchIdRef.current != null) {
          navigator.geolocation.clearWatch(watchIdRef.current)
          watchIdRef.current = null
        }
      },
      {
        enableHighAccuracy: false, // network-based is plenty + saves battery
        timeout: 30_000,
        maximumAge: 15_000,
      },
    )
    watchIdRef.current = id
  }

  function stopSharing() {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setSharing(false)
    toast.info('Stopped sharing location. The customer\'s map will pause.')
  }

  async function markArrived() {
    if (!dispatch || busy) return
    setBusy(true)
    try {
      await setDispatchStatus(dispatch.id, 'arrived')
      toast.success('Marked as arrived. The customer\'s map shows "Arrived".')
      // Update local dispatch state so the bar re-renders.
      setDispatch({ ...dispatch, status: 'arrived' })
    } catch (e) {
      toast.error('Could not update status: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function markComplete() {
    if (!dispatch || busy) return
    if (!window.confirm('Mark this dispatch as complete? The customer\'s tracking link will stop updating.')) return
    setBusy(true)
    try {
      await setDispatchStatus(dispatch.id, 'completed')
      toast.success('Dispatch complete. Customer link is now closed.')
      // Stop GPS sharing
      if (watchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      setSharing(false)
      setDispatch(null)
    } catch (e) {
      toast.error('Could not complete dispatch: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (!dispatch) return null

  const isArrived = dispatch.status === 'arrived'
  const bg = isArrived ? '#059669' : (sharing ? '#0891b2' : '#e65c00')
  const label = isArrived
    ? '✅ On site — customer sees "Arrived"'
    : sharing
      ? '📍 Sharing location with ' + (dispatch.customer_name || 'customer')
      : '🚐 Dispatch active — ' + (dispatch.customer_name || 'customer') + ' is waiting'

  return (
    <div
      role="status"
      style={{
        background: bg,
        color: '#fff',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        position: 'sticky',
        top: 0,
        zIndex: 9990,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.3,
      }}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!isArrived && !sharing && (
          <button
            onClick={startSharing}
            disabled={busy}
            style={{
              background: '#fff', color: bg, border: 'none',
              borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Starting…' : 'Start sharing'}
          </button>
        )}
        {!isArrived && sharing && (
          <button
            onClick={stopSharing}
            style={{
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Pause
          </button>
        )}
        {!isArrived && (
          <button
            onClick={markArrived}
            disabled={busy}
            style={{
              background: '#fff', color: bg, border: 'none',
              borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            I've arrived
          </button>
        )}
        {isArrived && (
          <button
            onClick={markComplete}
            disabled={busy}
            style={{
              background: '#fff', color: bg, border: 'none',
              borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Closing…' : 'Job complete'}
          </button>
        )}
      </span>
      {permState === 'denied' && (
        <div style={{ flex: '1 1 100%', fontSize: 12, color: '#fee2e2', marginTop: 4 }}>
          Location permission denied. Enable it in your browser settings to share with the customer.
        </div>
      )}
    </div>
  )
}
