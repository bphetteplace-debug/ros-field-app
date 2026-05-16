// Admin-side live-map modal — opens when admin clicks a row in the
// /admin → 📍 Dispatches tab. Shows destination + tech pins on a Leaflet
// map (free OSM tiles, no API key), updates every 8s. Reuses the same
// Leaflet shared chunk that the customer /track/:token page + Live tech
// map already pull in, so opening this modal adds no new dependency.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchDispatchById, formatEta, formatRelativeTime } from '../lib/dispatch'

const POLL_MS = 8000

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 31, 56, 0.75)',
  zIndex: 1050, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
}
const panel = {
  background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%',
  boxShadow: '0 12px 40px rgba(0,0,0,0.35)', overflow: 'hidden',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
}
const header = {
  background: '#0f1f38', color: '#fff', padding: '14px 18px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}

const statusStyles = {
  en_route:  { bg: '#fff7ed', fg: '#c2410c', label: '🚐 En route' },
  arrived:   { bg: '#ecfdf5', fg: '#047857', label: '📍 Arrived' },
  completed: { bg: '#f1f5f9', fg: '#475569', label: '✓ Completed' },
  cancelled: { bg: '#fef2f2', fg: '#b91c1c', label: '✕ Cancelled' },
}

// Inline SVG marker icons. Leaflet's default markers require image assets
// that don't bundle cleanly with Vite — we render simple circle pins instead.
const techIconHtml = `<div style="background:#0891b2;color:#fff;width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800">🚐</div>`
const destIconHtml = `<div style="background:#e65c00;color:#fff;width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800">📍</div>`

function makeIcon(html) {
  return L.divIcon({ html, className: 'dispatch-pin', iconSize: [30, 30], iconAnchor: [15, 15] })
}

export default function DispatchMapModal({ dispatch: initialDispatch, onClose }) {
  const [dispatch, setDispatch] = useState(initialDispatch)
  const [refreshedAt, setRefreshedAt] = useState(Date.now())
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const techMarkerRef = useRef(null)
  const destMarkerRef = useRef(null)
  const lineRef = useRef(null)

  // Poll the dispatch row for fresh tech_lat/lng/eta_seconds/status
  useEffect(() => {
    if (!initialDispatch?.id) return
    let cancelled = false
    const tick = async () => {
      const fresh = await fetchDispatchById(initialDispatch.id)
      if (cancelled) return
      if (fresh) {
        setDispatch(fresh)
        setRefreshedAt(Date.now())
      }
    }
    const i = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(i) }
  }, [initialDispatch?.id])

  // Initialize Leaflet map once container is mounted
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const destLat = dispatch?.destination_lat
    const destLng = dispatch?.destination_lng
    const techLat = dispatch?.tech_lat
    const techLng = dispatch?.tech_lng
    // Pick a sensible initial center
    let center = [31.85, -102.36] // Midland-Odessa basin default
    if (techLat != null && techLng != null) center = [Number(techLat), Number(techLng)]
    else if (destLat != null && destLng != null) center = [Number(destLat), Number(destLng)]

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView(center, 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      techMarkerRef.current = null
      destMarkerRef.current = null
      lineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update markers + line + auto-fit whenever the dispatch updates
  useEffect(() => {
    const map = mapRef.current
    if (!map || !dispatch) return

    const destLat = dispatch.destination_lat != null ? Number(dispatch.destination_lat) : null
    const destLng = dispatch.destination_lng != null ? Number(dispatch.destination_lng) : null
    const techLat = dispatch.tech_lat != null ? Number(dispatch.tech_lat) : null
    const techLng = dispatch.tech_lng != null ? Number(dispatch.tech_lng) : null

    // Destination marker
    if (destLat != null && destLng != null) {
      if (!destMarkerRef.current) {
        destMarkerRef.current = L.marker([destLat, destLng], { icon: makeIcon(destIconHtml) }).addTo(map)
        destMarkerRef.current.bindPopup('<b>Destination</b><br/>' + (dispatch.destination_label || ''))
      } else {
        destMarkerRef.current.setLatLng([destLat, destLng])
      }
    }

    // Tech marker
    if (techLat != null && techLng != null) {
      if (!techMarkerRef.current) {
        techMarkerRef.current = L.marker([techLat, techLng], { icon: makeIcon(techIconHtml) }).addTo(map)
      } else {
        techMarkerRef.current.setLatLng([techLat, techLng])
      }
      const popup = '<b>' + (dispatch.tech_name || 'Tech') + '</b>' +
        (dispatch.tech_updated_at ? '<br/><small>Updated ' + (formatRelativeTime(dispatch.tech_updated_at) || '') + '</small>' : '')
      techMarkerRef.current.bindPopup(popup)
    }

    // Polyline between tech and destination
    if (techLat != null && techLng != null && destLat != null && destLng != null) {
      const coords = [[techLat, techLng], [destLat, destLng]]
      if (!lineRef.current) {
        lineRef.current = L.polyline(coords, { color: '#0891b2', weight: 3, dashArray: '6 8' }).addTo(map)
      } else {
        lineRef.current.setLatLngs(coords)
      }
    }

    // Auto-fit
    const bounds = []
    if (destLat != null && destLng != null) bounds.push([destLat, destLng])
    if (techLat != null && techLng != null) bounds.push([techLat, techLng])
    if (bounds.length === 2) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 12)
    }
  }, [dispatch?.tech_lat, dispatch?.tech_lng, dispatch?.destination_lat, dispatch?.destination_lng])

  if (!dispatch) return null

  const s = statusStyles[dispatch.status] || statusStyles.en_route
  const hasGps = dispatch.tech_lat != null && dispatch.tech_lng != null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Live dispatch map
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>
              {dispatch.customer_name || 'Dispatch'} · {dispatch.tech_name || 'Tech'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 4 }}>
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #e5e7eb', background: '#fafbfc', fontSize: 12 }}>
          <span style={{ background: s.bg, color: s.fg, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 800, letterSpacing: 0.3 }}>
            {s.label}
          </span>
          <span style={{ color: '#475569' }}>
            <b>ETA:</b> {formatEta(dispatch.eta_seconds) || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
          </span>
          <span style={{ color: '#475569' }}>
            <b>Started:</b> {formatRelativeTime(dispatch.started_at) || '—'}
          </span>
          <span style={{ color: hasGps ? '#16a34a' : '#94a3b8' }}>
            <b>Last GPS:</b> {hasGps ? (formatRelativeTime(dispatch.tech_updated_at) || 'just now') : 'waiting for tech…'}
          </span>
          <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 11 }}>
            refreshes every 8s
          </span>
        </div>

        <div
          ref={containerRef}
          style={{ height: 480, width: '100%', background: '#e8f0f5' }}
          data-refreshed-at={refreshedAt}
        />
      </div>
    </div>
  )
}
