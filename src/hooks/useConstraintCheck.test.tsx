import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Band, DailyTimetable, Timetable } from '../types';
import { useAllViolations, useConstraintCheck } from './useConstraintCheck';

it('shows one blue priority-2 notice and one yellow priority-3 notice only when no performance meets the priority', () => {
  const makeBand = (id: string, toriPriority: 2 | 3): Band => ({
    id, name: id, performanceDuration: 10, performanceCount: 2, toriPriority,
    costume: false, bandMaster: '', members: [], availableTimeSlots: [],
    createdAt: new Date(), updatedAt: new Date(),
  });
  const bands = [makeBand('p2', 2), makeBand('p3', 3)];
  const makeEntry = (id: string, bandId: string, order: number) => ({
    id, type: 'band' as const, bandId, order, startTime: '10:00', endTime: '10:10',
  });
  const table: Timetable = {
    id: 't', eventId: 'e', type: 'performance', createdAt: new Date(), updatedAt: new Date(),
    dailyTimetables: [
      { date: '2026-10-02', startTime: '10:00', entries: [], cools: [{
        id: 'first', number: 1, entries: [makeEntry('p2a', 'p2', 0), makeEntry('p3a', 'p3', 1)],
      }] },
      { date: '2026-10-03', startTime: '10:00', entries: [], cools: [{
        id: 'before-final', number: 1, entries: [makeEntry('p3b', 'p3', 0), makeEntry('p2b', 'p2', 1)],
      }, { id: 'final', number: 2, entries: [] }] },
    ],
  };
  const notices = () => renderHook(() => useAllViolations(table, null, bands)).result.current
    .filter(item => item.type === 'tori-priority-unmet');
  expect(notices()).toMatchObject([{ bandId: 'p3', severity: 'medium' }]);
  table.dailyTimetables[1].cools[0].entries.push(makeEntry('other', 'other', 2));
  expect(notices()).toMatchObject([
    { bandId: 'p2', severity: 'low' }, { bandId: 'p3', severity: 'medium' },
  ]);
  table.dailyTimetables[1].cools[0].entries.pop();
  table.dailyTimetables[1].cools[0].entries.push({
    id: 'custom', type: 'custom', order: 2, customEvent: { id: 'custom', name: '休憩', duration: 5 },
  });
  expect(notices()).toMatchObject([{ bandId: 'p3', severity: 'medium' }]);
  table.dailyTimetables[1].cools[1].entries.push(makeEntry('p3c', 'p3', 0));
  expect(notices()).toHaveLength(0);
  table.dailyTimetables[1].cools[0].entries = [makeEntry('p3b', 'p3', 0)];
  table.dailyTimetables[1].cools[1].entries = [makeEntry('p3c', 'p3', 0), makeEntry('p2c', 'p2', 1)];
  expect(notices()).toMatchObject([{ bandId: 'p2', severity: 'low' }]);
  expect(renderHook(() => useAllViolations(null, { ...table, type: 'rehearsal' }, bands)).result.current
    .some(item => item.type === 'tori-priority-unmet')).toBe(false);
});

