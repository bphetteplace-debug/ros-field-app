// Searchable customer-contact dropdown. Backed by the customer_contacts
// app_settings entry. Default-filtered to a preferred customer (set the
// preferredCustomer prop, usually from the submission's customer_name) so
// admins working a Diamondback job see Diamondback contacts first; toggle
// "Show all customers" to widen the pool. Free-text fallback: the user can
// type any email (with or without "Name <email>" form) and onChange fires
// with the bare email.
//
// Extracted from StartDispatchDialog so the same UI works in
// ShareDispatchDialog and any future place an admin needs to pick a
// customer email.

import { useEffect, useMemo, useRef, useState } from 'react'
import { getCustomerContacts } from '../lib/submissions'

export default function CustomerContactCombobox({
  value = '',
  onChange,
  preferredCustomer = '',
  placeholder,
  autoFocus = false,
  inputStyle,
}) {
  const [contacts, setContacts] = useState([])
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const wrapRef = useRef(null)
  const initialValueRef = useRef(value)

  // Load contacts once on mount
  useEffect(() => {
    let alive = true
    getCustomerContacts().then(list => {
      if (alive) setContacts(list || [])
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  // If parent resets value externally (e.g. dialog re-opened for a new
  // submission), reset the local query state too.
  useEffect(() => {
    if (value !== initialValueRef.current) {
      setQuery(value || '')
      initialValueRef.current = value
    }
  }, [value])

  // Close dropdown on click outside
  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const preferredLower = preferredCustomer.trim().toLowerCase()

  const hasPreferredMatches = useMemo(() => {
    if (!preferredLower) return false
    return contacts.some(c => (c.customer || '').toLowerCase() === preferredLower)
  }, [contacts, preferredLower])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let pool = contacts
    if (!showAll && preferredLower) {
      const matches = pool.filter(c => (c.customer || '').toLowerCase() === preferredLower)
      if (matches.length) pool = matches
    }
    if (q) {
      pool = pool.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.customer || '').toLowerCase().includes(q)
      )
    }
    return pool.slice(0, 12)
  }, [contacts, query, showAll, preferredLower])

  const pick = (c) => {
    const display = c.name ? c.name + ' <' + c.email + '>' : c.email
    setQuery(display)
    setOpen(false)
    if (onChange) onChange(c.email)
  }

  const handleInput = (val) => {
    setQuery(val)
    const m = val.match(/<\s*([^>\s]+@[^>\s]+)\s*>/)
    const canonical = m ? m[1] : val
    if (onChange) onChange(canonical)
    setOpen(true)
  }

  const baseInput = {
    width: '100%', boxSizing: 'border-box',
    border: '1px solid #cbd5e1', borderRadius: 8,
    padding: '10px 12px', fontSize: 14,
    fontFamily: 'inherit',
  }

  return (
    <div>
      {hasPreferredMatches && (
        <div style={{ marginBottom: 4 }}>
          <button
            type='button'
            onClick={() => setShowAll(v => !v)}
            style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', background: 'transparent', border: '1px solid #0891b2', borderRadius: 12, padding: '1px 8px', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}
          >
            {showAll ? 'Filter to ' + preferredCustomer : 'Show all customers'}
          </button>
        </div>
      )}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <input
          type='text'
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || (hasPreferredMatches
            ? 'Search ' + preferredCustomer + ' contacts or type any email…'
            : 'Search contacts or type any email…')}
          style={{ ...baseInput, ...(inputStyle || {}) }}
          autoFocus={autoFocus}
          autoComplete='off'
        />
        {open && filtered.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#fff', border: '1px solid #cbd5e1', borderTop: 'none',
            borderRadius: '0 0 8px 8px', maxHeight: 240, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(15,31,56,0.12)', zIndex: 10,
          }}>
            {filtered.map(c => (
              <button
                key={c.email}
                type='button'
                onMouseDown={(e) => { e.preventDefault(); pick(c) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '9px 12px', borderBottom: '1px solid #f1f5f9',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a2332' }}>
                  {c.name || c.email}
                  {c.customer && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#0891b2', background: '#ecfeff', padding: '1px 6px', borderRadius: 8, letterSpacing: 0.4 }}>{c.customer}</span>}
                </div>
                {c.name && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace' }}>{c.email}</div>
                )}
              </button>
            ))}
          </div>
        )}
        {open && filtered.length === 0 && query && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#fff', border: '1px solid #cbd5e1', borderTop: 'none',
            borderRadius: '0 0 8px 8px', padding: '10px 12px',
            fontSize: 12, color: '#94a3b8', boxShadow: '0 8px 24px rgba(15,31,56,0.12)', zIndex: 10,
          }}>
            No saved contact matches — you can still type any email.
          </div>
        )}
      </div>
    </div>
  )
}
