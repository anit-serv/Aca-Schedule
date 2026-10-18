import type { AvailableTimeSlot, CustomCellData, CustomColumn, CustomFieldsSettings } from '../types';
import { deepEqual } from './deepEqual';

type TimetableType = 'performance' | 'rehearsal';
type CellStore = 'bySequence' | 'byEntity';
type Change =
  | { type: TimetableType; kind: 'columns'; before: CustomColumn[]; after: CustomColumn[] }
  | { kind: 'shiftAvailability'; before?: Record<string, AvailableTimeSlot[]>; after?: Record<string, AvailableTimeSlot[]> }
  | { type: TimetableType; kind: 'cell'; date: string; store: CellStore; row: string; columnId: string; before?: CustomCellData; after?: CustomCellData };

const TYPES: TimetableType[] = ['performance', 'rehearsal'];
const STORES: CellStore[] = ['bySequence', 'byEntity'];

export const getCustomFieldsChanges = (before: CustomFieldsSettings, after: CustomFieldsSettings): Change[] => {
  const changes: Change[] = [];
  if (!deepEqual(before.shiftAvailability, after.shiftAvailability)) {
    changes.push({ kind: 'shiftAvailability', before: before.shiftAvailability, after: after.shiftAvailability });
  }
  for (const type of TYPES) {
    if (!deepEqual(before[type].columns, after[type].columns)) {
      changes.push({ type, kind: 'columns', before: before[type].columns, after: after[type].columns });
    }
    const dates = new Set([...Object.keys(before[type].dailyData), ...Object.keys(after[type].dailyData)]);
    for (const date of dates) {
      for (const store of STORES) {
        const beforeRows = (before[type].dailyData[date]?.[store] ?? {}) as Record<string, Record<string, CustomCellData>>;
        const afterRows = (after[type].dailyData[date]?.[store] ?? {}) as Record<string, Record<string, CustomCellData>>;
        for (const row of new Set([...Object.keys(beforeRows), ...Object.keys(afterRows)])) {
          const previous = beforeRows[row] ?? {};
          const next = afterRows[row] ?? {};
          for (const columnId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
            if (!deepEqual(previous[columnId], next[columnId])) {
              changes.push({ type, kind: 'cell', date, store, row, columnId, before: previous[columnId], after: next[columnId] });
            }
          }
        }
      }
    }
  }
  return changes;
};

export const isCustomFieldsChangeConflicted = (
  current: CustomFieldsSettings | undefined,
  changes: Change[],
  direction: 'undo' | 'redo'
): boolean => {
  if (!current) return true;
  return changes.some(change => {
    const expected = direction === 'undo' ? change.after : change.before;
    const actual = change.kind === 'shiftAvailability' ? current.shiftAvailability
      : change.kind === 'columns' ? current[change.type].columns
        : (current[change.type].dailyData[change.date]?.[change.store] as Record<string, Record<string, CustomCellData>> | undefined)?.[change.row]?.[change.columnId];
    return !deepEqual(actual, expected);
  });
};

export const applyCustomFieldsChanges = (
  current: CustomFieldsSettings,
  changes: Change[],
  direction: 'undo' | 'redo'
): CustomFieldsSettings => {
  const result = structuredClone(current);
  for (const change of changes) {
    const value = direction === 'undo' ? change.before : change.after;
    if (change.kind === 'shiftAvailability') {
      if (value === undefined) delete result.shiftAvailability;
      else result.shiftAvailability = structuredClone(value as Record<string, AvailableTimeSlot[]>);
      continue;
    }
    if (change.kind === 'columns') {
      result[change.type].columns = structuredClone(value as CustomColumn[]);
      continue;
    }
    const dailyData = result[change.type].dailyData;
    const daily = dailyData[change.date] ??= { bySequence: {}, byEntity: {} };
    const rows = daily[change.store] as Record<string, Record<string, CustomCellData>>;
    const row = rows[change.row] ??= {};
    if (value === undefined) {
      delete row[change.columnId];
      if (Object.keys(row).length === 0) delete rows[change.row];
    } else {
      row[change.columnId] = structuredClone(value as CustomCellData);
    }
    if (Object.keys(daily.bySequence).length === 0 && Object.keys(daily.byEntity).length === 0) {
      delete dailyData[change.date];
    }
  }
  return result;
};
