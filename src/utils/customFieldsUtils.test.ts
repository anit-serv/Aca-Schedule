import { describe, it, expect } from 'vitest';
import {
  createEmptyCustomFieldsSettings,
  addColumn,
  removeColumn,
  renameColumn,
  setColumnPublic,
  setColumnShared,
  getSharedColumnId,
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
  it('同名の既存列を値を残して共通化し、解除しても両側の列を残す', () => {
    let settings = addColumn(undefined, 'performance', { id: 'p', name: '担当', bindingType: 'sequence' });
    settings = addColumn(settings, 'rehearsal', { id: 'r', name: '担当', bindingType: 'sequence' });
    settings = setCellValue(settings, 'rehearsal', '2026-06-10', sequenceColumn('r', 0), 1, '音響');
    settings = setColumnShared(settings, 'performance', 'p', true, 'r');
    expect(settings.performance.columns[0].sharedColumnId).toBe('r');
    expect(settings.rehearsal.columns[0].sharedColumnId).toBe('p');
    settings = renameColumn(settings, 'performance', 'p', 'スタッフ');
    settings = setColumnPublic(settings, 'rehearsal', 'r', true);
    expect(settings.performance.columns[0]).toMatchObject({ name: 'スタッフ', isPublic: true });
    expect(settings.rehearsal.dailyData['2026-06-10'].bySequence[1].r.value).toBe('音響');
    settings = setColumnShared(settings, 'performance', 'p', false);
    expect(getSharedColumnId(settings, 'performance', settings.performance.columns[0])).toBeUndefined();
    expect(getSharedColumnId(settings, 'rehearsal', settings.rehearsal.columns[0])).toBeUndefined();
    expect(settings.rehearsal.columns).toHaveLength(1);
  });

  it('以前に同じIDで両方へ追加した列は共通として認識し、解除後は再連携しない', () => {
    let settings = addColumn(undefined, 'performance', { id: 'legacy', name: '担当', bindingType: 'sequence' });
    settings = addColumn(settings, 'rehearsal', { id: 'legacy', name: '担当', bindingType: 'sequence' });
    expect(getSharedColumnId(settings, 'performance', settings.performance.columns[0])).toBe('legacy');
    settings = setColumnShared(settings, 'performance', 'legacy', false);
    expect(getSharedColumnId(settings, 'performance', settings.performance.columns[0])).toBeUndefined();
    expect(getSharedColumnId(settings, 'rehearsal', settings.rehearsal.columns[0])).toBeUndefined();
    settings = renameColumn(settings, 'performance', 'legacy', '本番担当');
    expect(settings.rehearsal.columns[0].name).toBe('担当');
  });

  it('新規の共通列をもう一方に作り、削除時は両方の列を削除する', () => {
    let settings = addColumn(undefined, 'performance', { id: 'p', name: '担当', bindingType: 'entity' });
    settings = setColumnShared(settings, 'performance', 'p', true, undefined, 'r');
    expect(settings.rehearsal.columns[0]).toMatchObject({ id: 'r', name: '担当', sharedColumnId: 'p' });
    settings = removeColumn(settings, 'performance', 'p');
    expect(settings.performance.columns).toHaveLength(0);
    expect(settings.rehearsal.columns).toHaveLength(0);
  });

  it('共通列を別の共通列より前に動かすと、もう一方の共通列順も揃える', () => {
    let settings = createEmptyCustomFieldsSettings();
    for (const [type, id, name] of [
      ['performance', 'pa', 'A'], ['performance', 'local', '本番のみ'], ['performance', 'pb', 'B'],
      ['rehearsal', 'ra', 'A'], ['rehearsal', 'rehearsal-local', 'リハのみ'], ['rehearsal', 'rb', 'B'],
    ] as const) settings = addColumn(settings, type, { id, name, bindingType: 'sequence' });
    settings = setColumnShared(settings, 'performance', 'pa', true, 'ra');
    settings = setColumnShared(settings, 'performance', 'pb', true, 'rb');
    settings = reorderColumns(settings, 'performance', 2, 0);
    expect(settings.performance.columns.map(column => column.id)).toEqual(['pb', 'pa', 'local']);
    expect(settings.rehearsal.columns.map(column => column.id)).toEqual(['rb', 'rehearsal-local', 'ra']);
    settings = reorderColumns(settings, 'performance', 2, 1);
    expect(settings.rehearsal.columns.map(column => column.id)).toEqual(['rb', 'rehearsal-local', 'ra']);
    settings = reorderColumns(settings, 'rehearsal', 2, 0);
    expect(settings.rehearsal.columns.map(column => column.id)).toEqual(['ra', 'rb', 'rehearsal-local']);
    expect(settings.performance.columns.map(column => column.id)).toEqual(['pa', 'local', 'pb']);
  });
  it('新しい列と公開設定のない既存列は一般公開されない', () => {
    const settings = addColumn(undefined, 'performance', { id: 'c1', name: '備考', bindingType: 'sequence' });
    expect(settings.performance.columns[0].isPublic).toBe(false);
    const published = setColumnPublic(settings, 'performance', 'c1', true);
    expect(published.performance.columns[0].isPublic).toBe(true);
    expect(settings.performance.columns[0].isPublic).toBe(false);
  });
  it('列を追加するとorderが末尾に設定される', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: '備考', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c2', name: 'メモ', bindingType: 'entity' });

    expect(settings.performance.columns).toEqual([
      { id: 'c1', name: '備考', bindingType: 'sequence', order: 0, isPublic: false },
      { id: 'c2', name: 'メモ', bindingType: 'entity', order: 1, isPublic: false },
    ]);
  });

  it('列を削除すると関連データも削除され、orderが詰められる', () => {
    let settings = createEmptyCustomFieldsSettings();
    settings = addColumn(settings, 'performance', { id: 'c1', name: 'A', bindingType: 'sequence' });
    settings = addColumn(settings, 'performance', { id: 'c2', name: 'B', bindingType: 'entity' });
    settings = setCellValue(settings, 'performance', '2026-06-10', sequenceColumn('c1', 0), 1, 'val1');
    settings = setCellValue(settings, 'performance', '2026-06-10', entityColumn('c2', 1), 'entry1', 'val2');

    settings = removeColumn(settings, 'performance', 'c1');

    expect(settings.performance.columns).toEqual([{ id: 'c2', name: 'B', bindingType: 'entity', order: 0, isPublic: false }]);
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
