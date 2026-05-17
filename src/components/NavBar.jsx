import { Link } from 'react-router-dom'
import { useLang, t, SUPPORTED_LANGS } from '../lib/i18n'

// Global two-row navigation bar
// Props: user (object), isAdmin (bool), isDemo (bool), onLogout (function), loggingOut (bool)
export default function NavBar({ user, isAdmin, isDemo, onLogout, loggingOut }) {
  const [lang, setLang] = useLang()
  var btn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '6px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
    border: 'none', cursor: 'pointer', textDecoration: 'none', lineHeight: 1.2,
  }
  return (
    <div style={{ background: '#1a2332', position: 'sticky', top: 0, zIndex: 100, padding: '8px 12px 10px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to='/submissions' style={{ color: '#e65c00', fontWeight: 800, fontSize: 16, textDecoration: 'none' }}>
            ReliableTrack
          </Link>
          {isDemo && (
            <span style={{ background: '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, letterSpacing: 0.5 }}>
              DEMO MODE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Language toggle — sticky per-device via localStorage. Pedro/Vladimir
              flip to ES once on their phone and it stays. */}
          <div role='group' aria-label={t('Language', lang)} style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.08)', borderRadius: 6, padding: 2, border: '1px solid rgba(255,255,255,0.18)' }}>
            {SUPPORTED_LANGS.map(L => (
              <button key={L.code} type='button' onClick={() => setLang(L.code)}
                title={L.label}
                aria-pressed={lang === L.code}
                style={{
                  border: 'none',
                  background: lang === L.code ? '#fff' : 'transparent',
                  color: lang === L.code ? '#1a2332' : '#d1d5db',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '4px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  letterSpacing: 0.3,
                  lineHeight: 1,
                }}>
                {L.flag} {L.code.toUpperCase()}
              </button>
            ))}
          </div>
          {user && !isDemo && <span style={{ color: '#aaa', fontSize: 12 }}>{user.email}</span>}
          {isDemo ? (
            <button onClick={onLogout} disabled={loggingOut}
              style={{ ...btn, background: '#7c3aed', color: '#fff', border: '1px solid #9f67ff', opacity: loggingOut ? 0.6 : 1, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
              {loggingOut ? 'Exiting...' : '🚪 Exit Demo'}
            </button>
          ) : (
            <button onClick={onLogout} disabled={loggingOut}
              style={{ ...btn, background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', opacity: loggingOut ? 0.6 : 1, padding: '6px 12px', fontSize: 12 }}>
              {loggingOut ? t('Logging out...', lang) : t('Logout', lang)}
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Link to='/form' style={{ ...btn, background: '#e65c00', color: '#fff', flex: '1 1 auto', minWidth: 90 }}>{t('+ Work Order', lang)}</Link>
        <Link to='/expense' style={{ ...btn, background: '#059669', color: '#fff', flex: '1 1 auto', minWidth: 65 }}>{t('+ Expense', lang)}</Link>
        <Link to='/inspection' style={{ ...btn, background: '#7c3aed', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>{t('+ Insp', lang)}</Link>
        <Link to='/jha' style={{ ...btn, background: '#b45309', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>{t('+ JHA', lang)}</Link>
        <Link to='/inventory' style={{ ...btn, background: '#0d9488', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>{t('Inventory', lang)}</Link>
        <Link to='/quote' style={{ ...btn, background: '#d97706', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>{t('+ Quote', lang)}</Link>
        <Link to='/submissions' style={{ ...btn, background: 'rgba(255,255,255,0.10)', color: '#fff', flex: '1 1 auto', minWidth: 80 }}>{t('My Jobs', lang)}</Link>
        {isAdmin && <Link to='/admin' style={{ ...btn, background: 'rgba(255,255,255,0.15)', color: '#fff', flex: '1 1 auto', minWidth: 55 }}>{t('Admin', lang)}</Link>}
      </div>
    </div>
  )
}
