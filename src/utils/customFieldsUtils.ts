import type {
  CustomFieldsSettings,
  CustomFieldsTypeData,
  CustomColumn,
  CustomCellData,
  DailyCustomData,
  Timetable,
  DailyTimetable,
} from '../types';

// ========== 初期化ヘルパー ==========

/** 空のCustomFieldsSettingsを作成 */
export const createEmptyCustomFieldsSettings = (): CustomFieldsSettings => ({
  performance: { columns: [], dailyData: {} },
  rehearsal: { columns: [], dailyData: {} },
});

/** 空のDailyCustomDataを作成 */
export const createEmptyDailyCustomData = (): DailyCustomData => ({
  bySequence: {},
  byEntity: {},
});

/** 指定タイプのデータを取得（なければ初期化） */
export const getTypeData = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal'
): CustomFieldsTypeData => {
  if (!settings) {
    return { columns: [], dailyData: {} };
  }
  return settings[type] || { columns: [], dailyData: {} };
};

/** 指定日付のデータを取得（なければ初期化） */
export const getDailyData = (
  typeData: CustomFieldsTypeData,
  date: string
): DailyCustomData => {
  return typeData.dailyData[date] || createEmptyDailyCustomData();
};

// ========== 列管理 ==========

/** 列を追加 */
export const addColumn = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  column: Omit<CustomColumn, 'order'>
): CustomFieldsSettings => {
  const result = settings ? structuredClone(settings) : createEmptyCustomFieldsSettings();
  const typeData = result[type];
  const newColumn: CustomColumn = {
    ...column,
    order: typeData.columns.length,
  };
  typeData.columns.push(newColumn);
  return result;
};

/** 列を削除（関連データも削除） */
export const removeColumn = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  columnId: string
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const typeData = result[type];

  // 列定義から削除
  typeData.columns = typeData.columns
    .filter(c => c.id !== columnId)
    .map((c, i) => ({ ...c, order: i }));

  // 全日付のデータから該当列のデータを削除
  for (const date of Object.keys(typeData.dailyData)) {
    const daily = typeData.dailyData[date];
    for (const seq of Object.keys(daily.bySequence)) {
      delete daily.bySequence[Number(seq)][columnId];
    }
    for (const entryId of Object.keys(daily.byEntity)) {
      delete daily.byEntity[entryId][columnId];
    }
  }

  return result;
};

/** 列名を変更 */
export const renameColumn = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  columnId: string,
  newName: string
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const col = result[type].columns.find(c => c.id === columnId);
  if (col) {
    col.name = newName;
  }
  return result;
};

/** 列の並び替え */
export const reorderColumns = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  fromIndex: number,
  toIndex: number
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const columns = result[type].columns.sort((a, b) => a.order - b.order);
  const [moved] = columns.splice(fromIndex, 1);
  columns.splice(toIndex, 0, moved);
  columns.forEach((c, i) => { c.order = i; });
  return result;
};

// ========== セルデータ操作 ==========

/** セルの値を設定 */
export const setCellValue = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  column: CustomColumn,
  identifier: number | string, // sequence番号 or entryId
  value: string
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const typeData = result[type];

  if (!typeData.dailyData[date]) {
    typeData.dailyData[date] = createEmptyDailyCustomData();
  }

  const daily = typeData.dailyData[date];

  if (column.bindingType === 'sequence') {
    const seq = identifier as number;
    if (!daily.bySequence[seq]) {
      daily.bySequence[seq] = {};
    }
    const existing = daily.bySequence[seq][column.id];
    daily.bySequence[seq][column.id] = {
      value,
      rowSpan: existing?.rowSpan,
    };
  } else {
    const entryId = identifier as string;
    if (!daily.byEntity[entryId]) {
      daily.byEntity[entryId] = {};
    }
    daily.byEntity[entryId][column.id] = { value };
  }

  return result;
};

/** セルデータを取得 */
export const getCellData = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string,
  column: CustomColumn,
  sequenceNumber: number,
  entryId: string
): CustomCellData => {
  if (!settings) return { value: '' };

  const typeData = settings[type];
  if (!typeData) return { value: '' };

  const daily = typeData.dailyData[date];
  if (!daily) return { value: '' };

  if (column.bindingType === 'sequence') {
    return daily.bySequence[sequenceNumber]?.[column.id] || { value: '' };
  } else {
    return daily.byEntity[entryId]?.[column.id] || { value: '' };
  }
};

