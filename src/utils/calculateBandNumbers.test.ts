import { describe, it, expect } from 'vitest';
import { calculateBandNumbers, calculateEntryNumbers } from './calculateBandNumbers';
import type { Timetable, DailyTimetable } from '../types';

const makeTimetable = (dailyTimetables: DailyTimetable[]): Timetable => ({
  id: 'tt1',
  eventId: 'event1',
  type: 'performance',
  dailyTimetables,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('calculateBandNumbers', () => {
  it('nullの場合は空のMapを返す', () => {
    expect(calculateBandNumbers(null).size).toBe(0);
  });

  it('クール構造のバンドエントリーに連番を振る（カスタムイベントは無視）', () => {
    const timetable = makeTimetable([
      {
        date: '2026-06-10',
        startTime: '10:00',
        entries: [],
        cools: [
          {
            id: 'cool1',
            number: 1,
            entries: [
              { id: 'e1', type: 'band', bandId: 'b1', order: 0 },
              { id: 'e2', type: 'custom', order: 1 },
              { id: 'e3', type: 'band', bandId: 'b2', order: 2 },
            ],
          },
        ],
      },
    ]);

    const numbers = calculateBandNumbers(timetable);
    expect(numbers.get('e1')).toBe(1);
    expect(numbers.has('e2')).toBe(false);
    expect(numbers.get('e3')).toBe(2);
  });

  it('日付をまたいで連番を継続する', () => {
    const timetable = makeTimetable([
      {
        date: '2026-06-11',
        startTime: '10:00',
        cools: [],
        entries: [{ id: 'e2', type: 'band', bandId: 'b2', order: 0 }],
      },
      {
        date: '2026-06-10',
        startTime: '10:00',
        cools: [],
        entries: [{ id: 'e1', type: 'band', bandId: 'b1', order: 0 }],
      },
    ]);

    const numbers = calculateBandNumbers(timetable);
    // 日付昇順でソートされるため、06-10のe1が1、06-11のe2が2になる
    expect(numbers.get('e1')).toBe(1);
    expect(numbers.get('e2')).toBe(2);
  });
});

describe('calculateEntryNumbers', () => {
  it('nullの場合は空のMapを返す', () => {
    expect(calculateEntryNumbers(null).size).toBe(0);
  });

  it('日付ごとに1からリセットされ、バンド・カスタム両方に番号が付く', () => {
    const timetable = makeTimetable([
      {
        date: '2026-06-10',
        startTime: '10:00',
        cools: [],
        entries: [
          { id: 'e1', type: 'band', bandId: 'b1', order: 0 },
          { id: 'e2', type: 'custom', order: 1 },
        ],
      },
      {
        date: '2026-06-11',
        startTime: '10:00',
        cools: [],
        entries: [
          { id: 'e3', type: 'band', bandId: 'b2', order: 0 },
        ],
      },
    ]);

    const numbers = calculateEntryNumbers(timetable);
    expect(numbers.get('e1')).toBe(1);
    expect(numbers.get('e2')).toBe(2);
    expect(numbers.get('e3')).toBe(1);
  });

  it('dateを指定すると該当日のみ計算する', () => {
    const timetable = makeTimetable([
      {
        date: '2026-06-10',
        startTime: '10:00',
        cools: [],
        entries: [{ id: 'e1', type: 'band', bandId: 'b1', order: 0 }],
      },
      {
        date: '2026-06-11',
        startTime: '10:00',
        cools: [],
        entries: [{ id: 'e2', type: 'band', bandId: 'b2', order: 0 }],
      },
    ]);

    const numbers = calculateEntryNumbers(timetable, '2026-06-11');
    expect(numbers.has('e1')).toBe(false);
    expect(numbers.get('e2')).toBe(1);
  });
});
