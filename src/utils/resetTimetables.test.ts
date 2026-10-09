import { describe, expect, it } from 'vitest';
import type { CustomFieldsSettings, Timetable } from '../types';
import { preparePerformanceReset, prepareRehearsalReset, prepareTimetablesReset } from './resetTimetables';

const timetable = (type: Timetable['type'], days: Timetable['dailyTimetables']): Timetable => ({
  id: type, eventId: 'event', type, dailyTimetables: days,
  createdAt: new Date(), updatedAt: new Date(),
});

describe('prepareRehearsalReset', () => {
  it('clears only rehearsal placements and row values', () => {
    const performance = timetable('performance', [{ date: '2026-10-02', startTime: '10:00', cools: [{ id: 'p', number: 1, entries: [{ id: 'p1', type: 'band', bandId: 'b', order: 0 }] }], entries: [] }]);
    const rehearsal = timetable('rehearsal', [{ date: '2026-10-01', startTime: '09:00', cools: [{ id: 'r', number: 1, entries: [{ id: 'r1', type: 'band', bandId: 'b', order: 0 }] }], entries: [] }]);
    const fields: CustomFieldsSettings = {
      performance: { columns: [], dailyData: { '2026-10-02': { bySequence: {}, byEntity: {} } } },
      rehearsal: { columns: [], dailyData: { '2026-10-01': { bySequence: {}, byEntity: {} } } },
    };
    const result = prepareRehearsalReset(performance, rehearsal, fields);
    expect(result.scope).toBe('rehearsal');
    expect(result.performanceDays).toEqual(performance.dailyTimetables);
    expect(result.rehearsalDays?.[0].cools[0].entries).toEqual([]);
    expect(result.customFields?.performance).toEqual(fields.performance);
    expect(result.customFields?.rehearsal.dailyData).toEqual({});
    expect(result.bandEntries).toBe(1);
  });
});

describe('preparePerformanceReset', () => {
  it('clears only performance placements and row values', () => {
    const performance = timetable('performance', [{ date: '2026-10-02', startTime: '10:00', cools: [{ id: 'p', number: 1, startTime: '11:00', entries: [
      { id: 'p1', type: 'band', bandId: 'b', order: 0 }, { id: 'event', type: 'custom', order: 1 },
    ] }], entries: [] }]);
    const fields: CustomFieldsSettings = {
      performance: { columns: [], dailyData: { '2026-10-02': { bySequence: {}, byEntity: {} } } },
      rehearsal: { columns: [], dailyData: { '2026-10-01': { bySequence: {}, byEntity: {} } } },
    };
    const result = preparePerformanceReset(performance, fields);
    expect(result.scope).toBe('performance');
    expect(result.performanceDays[0].cools[0]).toMatchObject({ id: 'p', startTime: '11:00', entries: [] });
    expect(result.rehearsalDays).toBeNull();
    expect(result.customFields?.performance.dailyData).toEqual({});
    expect(result.customFields?.rehearsal).toEqual(fields.rehearsal);
    expect(result).toMatchObject({ bandEntries: 1, customEntries: 1 });
  });
});

describe('prepareTimetablesReset', () => {
  it('clears both timetables and row values while retaining dates, starts, cools, and column definitions', () => {
    const performance = timetable('performance', [{
      date: '2026-10-02', startTime: '10:00',
      cools: [{ id: 'cool', number: 1, startTime: '11:00', entries: [
        { id: 'band', type: 'band', bandId: 'b', order: 0 },
        { id: 'custom', type: 'custom', order: 1 },
      ] }],
      entries: [{ id: 'legacy-copy', type: 'band', bandId: 'b', order: 0 }],
    }]);
    const rehearsal = timetable('rehearsal', [{
      date: '2026-10-01', startTime: '09:00', cools: [],
      entries: [{ id: 'rehearsal-band', type: 'band', bandId: 'b', order: 0 }],
    }]);
    const fields: CustomFieldsSettings = {
      performance: { columns: [{ id: 'memo', name: 'メモ', bindingType: 'entity', order: 0 }], dailyData: {
        '2026-10-02': { bySequence: {}, byEntity: { band: { memo: { value: 'test' } } } },
      } },
      rehearsal: { columns: [], dailyData: { '2026-10-01': { bySequence: {}, byEntity: {} } } },
    };

    const result = prepareTimetablesReset(performance, rehearsal, fields);

    expect(result).toMatchObject({ bandEntries: 2, customEntries: 1 });
    expect(result.performanceDays[0]).toMatchObject({ date: '2026-10-02', startTime: '10:00', entries: [], cools: [
      { id: 'cool', number: 1, startTime: '11:00', entries: [] },
    ] });
    expect(result.rehearsalDays?.[0]).toMatchObject({ date: '2026-10-01', startTime: '09:00', entries: [] });
    expect(result.customFields?.performance.columns).toEqual(fields.performance.columns);
    expect(result.customFields?.performance.dailyData).toEqual({});
    expect(result.customFields?.rehearsal.dailyData).toEqual({});
    expect(performance.dailyTimetables[0].cools[0].entries).toHaveLength(2);
  });
});
