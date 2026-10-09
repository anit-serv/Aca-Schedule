import { describe, expect, it } from 'vitest';
import { changeTimeRange, normalizeTimeRanges, timeSlotCoverage, timeSlotSegments, timeToMinutes } from './availabilityRanges';

describe('minute-precision availability ranges', () => {
  it('preserves precise edges when a distant 15-minute cell is changed', () => {
    const initial = [{ startTime: '10:07', endTime: '11:03' }];
    expect(changeTimeRange(initial, 12 * 60, 12 * 60 + 15, 'add')).toEqual([
      ...initial,
      { startTime: '12:00', endTime: '12:15' },
    ]);
    expect(timeSlotCoverage(initial, 10 * 60, 10 * 60 + 15)).toBe('partial');
  });

  it('splits a precise range when a selected 15-minute cell is removed', () => {
    expect(changeTimeRange([{ startTime: '10:07', endTime: '11:03' }], 10 * 60 + 30, 10 * 60 + 45, 'remove')).toEqual([
      { startTime: '10:07', endTime: '10:30' },
      { startTime: '10:45', endTime: '11:03' },
    ]);
  });

  it('merges adjacent ranges and accepts 24:00 only as an end', () => {
    expect(normalizeTimeRanges([
      { startTime: '10:07', endTime: '10:15' },
      { startTime: '10:15', endTime: '10:32' },
    ])).toEqual([{ startTime: '10:07', endTime: '10:32' }]);
    expect(timeToMinutes('24:00')).toBe(1440);
  });

  it('places minute-level color at the matching position inside a quarter-hour cell', () => {
    const fromStart = timeSlotSegments([{ startTime: '10:00', endTime: '10:05' }], 600, 615)[0];
    expect(fromStart.leftPercent).toBe(0);
    expect(fromStart.widthPercent).toBeCloseTo(100 / 3);
    const fromMiddle = timeSlotSegments([{ startTime: '10:05', endTime: '10:10' }], 600, 615)[0];
    expect(fromMiddle.leftPercent).toBeCloseTo(100 / 3);
    expect(fromMiddle.widthPercent).toBeCloseTo(100 / 3);
  });
});
