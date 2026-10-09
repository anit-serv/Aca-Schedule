import { describe, expect, it, vi } from 'vitest';
import type { Band, DailyTimetable, Timetable } from '../types';
import { autoSchedulePerformance, autoScheduleRange, autoScheduleRehearsal, compareAutoScheduleScores, scoreSchedule } from './autoSchedule';

const band = (id: string, options: Partial<Band> = {}): Band => ({
  id, name: id, performanceDuration: 10, performanceCount: 1,
  toriPriority: 1, costume: false, bandMaster: '', members: [],
  availableTimeSlots: ['2026-10-01', '2026-10-02', '2026-10-03'].map(date => ({ date, timeRanges: [{ startTime: '00:00', endTime: '23:30' }] })),
  createdAt: new Date(), updatedAt: new Date(), ...options,
});

describe('autoScheduleRehearsal', () => {
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
    expect(compareAutoScheduleScores(
      { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 1, dayCountDispersion: 0, transitionMinutes: 0, preferencePenalty: 10_000 },
      { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 1, dayCountDispersion: 0, transitionMinutes: 1, preferencePenalty: 0 },
    )).toBeLessThan(0);
  });

  it('minimizes transition time before balancing cool counts', () => {
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
    expect(compareAutoScheduleScores(balanced, uneven)).toBeGreaterThan(0);
    expect(compareAutoScheduleScores({ ...balanced, transitionMinutes: 0 }, uneven)).toBeLessThan(0);
    expect(compareAutoScheduleScores({ ...balanced, transitionMinutes: 30 }, uneven)).toBeGreaterThan(0);
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

  it('prefers fewer consecutive performances over a slightly more even cool distribution', () => {
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
    expect(compareAutoScheduleScores(separated, consecutive)).toBeLessThan(0);
  });

  it('prefers any shorter transition over any number of ordinary two-performance runs', () => {
    const base = score([day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }])], []);
    const moreRuns = { ...base, twoRunPenalty: 12_000, transitionMinutes: 0 };
    const fewerRuns = { ...base, twoRunPenalty: 0, costumeTwoRunPenalty: 0, transitionMinutes: 1 };
    expect(compareAutoScheduleScores(moreRuns, fewerRuns)).toBeLessThan(0);
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

  it('penalizes priority 2 only when none of its performances ends a cool', () => {
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
    expect(score([day('2026-10-02', [first, finalEnd])], bands).preferencePenalty).toBe(0);
    expect(score([day('2026-10-02', [first, noEnd])], bands).preferencePenalty).toBe(102);
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

  it('prefers the end of a cool for priority 2', () => {
    const original = day('2026-10-02', [{ id: 'c1', number: 1, entries: [] }]);
    const result = autoSchedulePerformance(timetable([original]), [original.date], [
      band('regular'), band('closer', { toriPriority: 2 }),
    ]);
    expect(result.placed).toBe(2);
    expect(result.dailyTimetables[0].cools[0].entries.at(-1)?.bandId).toBe('closer');
  });

  it('keeps priority 2 at the end of a cool even when this adds transition time', () => {
    const date = '2026-10-02';
    const original = day(date, [{ id: 'c1', number: 1, entries: [] }]);
    const regular = band('regular', { availableTimeSlots: [{ date, timeRanges: [{ startTime: '10:30', endTime: '12:00' }] }] });
    const closer = band('closer', { toriPriority: 2 });
    const result = autoSchedulePerformance(timetable([original]), [date], [regular, closer]);
    expect(result).toMatchObject({ placed: 2, remaining: 0 });
    expect(result.dailyTimetables[0].cools[0].entries.at(-1)?.bandId).toBe('closer');
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

  it('prefers two consecutive performances over adding transition time', () => {
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
    expect(Math.abs(entries.findIndex(entry => entry.bandId === 'a') - entries.findIndex(entry => entry.bandId === 'b'))).toBe(1);
    expect(entries.reduce((total, entry) => total + (entry.transitionTime ?? 0), 0)).toBe(0);
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
  }, 30_000);
});
