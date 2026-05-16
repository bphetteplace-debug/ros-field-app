// Modal dialog that admin opens to start a customer-tracking dispatch
// for an assigned submission. Creates the active_dispatch row, fires the
// notify-dispatch email lambda, and copies the tracking URL to clipboard.
import { useState, useEffect } from 'react'
import { createDispatch } from '../lib/dispatch'
import { toast } from '../lib/toast'
import { getAuthToken } from '../lib/submissions'

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15, 31, 56, 0.65)',
  zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
const input = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #cbd5e1', borderRadius: 8,
  padding: '10px 12px', fontSize: 14, marginBottom: 14,
  fontFamily: 'inherit',
}

export default function StartDispatchDialog({ submission, techName, onClose, onSent }) {
  const [customerEmail, setCustomerEmail] = useState('')
  const [destinationLabel, setDestinationLabel] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!submission) return
    setCustomerEmail('')
    // Build a friendly destination label from customer + location
    const parts = []
    if (submission.customer_name) parts.push(submission.customer_name)
    if (submission.location_name) parts.push(submission.location_name)
    setDestinationLabel(parts.join(' — '))
  }, [submission?.id])

  if (!submission) return null

  const destLat = submission.data?.gpsLat ?? null
  const destLng = submission.data?.gpsLng ?? null
  const hasGps = destLat != null && destLng != null

  async function handleSend() {
    if (sending) return
    const email = customerEmail.trim()
    if (!email || !email.includes('@')) {
      toast.warning('Please enter a valid customer email')
      return
    }
    setSending(true)
    try {
      const row = await createDispatch({
        submissionId: submission.id,
        techId: submission.created_by,
        techName: techName || null,
        customerName: submission.customer_name || 'Customer',
        customerEmail: email,
        destinationLat: destLat,
        destinationLng: destLng,
        destinationLabel: destinationLabel.trim() || null,
      })
      const token = row && row.share_token
      if (!token) throw new Error('Server did not return a tracking token')

      // Send the email (fire-and-respond — capture errors but don't block UX)
      const emailRes = await fetch('/api/notify-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          customerEmail: email,
          customerName: submission.customer_name,
          techName: techName || null,
          destinationLabel: destinationLabel.trim() || null,
        }),
      })

      const trackingUrl = window.location.origin + '/track/' + token
      try { await navigator.clipboard.writeText(trackingUrl) } catch {}

      if (emailRes.ok) {
        toast.success('Tracking link sent to ' + email + ' — also copied to clipboard.', 6000)
      } else {
        const body = await emailRes.json().catch(() => ({}))
        toast.warning('Dispatch started, but email failed: ' + (body.error || emailRes.status) + '. Link copied to clipboard.', 8000)
      }

      if (onSent) onSent({ token, trackingUrl, row })
      onClose()
    } catch (e) {
      console.error('Start dispatch failed:', e)
      toast.error('Could not start dispatch: ' + (e.message || e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              Start customer tracking
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>
              WO #{submission.work_order || submission.pm_number}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 4 }}>
            ×
          </button>
        </div>

        <div style={body}>
          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, margin: '0 0 18px' }}>
            We'll email <b>{submission.customer_name || 'the customer'}</b> a private tracking link.
            They'll see <b>{techName || 'the tech'}</b>'s live location on a map until the job is marked complete.
          </p>

          <label style={label}>Customer email *</label>
          <input
            type="email"
            value={customerEmail}
            onChange={e => setCustomerEmail(e.target.value)}
            placeholder="customer@example.com"
            style={input}
            autoFocus
          />

          <label style={label}>Destination label</label>
          <input
            type="text"
            value={destinationLabel}
            onChange={e => setDestinationLabel(e.target.value)}
            placeholder="Customer name — Site name"
            style={input}
          />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -8, marginBottom: 14 }}>
            Shown as the destination on the customer's map.
          </div>

          <div style={{
            background: hasGps ? '#ecfdf5' : '#fff7ed',
            border: '1px solid ' + (hasGps ? '#a7f3d0' : '#fed7aa'),
            borderRadius: 8, padding: '10px 12px', fontSize: 13,
            color: hasGps ? '#065f46' : '#9a3412',
          }}>
            {hasGps
              ? '📍 Destination GPS captured from the submission — customer will see your site pinned on the map.'
              : '⚠️ No GPS on the submission. The customer will see the tech moving but no destination pin. They can still track arrival.'}
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
            disabled={sending || !customerEmail.trim()}
            style={{
              background: sending || !customerEmail.trim() ? '#9ca3af' : '#e65c00',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '9px 22px', fontWeight: 800, fontSize: 13,
              cursor: sending || !customerEmail.trim() ? 'not-allowed' : 'pointer',
              boxShadow: sending ? 'none' : '0 4px 10px rgba(230,92,0,0.3)',
            }}
          >
            {sending ? 'Sending…' : '📍 Start Tracking & Email Customer'}
          </button>
        </div>
      </div>
    </div>
  )
}
