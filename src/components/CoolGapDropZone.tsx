import { useDroppable } from '@dnd-kit/core';

interface CoolGapDropZoneProps {
  id: string;
  className?: string;
  disabled?: boolean;
}

export const CoolGapDropZone = ({ id, className, disabled = false }: CoolGapDropZoneProps) => {
  const { setNodeRef } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className={className || "h-6"}
    >
      {/* ドロップ可能だがハイライトは表示しない */}
    </div>
  );
};
