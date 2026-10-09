import { describe, expect, it } from 'vitest';
import { selectBestTimetable } from './timetableSelection';

describe('selectBestTimetable', () => {
  it('selects the populated timetable when a duplicate has the same dates', () => {
    const empty = { id: 'empty', data: { dailyTimetables: [{ date: '2026-10-02', startTime: '10:00', cools: [], entries: [] }] } };
    const populated = { id: 'populated', data: { dailyTimetables: [{ date: '2026-10-02', startTime: '10:00', cools: [{ id: 'c', number: 1, entries: [{ id: 'e', type: 'band', order: 0 }] }], entries: [] }] } };
    expect(selectBestTimetable([empty, populated])?.id).toBe('populated');
    expect(selectBestTimetable([populated, empty])?.id).toBe('populated');
  });

  it('selects the timetable with all dates first', () => {
    const oneDay = { id: 'one', data: { dailyTimetables: [{ date: '2026-10-02', startTime: '10:00', cools: [], entries: [{ id: 'e', type: 'band', order: 0 }] }] } };
    const twoDays = { id: 'two', data: { dailyTimetables: [
      { date: '2026-10-02', startTime: '10:00', cools: [], entries: [] },
      { date: '2026-10-03', startTime: '10:00', cools: [], entries: [] },
    ] } };
    expect(selectBestTimetable([oneDay, twoDays])?.id).toBe('two');
  });
});
