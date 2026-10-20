import { useEffect, useRef, useState } from 'react';
import type { DailyTimetable, TimeRange } from '../types';
import { changeTimeRange, normalizeTimeRanges, timeSlotCoverage, timeSlotSegments, timeToMinutes } from '../utils/availabilityRanges';
import { venueTimeRanges } from '../utils/venueTimeRanges';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';
import { Icon } from './Icon';

interface Props {
  day: DailyTimetable;
  onSave: (ranges: TimeRange[]) => void;
  onClose: () => void;
}

const slots = Array.from({ length: 96 }, (_, index) => index);
const label = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export const VenueTimeRangesModal = ({ day, onSave, onClose }: Props) => {
  const [ranges, setRanges] = useState(() => venueTimeRanges(day));
  const [drag, setDrag] = useState<{ start: number; end: number; mode: 'add' | 'remove' } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<TimeRange>({ startTime: '10:00', endTime: '11:00' });
  const [error, setError] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const isDragging = drag !== null;

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-venue-slot]');
      if (cell && gridRef.current?.contains(cell)) setDrag(previous => previous ? { ...previous, end: Number(cell.dataset.venueSlot) } : null);
    };
    const finish = () => {
      setRanges(previous => changeTimeRange(previous, Math.min(drag.start, drag.end) * 15, (Math.max(drag.start, drag.end) + 1) * 15, drag.mode));
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); };
  }, [drag]);

  useEffect(() => {
    if (!isDragging) return;
    let frame = 0;
    const scroll = () => {
      const pointer = pointerRef.current;
      const container = gridRef.current?.closest<HTMLElement>('[data-venue-scroll]');
      if (pointer && container) {
        const bounds = container.getBoundingClientRect();
        if (pointer.y > bounds.bottom - 38) container.scrollTop += 12;
        else if (pointer.y < bounds.top + 38) container.scrollTop -= 12;
        const cell = document.elementFromPoint(pointer.x, Math.max(bounds.top + 2, Math.min(bounds.bottom - 2, pointer.y)))?.closest<HTMLElement>('[data-venue-slot]');
        if (cell && gridRef.current?.contains(cell)) setDrag(previous => previous && previous.end !== Number(cell.dataset.venueSlot) ? { ...previous, end: Number(cell.dataset.venueSlot) } : previous);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [isDragging]);

  const applyEdit = () => {
    const start = timeToMinutes(draft.startTime);
    const end = timeToMinutes(draft.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      setError('終了時刻は開始時刻より後にしてください。');
      return;
    }
    setRanges(previous => normalizeTimeRanges(previous.filter((_, index) => index !== editing).concat(draft)));
    setEditing(null);
    setError('');
  };

  const preview = drag ? changeTimeRange(ranges, Math.min(drag.start, drag.end) * 15, (Math.max(drag.start, drag.end) + 1) * 15, drag.mode) : ranges;

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="演奏可能時間の設定">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b px-5 py-4">
        <div><h2 className="text-lg font-bold text-gray-900">演奏可能時間の設定</h2><p className="text-sm text-gray-500">{day.date} · 会場で演奏できる時間を15分刻みでなぞって選択できます。時間帯の端は分単位で調整できます。</p></div>
        <button type="button" onClick={onClose} aria-label="閉じる" className="rounded p-1 text-gray-500 hover:bg-gray-100"><Icon name="close" /></button>
      </header>
      <div data-venue-scroll className="min-h-0 overflow-y-auto p-5">
        <div ref={gridRef} className="grid select-none grid-cols-4 gap-1 rounded-lg bg-gray-100 p-3 sm:grid-cols-8 lg:grid-cols-12">
          {slots.map(index => {
            const start = index * 15;
            const selected = timeSlotCoverage(preview, start, start + 15) !== 'none';
            return <button key={index} type="button" data-venue-slot={index} aria-pressed={selected} aria-label={`${label(start)}〜${label(start + 15)}`}
              onPointerDown={event => { event.preventDefault(); pointerRef.current = { x: event.clientX, y: event.clientY }; setDrag({ start: index, end: index, mode: timeSlotCoverage(ranges, start, start + 15) === 'none' ? 'add' : 'remove' }); }}
              className={`relative h-10 overflow-hidden rounded-sm border-l-2 pl-2 text-left text-xs font-medium tabular-nums ${index % 4 === 0 ? 'border-l-gray-500' : 'border-l-transparent'} bg-gray-200 text-gray-700`}>
              {timeSlotSegments(preview, start, start + 15).map((segment, segmentIndex) => <span key={segmentIndex} aria-hidden="true" className="absolute inset-y-0 bg-emerald-500" style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }} />)}
              <span className={`relative ${timeSlotCoverage(preview, start, start + 15) === 'full' ? 'text-white' : ''}`}>{label(start)}</span>
            </button>;
          })}
        </div>
        <div className="mt-4 border-t pt-4"><h3 className="mb-2 text-sm font-semibold text-gray-700">選択された時間帯</h3>
          <div className="flex flex-wrap gap-2">{ranges.length ? ranges.map((range, index) => <button key={`${range.startTime}-${range.endTime}`} type="button" onClick={() => { setEditing(index); setDraft(range); setError(''); }} className="rounded bg-emerald-500 px-3 py-1.5 text-sm text-white hover:bg-emerald-600">{range.startTime} - {range.endTime}</button>) : <span className="text-sm text-gray-500">未選択。この日は自動配置できません。</span>}</div>
          {editing !== null && <form onSubmit={event => { event.preventDefault(); applyEdit(); }} className="mt-3 rounded border border-emerald-200 p-3">
            <div className="flex flex-wrap items-end gap-2 text-sm"><label>開始<DesktopClockTimePicker value={draft.startTime} onChange={value => setDraft(previous => ({ ...previous, startTime: value ?? '' }))} className="mt-1" inputClassName="w-24 rounded border px-2 py-1.5" /></label><span className="pb-2">〜</span><label>終了<DesktopClockTimePicker value={draft.endTime} onChange={value => setDraft(previous => ({ ...previous, endTime: value ?? '' }))} allow24Hour className="mt-1" inputClassName="w-24 rounded border px-2 py-1.5" /></label><button type="submit" className="rounded bg-emerald-500 px-3 py-1.5 text-white">適用</button><button type="button" onClick={() => setEditing(null)} className="rounded px-2 py-1.5 text-gray-600">キャンセル</button></div>
            {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
          </form>}
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={onClose} className="rounded bg-gray-100 px-4 py-2">キャンセル</button><button type="button" disabled={editing !== null} onClick={() => onSave(ranges)} className="rounded bg-emerald-500 px-4 py-2 text-white disabled:opacity-50">保存</button></footer>
    </div>
  </div>;
};
