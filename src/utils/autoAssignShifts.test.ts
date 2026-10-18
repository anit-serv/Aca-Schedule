import { describe, expect, it } from 'vitest';
import type { Band, CustomFieldsSettings, Timetable } from '../types';
import { autoAssignShifts } from './autoAssignShifts';
import { createEmptyCustomFieldsSettings } from './customFieldsUtils';

const date = '2026-11-15';
const timetable = (type: 'performance' | 'rehearsal', id: string, start = '10:00', end = '10:10', bandId?: string): Timetable => ({
  id: type, eventId: 'event', type, createdAt: new Date(), updatedAt: new Date(), dailyTimetables: [{
    date, startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, entries: [
      { id, type: bandId ? 'band' : 'custom', bandId, startTime: start, endTime: end, order: 0 },
    ] }],
  }],
});
const addShift = (settings: CustomFieldsSettings, type: 'performance' | 'rehearsal', id: string, candidates: string[], assignee?: string) => {
  settings[type].columns.push({ id, name: id, bindingType: 'sequence', order: settings[type].columns.length,
    shift: { candidates, split: { mode: 'per-cool', value: 1 }, slotsByDate: { [date]: { cool: [{ id: `${id}-slot`, size: 1, assignee }] } } } });
};
const assigned = (settings: CustomFieldsSettings, type: 'performance' | 'rehearsal', id: string) =>
  settings[type].columns.find(column => column.id === id)?.shift?.slotsByDate[date].cool[0].assignee;

describe('automatic shift assignment', () => {
  it('spreads assignment counts before avoiding consecutive slots', () => {
    const settings = createEmptyCustomFieldsSettings();
    settings.performance.columns.push({ id: 'staff', name: 'staff', bindingType: 'sequence', order: 0,
      shift: { candidates: ['A', 'B'], split: { mode: 'per-cool', value: 2 }, slotsByDate: { [date]: { cool: [
        { id: 'first-slot', size: 1 }, { id: 'second-slot', size: 1 },
      ] } } } });
    const schedule = timetable('performance', 'first');
    schedule.dailyTimetables[0].cools[0].entries.push({ id: 'second', type: 'custom', startTime: '10:10', endTime: '10:20', order: 1 });
    const result = autoAssignShifts(settings, { performance: schedule }, [], [{ type: 'performance', columnId: 'staff' }]);
    expect(result.settings.performance.columns[0].shift?.slotsByDate[date].cool.map(slot => slot.assignee).sort()).toEqual(['A', 'B']);
  });
  it('solves selected performance and rehearsal columns together without double booking', () => {
    const settings = createEmptyCustomFieldsSettings();
    addShift(settings, 'performance', 'stage', ['A', 'B']);
    addShift(settings, 'rehearsal', 'sound', ['A', 'B']);
    const result = autoAssignShifts(settings, { performance: timetable('performance', 'p'), rehearsal: timetable('rehearsal', 'r') }, [],
      [{ type: 'performance', columnId: 'stage' }, { type: 'rehearsal', columnId: 'sound' }]);
    expect(result.unassigned).toHaveLength(0);
    expect(assigned(result.settings, 'performance', 'stage')).toBeTruthy();
    expect(assigned(result.settings, 'performance', 'stage')).not.toBe(assigned(result.settings, 'rehearsal', 'sound'));
  });

  it('respects fixed assignments, performer conflicts, and candidate availability', () => {
    const settings = createEmptyCustomFieldsSettings();
    addShift(settings, 'performance', 'fixed', ['A'], 'A');
    addShift(settings, 'performance', 'target', ['A', 'B', 'C']);
    settings.shiftAvailability = { B: [{ date, timeRanges: [{ startTime: '11:00', endTime: '12:00' }] }] };
    const result = autoAssignShifts(settings, { performance: timetable('performance', 'p', '10:00', '10:10', 'band') },
      [{ id: 'band', members: ['C'] } as Band], [{ type: 'performance', columnId: 'target' }]);
    expect(result.unassigned).toHaveLength(1);
    expect(assigned(result.settings, 'performance', 'fixed')).toBe('A');
    expect(assigned(result.settings, 'performance', 'target')).toBeUndefined();
  });

  it('keeps existing assignees by default and clears them if rebuilding cannot reassign', () => {
    const settings = createEmptyCustomFieldsSettings();
    addShift(settings, 'performance', 'target', ['A'], 'A');
    settings.shiftAvailability = { A: [] };
    const selected = [{ type: 'performance' as const, columnId: 'target' }];
    const source = { performance: timetable('performance', 'p') };
    expect(assigned(autoAssignShifts(settings, source, [], selected).settings, 'performance', 'target')).toBe('A');
    const rebuilt = autoAssignShifts(settings, source, [], selected, true);
    expect(rebuilt.unassigned).toHaveLength(1);
    expect(assigned(rebuilt.settings, 'performance', 'target')).toBeUndefined();
  });
});