// ========== セル結合（sequence型のみ） ==========

/** 指定された通し番号のエントリーが同じクール内にあるか検証 */
const validateSameCool = (
  timetable: Timetable | null,
  date: string,
  startSeq: number,
  endSeq: number
): { valid: boolean; error?: string } => {
  if (!timetable) return { valid: false, error: 'タイムテーブルが見つかりません' };

  const daily = timetable.dailyTimetables.find(dt => dt.date === date);
  if (!daily) return { valid: false, error: '日付のタイムテーブルが見つかりません' };

  if (!daily.cools || daily.cools.length === 0) {
    // クール構造がない場合は結合可能
    return { valid: true };
  }

  // 各通し番号がどのクールに属するか確認
  let counter = 1;
  const seqToCool = new Map<number, string>();
  for (const cool of daily.cools) {
    for (let i = 0; i < cool.entries.length; i++) {
      seqToCool.set(counter, cool.id);
      counter++;
    }
  }

  const startCool = seqToCool.get(startSeq);
  const endCool = seqToCool.get(endSeq);

  if (!startCool || !endCool) {
    return { valid: false, error: '指定された番号が見つかりません' };
  }

  // 範囲内の全番号が同じクールか確認
  for (let seq = startSeq; seq <= endSeq; seq++) {
    if (seqToCool.get(seq) !== startCool) {
      return { valid: false, error: 'クール境界をまたぐ結合はできません' };
    }
  }

  return { valid: true };
};

/** セルを結合（sequence型列のみ） */
export const mergeCells = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  columnId: string,
  startSeq: number,
  endSeq: number,
  timetable: Timetable | null
): { settings: CustomFieldsSettings; error?: string } => {
  const typeData = settings[type];
  const column = typeData.columns.find(c => c.id === columnId);

  if (!column) {
    return { settings, error: '列が見つかりません' };
  }
  if (column.bindingType !== 'sequence') {
    return { settings, error: 'エントリー追従列ではセル結合できません' };
  }
  if (startSeq >= endSeq) {
    return { settings, error: '結合範囲が不正です' };
  }

  // クール境界チェック
  const validation = validateSameCool(timetable, date, startSeq, endSeq);
  if (!validation.valid) {
    return { settings, error: validation.error };
  }

  const result = structuredClone(settings);
  const daily = result[type].dailyData[date] || createEmptyDailyCustomData();
  if (!result[type].dailyData[date]) {
    result[type].dailyData[date] = daily;
  }

  // 先頭セルにrowSpanを設定
  if (!daily.bySequence[startSeq]) {
    daily.bySequence[startSeq] = {};
  }
  const existingValue = daily.bySequence[startSeq][columnId]?.value || '';
  daily.bySequence[startSeq][columnId] = {
    value: existingValue,
    rowSpan: endSeq - startSeq + 1,
  };

  // 結合された子セルを削除（rowSpan=0で非表示扱い）
  for (let seq = startSeq + 1; seq <= endSeq; seq++) {
    if (!daily.bySequence[seq]) {
      daily.bySequence[seq] = {};
    }
    daily.bySequence[seq][columnId] = { value: '', rowSpan: 0 };
  }

  return { settings: result };
};

/** セル結合を解除 */
export const unmergeCells = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  columnId: string,
  seq: number
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const daily = result[type].dailyData[date];
  if (!daily) return result;

  const cell = daily.bySequence[seq]?.[columnId];
  if (!cell || !cell.rowSpan || cell.rowSpan <= 1) return result;

  const span = cell.rowSpan;

  // 先頭セルのrowSpanを削除
  daily.bySequence[seq][columnId] = { value: cell.value };

  // 子セルを通常セルに復元
  for (let s = seq + 1; s < seq + span; s++) {
    if (daily.bySequence[s]?.[columnId]) {
      daily.bySequence[s][columnId] = { value: '' };
    }
  }

  return result;
};

/** セルが結合された子セル（非表示）かどうか判定 */
export const isMergedChild = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string,
  columnId: string,
  seq: number
): boolean => {
  if (!settings) return false;
  const daily = settings[type]?.dailyData[date];
  if (!daily) return false;
  const cell = daily.bySequence[seq]?.[columnId];
  return cell?.rowSpan === 0;
};

