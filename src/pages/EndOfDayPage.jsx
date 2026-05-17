// src/pages/EndOfDayPage.jsx — celebratory wrap-up screen for field techs.
//
// One tap from the Submissions list lands here. Pulls every submission
// the current user filed today (local-date), aggregates the stats that
// matter for a field tech (jobs / hours / miles / revenue / expenses),
// and renders a gradient hero card with big numbers + a small per-job
// list below. Designed to make the app feel like a teammate that knows
// what they did, not a timeclock surveilling them.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchSubmissions } from '../lib/submissions'
import { canonicalTech } from '../lib/techs'
import NavBar from '../components/NavBar'

const fmtMoney = (n) => '$' + (Math.round(n || 0)).toLocaleString('en-US')

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function templateLabel(s) {
  const t = s.template
  if (t === 'pm_flare_combustor') return 'PM'
  if (t === 'service_call') return 'SC'
  if (t === 'expense_report') return 'Expense'
  if (t === 'daily_inspection') return 'Inspection'
  if (t === 'jha') return 'JHA'
  return t || 'Job'
}

const PILL_COLORS = {
  PM:         { bg: '#ede9fe', fg: '#6d28d9' },
  SC:         { bg: '#dbeafe', fg: '#1d4ed8' },
  Expense:    { bg: '#fce7f3', fg: '#be185d' },
  Inspection: { bg: '#fef3c7', fg: '#a16207' },
  JHA:        { bg: '#fee2e2', fg: '#b91c1c' },
}

