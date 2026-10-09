import type { Band, TimetableEntry } from '../types';
import { normalizeTimeRanges } from './availabilityRanges';

const minutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

export type AvailabilityResult = 'normal' | 'backup' | 'outside';

export const checkBandAvailability = (
  band: Band, date: string, startTime: string, endTime: string, allowBackup = false,
): AvailabilityResult => {
  const normal = band.availableTimeSlots.find(slot => slot.date === date)?.timeRanges ?? [];
  const backup = allowBackup
    ? band.backupRehearsalTimeSlots?.find(slot => slot.date === date)?.timeRanges ?? []
    : [];
  const contains = (ranges: typeof normal): boolean => normalizeTimeRanges(ranges).some(range =>
    minutes(startTime) >= minutes(range.startTime) && minutes(endTime) <= minutes(range.endTime));
  if (contains(normal)) return 'normal';
  if (allowBackup && contains([...normal, ...backup])) return 'backup';
  return 'outside';
};

export interface EntryWithCool {
  entry: TimetableEntry;
  coolId?: string;
}

export interface ConsecutiveMemberRun {
  entries: EntryWithCool[];
  members: string[];
}

export const findConsecutiveMemberRuns = (
  entries: EntryWithCool[], bandMap: Map<string, Band>,
): ConsecutiveMemberRun[] => {
  const groups = new Map<string, ConsecutiveMemberRun>();
  entries.forEach((item, start) => {
    if (item.entry.type !== 'band' || !item.entry.bandId) return;
    const band = bandMap.get(item.entry.bandId);
    if (!band) return;
    for (const member of new Set(band.members.filter(Boolean))) {
      const previousItem = entries[start - 1];
      const previous = previousItem?.entry;
      if (previousItem?.coolId === item.coolId && previous?.type === 'band' && previous.bandId
        && bandMap.get(previous.bandId)?.members.includes(member)) continue;
      let end = start + 1;
      while (end < entries.length) {
        if (entries[end].coolId !== item.coolId) break;
        const next = entries[end].entry;
        if (next.type !== 'band' || !next.bandId || !bandMap.get(next.bandId)?.members.includes(member)) break;
        end++;
      }
      if (end - start < 2) continue;
      const run = entries.slice(start, end);
      const key = run.map(({ entry }) => entry.id).join(':');
      const group = groups.get(key);
      if (group) group.members.push(member);
      else groups.set(key, { entries: run, members: [member] });
    }
  });
  return [...groups.values()];
};
