import { describe, it, expect } from 'vitest';
import {
  createEmptyCustomFieldsSettings,
  addColumn,
  removeColumn,
  renameColumn,
  reorderColumns,
  setCellValue,
  getCellData,
  mergeCells,
  unmergeCells,
  isMergedChild,
  hasCustomFieldsDataForEntry,
  cleanupCustomFieldsForEntry,
  renumberSequenceDataForDeletion,
  shiftSequenceDataForInsertion,
} from './customFieldsUtils';
import type { CustomColumn, Timetable } from '../types';

const sequenceColumn = (id: string, order: number): CustomColumn => ({
  id,
  name: `列${id}`,
  bindingType: 'sequence',
  order,
});

const entityColumn = (id: string, order: number): CustomColumn => ({
  id,
  name: `列${id}`,
  bindingType: 'entity',
  order,
});

describe('addColumn / removeColumn / renameColumn / reorderColumns', () => {
  it('列を追加するとorderが末尾に設定される', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: '備考', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c2', name: 'メモ', bindingType: 'entity' });

    expect(settings.performance.columns).toEqual([
      { id: 'c1', name: '備考', bindingType: 'sequence', order: 0 },
      { id: 'c2', name: 'メモ', bindingType: 'entity', order: 1 },
    ]);
  });

  it('列を削除すると関連データも削除され、orderが詰められる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c2', name: 'B', bindingType: 'entity' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'val1');
    settings = setCellValue(settings, 'performance', '2026-06-10', entityColumn('c2', 1), 'entry1', 'val2');

    settings = removeColumn(settings, 'performance', 'c1');

    expect(settings.performance.columns).toEqual([{ id: 'c2', name: 'B', bindingType: 'entity', order: 0 }]);
    expect(settings.performance.dailyData['2026-06-10'].bySequence[1]?.['c1']).toBeUndefined();
    expect(settings.performance.dailyData['2026-06-10'].byEntity['entry1']?.['c2']?.value).toBe('val2');
  });

  it('列名を変更できる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'old', bindingType: 'sequence' });
    settings = renameColumn(settings, 'performance', 'c1', 'new');
    expect(settings.performance.columns[0].name).toBe('new');
  });

  it('列を並び替えられる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c2', name: 'B', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c3', name: 'C', bindingType: 'sequence' });

    settings = reorderColumns(settings, 'performance', 0, 2);

    expect(settings.performance.columns.map(c => c.id)).toEqual(['c2', 'c3', 'c1']);
    expect(settings.performance.columns.map(c => c.order)).toEqual([0, 1, 2]);
  });
});

describe('setCellValue / getCellData', () => {
  it('sequence型のセル値を設定・取得できる', () => {
    let settings = createEmptyCustomFieldsSettings();
    const col = sequenceColumn('c1', 0);
    settings = setCellValue(settings, 'performance', '2026-06-10', col, 1, 'hello');
    expect(getCellData(settings, 'performance', '2026-06-10', col, 1, 'entryX')).toEqual({ value: 'hello' });
  });

  it('entity型のセル値を設定・取得できる', () => {
    let settings = createEmptyCustomFieldsSettings();
    const col = entityColumn('c2', 0);
    settings = setCellValue(settings, 'performance', '2026-06-10', col, 'entry1', 'world');
    expect(getCellData(settings, 'performance', '2026-06-10', col, 99, 'entry1')).toEqual({ value: 'world' });
  });

  it('データが存在しない場合は空文字を返す', () => {
    const settings = createEmptyCustomFieldsSettings();
    const col = sequenceColumn('c1', 0);
    expect(getCellData(settings, 'performance', '2026-06-10', col, 1, 'entryX')).toEqual({ value: '' });
    expect(getCellData(undefined, 'performance', '2026-06-10', col, 1, 'entryX')).toEqual({ value: '' });
  });
});

