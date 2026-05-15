// src/pages/SharePage.jsx — public read-only view of a submission via share token
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { fetchSharedSubmission, getPhotoUrl } from '../lib/submissions'
import { buildPDFData } from '../lib/pdfData'
import { WorkOrderPDFTemplate } from '../components/WorkOrderPDFTemplate'

export default function SharePage() {
  const { token } = useParams()
  const [pdfData, setPdfData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchSharedSubmission(token)
      .then(async ({ submission, photos }) => {
        if (cancelled) return
        const subWithPhotos = { ...submission, photos: photos || [] }
        const data = await buildPDFData(subWithPhotos, (path) => getPhotoUrl(path))
        if (cancelled) return
        setPdfData(data)
        setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err.message || String(err)); setLoading(false) } })
    return () => { cancelled = true }
  }, [token])

  const page = { minHeight: '100vh', background: '#f0f2f5', padding: '20px 12px', fontFamily: 'system-ui, sans-serif' }
  const wrap = { maxWidth: '8.5in', margin: '0 auto', background: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', borderRadius: 4, overflow: 'hidden' }
  const banner = { background: '#0f1f38', color: '#e5e7eb', padding: '10px 16px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }

  if (loading) return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#555' }}>Loading work order…</div></div>

  if (error) return (
    <div style={page}>
      <div style={{ ...wrap, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#1a2332', marginBottom: 6 }}>This share link is invalid or expired</div>
        <div style={{ fontSize: 13, color: '#666' }}>If you received this link from Reliable Oilfield Services, please reach out to them for a new one.</div>
      </div>
    </div>
  )

  return (
    <div style={page}>
      <div style={wrap}>
        <div style={banner}>
          <span>📄 Shared Work Order — read-only view</span>
          <button
            onClick={() => window.print()}
            style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            🖨 Print / Save as PDF
          </button>
        </div>
        {pdfData && <WorkOrderPDFTemplate data={pdfData} />}
      </div>
      <div style={{ maxWidth: '8.5in', margin: '12px auto 0', fontSize: 11, color: '#888', textAlign: 'center' }}>
        Powered by ReliableTrack — pm.reliable-oilfield-services.com
      </div>
    </div>
  )
}
