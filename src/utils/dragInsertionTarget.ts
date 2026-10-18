interface VerticalRect {
  top: number;
  height: number;
}

// Express a screen rectangle in the scrolling timetable's content coordinates.
export const toTimetableContentRect = (
  rect: VerticalRect,
  viewportTop: number,
  scrollTop: number,
): VerticalRect => ({ top: rect.top - viewportTop + scrollTop, height: rect.height });

// The leading edge crosses the adjacent card's midpoint once the dragged card overlaps it by half.
export const getEntryInsertionTarget = (
  activeId: string,
  overId: string,
  initial: VerticalRect,
  translated: VerticalRect,
  target: VerticalRect,
): string => {
  if (overId === activeId) return activeId;
  const movingUp = translated.top < initial.top;
  const leadingEdge = movingUp ? translated.top : translated.top + translated.height;
  const targetMiddle = target.top + target.height / 2;
  return (movingUp ? leadingEdge <= targetMiddle : leadingEdge >= targetMiddle)
    ? (movingUp ? overId : `${overId}-after`)
    : (movingUp ? `${overId}-after` : overId);
};

export const getCrossedEntryTarget = (
  activeId: string,
  initial: VerticalRect,
  translated: VerticalRect,
  rows: readonly (VerticalRect & { id: string })[],
  scrollDelta = 0,
): string => {
  const translatedTop = translated.top + scrollDelta;
  const movingUp = translatedTop < initial.top;
  const candidates = rows.filter(row => row.id !== activeId &&
    (movingUp ? row.top < initial.top : row.top > initial.top));
  const crossed = candidates.filter(row => movingUp
    ? translatedTop <= row.top + row.height / 2
    : translatedTop + translated.height >= row.top + row.height / 2);
  if (!crossed.length) return activeId;
  const target = movingUp
    ? crossed.reduce((a, b) => a.top < b.top ? a : b)
    : crossed.reduce((a, b) => a.top > b.top ? a : b);
  return movingUp ? target.id : `${target.id}-after`;
};

// Advance the gap against only its immediate visible neighbours. The rows move
// while the gap animates, so their drag-start coordinates cannot be reused.
export const getAdjacentEntryTarget = (
  activeId: string,
  currentTarget: string,
  preview: VerticalRect,
  rows: readonly (VerticalRect & { id: string })[],
): string => {
  const activeIndex = rows.findIndex(row => row.id === activeId);
  if (activeIndex < 0) return currentTarget;
  const remaining = rows.filter(row => row.id !== activeId);
  const after = currentTarget.endsWith('-after');
  const targetId = after ? currentTarget.slice(0, -6) : currentTarget;
  const targetIndex = remaining.findIndex(row => row.id === targetId);
  const slot = targetIndex < 0 ? activeIndex : targetIndex + Number(after);
  const previous = remaining[slot - 1];
  const next = remaining[slot];
  const previewCenter = preview.top + preview.height / 2;
  if (previous && (slot > activeIndex ? previewCenter : preview.top) <= previous.top + previous.height / 2) {
    return slot - 1 === activeIndex ? activeId : previous.id;
  }
  if (next && (slot < activeIndex ? previewCenter : preview.top + preview.height) >= next.top + next.height / 2) {
    return slot + 1 === activeIndex ? activeId : `${next.id}-after`;
  }
  return currentTarget;
};

// With the dragged row itself acting as the placeholder, compare the floating
// card only with rows on either side of that one slot. The placeholder stays
// in the table, so a move inside one cool never adds or removes a row.
export const getPlaceholderEntryTarget = (
  activeId: string,
  currentTarget: string,
  preview: VerticalRect,
  rows: readonly (VerticalRect & { id: string })[],
): string => {
  const ordered = [...rows].filter(row => row.height > 0).sort((a, b) => a.top - b.top);
  const slot = ordered.findIndex(row => row.id === activeId);
  if (slot < 0) return currentTarget;
  const placeholder = ordered[slot];
  if (preview.top < placeholder.top) {
    for (let index = slot - 1; index >= 0; index--) {
      const row = ordered[index];
      if (preview.top <= row.top + row.height / 2) return row.id;
    }
  } else if (preview.top > placeholder.top) {
    for (let index = slot + 1; index < ordered.length; index++) {
      const row = ordered[index];
      if (preview.top + preview.height >= row.top + row.height / 2) return `${row.id}-after`;
    }
  }
  return currentTarget;
};

// A dragged card has no placeholder row in a different cool. Pick a slot using
// only that cool's rows, then keep the slot until an adjacent card is crossed.
export const getDestinationCoolEntryTarget = (
  coolIndex: number,
  currentTarget: string | null,
  preview: VerticalRect,
  rows: readonly (VerticalRect & { id: string })[],
  options: { incomingFromBelow?: boolean; placeholder?: VerticalRect | null } = {},
): string => {
  const ordered = [...rows].filter(row => row.height > 0).sort((a, b) => a.top - b.top);
  if (!ordered.length) return `cool-droppable-${coolIndex}`;

  if (options.placeholder) {
    return getPlaceholderEntryTarget(
      'drag-placeholder',
      currentTarget ?? ordered[0].id,
      preview,
      [...ordered, { id: 'drag-placeholder', ...options.placeholder }],
    );
  }

  // The first frame in a new cool starts at the edge the card entered from.
  // Subsequent frames use the rendered placeholder and the same midpoint
  // swapping rule as an intra-cool drag.
  if (!currentTarget || !ordered.some(row => row.id === currentTarget.replace(/-after$/, ''))) {
    return options.incomingFromBelow
      ? `${ordered[ordered.length - 1].id}-after`
      : ordered[0].id;
  }

  const after = currentTarget?.endsWith('-after') ?? false;
  const targetId = after ? currentTarget!.slice(0, -6) : currentTarget;
  const targetIndex = ordered.findIndex(row => row.id === targetId);
  if (targetIndex < 0) {
    const center = preview.top + preview.height / 2;
    const next = ordered.find(row => center < row.top + row.height / 2);
    return next ? next.id : `${ordered[ordered.length - 1].id}-after`;
  }

  const slot = targetIndex + Number(after);
  for (let index = slot - 1; index >= 0; index--) {
    const row = ordered[index];
    if (preview.top <= row.top + row.height / 2) return row.id;
  }
  for (let index = slot; index < ordered.length; index++) {
    const row = ordered[index];
    if (preview.top + preview.height >= row.top + row.height / 2) return `${row.id}-after`;
  }
  return currentTarget!;
};

// Use the card's rendered position and the rows' current screen positions. This stays
// aligned with the preview even while the list scrolls or an insertion gap animates.
export const getVisibleEntryTarget = (
  activeId: string,
  source: VerticalRect,
  preview: VerticalRect,
  rows: readonly (VerticalRect & { id: string })[],
): string => {
  if (!rows.length) return activeId;
  const previewCenter = preview.top + preview.height / 2;
  const sourceCenter = source.top + source.height / 2;
  const target = rows.reduce((nearest, row) =>
    Math.abs(row.top + row.height / 2 - previewCenter) <
    Math.abs(nearest.top + nearest.height / 2 - previewCenter) ? row : nearest);
  const targetMiddle = target.top + target.height / 2;
  const movingUp = previewCenter < sourceCenter;
  return movingUp
    ? (preview.top <= targetMiddle ? target.id : `${target.id}-after`)
    : (preview.top + preview.height >= targetMiddle ? `${target.id}-after` : target.id);
};
