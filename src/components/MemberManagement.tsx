import { useEffect, useMemo, useState } from 'react';
import type { AvailableTimeSlot, Band, CustomFieldsSettings, EventSettings, Timetable } from '../types';
import { createEmptyCustomFieldsSettings, getSharedColumnId, setColumnShift } from '../utils/customFieldsUtils';
import { defaultShiftAvailability, getCustomShiftIssues, getShiftSlots, normalizePersonName, uniquePeople } from '../utils/customShift';
import { BandAvailabilityModal } from './BandAvailabilityModal';

type ScheduleType = 'performance' | 'rehearsal';
interface Props {
  eventSettings: EventSettings;
  bands: Band[];
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onCustomFieldsChange: (fields: CustomFieldsSettings) => Promise<void>;
}
interface ColumnOption { key: string; type: ScheduleType; id: string; name: string; shared: boolean; candidates: string[] }
interface Assignment { person: string; slotId: string; type: ScheduleType; columnId: string; label: string; minutes: number; date: string; start: string; end: string }

const timetableTypes: ScheduleType[] = ['performance', 'rehearsal'];
const duration = (start: string, end: string) => {
  const parse = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) ? Math.max(0, parse(end) - parse(start)) : 0;
};

export const MemberManagement = ({ eventSettings, bands, performanceTimetable, rehearsalTimetable, onCustomFieldsChange }: Props) => {
  const fields = useMemo(() => eventSettings.customFields ?? createEmptyCustomFieldsSettings(), [eventSettings.customFields]);
  const options = useMemo(() => {
    const result: ColumnOption[] = [];
    const seen = new Set<string>();
    for (const type of timetableTypes) for (const column of fields[type].columns) {
      if (!column.shift || seen.has(`${type}:${column.id}`)) continue;
      const otherType = type === 'performance' ? 'rehearsal' : 'performance';
      const linkedId = getSharedColumnId(fields, type, column);
      const linked = fields[otherType].columns.find(item => item.id === linkedId && item.shift);
      if (linked) seen.add(`${otherType}:${linked.id}`);
      result.push({ key: `${type}:${column.id}`, type, id: column.id, name: column.name,
        shared: !!linked, candidates: column.shift.candidates });
    }
    return result;
  }, [fields]);
  const assignments = useMemo(() => {
    const result: Assignment[] = [];
    for (const type of timetableTypes) {
      const timetable = type === 'performance' ? performanceTimetable : rehearsalTimetable;
      if (!timetable) continue;
      for (const day of timetable.dailyTimetables) {
        const groups = day.cools.length ? day.cools.map(cool => ({ id: cool.id, label: `第${cool.number}クール`, entries: cool.entries }))
          : [{ id: 'flat', label: '全体', entries: day.entries }];
        for (const group of groups) for (const column of fields[type].columns) {
          if (!column.shift) continue;
          let offset = 0;
          for (const slot of getShiftSlots(column, day.date, group.id, group.entries.length)) {
            const entries = group.entries.slice(offset, offset + slot.size);
            offset += slot.size;
            if (!slot.assignee) continue;
            const start = entries[0]?.startTime ?? '';
            const end = entries[entries.length - 1]?.endTime ?? '';
            result.push({ person: normalizePersonName(slot.assignee), slotId: slot.id, type, columnId: column.id,
              label: `${type === 'performance' ? '本番' : 'リハ'} ${day.date} ${group.label}・${column.name}`,
              minutes: duration(start, end), date: day.date, start, end });
          }
        }
      }
    }
    return result;
  }, [fields, performanceTimetable, rehearsalTimetable]);
  const bandMembers = useMemo(() => new Set(uniquePeople(bands.flatMap(band => band.members))), [bands]);
  const members = useMemo(() => uniquePeople([
    ...bandMembers, ...(fields.members ?? []), ...options.flatMap(option => option.candidates), ...Object.keys(fields.shiftAvailability ?? {}),
    ...assignments.map(item => item.person),
  ]).sort((a, b) => a.localeCompare(b, 'ja')), [bandMembers, fields.members, options, fields.shiftAvailability, assignments]);
  const dates = useMemo(() => [...new Set([
    ...eventSettings.performanceDates, ...(eventSettings.rehearsalDates ?? []),
    ...(performanceTimetable?.dailyTimetables ?? []).map(day => day.date),
    ...(rehearsalTimetable?.dailyTimetables ?? []).map(day => day.date),
  ])].sort(), [eventSettings.performanceDates, eventSettings.rehearsalDates, performanceTimetable, rehearsalTimetable]);
  const dateTabs = useMemo(() => [
    ...eventSettings.performanceDates.map(date => ({ date, type: 'performance' as const })),
    ...(eventSettings.rehearsalType === 'rehearsal-day'
      ? (eventSettings.rehearsalDates ?? [])
      : eventSettings.rehearsalType === 'none' ? [] : eventSettings.performanceDates)
      .map(date => ({ date, type: 'rehearsal' as const })),
  ], [eventSettings.performanceDates, eventSettings.rehearsalDates, eventSettings.rehearsalType]);
  const issues = useMemo(() => getCustomShiftIssues(performanceTimetable, rehearsalTimetable, fields, bands),
    [performanceTimetable, rehearsalTimetable, fields, bands]);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [query, setQuery] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [filter, setFilter] = useState<'all' | 'candidate' | 'unregistered' | 'unrestricted' | 'warning'>('all');
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [draftAvailability, setDraftAvailability] = useState<AvailableTimeSlot[] | undefined>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAvailabilityEditor, setShowAvailabilityEditor] = useState(false);
  const person = members.includes(selectedPerson) ? selectedPerson : members[0] ?? '';
  const currentAssignments = assignments.filter(item => item.person === person);
  const warningSlotIds = new Set(issues.map(issue => issue.shiftSlotId).filter(Boolean));
  const hasWarning = (name: string) => assignments.some(item => item.person === name && (
    warningSlotIds.has(item.slotId) || ((fields.shiftAvailability?.[name] !== undefined)
      && !fields.shiftAvailability[name].some(day => day.date === item.date && day.timeRanges.some(range =>
        range.startTime <= item.start && item.end <= range.endTime)))));
  useEffect(() => {
    if (dirty) return;
    setDraftColumns(options.filter(option => option.candidates.includes(person)).map(option => option.key));
    setDraftAvailability(fields.shiftAvailability?.[person] ? structuredClone(fields.shiftAvailability[person]) : undefined);
  }, [person, fields, options, dirty]);
  const choosePerson = (name: string) => {
    if (dirty && !confirm('保存していない変更を破棄して別のメンバーを表示しますか？')) return;
    setSelectedPerson(name);
    setDraftColumns(options.filter(option => option.candidates.includes(name)).map(option => option.key));
    setDraftAvailability(fields.shiftAvailability?.[name] ? structuredClone(fields.shiftAvailability[name]) : undefined);
    setDirty(false);
    setError('');
  };
  const addMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizePersonName(newMemberName);
    if (!name || adding || saving) return;
    if (members.includes(name)) { setAddError('同じ名前のメンバーがすでにいます。'); return; }
    if (dirty && !confirm('保存していない変更を破棄してメンバーを追加しますか？')) return;
    setAdding(true);
    setAddError('');
    try {
      await onCustomFieldsChange({ ...structuredClone(fields), members: uniquePeople([...(fields.members ?? []), name]) });
      setNewMemberName('');
      setSelectedPerson(name);
      setDraftColumns([]);
      setDraftAvailability(undefined);
      setDirty(false);
      setQuery('');
      setFilter('all');
      setError('');
    } catch {
      setAddError('メンバーを追加できませんでした。通信状態を確認して再度お試しください。');
    } finally { setAdding(false); }
  };
  const save = async () => {
    if (!person || !dirty || saving) return;
    let updated = structuredClone(fields);
    const removals = options.filter(option => option.candidates.includes(person) && !draftColumns.includes(option.key));
    const affected = removals.flatMap(option => assignments.filter(item => item.person === person &&
      (item.type === option.type && item.columnId === option.id || option.shared && item.label.endsWith(`・${option.name}`))));
    if (affected.length && !confirm(`${affected.length}枠で担当中です。候補から外すと、該当する担当は未割当に戻ります。続けますか？`)) return;
    for (const option of options) {
      const shouldInclude = draftColumns.includes(option.key);
      if (option.candidates.includes(person) === shouldInclude) continue;
      const column = updated[option.type].columns.find(item => item.id === option.id);
      if (!column?.shift) continue;
      const candidates = shouldInclude ? uniquePeople([...column.shift.candidates, person])
        : column.shift.candidates.filter(name => name !== person);
      updated = setColumnShift(updated, option.type, option.id, { ...column.shift, candidates },
        option.type === 'performance' ? rehearsalTimetable : performanceTimetable,
        option.type === 'performance' ? performanceTimetable : rehearsalTimetable);
    }
    const availability = { ...updated.shiftAvailability };
    if (draftAvailability === undefined) delete availability[person];
    else availability[person] = draftAvailability;
    updated.shiftAvailability = availability;
    setSaving(true);
    setError('');
    try {
      await onCustomFieldsChange(updated);
      setDirty(false);
    } catch {
      setError('保存できませんでした。通信状態を確認して再度お試しください。');
    } finally { setSaving(false); }
  };
  const filtered = members.filter(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (
    filter === 'all' || (filter === 'candidate' && options.some(option => option.candidates.includes(name)))
    || (filter === 'unregistered' && !options.some(option => option.candidates.includes(name)))
    || (filter === 'unrestricted' && fields.shiftAvailability?.[name] === undefined)
    || (filter === 'warning' && hasWarning(name))));
  return <div className="h-full overflow-y-auto bg-gray-50 p-3 pb-24 text-gray-900 sm:p-6 sm:pb-6">
    <div className="mx-auto max-w-6xl">
      <div className="mb-4"><h2 className="text-xl font-bold">メンバー管理</h2><p className="mt-1 text-sm text-gray-600">担当候補の列、担当可能時間、現在の担当を確認できます。</p></div>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <form onSubmit={event => void addMember(event)} className="mb-3 border-b border-gray-200 pb-3">
            <label htmlFor="new-member-name" className="text-sm font-semibold">メンバーを追加</label>
            <div className="mt-2 flex gap-2">
              <input id="new-member-name" value={newMemberName} onChange={event => { setNewMemberName(event.target.value); setAddError(''); }} placeholder="名前を入力" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-2 text-sm" />
              <button type="submit" disabled={!newMemberName.trim() || adding || saving} className="rounded bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-40">{adding ? '追加中...' : '追加'}</button>
            </div>
            {addError && <p role="alert" className="mt-2 text-xs text-red-600">{addError}</p>}
          </form>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="名前で検索" aria-label="メンバーを検索" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <select aria-label="メンバーを絞り込み" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="mt-2 w-full rounded border border-gray-300 px-2 py-2 text-sm">
            <option value="all">すべて</option><option value="candidate">担当候補</option><option value="unregistered">候補未登録</option><option value="unrestricted">時間未設定</option><option value="warning">警告あり</option>
          </select>
          <p className="mt-2 text-xs text-gray-500">{filtered.length}人</p>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto lg:max-h-[calc(100vh-310px)]">
            {filtered.map(name => <button type="button" key={name} onClick={() => choosePerson(name)} className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${person === name ? 'bg-emerald-100 text-emerald-800' : 'hover:bg-gray-100'}`}>
              <span className="truncate">{name}</span><span className="ml-2 shrink-0 text-xs text-gray-500">{assignments.filter(item => item.person === name).length}回{hasWarning(name) ? ' ⚠' : ''}</span>
            </button>)}
            {!filtered.length && <p className="p-2 text-xs text-gray-500">該当するメンバーがいません</p>}
          </div>
        </aside>
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          {!person ? <p className="text-sm text-gray-500">メンバーがいません。左の入力欄から追加してください。</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-semibold">{person}</h3><p className="text-xs text-gray-500">{bandMembers.has(person) ? 'バンドメンバー' : (fields.members ?? []).includes(person) ? '登録メンバー' : '自由追加の担当候補'}</p></div>
              <div className="text-right text-sm"><strong>{currentAssignments.length}回</strong><span className="ml-2 text-gray-500">計{currentAssignments.reduce((sum, item) => sum + item.minutes, 0)}分</span></div></div>
            {hasWarning(person) && <p role="alert" className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">出演・他列との重複、または担当可能時間外の担当があります。タイムテーブルの確認事項も確認してください。</p>}
            <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">担当候補の列</h4><p className="mt-1 text-xs text-gray-500">本番・リハ共通列は一度の操作で両方に反映します。</p>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">{options.map(option => <label key={option.key} className="flex items-center gap-2 rounded bg-gray-50 px-3 py-2 text-sm">
                <input type="checkbox" disabled={saving} checked={draftColumns.includes(option.key)} onChange={event => { setDraftColumns(previous => event.target.checked ? [...previous, option.key] : previous.filter(key => key !== option.key)); setDirty(true); }} />
                <span>{option.shared ? '本番・リハ共通' : option.type === 'performance' ? '本番' : 'リハ'} · {option.name}</span>
              </label>)}</div>
              {!options.length && <p className="mt-2 text-xs text-gray-500">シフト列がありません。タイムテーブルの列管理から作成できます。</p>}
            </div>
            <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">担当可能時間</h4><p className="mt-1 text-xs text-gray-500">未設定は全日程・全時間帯を担当可能として扱います。指定すると、登録した日時だけ担当できます。</p>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" disabled={saving} checked={draftAvailability !== undefined} onChange={event => {
                setDraftAvailability(event.target.checked ? defaultShiftAvailability(dates, performanceTimetable, rehearsalTimetable) : undefined);
                setDirty(true);
              }} />時間帯を指定する</label>
              {draftAvailability !== undefined && <div className="mt-3">
                <button type="button" disabled={saving} onClick={() => setShowAvailabilityEditor(true)} className="rounded border border-emerald-300 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">時間帯を編集</button>
                <div className="mt-2 space-y-1 text-xs text-gray-600">{dates.map(date => {
                  const ranges = draftAvailability.find(day => day.date === date)?.timeRanges ?? [];
                  return <p key={date}>{date}: {ranges.length ? ranges.map(range => `${range.startTime}〜${range.endTime}`).join('、') : '担当不可'}</p>;
                })}</div>
              </div>}
            </div>
            <div className="mt-5 border-t pt-4"><h4 className="text-sm font-semibold">現在の担当</h4>{currentAssignments.length ? <div className="mt-2 max-h-44 space-y-1 overflow-y-auto text-xs text-gray-600">{currentAssignments.map((item, index) => <p key={`${item.slotId}-${index}`}>{item.label} {item.start && item.end ? `${item.start}〜${item.end}` : ''}</p>)}</div> : <p className="mt-2 text-xs text-gray-500">割り当てられた枠はありません</p>}</div>
            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end"><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded bg-emerald-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-40">{saving ? '保存中...' : '変更を保存'}</button></div>
          </>}
        </section>
      </div>
    </div>
    {showAvailabilityEditor && draftAvailability !== undefined && <BandAvailabilityModal
      memberName={person} memberTimeSlots={draftAvailability} dateTabs={dateTabs}
      performanceTimetable={performanceTimetable} rehearsalTimetable={rehearsalTimetable}
      onClose={() => setShowAvailabilityEditor(false)}
      onUpdateMember={slots => { setDraftAvailability(slots); setDirty(true); setShowAvailabilityEditor(false); }} />}
  </div>;
};
