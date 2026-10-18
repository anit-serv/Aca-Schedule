import { describe, expect, it } from 'vitest';
import { getAdjacentEntryTarget, getCrossedEntryTarget, getDestinationCoolEntryTarget, getEntryInsertionTarget, getPlaceholderEntryTarget, getVisibleEntryTarget, toTimetableContentRect } from './dragInsertionTarget';

describe('getDestinationCoolEntryTarget', () => {
  const rows = [
    { id: 'entry-next-a', top: 200, height: 56 },
    { id: 'entry-next-b', top: 256, height: 56 },
  ];

  it('creates a placeholder at the head of the destination cool', () => {
    expect(getDestinationCoolEntryTarget(1, 'entry-source', { top: 155, height: 56 }, rows))
      .toBe('entry-next-a');
  });

  it('advances within the destination cool when the next card is half covered', () => {
    expect(getDestinationCoolEntryTarget(1, 'entry-next-a', { top: 229, height: 56 }, rows))
      .toBe('entry-next-a-after');
  });

  it('supports an empty destination cool', () => {
    expect(getDestinationCoolEntryTarget(2, 'entry-source', { top: 400, height: 56 }, []))
      .toBe('cool-droppable-2');
  });

  it('enters an upper cool from its bottom edge', () => {
    expect(getDestinationCoolEntryTarget(0, 'entry-source', { top: 270, height: 56 }, rows, { incomingFromBelow: true }))
      .toBe('entry-next-b-after');
  });

  it('swaps the destination placeholder past the adjacent card at its midpoint', () => {
    const placeholder = { top: 312, height: 56 };
    expect(getDestinationCoolEntryTarget(0, 'entry-next-b-after', { top: 285, height: 56 }, rows, { placeholder }))
      .toBe('entry-next-b-after');
    expect(getDestinationCoolEntryTarget(0, 'entry-next-b-after', { top: 283, height: 56 }, rows, { placeholder }))
      .toBe('entry-next-b');
  });
});

describe('getPlaceholderEntryTarget', () => {
  const rows = [
    { id: 'entry-a', top: 100, height: 84 },
    { id: 'entry-b', top: 184, height: 84 },
    { id: 'entry-c', top: 268, height: 84 },
  ];

  it('keeps one source slot until the card crosses half the next row', () => {
    expect(getPlaceholderEntryTarget('entry-a', 'entry-a', { top: 141, height: 84 }, rows)).toBe('entry-a');
    expect(getPlaceholderEntryTarget('entry-a', 'entry-a', { top: 142, height: 84 }, rows)).toBe('entry-b-after');
  });

  it('uses the moved placeholder position to swap back without a second gap', () => {
    const moved = [rows[1], { ...rows[0], top: 184 }, rows[2]];
    expect(getPlaceholderEntryTarget('entry-a', 'entry-b-after', { top: 141, height: 84 }, moved)).toBe('entry-b');
  });
});

const source = { top: 100, height: 56 };

describe('getEntryInsertionTarget', () => {
  it('keeps the source slot selected at drag start', () => {
    expect(getEntryInsertionTarget('entry-a', 'entry-a', source, source, source)).toBe('entry-a');
  });

  it('moves above the previous card once more than half overlaps', () => {
    const previous = { top: 44, height: 56 };
    expect(getEntryInsertionTarget('entry-a', 'entry-prev', source, { top: 73, height: 56 }, previous)).toBe('entry-prev-after');
    expect(getEntryInsertionTarget('entry-a', 'entry-prev', source, { top: 72, height: 56 }, previous)).toBe('entry-prev');
  });

  it('moves below the next card once more than half overlaps', () => {
    const next = { top: 156, height: 56 };
    expect(getEntryInsertionTarget('entry-a', 'entry-next', source, { top: 127, height: 56 }, next)).toBe('entry-next');
    expect(getEntryInsertionTarget('entry-a', 'entry-next', source, { top: 128, height: 56 }, next)).toBe('entry-next-after');
  });
});