export default function EndOfDayPage() {
  const { user, profile, isDemo } = useAuth()
  const navigate = useNavigate()
  const [subs, setSubs] = useState(null) // null = loading, [] = loaded empty
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!user?.id) return
    fetchSubmissions(user.id)
      .then(rows => {
        if (cancelled) return
        const today = todayISO()
        const mine = (rows || []).filter(s => {
          const d = s.date || (s.created_at || '').slice(0, 10)
          return d === today
        })
        setSubs(mine)
      })
      .catch(e => { if (!cancelled) setError(e.message || String(e)) })
    return () => { cancelled = true }
  }, [user?.id])

  const stats = useMemo(() => {
    const list = subs || []
    const jobs = list.filter(s => s.template === 'pm_flare_combustor' || s.template === 'service_call')
    const expenses = list.filter(s => s.template === 'expense_report')
    const inspections = list.filter(s => s.template === 'daily_inspection')
    const jhas = list.filter(s => s.template === 'jha')
    const isNonBillable = s => s?.data?.billable === false
    const revenue = jobs.reduce((sum, s) => isNonBillable(s) ? sum : sum + (parseFloat(s.data?.grandTotal || 0) || 0), 0)
    const hours = jobs.reduce((sum, s) => sum + (parseFloat(s.labor_hours || s.data?.laborHours || 0) || 0), 0)
    const miles = jobs.reduce((sum, s) => sum + (parseFloat(s.data?.miles || 0) || 0), 0)
    const expenseTotal = expenses.reduce((sum, s) => sum + (parseFloat(s.data?.expenseTotal || 0) || 0), 0)
    return { total: list.length, jobs: jobs.length, pms: jobs.filter(s => s.template === 'pm_flare_combustor').length, scs: jobs.filter(s => s.template === 'service_call').length, expenses: expenses.length, inspections: inspections.length, jhas: jhas.length, hours, miles, revenue, expenseTotal }
  }, [subs])

  const firstName = (profile?.full_name || user?.email || 'there').split(/\s+/)[0]
  const techName = canonicalTech(profile?.full_name) || profile?.full_name || ''

  const heroMsg = useMemo(() => {
    if (!subs) return ''
    const n = stats.total
    if (n === 0) return "No tickets filed today — that's OK. Rest up."
    if (n === 1) return "One down. Solid effort, " + firstName + "."
    if (n <= 3) return "Nice push today, " + firstName + "."
    if (n <= 6) return "Heavy day, " + firstName + ". Real work."
    return "Monster day, " + firstName + ". You showed up."
  }, [stats.total, subs, firstName])

  return (
    <div>
      <NavBar />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px' }}>

        {/* Header / back link */}
        <button onClick={() => navigate('/submissions')}
          style={{ background: 'transparent', border: 'none', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '4px 0', marginBottom: 12 }}>
          ← Back to jobs
        </button>

        {/* Loading state */}
        {subs === null && !error && (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            Tallying today's work…
          </div>
        )}

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 9, padding: '12px 16px', fontSize: 13 }}>
            Couldn't load today's data: {error}
          </div>
        )}

        {/* Hero card */}
        {subs && !error && (
          <>
            <div style={{
              background: stats.total === 0
                ? 'linear-gradient(135deg, #334155 0%, #475569 100%)'
                : 'linear-gradient(135deg, #0f1f38 0%, #1e3a5f 45%, #e65c00 130%)',
              color: '#fff',
              borderRadius: 18,
              padding: '28px 24px 24px',
              marginBottom: 20,
              boxShadow: '0 12px 40px rgba(15,31,56,0.32)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Decorative sparkle bloom */}
              {stats.total > 0 && (
                <span aria-hidden="true" style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'radial-gradient(60% 80% at 95% 0%, rgba(255,200,120,0.30), transparent 65%), radial-gradient(50% 60% at 0% 100%, rgba(34,211,238,0.20), transparent 60%)',
                }} />
              )}
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, opacity: 0.7, textTransform: 'uppercase' }}>
                  🏁 End of day · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.15, marginTop: 6, letterSpacing: -0.4 }}>
                  {heroMsg}
                </div>
                {techName && stats.total > 0 && (
                  <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>{techName} · {stats.total} submission{stats.total === 1 ? '' : 's'} filed today</div>
                )}

                {/* Stat grid */}
                {stats.total > 0 && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: 12,
                    marginTop: 22,
                  }}>
                    {stats.jobs > 0 && (
                      <StatBlock label="Jobs filed" value={stats.jobs} sub={[
                        stats.pms ? stats.pms + ' PM' + (stats.pms === 1 ? '' : 's') : null,
                        stats.scs ? stats.scs + ' SC' + (stats.scs === 1 ? '' : 's') : null,
                      ].filter(Boolean).join(' · ')} />
                    )}
                    {stats.hours > 0 && <StatBlock label="Labor hours" value={stats.hours.toFixed(2).replace(/\.?0+$/, '')} sub="logged" />}
                    {stats.miles > 0 && <StatBlock label="Miles driven" value={Math.round(stats.miles).toLocaleString('en-US')} sub="on the road" />}
                    {!isDemo && stats.revenue > 0 && <StatBlock label="Revenue billed" value={fmtMoney(stats.revenue)} sub={null} highlight />}
                    {stats.expenseTotal > 0 && !isDemo && <StatBlock label="Expenses" value={fmtMoney(stats.expenseTotal)} sub={stats.expenses + ' report' + (stats.expenses === 1 ? '' : 's')} />}
                    {stats.inspections > 0 && <StatBlock label="Inspections" value={stats.inspections} sub="completed" />}
                    {stats.jhas > 0 && <StatBlock label="JHAs" value={stats.jhas} sub="filed" />}
                  </div>
                )}
              </div>
            </div>

            {/* Per-job list */}
            {subs.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#64748b', marginBottom: 10 }}>Today's tickets</div>
                {subs
                  .slice()
                  .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
                  .map(s => {
                    const lbl = templateLabel(s)
                    const c = PILL_COLORS[lbl] || { bg: '#f1f5f9', fg: '#475569' }
                    const wo = s.work_order || s.pm_number
                    const time = s.created_at ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
                    return (
                      <button key={s.id} onClick={() => navigate('/view/' + s.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', padding: '10px 4px', fontFamily: 'inherit' }}>
                        <span style={{ background: c.bg, color: c.fg, fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10, letterSpacing: 0.4, flexShrink: 0 }}>{lbl}</span>
                        {wo && <span style={{ fontSize: 12, fontWeight: 800, color: '#1a2332' }}>#{wo}</span>}
                        <span style={{ fontSize: 13, color: '#1a2332', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {s.customer_name || ''}{s.location_name ? ' · ' + s.location_name : ''}
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{time}</span>
                      </button>
                    )
                  })}
              </div>
            )}

            {/* Closing CTA */}
            <button onClick={() => navigate('/submissions')}
              style={{ display: 'block', width: '100%', background: '#0f1f38', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 16px', fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: 0.3, boxShadow: '0 4px 12px rgba(15,31,56,0.25)' }}>
              {stats.total > 0 ? 'Done for the day 🚐' : 'Back to jobs'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function StatBlock({ label, value, sub, highlight }) {
  return (
    <div style={{
      background: highlight ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
      borderRadius: 12,
      padding: '12px 14px',
      backdropFilter: 'blur(3px)',
      border: '1px solid rgba(255,255,255,0.12)',
    }}>
      <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, letterSpacing: -0.4 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
