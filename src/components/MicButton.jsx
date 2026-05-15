// src/components/MicButton.jsx
//
// Floating mic button that overlays an absolutely-positioned circle on whatever
// parent has `position: relative`. Tapping toggles voice dictation via the
// browser's Web Speech API (built into Safari, Chrome, Edge, etc — no library
// or server). Transcript is appended to the existing value so the tech can
// dictate, edit by hand, dictate more, etc.
//
// Usage:
//   <div style={{ position: 'relative' }}>
//     <textarea value={x} onChange={e => setX(e.target.value)} />
//     <MicButton value={x} onChange={setX} />
//   </div>
//
// Falls back to rendering nothing if the browser doesn't support speech
// recognition (older Firefox, some Linux Chromiums).

import { useEffect, useRef, useState } from 'react';

export default function MicButton({ value, onChange, lang = 'en-US', size = 32, top = 6, right = 6 }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const baselineRef = useRef('');     // value the field had when mic was tapped
  const finalsRef   = useRef('');     // finalized phrases accumulated this session

  // Detect support once at render time. The hook (not constructor) is
  // capability detection — `new SR()` doesn't fire the mic permission prompt;
  // only `rec.start()` does.
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  useEffect(() => () => {
    // Cleanup if the component unmounts mid-listen.
    try { recRef.current && recRef.current.stop(); } catch (_e) {}
  }, []);

  if (!SR) return null;

  const stop = () => {
    try { recRef.current && recRef.current.stop(); } catch (_e) {}
    setListening(false);
  };

  const start = () => {
    if (listening) { stop(); return; }
    const rec = new SR();
    rec.continuous = true;       // keep listening until tech taps stop
    rec.interimResults = true;   // show words as they're recognized
    rec.lang = lang;
    baselineRef.current = value || '';
    finalsRef.current = '';
    // onresult fires repeatedly. e.results is a growing list across the
    // whole session; e.resultIndex points at where the NEW items start.
    // Standard Web Speech pattern: walk only from resultIndex, accumulate
    // finalized phrases into a session-scoped buffer (finalsRef), and
    // re-derive `interim` fresh each call (it represents the current
    // in-progress phrase only). Without this, naïvely concatenating all
    // `e.results` on every callback double-counts interim chunks and
    // produces output like "sealsealseal leakseal on…" instead of
    // "seal leak on…".
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalsRef.current += piece + ' ';
        else interim += piece;
      }
      const out = (baselineRef.current.replace(/\s+$/, '') + ' ' + finalsRef.current + interim)
        .replace(/\s+/g, ' ')
        .trim();
      onChange(out);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch (_e) {
      // start() throws "InvalidStateError" if called twice in a row before onend fires.
      setListening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={start}
      aria-label={listening ? 'Stop dictation' : 'Start voice dictation'}
      title={listening ? 'Tap to stop' : 'Tap to dictate'}
      style={{
        position: 'absolute',
        top, right,
        zIndex: 5,
        width: size, height: size,
        borderRadius: '50%',
        background: listening ? '#dc2626' : 'rgba(15,23,42,0.06)',
        border: 'none',
        cursor: 'pointer',
        color: listening ? '#fff' : '#475569',
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        animation: listening ? 'micPulse 1.5s ease-out infinite' : 'none',
        transition: 'all 0.18s',
      }}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  );
}
