import { useMemo, useState } from 'react';
import type { Band, CustomColumnShift } from '../types';
import { uniquePeople } from '../utils/customShift';

interface Props {
  columnName: string;
  bands: Band[];
  registeredMembers?: string[];
  initial?: CustomColumnShift;
  shared?: boolean;
  seedCandidates?: string[];
  onCancel: () => void;
  onSave: (candidates: string[], split: CustomColumnShift['split']) => void;
}

export const ShiftSetupDialog = ({ columnName, bands, registeredMembers = [], initial, shared = false, seedCandidates = [], onCancel, onSave }: Props) => {
  const [candidates, setCandidates] = useState(initial?.candidates ?? seedCandidates);
  const [person, setPerson] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [mode, setMode] = useState<CustomColumnShift['split']['mode']>(initial?.split.mode ?? 'per-cool');
  const [value, setValue] = useState(initial?.split.value ?? 2);
  const members = useMemo(() => uniquePeople([...registeredMembers, ...bands.flatMap(band => band.members)]).sort((a, b) => a.localeCompare(b, 'ja')), [bands, registeredMembers]);
  const filteredMembers = useMemo(() => members.filter(member => member.toLocaleLowerCase().includes(memberQuery.trim().toLocaleLowerCase())), [members, memberQuery]);
  const toggleMember = (member: string, checked: boolean) => {
    setCandidates(previous => checked
      ? uniquePeople([...previous, member])
      : previous.filter(candidate => candidate !== member));
  };
  const addPerson = () => {
    setCandidates(previous => uniquePeople([...previous, person]));
    setPerson('');
  };

  return <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/50 p-4" role="presentation">
    <div role="dialog" aria-modal="true" aria-labelledby="shift-setup-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
      <h3 id="shift-setup-title" className="text-lg font-bold text-gray-900">{columnName}のシフト設定</h3>
      <p className="mt-1 text-sm text-gray-500">担当候補と、各クールを分ける初期枠数を設定します。</p>
      <p className="mt-1 text-xs text-gray-500">シフトモードをオンにすると、この列は位置固定になります。</p>
      {shared && <p className="mt-1 text-xs text-emerald-700">共通列のシフトモード・担当候補・枠数設定は本番とリハの両方に反映されます。枠の境界と担当者はそれぞれ編集できます。</p>}
      <h4 className="mt-4 text-sm font-medium text-gray-700">担当候補をメンバーから選択</h4>
      <input type="search" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="メンバー名を検索" aria-label="メンバー名を検索" />
      <div role="group" aria-label="メンバー" className="mt-2 max-h-44 overflow-y-auto rounded border border-gray-200 p-2">
        {filteredMembers.length ? filteredMembers.map(member => <label key={member} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-emerald-50">
          <input type="checkbox" checked={candidates.includes(member)} onChange={event => toggleMember(member, event.target.checked)} />
          <span>{member}</span>
        </label>) : <p className="px-2 py-2 text-xs text-gray-500">該当するメンバーがいません</p>}
      </div>
      <p className="mt-1 text-xs text-gray-500">複数人を続けて選べます。選択中: {candidates.length}人</p>
      <label htmlFor="shift-free-person" className="mt-3 block text-sm font-medium text-gray-700">候補を自由入力で追加</label>
      <div className="mt-1 flex gap-2">
        <input id="shift-free-person" type="text" value={person} onChange={event => setPerson(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } }} className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm" placeholder="名前を入力" />
        <button type="button" onClick={addPerson} disabled={!person.trim()} className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700 disabled:opacity-40">追加</button>
      </div>
      <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
        {candidates.map(candidate => <span key={candidate} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{candidate}<button type="button" aria-label={`${candidate}を候補から削除`} onClick={() => setCandidates(previous => previous.filter(name => name !== candidate))}>×</button></span>)}
      </div>
      <label className="mt-5 block text-sm font-medium text-gray-700">枠の分け方</label>
      <div className="mt-2 space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="radio" checked={mode === 'per-cool'} onChange={() => setMode('per-cool')} />1クールを指定した枠数に分ける</label>
        <label className="flex items-center gap-2"><input type="radio" checked={mode === 'per-entries'} onChange={() => setMode('per-entries')} />指定した行数ごとに1枠にする</label>
      </div>
      <div className="mt-2 flex items-center gap-2"><input type="number" min={1} max={999} value={value} onChange={event => setValue(Number(event.target.value))} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" /><span className="text-sm text-gray-600">{mode === 'per-cool' ? '枠 / クール' : '行 / 枠'}</span></div>
      <p className="mt-2 text-xs text-gray-500">バンドとカスタムイベントをそれぞれ1行として数えます。枠は後から編集できます。</p>
      {initial && <p className="mt-2 text-xs text-amber-700">分け方を変更すると{shared ? '本番・リハ両方の' : ''}既存の枠と担当者を作り直します。候補だけの変更では枠を維持します。</p>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded border border-gray-300 px-4 py-2 text-sm">キャンセル</button><button type="button" disabled={candidates.length === 0 || !Number.isInteger(value) || value < 1} onClick={() => onSave(candidates, { mode, value })} className="rounded bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-40">{initial ? '保存' : 'シフトを作成'}</button></div>
    </div>
  </div>;
};
