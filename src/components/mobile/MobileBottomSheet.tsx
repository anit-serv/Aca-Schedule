import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
import { motion, useMotionValue, useAnimation, type PanInfo } from 'framer-motion';

// ボトムシートの高さ段階
export type SheetHeight = 'closed' | 'third' | 'half' | 'full';

const SHEET_LEVEL_ORDER: SheetHeight[] = ['closed', 'third', 'half', 'full'];

// 各段階のピクセル値
const getHeightPx = (height: SheetHeight): number => {
  const vh = window.innerHeight;
  switch (height) {
    case 'closed': return 28;
    case 'third': return vh * 0.33;
    case 'half': return vh * 0.5;
    case 'full': return vh * 0.9;
  }
};

interface MobileBottomSheetProps {
  children: ReactNode;
  height: SheetHeight;
  onHeightChange: (height: SheetHeight) => void;
  title?: string;
}

export const MobileBottomSheet = ({
  children,
  height,
  onHeightChange,
  title,
}: MobileBottomSheetProps) => {
  const controls = useAnimation();
  const dragY = useMotionValue(0);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const isClosed = height === 'closed';

  // height stateが変更されたら高さを更新
  useEffect(() => {
    const targetPx = getHeightPx(height);
    if (!isDraggingRef.current) {
      controls.start({
        height: targetPx,
        transition: { type: 'spring', damping: 28, stiffness: 300 },
      });
    }
  }, [height, controls]);

  // ドラッグ中のリアルタイム高さ更新
  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    const basePx = getHeightPx(height);
    const closedPx = getHeightPx('closed');
    // 下にドラッグ → offset.y > 0 → 高さ減少
    // 上にドラッグ → offset.y < 0 → 高さ増加
    const newHeight = Math.max(closedPx, Math.min(window.innerHeight * 0.92, basePx - info.offset.y));
    controls.set({ height: newHeight });
  }, [height, controls]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    isDraggingRef.current = false;
    setIsDragging(false);
    const velocity = info.velocity.y;
    const basePx = getHeightPx(height);
    const finalPx = basePx - info.offset.y;

    const closedPx = getHeightPx('closed');
    const thirdPx = getHeightPx('third');
    const halfPx = getHeightPx('half');
    const fullPx = getHeightPx('full');

    let target: SheetHeight;

    // 高速スワイプ判定（速度が速い場合は勢いに従う）
    if (Math.abs(velocity) > 500) {
      const currentIndex = SHEET_LEVEL_ORDER.indexOf(height);
      if (velocity > 0) {
        // 下方向 → 一段階下げる
        const nextIndex = Math.max(0, currentIndex - 1);
        target = SHEET_LEVEL_ORDER[nextIndex];
      } else {
        // 上方向 → 一段階上げる
        const nextIndex = Math.min(SHEET_LEVEL_ORDER.length - 1, currentIndex + 1);
        target = SHEET_LEVEL_ORDER[nextIndex];
      }
    } else {
      // ドラッグ距離で最も近い段階にスナップ
      const distances: { h: SheetHeight; d: number }[] = [
        { h: 'closed', d: Math.abs(finalPx - closedPx) },
        { h: 'third', d: Math.abs(finalPx - thirdPx) },
        { h: 'half', d: Math.abs(finalPx - halfPx) },
        { h: 'full', d: Math.abs(finalPx - fullPx) },
      ];
      distances.sort((a, b) => a.d - b.d);
      target = distances[0].h;
    }

    const targetPx = getHeightPx(target);
    controls.start({
      height: targetPx,
      transition: { type: 'spring', damping: 28, stiffness: 300 },
    });

    if (target !== height) {
      onHeightChange(target);
    }
  }, [height, onHeightChange, controls]);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  return (
    <>
      {/* オーバーレイ（half/full時） */}
      {(height === 'half' || height === 'full') && (
        <motion.div
          className="fixed inset-0 bg-black/20 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onHeightChange('third')}
        />
      )}

      {/* シート本体 */}
      <motion.div
        id="mobile-bottom-sheet"
        className="fixed bottom-[calc(52px+env(safe-area-inset-bottom,0px))] left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-40 flex flex-col will-change-[height]"
        style={{ maxHeight: '92vh' }}
        animate={controls}
        initial={{ height: getHeightPx(height) }}
      >
        {/* ドラッグハンドル — シート全体の高さを操作 */}
        <motion.div
          className="flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none select-none"
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={handleDragStart}
          onDrag={handleDrag}
          onDragEnd={handleDragEnd}
          style={{ y: dragY }}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </motion.div>

        {/* タイトルバー */}
        {title && (!isClosed || isDragging) && (
          <div className="px-4 py-1.5 flex items-center justify-between flex-shrink-0 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <div className="flex gap-1">
              <button
                onClick={() => onHeightChange('closed')}
                className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title="閉じる"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {height !== 'full' && (
                <button
                  onClick={() => onHeightChange('full')}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title="最大化"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* コンテンツ */}
        <div className={`flex-1 overflow-y-auto overscroll-contain px-4 py-2 ${isClosed && !isDragging ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          {children}
        </div>
      </motion.div>
    </>
  );
};
