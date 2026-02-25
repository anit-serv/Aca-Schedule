import { useDraggable } from '@dnd-kit/core';
import type { Band } from '../types';

interface BandBankItemProps {
  id: string;
  band: Band & { placedCount: number };
  placedCount: number;
  timetableType?: 'performance' | 'rehearsal';
  rehearsalDuration?: number;
}

export const BandBankItem = ({ 
  id, 
  band, 
  placedCount, 
  timetableType = 'performance',
  rehearsalDuration = 0 
}: BandBankItemProps) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
  });

  // ドラッグ中はtransformを適用せず、元の位置に固定表示
  const style = undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white border-l-4 border-l-emerald-400 border border-gray-200 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all shadow-sm ${
        isDragging ? 'opacity-30' : 'hover:bg-emerald-50 hover:border-emerald-300'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* バンド名（ツールチップでメンバー表示） */}
          {band.members.length > 0 ? (
            <div className="group relative">
              <div className="font-semibold text-gray-900">{band.name || '(未設定)'}</div>
              {/* メンバーツールチップ */}
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-40 w-max max-w-xs">
                <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                  <div className="text-xs text-gray-600">
                    {band.members.join(', ')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="font-semibold text-gray-900">{band.name || '(未設定)'}</div>
          )}
          <div className="text-sm text-gray-500 mt-1">
            {timetableType === 'rehearsal' ? `${rehearsalDuration}分` : `${band.performanceDuration}分`}
          </div>
        </div>
        {timetableType === 'performance' && (
          <div className="ml-2 px-2 py-1 bg-emerald-500 text-white text-xs rounded font-semibold">
            {placedCount}/{band.performanceCount}
          </div>
        )}
      </div>
    </div>
  );
};
