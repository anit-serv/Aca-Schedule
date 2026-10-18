import type { DailyTimetable } from '../types';

export const DEFAULT_MINIMUM_COOL_BREAK_MINUTES = 10;

export const minimumCoolBreakMinutes = (day: Pick<DailyTimetable, 'minimumCoolBreakMinutes'>): number =>
  Number.isInteger(day.minimumCoolBreakMinutes) && day.minimumCoolBreakMinutes! >= 0
    ? day.minimumCoolBreakMinutes!
    : DEFAULT_MINIMUM_COOL_BREAK_MINUTES;

export const timeInMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const minutesAsTime = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
