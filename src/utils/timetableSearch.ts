import type { Band } from '../types';

export type TimetableSearchSuggestion =
  | { type: 'member'; label: string }
  | { type: 'band'; label: string; bandId: string };

export const matchesTimetableBandSearch = (band: Band, searchQuery: string): boolean => {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return false;
  return band.name.toLowerCase().includes(query)
    || band.members.some(member => member.trim().toLowerCase() === query);
};

export const getTimetableSearchSuggestions = (bands: Band[], searchQuery: string): TimetableSearchSuggestion[] => {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return [];

  const members: TimetableSearchSuggestion[] = [];
  const seenMembers = new Set<string>();
  bands.forEach(band => band.members.forEach(member => {
    const name = member.trim();
    const key = name.toLowerCase();
    if (!name || !key.includes(query) || seenMembers.has(key)) return;
    seenMembers.add(key);
    members.push({ type: 'member', label: name });
  }));

  const matchingBands: TimetableSearchSuggestion[] = bands
    .filter(band => band.name.toLowerCase().includes(query))
    .map(band => ({ type: 'band', label: band.name, bandId: band.id }));

  return [...members, ...matchingBands].slice(0, 8);
};
