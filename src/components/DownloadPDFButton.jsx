// src/components/DownloadPDFButton.jsx
// Client-side PDF download using html2pdf.js
import { useState } from 'react';
import { buildPDFData } from '../lib/pdfData';
import { getPhotoUrl, fetchSettings } from '../lib/submissions';

async function loadHtml2Pdf() {
    const mod = await import('html2pdf.js');
    return mod.default || mod;
}

export function DownloadPDFButton({ sub, style }) {
    const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
        setBusy(true);
        try {
                const data = await buildPDFData(sub, (path) => getPhotoUrl(path));
                const settings = await fetchSettings().catch(() => null);
                const layout   = settings && Array.isArray(settings.pdf_layout) ? settings.pdf_layout : null;
                const branding = settings && settings.branding && typeof settings.branding === 'object' ? settings.branding : null;
                const { WorkOrderPDFTemplate } = await import('./WorkOrderPDFTemplate.jsx');
                const { createRoot }           = await import('react-dom/client');
                const { createElement }        = await import('react');

          const container = document.createElement('div');
                container.style.cssText = 'position:absolute;left:-9999px;top:0;width:8.5in;background:#fff;';
                document.body.appendChild(container);

          await new Promise((resolve) => {
                    const root = createRoot(container);
                    root.render(createElement(WorkOrderPDFTemplate, { data, layout, branding }));

                                    // Wait for initial render, then wait for every image to actually load
                                    setTimeout(async () => {
                                                const imgs = Array.from(container.querySelectorAll('img'));
                                                await Promise.allSettled(
                                                              imgs.map(function(img) {
                                                                              return img.complete
                                                                                ? Promise.resolve()
                                                                                                : new Promise(function(r) { img.onload = r; img.onerror = r; });
                                                              })
                                                            );
                                                resolve();
                                    }, 500);
          });

          const html2pdf = await loadHtml2Pdf();
                await html2pdf().set({
                          margin: 0,
                          filename: 'WO-' + (data.wo_number || data.customer_wo_number) + '.pdf',
                          image:       { type: 'jpeg', quality: 0.92 },
                          html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false },
                          jsPDF:       { unit: 'in', format: 'letter', orientation: 'portrait' },
                          pagebreak:   { mode: ['css', 'legacy'], avoid: '.card' },
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
        <button onClick={handleDownload} disabled={busy} style={style}>
          {busy ? 'Generating PDF...' : 'Download PDF'}
        </button>
      );
}
