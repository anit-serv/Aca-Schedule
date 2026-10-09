import type { CustomFieldsSettings, DailyTimetable, Timetable, TimetableEntry } from '../types';

export interface ResetTimetablesPlan {
  scope: 'both' | 'performance' | 'rehearsal';
  performanceDays: DailyTimetable[];
  rehearsalDays: DailyTimetable[] | null;
  customFields?: CustomFieldsSettings;
  bandEntries: number;
  customEntries: number;
}

const activeEntries = (day: DailyTimetable): TimetableEntry[] =>
  day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries;

const emptyDays = (timetable: Timetable): DailyTimetable[] => timetable.dailyTimetables.map(day => ({
  ...day,
  cools: day.cools?.map(cool => ({ ...cool, entries: [] })) ?? [],
  entries: [],
}));

/** Remove every placement while keeping dates, cools, and configured start times. */
export const prepareTimetablesReset = (
  performance: Timetable,
  rehearsal: Timetable | null,
  customFields?: CustomFieldsSettings,
): ResetTimetablesPlan => {
  const entries = [performance, rehearsal]
    .filter((timetable): timetable is Timetable => timetable !== null)
    .flatMap(timetable => timetable.dailyTimetables.flatMap(activeEntries));

  return {
    scope: 'both',
    performanceDays: emptyDays(performance),
    rehearsalDays: rehearsal ? emptyDays(rehearsal) : null,
    customFields: customFields ? {
      performance: { ...customFields.performance, dailyData: {} },
      rehearsal: { ...customFields.rehearsal, dailyData: {} },
    } : undefined,
    bandEntries: entries.filter(entry => entry.type === 'band').length,
    customEntries: entries.filter(entry => entry.type === 'custom').length,
  };
};

/** Clear rehearsal placements and row values while preserving the performance timetable. */
export const prepareRehearsalReset = (
  performance: Timetable,
  rehearsal: Timetable,
  customFields?: CustomFieldsSettings,
): ResetTimetablesPlan => {
  const entries = rehearsal.dailyTimetables.flatMap(activeEntries);
  return {
    scope: 'rehearsal',
    performanceDays: performance.dailyTimetables,
    rehearsalDays: emptyDays(rehearsal),
    customFields: customFields ? {
      performance: customFields.performance,
      rehearsal: { ...customFields.rehearsal, dailyData: {} },
    } : undefined,
    bandEntries: entries.filter(entry => entry.type === 'band').length,
    customEntries: entries.filter(entry => entry.type === 'custom').length,
  };
};

/** Clear performance placements and row values while preserving an independent rehearsal timetable. */
export const preparePerformanceReset = (
  performance: Timetable,
  customFields?: CustomFieldsSettings,
): ResetTimetablesPlan => {
  const entries = performance.dailyTimetables.flatMap(activeEntries);
  return {
    scope: 'performance',
    performanceDays: emptyDays(performance),
    rehearsalDays: null,
    customFields: customFields ? {
      performance: { ...customFields.performance, dailyData: {} },
      rehearsal: customFields.rehearsal,
    } : undefined,
    bandEntries: entries.filter(entry => entry.type === 'band').length,
    customEntries: entries.filter(entry => entry.type === 'custom').length,
  };
};
