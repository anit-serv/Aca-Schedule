import type { AvailableTimeSlot, Band, ConstraintViolation, CustomColumn, CustomColumnShift, CustomFieldsSettings, ShiftSlot, Timetable, TimetableEntry } from '../types';
import { generateUUID } from './generateUUID';

export const normalizePersonName = (name: string) => name.trim();

export const uniquePeople = (names: string[]) =>
  [...new Set(names.map(normalizePersonName).filter(Boolean))];

/** 担当可能時間を初めて指定するときは、各日のタイムテーブル開始・終了を初期範囲にする。 */
export const defaultShiftAvailability = (
  dates: string[], performance: Timetable | null, rehearsal: Timetable | null,
): AvailableTimeSlot[] => dates.map(date => {
  const days = [performance, rehearsal].flatMap(timetable => timetable?.dailyTimetables ?? [])
    .filter(day => day.date === date);
  const starts = days.map(day => day.startTime).filter(time => /^\d{2}:\d{2}$/.test(time));
  const startTime = starts.length ? starts.sort()[0] : '00:00';
  const endTime = days.length && days.every(day => day.endTime && /^\d{2}:\d{2}$/.test(day.endTime))
    ? days.map(day => day.endTime!).sort().at(-1)! : '24:00';
  return { date, timeRanges: startTime < endTime ? [{ startTime, endTime }] : [] };
});

export const makeShiftSlots = (count: number, split: CustomColumnShift['split']): ShiftSlot[] => {
  if (count < 1) return [];
  const value = Math.max(1, Math.floor(split.value));
  if (split.mode === 'per-entries') {
    return Array.from({ length: Math.ceil(count / value) }, (_, index) => ({
      id: generateUUID(),
      size: Math.min(value, count - index * value),
    }));
  }
  const numberOfSlots = Math.min(count, value);
  const base = Math.floor(count / numberOfSlots);
  const remainder = count % numberOfSlots;
  return Array.from({ length: numberOfSlots }, (_, index) => ({
    id: generateUUID(),
    size: base + (index < remainder ? 1 : 0),
  }));
};

// 枠は出演順の位置に残す。行が減ったときだけ末尾の空枠を吸収する。
export const fitShiftSlots = (slots: ShiftSlot[], count: number): ShiftSlot[] => {
  if (count < 1) return [];
  if (!slots.length) return [{ id: generateUUID(), size: count }];
  const result = slots.map(slot => ({ ...slot, size: Math.max(1, Math.floor(slot.size)) }));
  let total = result.reduce((sum, slot) => sum + slot.size, 0);
  if (total < count) result[result.length - 1].size += count - total;
  while (total > count && result.length > 1) {
    const last = result[result.length - 1];
    if (last.size <= total - count) {
      total -= last.size;
      result.pop();
    } else {
      last.size -= total - count;
      total = count;
    }
  }
  if (result.length === 1) result[0].size = count;
  return result;
};

export const getShiftSlots = (column: CustomColumn, date: string, coolId: string, count: number): ShiftSlot[] => {
  if (!column.shift || count < 1) return [];
  const stored = column.shift.slotsByDate[date]?.[coolId];
  return fitShiftSlots(stored ?? makeShiftSlots(count, column.shift.split), count);
};

export const createShift = (candidates: string[], split: CustomColumnShift['split'], timetable: Timetable | null): CustomColumnShift => {
  const slotsByDate: CustomColumnShift['slotsByDate'] = {};
  for (const day of timetable?.dailyTimetables ?? []) {
    const byCool: Record<string, ShiftSlot[]> = {};
    if (day.cools.length) {
      for (const cool of day.cools) {
        if (cool.entries.length) byCool[cool.id] = makeShiftSlots(cool.entries.length, split);
      }
    } else if (day.entries.length) {
      byCool.flat = makeShiftSlots(day.entries.length, split);
    }
    slotsByDate[day.date] = byCool;
  }
  return { candidates: uniquePeople(candidates), split, slotsByDate };
};

export type ShiftSlotAction =
  | { type: 'boundary-up' | 'boundary-down' | 'add' | 'delete'; index: number }
  | { type: 'boundary-move'; index: number; delta: number }
  | { type: 'assign'; index: number; assignee?: string };

