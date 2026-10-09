import { describe, expect, it } from 'vitest';
import type { Band } from '../types';
import { getTimetableSearchSuggestions, matchesTimetableBandSearch } from './timetableSearch';

const bands = [
  { id: '1', name: 'KissHug', members: ['Alice', 'Bob'] },
  { id: '2', name: 'Alice Band', members: ['Alice', 'Carol'] },
  { id: '3', name: 'Another', members: ['ALICE', 'Dave'] },
] as Band[];

describe('timetable member search', () => {
  it('matches member names only in full while keeping partial band-name matches', () => {
    expect(matchesTimetableBandSearch(bands[0], 'ali')).toBe(false);
    expect(matchesTimetableBandSearch(bands[0], 'alice')).toBe(true);
    expect(matchesTimetableBandSearch(bands[1], 'ali')).toBe(true);
  });

  it('suggests each member once, before bands', () => {
    expect(getTimetableSearchSuggestions(bands, 'ali')).toEqual([
      { type: 'member', label: 'Alice' },
      { type: 'band', label: 'Alice Band', bandId: '2' },
    ]);
  });
});
