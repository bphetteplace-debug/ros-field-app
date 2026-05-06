import { useRef } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import Field from './Field.jsx';

export default function EquipmentCard({
  eq,
  idx,
  updateEquipment,
  addEquipmentPhotos,
  removeEquipmentPhoto,
  removeEquipment,
}) {
  const photoRef = useRef();
  const yesNo = ['', 'Yes', 'No', 'N/A'];

  return (
    <div className="bg-slate-50 rounded-md p-4 mb-3 border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <div className="display-font font-bold text-slate-900 tracking-wider">UNIT #{idx + 1}</div>
        <button onClick={() => removeEquipment(eq.id)} className="text-slate-400 hover:text-red-600">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Field label="Serial Number">
          <input
            className="ros-input mono-font"
            value={eq.serial}
            onChange={(e) => updateEquipment(eq.id, 'serial', e.target.value)}
            placeholder="e.g. KOFS00002017"
          />
        </Field>
        <Field label="Pump Motor">
          <select
            className="ros-input"
            value={eq.pumpMotor}
            onChange={(e) => updateEquipment(eq.id, 'pumpMotor', e.target.value)}
          >
            {yesNo.map((y) => (
              <option key={y} value={y}>
                {y || '— select —'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Level Switch Functional">
          <select
            className="ros-input"
            value={eq.levelSwitch}
            onChange={(e) => updateEquipment(eq.id, 'levelSwitch', e.target.value)}
          >
            {yesNo.map((y) => (
              <option key={y} value={y}>
                {y || '— select —'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fluid Pumped Off">
          <select
            className="ros-input"
            value={eq.fluidPumped}
            onChange={(e) => updateEquipment(eq.id, 'fluidPumped', e.target.value)}
          >
            {yesNo.map((y) => (
              <option key={y} value={y}>
                {y || '— select —'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fan Motor Functional">
          <select
            className="ros-input"
            value={eq.fanMotor}
            onChange={(e) => updateEquipment(eq.id, 'fanMotor', e.target.value)}
          >
            {yesNo.map((y) => (
              <option key={y} value={y}>
                {y || '— select —'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="ros-label">Unit Photos</label>
      <div className="photo-grid">
        {eq.photos.map((p) => (
          <div key={p.id} className="photo-cell group">
            <img src={p.url} alt="" />
            <button
              onClick={() => removeEquipmentPhoto(eq.id, p.id)}
              className="absolute top-1.5 right-1.5 bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => photoRef.current?.click()}
          className="photo-cell border-2 border-dashed border-slate-300 hover:border-orange-500 flex flex-col items-center justify-center text-slate-500 hover:text-orange-600 transition bg-white"
        >
          <Plus className="w-6 h-6 mb-1" />
          <span className="text-xs font-bold uppercase tracking-wider">Photo</span>
        </button>
      </div>
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          addEquipmentPhotos(eq.id, e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
