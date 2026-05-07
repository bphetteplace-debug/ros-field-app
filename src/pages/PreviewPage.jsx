import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Flame } from 'lucide-react';
import Banner from '../components/Banner.jsx';
import { fmt } from '../lib/utils.js';

export default function PreviewPage() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    const stored = sessionStorage.getItem('ros_preview_payload');
    if (!stored) {
      navigate('/form');
      return;
    }
    setPayload(JSON.parse(stored));
  }, [navigate]);

  if (!payload) return null;

  const {
    pmNumber, form, siteSignPhoto, completedPhotos, equipment, parts,
    partsCost, mileageCost, laborCost, baseCost, totalCost,
  } = payload;

  return (
    <main className="max-w-4xl mx-auto p-3 sm:p-6 pb-20">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate('/form')}
          className="px-3 py-2 bg-white border border-slate-300 rounded-md text-sm font-semibold flex items-center gap-1.5 hover:border-slate-500 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Form
        </button>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold rounded-md flex items-center gap-1.5 transition shadow"
        >
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      <div className="bg-white shadow-xl print-page" style={{ minHeight: '11in' }}>
        {/* Page 1: Header + Customer Info + Description */}
        <div className="p-8 sm:p-12">
          <div className="flex items-end justify-between pb-3 mb-4 border-b-2 border-slate-900">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-orange-600 flex items-center justify-center">
                <Flame className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="display-font font-bold text-2xl text-slate-900 tracking-wide">RELIABLE OILFIELD SERVICES</div>
                <div className="text-xs text-slate-500 tracking-wider mt-0.5">
                  {form.jobType === 'PM' ? 'PM' : 'SERVICE CALL'} REPORT · reliable-oilfield-services.com
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase tracking-wider">No.</div>
              <div className="display-font font-bold text-3xl text-slate-900 mono-font">#{pmNumber}</div>
              {form.warrantyWork && (
                <div className="mt-1 inline-block px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-400 text-[10px] uppercase tracking-widest font-bold rounded">
                  Warranty
                </div>
              )}
            </div>
          </div>

          <Banner>Customer Information</Banner>
          <div className="grid grid-cols-3 gap-x-6 gap-y-3 mb-5 text-sm">
            <PreviewField label="Customer" value={form.customer} />
            <PreviewField label="Truck" value={form.truck} mono />
            <PreviewField label="Date" value={form.date} mono />
            <PreviewField label="Location" value={form.location} />
            <PreviewField label="Contact" value={form.contact} />
            <PreviewField label="Start Time" value={form.startTime} mono />
            <PreviewField label="Work Order" value={form.workOrder} mono />
            <PreviewField label="Type of Work" value={form.workType} colSpan={2} />
            <PreviewField label="GL Code" value={form.glCode} mono />
            <PreviewField label="Asset Tag" value={form.assetTag} mono />
            <PreviewField label="Work Area" value={form.workArea} />
          </div>

          {siteSignPhoto && (
            <div className="mb-5">
              <div className="ros-label mb-2">Site Sign</div>
              <img
                src={siteSignPhoto}
                alt="Site sign"
                className="w-48 h-36 object-cover rounded-md border border-slate-300"
              />
            </div>
          )}

          <Banner>Description of Work</Banner>
          <div className="mb-5">
            <div className="ros-label mb-1.5">Summary</div>
            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
              {form.summary || <span className="italic text-slate-400">No summary provided.</span>}
            </p>
          </div>

          <div className="mb-5">
            <div className="ros-label mb-2">Technicians On Site</div>
            <div className="grid grid-cols-3 gap-4">
              {form.techs.map((t) => (
                <div key={t} className="border-b-2 border-slate-300 pb-1">
                  <div className="text-sm font-semibold text-slate-900">{t}</div>
                  <div className="text-xs text-slate-500 italic mt-0.5">— signature on file —</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Photos page */}
        {completedPhotos.length > 0 && (
          <div className="print-page p-8 sm:p-12 border-t border-slate-200">
            <Banner>Completed Work — Photo Documentation</Banner>
            <CleanPhotoGrid photos={completedPhotos} />
          </div>
        )}

        {/* Equipment pages */}
        {equipment.map((eq, idx) => (
          <div key={eq.id} className="print-page p-8 sm:p-12 border-t border-slate-200">
            <Banner>Equipment Inspection — Unit #{idx + 1}</Banner>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5 text-sm">
              <PreviewField label="Serial Number" value={eq.serial} mono />
              <PreviewField label="Pump Motor" value={eq.pumpMotor} />
              <PreviewField label="Level Switch Functional" value={eq.levelSwitch} />
              <PreviewField label="Fluid Pumped Off" value={eq.fluidPumped} />
              <PreviewField label="Fan Motor Functional" value={eq.fanMotor} />
            </div>
            {eq.photos.length > 0 && <CleanPhotoGrid photos={eq.photos} />}
          </div>
        ))}

        {/* Parts & Cost */}
        <div className="print-page p-8 sm:p-12 border-t border-slate-200">
          {parts.length > 0 && (
            <>
              <Banner>Parts & Services</Banner>
              <table className="w-full text-sm mb-5 border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-900">
                    <th className="text-left py-2 px-2 ros-label" style={{ marginBottom: 0 }}>Code</th>
                    <th className="text-left py-2 px-2 ros-label" style={{ marginBottom: 0 }}>Description</th>
                    <th className="text-right py-2 px-2 ros-label" style={{ marginBottom: 0 }}>Qty</th>
                    <th className="text-right py-2 px-2 ros-label" style={{ marginBottom: 0 }}>Price</th>
                    <th className="text-right py-2 px-2 ros-label" style={{ marginBottom: 0 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p) => (
                    <tr key={p.id} className="border-b border-slate-200">
                      <td className="py-2 px-2 mono-font font-semibold">{p.code}</td>
                      <td className="py-2 px-2">{p.desc}</td>
                      <td className="py-2 px-2 text-right mono-font">{Number(p.qty).toFixed(2)}</td>
                      <td className="py-2 px-2 text-right mono-font">{fmt(p.price)}</td>
                      <td className="py-2 px-2 text-right mono-font font-semibold">{fmt(p.price * p.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <Banner>Cost Summary</Banner>
          <div className="bg-slate-900 text-white p-5 rounded-md mono-font max-w-md ml-auto">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-300">Parts</span>
                <span>{fmt(partsCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Mileage ({form.miles || 0} mi @ {fmt(form.costPerMile)})</span>
                <span>{fmt(mileageCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Labor ({form.laborHours || 0} hr @ {fmt(form.laborRate)})</span>
                <span>{fmt(laborCost)}</span>
              </div>
            </div>
            <div className="h-px bg-white/20 my-3" />
            {form.warrantyWork ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-300">Standard Total</span>
                  <span>{fmt(baseCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-amber-300">Warranty Discount</span>
                  <span className="text-amber-300">-{fmt(baseCost)}</span>
                </div>
                <div className="h-px bg-white/20 my-3" />
                <div className="flex justify-between items-baseline">
                  <span className="display-font text-base tracking-wider">
                    TOTAL <span className="text-amber-400 text-xs">(WARRANTY)</span>
                  </span>
                  <span className="display-font text-2xl text-orange-400 font-bold">{fmt(0)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between items-baseline">
                <span className="display-font text-base tracking-wider">TOTAL</span>
                <span className="display-font text-2xl text-orange-400 font-bold">{fmt(totalCost)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function PreviewField({ label, value, mono, colSpan }) {
  return (
    <div style={colSpan ? { gridColumn: `span ${colSpan}` } : undefined}>
      <div className="ros-label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className={`text-slate-900 font-medium ${mono ? 'mono-font' : ''}`}>
        {value || <span className="italic text-slate-400 font-normal">—</span>}
      </div>
    </div>
  );
}

function CleanPhotoGrid({ photos }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {photos.map((p) => (
        <div key={p.id}>
          <div className="photo-cell border border-slate-200">
            <img src={p.url} alt="" />
          </div>
          {p.caption && <div className="text-xs text-slate-600 mt-1.5 leading-snug">{p.caption}</div>}
        </div>
      ))}
    </div>
  );
}
