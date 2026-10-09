import type { DailyTimetable, TimetableEntry } from '../types';

export const canPlaceInCoolPreRehearsal = (
  performanceDay: DailyTimetable | undefined,
  bandId: string,
  coolIndex: number,
): boolean => Boolean(performanceDay?.cools?.[coolIndex]?.entries.some(
  entry => entry.type === 'band' && entry.bandId === bandId,
));

export const filterCoolPreRehearsalEntries = (
  entries: TimetableEntry[],
  performanceDay: DailyTimetable,
  coolIndex: number,
): TimetableEntry[] => entries.filter(entry =>
  entry.type !== 'band' || Boolean(entry.bandId && canPlaceInCoolPreRehearsal(performanceDay, entry.bandId, coolIndex)),
);
