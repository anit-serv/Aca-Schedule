import { describe, expect, it } from 'vitest';
import { createEmptyCustomFieldsSettings, mergeCells, setCellValue } from './customFieldsUtils';
import { applyCustomFieldsChanges, getCustomFieldsChanges, isCustomFieldsChangeConflicted } from './customFieldsUndoUtils';
import type { Timetable } from '../types';

const makeTimetable = (date: string): Timetable => ({
  id: 'timetable', eventId: 'event', type: 'performance', createdAt: new Date(), updatedAt: new Date(),
  dailyTimetables: [{
    date, startTime: '10:00', entries: [],
    cools: [{ id: 'cool-1', number: 1, entries: [1, 2, 3].map(order => ({ id: `e${order}`, type: 'band', order })) }],
  }],
});

describe('custom field undo changes', () => {
  it('restores candidate availability without discarding column data', () => {
    const before = createEmptyCustomFieldsSettings();
    const after = structuredClone(before);
    after.shiftAvailability = { 山田: [{ date: '2026-11-15', timeRanges: [{ startTime: '10:00', endTime: '12:00' }] }] };
    const changes = getCustomFieldsChanges(before, after);
    const undone = applyCustomFieldsChanges(after, changes, 'undo');
    expect(undone.shiftAvailability).toBeUndefined();
    expect(applyCustomFieldsChanges(undone, changes, 'redo').shiftAvailability).toEqual(after.shiftAvailability);
  });
  it('keeps an unrelated cell edit when undoing a merge', () => {
    const date = '2026-10-02';
    const before = createEmptyCustomFieldsSettings();
    before.performance.columns = [{ id: 'notes', name: 'メモ', bindingType: 'sequence', order: 0 }];
    const after = mergeCells(before, 'performance', date, 'notes', 1, 2, makeTimetable(date)).settings;
    const changes = getCustomFieldsChanges(before, after);
    const withOwnLaterEdit = setCellValue(after, 'performance', date, before.performance.columns[0], 3, '後から入力');

    expect(isCustomFieldsChangeConflicted(withOwnLaterEdit, changes, 'undo')).toBe(false);
    const undone = applyCustomFieldsChanges(withOwnLaterEdit, changes, 'undo');
    expect(undone.performance.dailyData[date].bySequence[3].notes.value).toBe('後から入力');
    expect(undone.performance.dailyData[date].bySequence[1]?.notes).toBeUndefined();
    expect(isCustomFieldsChangeConflicted(undone, changes, 'redo')).toBe(false);
  });

  it('detects a change to a merged cell itself', () => {
    const date = '2026-10-02';
    const before = createEmptyCustomFieldsSettings();
    before.performance.columns = [{ id: 'notes', name: 'メモ', bindingType: 'sequence', order: 0 }];
    const after = mergeCells(before, 'performance', date, 'notes', 1, 2, makeTimetable(date)).settings;
    const changedMergedCell = setCellValue(after, 'performance', date, before.performance.columns[0], 1, '変更');
    expect(isCustomFieldsChangeConflicted(changedMergedCell, getCustomFieldsChanges(before, after), 'undo')).toBe(true);
  });
});
