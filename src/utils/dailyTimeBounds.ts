import type { DailyTimetable } from '../types';

export const timeMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** The inherited start of a cool is the previous cool's final entry, or its own inherited start. */
export const effectiveCoolStart = (day: DailyTimetable, coolIndex: number): string => {
  let cursor = day.startTime;
  for (let index = 0; index <= coolIndex && index < day.cools.length; index++) {
    const cool = day.cools[index];
    if (cool.startTime) cursor = cool.startTime;
    if (index === coolIndex) return cursor;
    cursor = cool.entries.at(-1)?.endTime || cursor;
  }
  return cursor;
};

export const isValidCoolStart = (day: DailyTimetable, coolIndex: number, value: string): boolean =>
  timeMinutes(value) >= timeMinutes(day.startTime)
  && (!day.endTime || timeMinutes(value) < timeMinutes(day.endTime))
  && (coolIndex === 0 || timeMinutes(value) > timeMinutes(effectiveCoolStart(day, coolIndex - 1)));

export const isValidDayEnd = (day: DailyTimetable, value: string): boolean =>
  timeMinutes(value) > timeMinutes(day.startTime)
  && day.cools.every(cool => !cool.startTime || timeMinutes(value) > timeMinutes(cool.startTime));
