import { describe, expect, it, vi } from 'vitest';
import type { Band, DailyTimetable, Timetable } from '../types';
import { autoSchedulePerformance, autoScheduleRange, autoScheduleRehearsal, compareAutoScheduleScores, findAutoScheduleAvailabilityError, minimizeRehearsalBackupUsage, refineCoolBalance, refineCoolClosers, refineFinalCoolCloser, refineHeadlinerPlacement, refineSameCoolRepeats, scoreSchedule } from './autoSchedule';

const band = (id: string, options: Partial<Band> = {}): Band => ({
  id, name: id, performanceDuration: 10, performanceCount: 1,
  toriPriority: 1, costume: false, bandMaster: '', members: [],
  availableTimeSlots: ['2026-10-01', '2026-10-02', '2026-10-03'].map(date => ({ date, timeRanges: [{ startTime: '00:00', endTime: '23:30' }] })),
  createdAt: new Date(), updatedAt: new Date(), ...options,
});

describe('autoScheduleRehearsal', () => {
  it('reorders a completed rehearsal to replace backup time with normal time', () => {
    const date = '2026-10-01';
    const bands = [
      band('flexible', { performanceDuration: 4, availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:08' }] }] }),
      band('backup', { performanceDuration: 4,
        availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:04' }] }],
        backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '10:04', endTime: '10:08' }] }],
      }),
    ];
    const original = day(date, [{ id: 'cool', number: 1, entries: [
      { id: 'flexible-entry', type: 'band', bandId: 'flexible', order: 0, startTime: '10:00', endTime: '10:04' },
      { id: 'backup-entry', type: 'band', bandId: 'backup', order: 1, startTime: '10:04', endTime: '10:08' },
    ] }]);
    const improved = minimizeRehearsalBackupUsage([original], bands, new Set(['flexible-entry', 'backup-entry']));
    expect(improved[0].cools[0].entries.map(entry => [entry.bandId, entry.startTime])).toEqual([
      ['backup', '10:00'], ['flexible', '10:04'],
    ]);
  });
  it('rejects a rehearsal in the gap between normal slots, while allowing backup time', () => {
    const date = '2026-11-13';
    const candidate = band('bad guy', {
      availableTimeSlots: [{ date, timeRanges: [
        { startTime: '09:00', endTime: '15:15' }, { startTime: '16:00', endTime: '18:00' },
      ] }],
      backupRehearsalTimeSlots: [],
    });
    const source = timetable([day(date, [{ id: 'cool', number: 1, entries: [] }])]);
    const result = autoScheduleRehearsal(source, [date], [candidate], 4, 'rehearsal-day');
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    expect(findAutoScheduleAvailabilityError(result.dailyTimetables, [candidate], 'rehearsal', 4)).toBeNull();
    const invalid = [{ ...result.dailyTimetables[0], cools: [{ ...result.dailyTimetables[0].cools[0], entries: [
      { ...result.dailyTimetables[0].cools[0].entries[0], startTime: '15:56', endTime: '16:00' },
    ] }] }];
    expect(findAutoScheduleAvailabilityError(invalid, [candidate], 'rehearsal', 4)).toContain('出演可能時間外');
  });
  it('uses normal availability first and reserves backup for an otherwise unplaced rehearsal', () => {
    const date = '2026-10-01';
    const source = timetable([day(date, [{ id: 'cool', number: 1, entries: [] }])]);
    const normal = band('normal', {
      availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }],
      backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '10:20', endTime: '10:30' }] }],
    });
    const fallback = band('fallback', {
      availableTimeSlots: [{ date, timeRanges: [{ startTime: '09:00', endTime: '09:10' }] }],
      backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '10:10', endTime: '10:20' }] }],
    });
    const result = autoScheduleRehearsal(source, [date], [normal, fallback], 10, 'rehearsal-day');
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries.map(entry => [entry.bandId, entry.startTime])).toEqual([
      ['normal', '10:00'], ['fallback', '10:10'],
    ]);
    const performance = autoSchedulePerformance(source, [date], [fallback]);
    expect(performance).toMatchObject({ placed: 0, remaining: 1 });
  });

  it('keeps the normal result when backup time cannot place another rehearsal', () => {
    const date = '2026-10-01';
    const source = timetable([day(date, [{ id: 'cool', number: 1, entries: [] }])]);
    const candidate = band('candidate', {
      availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }],
      backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '09:00', endTime: '09:05' }] }],
    });
    const missing = band('missing', {
      availableTimeSlots: [],
      backupRehearsalTimeSlots: [{ date, timeRanges: [{ startTime: '10:30', endTime: '10:35' }] }],
    });
    const result = autoScheduleRehearsal(source, [date], [candidate, missing], 10, 'rehearsal-day');
    expect(result).toMatchObject({ placed: 1, remaining: 1 });
    expect(result.dailyTimetables[0].cools[0].entries.map(entry => entry.bandId)).toEqual(['candidate']);
  });
  it('uses the shared rehearsal duration and ignores headliner priority', () => {
    const original = day('2026-10-01', [{ id: 'cool', number: 1, entries: [] }]);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
    const result = autoScheduleRehearsal(timetable([original]), [original.date], [
      band('priority-3', { performanceDuration: 25, performanceCount: 2, toriPriority: 3 }),
      band('priority-2', { performanceDuration: 30, toriPriority: 2 }),
    ], 5, 'rehearsal-day');
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    const entries = result.dailyTimetables[0].cools[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries.map(entry => entry.endTime)).toEqual(['10:05', '10:10']);
    const withoutPriority = autoScheduleRehearsal(timetable([original]), [original.date], [
      band('priority-3', { performanceDuration: 25, performanceCount: 2 }),
      band('priority-2', { performanceDuration: 30 }),
    ], 5, 'rehearsal-day');
    expect(entries.map(entry => entry.bandId)).toEqual(withoutPriority.dailyTimetables[0].cools[0].entries.map(entry => entry.bandId));
    } finally {
      random.mockRestore();
    }
  });

  it('places each band only on its performance day in day-start mode', () => {
    const dates = ['2026-10-02', '2026-10-03'];
    const rehearsal = timetable(dates.map(date => day(date, [{ id: `r-${date}`, number: 1, entries: [] }])));
    const performance = timetable([
      day(dates[0], [{ id: 'p1', number: 1, entries: [{ id: 'a1', type: 'band', bandId: 'a', order: 0 }] }]),
      day(dates[1], [{ id: 'p2', number: 2, entries: [{ id: 'a2', type: 'band', bandId: 'a', order: 0 }, { id: 'b', type: 'band', bandId: 'b', order: 1 }] }]),
    ]);
    const result = autoScheduleRehearsal(rehearsal, dates, [band('a', { performanceCount: 2 }), band('b')], 5, 'day-start-rehearsal', performance);
    expect(result).toMatchObject({ placed: 3, remaining: 0 });
    expect(result.dailyTimetables.map(item => item.cools[0].entries.map(entry => entry.bandId).sort())).toEqual([['a'], ['a', 'b']]);
  });
});
const day = (date: string, cools: DailyTimetable['cools']): DailyTimetable => ({ date, startTime: '10:00', cools, entries: [] });
const timetable = (days: DailyTimetable[]): Timetable => ({
  id: 't', eventId: 'e', type: 'performance', dailyTimetables: days,
  createdAt: new Date(), updatedAt: new Date(),
});
const score = (days: DailyTimetable[], bands: Band[]) => scoreSchedule(days, new Map(bands.map(item => [item.id, item])));

