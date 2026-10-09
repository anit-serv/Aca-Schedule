import { describe, expect, it } from 'vitest';
import type { DailyTimetable } from '../types';
import { effectiveCoolStart, isValidCoolStart, isValidDayEnd } from './dailyTimeBounds';

const day: DailyTimetable = {
  date: '2026-10-02', startTime: '10:00', endTime: '12:00', entries: [],
  cools: [
    { id: 'one', number: 1, startTime: '10:00', entries: [{ id: 'a', type: 'custom', order: 0, endTime: '10:20' }] },
    { id: 'two', number: 2, entries: [{ id: 'b', type: 'custom', order: 0, endTime: '10:40' }] },
    { id: 'three', number: 3, entries: [] },
  ],
};

describe('daily time bounds', () => {
  it('requires each cool start to follow the previous cool start and precede the day end', () => {
    expect(effectiveCoolStart(day, 1)).toBe('10:20');
    expect(isValidCoolStart(day, 2, '10:20')).toBe(false);
    expect(isValidCoolStart(day, 2, '10:21')).toBe(true);
    expect(isValidCoolStart(day, 2, '12:00')).toBe(false);
    expect(isValidCoolStart(day, 2, '12:01')).toBe(false);
  });

  it('does not allow a day end at or before any cool start', () => {
    const withFixedCool = { ...day, cools: day.cools.map((cool, index) => index === 2 ? { ...cool, startTime: '10:40' } : cool) };
    expect(isValidDayEnd(withFixedCool, '10:40')).toBe(false);
    expect(isValidDayEnd(withFixedCool, '10:41')).toBe(true);
    expect(isValidDayEnd(day, '10:15')).toBe(true);
  });
});
