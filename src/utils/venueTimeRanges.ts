import type { DailyTimetable, TimeRange } from '../types';
import { normalizeTimeRanges, timeToMinutes } from './availabilityRanges';

export const venueTimeRanges = (day: DailyTimetable): TimeRange[] =>
  day.venueTimeRanges === undefined
    ? normalizeTimeRanges([{ startTime: day.startTime, endTime: day.endTime ?? '24:00' }])
    : normalizeTimeRanges(day.venueTimeRanges);

export const fitsVenueTime = (day: DailyTimetable, start: number, end: number): boolean =>
  venueTimeRanges(day).some(range => start >= timeToMinutes(range.startTime) && end <= timeToMinutes(range.endTime));

export const nextVenueStart = (day: DailyTimetable, from: number, duration: number): number | null => {
  for (const range of venueTimeRanges(day)) {
    const start = Math.max(from, timeToMinutes(range.startTime));
    if (start + duration <= timeToMinutes(range.endTime)) return start;
  }
  return null;
};
