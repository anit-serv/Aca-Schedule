import { expect, it } from 'vitest';
import type { DailyTimetable } from '../types';
import { canPlaceInCoolPreRehearsal, filterCoolPreRehearsalEntries } from './coolPreRehearsal';

const day = {
  date: '2026-11-15', startTime: '10:00', entries: [],
  cools: [
    { id: 'first', number: 1, entries: [{ id: 'a', type: 'band', bandId: 'A', order: 0 }] },
    { id: 'second', number: 2, entries: [{ id: 'b', type: 'band', bandId: 'B', order: 0 }] },
  ],
} as DailyTimetable;

it('allows a rehearsal band only in its performance cool', () => {
  expect(canPlaceInCoolPreRehearsal(day, 'A', 0)).toBe(true);
  expect(canPlaceInCoolPreRehearsal(day, 'A', 1)).toBe(false);
  expect(canPlaceInCoolPreRehearsal(day, 'B', 0)).toBe(false);
});

it('preserves rehearsal order and custom entries while removing bands absent from that cool', () => {
  const entries = [
    { id: 'custom', type: 'custom' as const, order: 0 },
    { id: 'wrong', type: 'band' as const, bandId: 'B', order: 1 },
    { id: 'valid', type: 'band' as const, bandId: 'A', order: 2 },
  ];
  expect(filterCoolPreRehearsalEntries(entries, day, 0).map(entry => entry.id)).toEqual(['custom', 'valid']);
});