describe('venue performance windows', () => {
  it('allocates most cools to the long window when three venue windows have very different capacities', () => {
    const date = '2026-10-01';
    const original = day(date, Array.from({ length: 7 }, (_, index) => ({
      id: `cool-${index + 1}`, number: index + 1, entries: [],
    })));
    original.minimumCoolBreakMinutes = 0;
    original.endTime = '14:00';
    original.venueTimeRanges = [
      { startTime: '10:00', endTime: '10:10' },
      { startTime: '11:00', endTime: '11:10' },
      { startTime: '12:00', endTime: '14:00' },
    ];
    const performers = Array.from({ length: 14 }, (_, index) => band(`performer-${index}`, {
      performanceDuration: 5,
    }));
    const result = autoSchedulePerformance(timetable([original]), [date], performers);
    expect(result).toMatchObject({ placed: 14, remaining: 0 });
    const cools = result.dailyTimetables[0].cools;
    expect(cools.map(cool => cool.entries.length)).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(cools.map(cool => cool.startTime).filter(time => time! < '11:00')).toHaveLength(1);
    expect(cools.map(cool => cool.startTime).filter(time => time! >= '11:00' && time! < '12:00')).toHaveLength(1);
  });

  it('moves a band from a crowded cool to a lighter cool across split venue windows', () => {
    const bands = Array.from({ length: 5 }, (_, index) => band(`b${index}`, { performanceDuration: 5 }));
    const original = day('2026-10-01', [
      { id: 'first', number: 1, startTime: '10:00', entries: bands.slice(0, 3).map((item, order) => ({
        id: item.id, type: 'band' as const, bandId: item.id, order,
      })) },
      { id: 'second', number: 2, startTime: '10:20', entries: [] },
      { id: 'third', number: 3, startTime: '11:00', entries: bands.slice(3).map((item, order) => ({
        id: item.id, type: 'band' as const, bandId: item.id, order,
      })) },
    ]);
    original.minimumCoolBreakMinutes = 0;
    original.endTime = '11:30';
    original.venueTimeRanges = [
      { startTime: '10:00', endTime: '10:30' }, { startTime: '11:00', endTime: '11:30' },
    ];
    const improved = refineCoolBalance([original], bands, new Set());
    expect(improved[0].cools.map(cool => cool.entries.length)).toEqual([2, 1, 2]);
    expect(score(improved, bands).coolCountDispersion).toBeLessThan(score([original], bands).coolCountDispersion);
  });

  it('plans balanced cools on both sides of a venue closure', () => {
    const date = '2026-10-01';
    const original = day(date, [1, 2, 3, 4].map(number => ({ id: `cool-${number}`, number, entries: [] })));
    original.venueTimeRanges = [
      { startTime: '10:00', endTime: '11:30' },
      { startTime: '12:00', endTime: '13:30' },
    ];
    const performers = Array.from({ length: 24 }, (_, index) => band(`performer-${index}`, {
      performanceDuration: 5,
      availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '13:30' }] }],
    }));
    const result = autoSchedulePerformance(timetable([original]), [date], performers);
    expect(result).toMatchObject({ placed: 24, remaining: 0 });
    const counts = result.dailyTimetables[0].cools.map(cool => cool.entries.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(result.dailyTimetables[0].cools[2].startTime).toBe('12:00');
    expect(findAutoScheduleAvailabilityError(result.dailyTimetables, performers, 'performance', 0)).toBeNull();
  });
  it('places cards only inside one window and skips a closed interval', () => {
    const date = '2026-10-01';
    const source = day(date, [
      { id: 'morning', number: 1, entries: [] },
      { id: 'afternoon', number: 2, entries: [] },
    ]);
    source.venueTimeRanges = [
      { startTime: '10:00', endTime: '10:10' },
      { startTime: '11:00', endTime: '11:20' },
    ];
    source.endTime = '11:20';
    const result = autoSchedulePerformance(timetable([source]), [date], [band('a'), band('b'), band('c'), band('d')]);
    expect(result).toMatchObject({ placed: 3, remaining: 1 });
    expect(result.dailyTimetables[0].cools.flatMap(cool => cool.entries).map(entry => [entry.startTime, entry.endTime])).toEqual([
      ['10:00', '10:10'], ['11:00', '11:10'], ['11:10', '11:20'],
    ]);
    expect(result.dailyTimetables[0].cools[1].startTime).toBe('11:00');
    expect(result.dailyTimetables[0].cools[0].entries.every(entry => entry.endTime! <= '10:10')).toBe(true);
    expect(result.dailyTimetables[0].cools[1].entries.every(entry => entry.startTime! >= '11:00')).toBe(true);
  });

  it('requires a cool on each side of a venue closure', () => {
    const source = day('2026-10-01', [{ id: 'only', number: 1, entries: [] }]);
    source.venueTimeRanges = [
      { startTime: '10:00', endTime: '13:10' },
      { startTime: '14:20', endTime: '18:00' },
    ];
    const result = autoSchedulePerformance(timetable([source]), [source.date], [band('a')]);
    expect(result.error).toContain('クール数');
  });

  it('reuses a saved cool start in the later venue window after a reset', () => {
    const source = day('2026-10-01', [
      { id: 'first', number: 1, startTime: '10:00', entries: [] },
      { id: 'second', number: 2, startTime: '11:05', entries: [] },
    ]);
    source.venueTimeRanges = [
      { startTime: '10:00', endTime: '10:10' },
      { startTime: '11:00', endTime: '11:20' },
    ];
    const result = autoSchedulePerformance(timetable([source]), [source.date], [band('a'), band('b')]);
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    expect(result.dailyTimetables[0].cools[1].startTime).toBe('11:05');
    expect(result.dailyTimetables[0].cools[0].entries[0].endTime).toBe('10:10');
    expect(result.dailyTimetables[0].cools[1].entries[0].startTime).toBe('11:05');
  });

  it('keeps every cool on one side of a venue closure with several cools', () => {
    const date = '2026-10-01';
    const source = day(date, Array.from({ length: 7 }, (_, index) => ({
      id: `cool-${index + 1}`, number: index + 1, entries: [],
    })));
    source.venueTimeRanges = [
      { startTime: '10:00', endTime: '10:20' },
      { startTime: '14:20', endTime: '15:00' },
    ];
    const result = autoSchedulePerformance(timetable([source]), [date],
      Array.from({ length: 5 }, (_, index) => band(`band-${index}`, { performanceDuration: 5 })));
    expect(result).toMatchObject({ placed: 5, remaining: 0 });
    const cools = result.dailyTimetables[0].cools;
    expect(cools.some(cool => cool.entries.some(entry => entry.startTime! < '10:20'))).toBe(true);
    expect(cools.some(cool => cool.entries.some(entry => entry.startTime! >= '14:20'))).toBe(true);
    expect(cools.every(cool => cool.entries.every(entry => entry.endTime! <= '10:20')
      || cool.entries.every(entry => entry.startTime! >= '14:20'))).toBe(true);
  });

  it('does not place cards on a day with no venue window', () => {
    const source = day('2026-10-01', [{ id: 'cool', number: 1, entries: [] }]);
    source.venueTimeRanges = [];
    const result = autoSchedulePerformance(timetable([source]), [source.date], [band('a')]);
    expect(result).toMatchObject({ placed: 0, remaining: 1 });
  });
});

