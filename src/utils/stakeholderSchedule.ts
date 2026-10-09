import type { Band, Cool, DailyTimetable, TimetableEntry } from '../types';
import type { ProgressRecord } from '../services/stakeholderProgress';
import { progressKey } from '../services/stakeholderProgress';

export type ScheduleType = 'performance' | 'rehearsal';
export interface ScheduleRow {
  id: string;
  coolId: string;
  coolIndex: number;
  order: number;
  name: string;
  entry: TimetableEntry;
  plannedStart: string;
  plannedEnd: string;
  predictedStart: string;
  predictedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  deltaMinutes: number;
  affected: boolean;
}
export interface ScheduleCool { id: string; number: number; startTime: string; rows: ScheduleRow[]; boundaryWarning: boolean }
export type ProgressAdjustmentError = 'ENTRY_NOT_FOUND' | 'EARLY_START_LIMIT' | 'EARLY_END_LIMIT' | 'ENTRY_OVERLAP' | 'INVALID_TIME_ORDER' | 'COOL_BOUNDARY';

export const toMinutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
export const fromMinutes = (value: number) => `${String(Math.floor((value + 1440) / 60) % 24).padStart(2, '0')}:${String((value % 60 + 60) % 60).padStart(2, '0')}`;
export const shiftTime = (value: string, minutes: number) => fromMinutes(toMinutes(value) + minutes);

export function nextProgressBoundaryTime(day: DailyTimetable, type: ScheduleType, coolId: string,
  rehearsalType: string, linkedDay?: DailyTimetable): string | undefined {
  const index = day.cools.findIndex(cool => cool.id === coolId);
  if (index < 0) return undefined;
  const next = day.cools[index + 1];
  const nextOwn = next?.startTime || next?.entries[0]?.startTime;
  if (rehearsalType !== 'cool-pre-rehearsal') return nextOwn;
  const linked = linkedDay?.cools[type === 'rehearsal' ? index : index + 1];
  const nextLinked = linked?.startTime || linked?.entries[0]?.startTime;
  return [nextOwn, nextLinked].filter((value): value is string => Boolean(value)).sort()[0];
}

function entryDuration(entry: TimetableEntry, type: ScheduleType, bands: Band[], rehearsalDuration: number) {
  if (entry.type === 'custom') return entry.customEvent?.duration || 0;
  return type === 'rehearsal' ? rehearsalDuration : bands.find(band => band.id === entry.bandId)?.performanceDuration || 0;
}

export function buildScheduleCools(args: {
  day: DailyTimetable;
  type: ScheduleType;
  bands: Band[];
  rehearsalDuration: number;
  records: Record<string, ProgressRecord>;
  candidate?: { entryId: string; field: 'start' | 'end'; actualTime: string };
}): ScheduleCool[] {
  const { day, type, bands, rehearsalDuration, records, candidate } = args;
  const cools: Cool[] = day.cools?.length ? day.cools : [{ id: `day-${day.date}`, number: 1, entries: day.entries || [], startTime: day.startTime }];
  let inheritedCursor = day.startTime;
  return cools.map((cool, coolIndex) => {
    let plannedCursor = cool.startTime || inheritedCursor;
    let previousPlannedEnd: string | undefined;
    let previousPredictedEnd: string | undefined;
    const rows = cool.entries.map((entry, order) => {
      const duration = entryDuration(entry, type, bands, rehearsalDuration);
      const plannedStart = entry.startTime || shiftTime(plannedCursor, entry.transitionTime || 0);
      const plannedEnd = entry.endTime || shiftTime(plannedStart, duration);
      plannedCursor = plannedEnd;
      const key = progressKey(type, day.date, entry.id);
      const stored = records[key] || {};
      const actualStart = candidate?.entryId === entry.id && candidate.field === 'start' ? candidate.actualTime : stored.actualStart;
      const actualEnd = candidate?.entryId === entry.id && candidate.field === 'end' ? candidate.actualTime : stored.actualEnd;
      const gap = previousPlannedEnd === undefined ? 0 : toMinutes(plannedStart) - toMinutes(previousPlannedEnd);
      const predictedStart = actualStart || (previousPredictedEnd ? shiftTime(previousPredictedEnd, gap) : plannedStart);
      const predictedEnd = actualEnd || shiftTime(predictedStart, toMinutes(plannedEnd) - toMinutes(plannedStart));
      const deltaMinutes = toMinutes(predictedStart) - toMinutes(plannedStart);
      previousPlannedEnd = plannedEnd;
      previousPredictedEnd = predictedEnd;
      return {
        id: entry.id, coolId: cool.id, coolIndex, order, entry,
        name: entry.type === 'band' ? bands.find(band => band.id === entry.bandId)?.name || '不明なバンド' : entry.customEvent?.name || 'カスタムイベント',
        plannedStart, plannedEnd, predictedStart, predictedEnd, actualStart, actualEnd,
        deltaMinutes, affected: predictedStart !== plannedStart || predictedEnd !== plannedEnd,
      };
    });
    const nextCool = cools[coolIndex + 1];
    inheritedCursor = rows.at(-1)?.plannedEnd || plannedCursor;
    const nextFixedStart = nextCool?.startTime;
    return {
      id: cool.id, number: cool.number, startTime: cool.startTime || rows[0]?.plannedStart || day.startTime,
      rows,
      boundaryWarning: Boolean(nextFixedStart && rows.length && toMinutes(rows.at(-1)!.predictedEnd) > toMinutes(nextFixedStart)),
    };
  });
}

