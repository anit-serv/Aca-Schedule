export const moveDraggedEntryPlaceholder = <T extends { id: string }>(
  entries: readonly T[],
  draggedEntryId: string,
  targetId: string | null,
  coolIndex: number,
): T[] => {
  const sourceIndex = entries.findIndex(entry => `entry-${entry.id}` === draggedEntryId);
  if (sourceIndex < 0) return [...entries];
  const source = entries[sourceIndex];
  const remaining = entries.filter((_, index) => index !== sourceIndex);
  let insertionIndex = sourceIndex;
  if (targetId && targetId !== draggedEntryId) {
    const after = targetId.endsWith('-after');
    const entryTargetId = after ? targetId.slice(0, -6) : targetId;
    const targetIndex = remaining.findIndex(entry => `entry-${entry.id}` === entryTargetId);
    if (targetIndex >= 0) insertionIndex = targetIndex + Number(after);
    else if (targetId === `cool-droppable-${coolIndex}` || targetId === `cool-gap-after-${coolIndex}`) insertionIndex = remaining.length;
    else if (targetId === `cool-header-${coolIndex}` || targetId === `cool-column-header-${coolIndex}` || targetId === `cool-gap-before-${coolIndex}`) insertionIndex = 0;
  }
  remaining.splice(insertionIndex, 0, source);
  return remaining;
};

export const getDestinationPlaceholderIndex = <T extends { id: string }>(
  entries: readonly T[],
  targetId: string | null,
  coolIndex: number,
): number => {
  if (!targetId) return 0;
  const after = targetId.endsWith('-after');
  const entryTargetId = after ? targetId.slice(0, -6) : targetId;
  const targetIndex = entries.findIndex(entry => `entry-${entry.id}` === entryTargetId);
  if (targetIndex >= 0) return targetIndex + Number(after);
  if (targetId === `cool-droppable-${coolIndex}` || targetId === `cool-gap-after-${coolIndex}`) return entries.length;
  return 0;
};