describe('getVisibleEntryTarget', () => {
  it('places the gap beside the rendered card after scrolling moves rows on screen', () => {
    const rows = [
      { id: 'entry-5', top: 640, height: 84 },
      { id: 'entry-6', top: 810, height: 84 },
      { id: 'entry-8', top: 1000, height: 84 },
    ];
    expect(getVisibleEntryTarget('entry-3', { top: 100, height: 84 }, { top: 915, height: 84 }, rows))
      .toBe('entry-8');
  });
});

describe('getCrossedEntryTarget', () => {
  const rows = [
    { id: 'entry-prev', top: 44, height: 56 },
    { id: 'entry-a', top: 100, height: 56 },
    { id: 'entry-next', top: 156, height: 56 },
  ];

  it('keeps the original gap until the adjacent card is half covered', () => {
    expect(getCrossedEntryTarget('entry-a', source, { top: 73, height: 56 }, rows)).toBe('entry-a');
    expect(getCrossedEntryTarget('entry-a', source, { top: 72, height: 56 }, rows)).toBe('entry-prev');
    expect(getCrossedEntryTarget('entry-a', source, { top: 127, height: 56 }, rows)).toBe('entry-a');
    expect(getCrossedEntryTarget('entry-a', source, { top: 128, height: 56 }, rows)).toBe('entry-next-after');
  });

  it('advances the insertion gap when the timetable scrolls under a stationary dragged card', () => {
    expect(getCrossedEntryTarget('entry-a', source, source, rows)).toBe('entry-a');
    expect(getCrossedEntryTarget('entry-a', source, source, rows, 28)).toBe('entry-next-after');
  });
});

describe('getAdjacentEntryTarget', () => {
  const rows = [
    { id: 'entry-a', top: 100, height: 84 },
    { id: 'entry-b', top: 184, height: 84 },
    { id: 'entry-c', top: 268, height: 84 },
  ];

  it('advances only one adjacent row when the preview jumps across several original positions', () => {
    expect(getAdjacentEntryTarget('entry-a', 'entry-a', { top: 280, height: 84 }, rows))
      .toBe('entry-b-after');
  });

  it('uses the neighbouring card after the visible gap moves', () => {
    const movedRows = [rows[0], { ...rows[1], top: 100 }, rows[2]];
    expect(getAdjacentEntryTarget('entry-a', 'entry-b-after', { top: 240, height: 84 }, movedRows))
      .toBe('entry-c-after');
  });

  it('returns to the source gap one row at a time', () => {
    const movedRows = [rows[0], { ...rows[1], top: 100 }, rows[2]];
    expect(getAdjacentEntryTarget('entry-a', 'entry-b-after', { top: 100, height: 84 }, movedRows))
      .toBe('entry-a');
  });

  it('does not reverse immediately when the crossed neighbour slides into the source slot', () => {
    const movedRows = [rows[0], { ...rows[1], top: 100 }, rows[2]];
    expect(getAdjacentEntryTarget('entry-a', 'entry-b-after', { top: 142, height: 84 }, movedRows))
      .toBe('entry-b-after');
  });
});

describe('timetable content coordinates', () => {
  it('uses the inner scroll position to align a grabbed card and insertion row', () => {
    const viewportTop = 400;
    const rows = [
      { id: 'entry-a', ...toTimetableContentRect({ top: 500, height: 80 }, viewportTop, 0) },
      { id: 'entry-next', ...toTimetableContentRect({ top: 580, height: 80 }, viewportTop, 0) },
    ];
    // The inner timetable scrolls by 80px while the grabbed card stays at the
    // same screen position. Its content position must move to the next slot.
    const preview = toTimetableContentRect({ top: 500, height: 80 }, viewportTop, 80);
    expect(getCrossedEntryTarget('entry-a', rows[0], preview, rows)).toBe('entry-next-after');
  });
});
