import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchSubmission, getPhotoUrl } from '../lib/submissions'

export default function ViewSubmissionPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchSubmission(id)
      .then(setSub)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <p style={{ color:'#666' }}>Loading submission…</p>
    </div>
  )
  if (error) return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:16 }}>
      <div style={{ background:'#ffeaea', border:'1px solid #f88', borderRadius:8, padding:16, color:'#c00' }}>Error: {error}</div>
      <button onClick={() => navigate('/submissions')} style={backBtn}>← Back to Submissions</button>
    </div>
  )
  if (!sub) return null

  const d = sub.data || {}
  const isWarranty = d.warranty_work
  const jobType = d.job_type || 'PM'
  const parts = d.parts || []
  const techs = d.techs || []
  const equipment = d.equipment || []
  const fmt = n => '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const dateStr = sub.date
    ? new Date(sub.date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
    : '—'

  const workPhotos = (sub.photos || []).filter(p => p.section === 'work').sort((a,b) => a.display_order - b.display_order)
  const sitePhotos = (sub.photos || []).filter(p => p.section === 'site').sort((a,b) => a.display_order - b.display_order)

  return (
    <div style={{ maxWidth:700, margin:'0 auto', padding:'16px 16px 40px' }}>
      <button onClick={() => navigate('/submissions')} style={backBtn}>← Submissions</button>

      <div style={{ background:'#1a2332', color:'#fff', borderRadius:12, padding:'20px 24px', marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <span style={{ background: jobType === 'PM' ? '#e65c00' : '#2563eb', fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:4 }}>{jobType}</span>
          <span style={{ fontSize:22, fontWeight:800 }}>{jobType === 'PM' ? 'PM' : 'SC'} #{sub.pm_number}</span>
        </div>
        <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>{sub.customer_name} — {sub.location_name}</div>
        <div style={{ fontSize:13, color:'#aab', marginBottom:2 }}>{dateStr}</div>
        <div style={{ fontSize:13, color:'#aab' }}>Submitted {new Date(sub.submitted_at || sub.created_at).toLocaleString()}</div>
      </div>

      <Section title="Job Details" icon="📋">
        <Grid>
          <Item label="Job Type" value={jobType} />
          <Item label="Warranty" value={isWarranty ? 'Yes — Warranty Job' : 'No — Standard Billing'} highlight={isWarranty} />
          <Item label="Customer" value={sub.customer_name} />
          <Item label="Truck" value={sub.truck_number} />
          <Item label="Location" value={sub.location_name} />
          <Item label="Contact" value={sub.contact} />
          <Item label="Work Order" value={sub.work_order} />
          <Item label="Type of Work" value={sub.work_type} />
          <Item label="GL Code" value={sub.gl_code} />
          <Item label="Asset Tag" value={sub.asset_tag} />
          <Item label="Work Area" value={sub.work_area} />
          <Item label="Date" value={dateStr} />
          <Item label="Start Time" value={sub.start_time} />
          <Item label="Departure Time" value={sub.departure_time} />
        </Grid>
      </Section>

      {sitePhotos.length > 0 && (
        <Section title="Site Sign Photo" icon="📍">
          {sitePhotos.map((photo, idx) => (
            <img key={idx} src={getPhotoUrl(photo.storage_path)} alt="Site sign"
              style={{ width:'100%', borderRadius:8, maxHeight:200, objectFit:'cover', marginBottom:8 }} />
          ))}
        </Section>
      )}

      <Section title="Description of Work" icon="📝">
        <p style={{ margin:0, fontSize:14, lineHeight:1.6, color:'#333', whiteSpace:'pre-wrap' }}>
          {sub.summary || 'No description entered.'}
        </p>
        {techs.length > 0 && (
          <div style={{ marginTop:12 }}>
            <p style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:1, marginBottom:8, textTransform:'uppercase' }}>Technicians On Site</p>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {techs.map(t => (
                <span key={t} style={{ background:'#fff3e8', border:'1px solid #ffd4a8', borderRadius:6, padding:'4px 12px', fontSize:13, fontWeight:600, color:'#e65c00' }}>{t}</span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {workPhotos.length > 0 && (
        <Section title={'Completed Work Photos (' + workPhotos.length + ')'} icon="📸">
          {workPhotos.map((photo, idx) => (
            <div key={idx} style={{ marginBottom:12 }}>
              <img src={getPhotoUrl(photo.storage_path)} alt={'Work photo ' + (idx+1)}
                style={{ width:'100%', borderRadius:8, maxHeight:300, objectFit:'cover' }} />
              {photo.caption && <p style={{ margin:'6px 0 0', fontSize:13, color:'#555', fontStyle:'italic' }}>{photo.caption}</p>}
            </div>
          ))}
        </Section>
      )}

      {equipment.length > 0 && (
        <Section title="Equipment Inspected" icon="🔧">
          {equipment.map((eq, idx) => (
            <div key={idx} style={{ padding:'10px 14px', background:'#f8f9fa', borderRadius:8, marginBottom:8, border:'1px solid #eee' }}>
              <Grid><Item label="Asset Tag" value={eq.tag} /><Item label="Type" value={eq.type} /></Grid>
              {eq.notes && <Item label="Notes" value={eq.notes} />}
            </div>
          ))}
        </Section>
      )}

      {parts.length > 0 && (
        <Section title="Parts & Services" icon="🔩">
          {parts.map((part, idx) => (
            <div key={idx} style={{
              display:'flex', justifyContent:'space-between', alignItems:'center',
              padding:'10px 14px', background: idx%2===0 ? '#fff' : '#f8f9fa',
              borderRadius:8, marginBottom:4, border:'1px solid #eee' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{part.name}</div>
                <div style={{ fontSize:12, color:'#888' }}>{part.sku} · {fmt(part.price)} each</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontSize:13, color:'#666' }}>× {part.qty}</span>
                <span style={{ fontSize:13, fontWeight:700, color:'#e65c00', minWidth:70, textAlign:'right' }}>{fmt(part.price * part.qty)}</span>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Mileage & Labor" icon="🚛">
        <Grid>
          <Item label="Miles" value={String(sub.miles || 0)} />
          <Item label="Cost / Mile" value={fmt(sub.cost_per_mile)} />
          <Item label="Labor Hours" value={String(sub.labor_hours || 0)} />
          <Item label="Hourly Rate" value={fmt(sub.labor_rate)} />
          <Item label="Billable Techs" value={String(d.billable_techs || 1)} />
        </Grid>
      </Section>

      <Section title="Cost Summary" icon="💰">
        {isWarranty ? (
          <div style={{ textAlign:'center', padding:20, background:'#fff3cd', borderRadius:8, border:'2px solid #ffc107' }}>
            <p style={{ fontSize:20, fontWeight:900, color:'#856404', letterSpacing:2, margin:0 }}>WARRANTY — NO CHARGE</p>
          </div>
        ) : (
          <div style={{ background:'#f8f9fa', borderRadius:8, padding:16 }}>
            {[['Parts Cost',fmt(d.parts_total||0)],['Mileage Cost',fmt(d.mileage_total||0)],['Labor Cost',fmt(d.labor_total||0)]].map(([l,v])=>(
              <div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ color:'#666', fontSize:14 }}>{l}</span><span style={{ fontWeight:600, fontSize:14 }}>{v}</span>
              </div>
            ))}
            <div style={{ borderTop:'2px solid #333', paddingTop:12, marginTop:8, display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontWeight:700, fontSize:16 }}>TOTAL</span>
              <span style={{ fontWeight:700, fontSize:18, color:'#e65c00' }}>{fmt(d.grand_total||0)}</span>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ background:'#1a2332', color:'#fff', padding:'10px 16px', borderRadius:'8px 8px 0 0', display:'flex', alignItems:'center', gap:8 }}>
        <span>{icon}</span><span style={{ fontWeight:700, fontSize:13, letterSpacing:1 }}>{title.toUpperCase()}</span>
      </div>
      <div style={{ background:'#fff', border:'1px solid #ddd', borderTop:'none', borderRadius:'0 0 8px 8px', padding:16 }}>{children}</div>
    </div>
  )
}
function Grid({ children }) { return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 16px' }}>{children}</div> }
function Item({ label, value, highlight }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#aaa', letterSpacing:1, textTransform:'uppercase', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:500, color: highlight ? '#e65c00' : '#1a2332' }}>{value}</div>
    </div>
  )
}
const backBtn = { background:'none', border:'none', color:'#e65c00', fontWeight:700, fontSize:14, cursor:'pointer', padding:'0 0 16px', display:'block' }
