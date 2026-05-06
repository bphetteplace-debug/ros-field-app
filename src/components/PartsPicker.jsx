import { useState } from 'react';
import { Search } from 'lucide-react';
import { PARTS_CATALOG } from '../data/catalog.js';
import { PART_CATEGORIES } from '../data/constants.js';
import { fmt } from '../lib/utils.js';

export default function PartsPicker({ addPart, existingCodes = [] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [open, setOpen] = useState(false);

  const filtered = PARTS_CATALOG.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return p.code.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
  });

  const handleAdd = (code) => {
    addPart(code);
    setQuery('');
    setOpen(false);
  };

  return (
    <div>
      <label className="ros-label">Search Catalog · {PARTS_CATALOG.length} SKUs</label>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            className="ros-input"
            style={{ paddingLeft: '34px' }}
            placeholder="Search by code or description..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </div>
        <select className="ros-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {PART_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {open && (query.trim() || category !== 'All') && (
        <div className="mt-2 border border-slate-200 rounded-md bg-white shadow-sm overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-600 font-semibold">
              {filtered.length} match{filtered.length === 1 ? '' : 'es'}
              {category !== 'All' && <span className="text-slate-400"> in {category}</span>}
            </span>
            <button
              onClick={() => {
                setQuery('');
                setCategory('All');
                setOpen(false);
              }}
              className="text-slate-500 hover:text-slate-900"
            >
              clear
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No parts match. Try a different search or category.
              </div>
            )}
            {filtered.slice(0, 100).map((p) => {
              const already = existingCodes.includes(p.code);
              return (
                <button
                  key={p.code}
                  onClick={() => handleAdd(p.code)}
                  className="w-full text-left px-3 py-2.5 hover:bg-orange-50 border-b border-slate-100 last:border-0 flex items-center gap-3 transition group"
                >
                  <span className="mono-font text-xs bg-slate-100 group-hover:bg-orange-100 px-1.5 py-0.5 rounded text-slate-700 font-semibold flex-shrink-0">
                    {p.code}
                  </span>
                  <span className="flex-1 text-sm text-slate-900 truncate">{p.desc}</span>
                  <span className="text-xs text-slate-400 hidden sm:inline">{p.category}</span>
                  <span className="mono-font text-sm font-bold text-slate-900 flex-shrink-0">{fmt(p.price)}</span>
                  {already && <span className="text-xs text-orange-600 font-semibold ml-1">+1</span>}
                </button>
              );
            })}
            {filtered.length > 100 && (
              <div className="px-3 py-2 text-xs text-slate-500 text-center bg-slate-50">
                Showing first 100 of {filtered.length}. Refine search to see more.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
