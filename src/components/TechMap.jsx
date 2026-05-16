// Live tech map for the AdminPage "Live" tab.
//
// Data sources:
//   - user_presence (active tech sessions, polled every 30s)
//   - submissions (latest 100, polled every 60s) → each tech's most recent
//     row with valid gpsLat/gpsLng in `data` becomes their pin location.
//
// Map: Leaflet + free OpenStreetMap tiles (no API key, no signup).
// Markers: pure-DOM divIcon — no marker-image asset wrangling needed.
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getAuthToken } from '../lib/submissions'

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const STALE_MS = 2 * 60 * 1000

function timeAgo(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}

const FORM_COLORS = {
  'PM': '#e65c00',
  'Service Call': '#2563eb',
  'Expense Report': '#7c3aed',
  'Daily Inspection': '#0891b2',
  'JHA/JSA': '#059669',
}

function colorFor(label) {
  return FORM_COLORS[label] || '#1a2332'
}

function makeIcon(name, color, isActive) {
  const initial = (name || '?').charAt(0).toUpperCase()
  const ring = isActive
    ? `box-shadow: 0 0 0 3px rgba(34,197,94,0.5), 0 2px 8px rgba(0,0,0,0.25);`
    : `box-shadow: 0 2px 8px rgba(0,0,0,0.2); opacity: 0.7;`
  return L.divIcon({
    html: `<div style="width:38px;height:38px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border:2px solid #fff;${ring}">${initial}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -19],
    className: '',
  })
}

export default function TechMap() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerLayerRef = useRef(null)
  const [presence, setPresence] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)

  // Poll presence + submissions
  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const token = getAuthToken()
        const headers = { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + (token || SUPA_KEY) }
        const [pRes, sRes] = await Promise.all([
          fetch(SUPA_URL + '/rest/v1/user_presence?select=*&order=updated_at.desc', { headers }),
          fetch(SUPA_URL + '/rest/v1/submissions?select=id,created_by,customer_name,location_name,data,created_at,pm_number&order=created_at.desc&limit=100', { headers }),
        ])
        if (cancelled) return
        if (pRes.ok) setPresence(await pRes.json())
        if (sRes.ok) setSubmissions(await sRes.json())
      } catch (e) {
        console.warn('TechMap fetch failed:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    const interval = setInterval(refresh, 45000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [39.5, -98.3],
      zoom: 4,
      scrollWheelZoom: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Build markers from presence + submissions
  useEffect(() => {
    const map = mapRef.current
    const layer = markerLayerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    const now = Date.now()
    const bounds = []

    for (const p of presence) {
      const sub = submissions.find(
        s => s.created_by === p.user_id && s.data && s.data.gpsLat != null && s.data.gpsLng != null
      )
      if (!sub) continue
      const lat = parseFloat(sub.data.gpsLat)
      const lng = parseFloat(sub.data.gpsLng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      const isActive = (now - new Date(p.updated_at)) < STALE_MS
      const icon = makeIcon(p.user_name, colorFor(p.form_label), isActive)
      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;min-width:180px">
          <div style="font-weight:800;font-size:14px;color:#1a2332;margin-bottom:4px">${p.user_name || 'Unknown tech'}</div>
          <div style="font-size:12px;color:#555;margin-bottom:6px">
            ${isActive ? '<span style="color:#16a34a;font-weight:700">● ACTIVE</span> · ' : '<span style="color:#9ca3af">Idle · </span>'}
            on <span style="font-weight:600;color:${colorFor(p.form_label)}">${p.form_label || p.form_type}</span>
          </div>
          <div style="font-size:12px;color:#374151;margin-bottom:2px"><b>Last submission:</b> WO #${sub.pm_number || '?'} — ${sub.customer_name || ''}</div>
          ${sub.location_name ? `<div style="font-size:12px;color:#555">${sub.location_name}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:6px">Pin set ${timeAgo(sub.created_at)} · presence ${timeAgo(p.updated_at)}</div>
        </div>
      `
      const marker = L.marker([lat, lng], { icon }).bindPopup(popupHtml)
      layer.addLayer(marker)
      bounds.push([lat, lng])
    }

    if (bounds.length === 1) {
      map.setView(bounds[0], 12)
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
    }
  }, [presence, submissions])

  const now = Date.now()
  const activeCount = presence.filter(p => (now - new Date(p.updated_at)) < STALE_MS).length
  const plottedCount = presence.filter(p => {
    const sub = submissions.find(s => s.created_by === p.user_id && s.data && s.data.gpsLat != null && s.data.gpsLng != null)
    return !!sub
  }).length

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ background: '#0f1f38', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📍</span>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>Tech Map</span>
          {activeCount > 0 && (
            <span style={{ background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 10 }}>
              {activeCount} active
            </span>
          )}
        </div>
        <div style={{ color: '#9ca3af', fontSize: 12 }}>
          {loading ? 'Loading…' : `${plottedCount} of ${presence.length} techs plotted (location from last submission)`}
        </div>
      </div>
      <div ref={containerRef} style={{ height: 380, width: '100%', background: '#e2e8f0' }} />
      {!loading && plottedCount === 0 && (
        <div style={{ padding: 14, textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#f9fafb' }}>
          No tech locations yet — pins appear once techs submit a form with GPS captured.
        </div>
      )}
    </div>
  )
}
