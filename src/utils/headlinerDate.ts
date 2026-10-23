import type { Band } from '../types';

export const resolveHeadlinerDate = (band: Band, performanceDates: string[]): string | undefined => {
  const dates = [...performanceDates].sort();
  return band.toriTargetDate && dates.includes(band.toriTargetDate)
    ? band.toriTargetDate : dates.at(-1);
};