/** Validate a saved progress adjustment against the original timetable and its current projections. */
export function validateProgressAdjustment(args: {
  day: DailyTimetable;
  type: ScheduleType;
  bands: Band[];
  rehearsalDuration: number;
  records: Record<string, ProgressRecord>;
  coolId: string;
  entryId: string;
  field: 'start' | 'end';
  actualTime: string;
  nextBoundaryTime?: string;
}): ProgressAdjustmentError | null {
  const { day, type, bands, rehearsalDuration, records, coolId, entryId, field, actualTime } = args;
  const current = buildScheduleCools({ day, type, bands, rehearsalDuration, records });
  const coolIndex = current.findIndex(cool => cool.id === coolId);
  const cool = current[coolIndex];
  const rowIndex = cool?.rows.findIndex(row => row.id === entryId) ?? -1;
  if (!cool || rowIndex < 0) return 'ENTRY_NOT_FOUND';
  const row = cool.rows[rowIndex];
  const actual = toMinutes(actualTime);
  const planned = toMinutes(field === 'start' ? row.plannedStart : row.plannedEnd);
  if (field === 'start' && actual < planned) {
    const precedingPlannedEnd = rowIndex === 0 ? toMinutes(cool.startTime) : toMinutes(cool.rows[rowIndex - 1].plannedEnd);
    const transitionMinutes = Math.max(0, planned - precedingPlannedEnd);
    if (planned - actual > transitionMinutes) return 'EARLY_START_LIMIT';
  }
  if (field === 'end' && actual < planned) {
    const duration = Math.max(0, toMinutes(row.plannedEnd) - toMinutes(row.plannedStart));
    if (planned - actual > duration) return 'EARLY_END_LIMIT';
  }
  const projected = buildScheduleCools({ day, type, bands, rehearsalDuration, records,
    candidate: { entryId, field, actualTime } })[coolIndex];
  if (projected.rows.some(item => toMinutes(item.predictedEnd) < toMinutes(item.predictedStart))) return 'INVALID_TIME_ORDER';
  if (projected.rows.some((item, index) => index > 0 && toMinutes(item.predictedStart) < toMinutes(projected.rows[index - 1].predictedEnd))) return 'ENTRY_OVERLAP';
  const nextStart = args.nextBoundaryTime || current[coolIndex + 1]?.startTime;
  const lastEnd = projected.rows.at(-1)?.predictedEnd;
  if (actual > planned && lastEnd && ((nextStart && toMinutes(lastEnd) >= toMinutes(nextStart))
    || (day.endTime && toMinutes(lastEnd) > toMinutes(day.endTime)))) return 'COOL_BOUNDARY';
  return null;
}
