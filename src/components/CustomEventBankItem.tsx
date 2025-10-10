import { useDraggable } from '@dnd-kit/core';
import type { CustomEvent } from '../types';

interface CustomEventBankItemProps {
  id: string;
  customEvent: CustomEvent;
  onDelete: (id: string) => void;
}

export const CustomEventBankItem = ({ 
  id, 
  customEvent,
  onDelete 
}: CustomEventBankItemProps) => {
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
      className={`bg-purple-700 border border-purple-600 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-50' : 'hover:bg-purple-600'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="font-semibold text-white">{customEvent.name}</div>
          <div className="text-sm text-purple-200 mt-1">
            {customEvent.duration}分
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(customEvent.id);
          }}
          className="ml-2 text-purple-300 hover:text-white transition-colors"
          title="削除"
        >
          ×
        </button>
      </div>
    </div>
  );
};
