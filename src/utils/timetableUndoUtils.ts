import type { DailyTimetable, TimetableOpType } from '../types';

// DailyTimetable の全エントリーをフラットに取得（{id, coolId} 付き）
export const getAllEntries = (dt: DailyTimetable) => {
  const result: { id: string; coolId: string | null; index: number }[] = [];
  if (dt.cools && dt.cools.length > 0) {
    for (const cool of dt.cools) {
      cool.entries.forEach((e, i) => result.push({ id: e.id, coolId: cool.id, index: i }));
    }
  } else {
    (dt.entries || []).forEach((e, i) => result.push({ id: e.id, coolId: null, index: i }));
  }
  return result;
};

// before/after の差分からタイムテーブル操作種別と targetId を推定
export const detectTimetableOperation = (
  before: DailyTimetable | undefined,
  after: DailyTimetable
): { targetId: string; opType: TimetableOpType } | null => {
  if (!before) return null;

  const beforeCoolIds = new Set(before.cools.map(c => c.id));
  const afterCoolIds = new Set(after.cools.map(c => c.id));

  const addedCool = after.cools.find(c => !beforeCoolIds.has(c.id));
  if (addedCool) return { targetId: addedCool.id, opType: 'cool:add' };

  const deletedCool = before.cools.find(c => !afterCoolIds.has(c.id));
  if (deletedCool) return { targetId: deletedCool.id, opType: 'cool:delete' };

  const beforeEntries = new Map(getAllEntries(before).map(e => [e.id, e]));
  const afterEntries = new Map(getAllEntries(after).map(e => [e.id, e]));

  for (const [id] of afterEntries) {
    if (!beforeEntries.has(id)) return { targetId: id, opType: 'entry:add' };
  }
  for (const [id] of beforeEntries) {
    if (!afterEntries.has(id)) return { targetId: id, opType: 'entry:delete' };
  }
  for (const [id, ae] of afterEntries) {
    const be = beforeEntries.get(id);
    if (be && (be.coolId !== ae.coolId || be.index !== ae.index)) {
      return { targetId: id, opType: 'entry:reorder' };
    }
  }
  for (const afterCool of after.cools) {
    const beforeCool = before.cools.find(c => c.id === afterCool.id);
    if (beforeCool && beforeCool.startTime !== afterCool.startTime) {
      return { targetId: afterCool.id, opType: 'cool:startTime' };
    }
  }
  return null;
};

// 現在の DailyTimetable から targetId の要素が expectedAfter と一致するか確認
export const isTimetableConflicted = (
  currentDt: DailyTimetable | undefined,
  targetId: string,
  opType: TimetableOpType,
  afterDt: DailyTimetable
): boolean => {
  if (!currentDt) return true;

  if (opType === 'entry:add' || opType === 'entry:delete' || opType === 'entry:reorder') {
    const current = getAllEntries(currentDt).find(e => e.id === targetId);
    const expected = getAllEntries(afterDt).find(e => e.id === targetId);
    if (!current && !expected) return false;
    if (!current || !expected) return true;
    return current.coolId !== expected.coolId || current.index !== expected.index;
  }

  if (opType === 'cool:add' || opType === 'cool:delete' || opType === 'cool:startTime') {
    const current = currentDt.cools.find(c => c.id === targetId);
    const expected = afterDt.cools.find(c => c.id === targetId);
    if (!current && !expected) return false;
    if (!current || !expected) return true;
    return current.startTime !== expected.startTime;
  }

  return false;
};
