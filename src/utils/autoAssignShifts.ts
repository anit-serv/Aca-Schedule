import type { Band, CustomFieldsSettings, ShiftSlot, Timetable, TimetableEntry } from '../types';
import { getShiftSlots, normalizePersonName } from './customShift';

type TimetableType = 'performance' | 'rehearsal';
export interface ShiftColumnSelection { type: TimetableType; columnId: string }
export interface ShiftAssignmentIssue { label: string; reason: string }
export interface ShiftAssignmentResult {
  settings: CustomFieldsSettings;
  assigned: number;
  assignments: Array<{ label: string; assignee: string }>;
  unassigned: ShiftAssignmentIssue[];
}

interface Task {
  type: TimetableType;
  columnId: string;
  date: string;
  coolId: string;
  slot: ShiftSlot;
  index: number;
  start: number;
  end: number;
  label: string;
  candidates: string[];
  selected: boolean;
}

const minutes = (time?: string) => time && /^\d{2}:\d{2}$/.test(time)
  ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN;
const overlaps = (a: Task, b: Task) => a.date === b.date && a.start < b.end && b.start < a.end;
const nameOf = (name: string) => normalizePersonName(name);

const groupsFor = (timetable: Timetable) => timetable.dailyTimetables.flatMap(day => day.cools.length
  ? day.cools.map(cool => ({ date: day.date, coolId: cool.id, label: `第${cool.number}クール`, entries: cool.entries }))
  : [{ date: day.date, coolId: 'flat', label: '全体', entries: day.entries }]);

const validTime = (entries: TimetableEntry[]) => {
  const start = minutes(entries[0]?.startTime);
  const end = minutes(entries[entries.length - 1]?.endTime);
  return { start, end };
};

const available = (settings: CustomFieldsSettings, name: string, task: Task) => {
  const restrictions = settings.shiftAvailability?.[name];
  if (restrictions === undefined) return true;
  return restrictions.some(day => day.date === task.date && day.timeRanges.some(range =>
    minutes(range.startTime) <= task.start && task.end <= minutes(range.endTime)));
};

const score = (tasks: Task[], assignment: Map<Task, string>, people: string[]) => {
  const counts = new Map(people.map(person => [person, 0]));
  const durations = new Map(people.map(person => [person, 0]));
  let unassigned = 0;
  let consecutive = 0;
  for (const task of tasks) {
    const person = assignment.get(task);
    if (!person) { if (task.selected) unassigned++; continue; }
    counts.set(person, (counts.get(person) ?? 0) + 1);
    durations.set(person, (durations.get(person) ?? 0) + (Number.isFinite(task.end - task.start) ? task.end - task.start : 0));
    if (tasks.some(other => other !== task && other.type === task.type && other.columnId === task.columnId
      && other.date === task.date && other.coolId === task.coolId && other.index === task.index - 1
      && assignment.get(other) === person)) consecutive++;
  }
  const countSpread = [...counts.values()].reduce((sum, count) => sum + count * count, 0);
  const durationSpread = [...durations.values()].reduce((sum, duration) => sum + duration * duration, 0);
  return [unassigned, countSpread, consecutive, durationSpread];
};

const isBetter = (a: number[], b: number[]) => {
  const firstDifference = a.findIndex((value, index) => value !== b[index]);
  return firstDifference >= 0 && a[firstDifference] < b[firstDifference];
};