export const editShiftSlots = (slots: ShiftSlot[], action: ShiftSlotAction): ShiftSlot[] => {
  const result = slots.map(slot => ({ ...slot }));
  const { index } = action;
  if (index < 0 || index >= result.length) return slots;
  if (action.type === 'assign') {
    if (action.assignee) result[index].assignee = action.assignee;
    else delete result[index].assignee;
  } else if (action.type === 'boundary-up') {
    if (index >= result.length - 1 || result[index].size <= 1) return slots;
    result[index].size--;
    result[index + 1].size++;
  } else if (action.type === 'boundary-down') {
    if (index >= result.length - 1 || result[index + 1].size <= 1) return slots;
    result[index].size++;
    result[index + 1].size--;
  } else if (action.type === 'boundary-move') {
    if (index >= result.length - 1 || !Number.isInteger(action.delta)) return slots;
    const next = result[index + 1];
    if (result[index].size + action.delta < 1 || next.size - action.delta < 1 || action.delta === 0) return slots;
    result[index].size += action.delta;
    next.size -= action.delta;
  } else if (action.type === 'add') {
    if (result[index].size <= 1) return slots;
    const newSize = Math.floor(result[index].size / 2);
    result[index].size -= newSize;
    result.splice(index + 1, 0, { id: generateUUID(), size: newSize });
  } else if (action.type === 'delete') {
    if (result.length <= 1) return slots;
    const [removed] = result.splice(index, 1);
    result[Math.max(0, index - 1)].size += removed.size;
  }
  return result;
};

export const getShiftSlotAt = (slots: ShiftSlot[], index: number) => {
  let start = 0;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const slot = slots[slotIndex];
    if (index >= start && index < start + slot.size) return { slot, slotIndex, start };
    start += slot.size;
  }
  return null;
};

/** 同じクールで出演行が1行以上重なる、他列の担当者を取得する。 */
export const getOverlappingShiftAssignees = (
  columns: CustomColumn[],
  ownColumnId: string,
  date: string,
  coolId: string,
  count: number,
  start: number,
  size: number,
): string[] => {
  const occupied: string[] = [];
  for (const column of columns) {
    if (column.id === ownColumnId || !column.shift) continue;
    let otherStart = 0;
    for (const slot of getShiftSlots(column, date, coolId, count)) {
      if (slot.assignee && otherStart < start + size && start < otherStart + slot.size) {
        occupied.push(slot.assignee);
      }
      otherStart += slot.size;
    }
  }
  return uniquePeople(occupied);
};

/** 表示中の枠と同じ判定で、全日程のシフト担当重複を確認事項にする。 */
export const getCustomShiftIssues = (
  performance: Timetable | null,
  rehearsal: Timetable | null,
  fields: CustomFieldsSettings | undefined,
  bands: Band[],
): ConstraintViolation[] => {
  if (!fields) return [];
  const issues: ConstraintViolation[] = [];
  const bandById = new Map(bands.map(band => [band.id, band]));
  for (const timetable of [performance, rehearsal]) {
    if (!timetable) continue;
    const columns = fields[timetable.type].columns;
    const prefix = timetable.type === 'performance' ? '本番' : 'リハ';
    for (const day of timetable.dailyTimetables) {
      const groups: Array<{ id: string; label: string; entries: TimetableEntry[] }> = day.cools.length
        ? day.cools.map(cool => ({ id: cool.id, label: `第${cool.number}クール`, entries: cool.entries }))
        : [{ id: 'flat', label: '全体', entries: day.entries }];
      for (const group of groups) {
        for (const column of columns) {
          if (!column.shift) continue;
          let start = 0;
          getShiftSlots(column, day.date, group.id, group.entries.length).forEach((slot, index) => {
            const assignee = normalizePersonName(slot.assignee ?? '');
            if (assignee) {
              const entries = group.entries.slice(start, start + slot.size);
              const performanceConflict = entries.some(entry => entry.type === 'band'
                && bandById.get(entry.bandId ?? '')?.members.some(member => normalizePersonName(member) === assignee));
              const shiftConflict = getOverlappingShiftAssignees(columns, column.id, day.date, group.id,
                group.entries.length, start, slot.size).some(name => normalizePersonName(name) === assignee);
              if (performanceConflict || shiftConflict) {
                const reasons = [performanceConflict && '出演メンバー', shiftConflict && '他列のシフト担当'].filter(Boolean).join('・');
                issues.push({
                  id: `shift:${timetable.type}:${day.date}:${column.id}:${slot.id}`,
                  type: 'shift-conflict', severity: 'high',
                  entryId: entries[0]?.id ?? '', shiftSlotId: slot.id,
                  coolId: group.id, date: day.date,
                  message: `[${prefix} ${day.date}] ${group.label}・${column.name} ${index + 1}枠目: ${assignee}が${reasons}と重複`,
                });
              }
            }
            start += slot.size;
          });
        }
      }
    }
  }
  return issues;
};
