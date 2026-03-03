import { useDroppable } from '@dnd-kit/core';

interface CoolGapDropZoneProps {
  id: string;
  className?: string;
}

export const CoolGapDropZone = ({ id, className }: CoolGapDropZoneProps) => {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={className || "h-6"}
    >
      {/* ドロップ可能だがハイライトは表示しない */}
    </div>
  );
};
