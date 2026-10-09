import { describe, expect, it } from 'vitest';
import { editShiftSlots, fitShiftSlots, getCustomShiftIssues, getOverlappingShiftAssignees, getShiftSlotAt, makeShiftSlots, uniquePeople } from './customShift';
import type { Band, Timetable } from '../types';
import { addColumn, createEmptyCustomFieldsSettings, normalizeShiftPositionBindings, setCellValue, setColumnShared, setColumnShift, synchronizeSharedColumnShifts, updateShiftSlot } from './customFieldsUtils';

describe('custom shift slots', () => {
  it('forces position binding when shift mode starts and keeps existing entity cell values', () => {
    let settings = addColumn(undefined, 'performance', { id: 'staff', name: '担当', bindingType: 'entity' });
    const timetable = { id: 't', eventId: 'e', type: 'performance', createdAt: new Date(), updatedAt: new Date(), dailyTimetables: [{
      date: 'date', startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, entries: [
        { id: 'first', type: 'custom', order: 0 }, { id: 'second', type: 'custom', order: 1 },
      ] }],
    }] } as Timetable;
    settings = setCellValue(settings, 'performance', 'date', settings.performance.columns[0], 'second', '入力済み');
    settings = setColumnShift(settings, 'performance', 'staff', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {},
    }, null, timetable);
    expect(settings.performance.columns[0].bindingType).toBe('sequence');
    expect(settings.performance.dailyData.date.bySequence[2].staff.value).toBe('入力済み');
    expect(settings.performance.dailyData.date.byEntity.second).toBeUndefined();
  });

  it('normalizes an older shift column stored as entry-following', () => {
    const settings = addColumn(undefined, 'performance', { id: 'staff', name: '担当', bindingType: 'entity' });
    settings.performance.columns[0].shift = { candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {} };
    const normalized = normalizeShiftPositionBindings(settings);
    expect(normalized.performance.columns[0].bindingType).toBe('sequence');
    expect(normalizeShiftPositionBindings(normalized)).toBe(normalized);
  });

  it('forces both sides of a shared shift column to position binding', () => {
    let settings = addColumn(undefined, 'performance', { id: 'p', name: '担当', bindingType: 'entity' });
    settings = addColumn(settings, 'rehearsal', { id: 'r', name: '担当', bindingType: 'entity' });
    settings = setColumnShared(settings, 'performance', 'p', true, 'r');
    settings = setColumnShift(settings, 'performance', 'p', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: {},
    });
    expect(settings.performance.columns[0].bindingType).toBe('sequence');
    expect(settings.rehearsal.columns[0].bindingType).toBe('sequence');
  });
  it('lists performer and overlapping shift conflicts across all dates', () => {
    let fields = createEmptyCustomFieldsSettings();
    fields = addColumn(fields, 'performance', { id: 'a', name: '受付', bindingType: 'sequence' });
    fields = addColumn(fields, 'performance', { id: 'b', name: '音響', bindingType: 'sequence' });
    fields = setColumnShift(fields, 'performance', 'a', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: { date: { cool: [{ id: 'a1', size: 2, assignee: '山田' }] } },
    });
    fields = setColumnShift(fields, 'performance', 'b', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: { date: { cool: [{ id: 'b1', size: 1, assignee: '山田' }, { id: 'b2', size: 1 }] } },
    });
    const timetable = { id: 'timetable', eventId: 'event', createdAt: new Date(), updatedAt: new Date(), type: 'performance', dailyTimetables: [{ date: 'date', startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, entries: [
      { id: 'entry1', type: 'band', bandId: 'band', order: 0 }, { id: 'entry2', type: 'custom', order: 1 },
    ] }] }] } as Timetable;
    const issues = getCustomShiftIssues(timetable, null, fields, [{ id: 'band', members: ['山田'] } as Band]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ type: 'shift-conflict', severity: 'high', shiftSlotId: 'a1' });
    expect(issues[0].message).toContain('出演メンバー・他列のシフト担当');
    expect(issues[1].shiftSlotId).toBe('b1');
  });
  it('distributes remainders across per-cool slots and caps at the row count', () => {
    expect(makeShiftSlots(8, { mode: 'per-cool', value: 3 }).map(slot => slot.size)).toEqual([3, 3, 2]);
    expect(makeShiftSlots(2, { mode: 'per-cool', value: 5 }).map(slot => slot.size)).toEqual([1, 1]);
  });

  it('puts a partial group in the final per-entries slot', () => {
    expect(makeShiftSlots(8, { mode: 'per-entries', value: 3 }).map(slot => slot.size)).toEqual([3, 3, 2]);
  });

  it('preserves position boundaries and enforces one row per slot', () => {
    const slots = makeShiftSlots(5, { mode: 'per-cool', value: 2 });
    expect(slots.map(slot => slot.size)).toEqual([3, 2]);
    const moved = editShiftSlots(slots, { type: 'boundary-up', index: 0 });
    expect(moved.map(slot => slot.size)).toEqual([2, 3]);
    expect(editShiftSlots(moved, { type: 'boundary-move', index: 0, delta: 2 }).map(slot => slot.size)).toEqual([4, 1]);
    expect(editShiftSlots(moved, { type: 'boundary-move', index: 0, delta: -1 }).map(slot => slot.size)).toEqual([1, 4]);
    expect(editShiftSlots(moved, { type: 'boundary-move', index: 0, delta: 3 })).toBe(moved);
    expect(getShiftSlotAt(moved, 2)?.slotIndex).toBe(1);
    const split = editShiftSlots(moved, { type: 'add', index: 1 });
    expect(split.map(slot => slot.size)).toEqual([2, 2, 1]);
    expect(editShiftSlots(split, { type: 'add', index: 2 })).toBe(split);
    expect(editShiftSlots(split, { type: 'delete', index: 1 }).map(slot => slot.size)).toEqual([4, 1]);
  });

  it('absorbs empty trailing slots after rows are removed', () => {
    const slots = makeShiftSlots(6, { mode: 'per-cool', value: 3 });
    expect(fitShiftSlots(slots, 3).map(slot => slot.size)).toEqual([2, 1]);
    expect(fitShiftSlots(slots, 1).map(slot => slot.size)).toEqual([1]);
  });

  it('normalizes and deduplicates candidate names', () => {
    expect(uniquePeople([' 山田 ', '山田', '佐藤', ''])).toEqual(['山田', '佐藤']);
  });

  it('shares candidates while preserving separate performance and rehearsal slots', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'performance-col', name: '音響', bindingType: 'sequence' });
    settings = addColumn(settings, 'rehearsal', { id: 'rehearsal-col', name: '音響', bindingType: 'sequence' });
    settings = setColumnShift(settings, 'performance', 'performance-col', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 1 }, slotsByDate: { '2026-11-01': { a: [{ id: 'a', size: 2, assignee: '山田' }] } },
    });
    settings = setColumnShift(settings, 'rehearsal', 'rehearsal-col', {
      candidates: ['佐藤'], split: { mode: 'per-cool', value: 1 }, slotsByDate: { '2026-11-02': { b: [{ id: 'b', size: 3, assignee: '佐藤' }] } },
    });
    settings = setColumnShared(settings, 'performance', 'performance-col', true, 'rehearsal-col');
    expect(settings.performance.columns[0].shift?.candidates).toEqual(['山田', '佐藤']);
    expect(settings.rehearsal.columns[0].shift?.candidates).toEqual(['山田', '佐藤']);
    settings = setColumnShift(settings, 'performance', 'performance-col', {
      ...settings.performance.columns[0].shift!, candidates: ['山田'],
    });
    expect(settings.rehearsal.columns[0].shift?.candidates).toEqual(['山田']);
    expect(settings.rehearsal.columns[0].shift?.slotsByDate['2026-11-02'].b[0].assignee).toBeUndefined();
    expect(settings.performance.columns[0].shift?.slotsByDate['2026-11-01'].a[0].assignee).toBe('山田');
    settings = setColumnShared(settings, 'performance', 'performance-col', false);
    expect(settings.rehearsal.columns[0].shift?.slotsByDate['2026-11-02'].b[0].size).toBe(3);
  });

  it('turns on shift mode on both sides of a shared column and keeps assignments independent', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'p', name: '受付', bindingType: 'sequence' });
    settings = addColumn(settings, 'rehearsal', { id: 'r', name: '受付', bindingType: 'sequence' });
    settings = setColumnShared(settings, 'performance', 'p', true, 'r');
    const rehearsal = { type: 'rehearsal', dailyTimetables: [{ date: 'date', startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, entries: [
      { id: 'one', type: 'band', order: 0 }, { id: 'two', type: 'custom', order: 1 },
    ] }] }] } as unknown as Timetable;
    settings = setColumnShift(settings, 'performance', 'p', {
      candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 1 },
      slotsByDate: { date: { cool: [{ id: 'p-slot', size: 2, assignee: '山田' }] } },
    }, rehearsal);
    expect(settings.rehearsal.columns[0].shift).toMatchObject({
      candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 1 },
    });
    expect(settings.rehearsal.columns[0].shift?.slotsByDate.date.cool).toHaveLength(1);
    settings = updateShiftSlot(settings, 'rehearsal', 'r', 'date', 'cool', 2, { type: 'assign', index: 0, assignee: '佐藤' });
    expect(settings.performance.columns[0].shift?.slotsByDate.date.cool[0].assignee).toBe('山田');
    expect(settings.rehearsal.columns[0].shift?.slotsByDate.date.cool[0].assignee).toBe('佐藤');

    settings = setColumnShift(settings, 'rehearsal', 'r', {
      ...settings.rehearsal.columns[0].shift!, candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 2 },
      slotsByDate: { date: { cool: [{ id: 'r-first', size: 1 }, { id: 'r-second', size: 1 }] } },
    }, { ...rehearsal, type: 'performance' });
    expect(settings.performance.columns[0].shift?.split.value).toBe(2);
    expect(settings.performance.columns[0].shift?.slotsByDate.date.cool).toHaveLength(2);
    expect(settings.performance.columns[0].shift?.slotsByDate.date.cool.every(slot => !slot.assignee)).toBe(true);
    settings = setColumnShift(settings, 'rehearsal', 'r');
    expect(settings.performance.columns[0].shift).toBeUndefined();
    expect(settings.rehearsal.columns[0].shift).toBeUndefined();
  });

  it('repairs existing shared columns with shift mode on only one side', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'p', name: '受付', bindingType: 'sequence' });
    settings = addColumn(settings, 'rehearsal', { id: 'r', name: '受付', bindingType: 'sequence' });
    settings = setColumnShared(settings, 'performance', 'p', true, 'r');
    settings.performance.columns[0].shift = {
      candidates: ['山田'], split: { mode: 'per-entries', value: 3 }, slotsByDate: {},
    };
    const synchronized = synchronizeSharedColumnShifts(settings);
    expect(synchronized.rehearsal.columns[0].shift).toMatchObject({
      candidates: ['山田'], split: { mode: 'per-entries', value: 3 },
    });
    expect(synchronizeSharedColumnShifts(synchronized)).toBe(synchronized);
  });

  it('excludes a person assigned in another column when slots overlap even partly', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'a', name: '受付', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'b', name: '音響', bindingType: 'sequence' });
    settings = setColumnShift(settings, 'performance', 'a', {
      candidates: ['山田', '佐藤'], split: { mode: 'per-cool', value: 2 }, slotsByDate: { date: { cool: [
        { id: 'a1', size: 2 }, { id: 'a2', size: 2 },
      ] } },
    });
    settings = setColumnShift(settings, 'performance', 'b', {
      candidates: ['山田'], split: { mode: 'per-cool', value: 2 }, slotsByDate: { date: { cool: [
        { id: 'b1', size: 3, assignee: '山田' }, { id: 'b2', size: 1 },
      ] } },
    });
    const columns = settings.performance.columns;
    expect(getOverlappingShiftAssignees(columns, 'a', 'date', 'cool', 4, 0, 2)).toEqual(['山田']);
    expect(getOverlappingShiftAssignees(columns, 'a', 'date', 'cool', 4, 2, 2)).toEqual(['山田']);
    expect(getOverlappingShiftAssignees(columns, 'a', 'date', 'cool', 4, 3, 1)).toEqual([]);
    expect(getOverlappingShiftAssignees(columns, 'a', 'date', 'other-cool', 4, 0, 2)).toEqual([]);
    expect(getOverlappingShiftAssignees(columns, 'a', 'other-date', 'cool', 4, 0, 2)).toEqual([]);
    expect(updateShiftSlot(settings, 'performance', 'a', 'date', 'cool', 4, { type: 'assign', index: 1, assignee: '山田' })).toBe(settings);
    const assigned = updateShiftSlot(settings, 'performance', 'a', 'date', 'cool', 4, { type: 'assign', index: 1, assignee: '佐藤' });
    expect(assigned.performance.columns[0].shift?.slotsByDate.date.cool[1].assignee).toBe('佐藤');
  });
});
