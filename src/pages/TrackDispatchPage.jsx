// Customer-facing live tracking page. Public — auth is the random
// share_token in the URL. Polls the get_active_dispatch RPC every 8s
// and re-renders the map + status. Mobile-first since customers will
// mostly open this on their phones.
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  fetchActiveDispatch,
  formatEta,
  formatRelativeTime,
  mapboxDirectionsUrl,
  distanceMiles,
} from '../lib/dispatch'

const STATUS_THEME = {
  en_route: {
    label: 'On the way',
    emoji: '🚐',
    bg: '#1e40af',
    accent: '#3b82f6',
    text: '#fff',
    detail: 'Your technician is on the way to your site.',
  },
  arrived: {
    label: 'Arrived',
    emoji: '✅',
    bg: '#059669',
    accent: '#10b981',
    text: '#fff',
    detail: 'Your technician has arrived on site.',
  },
  completed: {
    label: 'Service complete',
    emoji: '🎉',
    bg: '#1a2332',
    accent: '#374151',
    text: '#fff',
    detail: 'Service has been completed. Thank you for choosing Reliable Oilfield Services.',
  },
  cancelled: {
    label: 'Dispatch cancelled',
    emoji: '⚠️',
    bg: '#7c2d12',
    accent: '#dc2626',
    text: '#fff',
    detail: 'This dispatch has been cancelled. Please contact our office.',
  },
}

function techIcon(name, accent) {
  const initial = (name || 'T').charAt(0).toUpperCase()
  const html =
    '<div style="width:44px;height:44px;border-radius:50%;background:' +
    accent +
    ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,0.35), 0 0 0 4px ' +
    accent +
    '33;">' +
    initial +
    '</div>'
  return L.divIcon({ html, iconSize: [44, 44], iconAnchor: [22, 22], className: '' })
}

function destinationIcon() {
  const html =
    '<div style="position:relative;width:36px;height:48px;display:flex;align-items:flex-start;justify-content:center;">' +
    '<svg viewBox="0 0 24 32" width="36" height="48" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#e65c00" stroke="#fff" stroke-width="1.5"/>' +
    '<circle cx="12" cy="12" r="4.5" fill="#fff"/>' +
    '</svg>' +
    '</div>'
  return L.divIcon({ html, iconSize: [36, 48], iconAnchor: [18, 46], className: '' })
}