// ========== エントリー情報取得ヘルパー ==========

/** 日付のエントリー一覧をフラットに取得（クール情報付き） */
export const getEntriesWithCoolInfo = (
  dailyTimetable: DailyTimetable
): Array<{
  entryId: string;
  sequenceNumber: number;
  coolId?: string;
  coolNumber?: number;
  type: 'band' | 'custom';
  bandId?: string;
  customEventName?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  transitionTime?: number;
}> => {
  const result: Array<{
    entryId: string;
    sequenceNumber: number;
    coolId?: string;
    coolNumber?: number;
    type: 'band' | 'custom';
    bandId?: string;
    customEventName?: string;
    startTime?: string;
    endTime?: string;
    duration?: number;
    transitionTime?: number;
  }> = [];

  let counter = 1;

  if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
    for (const cool of dailyTimetable.cools) {
      for (const entry of cool.entries) {
        result.push({
          entryId: entry.id,
          sequenceNumber: counter++,
          coolId: cool.id,
          coolNumber: cool.number,
          type: entry.type,
          bandId: entry.bandId,
          customEventName: entry.customEvent?.name,
          startTime: entry.startTime,
          endTime: entry.endTime,
          duration: entry.type === 'custom' ? entry.customEvent?.duration : undefined,
          transitionTime: entry.transitionTime,
        });
      }
    }
  } else {
    for (const entry of dailyTimetable.entries) {
      result.push({
        entryId: entry.id,
        sequenceNumber: counter++,
        type: entry.type,
        bandId: entry.bandId,
        customEventName: entry.customEvent?.name,
        startTime: entry.startTime,
        endTime: entry.endTime,
        duration: entry.type === 'custom' ? entry.customEvent?.duration : undefined,
        transitionTime: entry.transitionTime,
      });
    }
  }

  return result;
};

// ========== エントリー削除時のクリーンアップ ==========

/** 指定エントリーのカスタムフィールドデータが存在するか確認（entity型のみ） */
export const hasCustomFieldsDataForEntry = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string,
  entryId: string
): boolean => {
  if (!settings) return false;
  const typeData = settings[type];
  if (!typeData) return false;
  const daily = typeData.dailyData[date];
  if (!daily?.byEntity) return false;
  
  const entityData = daily.byEntity[entryId];
  if (!entityData) return false;
  
  // 値が存在するかチェック
  return Object.values(entityData).some(cell => cell.value && cell.value.trim() !== '');
};

/** 指定エントリーのカスタムフィールドデータを削除 */
export const cleanupCustomFieldsForEntry = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  entryId: string
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const typeData = result[type];
  if (!typeData) return result;
  
  const daily = typeData.dailyData[date];
  if (!daily?.byEntity) return result;
  
  // エントリーのデータを削除
  delete daily.byEntity[entryId];
  
  return result;
};

// ========== Sequence型データ管理（挿入・削除時の自動調整） ==========

/** 指定日付にsequence型のデータまたはマージ構造が1つでも存在するか確認 */
export const hasAnySequenceData = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string
): boolean => {
  if (!settings) return false;
  const typeData = settings[type];
  if (!typeData) return false;
  const daily = typeData.dailyData[date];
  if (!daily?.bySequence) return false;

  for (const seqStr of Object.keys(daily.bySequence)) {
    const seqData = daily.bySequence[Number(seqStr)];
    if (Object.values(seqData).some(cell =>
      (cell.value && cell.value.trim() !== '') || cell.rowSpan !== undefined
    )) {
      return true;
    }
  }
  return false;
};

/** 指定位置にsequence型のデータ（値）が存在するか確認 */
export const hasSequenceDataAtPosition = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string,
  seq: number
): boolean => {
  if (!settings) return false;
  const typeData = settings[type];
  if (!typeData) return false;
  const daily = typeData.dailyData[date];
  if (!daily?.bySequence?.[seq]) return false;

  const seqData = daily.bySequence[seq];
  return Object.values(seqData).some(cell => cell.value && cell.value.trim() !== '');
};

