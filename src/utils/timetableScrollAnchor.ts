export interface TimetableScrollSnapshot {
  scroller: HTMLElement;
  top: number;
  anchor: HTMLElement | null;
  anchorTop: number;
}

export const captureTimetableScroll = (scroller: HTMLElement, draggedEntryId?: string): TimetableScrollSnapshot => {
  const viewport = scroller.getBoundingClientRect();
  const visibleRows = Array.from(scroller.querySelectorAll<HTMLElement>('[data-entry-id]'))
    .filter(row => {
      if (row.dataset.entryId === draggedEntryId) return false;
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
  // The first visible card remains a useful anchor even when only the tail
  // of a cool is on screen and its heading is far above the viewport.
  const anchor = visibleRows[0]
    ?? Array.from(scroller.querySelectorAll<HTMLElement>('[data-cool-index]'))
      .find(section => {
        const rect = section.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      })
    ?? null;
  return { scroller, top: scroller.scrollTop, anchor, anchorTop: anchor?.getBoundingClientRect().top ?? 0 };
};

export const restoreTimetableScroll = (snapshot: TimetableScrollSnapshot) => {
  const { scroller, top, anchor, anchorTop } = snapshot;
  if (!scroller.isConnected) return;
  scroller.scrollTop = top;
  if (anchor?.isConnected && scroller.contains(anchor)) {
    scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  }
};