/** 選択列の枠を同時に割り振る。選択外と、組み直し対象外の入力済み担当は固定する。 */
export const autoAssignShifts = (
  settings: CustomFieldsSettings,
  timetables: Partial<Record<TimetableType, Timetable | null>>,
  bands: Band[],
  selectedColumns: ShiftColumnSelection[],
  replaceAssigned = false,
): ShiftAssignmentResult => {
  const selected = new Set(selectedColumns.map(item => `${item.type}:${item.columnId}`));
  const bandById = new Map(bands.map(band => [band.id, band]));
  const tasks: Task[] = [];
  const performances: Array<{ date: string; start: number; end: number; members: string[] }> = [];
  for (const type of ['performance', 'rehearsal'] as const) {
    const timetable = timetables[type];
    if (!timetable) continue;
    for (const group of groupsFor(timetable)) {
      for (const entry of group.entries) {
        if (entry.type !== 'band') continue;
        performances.push({ date: group.date, start: minutes(entry.startTime), end: minutes(entry.endTime),
          members: (bandById.get(entry.bandId ?? '')?.members ?? []).map(nameOf) });
      }
      for (const column of settings[type].columns) {
        if (!column.shift) continue;
        let offset = 0;
        getShiftSlots(column, group.date, group.coolId, group.entries.length).forEach((slot, index) => {
          const entries = group.entries.slice(offset, offset + slot.size);
          offset += slot.size;
          const { start, end } = validTime(entries);
          tasks.push({ type, columnId: column.id, date: group.date, coolId: group.coolId,
            slot, index, start, end,
            label: `${type === 'performance' ? '本番' : 'リハ'} ${group.date} ${group.label} ${column.name} ${index + 1}枠目`,
            candidates: column.shift!.candidates.map(nameOf),
            selected: selected.has(`${type}:${column.id}`) });
        });
      }
    }
  }
  const people = [...new Set(tasks.flatMap(task => task.candidates).concat(tasks.map(task => nameOf(task.slot.assignee ?? '')).filter(Boolean)))];
  const fixed = new Map<Task, string>();
  const pending: Task[] = [];
  for (const task of tasks) {
    if (task.slot.assignee && (!task.selected || !replaceAssigned)) fixed.set(task, nameOf(task.slot.assignee));
    else if (task.selected) pending.push(task);
  }
  const eligible = (task: Task) => task.candidates.filter(person => Number.isFinite(task.start) && Number.isFinite(task.end)
    && task.start < task.end && available(settings, person, task)
    && !performances.some(performance => performance.date === task.date && performance.members.includes(person)
      && task.start < performance.end && performance.start < task.end));
  const options = new Map(pending.map(task => [task, eligible(task)]));
  let best = new Map(fixed);
  let bestScore = score(tasks, best, people);
  const attempts = Math.min(180, Math.max(24, pending.length * 2));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const assignment = new Map(fixed);
    const counts = new Map(people.map(person => [person, [...fixed.values()].filter(value => value === person).length]));
    const ordered = [...pending].sort((a, b) => (options.get(a)!.length - options.get(b)!.length)
      || (a.date.localeCompare(b.date)) || (a.start - b.start));
    if (attempt) ordered.sort((a, b) => (options.get(a)!.length - options.get(b)!.length) || (Math.random() - 0.5));
    for (const task of ordered) {
      const choices = options.get(task)!.filter(person => ![...assignment].some(([other, assigned]) =>
        assigned === person && overlaps(task, other)));
      choices.sort((a, b) => {
        const countDifference = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
        if (countDifference) return countDifference;
        const adjacent = (person: string) => [...assignment].filter(([other, assigned]) => assigned === person
          && other.type === task.type && other.columnId === task.columnId && other.date === task.date
          && other.coolId === task.coolId && Math.abs(other.index - task.index) === 1).length;
        return adjacent(a) - adjacent(b) || Math.random() - 0.5;
      });
      if (choices[0]) { assignment.set(task, choices[0]); counts.set(choices[0], (counts.get(choices[0]) ?? 0) + 1); }
    }
    const currentScore = score(tasks, assignment, people);
    if (isBetter(currentScore, bestScore)) { best = assignment; bestScore = currentScore; }
    if (bestScore[0] === 0 && attempt >= 24) break;
  }
  const result = structuredClone(settings);
  if (replaceAssigned) for (const task of pending) {
    const target = result[task.type].columns.find(item => item.id === task.columnId)?.shift?.slotsByDate[task.date]?.[task.coolId]?.[task.index];
    if (target) delete target.assignee;
  }
  let assigned = 0;
  const assignments: ShiftAssignmentResult['assignments'] = [];
  const unassigned: ShiftAssignmentIssue[] = [];
  for (const task of pending) {
    const person = best.get(task);
    if (!person) {
      unassigned.push({ label: task.label, reason: !Number.isFinite(task.start) || !Number.isFinite(task.end)
        ? '時刻が未設定です' : options.get(task)!.length === 0
          ? '担当可能時間または出演との重複により候補がいません' : '他のシフト枠との重複により候補が足りません' });
      continue;
    }
    const column = result[task.type].columns.find(item => item.id === task.columnId)!;
    const slots = column.shift!.slotsByDate[task.date] ??= {};
    const source = tasks.filter(item => item.type === task.type && item.columnId === task.columnId
      && item.date === task.date && item.coolId === task.coolId).map(item => item.slot);
    const saved = slots[task.coolId] ??= source.map(slot => ({ ...slot }));
    const target = saved.find(slot => slot.id === task.slot.id) ?? saved[task.index];
    if (target) { target.assignee = person; assigned++; assignments.push({ label: task.label, assignee: person }); }
  }
  return { settings: result, assigned, assignments, unassigned };
};
