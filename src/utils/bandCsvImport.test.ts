import { describe, expect, it } from 'vitest';
import type { EventSettings } from '../types';
import { parseBandCsvRows } from './bandCsvImport';

const settings = {
  rehearsalType: 'rehearsal-day',
  rehearsalDates: ['2025-11-14'],
  performanceDates: ['2025-11-15', '2025-11-16'],
} as EventSettings;
const header = ['any', 'headers', 'are', 'accepted', 'here', 'a', 'b', 'c'];
const validRow = [
  'バンド', '5', '2', 'FALSE', '甲;乙',
  '9:00-10:00&type=buffer;10:00-11:00&type=normal',
  '12:00-13:00', '',
];

describe('band CSV import', () => {
  it('uses positional columns and separates normal and buffer ranges', () => {
    const [band] = parseBandCsvRows([header, validRow], settings);
    expect(band.costume).toBe(false);
    expect(band.members).toEqual(['甲', '乙']);
    expect(band.availableTimeSlots).toEqual([
      { date: '2025-11-14', timeRanges: [{ startTime: '10:00', endTime: '11:00' }] },
      { date: '2025-11-15', timeRanges: [{ startTime: '12:00', endTime: '13:00' }] },
    ]);
    expect(band.backupRehearsalTimeSlots).toEqual([
      { date: '2025-11-14', timeRanges: [{ startTime: '09:00', endTime: '10:00' }] },
    ]);
    expect(parseBandCsvRows([header, [...validRow.slice(0, 3), 'TrUe', ...validRow.slice(4)]], settings)[0].costume).toBe(true);
  });

  it.each([
    { change: (row: string[]) => { row[1] = '5分'; }, message: '出演時間' },
    { change: (row: string[]) => { row[2] = '2.5'; }, message: '出演回数' },
    { change: (row: string[]) => { row[3] = 'yes'; }, message: '衣装' },
    { change: (row: string[]) => { row[5] = '(紫)9:00-10:00'; }, message: '時間帯' },
    { change: (row: string[]) => { row[5] = '9:00-10:00&type=other'; }, message: '時間帯' },
    { change: (row: string[]) => { row[5] = '9:00-10:00;9:30-10:30&type=buffer'; }, message: '重複' },
    { change: (row: string[]) => { row[5] = '25:00-26:00'; }, message: '時刻' },
    { change: (row: string[]) => { row[6] = '12:00-13:00&type=buffer'; }, message: '本番日の予備時間' },
  ])('rejects malformed row data: $message', ({ change, message }) => {
    const row = [...validRow];
    change(row);
    expect(() => parseBandCsvRows([header, row], settings)).toThrow(message);
  });

  it('validates all rows before any can be saved', () => {
    const row = [...validRow];
    row[3] = '';
    expect(() => parseBandCsvRows([header, validRow, row], settings)).toThrow('3行目');
  });
});
