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
      className={`bg-emerald-100 border border-emerald-200 rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-30' : 'hover:bg-emerald-50'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="font-semibold text-emerald-700">{customEvent.name}</div>
          <div className="text-sm text-emerald-500 mt-1">
            {customEvent.duration}分
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(customEvent.id);
          }}
          className="ml-2 text-emerald-400 hover:text-emerald-700 transition-colors"
          title="削除"
        >
          ×
        </button>
      </div>
    </div>
  );
};
