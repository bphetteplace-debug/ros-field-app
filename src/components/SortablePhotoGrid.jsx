// src/components/SortablePhotoGrid.jsx
//
// Drag-to-reorder photo grid. Works on touch (long-press to pick up) and on
// mouse. Built on @dnd-kit/sortable so the gesture feels native — pointer
// activates only after the touch moves a few pixels, so single-tap to remove
// or edit caption still works without triggering a drag.
//
// Each item has:
//   - the photo thumbnail (tap to open lightbox via onItemTap)
//   - an "×" remove button
//   - an optional caption input
//   - quick-tag buttons (Before / After / Damage / Repair) for one-tap captions
//
// API:
//   <SortablePhotoGrid
//     items={[{ id, file?, dataUrl?, caption? }, ...]}
//     onReorder={newItems => setItems(newItems)}
//     onRemove={id => ...}
//     onCaption={(id, caption) => ...}
//     onItemTap={(id) => ...}            // optional, opens lightbox
//     quickTags={['Before','After',...]}  // optional, defaults to standard set
//   />

import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const DEFAULT_TAGS = ['Before', 'After', 'Damage', 'Repair', 'Site'];

function SortableItem({ item, index, total, onRemove, onCaption, onItemTap, onMove, quickTags, T }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  const src = item.dataUrl || (item.file ? URL.createObjectURL(item.file) : '');
  return (
    <div ref={setNodeRef} style={{ ...style, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', border: '1px solid ' + T.border, boxShadow: '0 2px 6px rgba(15,23,42,0.06)', background: '#f1f5f9' }}>
        {/* Tap image to open lightbox. WebkitTouchCallout:none suppresses
            the iOS "Save Image" action sheet so it doesn't preempt drag. */}
        <img
          src={src}
          alt={item.caption || ''}
          onClick={() => onItemTap && onItemTap(item.id)}
          draggable={false}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in',
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            touchAction: 'manipulation',
            pointerEvents: 'auto',
          }}
        />
        {/* Position badge — shows "3 / 12" so the tech knows where each
            photo sits in the order. */}
        <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(15,31,56,0.82)', color: '#fff', borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 800, letterSpacing: 0.3, zIndex: 2 }} className="id-mono">
          {index + 1}<span style={{opacity:0.55}}>/{total}</span>
        </div>
        {/* Drag handle — dnd-kit activator for desktop / capable touch
            devices. Not the primary reorder UX; the up/down arrows below
            the photo are the always-works fallback. */}
        <div
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          role="button"
          style={{
            position: 'absolute', bottom: 6, left: 6,
            background: 'rgba(15,31,56,0.82)', color: '#fff',
            borderRadius: 6,
            width: 26, height: 26, fontSize: 13, fontWeight: 700,
            cursor: isDragging ? 'grabbing' : 'grab',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'none',
            zIndex: 2,
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >⋮⋮</div>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label="Remove photo"
          style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(15,31,56,0.82)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700, zIndex: 2 }}
        >×</button>
        {/* Up / Down arrow row — pinned to the bottom-right of the tile.
            Always-works reorder fallback. Tap to step the photo's position
            one slot earlier or later in the list. Disabled at the ends. */}
        <div style={{ position: 'absolute', bottom: 6, right: 6, display: 'flex', gap: 4, zIndex: 2 }}>
          <button
            type="button"
            onClick={() => onMove && onMove(item.id, -1)}
            disabled={index === 0}
            aria-label="Move earlier"
            title="Move earlier"
            style={{ background: 'rgba(15,31,56,0.82)', color: '#fff', border: 'none', borderRadius: 6, width: 26, height: 26, fontSize: 14, cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700 }}
          >◂</button>
          <button
            type="button"
            onClick={() => onMove && onMove(item.id, 1)}
            disabled={index === total - 1}
            aria-label="Move later"
            title="Move later"
            style={{ background: 'rgba(15,31,56,0.82)', color: '#fff', border: 'none', borderRadius: 6, width: 26, height: 26, fontSize: 14, cursor: index === total - 1 ? 'not-allowed' : 'pointer', opacity: index === total - 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700 }}
          >▸</button>
        </div>
      </div>
      {quickTags && quickTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {quickTags.map(tag => {
            const active = (item.caption || '').toLowerCase() === tag.toLowerCase();
            return (
              <button
                type="button"
                key={tag}
                onClick={() => onCaption(item.id, active ? '' : tag)}
                style={{
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: '1px solid ' + (active ? T.orange : T.border),
                  background: active ? T.orange : '#fff',
                  color: active ? '#fff' : T.muted,
                  cursor: 'pointer',
                  letterSpacing: 0.2,
                }}
              >{tag}</button>
            );
          })}
        </div>
      )}
      <input
        type="text"
        value={item.caption || ''}
        onChange={e => onCaption(item.id, e.target.value)}
        placeholder="Caption…"
        style={{ width: '100%', padding: '4px 8px', fontSize: 11, borderRadius: 6, border: '1px solid ' + T.border, background: '#fff', color: T.text, outline: 'none' }}
      />
    </div>
  );
}

export default function SortablePhotoGrid({ items, onReorder, onRemove, onCaption, onItemTap, quickTags = DEFAULT_TAGS, T }) {
  const sensors = useSensors(
    // Pointer (mouse) — small distance so the drag handle responds immediately.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Touch — since the drag is initiated from an explicit handle (not the
    // image itself), there's no ambiguity to disambiguate via long-press
    // delay. A tiny tolerance avoids stray jitter starting a drag on a tap.
    useSensor(TouchSensor, { activationConstraint: { delay: 0, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex(i => i.id === active.id);
    const newIdx = items.findIndex(i => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(arrayMove(items, oldIdx, newIdx));
  };

  // Step one slot earlier (-1) or later (+1). Used by the always-works
  // arrow buttons that complement drag-to-reorder.
  const handleMove = (id, delta) => {
    const oldIdx = items.findIndex(i => i.id === id);
    if (oldIdx === -1) return;
    const newIdx = Math.max(0, Math.min(items.length - 1, oldIdx + delta));
    if (newIdx === oldIdx) return;
    onReorder(arrayMove(items, oldIdx, newIdx));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {items.map((item, index) => (
            <SortableItem
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              onRemove={onRemove}
              onCaption={onCaption}
              onItemTap={onItemTap}
              onMove={handleMove}
              quickTags={quickTags}
              T={T}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
