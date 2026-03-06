import { useRef, type ReactNode } from 'react';
import { motion, type PanInfo } from 'framer-motion';

// ボトムシートの高さ段階
export type SheetHeight = 'peek' | 'half' | 'full';

const SHEET_HEIGHTS: Record<SheetHeight, string> = {
  peek: '120px',
  half: '50vh',
  full: '90vh',
};

// 各段階のピクセル値（ジェスチャー判定用）
const getHeightPx = (height: SheetHeight): number => {
  const vh = window.innerHeight;
  switch (height) {
    case 'peek': return 120;
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    isDragging.current = false;
    const velocity = info.velocity.y;
    const offset = info.offset.y;

    // 高速スワイプ判定
    if (Math.abs(velocity) > 500) {
      if (velocity > 0) {
        // 下方向スワイプ → 一段階下げる
        if (height === 'full') onHeightChange('half');
        else if (height === 'half') onHeightChange('peek');
      } else {
        // 上方向スワイプ → 一段階上げる
        if (height === 'peek') onHeightChange('half');
        else if (height === 'half') onHeightChange('full');
      }
      return;
    }

    // ドラッグ距離で判定
    const currentPx = getHeightPx(height);
    const newPx = currentPx - offset;

    const peekPx = getHeightPx('peek');
    const halfPx = getHeightPx('half');
    const fullPx = getHeightPx('full');

    // 最も近い段階にスナップ
    const distances = [
      { h: 'peek' as const, d: Math.abs(newPx - peekPx) },
      { h: 'half' as const, d: Math.abs(newPx - halfPx) },
      { h: 'full' as const, d: Math.abs(newPx - fullPx) },
    ];
    distances.sort((a, b) => a.d - b.d);
    const nearest = distances[0].h;

    if (nearest !== height) {
      onHeightChange(nearest);
    }
  };

  return (
    <>
      {/* オーバーレイ（half/full時） */}
      {height !== 'peek' && (
        <motion.div
          className="fixed inset-0 bg-black/20 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onHeightChange('peek')}
        />
      )}

      {/* シート本体 */}
      <motion.div
        ref={sheetRef}
        className="fixed bottom-[calc(52px+env(safe-area-inset-bottom,0px))] left-0 right-0 bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] z-40 flex flex-col"
        style={{ maxHeight: '90vh' }}
        animate={{
          height: SHEET_HEIGHTS[height],
        }}
        transition={{
          type: 'spring',
          damping: 30,
          stiffness: 300,
        }}
      >
        {/* ドラッグハンドル */}
        <motion.div
          className="flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing flex-shrink-0"
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.1}
          onDragStart={() => { isDragging.current = true; }}
          onDragEnd={handleDragEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </motion.div>

        {/* タイトルバー */}
        {title && (
          <div className="px-4 py-1.5 flex items-center justify-between flex-shrink-0 border-b border-gray-100">
            <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            <div className="flex gap-1">
              {height !== 'peek' && (
                <button
                  onClick={() => onHeightChange('peek')}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  title="最小化"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-2">
          {children}
        </div>
      </motion.div>
    </>
  );
};
