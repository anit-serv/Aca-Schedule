import { useEffect, useMemo, useState } from 'react';
import type { Band, CustomFieldsSettings, Timetable } from '../types';
import { autoAssignShifts, type ShiftAssignmentResult, type ShiftColumnSelection } from '../utils/autoAssignShifts';

interface Props {
  settings: CustomFieldsSettings;
  performance: Timetable | null;
  rehearsal: Timetable | null;
  bands: Band[];
  onCancel: () => void;
  onApply: (settings: CustomFieldsSettings) => void;
}

const keyOf = (item: ShiftColumnSelection) => `${item.type}:${item.columnId}`;
const types = ['performance', 'rehearsal'] as const;

export const ShiftAutoAssignDialog = ({ settings, performance, rehearsal, bands, onCancel, onApply }: Props) => {
  const columns = useMemo(() => types.flatMap(type => settings[type].columns.filter(column => column.shift).map(column => ({
    type, columnId: column.id, name: column.name, candidates: column.shift!.candidates,
  }))), [settings]);
  const [selected, setSelected] = useState(() => columns.map(keyOf));
  const [replaceAssigned, setReplaceAssigned] = useState(false);
  const [prepared, setPrepared] = useState<ShiftAssignmentResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(true);

  useEffect(() => {
    if (!selected.length) return;
    const timer = window.setTimeout(() => {
      const result = autoAssignShifts(settings, { performance, rehearsal }, bands,
        columns.filter(column => selected.includes(keyOf(column))).map(({ type, columnId }) => ({ type, columnId })), replaceAssigned);
      setPrepared(result);
      setIsCalculating(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [settings, performance, rehearsal, bands, columns, selected, replaceAssigned]);

  const assign = () => {
    if (prepared && !isCalculating && selected.length) onApply(prepared.settings);
  };

  return <div className="fixed inset-0 z-[245] flex items-center justify-center bg-black/50 p-4">
    <div role="dialog" aria-modal="true" aria-labelledby="shift-auto-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
      <h3 id="shift-auto-title" className="text-lg font-bold text-gray-900">シフトを自動割り振り</h3>
      <p className="mt-1 text-sm text-gray-600">選択した本番・リハの列をまとめて割り振ります。枠の境界と選択外の列は変更しません。</p>
      <h4 className="mt-4 text-sm font-semibold">対象のシフト列</h4>
      <div className="mt-2 grid max-h-64 gap-3 overflow-y-auto sm:grid-cols-2">
        {types.map(type => {
          const group = columns.filter(column => column.type === type);
          if (!group.length) return null;
          return <fieldset key={type} className="min-w-0 rounded-lg border border-gray-200 p-2">
            <legend className="px-1 text-sm font-semibold text-emerald-800">{type === 'performance' ? '本番' : 'リハ'}（{group.length}列）</legend>
            <div className="space-y-1">
              {group.map((column, index) => <label key={keyOf(column)} className="flex items-center gap-2 rounded bg-gray-50 px-2 py-1.5 text-sm">
                <input type="checkbox" checked={selected.includes(keyOf(column))} onChange={event => {
                  setPrepared(null);
                  setIsCalculating(true);
                  setSelected(previous => event.target.checked ? [...previous, keyOf(column)] : previous.filter(value => value !== keyOf(column)));
                }} />
                <span className="w-5 shrink-0 text-right text-xs text-gray-500">{index + 1}.</span>
                <span className="min-w-0 truncate">{column.name}</span>
              </label>)}
            </div>
          </fieldset>;
        })}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={replaceAssigned} onChange={event => { setPrepared(null); setIsCalculating(true); setReplaceAssigned(event.target.checked); }} />
        <span>選択した列の入力済み担当者も組み直す<span className="block text-xs text-gray-500">オフの場合は入力済み担当者を固定し、空欄だけ埋めます。</span></span>
      </label>
      <p className="mt-4 border-t pt-4 text-xs text-gray-500">登録済みの担当可能時間を使って割り振ります。未設定の候補者は全日程・全時間帯を担当可能として扱います。</p>
      <p className="mt-2 text-xs text-gray-500" role="status">{!selected.length ? '対象の列を選択してください。' : isCalculating ? '割り振りを計算中…' : `${prepared?.assigned ?? 0}枠を割り振り可能 · ${prepared?.unassigned.length ?? 0}枠が未割当`}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-gray-300 px-3 py-2 text-sm">キャンセル</button>
        <button type="button" disabled={!selected.length || isCalculating || !prepared} onClick={assign} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-40">割り振る</button>
      </div>
    </div>
  </div>;
};
