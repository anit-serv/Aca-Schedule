import { expect, it } from 'vitest';
import type { Band, TimetableEntry } from '../types';
import { checkBandAvailability, findConsecutiveMemberRuns } from './scheduleChecks';

const band = (id: string, members: string[] = []): Band => ({
  id, name: id, performanceDuration: 10, performanceCount: 1,
  toriPriority: 1, costume: false, bandMaster: '', members,
  availableTimeSlots: [{ date: '2026-10-02', timeRanges: [
    { startTime: '10:00', endTime: '10:15' }, { startTime: '10:15', endTime: '10:30' },
  ] }],
  backupRehearsalTimeSlots: [{ date: '2026-10-02', timeRanges: [
    { startTime: '10:30', endTime: '10:45' },
  ] }],
  createdAt: new Date(), updatedAt: new Date(),
});

it('classifies normal, rehearsal backup, and unavailable time consistently', () => {
  const item = band('a');
  expect(checkBandAvailability(item, '2026-10-02', '10:10', '10:25')).toBe('normal');
  expect(checkBandAvailability(item, '2026-10-02', '10:25', '10:40')).toBe('outside');
  expect(checkBandAvailability(item, '2026-10-02', '10:25', '10:40', true)).toBe('backup');
  expect(checkBandAvailability(item, '2026-10-02', '10:40', '10:50', true)).toBe('outside');
});

it('finds shared-member runs within a cool and stops at cool boundaries', () => {
  const bands = [band('a', ['m']), band('b', ['m']), band('c', ['m'])];
  const bandMap = new Map(bands.map(item => [item.id, item]));
  const entries = bands.map((item, index) => ({
    entry: { id: item.id, type: 'band', bandId: item.id, order: index } as TimetableEntry,
    coolId: index < 2 ? 'first' : 'second',
  }));
  expect(findConsecutiveMemberRuns(entries, bandMap)).toEqual([
    { entries: entries.slice(0, 2), members: ['m'] },
  ]);
});
