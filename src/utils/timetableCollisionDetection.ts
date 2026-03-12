import { type CollisionDetection, pointerWithin, closestCenter, rectIntersection } from '@dnd-kit/core';

/**
 * タイムテーブル用のカスタム衝突検出
 * モバイルタッチでも確実に検出できるよう、複数の戦略をフォールバックとして使用
 */
export const createTimetableCollisionDetection = (): CollisionDetection => {
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

  const filterValid = (collisions: ReturnType<CollisionDetection>) =>
    collisions.filter(collision => {
      const id = String(collision.id);
      return validDropTargetPatterns.some(pattern => pattern.test(id));
    });

  return (args) => {
    // 1. pointerWithin: ポインタが要素の内側にある場合（最も正確）
    const pointerCollisions = filterValid(pointerWithin(args));
    if (pointerCollisions.length > 0) return pointerCollisions;

    // 2. rectIntersection: ドラッグ中の要素と重なるもの（ポインタがずれても検出）
    const rectCollisions = filterValid(rectIntersection(args));
    if (rectCollisions.length > 0) return rectCollisions;

    // 3. closestCenter: 最も近い要素（フォールバック）
    const centerCollisions = filterValid(closestCenter(args));
    return centerCollisions;
  };
};
