type TimetableCandidate<T> = { data: T };
type StoredTimetable = {
  dailyTimetables?: Array<{ cools?: Array<{ entries?: unknown[] }>; entries?: unknown[] }>;
  updatedAt?: { toMillis?: () => number };
};

const rank = (data: StoredTimetable): [number, number, number] => {
  const days = data.dailyTimetables ?? [];
  const entries = days.reduce((total, day) => total + (
    day.cools?.length
      ? day.cools.reduce((count, cool) => count + (cool.entries?.length ?? 0), 0)
      : day.entries?.length ?? 0
  ), 0);
  return [days.length, entries, data.updatedAt?.toMillis?.() ?? 0];
};

/** Prefer the timetable containing all dates and placements when legacy duplicates exist. */
export const selectBestTimetable = <T extends TimetableCandidate<StoredTimetable>>(items: T[]): T | null => {
  if (!items.length) return null;
  return items.reduce((best, candidate) => {
    const current = rank(candidate.data);
    const previous = rank(best.data);
    for (let index = 0; index < current.length; index++) {
      if (current[index] !== previous[index]) return current[index] > previous[index] ? candidate : best;
    }
    return best;
  });
};