describe('mergeCells / unmergeCells / isMergedChild', () => {
  const makeTimetableWithoutCools = (): Timetable => ({
    id: 'tt1',
    eventId: 'event1',
    type: 'performance',
    createdAt: new Date(),
    updatedAt: new Date(),
    dailyTimetables: [
      {
        date: '2026-06-10',
        startTime: '10:00',
        cools: [],
        entries: [
          { id: 'e1', type: 'band', bandId: 'b1', order: 0 },
          { id: 'e2', type: 'band', bandId: 'b2', order: 1 },
          { id: 'e3', type: 'band', bandId: 'b3', order: 2 },
        ],
      },
    ],
  });

  it('sequence型の列を結合し、子セルがrowSpan=0になる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'merged');

    const result = mergeCells(settings, 'performance', '2026-06-10', 'c1', 1, 2, makeTimetableWithoutCools());
    expect(result.error).toBeUndefined();

    const daily = result.settings.performance.dailyData['2026-06-10'];
    expect(daily.bySequence[1]['c1']).toEqual({ value: 'merged', rowSpan: 2 });
    expect(daily.bySequence[2]['c1']).toEqual({ value: '', rowSpan: 0 });

    expect(isMergedChild(result.settings, 'performance', '2026-06-10', 'c1', 2)).toBe(true);
    expect(isMergedChild(result.settings, 'performance', '2026-06-10', 'c1', 1)).toBe(false);
  });

  it('entity型の列は結合できない', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'entity' });

    const result = mergeCells(settings, 'performance', '2026-06-10', 'c1', 1, 2, makeTimetableWithoutCools());
    expect(result.error).toBe('エントリー追従列ではセル結合できません');
  });

  it('存在しない列は結合できない', () => {
    const settings = createEmptyCustomFieldsSettings();
    const result = mergeCells(settings, 'performance', '2026-06-10', 'unknown', 1, 2, makeTimetableWithoutCools());
    expect(result.error).toBe('列が見つかりません');
  });

  it('startSeq >= endSeqの場合はエラー', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    const result = mergeCells(settings, 'performance', '2026-06-10', 'c1', 2, 2, makeTimetableWithoutCools());
    expect(result.error).toBe('結合範囲が不正です');
  });

  it('結合を解除すると子セルが通常セルに戻る', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'merged');
    const merged = mergeCells(settings, 'performance', '2026-06-10', 'c1', 1, 3, makeTimetableWithoutCools());

    const unmerged = unmergeCells(merged.settings, 'performance', '2026-06-10', 'c1', 1);
    const daily = unmerged.performance.dailyData['2026-06-10'];
    expect(daily.bySequence[1]['c1']).toEqual({ value: 'merged' });
    expect(daily.bySequence[2]['c1']).toEqual({ value: '' });
    expect(daily.bySequence[3]['c1']).toEqual({ value: '' });
  });
});

describe('hasCustomFieldsDataForEntry / cleanupCustomFieldsForEntry', () => {
  it('値があるエントリーはtrueを返す', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'entity' });
    settings = setCellValue(settings, 'performance', '2026-06-10', entityColumn('c1', 0), 'e1', 'data');

    expect(hasCustomFieldsDataForEntry(settings, 'performance', '2026-06-10', 'e1')).toBe(true);
    expect(hasCustomFieldsDataForEntry(settings, 'performance', '2026-06-10', 'e2')).toBe(false);
  });

  it('cleanupCustomFieldsForEntryでエントリーのデータが削除される', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'entity' });
    settings = setCellValue(settings, 'performance', '2026-06-10', entityColumn('c1', 0), 'e1', 'data');

    settings = cleanupCustomFieldsForEntry(settings, 'performance', '2026-06-10', 'e1');
    expect(hasCustomFieldsDataForEntry(settings, 'performance', '2026-06-10', 'e1')).toBe(false);
  });
});

describe('renumberSequenceDataForDeletion / shiftSequenceDataForInsertion', () => {
  it('削除位置以降のsequence番号が繰り下がる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'one');
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 2, 'two');
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 3, 'three');

    settings = renumberSequenceDataForDeletion(settings, 'performance', '2026-06-10', 2);

    const daily = settings.performance.dailyData['2026-06-10'];
    expect(daily.bySequence[1]['c1'].value).toBe('one');
    expect(daily.bySequence[2]['c1'].value).toBe('three');
    expect(daily.bySequence[3]).toBeUndefined();
  });

  it('挿入位置以降のsequence番号が繰り上がる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'one');
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 2, 'two');

    settings = shiftSequenceDataForInsertion(settings, 'performance', '2026-06-10', 2);

    const daily = settings.performance.dailyData['2026-06-10'];
    expect(daily.bySequence[1]['c1'].value).toBe('one');
    expect(daily.bySequence[3]['c1'].value).toBe('two');
    expect(daily.bySequence[2]).toBeUndefined();
  });
});