/** 指定位置のsequence型マージ影響情報を取得 */
export const getSequenceMergeInfoAtPosition = (
  settings: CustomFieldsSettings | undefined,
  type: 'performance' | 'rehearsal',
  date: string,
  seq: number
): { isInMerge: boolean; isParent: boolean } => {
  if (!settings) return { isInMerge: false, isParent: false };
  const typeData = settings[type];
  if (!typeData) return { isInMerge: false, isParent: false };
  const daily = typeData.dailyData[date];
  if (!daily) return { isInMerge: false, isParent: false };

  const seqColumns = typeData.columns.filter(c => c.bindingType === 'sequence');
  for (const col of seqColumns) {
    const cell = daily.bySequence[seq]?.[col.id];
    if (cell) {
      if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
        return { isInMerge: true, isParent: true };
      }
      if (cell.rowSpan === 0) {
        return { isInMerge: true, isParent: false };
      }
    }
  }
  return { isInMerge: false, isParent: false };
};

/** エントリーのsequence番号を取得 */
export const getSequenceNumberForEntry = (
  dailyTimetable: DailyTimetable,
  entryId: string
): number | undefined => {
  const entries = getEntriesWithCoolInfo(dailyTimetable);
  return entries.find(e => e.entryId === entryId)?.sequenceNumber;
};

/** 削除時のsequence型データのリナンバリング（マージ自動調整付き） */
export const renumberSequenceDataForDeletion = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  deletedSeq: number
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const typeData = result[type];
  const daily = typeData.dailyData[date];
  if (!daily) return result;

  const seqColumns = typeData.columns.filter(c => c.bindingType === 'sequence');

  // Step 1: マージの調整（削除位置に関連するマージを処理）
  for (const col of seqColumns) {
    const cell = daily.bySequence[deletedSeq]?.[col.id];
    if (!cell) continue;

    if (cell.rowSpan !== undefined && cell.rowSpan > 1) {
      // 削除位置がマージの親 → 次のセルに親を引き継ぎ
      const span = cell.rowSpan;
      const nextSeq = deletedSeq + 1;

      if (span === 2) {
        // マージ解除 → 次のセルを値付き通常セルに
        if (daily.bySequence[nextSeq]?.[col.id] !== undefined) {
          daily.bySequence[nextSeq][col.id] = { value: cell.value };
        }
      } else {
        // マージを縮小 → 次のセルを新しい親に（値を引き継ぎ）
        if (!daily.bySequence[nextSeq]) daily.bySequence[nextSeq] = {};
        daily.bySequence[nextSeq][col.id] = { value: cell.value, rowSpan: span - 1 };
      }
    } else if (cell.rowSpan === 0) {
      // 削除位置がマージの子 → 親のrowSpanを縮小
      for (let s = deletedSeq - 1; s >= 1; s--) {
        const parentCell = daily.bySequence[s]?.[col.id];
        if (parentCell && parentCell.rowSpan !== undefined && parentCell.rowSpan > 1) {
          if (s + parentCell.rowSpan - 1 >= deletedSeq) {
            if (parentCell.rowSpan === 2) {
              // マージ解除
              daily.bySequence[s][col.id] = { value: parentCell.value };
            } else {
              parentCell.rowSpan -= 1;
            }
            break;
          }
        }
        // rowSpan が undefined or >= 1 の通常セルに到達したら探索終了
        if (parentCell && parentCell.rowSpan !== 0) break;
      }
    }
  }

  // Step 2: リナンバリング（deletedSeqを除去し、それ以降を繰り下げ）
  const oldBySequence = daily.bySequence;
  const newBySequence: typeof daily.bySequence = {};

  const seqs = Object.keys(oldBySequence).map(Number).sort((a, b) => a - b);
  for (const seq of seqs) {
    if (seq < deletedSeq) {
      newBySequence[seq] = oldBySequence[seq];
    } else if (seq > deletedSeq) {
      newBySequence[seq - 1] = oldBySequence[seq];
    }
    // seq === deletedSeq: 削除（スキップ）
  }

  daily.bySequence = newBySequence;
  return result;
};

/** reorder時のsequence型データの調整（削除+挿入方式）
 * 移動元のデータを削除（マージ縮小）し、移動先にスペースを挿入（マージ拡張）する
 * これにより、結合セルの間に挿入された場合のみ結合が拡張される
 */
