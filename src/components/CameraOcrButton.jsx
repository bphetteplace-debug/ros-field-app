// src/components/CameraOcrButton.jsx
//
// Small camera-icon button that, when tapped, opens the device camera, snaps
// a photo, runs OCR on it in-browser via Tesseract.js, and feeds the extracted
// text into a field's onChange. Use cases: asset tag / serial number / SKU
// nameplates that the tech would otherwise type out by hand.
//
// Tesseract.js is dynamic-imported so it's a separate Vite chunk — the ~10MB
// worker + traineddata only downloads the first time the user taps the button.
// Subsequent uses come from cache.
//
// Usage:
//   <div style={{ position: 'relative' }}>
//     <input value={x} onChange={e => setX(e.target.value)} />
//     <CameraOcrButton onResult={setX} />
//   </div>

import { useRef, useState } from 'react';
import { compressImage } from '../lib/imageCompress';

export default function CameraOcrButton({ onResult, size = 28, top = 6, right = 38, append = false, currentValue = '' }) {
  const [phase, setPhase] = useState(''); // '' | 'loading' | 'reading'
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setPhase('loading');
    try {
      // Compress the photo before OCR — smaller images are faster to process
      // and accuracy is usually FINE up to about 1600px on the long side, which
      // is what compressImage targets.
      const compressed = await compressImage(file).catch(() => file);
      setPhase('reading');
      // Lazy import so Tesseract is only fetched when actually used.
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng');
      const ret = await worker.recognize(compressed);
      await worker.terminate();
      const raw = (ret && ret.data && ret.data.text) ? ret.data.text : '';
      // Nameplate text usually comes back with line breaks and trailing
      // whitespace. Strip + normalize so the result drops into a single-line
      // input cleanly.
      const cleaned = raw.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        if (append && currentValue) onResult((currentValue.trimEnd() + ' ' + cleaned).trim());
        else onResult(cleaned);
      }
    } catch (e) {
      console.warn('OCR failed:', e);
      // Surface to user via the input change handler is awkward — leave the
      // field alone and just log. The phase reset will hide the spinner.
    } finally {
      setPhase('');
    }
  };

  const busy = phase !== '';

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; handleFile(f); }}
      />
      <button
        type="button"
        onClick={() => !busy && fileRef.current && fileRef.current.click()}
        disabled={busy}
        aria-label="Scan nameplate / asset tag"
        title={busy ? (phase === 'reading' ? 'Reading nameplate…' : 'Loading scanner…') : 'Scan nameplate with camera'}
        style={{
          position: 'absolute',
          top, right,
          zIndex: 5,
          width: size, height: size,
          borderRadius: '50%',
          background: busy ? '#e65c00' : 'rgba(15,23,42,0.06)',
          border: 'none',
          cursor: busy ? 'wait' : 'pointer',
          color: busy ? '#fff' : '#475569',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          animation: busy ? 'ocrSpin 0.9s linear infinite' : 'none',
          transition: 'all 0.18s',
        }}
      >
        {busy ? '◯' : '📷'}
      </button>
    </>
  );
}
