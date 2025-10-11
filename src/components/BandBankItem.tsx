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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-gray-700 border border-gray-600 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-50' : 'hover:bg-gray-600'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* バンド名（ツールチップでメンバー表示） */}
          {band.members.length > 0 ? (
            <div className="group relative">
              <div className="font-semibold text-white">{band.name || '(未設定)'}</div>
              {/* メンバーツールチップ */}
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-40 w-max max-w-xs">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-lg">
                  <div className="text-xs text-gray-300">
                    {band.members.join(', ')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="font-semibold text-white">{band.name || '(未設定)'}</div>
          )}
          <div className="text-sm text-gray-400 mt-1">
            {timetableType === 'rehearsal' ? `${rehearsalDuration}分` : `${band.performanceDuration}分`}
          </div>
        </div>
        {timetableType === 'performance' && (
          <div className="ml-2 px-2 py-1 bg-blue-600 text-white text-xs rounded font-semibold">
            {placedCount}/{band.performanceCount}
          </div>
        )}
      </div>
    </div>
  );
};