export const adjustSequenceDataForReorder = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  oldSeq: number,
  newSeq: number
): CustomFieldsSettings => {
  if (oldSeq === newSeq) return settings;

  // Step 1: 移動元からデータを削除（マージ自動縮小）
  let result = renumberSequenceDataForDeletion(settings, type, date, oldSeq);

  // Step 2: 移動先にスペースを挿入（マージ自動拡張）
  result = shiftSequenceDataForInsertion(result, type, date, newSeq);

  return result;
};

/** 挿入時のsequence型データのシフト（マージ拡張対応: アプローチB） */
export const shiftSequenceDataForInsertion = (
  settings: CustomFieldsSettings,
  type: 'performance' | 'rehearsal',
  date: string,
  insertedSeq: number
): CustomFieldsSettings => {
  const result = structuredClone(settings);
  const typeData = result[type];
  const daily = typeData.dailyData[date];
  if (!daily) return result;

  const seqColumns = typeData.columns.filter(c => c.bindingType === 'sequence');
  const mergeExpandedCols = new Set<string>();

  // 旧データを完全コピー（Step 1で変更しても影響されないように）
  const oldBySequence = structuredClone(daily.bySequence);

  // Step 1: マージ拡張チェック
  // insertedSeq位置が結合範囲内（子マーカーがあるか、または親の範囲内）なら拡張
  for (const col of seqColumns) {
    // まず insertedSeq 位置が明示的な子マーカーかをチェック
    const cellAtPos = oldBySequence[insertedSeq]?.[col.id];
    if (cellAtPos && cellAtPos.rowSpan === 0) {
      // 明示的なマージの子 → 親を探して拡張
      for (let s = insertedSeq - 1; s >= 1; s--) {
        const parentCell = oldBySequence[s]?.[col.id];
        if (parentCell && parentCell.rowSpan !== undefined && parentCell.rowSpan > 1) {
          if (s + parentCell.rowSpan - 1 >= insertedSeq) {
            // dailyの方を変更（後でシフト処理で使う）
            daily.bySequence[s][col.id].rowSpan = parentCell.rowSpan + 1;
            mergeExpandedCols.add(col.id);
            break;
          }
        }
        if (parentCell && parentCell.rowSpan !== 0) break;
      }
      continue; // この列は処理済み
    }

    // insertedSeq 位置に子マーカーがない場合でも、前方の親の範囲内かをチェック
    // 結合範囲内への挿入のみ拡張対象（結合の直後は拡張しない）
    for (let s = insertedSeq - 1; s >= 1; s--) {
      const parentCell = oldBySequence[s]?.[col.id];
      if (parentCell && parentCell.rowSpan !== undefined && parentCell.rowSpan > 1) {
        const parentEnd = s + parentCell.rowSpan - 1;
        if (parentEnd >= insertedSeq) {
          // 結合範囲内への挿入 → 親のrowSpanを+1
          daily.bySequence[s][col.id].rowSpan = parentCell.rowSpan + 1;
          mergeExpandedCols.add(col.id);
          break;
        }
      }
      // 通常セル（rowSpan undefined または 1）に到達したら探索終了
      if (parentCell && parentCell.rowSpan !== 0) break;
    }
  }

  // Step 2: シフト（insertedSeq以降を1つ後ろにずらす）
  // 変更後のdaily.bySequenceを使用
  const currentBySequence = daily.bySequence;
  const newBySequence: typeof daily.bySequence = {};

  const seqs = Object.keys(currentBySequence).map(Number).sort((a, b) => b - a);
  for (const seq of seqs) {
    if (seq >= insertedSeq) {
      newBySequence[seq + 1] = currentBySequence[seq];
    } else {
      // insertedSeq より前のデータはそのまま（ただしオブジェクト参照なので変更済みのrowSpanが反映）
      newBySequence[seq] = currentBySequence[seq];
    }
  }

  // Step 3: マージ拡張された列の新しいinsertedSeq位置にchildマーカーを設置
  if (mergeExpandedCols.size > 0) {
    if (!newBySequence[insertedSeq]) newBySequence[insertedSeq] = {};
    for (const colId of mergeExpandedCols) {
      newBySequence[insertedSeq][colId] = { value: '', rowSpan: 0 };
    }
  }

  daily.bySequence = newBySequence;
  return result;
};