export default function TrackDispatchPage() {
  const { token } = useParams()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ tech: null, dest: null, line: null })
  const [dispatch, setDispatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [, setTick] = useState(0)
  const [drivingEta, setDrivingEta] = useState(null)

  // Poll dispatch every 8 seconds
  useEffect(() => {
    let cancelled = false
    let timer = null
    async function poll() {
      const d = await fetchActiveDispatch(token)
      if (cancelled) return
      setDispatch(d)
      setLastRefresh(new Date())
      setLoading(false)
      if (!cancelled && (!d || d.status === 'en_route' || d.status === 'arrived')) {
        timer = setTimeout(poll, 8000)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [token])

  // Init Leaflet map once the container div is mounted. The map div is
  // conditionally rendered (only when !loading && dispatch is set), so we
  // can't init on plain [] — we'd run before the div exists. Depend on
  // loading instead: as soon as loading flips to false the effect re-runs,
  // containerRef.current is non-null, and we init.
  useEffect(() => {
    if (loading) return
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [39.5, -98.3],
      zoom: 4,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = { tech: null, dest: null, line: null }
    }
  }, [loading])

  // Sync markers with dispatch updates
  useEffect(() => {
    const map = mapRef.current
    if (!map || !dispatch) return
    const theme = STATUS_THEME[dispatch.status] || STATUS_THEME.en_route

    const techHas = dispatch.tech_lat != null && dispatch.tech_lng != null
    const destHas = dispatch.destination_lat != null && dispatch.destination_lng != null

    // Tech marker
    if (techHas) {
      const techLat = Number(dispatch.tech_lat)
      const techLng = Number(dispatch.tech_lng)
      if (markersRef.current.tech) {
        markersRef.current.tech.setLatLng([techLat, techLng])
        markersRef.current.tech.setIcon(techIcon(dispatch.tech_name, theme.accent))
      } else {
        markersRef.current.tech = L.marker([techLat, techLng], {
          icon: techIcon(dispatch.tech_name, theme.accent),
        }).addTo(map)
      }
    } else if (markersRef.current.tech) {
      markersRef.current.tech.remove()
      markersRef.current.tech = null
    }

    // Destination marker
    if (destHas) {
      const destLat = Number(dispatch.destination_lat)
      const destLng = Number(dispatch.destination_lng)
      if (markersRef.current.dest) {
        markersRef.current.dest.setLatLng([destLat, destLng])
      } else {
        markersRef.current.dest = L.marker([destLat, destLng], {
          icon: destinationIcon(),
        })
          .bindTooltip(dispatch.destination_label || 'Your location', {
            permanent: false,
            direction: 'top',
            offset: [0, -40],
          })
          .addTo(map)
      }
    } else if (markersRef.current.dest) {
      markersRef.current.dest.remove()
      markersRef.current.dest = null
    }

    // Dashed line between tech and destination (visual cue for direction of travel)
    if (markersRef.current.line) {
      markersRef.current.line.remove()
      markersRef.current.line = null
    }
    if (techHas && destHas) {
      markersRef.current.line = L.polyline(
        [
          [Number(dispatch.tech_lat), Number(dispatch.tech_lng)],
          [Number(dispatch.destination_lat), Number(dispatch.destination_lng)],
        ],
        { color: theme.accent, weight: 3, opacity: 0.55, dashArray: '8 8' },
      ).addTo(map)
    }

    // Fit bounds to show whichever markers we have
    const pts = []
    if (techHas) pts.push([Number(dispatch.tech_lat), Number(dispatch.tech_lng)])
    if (destHas) pts.push([Number(dispatch.destination_lat), Number(dispatch.destination_lng)])
    if (pts.length === 1) {
      map.setView(pts[0], 13)
    } else if (pts.length === 2) {
      map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 })
    }
  }, [dispatch])

  // Fetch real driving ETA from Mapbox if we have a token + both endpoints.
  // Falls back silently when token is missing — the page still shows
  // straight-line distance below.
  useEffect(() => {
    if (!dispatch) return
    const url = mapboxDirectionsUrl(
      dispatch.tech_lat,
      dispatch.tech_lng,
      dispatch.destination_lat,
      dispatch.destination_lng,
    )
    if (!url) {
      setDrivingEta(null)
      return
    }
    let cancelled = false
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const route = data && Array.isArray(data.routes) && data.routes[0]
        if (route && Number.isFinite(route.duration)) {
          setDrivingEta(route.duration)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dispatch?.tech_lat, dispatch?.tech_lng, dispatch?.destination_lat, dispatch?.destination_lng])

  // Tick every 15s so relative timestamps stay fresh
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 15000)
    return () => clearInterval(i)
  }, [])

  // ─── STYLES ──────────────────────────────────────────────────────────
  const page = {
    minHeight: '100vh',
    background: '#0f1f38',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#1a2332',
  }
  const headerStyle = {
    background: '#0f1f38',
    color: '#fff',
    padding: '14px 16px',
    textAlign: 'center',
  }
  const card = {
    background: '#fff',
    borderRadius: 14,
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    overflow: 'hidden',
    margin: '0 auto',
    maxWidth: 560,
  }

  // ─── EMPTY / EXPIRED STATE ───────────────────────────────────────────
  if (!loading && !dispatch) {
    return (
      <div style={page}>
        <div style={headerStyle}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>
            ReliableTrack
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            Reliable Oilfield Services
          </div>
        </div>
        <div style={{ padding: '40px 16px' }}>
          <div style={{ ...card, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#1a2332',
                marginBottom: 8,
              }}
            >
              Tracking link expired or unavailable
            </div>
            <div style={{ fontSize: 14, color: '#666', lineHeight: 1.5 }}>
              This tracking link is no longer active. If you're expecting service,
              please reach out to Reliable Oilfield Services for an update.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── LOADING SKELETON ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={page}>
        <div style={headerStyle}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>
            ReliableTrack
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            Reliable Oilfield Services
          </div>
        </div>
        <div style={{ padding: '24px 16px' }}>
          <div style={{ ...card, padding: 20 }}>
            <div className="shimmer" style={{ height: 22, width: '60%', marginBottom: 12 }} />
            <div className="shimmer" style={{ height: 14, width: '80%', marginBottom: 18 }} />
            <div className="shimmer" style={{ height: 260, width: '100%', borderRadius: 10 }} />
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <div className="shimmer" style={{ height: 60, flex: 1, borderRadius: 10 }} />
              <div className="shimmer" style={{ height: 60, flex: 1, borderRadius: 10 }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── POPULATED STATE ──────────────────────────────────────────────────
  const theme = STATUS_THEME[dispatch.status] || STATUS_THEME.en_route
  const techHas = dispatch.tech_lat != null && dispatch.tech_lng != null
  const destHas = dispatch.destination_lat != null && dispatch.destination_lng != null

  const etaText = (() => {
    if (dispatch.status === 'arrived') return 'On site now'
    if (dispatch.status === 'completed') return 'Service complete'
    if (dispatch.status === 'cancelled') return '—'
    if (drivingEta != null) return formatEta(drivingEta)
    if (dispatch.eta_seconds != null) return formatEta(dispatch.eta_seconds)
    if (techHas && destHas) {
      const miles = distanceMiles(
        dispatch.tech_lat,
        dispatch.tech_lng,
        dispatch.destination_lat,
        dispatch.destination_lng,
      )
      if (miles != null) return miles.toFixed(1) + ' mi away'
    }
    return 'Calculating…'
  })()

  return (
    <div style={page}>
      <div style={headerStyle}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>
          ReliableTrack
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
          Reliable Oilfield Services
        </div>
      </div>

      <div style={{ padding: '16px 12px 40px' }}>
        <div style={card}>
          {/* STATUS BANNER */}
          <div
            style={{
              background: theme.bg,
              color: theme.text,
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1 }}>{theme.emoji}</div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  opacity: 0.75,
                  marginBottom: 2,
                }}
              >
                Status
              </div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{theme.label}</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4, lineHeight: 1.45 }}>
                {theme.detail}
              </div>
            </div>
          </div>

          {/* HEADLINE */}
          <div style={{ padding: '18px 20px 8px' }}>
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              For
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1a2332', marginTop: 2 }}>
              {dispatch.customer_name || 'Customer'}
            </div>
            {dispatch.destination_label && (
              <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
                📍 {dispatch.destination_label}
              </div>
            )}
          </div>

          {/* MAP */}
          <div
            ref={containerRef}
            style={{
              height: 320,
              width: '100%',
              background: '#e2e8f0',
              borderTop: '1px solid #e5e7eb',
              borderBottom: '1px solid #e5e7eb',
            }}
          />

          {/* DUAL INFO CARDS */}
          <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}>
              <div
                style={{
                  fontSize: 10,
                  color: '#9ca3af',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Technician
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#1a2332',
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: theme.accent,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {(dispatch.tech_name || 'T').charAt(0).toUpperCase()}
                </span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dispatch.tech_name || 'Your technician'}
                </span>
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px' }}>
              <div
                style={{
                  fontSize: 10,
                  color: '#9ca3af',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                ETA
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.bg, marginTop: 4 }}>
                {etaText}
              </div>
            </div>
          </div>

          {/* WAITING STATE WHEN TECH HASN'T STARTED SHARING */}
          {!techHas && dispatch.status === 'en_route' && (
            <div
              style={{
                margin: '0 16px 16px',
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
                color: '#9a3412',
              }}
            >
              📡 Waiting for technician to start sharing their location…
            </div>
          )}

          {/* FOOTER — LAST UPDATE */}
          <div
            style={{
              padding: '10px 16px 14px',
              borderTop: '1px solid #f1f5f9',
              fontSize: 11,
              color: '#9ca3af',
              textAlign: 'center',
            }}
          >
            {dispatch.tech_updated_at
              ? 'Last location update ' + formatRelativeTime(dispatch.tech_updated_at)
              : 'Updates automatically every few seconds'}
            {lastRefresh && (
              <span style={{ marginLeft: 6 }}>· refreshed {formatRelativeTime(lastRefresh)}</span>
            )}
          </div>
        </div>

        <div
          style={{
            maxWidth: 560,
            margin: '14px auto 0',
            textAlign: 'center',
            fontSize: 11,
            color: '#94a3b8',
          }}
        >
          Powered by ReliableTrack · Updates may be delayed in areas with poor signal
        </div>
      </div>
    </div>
  )
}
