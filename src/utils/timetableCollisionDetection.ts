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
    /^mobile-cancel-dropzone$/,  // モバイル用キャンセルドロップゾーン
  ];

  const filterValid = (collisions: ReturnType<CollisionDetection>) =>
    collisions.filter(collision => {
      const id = String(collision.id);
      return validDropTargetPatterns.some(pattern => pattern.test(id));
    });

  const prioritizeCancelDropzone = (collisions: ReturnType<CollisionDetection>) => {
    const cancelCollision = collisions.find(collision => String(collision.id) === 'mobile-cancel-dropzone');
    if (!cancelCollision) return collisions;
    return [cancelCollision];
  };

  return (args) => {
    // A wide timetable drag overlay can intersect the bank while the pointer stays
    // inside the timetable, especially at the top or bottom during auto-scroll.
    const bankRect = args.droppableRects.get('band-bank-droppable');
    const pointer = args.pointerCoordinates;
    const pointerInBank = Boolean(bankRect && pointer &&
      pointer.x >= bankRect.left && pointer.x <= bankRect.right &&
      pointer.y >= bankRect.top && pointer.y <= bankRect.bottom);
    const withoutAccidentalBank = (collisions: ReturnType<CollisionDetection>) =>
      pointerInBank ? collisions : collisions.filter(collision => String(collision.id) !== 'band-bank-droppable');

    // 1. pointerWithin: ポインタが要素の内側にある場合（最も正確）
    const pointerCollisions = prioritizeCancelDropzone(withoutAccidentalBank(filterValid(pointerWithin(args))));
    if (pointerCollisions.length > 0) return pointerCollisions;

    // 2. rectIntersection: ドラッグ中の要素と重なるもの（ポインタがずれても検出）
    const rectCollisions = prioritizeCancelDropzone(withoutAccidentalBank(filterValid(rectIntersection(args))));
    if (rectCollisions.length > 0) return rectCollisions;

    // 3. closestCenter: 最も近い要素（フォールバック）
    const centerCollisions = prioritizeCancelDropzone(withoutAccidentalBank(filterValid(closestCenter(args))));
    return centerCollisions;
  };
};
