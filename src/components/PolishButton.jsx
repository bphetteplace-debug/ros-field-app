// src/components/PolishButton.jsx
//
// Small ✨ button that sits next to the mic / camera buttons on a dictation
// field. Tap after dictating to send the raw transcript to the /api/polish-text
// lambda, which uses Claude Haiku to fix grammar, spelling, capitalization,
// punctuation, and common speech-to-text mishearings — without changing the
// meaning. The polished text replaces the field's value.
//
// Disabled state: the button is greyed out when the field is empty (nothing
// to polish), already busy, or the user isn't authenticated.

import { useState } from 'react';

function getAuthToken() {
  try {
    const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (!key) return null;
    return JSON.parse(localStorage.getItem(key))?.access_token || null;
  } catch (_) { return null; }
}

export default function PolishButton({ value, onChange, size = 28, top = 6, right = 70, onError }) {
  const [busy, setBusy] = useState(false);

  const canRun = !!value && value.trim().length > 0 && !busy;

  const polish = async () => {
    if (!canRun) return;
    const token = getAuthToken();
    if (!token) {
      if (onError) onError('Sign in required to use AI polish.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/polish-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ text: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 503 = ANTHROPIC_API_KEY not configured. Surface the readable
        // message from the lambda so the admin knows what to fix.
        const msg = body && body.error ? body.error : 'AI polish failed (HTTP ' + res.status + ')';
        if (onError) onError(msg);
        else alert(msg);
        return;
      }
      const polished = (body && typeof body.polished === 'string') ? body.polished : '';
      if (polished && polished !== value) onChange(polished);
    } catch (e) {
      const msg = (e && e.message) || 'Polish request failed';
      if (onError) onError(msg);
      else alert(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={polish}
      disabled={!canRun}
      aria-label="Polish text with AI"
      title={canRun ? 'AI Polish — fix grammar, spelling, punctuation' : (busy ? 'Polishing…' : 'Add text first, then tap to polish')}
      style={{
        position: 'absolute',
        top, right,
        zIndex: 5,
        width: size, height: size,
        borderRadius: '50%',
        background: busy
          ? 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)'
          : (canRun ? 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)' : 'rgba(15,23,42,0.06)'),
        border: 'none',
        cursor: canRun ? 'pointer' : (busy ? 'wait' : 'not-allowed'),
        color: (busy || canRun) ? '#fff' : '#94a3b8',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        opacity: (!canRun && !busy) ? 0.6 : 1,
        animation: busy ? 'polishPulse 1.4s ease-in-out infinite' : 'none',
        transition: 'all 0.18s',
      }}
    >
      {busy ? '◯' : '✨'}
    </button>
  );
}