describe('autoScheduleRange', () => {
  it('reorders only numbered bands in the selected range and preserves other cards and times', () => {
    const members = ['shared'];
    const bands = [band('a', { members }), band('b', { members }), band('c'), band('d')];
    const original = day('2026-10-01', [{ id: 'c1', number: 1, entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
      { id: 'b', type: 'band', bandId: 'b', order: 1, startTime: '10:10', endTime: '10:20' },
      { id: 'event', type: 'custom', order: 2, startTime: '10:20', endTime: '10:25', customEvent: { id: 'event', name: '案内', duration: 5 } },
      { id: 'c', type: 'band', bandId: 'c', order: 3, startTime: '10:25', endTime: '10:35' },
      { id: 'd', type: 'band', bandId: 'd', order: 4, startTime: '10:35', endTime: '10:45', fixedStartTime: '10:35' },
    ] }]);
    const result = autoScheduleRange(timetable([original]), bands, { startNumber: 2, endNumber: 4 });
    expect(result.error).toBeUndefined();
    expect(result.placed).toBe(2);
    const entries = result.dailyTimetables[0].cools[0].entries;
    expect(entries.map(entry => entry.id)).toEqual(['a', 'c', 'event', 'b', 'd']);
    expect(entries[0]).toEqual(original.cools[0].entries[0]);
    expect(entries[2]).toEqual(original.cools[0].entries[2]);
    expect(entries[4]).toEqual(original.cools[0].entries[4]);
    expect(entries[1].startTime).toBe('10:10');
    expect(entries[3].startTime).toBe('10:25');
  });

  it('does not swap bands into unavailable times', () => {
    const date = '2026-10-01';
    const slot = (startTime: string, endTime: string) => [{ date, timeRanges: [{ startTime, endTime }] }];
    const bands = [
      band('a', { members: ['shared'] }),
      band('b', { members: ['shared'], availableTimeSlots: slot('10:10', '10:20') }),
      band('c', { availableTimeSlots: slot('10:20', '10:30') }),
    ];
    const original = day(date, [{ id: 'c1', number: 1, entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
      { id: 'b', type: 'band', bandId: 'b', order: 1, startTime: '10:10', endTime: '10:20' },
      { id: 'c', type: 'band', bandId: 'c', order: 2, startTime: '10:20', endTime: '10:30' },
    ] }]);
    const result = autoScheduleRange(timetable([original]), bands, { startNumber: 2, endNumber: 3 });
    expect(result).toMatchObject({ placed: 0, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries.map(entry => entry.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('autoSchedulePerformance', () => {
  it('resets the shared-member penalty between cools', () => {
    const members = ['shared'];
    const bands = [band('a', { members }), band('b', { members })];
    const entries = bands.map((item, order) => ({ id: item.id, type: 'band' as const, bandId: item.id, order }));
    const sameCool = score([day('2026-10-02', [{ id: 'c1', number: 1, entries }])], bands);
    const separateCools = score([day('2026-10-02', [
      { id: 'c1', number: 1, entries: [entries[0]] },
      { id: 'c2', number: 2, entries: [entries[1]] },
    ])], bands);
    expect(sameCool.preferencePenalty).toBe(12);
    expect(separateCools.preferencePenalty).toBe(0);
  });

  it('keeps a fixed band at its exact time while inserting other bands around it', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'locked', type: 'band', bandId: 'locked', order: 0, fixedStartTime: '10:30', startTime: '10:30', endTime: '10:40' },
    ] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('locked'), band('other')]);
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    const entries = result.dailyTimetables[0].cools[0].entries;
    expect(entries.find(entry => entry.id === 'locked')).toMatchObject({ fixedStartTime: '10:30', startTime: '10:30', endTime: '10:40' });
    expect(entries.find(entry => entry.bandId === 'other')?.startTime).toBeDefined();
    expect(entries.every((entry, index) => index === 0 || entry.startTime! >= entries[index - 1].endTime!)).toBe(true);
  });

  it('ranks same-cool repeats ahead of transition time', () => {
    const repeated = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'a1', type: 'band', bandId: 'a', order: 0 },
      { id: 'a2', type: 'band', bandId: 'a', order: 1 },
    ] }])], [band('a')]);
    const waiting = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'a1', type: 'band', bandId: 'a', order: 0, transitionTime: 120 },
    ] }])], [band('a')]);
    expect(repeated.sameCoolRepeats).toBe(1);
    expect(waiting.transitionMinutes).toBe(120);
    expect(compareAutoScheduleScores(waiting, repeated)).toBeLessThan(0);
    expect(compareAutoScheduleScores({ ...waiting, twoRunPenalty: 100 }, repeated)).toBeLessThan(0);
    expect(compareAutoScheduleScores(
      { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 1, dayCountDispersion: 0, transitionMinutes: 0, preferencePenalty: 10_000 },
      { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 1, dayCountDispersion: 0, transitionMinutes: 1, preferencePenalty: 0 },
    )).toBeLessThan(0);
  });

  it('prefers removing a transition over three minutes even when an ordinary two-run appears', () => {
    const bands = [
      band('a', { members: ['shared'] }), band('b'), band('c', { members: ['shared'] }),
    ];
    const scheduled = (ids: string[], wait: number) => score([day('2026-10-02', [{
      id: 'cool', number: 1, entries: ids.map((id, order) => ({
        id, type: 'band' as const, bandId: id, order, transitionTime: order === 2 ? wait : 0,
      })),
    }])], bands);
    const longGap = scheduled(['a', 'b', 'c'], 6);
    const twoRun = scheduled(['a', 'c', 'b'], 3);
    expect(longGap).toMatchObject({ longTransitionPenalty: 9, twoRunPenalty: 0 });
    expect(twoRun).toMatchObject({ longTransitionPenalty: 0, twoRunPenalty: 12 });
    expect(compareAutoScheduleScores(twoRun, longGap)).toBeLessThan(0);
  });

  it('swaps a repeated band out of its cool even when this adds an ordinary two-run', () => {
    const bands = [
      band('repeat', { performanceCount: 2, members: ['shared'] }),
      band('separator'), band('shared', { members: ['shared'] }), band('other'),
    ];
    const original = { ...day('2026-10-02', [
      { id: 'first', number: 1, startTime: '10:00', entries: [
        { id: 'repeat-1', type: 'band' as const, bandId: 'repeat', order: 0 },
        { id: 'separator', type: 'band' as const, bandId: 'separator', order: 1 },
        { id: 'repeat-2', type: 'band' as const, bandId: 'repeat', order: 2 },
      ] },
      { id: 'second', number: 2, startTime: '11:00', entries: [
        { id: 'shared', type: 'band' as const, bandId: 'shared', order: 0, fixedStartTime: '11:00' },
        { id: 'other', type: 'band' as const, bandId: 'other', order: 1 },
      ] },
    ]), endTime: '11:20' };
    const initialScore = score([original], bands);
    const improved = refineSameCoolRepeats([original], bands, new Set());
    const improvedScore = score(improved, bands);
    expect(initialScore.sameCoolRepeats).toBe(1);
    expect(initialScore.twoRunPenalty).toBe(0);
    expect(improvedScore.sameCoolRepeats).toBe(0);
    expect(improvedScore.twoRunPenalty).toBeGreaterThan(0);
    expect(compareAutoScheduleScores(improvedScore, initialScore)).toBeLessThan(0);
  });

  it('moves a repeated band to an empty cool when no swap is available', () => {
    const bands = [band('repeat', { performanceCount: 2 })];
    const original = day('2026-10-02', [
      { id: 'first', number: 1, startTime: '10:00', entries: [
        { id: 'repeat-1', type: 'band', bandId: 'repeat', order: 0 },
        { id: 'repeat-2', type: 'band', bandId: 'repeat', order: 1 },
      ] },
      { id: 'second', number: 2, startTime: '11:00', entries: [] },
    ]);
    const improved = refineSameCoolRepeats([original], bands, new Set());
    expect(improved[0].cools.map(cool => cool.entries.length)).toEqual([1, 1]);
    expect(score(improved, bands).sameCoolRepeats).toBe(0);
  });

  it('balances cool counts before comparing transition time', () => {
    const bands = ['a', 'b', 'c', 'd'].map(id => band(id));
    const balanced = score([day('2026-10-02', [
      { id: 'c1', number: 1, entries: [
        { id: 'a', type: 'band', bandId: 'a', order: 0, transitionTime: 2 },
        { id: 'b', type: 'band', bandId: 'b', order: 1 },
      ] },
      { id: 'c2', number: 2, entries: [
        { id: 'c', type: 'band', bandId: 'c', order: 0 },
        { id: 'd', type: 'band', bandId: 'd', order: 1 },
      ] },
    ])], bands);
    const uneven = score([day('2026-10-02', [
      { id: 'c1', number: 1, entries: ['a', 'b', 'c', 'd'].map((id, order) => ({ id, type: 'band' as const, bandId: id, order })) },
      { id: 'c2', number: 2, entries: [] },
    ])], bands);
    expect(balanced.coolCountDispersion).toBe(8);
    expect(uneven.coolCountDispersion).toBe(16);
    expect(compareAutoScheduleScores(balanced, uneven)).toBeLessThan(0);
    expect(compareAutoScheduleScores({ ...balanced, transitionMinutes: 0 }, uneven)).toBeLessThan(0);
    expect(compareAutoScheduleScores({ ...balanced, transitionMinutes: 30, longTransitionPenalty: 27 ** 2 }, uneven)).toBeLessThan(0);
  });

  it('sets an inferred cool start a few minutes after the minimum break', () => {
    const date = '2026-10-02';
    const original = day(date, [
      { id: 'c1', number: 1, entries: [
        { id: 'existing', type: 'band', bandId: 'existing', order: 0, startTime: '10:00', endTime: '10:10' },
      ] },
      { id: 'c2', number: 2, entries: [] },
    ]);
    const late = band('late', { availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:23', endTime: '10:33' }] }] });
    const result = autoSchedulePerformance(timetable([original]), [date], [band('existing'), late]);
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    expect(result.dailyTimetables[0].cools.every(cool => Boolean(cool.startTime))).toBe(true);
    const second = result.dailyTimetables[0].cools[1];
    if (second.entries.some(entry => entry.bandId === 'late')) {
      expect(second.startTime).toBe('10:20');
      expect(second.entries[0].transitionTime).toBe(3);
    }
  });

  it('balances each multi-performance band across performance dates at the same weight as cool balance', () => {
    const repeated = band('repeat', { performanceCount: 2 });
    const makeDay = (date: string, first: boolean, second: boolean) => day(date, [
      { id: `${date}-1`, number: 1, entries: first ? [{ id: `${date}-a`, type: 'band', bandId: repeated.id, order: 0 }] : [] },
      { id: `${date}-2`, number: 2, entries: second ? [{ id: `${date}-b`, type: 'band', bandId: repeated.id, order: 0 }] : [] },
    ]);
    const split = score([makeDay('2026-10-02', true, false), makeDay('2026-10-03', true, false)], [repeated]);
    const concentrated = score([makeDay('2026-10-02', true, true), makeDay('2026-10-03', false, false)], [repeated]);
    expect(split.coolCountDispersion).toBe(concentrated.coolCountDispersion);
    expect(split.dayCountDispersion).toBe(2);
    expect(concentrated.dayCountDispersion).toBe(4);
    expect(compareAutoScheduleScores(split, concentrated)).toBeLessThan(0);
  });

  it('spreads feasible bands nearly evenly over the available cools', () => {
    const original = day('2026-10-02', [1, 2, 3].map(number => ({ id: `c${number}`, number, entries: [] })));
    const result = autoSchedulePerformance(timetable([original]), [original.date],
      Array.from({ length: 7 }, (_, index) => band(`b${index}`)));
    expect(result).toMatchObject({ placed: 7, remaining: 0 });
    const counts = result.dailyTimetables[0].cools.map(cool => cool.entries.filter(entry => entry.type === 'band').length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('balances a full day across cools while keeping every performance in its available time', () => {
    const date = '2026-10-02';
    const original = day(date, [1, 2, 3, 4].map(number => ({ id: `c${number}`, number, entries: [] })));
    const performers = Array.from({ length: 16 }, (_, index) => band(`performer-${index}`, {
      performanceDuration: 5,
      availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:00', endTime: '12:00' }] }],
    }));
    const result = autoSchedulePerformance(timetable([original]), [date], performers);
    expect(result).toMatchObject({ placed: 16, remaining: 0 });
    const counts = result.dailyTimetables[0].cools.map(cool => cool.entries.filter(entry => entry.type === 'band').length);
    expect(counts).toEqual([4, 4, 4, 4]);
    expect(findAutoScheduleAvailabilityError(result.dailyTimetables, performers, 'performance', 0)).toBeNull();
  });

  it('places two performances on separate days when both days are available', () => {
    const dates = ['2026-10-02', '2026-10-03'];
    const original = timetable(dates.map(date => day(date, [
      { id: `${date}-1`, number: 1, entries: [] },
      { id: `${date}-2`, number: 2, entries: [] },
    ])));
    const result = autoSchedulePerformance(original, dates, [band('repeat', { performanceCount: 2 })]);
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    expect(result.dailyTimetables.map(item => item.cools.flatMap(cool => cool.entries).filter(entry => entry.bandId === 'repeat').length)).toEqual([1, 1]);
  });

  it('increases the penalty exponentially for longer member runs', () => {
    const bands = ['a', 'b', 'c', 'd'].map(id => band(id, { members: ['member'] }));
    const run = (length: number) => score([day('2026-10-02', [{ id: 'c1', number: 1, entries: bands.slice(0, length).map((item, order) => ({
      id: item.id, type: 'band' as const, bandId: item.id, order,
    })) }])], bands).preferencePenalty;
    expect([run(2), run(3), run(4)]).toEqual([12, 48, 156]);
  });

  it('keeps cool counts balanced ahead of ordinary two-performance runs', () => {
    const bands = [band('a', { members: ['shared'] }), band('b', { members: ['shared'] }), band('c'), band('d')];
    const entry = (id: string) => ({ id, type: 'band' as const, bandId: id, order: 0 });
    const consecutive = score([day('2026-10-02', [
      { id: 'c1', number: 1, entries: [entry('a'), entry('b')] },
      { id: 'c2', number: 2, entries: [entry('c'), entry('d')] },
    ])], bands);
    const separated = score([day('2026-10-02', [
      { id: 'c1', number: 1, entries: [entry('a'), entry('c'), entry('d')] },
      { id: 'c2', number: 2, entries: [entry('b')] },
    ])], bands);
    expect(consecutive.coolCountDispersion).toBeLessThan(separated.coolCountDispersion);
    expect(consecutive.twoRunPenalty).toBe(12);
    expect(separated.twoRunPenalty).toBe(0);
    expect(compareAutoScheduleScores(separated, consecutive)).toBeGreaterThan(0);
  });

  it('does not trade many consecutive performances for one minute of transition', () => {
    const base = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }])], []);
    const moreRuns = { ...base, twoRunPenalty: 12_000, transitionMinutes: 0 };
    const fewerRuns = { ...base, twoRunPenalty: 0, costumeTwoRunPenalty: 0, transitionMinutes: 1 };
    expect(compareAutoScheduleScores(moreRuns, fewerRuns)).toBeGreaterThan(0);
  });

  it('still prioritizes avoiding costume two-performance runs over transition time', () => {
    const base = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }])], []);
    const costumeRun = { ...base, twoRunPenalty: 48, costumeTwoRunPenalty: 48, transitionMinutes: 0 };
    const noCostumeRun = { ...base, transitionMinutes: 1 };
    expect(compareAutoScheduleScores(noCostumeRun, costumeRun)).toBeLessThan(0);
  });

  it('keeps three-or-more consecutive performances separate from the two-run transition rule', () => {
    const bands = ['a', 'b', 'c'].map(id => band(id, { members: ['shared'] }));
    const entries = bands.map((item, order) => ({ id: item.id, type: 'band' as const, bandId: item.id, order }));
    const triple = score([day('2026-10-02', [{ id: 'c1', number: 1, entries }])], bands);
    expect(triple.twoRunPenalty).toBe(12);
    expect(triple.longRunPenalty).toBe(36);
    expect(compareAutoScheduleScores(triple, { ...triple, longRunPenalty: 0, transitionMinutes: 100 })).toBeGreaterThan(0);
  });

  it('does not count the final cool closer toward priority 2', () => {
    const bands = [band('closer', { toriPriority: 2 }), band('other')];
    const first = { id: 'c1', number: 1, entries: [
      { id: 'p1', type: 'band' as const, bandId: 'closer', order: 0 },
      { id: 'o1', type: 'band' as const, bandId: 'other', order: 1 },
    ] };
    const finalEnd = { id: 'c2', number: 2, entries: [
      { id: 'o2', type: 'band' as const, bandId: 'other', order: 0 },
      { id: 'p2', type: 'band' as const, bandId: 'closer', order: 1 },
    ] };
    const noEnd = { ...finalEnd, entries: [...finalEnd.entries].reverse() };
    const finalCloser = score([day('2026-10-02', [first, finalEnd])], bands);
    expect(finalCloser.priority2Missing).toBe(1);
    expect(finalCloser.priority2FinalCloser).toBe(1);
    expect(score([day('2026-10-02', [first, noEnd])], bands).priority2FinalCloser).toBe(0);
    expect(score([day('2026-10-02', [{ ...first, entries: [...first.entries].reverse() }, finalEnd])], bands).priority2Missing).toBe(0);
  });

  it('counts the final band as the cool closer even when a custom event follows', () => {
    const bands = [band('closer', { toriPriority: 2 })];
    const result = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'closer', type: 'band', bandId: 'closer', order: 0 },
      { id: 'announcement', type: 'custom', order: 1, customEvent: { id: 'announcement', name: '案内', duration: 5 } },
    ] }, { id: 'final', number: 2, entries: [] }])], bands);
    expect(result.priority2Missing).toBe(0);
    expect(result.preferencePenalty).toBe(0);
  });

  it('honors headliner priorities before balancing cool and day counts', () => {
    const baseline = score([day('2026-10-02', [{ id: 'cool', number: 1, entries: [] }])], []);
    const balanced = { ...baseline, priority3Missing: 1, priority2Missing: 1, coolCountDispersion: 0, dayCountDispersion: 0 };
    const preferred = { ...baseline, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 100, dayCountDispersion: 100 };
    expect(compareAutoScheduleScores(preferred, balanced)).toBeLessThan(0);
    expect(compareAutoScheduleScores({ ...preferred, sameCoolRepeats: 1 }, balanced)).toBeGreaterThan(0);
    expect(compareAutoScheduleScores({ ...preferred, priority3Missing: 1 }, balanced)).toBeLessThan(0);
  });

  it('places priority 3 in the final cool even if the cool sizes become uneven', () => {
    const date = '2026-10-02';
    const original = day(date, [
      { id: 'first', number: 1, startTime: '10:00', entries: [] },
      { id: 'final', number: 2, startTime: '11:00', entries: [] },
    ]);
    const available = (startTime: string, endTime: string) => [{ date, timeRanges: [{ startTime, endTime }] }];
    const performers = [
      band('first-only', { availableTimeSlots: available('10:00', '10:20') }),
      band('final-a', { availableTimeSlots: available('11:00', '11:30') }),
      band('final-b', { availableTimeSlots: available('11:00', '11:30') }),
      band('headliner', { toriPriority: 3, availableTimeSlots: available('10:00', '11:30') }),
    ];
    const result = autoSchedulePerformance(timetable([original]), [date], performers);
    expect(result).toMatchObject({ placed: 4, remaining: 0 });
    expect(result.dailyTimetables[0].cools[1].entries.map(entry => entry.bandId)).toContain('headliner');
  });

  it('swaps a headliner into a full final cool even when this creates two ordinary consecutive appearances', () => {
    const performers = [
      band('headliner', { toriPriority: 3, members: ['m1', 'm2'] }),
      band('first-regular'), band('final-regular'),
      band('shared-final', { members: ['m1', 'm2'], availableTimeSlots: [
        { date: '2026-10-02', timeRanges: [{ startTime: '11:00', endTime: '11:20' }] },
      ] }),
    ];
    const original = { ...day('2026-10-02', [
      { id: 'first', number: 1, startTime: '10:00', entries: [
        { id: 'headliner-entry', type: 'band' as const, bandId: 'headliner', order: 0 },
        { id: 'first-entry', type: 'band' as const, bandId: 'first-regular', order: 1 },
      ] },
      { id: 'final', number: 2, startTime: '11:00', entries: [
        { id: 'final-entry', type: 'band' as const, bandId: 'final-regular', order: 0 },
        { id: 'shared-entry', type: 'band' as const, bandId: 'shared-final', order: 1 },
      ] },
    ]), endTime: '11:20' };
    const initialScore = score([original], performers);
    const improved = refineHeadlinerPlacement([original], performers, new Set());
    const improvedScore = score(improved, performers);
    expect(improved[0].cools[1].entries.map(entry => entry.bandId)).toContain('headliner');
    expect(improvedScore.priority3Missing).toBe(0);
    expect(improvedScore.twoRunPenalty).toBeGreaterThan(initialScore.twoRunPenalty);
    expect(compareAutoScheduleScores(improvedScore, initialScore)).toBeLessThan(0);
  });

  it('swaps a priority-2 band to a cool ending even when ordinary consecutive appearances increase', () => {
    const performers = [
      band('closer', { toriPriority: 2, members: ['shared'] }),
      band('fixed'), band('shared-target', { members: ['shared'] }), band('swappable'),
    ];
    const original = { ...day('2026-10-02', [
      { id: 'first', number: 1, startTime: '10:00', entries: [
        { id: 'closer-entry', type: 'band' as const, bandId: 'closer', order: 0 },
        { id: 'fixed-entry', type: 'band' as const, bandId: 'fixed', order: 1, fixedStartTime: '10:10' },
      ] },
      { id: 'second', number: 2, startTime: '11:00', entries: [
        { id: 'shared-entry', type: 'band' as const, bandId: 'shared-target', order: 0 },
        { id: 'swappable-entry', type: 'band' as const, bandId: 'swappable', order: 1 },
      ] },
      { id: 'final', number: 3, startTime: '12:00', entries: [] },
    ]), endTime: '12:20', venueTimeRanges: [
      { startTime: '10:00', endTime: '10:20' }, { startTime: '11:00', endTime: '11:20' },
      { startTime: '12:00', endTime: '12:20' },
    ] };
    const initialScore = score([original], performers);
    const improved = refineCoolClosers([original], performers, new Set(['fixed-entry']));
    const improvedScore = score(improved, performers);
    expect(improvedScore.priority2Missing).toBe(0);
    expect(improvedScore.twoRunPenalty).toBeGreaterThan(initialScore.twoRunPenalty);
    expect(improved[0].cools[1].entries.at(-1)?.bandId).toBe('closer');
    expect(improved[0].cools[0].entries.at(-1)?.fixedStartTime).toBe('10:10');
  });

  it('penalizes priority 3 only when none of its performances is in the final cool', () => {
    const bands = [band('headliner', { toriPriority: 3 })];
    const first = { id: 'c1', number: 1, entries: [{ id: 'p1', type: 'band' as const, bandId: 'headliner', order: 0 }] };
    const final = { id: 'c2', number: 2, entries: [{ id: 'p2', type: 'band' as const, bandId: 'headliner', order: 0 }] };
    expect(score([day('2026-10-02', [first, final])], bands).preferencePenalty).toBe(0);
    expect(score([day('2026-10-02', [first, { ...final, entries: [] }])], bands).preferencePenalty).toBe(300);
  });
  it('keeps existing band order and cool, and preserves configured cool starts', () => {
    const original = day('2026-10-02', [
      { id: 'c1', number: 1, entries: [
        { id: 'first', type: 'band', bandId: 'a', order: 0 },
        { id: 'second', type: 'band', bandId: 'b', order: 1 },
      ] },
      { id: 'c2', number: 2, startTime: '11:00', entries: [] },
    ]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('a'), band('b'), band('c')]);
    expect(result.placed).toBe(1);
    const cools = result.dailyTimetables[0].cools;
    expect(cools[0].entries.filter(entry => entry.id === 'first' || entry.id === 'second').map(entry => entry.id)).toEqual(['first', 'second']);
    expect(cools[1].startTime).toBe('11:00');
    expect(cools.flatMap(cool => cool.entries).find(entry => entry.bandId === 'c')).toBeDefined();
  });

  it('uses all dates and places priority 3 in the last cool when feasible', () => {
    const first = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    const last = day('2026-10-03', [{ id: 'c2', number: 2, entries: [] }]);
    const result = autoSchedulePerformance(timetable([first, last]), [first.date, last.date], [band('headliner', { toriPriority: 3 })]);
    expect(result.placed).toBe(1);
    expect(result.dailyTimetables[1].cools[0].entries[0].bandId).toBe('headliner');
  });

  it('places priority 3 in the final day and cool even when this adds transition time', () => {
    const dates = ['2026-10-02', '2026-10-03'];
    const original = timetable([
      day(dates[0], [{ id: 'first-day', number: 1, entries: [] }]),
      day(dates[1], [
        { id: 'last-day-first-cool', number: 1, entries: [] },
        { id: 'last-day-final-cool', number: 2, startTime: '11:00', entries: [] },
      ]),
    ]);
    const headliner = band('headliner', { toriPriority: 3, availableTimeSlots: dates.map(date => ({
      date, timeRanges: [{ startTime: date === dates[0] ? '10:00' : '11:30', endTime: '12:00' }],
    })) });
    const result = autoSchedulePerformance(original, dates, [headliner]);
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries).toHaveLength(0);
    expect(result.dailyTimetables[1].cools[0].entries).toHaveLength(0);
    expect(result.dailyTimetables[1].cools[1].entries[0]).toMatchObject({ bandId: 'headliner', startTime: '11:30' });
  });

  it('prefers a non-final cool ending for priority 2', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }, { id: 'c2', number: 2, entries: [] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('regular'), band('closer', { toriPriority: 2 }),
    ]);
    expect(result.placed).toBe(2);
    expect(result.dailyTimetables[0].cools[0].entries.at(-1)?.bandId).toBe('closer');
    expect(score(result.dailyTimetables, [band('regular'), band('closer', { toriPriority: 2 })]).priority2FinalCloser).toBe(0);
  });

  it('keeps priority 2 at the end of a cool even when this adds transition time', () => {
    const date = '2026-10-02';
    const original = day(date, [{ id: 'c1', number: 1, entries: [] }, { id: 'c2', number: 2, entries: [] }]);
    const regular = band('regular', { availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:30', endTime: '12:00' }] }] });
    const closer = band('closer', { toriPriority: 2 });
    const result = autoSchedulePerformance(timetable([original]), [date], [regular, closer]);
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries.at(-1)?.bandId).toBe('closer');
  });

  it('swaps a movable priority-2 final closer with a regular band', () => {
    const bands = [band('closer', { toriPriority: 2 }), band('regular')];
    const original = day('2026-10-02', [
      { id: 'first', number: 1, startTime: '10:00', entries: [
        { id: 'regular-entry', type: 'band', bandId: 'regular', order: 0 },
      ] },
      { id: 'final', number: 2, startTime: '11:00', entries: [
        { id: 'closer-entry', type: 'band', bandId: 'closer', order: 0 },
      ] },
    ]);
    const improved = refineFinalCoolCloser([original], bands, new Set());
    expect(improved[0].cools[0].entries[0].bandId).toBe('closer');
    expect(improved[0].cools[1].entries[0].bandId).toBe('regular');
    expect(score(improved, bands)).toMatchObject({ priority2Missing: 0, priority2FinalCloser: 0 });
  });

  it('does not place outside availability', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    const unavailable = band('b', {
      availableTimeSlots: [{ date: original.date, timeRanges: [{ startTime: '09:00', endTime: '09:30' }] }],
    });
    const result = autoSchedulePerformance(timetable([original]), [original.date], [unavailable]);
    expect(result).toMatchObject({ placed: 0, remaining: 1 });
  });

  it('treats unset or empty availability as unavailable for the whole day', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    for (const availableTimeSlots of [[], [{ date: original.date, timeRanges: [] }]]) {
      const result = autoSchedulePerformance(timetable([original]), [original.date], [band('b', { availableTimeSlots })]);
      expect(result).toMatchObject({ placed: 0, remaining: 1 });
      expect(result.dailyTimetables).toEqual([original]);
    }
  });

  it('rejects an existing placement on a day without availability', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'b', order: 0, startTime: '10:00', endTime: '10:10' },
    ] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('b', { availableTimeSlots: [] })]);
    expect(result.error).toContain('既存配置に出演可能時間外');
    expect(result.dailyTimetables).toEqual([original]);
  });

  it('uses only the date with a configured time range', () => {
    const first = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    const second = day('2026-10-03', [{ id: 'c2', number: 1, entries: [] }]);
    const result = autoSchedulePerformance(timetable([first, second]), [first.date, second.date], [band('b', {
      availableTimeSlots: [{ date: second.date, timeRanges: [{ startTime: '10:00', endTime: '11:00' }] }],
    })]);
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries).toHaveLength(0);
    expect(result.dailyTimetables[1].cools[0].entries[0].bandId).toBe('b');
  });

  it('avoids consecutive members involving a costume band when a separator is available', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'a', order: 0 },
    ] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('a', { members: ['m'] }),
      band('b', { members: ['m'], costume: true }),
      band('separator'),
    ]);
    const order = result.dailyTimetables[0].cools[0].entries.map(entry => entry.bandId);
    expect(result.placed).toBe(2);
    expect(Math.abs(order.indexOf('a') - order.indexOf('b'))).toBe(2);
  });

  it('spreads shared-member performances across balanced cools', () => {
    const date = '2026-10-02';
    const original = day(date, Array.from({ length: 3 }, (_, index) => ({
      id: `cool-${index + 1}`, number: index + 1, entries: [],
    })));
    const shared = Array.from({ length: 6 }, (_, index) => band(`shared-${index}`, {
      members: ['same-person'], costume: index % 2 === 0, performanceDuration: 5,
    }));
    const separators = Array.from({ length: 12 }, (_, index) => band(`separator-${index}`, { performanceDuration: 5 }));
    const bands = [...shared, ...separators];
    const result = autoSchedulePerformance(timetable([original]), [date], bands);
    const cools = result.dailyTimetables[0].cools;
    const score = scoreSchedule(result.dailyTimetables, new Map(bands.map(item => [item.id, item])));
    expect(result).toMatchObject({ placed: bands.length, remaining: 0 });
    expect(cools.map(cool => cool.entries.length)).toEqual([6, 6, 6]);
    expect(score.longRunPenalty).toBe(0);
    expect(score.costumeTwoRunPenalty).toBe(0);
  });

  it('produces the same placement for identical inputs on repeated runs', () => {
    const dates = ['2026-10-02', '2026-10-03'];
    const original = timetable(dates.map(date => day(date, [
      { id: `${date}-1`, number: 1, entries: [] },
      { id: `${date}-2`, number: 2, entries: [] },
    ])));
    const bands = [
      band('a', { members: ['shared'], performanceCount: 2 }),
      band('b', { members: ['shared'], costume: true, performanceCount: 2 }),
      band('c', { performanceCount: 2 }),
      band('d', { performanceCount: 2 }),
    ];
    const layout = () => autoSchedulePerformance(original, dates, bands).dailyTimetables.map(item =>
      item.cools.map(cool => cool.entries.map(entry => [entry.bandId, entry.startTime])));
    expect(layout()).toEqual(layout());
  });

  it('rejects insertion that would push an existing band outside its available time', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'a', order: 0 },
    ] }]);
    const slot = [{ date: original.date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }];
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('a', { availableTimeSlots: slot }),
      band('b', { availableTimeSlots: slot }),
    ]);
    expect(result).toMatchObject({ placed: 0, remaining: 1 });
    expect(result.dailyTimetables[0].cools[0].entries).toHaveLength(1);
  });

  it('keeps an explicit cool start even with linked rehearsal timing', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, startTime: '11:00', entries: [] }]);
    const rehearsal = timetable([day(original.date, [{ id: 'r1', number: 1, entries: [
      { id: 'r', type: 'band', bandId: 'b', order: 0, startTime: '10:00', endTime: '10:20' },
    ] }])]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('b')], rehearsal);
    expect(result.placed).toBe(1);
    expect(result.dailyTimetables[0].cools[0].startTime).toBe('11:00');
    expect(result.dailyTimetables[0].cools[0].entries[0].startTime).toBe('11:00');
  });

  it('uses an existing gap to place every band without extending it', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'late', order: 0, transitionTime: 30 },
    ] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('late', { availableTimeSlots: [{ date: original.date, timeRanges: [{ startTime: '10:30', endTime: '10:40' }] }] }),
      band('early', { availableTimeSlots: [{ date: original.date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }] }),
    ]);
    expect(result).toMatchObject({ placed: 1, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries.map(entry => [entry.bandId, entry.startTime])).toEqual([
      ['early', '10:00'], ['late', '10:30'],
    ]);
  });

  it('avoids consecutive performances when a short transition can separate them', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'a', order: 0 },
    ] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('a', { members: ['member'] }),
      band('b', { members: ['member'] }),
      band('separator', { availableTimeSlots: [{ date: original.date, timeRanges: [{ startTime: '10:11', endTime: '11:00' }] }] }),
    ]);
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    const entries = result.dailyTimetables[0].cools[0].entries;
    expect(Math.abs(entries.findIndex(entry => entry.bandId === 'a') - entries.findIndex(entry => entry.bandId === 'b'))).toBe(2);
  });

  it('keeps feasible placements when all performances cannot fit', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band', bandId: 'a', order: 0 },
    ] }]);
    const slot = [{ date: original.date, timeRanges: [{ startTime: '10:00', endTime: '10:20' }] }];
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('a', { availableTimeSlots: [{ date: original.date, timeRanges: [{ startTime: '10:00', endTime: '10:10' }] }] }),
      band('b', { availableTimeSlots: slot }),
      band('c', { availableTimeSlots: slot }),
    ]);
    expect(result).toMatchObject({ placed: 1, remaining: 1 });
    expect(result.error).toBeUndefined();
    const entries = result.dailyTimetables[0].cools[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries.find(entry => entry.id === 'fixed')).toMatchObject({ bandId: 'a', startTime: '10:00', endTime: '10:10' });
    expect(entries.filter(entry => entry.bandId === 'b' || entry.bandId === 'c')).toHaveLength(1);
    expect(entries.every(entry => entry.startTime && entry.endTime && entry.endTime <= '10:20')).toBe(true);
  });

  it('continues after an unavailable band and places later feasible bands', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('unavailable', { availableTimeSlots: [] }),
      band('available'),
    ]);
    expect(result).toMatchObject({ placed: 1, remaining: 1 });
    expect(result.dailyTimetables[0].cools[0].entries.map(entry => entry.bandId)).toEqual(['available']);
  });

  it('leaves bands unplaced when they would end after the daily end time', () => {
    const original = { ...day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]), endTime: '10:15' };
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('a'), band('b')]);
    expect(result).toMatchObject({ placed: 1, remaining: 1 });
    expect(result.dailyTimetables[0].endTime).toBe('10:15');
    expect(result.dailyTimetables[0].cools[0].entries[0]).toMatchObject({ startTime: '10:00', endTime: '10:10' });
  });

  it('rejects an existing placement that exceeds the daily end time', () => {
    const original = { ...day('2026-10-02', [{ id: 'c1', number: 1, entries: [
      { id: 'fixed', type: 'band' as const, bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
    ] }]), endTime: '10:05' };
    const result = autoSchedulePerformance(timetable([original]), [original.date], [band('a'), band('b')]);
    expect(result.error).toContain('終了時刻超過');
    expect(result.dailyTimetables).toEqual([original]);
  });

  it('places 80 bands twice across a feasible two-day timetable', () => {
    const dates = ['2026-10-02', '2026-10-03'];
    const originalDays = dates.map(date => day(date, [
      { id: `morning-${date}`, number: 1, startTime: '10:00', entries: [] },
      { id: `afternoon-${date}`, number: 2, startTime: '14:00', entries: [] },
    ]));
    const bands = Array.from({ length: 80 }, (_, index) => band(`band-${index}`, {
      performanceDuration: 5,
      performanceCount: 2,
      availableTimeSlots: dates.map(date => ({ date, timeRanges: [{ startTime: '10:00', endTime: '18:00' }] })),
    }));
    const result = autoSchedulePerformance(timetable(originalDays), dates, bands);
    expect(result).toMatchObject({ placed: 160, remaining: 0 });
  }, 90_000);

  it('balances 92 bands across six cools without fixed starts and keeps ten-minute breaks', () => {
    const date = '2026-10-02';
    const original = day(date, Array.from({ length: 6 }, (_, index) => ({
      id: `cool-${index + 1}`, number: index + 1, entries: [],
    })));
    const bands = Array.from({ length: 92 }, (_, index) => band(`band-${index}`, { performanceDuration: 5 }));
    const result = autoSchedulePerformance(timetable([original]), [date], bands);
    const cools = result.dailyTimetables[0].cools;
    const counts = cools.map(cool => cool.entries.length);
    expect(result).toMatchObject({ placed: 92, remaining: 0 });
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (let index = 1; index < cools.length; index++) {
      const previousEnd = cools[index - 1].entries.at(-1)!.endTime!;
      const nextStart = cools[index].entries[0].startTime!;
      const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      expect(toMinutes(nextStart) - toMinutes(previousEnd)).toBeGreaterThanOrEqual(10);
    }
  }, 60_000);
});
