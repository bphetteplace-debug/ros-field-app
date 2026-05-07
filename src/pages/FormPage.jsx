import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Camera, Plus, X, Truck, Building2, Package, Trash2,
  ClipboardList, Eye, ChevronRight, CheckCircle2, Flame, DollarSign,
} from 'lucide-react';

import Section from '../components/Section.jsx';
import Field from '../components/Field.jsx';
import PartsPicker from '../components/PartsPicker.jsx';
import EquipmentCard from '../components/EquipmentCard.jsx';
import { CUSTOMERS, TRUCKS, TECHS, WORK_TYPES } from '../data/constants.js';
import { PARTS_CATALOG } from '../data/catalog.js';
import { fmt, todayISO, nowTime, uuid } from '../lib/utils.js';
import { compressImage, fileToDataURL } from '../lib/imageCompress.js';

export default function FormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialJobType = searchParams.get('type') === 'sc' ? 'Service Call' : 'PM';

  const [pmNumber] = useState(() => Math.floor(9136 + Math.random() * 864).toString());
  const [form, setForm] = useState({
    jobType: initialJobType, // 'PM' or 'Service Call' — set from ?type= query param
    warrantyWork: false,     // when true, totalCost is forced to $0.00
    customer: 'Diamondback',
    location: '',
    glCode: 'N/A',
    assetTag: 'N/A',
    workOrder: '',
    truck: '0003',
    contact: '',
    workType: 'PM Flare/Combustor Flame Arrester',
    workArea: '',
    date: todayISO(),
    startTime: nowTime(),
    summary: '',
    techs: ['Matthew Reid'],
    miles: '',
    costPerMile: '1.50',
    departureTime: '',
    laborHours: '0',
    laborRate: '115.00',
  });

  const [siteSignPhoto, setSiteSignPhoto] = useState(null);
  const [completedPhotos, setCompletedPhotos] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [parts, setParts] = useState([]);

  const updateForm = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  // ----- Photo handling -----
  async function processPhoto(file) {
    const compressed = await compressImage(file);
    const url = await fileToDataURL(compressed);
    return { id: uuid(), url, caption: '' };
  }

  const MAX_COMPLETED_PHOTOS = 20;

  async function addCompletedPhotos(files) {
    const remaining = MAX_COMPLETED_PHOTOS - completedPhotos.length;
    if (remaining <= 0) {
      alert(`You've reached the ${MAX_COMPLETED_PHOTOS}-photo limit for this section. Remove a photo to add a new one.`);
      return;
    }
    const incoming = [...files].slice(0, remaining);
    if (files.length > remaining) {
      alert(`Only added ${remaining} photo(s) — section limit is ${MAX_COMPLETED_PHOTOS}.`);
    }
    const newPhotos = await Promise.all(incoming.map(processPhoto));
    setCompletedPhotos((p) => [...p, ...newPhotos]);
  }

  const updatePhotoCaption = (id, caption) =>
    setCompletedPhotos((p) => p.map((ph) => (ph.id === id ? { ...ph, caption } : ph)));

  const removeCompletedPhoto = (id) =>
    setCompletedPhotos((p) => p.filter((ph) => ph.id !== id));

  // ----- Equipment -----
  const addEquipment = () =>
    setEquipment((e) => [
      ...e,
      { id: uuid(), serial: '', pumpMotor: '', levelSwitch: '', fluidPumped: '', fanMotor: '', photos: [] },
    ]);

  const updateEquipment = (id, key, val) =>
    setEquipment((e) => e.map((eq) => (eq.id === id ? { ...eq, [key]: val } : eq)));

  async function addEquipmentPhotos(id, files) {
    const newPhotos = await Promise.all([...files].map(processPhoto));
    setEquipment((e) => e.map((eq) => (eq.id === id ? { ...eq, photos: [...eq.photos, ...newPhotos] } : eq)));
  }

  const removeEquipmentPhoto = (eqId, photoId) =>
    setEquipment((e) =>
      e.map((eq) => (eq.id === eqId ? { ...eq, photos: eq.photos.filter((p) => p.id !== photoId) } : eq))
    );

  const removeEquipment = (id) => setEquipment((e) => e.filter((eq) => eq.id !== id));

  // ----- Parts -----
  const addPart = (code) => {
    const cat = PARTS_CATALOG.find((p) => p.code === code);
    if (!cat) return;
    setParts((p) => [
      ...p,
      { id: uuid(), code: cat.code, desc: cat.desc, price: cat.price, qty: 1 },
    ]);
  };
  const updatePart = (id, key, val) =>
    setParts((p) => p.map((pt) => (pt.id === id ? { ...pt, [key]: val } : pt)));
  const removePart = (id) => setParts((p) => p.filter((pt) => pt.id !== id));

  // ----- Costs -----
  const partsCost = parts.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.qty) || 0), 0);
  const mileageCost = (Number(form.miles) || 0) * (Number(form.costPerMile) || 0);
  const laborCost = (Number(form.laborHours) || 0) * (Number(form.laborRate) || 0);
  // Underlying cost is always tracked. Warranty zeroes out the customer-facing total only.
  const baseCost = partsCost + mileageCost + laborCost;
  const totalCost = form.warrantyWork ? 0 : baseCost;

  // ----- Site sign -----
  const siteSignRef = useRef();
  const completedRef = useRef();

  async function handleSiteSign(file) {
    if (!file) {
      setSiteSignPhoto(null);
      return;
    }
    const compressed = await compressImage(file);
    setSiteSignPhoto(await fileToDataURL(compressed));
  }

  // ----- Submit / Preview -----
  // In Week 2, this saves to Supabase. For now it stashes in sessionStorage so Preview can read it.
  function goToPreview() {
    sessionStorage.setItem('ros_preview_payload', JSON.stringify({
      pmNumber,
      form,
      siteSignPhoto,
      completedPhotos,
      equipment,
      parts,
      partsCost,
      mileageCost,
      laborCost,
      baseCost,
      totalCost,
    }));
    navigate('/preview');
  }

  return (
    <main className="max-w-5xl mx-auto p-3 sm:p-6 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="display-font font-bold text-xl sm:text-2xl text-slate-900 tracking-wider">
            {form.jobType === 'PM' ? 'PM' : 'SERVICE CALL'}
            {form.warrantyWork && (
              <span className="ml-3 inline-block px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-xs rounded uppercase tracking-wide align-middle">
                Warranty
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mono-font mt-0.5">{form.jobType === 'PM' ? 'PM' : 'SC'} #{pmNumber}</p>
        </div>
      </div>

      {/* Job Type & Warranty */}
      <Section icon={ClipboardList} title="Job Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <Field label="Job Type">
            <select
              className="ros-input"
              value={form.jobType}
              onChange={(e) => updateForm('jobType', e.target.value)}
            >
              <option value="PM">PM (Preventive Maintenance)</option>
              <option value="Service Call">Service Call</option>
            </select>
          </Field>
          <Field label="Warranty Work">
            <label className="flex items-center gap-2 ros-input cursor-pointer select-none" style={{ paddingTop: '10px', paddingBottom: '10px' }}>
              <input
                type="checkbox"
                className="w-5 h-5 accent-orange-600 cursor-pointer"
                checked={form.warrantyWork}
                onChange={(e) => updateForm('warrantyWork', e.target.checked)}
              />
              <span className="text-sm">
                {form.warrantyWork
                  ? 'Yes — billed at $0.00 (parts/labor still tracked)'
                  : 'No (standard billing)'}
              </span>
            </label>
          </Field>
        </div>
      </Section>

      {/* Customer Info */}
      <Section icon={Building2} title="Customer Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Customer Name">
            <select className="ros-input" value={form.customer} onChange={(e) => updateForm('customer', e.target.value)}>
              {CUSTOMERS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="ROS Truck Number">
            <select className="ros-input mono-font" value={form.truck} onChange={(e) => updateForm('truck', e.target.value)}>
              {TRUCKS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Location Name">
            <input
              className="ros-input"
              placeholder="e.g. Cerberus 11-23"
              value={form.location}
              onChange={(e) => updateForm('location', e.target.value)}
            />
          </Field>
          <Field label="Customer Contact">
            <input
              className="ros-input"
              placeholder="e.g. Ty Fisher"
              value={form.contact}
              onChange={(e) => updateForm('contact', e.target.value)}
            />
          </Field>
          <Field label="Customer Work Order">
            <input
              className="ros-input mono-font"
              placeholder="WO#"
              value={form.workOrder}
              onChange={(e) => updateForm('workOrder', e.target.value)}
            />
          </Field>
          <Field label="Type of Work">
            <select className="ros-input" value={form.workType} onChange={(e) => updateForm('workType', e.target.value)}>
              {WORK_TYPES.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </Field>
          <Field label="GL Code">
            <input className="ros-input mono-font" value={form.glCode} onChange={(e) => updateForm('glCode', e.target.value)} />
          </Field>
          <Field label="Equipment Asset Tag">
            <input className="ros-input mono-font" value={form.assetTag} onChange={(e) => updateForm('assetTag', e.target.value)} />
          </Field>
          <Field label="Work Area">
            <input
              className="ros-input"
              placeholder="e.g. SRRR"
              value={form.workArea}
              onChange={(e) => updateForm('workArea', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                className="ros-input mono-font"
                value={form.date}
                onChange={(e) => updateForm('date', e.target.value)}
              />
            </Field>
            <Field label="Start Time">
              <div className="flex gap-2">
                <input
                  className="ros-input mono-font flex-1"
                  value={form.startTime}
                  onChange={(e) => updateForm('startTime', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => updateForm('startTime', nowTime())}
                  className="px-3 py-2 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 text-xs font-bold rounded-md uppercase tracking-wider transition flex-shrink-0"
                  title="Set to current time"
                >
                  Now
                </button>
              </div>
            </Field>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-slate-200">
          <label className="ros-label">Site Sign Photo</label>
          {siteSignPhoto ? (
            <div className="relative w-40 h-32 rounded-md overflow-hidden">
              <img src={siteSignPhoto} alt="Site sign" className="w-full h-full object-cover" />
              <button
                onClick={() => handleSiteSign(null)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => siteSignRef.current?.click()}
              className="w-40 h-32 border-2 border-dashed border-slate-300 rounded-md flex flex-col items-center justify-center text-slate-500 hover:border-orange-500 hover:text-orange-600 transition"
            >
              <Camera className="w-6 h-6 mb-1" />
              <span className="text-xs font-semibold">Capture</span>
            </button>
          )}
          <input
            ref={siteSignRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleSiteSign(e.target.files?.[0])}
          />
        </div>
      </Section>

      {/* Description */}
      <Section icon={ClipboardList} title="Description of Work">
        <Field label="Summary">
          <textarea
            className="ros-input"
            rows={4}
            placeholder="Describe the work performed..."
            value={form.summary}
            onChange={(e) => updateForm('summary', e.target.value)}
          />
        </Field>
        <div className="mt-4">
          <label className="ros-label">Technicians On Site</label>
          <div className="flex flex-wrap gap-2">
            {TECHS.map((t) => {
              const active = form.techs.includes(t);
              return (
                <button
                  key={t}
                  onClick={() =>
                    updateForm('techs', active ? form.techs.filter((x) => x !== t) : [...form.techs, t])
                  }
                  className={`px-3 py-2 rounded-full text-sm font-semibold border-2 transition ${
                    active
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-slate-500'
                  }`}
                >
                  {active && <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Completed Work Photos */}
      <Section
        icon={Camera}
        title="Completed Work Photos"
        subtitle={`Captioned multi-photo gallery — ${completedPhotos.length}/${MAX_COMPLETED_PHOTOS}`}
      >
        <div className="photo-grid">
          {completedPhotos.map((p) => (
            <div key={p.id} className="space-y-1.5">
              <div className="photo-cell group">
                <img src={p.url} alt="" />
                <button
                  onClick={() => removeCompletedPhoto(p.id)}
                  className="absolute top-1.5 right-1.5 bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                className="ros-input"
                style={{ padding: '6px 8px', fontSize: '13px' }}
                placeholder="Caption (optional)"
                value={p.caption}
                onChange={(e) => updatePhotoCaption(p.id, e.target.value)}
              />
            </div>
          ))}
          {completedPhotos.length < MAX_COMPLETED_PHOTOS && (
            <button
              onClick={() => completedRef.current?.click()}
              className="photo-cell border-2 border-dashed border-slate-300 hover:border-orange-500 flex flex-col items-center justify-center text-slate-500 hover:text-orange-600 transition cursor-pointer bg-white"
            >
              <Plus className="w-8 h-8 mb-1" />
              <span className="text-xs font-bold uppercase tracking-wider">Add Photo</span>
            </button>
          )}
        </div>
        {completedPhotos.length >= MAX_COMPLETED_PHOTOS && (
          <p className="text-xs text-slate-500 mt-3 text-center">
            {MAX_COMPLETED_PHOTOS}-photo limit reached. Remove a photo to add another.
          </p>
        )}
        <input
          ref={completedRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            addCompletedPhotos(e.target.files);
            e.target.value = '';
          }}
        />
      </Section>

      {/* Equipment */}
      <Section
        icon={Flame}
        title="Equipment Inspected"
        subtitle="Add a record per flare / unit / asset"
        actions={
          <button
            onClick={addEquipment}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-md flex items-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4" /> Add Unit
          </button>
        }
      >
        {equipment.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-md">
            No equipment added yet. Tap <span className="font-semibold text-orange-600">Add Unit</span> for each flare or asset.
          </div>
        )}
        {equipment.map((eq, idx) => (
          <EquipmentCard
            key={eq.id}
            eq={eq}
            idx={idx}
            updateEquipment={updateEquipment}
            addEquipmentPhotos={addEquipmentPhotos}
            removeEquipmentPhoto={removeEquipmentPhoto}
            removeEquipment={removeEquipment}
          />
        ))}
      </Section>

      {/* Parts */}
      <Section icon={Package} title="Parts & Services" subtitle={`${PARTS_CATALOG.length} SKUs in catalog`}>
        <PartsPicker addPart={addPart} existingCodes={parts.map((p) => p.code)} />

        {parts.length > 0 && (
          <div className="space-y-2 mt-4">
            {parts.map((p) => (
              <div key={p.id} className="bg-slate-50 rounded-md p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="mono-font text-xs bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-semibold">{p.code}</span>
                    <span className="text-sm text-slate-500">{fmt(p.price)} each</span>
                  </div>
                  <div className="text-sm font-medium text-slate-900 truncate">{p.desc}</div>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={p.qty}
                  onChange={(e) => updatePart(p.id, 'qty', e.target.value)}
                  className="ros-input w-20 mono-font text-center"
                  style={{ padding: '6px 8px' }}
                />
                <div className="text-sm font-bold text-slate-900 mono-font w-20 text-right">{fmt(p.price * (p.qty || 0))}</div>
                <button onClick={() => removePart(p.id)} className="text-slate-400 hover:text-red-600 transition">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-200">
              <div className="text-sm">
                <span className="text-slate-500">Parts Subtotal: </span>
                <span className="mono-font font-bold text-slate-900">{fmt(partsCost)}</span>
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Mileage & Labor */}
      <Section icon={Truck} title="Mileage & Labor">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Miles">
            <input type="number" className="ros-input mono-font" value={form.miles} onChange={(e) => updateForm('miles', e.target.value)} />
          </Field>
          <Field label="Cost / Mile">
            <input type="number" step="0.01" className="ros-input mono-font" value={form.costPerMile} onChange={(e) => updateForm('costPerMile', e.target.value)} />
          </Field>
          <Field label="Labor Hours">
            <input type="number" step="0.25" className="ros-input mono-font" value={form.laborHours} onChange={(e) => updateForm('laborHours', e.target.value)} />
          </Field>
          <Field label="Hourly Rate">
            <input type="number" step="0.01" className="ros-input mono-font" value={form.laborRate} onChange={(e) => updateForm('laborRate', e.target.value)} />
          </Field>
          <Field label="Departure Time">
            <div className="flex gap-2">
              <input
                className="ros-input mono-font flex-1"
                placeholder="e.g. 09:00 AM"
                value={form.departureTime}
                onChange={(e) => updateForm('departureTime', e.target.value)}
              />
              <button
                type="button"
                onClick={() => updateForm('departureTime', nowTime())}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 text-xs font-bold rounded-md uppercase tracking-wider transition flex-shrink-0"
                title="Set to current time"
              >
                Now
              </button>
            </div>
          </Field>
        </div>
      </Section>

      {/* Cost Summary */}
      <Section icon={DollarSign} title="Cost Summary">
        <div className="bg-slate-900 text-white rounded-lg p-5 mono-font">
          <Row label="Parts Cost" value={fmt(partsCost)} />
          <Row label="Mileage Cost" value={fmt(mileageCost)} />
          <Row label="Labor Cost" value={fmt(laborCost)} />
          <div className="h-px bg-white/20 my-3" />
          {form.warrantyWork ? (
            <>
              <Row label="Standard Total" value={fmt(baseCost)} />
              <Row label="Warranty Discount" value={`-${fmt(baseCost)}`} />
              <div className="h-px bg-white/20 my-3" />
              <div className="flex justify-between items-baseline">
                <span className="display-font text-lg tracking-wider">
                  TOTAL <span className="text-amber-400 text-sm">(WARRANTY)</span>
                </span>
                <span className="display-font text-3xl text-orange-400 font-bold">{fmt(0)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between items-baseline">
              <span className="display-font text-lg tracking-wider">TOTAL</span>
              <span className="display-font text-3xl text-orange-400 font-bold">{fmt(totalCost)}</span>
            </div>
          )}
        </div>
      </Section>

      {/* Bottom CTA */}
      <div className="sticky bottom-3 mt-6">
        <button
          onClick={goToPreview}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-2 display-font tracking-wider text-lg transition"
        >
          <Eye className="w-5 h-5" /> PREVIEW PDF <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-slate-300">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}
