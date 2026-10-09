import type { TimeRange } from '../types';

export const timeToMinutes = (time: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (time === '24:00') return 1440;
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
};

export const minutesToTime = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const normalizeTimeRanges = (ranges: TimeRange[]): TimeRange[] => {
  const sorted = ranges
    .map(range => ({ start: timeToMinutes(range.startTime), end: timeToMinutes(range.endTime) }))
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end <= 1440 && range.start < range.end)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  sorted.forEach(range => {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  });
  return merged.map(range => ({ startTime: minutesToTime(range.start), endTime: minutesToTime(range.end) }));
};

export const changeTimeRange = (
  ranges: TimeRange[],
  start: number,
  end: number,
  mode: 'add' | 'remove',
): TimeRange[] => {
  if (start >= end) return ranges;
  if (mode === 'add') {
    return normalizeTimeRanges([...ranges, { startTime: minutesToTime(start), endTime: minutesToTime(end) }]);
  }
  return normalizeTimeRanges(ranges.flatMap(range => {
    const currentStart = timeToMinutes(range.startTime);
    const currentEnd = timeToMinutes(range.endTime);
    if (currentEnd <= start || currentStart >= end) return [range];
    const remaining: TimeRange[] = [];
    if (currentStart < start) remaining.push({ startTime: range.startTime, endTime: minutesToTime(start) });
    if (currentEnd > end) remaining.push({ startTime: minutesToTime(end), endTime: range.endTime });
    return remaining;
  }));
};

export const timeSlotCoverage = (ranges: TimeRange[], start: number, end: number): 'none' | 'partial' | 'full' => {
  const covered = timeSlotSegments(ranges, start, end).reduce((total, segment) => total + segment.widthPercent, 0);
  return covered === 0 ? 'none' : covered >= 100 ? 'full' : 'partial';
};

export const timeSlotSegments = (ranges: TimeRange[], start: number, end: number): Array<{ leftPercent: number; widthPercent: number }> => {
  if (end <= start) return [];
  return normalizeTimeRanges(ranges).flatMap(range => {
    const overlapStart = Math.max(start, timeToMinutes(range.startTime));
    const overlapEnd = Math.min(end, timeToMinutes(range.endTime));
    if (overlapEnd <= overlapStart) return [];
    return [{
      leftPercent: ((overlapStart - start) / (end - start)) * 100,
      widthPercent: ((overlapEnd - overlapStart) / (end - start)) * 100,
    }];
  });
};
