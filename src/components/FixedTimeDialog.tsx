import { useEffect, useState } from 'react';
import type { DailyTimetable } from '../types';
import { effectiveCoolStart, timeMinutes } from '../utils/dailyTimeBounds';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';

interface Props {
  day: DailyTimetable;
  coolIndex: number;
  duration: number;
  title: string;
  initialStart: string;
  initiallyFixed: boolean;
  allowCoolSelection?: boolean;
  onSave: (coolIndex: number, start: string | null) => string | null;
  onClose: () => void;
}

const asTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export const FixedTimeDialog = ({ day, coolIndex, duration, title, initialStart, initiallyFixed, allowCoolSelection = false, onSave, onClose }: Props) => {
  const [selectedCool, setSelectedCool] = useState(coolIndex);
  const [start, setStart] = useState(initialStart);
  const [error, setError] = useState('');
  const end = /^\d{2}:\d{2}$/.test(start) ? asTime(timeMinutes(start) + duration) : '';
  const min = effectiveCoolStart(day, selectedCool);
  const max = day.cools[selectedCool + 1]?.startTime || day.endTime || '24:00';

  useEffect(() => {
    if (allowCoolSelection) setStart(effectiveCoolStart(day, selectedCool));
  }, [allowCoolSelection, day, selectedCool]);

  const save = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || timeMinutes(start) < timeMinutes(min) || timeMinutes(start) + duration > timeMinutes(max) || timeMinutes(start) + duration > 1440) {
      setError(`開始・終了時刻をクール内（${min}〜${max}）に収めてください。`);
      return;
    }
    const result = onSave(selectedCool, start);
    if (result) setError(result);
    else onClose();
  };

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="出演時刻を固定">
    <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
      <h3 className="mb-1 text-lg font-bold">出演時刻を固定</h3>
      <p className="mb-4 text-sm text-gray-600">{title}（{duration}分）</p>
      {allowCoolSelection && <label className="mb-3 block text-sm">クール
        <select className="mt-1 w-full rounded border p-2" value={selectedCool} onChange={event => { setSelectedCool(Number(event.target.value)); setError(''); }}>
          {day.cools.map((cool, index) => <option key={cool.id} value={index}>第{cool.number}クール</option>)}
        </select>
      </label>}
      <p className="mb-3 text-xs text-gray-600">設定可能な時間: {min}〜{max}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-sm"><label htmlFor="fixed-band-start">開始</label>
          <DesktopClockTimePicker id="fixed-band-start" value={start} onChange={value => { if (value) setStart(value); setError(''); }} className="mt-1" inputClassName="w-full rounded border border-gray-300 bg-white p-2 text-left text-sm text-gray-900 hover:border-emerald-400" />
        </div>
        <div className="text-sm"><label htmlFor="fixed-band-end">終了</label>
          <DesktopClockTimePicker id="fixed-band-end" value={end} allow24Hour onChange={value => { if (value) { const minutes = timeMinutes(value) - duration; setStart(minutes >= 0 ? asTime(minutes) : ''); } setError(''); }} className="mt-1" inputClassName="w-full rounded border border-gray-300 bg-white p-2 text-left text-sm text-gray-900 hover:border-emerald-400" />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {initiallyFixed && <button type="button" onClick={() => { const result = onSave(selectedCool, null); if (result) setError(result); else onClose(); }} className="mr-auto rounded px-3 py-2 text-amber-700 hover:bg-amber-50">固定を解除</button>}
        <button type="button" onClick={onClose} className="rounded px-3 py-2 hover:bg-gray-100">キャンセル</button>
        <button type="button" onClick={save} className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">時刻を固定</button>
      </div>
    </div>
  </div>;
};
