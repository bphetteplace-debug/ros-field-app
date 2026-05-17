// src/lib/translate.js — client helper for batched ES→EN translation.
//
// Usage at submit time:
//   const en = await translateFields({ description, reportedIssue, rootCause })
//   // en === { description: '...', reportedIssue: '...', rootCause: '...' }
//
// Filters empty strings up front and short-circuits when the user is in
// English mode. Lambda silently returns on no-op. Failures degrade
// gracefully — caller keeps the original Spanish + records that
// translation failed so the PDF can fall back to the source.

import { getAuthToken } from './submissions'
import { getLang } from './i18n'

const ENDPOINT = '/api/translate'

// Returns { translations, ok, error } so the caller can choose its own
// fallback behavior. Never throws on network failure — degraded UX beats
// blocking a submission.
export async function translateFields(fields) {
  if (!fields || typeof fields !== 'object') return { translations: {}, ok: true }

  // Strip non-strings + empty / whitespace-only values.
  const work = {}
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && v.trim()) work[k] = v
  }
  if (Object.keys(work).length === 0) return { translations: {}, ok: true }

  // English mode — no translation needed.
  if (getLang() === 'en') return { translations: { ...work }, ok: true }

  const token = getAuthToken() || ''
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ fields: work }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { translations: { ...work }, ok: false, error: 'HTTP ' + res.status + ' ' + txt.slice(0, 200) }
    }
    const json = await res.json()
    const out = json && json.translations ? json.translations : {}
    // Backfill any missing keys with the original — defense against the
    // model dropping a field.
    for (const k of Object.keys(work)) {
      if (typeof out[k] !== 'string') out[k] = work[k]
    }
    return { translations: out, ok: true }
  } catch (err) {
    return { translations: { ...work }, ok: false, error: err?.message || String(err) }
  }
}
