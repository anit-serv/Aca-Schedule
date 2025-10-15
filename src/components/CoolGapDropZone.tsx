import { useDroppable } from '@dnd-kit/core';

interface CoolGapDropZoneProps {
  id: string;
}

export const CoolGapDropZone = ({ id }: CoolGapDropZoneProps) => {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className="h-6"
    >
      {/* ドロップ可能だがハイライトは表示しない */}
    </div>
  );
};
