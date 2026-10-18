import { describe, expect, it } from 'vitest';
import { getDestinationPlaceholderIndex, moveDraggedEntryPlaceholder } from './dragPlaceholderOrder';

const entries = ['a', 'b', 'c', 'd'].map(id => ({ id }));

describe('moveDraggedEntryPlaceholder', () => {
  it('replaces the source card with one slot from drag start', () => {
    expect(moveDraggedEntryPlaceholder(entries, 'entry-b', 'entry-b', 0).map(entry => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves that same slot without changing the cool row count', () => {
    const moved = moveDraggedEntryPlaceholder(entries, 'entry-b', 'entry-c-after', 0);
    expect(moved.map(entry => entry.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(moved).toHaveLength(entries.length);
  });

  it('moves to the cool header or end', () => {
    expect(moveDraggedEntryPlaceholder(entries, 'entry-b', 'cool-header-0', 0).map(entry => entry.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveDraggedEntryPlaceholder(entries, 'entry-b', 'cool-droppable-0', 0).map(entry => entry.id)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('getDestinationPlaceholderIndex', () => {
  it('places a cross-cool gap at either edge or between cards', () => {
    expect(getDestinationPlaceholderIndex(entries, 'entry-d-after', 0)).toBe(4);
    expect(getDestinationPlaceholderIndex(entries, 'entry-a', 0)).toBe(0);
    expect(getDestinationPlaceholderIndex(entries, 'entry-c', 0)).toBe(2);
  });
});
