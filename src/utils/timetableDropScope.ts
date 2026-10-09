import type { DragEndEvent } from '@dnd-kit/core';

export type TimetableKind = 'performance' | 'rehearsal';

/** Reject a drop visually aimed at the other timetable or its band bank. */
export const isDropWithinTimetableScope = (event: DragEndEvent, activeKind: TimetableKind): boolean => {
  if (typeof document === 'undefined') return true;
  const rect = event.active.rect.current.translated;
  if (!rect) return true;
  const elements = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const target = elements.map(element => element.closest<HTMLElement>('[data-timetable-kind], [data-band-bank-kind]'))
    .find(Boolean);
  const targetKind = target?.dataset.timetableKind || target?.dataset.bandBankKind;
  return !targetKind || targetKind === activeKind;
};
