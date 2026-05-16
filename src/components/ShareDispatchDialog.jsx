// Modal that emails an existing active_dispatch's tracking link to a
// recipient picked from the searchable customer-contacts dropdown (or
// free-text). Can be opened multiple times for the same dispatch to send
// the link to multiple people (customer, supervisor, dispatcher) — each
// send is audit-logged separately.
import { useState } from 'react'
import { toast } from '../lib/toast'
import { logAudit, getAuthToken } from '../lib/submissions'
import CustomerContactCombobox from './CustomerContactCombobox'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 31, 56, 0.65)',
  zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16,
}
const panel = {
  background: '#fff', borderRadius: 14, maxWidth: 480, width: '100%',
  boxShadow: '0 12px 40px rgba(0,0,0,0.3)', overflow: 'hidden',
  maxHeight: '90vh', display: 'flex', flexDirection: 'column',
}
const header = {
  background: '#0f1f38', color: '#fff', padding: '16px 20px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
}
const body = { padding: '20px', overflowY: 'auto' }
const footer = {
  padding: '12px 20px', borderTop: '1px solid #e5e7eb',
  display: 'flex', gap: 8, justifyContent: 'flex-end',
}
const label = {
  fontSize: 11, fontWeight: 700, color: '#475569',
  letterSpacing: 0.6, textTransform: 'uppercase',
  marginBottom: 6, display: 'block',
}

export default function ShareDispatchDialog({ dispatch, currentUser, onClose }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)

  if (!dispatch) return null

  const trackingUrl = window.location.origin + '/track/' + dispatch.share_token

  async function handleSend() {
    if (sending) return
    const trimmed = email.trim()
    if (!trimmed || !trimmed.includes('@')) {
      toast.warning('Please pick or type a valid email')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/notify-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getAuthToken() || '') },
        body: JSON.stringify({
          token: dispatch.share_token,
          customerEmail: trimmed,
          customerName: dispatch.customer_name,
          techName: dispatch.tech_name || null,
          destinationLabel: dispatch.destination_label || null,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error('HTTP ' + res.status + (text ? ' — ' + text.slice(0, 200) : ''))
      }
      logAudit({
        userId: currentUser?.id,
        userName: currentUser?.full_name || currentUser?.email,
        action: 'dispatch_shared',
        targetType: 'dispatch',
        targetId: dispatch.id,
        details: { recipient: trimmed, customer: dispatch.customer_name, share_token: dispatch.share_token },
      })
      toast.success('Tracking link sent to ' + trimmed, 6000)
      onClose()
    } catch (e) {
      console.error('Share dispatch failed:', e)
      toast.error('Could not send: ' + (e.message || e))
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackingUrl)
      toast.success('Tracking link copied to clipboard')
    } catch {
      toast.warning('Copy failed — link: ' + trackingUrl, 8000)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Share tracking link
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>
              {dispatch.customer_name || 'Dispatch'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 4 }}>
            ×
          </button>
        </div>

        <div style={body}>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 16px' }}>
            Email this dispatch's live tracking page to anyone — customer, supervisor, dispatcher. You can send to multiple people one at a time; each send is logged.
          </p>

          <label style={label}>Send to *</label>
          <div style={{ marginBottom: 18 }}>
            <CustomerContactCombobox
              value={email}
              onChange={setEmail}
              preferredCustomer={dispatch.customer_name || ''}
              autoFocus
            />
          </div>

          <div style={{
            background: '#f8fafc', border: '1px solid #e5e7eb',
            borderRadius: 8, padding: '10px 12px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>
              Tracking link
            </div>
            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' }}>
              {trackingUrl}
            </div>
            <button
              type='button'
              onClick={copyLink}
              style={{ marginTop: 8, background: '#fff', border: '1px solid #cbd5e1', color: '#0369a1', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              🔗 Copy link
            </button>
          </div>
        </div>

        <div style={footer}>
          <button
            onClick={onClose}
            disabled={sending}
            style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !email.trim()}
            style={{
              background: sending || !email.trim() ? '#9ca3af' : '#0891b2',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 22px', fontWeight: 800, fontSize: 13,
              cursor: sending || !email.trim() ? 'not-allowed' : 'pointer',
              boxShadow: sending ? 'none' : '0 4px 10px rgba(8,145,178,0.3)',
            }}
          >
            {sending ? 'Sending…' : '✉️ Send email'}
          </button>
        </div>
      </div>
    </div>
  )
}