it('flags a cool break shorter than the configured minimum', () => {
  const day: DailyTimetable = {
    date: '2026-10-02', startTime: '10:00', minimumCoolBreakMinutes: 15, entries: [], cools: [
      { id: 'first', number: 1, entries: [{ id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' }] },
      { id: 'second', number: 2, entries: [{ id: 'b', type: 'band', bandId: 'b', order: 0, startTime: '10:20', endTime: '10:30' }] },
    ],
  };
  const issues = renderHook(() => useConstraintCheck(day, [], new Map())).result.current;
  expect(issues.find(issue => issue.type === 'cool-break-short')).toMatchObject({ entryId: 'b', severity: 'medium' });
});

it('flags band and custom event placements that end after the daily limit', () => {
  const day: DailyTimetable = {
    date: '2026-10-02', startTime: '10:00', endTime: '10:15', entries: [], cools: [{
      id: 'cool', number: 1, entries: [
        { id: 'band', type: 'band', bandId: 'b', order: 0, startTime: '10:00', endTime: '10:20' },
        { id: 'custom', type: 'custom', customEvent: { id: 'c', name: '休憩', duration: 10 }, order: 1, startTime: '10:20', endTime: '10:30' },
      ],
    }],
  };
  const single = renderHook(() => useConstraintCheck(day, [], new Map()));
  expect(single.result.current.filter(item => item.type === 'day-end-exceeded').map(item => item.entryId)).toEqual(['band', 'custom']);
  const timetable = { id: 't', eventId: 'e', type: 'performance', dailyTimetables: [day], createdAt: new Date(), updatedAt: new Date() } as Timetable;
  const all = renderHook(() => useAllViolations(timetable, null, []));
  expect(all.result.current.filter(item => item.type === 'day-end-exceeded')).toHaveLength(2);
});

it('flags entries placed in a closed venue interval', () => {
  const day: DailyTimetable = {
    date: '2026-10-02', startTime: '10:00', endTime: '11:20',
    venueTimeRanges: [{ startTime: '10:00', endTime: '10:20' }, { startTime: '11:00', endTime: '11:20' }],
    entries: [], cools: [{ id: 'cool', number: 1, entries: [
      { id: 'valid', type: 'custom', order: 0, startTime: '10:00', endTime: '10:10', customEvent: { id: 'a', name: '案内', duration: 10 } },
      { id: 'invalid', type: 'custom', order: 1, startTime: '10:15', endTime: '10:25', customEvent: { id: 'b', name: '休憩', duration: 10 } },
    ] }],
  };
  const issues = renderHook(() => useConstraintCheck(day, [], new Map())).result.current;
  expect(issues.filter(issue => issue.type === 'venue-time-exceeded').map(issue => issue.entryId)).toEqual(['invalid']);
});

it('accepts backup availability for rehearsal while keeping performance restricted to normal availability', () => {
  const date = '2026-10-02';
  const band = {
    id: 'b', name: 'b', performanceDuration: 10, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', members: [],
    availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }],
    backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '10:10', endTime: '10:20' }] }],
    createdAt: new Date(), updatedAt: new Date(),
  } as Band;
  const day: DailyTimetable = {
    date, startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, entries: [
      { id: 'entry', type: 'band', bandId: 'b', order: 0, startTime: '10:10', endTime: '10:20' },
    ] }],
  };
  const table = (type: Timetable['type']): Timetable => ({
    id: type, eventId: 'e', type, dailyTimetables: [day], createdAt: new Date(), updatedAt: new Date(),
  });
  const rehearsalNotices = renderHook(() => useAllViolations(null, table('rehearsal'), [band])).result.current;
  expect(rehearsalNotices.some(item => item.type === 'availability-exceeded')).toBe(false);
  expect(rehearsalNotices.find(item => item.type === 'backup-rehearsal-used')).toMatchObject({ severity: 'low', entryId: 'entry' });
  expect(renderHook(() => useAllViolations(table('performance'), null, [band])).result.current.some(item => item.type === 'availability-exceeded')).toBe(true);
});

it('grades consecutive performances by shared member run length and costume', () => {
  const date = '2026-10-02';
  const members = ['共通メンバー'];
  const bands = Array.from({ length: 4 }, (_, index): Band => ({
    id: `b${index}`, name: `バンド${index}`, performanceDuration: 10, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', members,
    availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '11:00' }] }],
    createdAt: new Date(), updatedAt: new Date(),
  }));
  const makeTable = (count: number): Timetable => ({
    id: 't', eventId: 'e', type: 'performance', createdAt: new Date(), updatedAt: new Date(),
    dailyTimetables: [{ date, startTime: '10:00', entries: [], cools: [{
      id: 'cool', number: 1, entries: bands.slice(0, count).map((band, order) => ({
        id: `entry${order}`, type: 'band', bandId: band.id, order,
        startTime: `10:${String(order * 10).padStart(2, '0')}`,
        endTime: `10:${String((order + 1) * 10).padStart(2, '0')}`,
      })),
    }] }],
  });
  const notices = (count: number) => renderHook(() => useAllViolations(makeTable(count), null, bands)).result.current
    .filter(item => item.type === 'consecutive-performance');
  expect(notices(2).map(item => item.severity)).toEqual(['low', 'low']);
  expect(notices(3).map(item => item.severity)).toEqual(['medium', 'medium', 'medium']);
  expect(notices(4).map(item => item.severity)).toEqual(['high', 'high', 'high', 'high']);
  bands[0].costume = true;
  expect(notices(2).map(item => item.severity)).toEqual(['medium', 'medium']);
});

it('resets consecutive performances at a cool boundary', () => {
  const date = '2026-10-02';
  const bands = Array.from({ length: 4 }, (_, index): Band => ({
    id: `b${index}`, name: `バンド${index}`, performanceDuration: 10, performanceCount: 1,
    toriPriority: 1, costume: false, bandMaster: '', members: ['共通メンバー'],
    availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '11:00' }] }],
    createdAt: new Date(), updatedAt: new Date(),
  }));
  const day: DailyTimetable = {
    date, startTime: '10:00', entries: [],
    cools: [0, 1].map(coolIndex => ({
      id: `cool${coolIndex}`, number: coolIndex + 1,
      entries: bands.slice(coolIndex * 2, coolIndex * 2 + 2).map((band, order) => ({
        id: `entry${coolIndex * 2 + order}`, type: 'band' as const, bandId: band.id, order,
        startTime: `10:${String((coolIndex * 2 + order) * 10).padStart(2, '0')}`,
        endTime: `10:${String((coolIndex * 2 + order + 1) * 10).padStart(2, '0')}`,
      })),
    })),
  };
  const notices = renderHook(() => useConstraintCheck(day, bands, new Map())).result.current
    .filter(item => item.type === 'consecutive-performance');
  expect(notices.map(item => item.severity)).toEqual(['low', 'low', 'low', 'low']);
  expect(notices[1].relatedEntryIds).toEqual(['entry0']);
  expect(notices[2].relatedEntryIds).toEqual(['entry3']);
});
