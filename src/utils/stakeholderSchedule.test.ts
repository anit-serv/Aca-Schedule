import { expect, it } from 'vitest';
import type { Band, DailyTimetable } from '../types';
import { buildScheduleCools, validateProgressAdjustment } from './stakeholderSchedule';

it('shifts only later rows in the same cool and preserves actual records and the next fixed cool', () => {
  const day = { date: '2026-11-15', startTime: '10:00', entries: [], cools: [
    { id: 'c1', number: 1, startTime: '10:00', entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
      { id: 'b', type: 'band', bandId: 'b', order: 1, startTime: '10:15', endTime: '10:25' },
      { id: 'c', type: 'band', bandId: 'c', order: 2, startTime: '10:30', endTime: '10:40' },
    ] },
    { id: 'c2', number: 2, startTime: '11:00', entries: [
      { id: 'd', type: 'band', bandId: 'd', order: 0, startTime: '11:00', endTime: '11:10' },
    ] },
  ] } as DailyTimetable;
  const result = buildScheduleCools({ day, type: 'performance', bands: [] as Band[], rehearsalDuration: 5,
    records: { 'performance|2026-11-15|a': { actualStart: '10:03', actualEnd: '10:12' } },
    candidate: { entryId: 'b', field: 'start', actualTime: '10:20' },
  });
  expect(result[0].rows.map(row => row.predictedStart)).toEqual(['10:03', '10:20', '10:35']);
  expect(result[0].rows[0].actualEnd).toBe('10:12');
  expect(result[1].rows[0].predictedStart).toBe('11:00');
});

it('inherits the previous cool end when the next cool has no start time', () => {
  const day = { date: '2026-11-15', startTime: '10:00', entries: [], cools: [
    { id: 'first', number: 1, entries: [{ id: 'a', type: 'custom', customEvent: { id: 'a', name: '案内', duration: 10 }, order: 0 }] },
    { id: 'second', number: 2, entries: [{ id: 'b', type: 'custom', customEvent: { id: 'b', name: '転換', duration: 5 }, order: 0 }] },
  ] } as DailyTimetable;
  const result = buildScheduleCools({ day, type: 'performance', bands: [], rehearsalDuration: 0, records: {} });
  expect(result[0].rows[0].plannedEnd).toBe('10:10');
  expect(result[1].rows[0].plannedStart).toBe('10:10');
});

it('limits earlier starts to transition time and earlier ends to performance duration', () => {
  const day = { date: '2026-11-15', startTime: '10:00', entries: [], cools: [
    { id: 'first', number: 1, startTime: '10:00', entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
      { id: 'b', type: 'band', bandId: 'b', order: 1, transitionTime: 5, startTime: '10:15', endTime: '10:25' },
    ] },
    { id: 'second', number: 2, startTime: '10:40', entries: [] },
  ] } as DailyTimetable;
  const check = (field: 'start' | 'end', actualTime: string) => validateProgressAdjustment({
    day, type: 'performance', bands: [] as Band[], rehearsalDuration: 0, records: {},
    coolId: 'first', entryId: 'b', field, actualTime,
  });
  expect(check('start', '10:10')).toBeNull();
  expect(check('start', '10:09')).toBe('EARLY_START_LIMIT');
  expect(check('end', '10:15')).toBeNull();
  expect(check('end', '10:14')).toBe('EARLY_END_LIMIT');
});

it('rejects a delay when the last performance reaches the next cool start', () => {
  const day = { date: '2026-11-15', startTime: '10:00', entries: [], cools: [
    { id: 'first', number: 1, startTime: '10:00', entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
      { id: 'b', type: 'band', bandId: 'b', order: 1, startTime: '10:15', endTime: '10:25' },
    ] },
    { id: 'second', number: 2, startTime: '10:30', entries: [] },
  ] } as DailyTimetable;
  const check = (actualTime: string) => validateProgressAdjustment({
    day, type: 'performance', bands: [] as Band[], rehearsalDuration: 0, records: {},
    coolId: 'first', entryId: 'a', field: 'start', actualTime,
  });
  expect(check('10:04')).toBeNull();
  expect(check('10:05')).toBe('COOL_BOUNDARY');
});
