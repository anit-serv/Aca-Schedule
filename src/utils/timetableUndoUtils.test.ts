import { describe, it, expect } from 'vitest';
import { getAllEntries, detectTimetableOperation, isTimetableConflicted } from './timetableUndoUtils';
import type { DailyTimetable, Cool, TimetableEntry } from '../types';

const entry = (id: string, overrides: Partial<TimetableEntry> = {}): TimetableEntry => ({
  id,
  type: 'band',
  bandId: id,
  order: 0,
  ...overrides,
});

const cool = (id: string, entries: TimetableEntry[], overrides: Partial<Cool> = {}): Cool => ({
  id,
  number: 1,
  entries,
  ...overrides,
});

const dt = (cools: Cool[], entries: TimetableEntry[] = []): DailyTimetable => ({
  date: '2026-06-10',
  startTime: '10:00',
  cools,
  entries,
});

describe('getAllEntries', () => {
  it('クール構造からエントリーをフラット化する', () => {
    const result = getAllEntries(dt([cool('c1', [entry('e1'), entry('e2')]), cool('c2', [entry('e3')])]));
    expect(result).toEqual([
      { id: 'e1', coolId: 'c1', index: 0 },
      { id: 'e2', coolId: 'c1', index: 1 },
      { id: 'e3', coolId: 'c2', index: 0 },
    ]);
  });

  it('クールがない場合はentriesから取得する', () => {
    const result = getAllEntries(dt([], [entry('e1'), entry('e2')]));
    expect(result).toEqual([
      { id: 'e1', coolId: null, index: 0 },
      { id: 'e2', coolId: null, index: 1 },
    ]);
  });
});

describe('detectTimetableOperation', () => {
  it('beforeがundefinedの場合はnullを返す', () => {
    expect(detectTimetableOperation(undefined, dt([]))).toBeNull();
  });

  it('クール追加を検出する', () => {
    const before = dt([cool('c1', [])]);
    const after = dt([cool('c1', []), cool('c2', [])]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'c2', opType: 'cool:add' });
  });

  it('クール削除を検出する', () => {
    const before = dt([cool('c1', []), cool('c2', [])]);
    const after = dt([cool('c1', [])]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'c2', opType: 'cool:delete' });
  });

  it('エントリー追加を検出する', () => {
    const before = dt([cool('c1', [entry('e1')])]);
    const after = dt([cool('c1', [entry('e1'), entry('e2')])]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'e2', opType: 'entry:add' });
  });

  it('エントリー削除を検出する', () => {
    const before = dt([cool('c1', [entry('e1'), entry('e2')])]);
    const after = dt([cool('c1', [entry('e1')])]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'e2', opType: 'entry:delete' });
  });

  it('エントリーの並び替え/移動を検出する', () => {
    const before = dt([cool('c1', [entry('e1'), entry('e2')]), cool('c2', [])]);
    const after = dt([cool('c1', [entry('e1')]), cool('c2', [entry('e2')])]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'e2', opType: 'entry:reorder' });
  });

  it('クール開始時刻の変更を検出する', () => {
    const before = dt([cool('c1', [], { startTime: '10:00' })]);
    const after = dt([cool('c1', [], { startTime: '11:00' })]);
    expect(detectTimetableOperation(before, after)).toEqual({ targetId: 'c1', opType: 'cool:startTime' });
  });

  it('差分がない場合はnullを返す', () => {
    const before = dt([cool('c1', [entry('e1')])]);
    const after = dt([cool('c1', [entry('e1')])]);
    expect(detectTimetableOperation(before, after)).toBeNull();
  });
});

describe('isTimetableConflicted', () => {
  const afterDt = dt([cool('c1', [entry('e1'), entry('e2')])]);

  it('currentDtがundefinedの場合は競合とみなす', () => {
    expect(isTimetableConflicted(undefined, 'e1', 'entry:add', afterDt)).toBe(true);
  });

  it('entry系: 現在の位置がafterと一致すれば競合なし', () => {
    const current = dt([cool('c1', [entry('e1'), entry('e2')])]);
    expect(isTimetableConflicted(current, 'e2', 'entry:add', afterDt)).toBe(false);
  });

  it('entry系: 現在の位置がafterと異なれば競合あり', () => {
    const current = dt([cool('c1', [entry('e2'), entry('e1')])]);
    expect(isTimetableConflicted(current, 'e2', 'entry:reorder', afterDt)).toBe(true);
  });

  it('entry系: 対象が両方存在しない場合は競合なし', () => {
    const current = dt([cool('c1', [entry('e1')])]);
    const after = dt([cool('c1', [entry('e1')])]);
    expect(isTimetableConflicted(current, 'e2', 'entry:delete', after)).toBe(false);
  });

  it('cool系: startTimeが一致すれば競合なし', () => {
    const current = dt([cool('c1', [], { startTime: '11:00' })]);
    const expected = dt([cool('c1', [], { startTime: '11:00' })]);
    expect(isTimetableConflicted(current, 'c1', 'cool:startTime', expected)).toBe(false);
  });

  it('cool系: startTimeが異なれば競合あり', () => {
    const current = dt([cool('c1', [], { startTime: '10:00' })]);
    const expected = dt([cool('c1', [], { startTime: '11:00' })]);
    expect(isTimetableConflicted(current, 'c1', 'cool:startTime', expected)).toBe(true);
  });

  it('cool系: 片方のみ存在する場合は競合あり', () => {
    const current = dt([]);
    const expected = dt([cool('c1', [])]);
    expect(isTimetableConflicted(current, 'c1', 'cool:add', expected)).toBe(true);
  });
});
