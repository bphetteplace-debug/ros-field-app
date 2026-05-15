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

function SortableItem({ item, onRemove, onCaption, onItemTap, quickTags, T }) {
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
        {/* The image itself opens the lightbox on tap. It deliberately does
            NOT receive the drag listeners — on iOS Safari long-press on an
            <img> triggers the OS "Save Image" sheet, which preempts dnd-kit
            and is the reason drag-to-reorder was failing on phones. */}
        <img
          src={src}
          alt={item.caption || ''}
          onClick={() => onItemTap && onItemTap(item.id)}
          draggable={false}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'zoom-in',
            // Suppress the iOS image action sheet and selection halo.
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            // Don't let the browser interpret touches on the image as scroll
            // or zoom gestures — they're either a tap (lightbox) or pass
            // through to the drag handle.
            touchAction: 'manipulation',
            pointerEvents: 'auto',
          }}
        />
        {/* Drag handle — explicit, discoverable target for reordering.
            This is the element wired to dnd-kit's listeners + attributes,
            so a tap on the rest of the tile stays "open lightbox" / "remove". */}
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          style={{
            position: 'absolute', top: 6, left: 6,
            background: 'rgba(15,31,56,0.82)', color: '#fff',
            border: 'none', borderRadius: 6,
            width: 28, height: 28, fontSize: 14, fontWeight: 700,
            cursor: isDragging ? 'grabbing' : 'grab',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            touchAction: 'none', // dnd-kit needs touch-action:none on the activator
            zIndex: 2,
          }}
        >⋮⋮</button>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label="Remove photo"
          style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(15,31,56,0.82)', color: '#fff', border: 'none', borderRadius: '50%', width: 24, height: 24, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700, zIndex: 2 }}
        >×</button>
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
          {items.map(item => (
            <SortableItem
              key={item.id}
              item={item}
              onRemove={onRemove}
              onCaption={onCaption}
              onItemTap={onItemTap}
              quickTags={quickTags}
              T={T}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
