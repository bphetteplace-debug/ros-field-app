import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// Global two-row navigation bar used by all pages
export default function NavBar() {
  const { user, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try { await signOut() } catch(e) {}
    navigate('/login')
  }

  const btn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: 'none', cursor: 'pointer', textDecoration: 'none', lineHeight: 1.2,
  }

  return (
    <div style={{ background: '#1a2332', position: 'sticky', top: 0, zIndex: 100, padding: '8px 12px 10px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Link to='/submissions' style={{ color: '#e65c00', fontWeight: 800, fontSize: 16, textDecoration: 'none' }}>
          🔥 ReliableTrack
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user && <span style={{ color: '#aaa', fontSize: 12 }}>{user.email}</span>}
          <button onClick={handleLogout} disabled={loggingOut}
            style={{ ...btn, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', opacity: loggingOut ? 0.6 : 1, padding: '6px 12px', fontSize: 12 }}>
            {loggingOut ? 'Logging out...' : '🚪 Logout'}
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Link to='/form?type=pm' style={{ ...btn, background: '#e65c00', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>+ PM</Link>
        <Link to='/form?type=sc' style={{ ...btn, background: '#2563eb', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>+ SC</Link>
        <Link to='/form?type=expense' style={{ ...btn, background: '#059669', color: '#fff', flex: '1 1 auto', minWidth: 65 }}>+ Expense</Link>
        <Link to='/form?type=inspection' style={{ ...btn, background: '#7c3aed', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>+ Insp</Link>
        <Link to='/jha' style={{ ...btn, background: '#b45309', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>+ JHA</Link>
        <Link to='/submissions' style={{ ...btn, background: 'rgba(255,255,255,0.10)', color: '#fff', flex: '1 1 auto', minWidth: 80 }}>📋 My Jobs</Link>
        {isAdmin && <Link to='/admin' style={{ ...btn, background: 'rgba(255,255,255,0.10)', color: '#fff', flex: '1 1 auto', minWidth: 70 }}>🛡 Admin</Link>}
      </div>
    </div>
  )
}
