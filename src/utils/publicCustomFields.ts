import type { CustomCellData, DailyCustomData } from '../types';

/** A merged sequence cell belongs to every row covered by its rowSpan. */
export function getPublicSequenceValue(daily: DailyCustomData | undefined, sequence: number, columnId: string): string {
  const cells = daily?.bySequence;
  if (!cells) return '';
  const current = cells[sequence]?.[columnId];
  if (current?.rowSpan !== 0) return current?.value || '';

  for (let parentSequence = sequence - 1; parentSequence >= 1; parentSequence--) {
    const parent: CustomCellData | undefined = cells[parentSequence]?.[columnId];
    if (!parent || parent.rowSpan === 0) continue;
    return parent.rowSpan && parent.rowSpan > sequence - parentSequence ? parent.value : '';
  }
  return '';
}
