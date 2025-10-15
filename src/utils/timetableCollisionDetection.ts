import { type CollisionDetection, pointerWithin } from '@dnd-kit/core';

/**
 * タイムテーブル用のカスタム衝突検出
 * タイムテーブル関連とバンドバンクのみを検出対象とする
 */
export const createTimetableCollisionDetection = (): CollisionDetection => {
  return (args) => {
    // まずpointerWithinで正確なポインタ位置を使った衝突を検出
    const pointerCollisions = pointerWithin(args);
    
    // ドロップ可能な要素のIDパターン
    const validDropTargetPatterns = [
      /^entry-/,                    // エントリーの前
      /^cool-droppable-/,          // クールの最後
      /^cool-header-/,             // クールのヘッダー（先頭に追加）
      /^cool-column-header-/,      // 列ヘッダー（先頭に追加）
      /^cool-gap-before-/,         // クールの前のギャップ
      /^cool-gap-after-/,          // クールの後のギャップ
      /^timetable-droppable$/,     // フラット構造の空タイムテーブル
      /^band-bank-droppable$/,     // バンドバンク（キャンセル用）
    ];
    
    // パターンに一致するもののみを返す
    return pointerCollisions.filter(collision => {
      const id = String(collision.id);
      return validDropTargetPatterns.some(pattern => pattern.test(id));
    });
  };
};
