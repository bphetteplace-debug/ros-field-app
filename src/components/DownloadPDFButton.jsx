// src/components/DownloadPDFButton.jsx
// Client-side PDF download using html2pdf.js
import { useState } from 'react';
import { buildPDFData } from '../lib/pdfData';
import { getPhotoUrl } from '../lib/submissions';

async function loadHtml2Pdf() {
  const mod = await import('html2pdf.js');
  return mod.default || mod;
}

export function DownloadPDFButton({ sub, style }) {
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const data = buildPDFData(sub, (path) => getPhotoUrl(path));
      const { WorkOrderPDFTemplate } = await import('./WorkOrderPDFTemplate.jsx');
      const { createRoot } = await import('react-dom/client');
      const { createElement } = await import('react');

      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:8.5in;background:#fff;';
      document.body.appendChild(container);

      await new Promise((resolve) => {
        const root = createRoot(container);
        root.render(createElement(WorkOrderPDFTemplate, { data }));
        setTimeout(resolve, 300);
      });

      const html2pdf = await loadHtml2Pdf();
      await html2pdf().set({
        margin: 0,
        filename: 'WO-' + data.wo_number + '.pdf',
        image: { type: 'jpeg', quality: 0.92 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: '.card' },
      }).from(container).save();

      container.remove();
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('PDF generation failed: ' + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={busy}
      style={{
        background: '#1a2744',
        color: '#fff',
        border: 'none',
        padding: '6px 14px',
        borderRadius: 4,
        fontSize: 13,
        fontWeight: 700,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.7 : 1,
        ...style,
      }}
    >
      {busy ? 'Generating...' : 'Download PDF'}
    </button>
  );
}
