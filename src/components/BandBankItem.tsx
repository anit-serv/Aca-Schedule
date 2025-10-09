import { useDraggable } from '@dnd-kit/core';
import type { Band } from '../types';

interface BandBankItemProps {
  id: string;
  band: Band & { placedCount: number };
  placedCount: number;
}

export const BandBankItem = ({ id, band, placedCount }: BandBankItemProps) => {
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
          <div className="font-semibold text-white">{band.name || '(未設定)'}</div>
          <div className="text-sm text-gray-400 mt-1">
            {band.performanceDuration}分
          </div>
          {band.members.length > 0 && (
            <div className="text-xs text-gray-500 mt-1">
              {band.members.slice(0, 3).join(', ')}
              {band.members.length > 3 && ` 他${band.members.length - 3}名`}
            </div>
          )}
        </div>
        <div className="ml-2 px-2 py-1 bg-blue-600 text-white text-xs rounded font-semibold">
          {placedCount}/{band.performanceCount}
        </div>
      </div>
    </div>
  );
};
