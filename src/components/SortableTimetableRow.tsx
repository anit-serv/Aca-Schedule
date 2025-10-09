import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Band, TimetableEntry } from '../types';

interface SortableTimetableRowProps {
  id: string;
  entry: TimetableEntry;
  band: Band | null | undefined;
  isDropTarget?: boolean;
  onRemove: () => void;
}

export const SortableTimetableRow = ({
  id,
  entry,
  band,
  isDropTarget = false,
  onRemove,
}: SortableTimetableRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const duration = band?.performanceDuration || entry.customEvent?.duration || 0;

  return (
    <>
      {isDropTarget && (
        <tr className="h-1">
          <td colSpan={5} className="p-0">
            <div className="h-1 bg-blue-500 shadow-lg shadow-blue-500/50"></div>
          </td>
        </tr>
      )}
      <tr
        ref={setNodeRef}
        style={style}
        className={`border-b border-gray-600 hover:bg-gray-650 ${
          isDragging ? 'bg-gray-600' : ''
        }`}
      >
      <td className="px-4 py-3 text-sm">{entry.startTime || '-'}</td>
      <td className="px-4 py-3 text-sm">{entry.endTime || '-'}</td>
      <td className="px-4 py-3 text-sm">{duration}分</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            {...listeners}
            {...attributes}
            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-white"
          >
            ⋮⋮
          </div>
          <div>
            <div className="font-medium">
              {entry.type === 'band' && band ? band.name : entry.customEvent?.name || '(不明)'}
            </div>
            {band && band.members.length > 0 && (
              <div className="text-xs text-gray-400 mt-1">
                {band.members.slice(0, 3).join(', ')}
                {band.members.length > 3 && ` 他${band.members.length - 3}名`}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={onRemove}
          className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
        >
          削除
        </button>
      </td>
    </tr>
    </>
  );
};
