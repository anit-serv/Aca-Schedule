import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Band, CustomColumn, ShiftSlot } from '../types';
import type { ShiftSlotAction } from '../utils/customShift';
import { normalizePersonName } from '../utils/customShift';
import { Icon } from './Icon';

interface Props {
  column: CustomColumn;
  slot: ShiftSlot;
  slotIndex: number;
  slots: ShiftSlot[];
  entries: Array<{ type: 'band' | 'custom'; bandId?: string }>;
  bands: Band[];
  otherAssignments?: string[];
  readOnly: boolean;
  onAction: (action: ShiftSlotAction) => void;
}

interface BoundaryDrag {
  pointerId: number;
  startSize: number;
  boundaries: Array<{ size: number; y: number }>;
  left: number;
  width: number;
}

const nearestBoundary = (boundaries: BoundaryDrag['boundaries'], clientY: number) =>
  boundaries.reduce((closest, boundary) => Math.abs(boundary.y - clientY) < Math.abs(closest.y - clientY) ? boundary : closest);

export const ShiftSlotCell = ({ column, slot, slotIndex, slots, entries, bands, otherAssignments = [], readOnly, onAction }: Props) => {
  const [open, setOpen] = useState(false);
  const dragRef = useRef<BoundaryDrag | null>(null);
  const [boundaryPreview, setBoundaryPreview] = useState<{ y: number; left: number; width: number; size: number } | null>(null);
  const performing = new Set(entries.flatMap(entry => entry.type === 'band'
    ? bands.find(band => band.id === entry.bandId)?.members.map(normalizePersonName) ?? []
    : []));
  const occupied = new Set(otherAssignments.map(normalizePersonName));
  const eligible = (column.shift?.candidates ?? []).filter(name => !performing.has(normalizePersonName(name)) && !occupied.has(normalizePersonName(name)));
  const performanceConflict = !!slot.assignee && performing.has(normalizePersonName(slot.assignee));
  const shiftConflict = !!slot.assignee && occupied.has(normalizePersonName(slot.assignee));
  const conflict = performanceConflict || shiftConflict;
  const assign = (assignee?: string) => { onAction({ type: 'assign', index: slotIndex, assignee }); setOpen(false); };
  const nextSlot = slots[slotIndex + 1];
  const canResize = !readOnly && !!nextSlot && slot.size + nextSlot.size > 2;

  const startBoundaryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canResize || !nextSlot || event.button !== 0) return;
    const cell = event.currentTarget.closest('td');
    const table = cell?.closest('table');
    const row = cell?.closest('tr');
    if (!cell || !table || !row) return;
    const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-entry-id]'));
    const start = rows.indexOf(row);
    const total = slot.size + nextSlot.size;
    const pairRows = rows.slice(start, start + total);
    if (start < 0 || pairRows.length !== total) return;
    const boundaries = Array.from({ length: total - 1 }, (_, index) => ({
      size: index + 1,
      y: pairRows[index].getBoundingClientRect().bottom,
    }));
    const rect = cell.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, startSize: slot.size, boundaries, left: rect.left, width: rect.width };
    const initial = boundaries[slot.size - 1];
    setBoundaryPreview({ y: initial.y, left: rect.left, width: rect.width, size: initial.size });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveBoundary = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const boundary = nearestBoundary(drag.boundaries, event.clientY);
    setBoundaryPreview({ y: boundary.y, left: drag.left, width: drag.width, size: boundary.size });
  };

  const finishBoundaryDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setBoundaryPreview(null);
    event.preventDefault();
    event.stopPropagation();
    if (cancelled) return;
    const delta = nearestBoundary(drag.boundaries, event.clientY).size - drag.startSize;
    if (delta) onAction({ type: 'boundary-move', index: slotIndex, delta });
  };

  return <div className={`absolute inset-0 flex min-h-7 text-sm ${conflict ? 'bg-rose-50' : 'bg-emerald-50/50'}`}>
    <button type="button" disabled={readOnly} onClick={() => setOpen(value => !value)} className={`flex h-full w-full items-center gap-1 px-2 py-1 text-left ${readOnly ? '' : 'hover:text-emerald-700'}`} title={performanceConflict ? 'この枠の出演メンバーと担当者が重複しています' : shiftConflict ? '重なる枠の他のシフト列と担当者が重複しています' : slot.assignee || '担当者を選択'}>
      <span className={`min-w-0 truncate ${slot.assignee ? '' : 'text-gray-400'}`}>{slot.assignee || '担当者を選択'}</span>{conflict && <Icon name="block" className="shrink-0 text-base text-rose-600" />}
    </button>
    {canResize && nextSlot && <div role="separator" aria-label={`${column.name}の枠の境界を移動`} aria-orientation="horizontal"
      aria-valuemin={1} aria-valuemax={slot.size + nextSlot.size - 1} aria-valuenow={slot.size} tabIndex={0}
      title="ドラッグして枠の境界を移動" className="group absolute -bottom-1.5 left-0 right-0 z-10 h-3 cursor-row-resize touch-none"
      onPointerDown={startBoundaryDrag} onPointerMove={moveBoundary}
      onPointerUp={event => finishBoundaryDrag(event)} onPointerCancel={event => finishBoundaryDrag(event, true)}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' && slot.size > 1) { event.preventDefault(); onAction({ type: 'boundary-up', index: slotIndex }); }
        if (event.key === 'ArrowDown' && nextSlot.size > 1) { event.preventDefault(); onAction({ type: 'boundary-down', index: slotIndex }); }
      }}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-500 opacity-0 group-hover:opacity-100 group-focus:opacity-100" />
    </div>}
    {boundaryPreview && createPortal(<div className="pointer-events-none fixed z-[225] h-0.5 bg-emerald-600 shadow-[0_0_0_1px_white]"
      style={{ left: boundaryPreview.left, top: boundaryPreview.y - 1, width: boundaryPreview.width }}>
      <span className="absolute bottom-2 right-0 whitespace-nowrap rounded bg-emerald-700 px-2 py-1 text-xs text-white shadow">
        上{boundaryPreview.size}行・下{slot.size + nextSlot.size - boundaryPreview.size}行
      </span>
    </div>, document.body)}
    {!readOnly && open && createPortal(<div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setOpen(false)}><div role="dialog" aria-modal="true" aria-label="シフト枠の担当者と境界" className="max-h-[85vh] w-full max-w-sm overflow-auto rounded-xl border border-gray-200 bg-white p-4 shadow-xl" onMouseDown={event => event.stopPropagation()}>
      <p className="mb-1 text-xs font-semibold text-gray-600">担当者を選択</p>
      {performanceConflict && <p className="mb-1 text-xs text-rose-700">現在の担当者はこの枠に出演します。</p>}
      {shiftConflict && <p className="mb-1 text-xs text-rose-700">現在の担当者は重なる枠の他のシフト列にも割り当てられています。</p>}
      {eligible.map(name => <button type="button" key={name} onClick={() => assign(name)} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-emerald-50">{name}</button>)}
      {eligible.length === 0 && <p className="px-2 py-1 text-xs text-gray-500">選択できる候補がいません</p>}
      <button type="button" onClick={() => assign()} className="mt-1 block w-full border-t px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50">未割当にする</button>
      <div className="mt-2 border-t pt-2 text-xs text-gray-600">
        <p className="mb-1 font-semibold">枠を編集</p>
        {nextSlot && <p className="mb-1 text-gray-500">枠の下端をドラッグして境界を移動できます。</p>}
        <div className="mt-1 flex gap-1"><button type="button" disabled={slot.size <= 1} onClick={() => { onAction({ type: 'add', index: slotIndex }); setOpen(false); }} className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40">この枠を分割して下に追加</button><button type="button" disabled={slots.length <= 1} onClick={() => { if (confirm('この枠を削除して隣の枠に統合しますか？')) { onAction({ type: 'delete', index: slotIndex }); setOpen(false); } }} className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40">枠を削除</button></div>
      </div>
      <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full rounded border border-gray-200 py-2 text-sm">閉じる</button>
    </div></div>, document.body)}
  </div>;
};
