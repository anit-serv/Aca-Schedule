import type { AvailableTimeSlot, Band, Cool, CustomFieldsSettings, DailyTimetable, Timetable, TimetableEntry } from '../types';
import { generateUUID } from './generateUUID';
import { getEntriesWithCoolInfo, hasAnySequenceData, reconcileShiftForDay, shiftSequenceDataForInsertion } from './customFieldsUtils';
import { isValidCoolStart } from './dailyTimeBounds';
import { normalizeTimeRanges } from './availabilityRanges';
import { checkBandAvailability, findConsecutiveMemberRuns } from './scheduleChecks';

const minutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const clockTime = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

const available = (band: Band, date: string, start: number, end: number): boolean => {
  return checkBandAvailability(band, date, clockTime(start), clockTime(end)) === 'normal';
};

const earliestStart = (band: Band, date: string, from: number): number | null => {
  const slot = band.availableTimeSlots.find(item => item.date === date);
  if (!slot || slot.timeRanges.length === 0) return null;
  for (const range of [...slot.timeRanges].sort((a, b) => minutes(a.startTime) - minutes(b.startTime))) {
    const start = Math.max(from, minutes(range.startTime));
    if (start + band.performanceDuration <= Math.min(1440, minutes(range.endTime))) return start;
  }
  return null;
};

const availabilityFlexibility = (band: Band, dates: string[]): number => dates.reduce((total, date) => {
  const slot = band.availableTimeSlots.find(item => item.date === date);
  if (!slot || slot.timeRanges.length === 0) return total;
  return total + slot.timeRanges.reduce((minutesAvailable, range) =>
    minutesAvailable + Math.max(0, minutes(range.endTime) - minutes(range.startTime) - band.performanceDuration), 0);
}, 0);

const entriesOf = (day: DailyTimetable): TimetableEntry[] => day.cools.flatMap(cool => cool.entries);

const coolStarts = (day: DailyTimetable, linkedCools?: Cool[]): number[] => {
  let cursor = minutes(day.startTime);
  return day.cools.map((cool, index) => {
    if (cool.startTime) cursor = minutes(cool.startTime);
    const rehearsalEnd = linkedCools?.[index]?.entries.at(-1)?.endTime;
    if (rehearsalEnd && !cool.startTime) cursor = minutes(rehearsalEnd);
    const start = cursor;
    const lastEnd = cool.entries.at(-1)?.endTime;
    if (lastEnd) cursor = minutes(lastEnd);
    return start;
  });
};

/** Preserve cool starts and entry order, using only the wait required by availability. */
const retimeDay = (day: DailyTimetable, bandMap: Map<string, Band>, linkedCools?: Cool[]): DailyTimetable | null => {
  let cursor = minutes(day.startTime);
  const cools: Cool[] = [];
  for (let index = 0; index < day.cools.length; index++) {
    const cool = day.cools[index];
    if (cool.startTime) cursor = minutes(cool.startTime);
    else {
      const rehearsalEnd = linkedCools?.[index]?.entries.at(-1)?.endTime;
      if (rehearsalEnd) cursor = minutes(rehearsalEnd);
    }
    if (index > 0) {
      const previousEnd = cools[index - 1].entries.at(-1)?.endTime;
      if (previousEnd && cursor < minutes(previousEnd)) return null;
    }
    const entries: TimetableEntry[] = [];
    for (const entry of cool.entries) {
      const band = entry.bandId ? bandMap.get(entry.bandId) : undefined;
      const start = entry.fixedStartTime ? minutes(entry.fixedStartTime) : band ? earliestStart(band, day.date, cursor) : cursor;
      if (start === null) return null;
      if (start < cursor) return null;
      const end = start + (band?.performanceDuration ?? entry.customEvent?.duration ?? 0);
      if (end > 1440 || (day.endTime && end > minutes(day.endTime))) return null;
      const nextCoolStart = day.cools[index + 1]?.startTime;
      if (nextCoolStart && end > minutes(nextCoolStart)) return null;
      entries.push({ ...entry, startTime: clockTime(start), endTime: clockTime(end), transitionTime: start - cursor, order: entries.length });
      cursor = end;
    }
    cools.push({ ...cool, entries });
  }
  return { ...day, cools };
};

const validTimes = (day: DailyTimetable, bandMap: Map<string, Band>, linkedCools?: Cool[]): boolean => {
  if (day.endTime && minutes(day.startTime) >= minutes(day.endTime)) return false;
  const starts = coolStarts(day, linkedCools);
  for (let index = 0; index < day.cools.length; index++) {
    const cool = day.cools[index];
    if (cool.startTime && !isValidCoolStart(day, index, cool.startTime)) return false;
    const lastEnd = cool.entries.at(-1)?.endTime;
    if (lastEnd && (minutes(lastEnd) > 1440 || (index + 1 < starts.length && minutes(lastEnd) > starts[index + 1]))) return false;
    for (const entry of cool.entries) {
      if (!entry.startTime || !entry.endTime || minutes(entry.endTime) > 1440
        || (day.endTime && minutes(entry.endTime) > minutes(day.endTime))) return false;
      if (entry.fixedStartTime && entry.startTime !== entry.fixedStartTime) return false;
      const band = entry.bandId ? bandMap.get(entry.bandId) : undefined;
      if (band && !available(band, day.date, minutes(entry.startTime), minutes(entry.endTime))) return false;
    }
  }
  return true;
};

export interface AutoScheduleScore {
  sameCoolRepeats: number;
  longRunPenalty: number;
  costumeTwoRunPenalty: number;
  twoRunPenalty: number;
  priority3Missing: number;
  priority2Missing: number;
  coolCountDispersion: number;
  dayCountDispersion: number;
  transitionMinutes: number;
  preferencePenalty: number;
}

const distributionPenalty = (score: AutoScheduleScore): number =>
  score.coolCountDispersion + score.dayCountDispersion;

const seededRandom = (key: string): (() => number) => {
  let state = 2166136261;
  for (let index = 0; index < key.length; index++) state = Math.imul(state ^ key.charCodeAt(index), 16777619);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

export const compareAutoScheduleScores = (a: AutoScheduleScore, b: AutoScheduleScore): number =>
  a.sameCoolRepeats - b.sameCoolRepeats
  || a.longRunPenalty - b.longRunPenalty
  || a.costumeTwoRunPenalty - b.costumeTwoRunPenalty
  || a.priority3Missing - b.priority3Missing
  || a.priority2Missing - b.priority2Missing
  || a.transitionMinutes - b.transitionMinutes
  || a.twoRunPenalty - b.twoRunPenalty
  || distributionPenalty(a) - distributionPenalty(b)
  || a.preferencePenalty - b.preferencePenalty;

export const scoreSchedule = (days: DailyTimetable[], bandMap: Map<string, Band>): AutoScheduleScore => {
  const score: AutoScheduleScore = { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, coolCountDispersion: 0, dayCountDispersion: 0, transitionMinutes: 0, preferencePenalty: 0 };
  const finalDate = days.at(-1)?.date;
  const finalCoolIndex = (days.at(-1)?.cools.length ?? 1) - 1;
  const priority2Distances = new Map<string, number>();
  const priority3Seen = new Set<string>();
  const priority3InFinalCool = new Set<string>();
  const bandDays = new Map<string, Map<string, number>>();
  for (const day of days) {
    for (const entry of entriesOf(day)) score.transitionMinutes += Math.max(0, entry.transitionTime ?? 0);
    const entriesWithCool = day.cools.flatMap(cool => cool.entries.map(entry => ({ entry, coolId: cool.id })));
    for (const run of findConsecutiveMemberRuns(entriesWithCool, bandMap)) {
      for (let index = 1; index < run.entries.length; index++) {
        const band = bandMap.get(run.entries[index].entry.bandId!)!;
        const previous = bandMap.get(run.entries[index - 1].entry.bandId!)!;
        const penalty = run.members.length * 12 * 3 ** (index - 1);
        const costume = band.costume || previous.costume;
        const weightedPenalty = penalty * (costume ? 4 : 1);
        if (index === 1) {
          score.twoRunPenalty += weightedPenalty;
          if (costume) score.costumeTwoRunPenalty += weightedPenalty;
        } else score.longRunPenalty += weightedPenalty;
        score.preferencePenalty += weightedPenalty;
      }
    }
    day.cools.forEach((cool, coolIndex) => {
      const bandCount = cool.entries.filter(entry => entry.type === 'band').length;
      // With a fixed number of bands and cools, minimizing the sum of squares minimizes variance.
      score.coolCountDispersion += bandCount * bandCount;
      const seenInCool = new Map<string, number>();
      cool.entries.forEach((entry, position) => {
        const band = entry.bandId ? bandMap.get(entry.bandId) : undefined;
        if (!band) return;
        if (band.performanceCount > 1) {
          const dateCounts = bandDays.get(band.id) ?? new Map<string, number>();
          dateCounts.set(day.date, (dateCounts.get(day.date) ?? 0) + 1);
          bandDays.set(band.id, dateCounts);
        }
        score.sameCoolRepeats += seenInCool.get(band.id) ?? 0;
        seenInCool.set(band.id, (seenInCool.get(band.id) ?? 0) + 1);
        if (band.toriPriority === 2) {
          const distance = cool.entries.length - position - 1;
          priority2Distances.set(band.id, Math.min(priority2Distances.get(band.id) ?? Infinity, distance));
        }
        if (band.toriPriority === 3) {
          priority3Seen.add(band.id);
          if (day.date === finalDate && coolIndex === finalCoolIndex) priority3InFinalCool.add(band.id);
        }
      });
    });
  }
  for (const dateCounts of bandDays.values()) {
    for (const count of dateCounts.values()) score.dayCountDispersion += count * count;
  }
  for (const distance of priority2Distances.values()) {
    if (distance > 0) score.priority2Missing++;
    score.preferencePenalty += distance * 2 + (distance > 0 ? 100 : 0);
  }
  for (const bandId of priority3Seen) {
    if (!priority3InFinalCool.has(bandId)) {
      score.priority3Missing++;
      score.preferencePenalty += 300;
    }
  }
  return score;
};

const addAt = (day: DailyTimetable, band: Band, coolIndex: number, position: number, bandMap: Map<string, Band>, linkedCools?: Cool[], entryId?: string): DailyTimetable | null => {
  const cool = day.cools[coolIndex];
  const inserted: TimetableEntry = { id: entryId ?? generateUUID(), type: 'band', bandId: band.id, order: position };
  const updatedEntries = [...cool.entries];
  updatedEntries.splice(position, 0, inserted);
  const cools = day.cools.map((item, index) => index === coolIndex ? { ...item, entries: updatedEntries } : item);
  const result = retimeDay({ ...day, cools }, bandMap, linkedCools);
  return result && validTimes(result, bandMap, linkedCools) ? result : null;
};

export interface AutoScheduleResult {
  dailyTimetables: DailyTimetable[];
  placed: number;
  remaining: number;
  error?: string;
}

export interface AutoScheduleRange { startNumber: number; endNumber: number }

/** Reorder only already-placed, unfixed band entries inside the global band-number range. */
export const autoScheduleRange = (
  timetable: Timetable, bands: Band[], range: AutoScheduleRange, linkedRehearsal?: Timetable | null,
): AutoScheduleResult => {
  const original = timetable.dailyTimetables;
  const numbered = [...original].sort((a, b) => a.date.localeCompare(b.date))
    .flatMap(day => day.cools.flatMap(cool => cool.entries.filter(entry => entry.type === 'band')));
  if (!Number.isSafeInteger(range.startNumber) || !Number.isSafeInteger(range.endNumber)
    || range.startNumber < 1 || range.endNumber > numbered.length || range.startNumber >= range.endNumber) {
    return { dailyTimetables: original, placed: 0, remaining: 0, error: '出演番号の範囲を確認してください。' };
  }
  const movableIds = new Set(numbered.slice(range.startNumber - 1, range.endNumber)
    .filter(entry => !entry.fixedStartTime).map(entry => entry.id));
  if (movableIds.size < 2) return { dailyTimetables: original, placed: 0, remaining: 0 };

  const bandMap = new Map(bands.map(band => [band.id, band]));
  const linkedByDate = new Map(linkedRehearsal?.dailyTimetables.map(day => [day.date, day.cools]) ?? []);
  const outsideEntries = new Map(original.flatMap(day => day.cools.flatMap(cool => cool.entries))
    .filter(entry => !movableIds.has(entry.id)).map(entry => [entry.id, entry]));
  const frozen = original.map(day => ({ ...day, cools: day.cools.map(cool => ({ ...cool, entries: cool.entries.map(entry =>
    !movableIds.has(entry.id) && entry.startTime && !entry.fixedStartTime
      ? { ...entry, fixedStartTime: entry.startTime } : entry) })) }));
  const prepared = frozen.map(day => retimeDay(day, bandMap, linkedByDate.get(day.date)));
  if (prepared.some(day => !day) || prepared.some(day => day && !validTimes(day, bandMap, linkedByDate.get(day.date)))) {
    return { dailyTimetables: original, placed: 0, remaining: 0, error: '現在の配置に時刻または出演可能時間の矛盾があります。先に修正してください。' };
  }
  const slots = prepared.flatMap((day, dayIndex) => day!.cools.flatMap((cool, coolIndex) =>
    cool.entries.flatMap((entry, entryIndex) => movableIds.has(entry.id) ? [{ dayIndex, coolIndex, entryIndex }] : [])));
  const swap = (days: DailyTimetable[], first: typeof slots[number], second: typeof slots[number]): DailyTimetable[] | null => {
    const changed = days.map((day, dayIndex) => first.dayIndex === dayIndex || second.dayIndex === dayIndex
      ? { ...day, cools: day.cools.map((cool, coolIndex) =>
        first.dayIndex === dayIndex && first.coolIndex === coolIndex || second.dayIndex === dayIndex && second.coolIndex === coolIndex
          ? { ...cool, entries: [...cool.entries] } : cool) } : day);
    const left = changed[first.dayIndex].cools[first.coolIndex].entries;
    const right = changed[second.dayIndex].cools[second.coolIndex].entries;
    [left[first.entryIndex], right[second.entryIndex]] = [right[second.entryIndex], left[first.entryIndex]];
    for (const index of new Set([first.dayIndex, second.dayIndex])) {
      const retimed = retimeDay(changed[index], bandMap, linkedByDate.get(changed[index].date));
      if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(retimed.date))) return null;
      changed[index] = retimed;
    }
    return changed;
  };

  let best = prepared as DailyTimetable[];
  let bestScore = scoreSchedule(best, bandMap);
  const random = seededRandom(`${timetable.eventId}|range|${range.startNumber}|${range.endNumber}|${numbered.map(entry => entry.bandId).join('|')}`);
  const pairs = slots.flatMap((first, firstIndex) => slots.slice(firstIndex + 1).map(second => [first, second] as const));
  for (let pass = 0; pass < Math.min(5, slots.length); pass++) {
    let next: DailyTimetable[] | null = null;
    let nextScore = bestScore;
    const candidates = pairs.length <= 400 ? pairs : Array.from({ length: 400 }, () => pairs[Math.floor(random() * pairs.length)]);
    for (const [first, second] of candidates) {
      const candidate = swap(best, first, second);
      if (!candidate) continue;
      const candidateScore = scoreSchedule(candidate, bandMap);
      if (compareAutoScheduleScores(candidateScore, nextScore) < 0) { next = candidate; nextScore = candidateScore; }
    }
    if (!next) break;
    best = next;
    bestScore = nextScore;
  }

  const result = best.map(day => ({ ...day, cools: day.cools.map(cool => ({ ...cool, entries: cool.entries.map(entry =>
    outsideEntries.get(entry.id) || entry) })) }));
  const initialIds = original.flatMap(day => day.cools.flatMap(cool => cool.entries.map(entry => entry.id)));
  const resultIds = result.flatMap(day => day.cools.flatMap(cool => cool.entries.map(entry => entry.id)));
  const moved = resultIds.filter((id, index) => id !== initialIds[index]).length;
  return { dailyTimetables: result, placed: moved, remaining: 0 };
};

export const shiftAutoScheduleCustomFields = (
  before: Timetable,
  after: DailyTimetable[],
  customFields?: CustomFieldsSettings,
  type: 'performance' | 'rehearsal' = 'performance',
): CustomFieldsSettings | undefined => {
  if (!customFields) return undefined;
  let updated = customFields;
  for (const day of after) {
    if (hasAnySequenceData(updated, type, day.date)) {
      const original = before.dailyTimetables.find(item => item.date === day.date);
      const oldIds = new Set(original ? getEntriesWithCoolInfo(original).map(entry => entry.entryId) : []);
      const positions = getEntriesWithCoolInfo(day)
        .filter(entry => !oldIds.has(entry.entryId))
        .map(entry => entry.sequenceNumber);
      for (const position of positions) updated = shiftSequenceDataForInsertion(updated, type, day.date, position);
    }
    updated = reconcileShiftForDay(updated, type, day);
  }
  return updated === customFields ? undefined : updated;
};

/** Add missing performances across all dates without changing the order or cool of existing entries. */
export interface AutoScheduleTarget { bandId: string; date?: string }

export const autoSchedulePerformance = (
  timetable: Timetable, dates: string[], bands: Band[], linkedRehearsal?: Timetable | null,
  targets?: AutoScheduleTarget[],
): AutoScheduleResult => {
  const bandMap = new Map(bands.map(band => [band.id, band]));
  const linkedByDate = new Map(linkedRehearsal?.dailyTimetables.map(day => [day.date, day.cools]) ?? []);
  const days = [...dates].sort().map(date => {
    const existing = timetable.dailyTimetables.find(day => day.date === date);
    const day: DailyTimetable = existing
      ? { ...existing, cools: existing.cools?.length ? existing.cools : [{ id: `cool-1-${date}`, number: 1, entries: existing.entries ?? [] }], entries: [] }
      : { date, startTime: '10:00', cools: [{ id: `cool-1-${date}`, number: 1, entries: [] }], entries: [] };
    return retimeDay(day, bandMap, linkedByDate.get(date)) ?? day;
  });
  if (!days.length) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: 0 };
  const counts = new Map<string, number>();
  const countsByDate = new Map<string, number>();
  timetable.dailyTimetables.forEach(day => {
    const entries = day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries;
    entries.forEach(entry => {
      if (entry.type !== 'band' || !entry.bandId) return;
      counts.set(entry.bandId, (counts.get(entry.bandId) ?? 0) + 1);
      const key = `${day.date}:${entry.bandId}`;
      countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
    });
  });
  const missing = targets
    ? targets.flatMap(target => {
      const band = bandMap.get(target.bandId);
      if (!band) return [];
      const key = target.date ? `${target.date}:${band.id}` : band.id;
      const used = target.date ? countsByDate.get(key) ?? 0 : counts.get(key) ?? 0;
      const matchingTargets = targets.filter(item => item.bandId === target.bandId && item.date === target.date);
      return matchingTargets.indexOf(target) >= used ? [{ band, date: target.date }] : [];
    })
    : bands.flatMap(band => Array.from({ length: Math.max(0, band.performanceCount - (counts.get(band.id) ?? 0)) }, () => ({ band, date: undefined as string | undefined })));
  const invalid = days.find(day => !validTimes(day, bandMap, linkedByDate.get(day.date)));
  if (invalid) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: missing.length, error: `${invalid.date} の既存配置に出演可能時間外、終了時刻超過、またはクール開始時刻の矛盾があります。先に修正してください。` };
  if (!missing.length) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: 0 };
  const random = seededRandom(`${timetable.eventId}|${dates.join('|')}|${bands.map(band => band.id).sort().join('|')}`);
  missing.sort((a, b) => a.band.id.localeCompare(b.band.id) || (a.date || '').localeCompare(b.date || ''));

  let bestDays = days;
  let bestPlaced = -1;
  let bestScore: AutoScheduleScore = { sameCoolRepeats: Infinity, longRunPenalty: Infinity, costumeTwoRunPenalty: Infinity, twoRunPenalty: Infinity, priority3Missing: Infinity, priority2Missing: Infinity, coolCountDispersion: Infinity, dayCountDispersion: Infinity, transitionMinutes: Infinity, preferencePenalty: Infinity };
  for (let pass = 0; pass < (missing.length > 40 ? 8 : 16); pass++) {
    let current = days;
    const pending = [...missing]
      .map(target => ({ target, flexibility: availabilityFlexibility(target.band, target.date ? [target.date] : dates), tie: random() }))
      .sort((a, b) => a.flexibility - b.flexibility || a.tie - b.tie)
      .map(item => item.target);
    let placed = 0;
    while (pending.length > 0) {
      const { band, date: requiredDate } = pending[0];
      const options: Array<{ days: DailyTimetable[]; score: AutoScheduleScore }> = [];
      current.forEach((day, dayIndex) => {
        if (requiredDate && day.date !== requiredDate) return;
        day.cools.forEach((cool, coolIndex) => {
        for (let position = 0; position <= cool.entries.length; position++) {
          const candidate = addAt(day, band, coolIndex, position, bandMap, linkedByDate.get(day.date));
          if (!candidate) continue;
          const candidateDays = current.map((item, index) => index === dayIndex ? candidate : item);
          options.push({ days: candidateDays, score: scoreSchedule(candidateDays, bandMap) });
        }
        });
      });
      if (!options.length) {
        pending.shift();
        continue;
      }
      options.sort((a, b) => compareAutoScheduleScores(a.score, b.score));
      const chosen = options[pass === 0 ? 0 : Math.floor(random() * Math.min(4, options.length))];
      current = chosen.days;
      pending.shift();
      placed++;
    }
    const score = scoreSchedule(current, bandMap);
    if (placed > bestPlaced || (placed === bestPlaced && compareAutoScheduleScores(score, bestScore) < 0)) { bestDays = current; bestPlaced = placed; bestScore = score; }
    if (bestPlaced === missing.length && pass >= 2) break;
  }
  // Simulated annealing refines the soft preferences after the maximum feasible placement is found.
  const originalIds = new Set(days.flatMap(day => entriesOf(day).map(entry => entry.id)));
  let annealed = bestDays;
  let annealedScore = bestScore;
  const steps = targets?.some(target => target.date) ? 0 : Math.min(600, Math.max(100, bestPlaced * 20));
  for (let step = 0; step < steps && bestPlaced > 0; step++) {
    const movable = annealed.flatMap((day, dayIndex) => day.cools.flatMap((cool, coolIndex) =>
      cool.entries.filter(entry => entry.bandId && !originalIds.has(entry.id)).map(entry => ({ dayIndex, coolIndex, entry }))));
    if (!movable.length) break;
    const conflicted = annealed.flatMap(day => findConsecutiveMemberRuns(
      day.cools.flatMap(cool => cool.entries.map(entry => ({ entry, coolId: cool.id }))), bandMap)
      .flatMap(run => run.entries.map(item => item.entry.id)));
    const conflictIds = new Set(conflicted);
    const focused = movable.filter(item => conflictIds.has(item.entry.id));
    const sources = focused.length && random() < 0.7 ? focused : movable;
    const source = sources[Math.floor(random() * sources.length)];
    const band = bandMap.get(source.entry.bandId!);
    if (!band) continue;
    const sourceDay = annealed[source.dayIndex];
    const sourceCools = sourceDay.cools.map((cool, index) => index === source.coolIndex
      ? { ...cool, entries: cool.entries.filter(entry => entry.id !== source.entry.id) } : cool);
    const removedDay = retimeDay({ ...sourceDay, cools: sourceCools }, bandMap, linkedByDate.get(sourceDay.date));
    if (!removedDay || !validTimes(removedDay, bandMap, linkedByDate.get(sourceDay.date))) continue;
    const targetDayIndex = Math.floor(random() * annealed.length);
    const targetDay = targetDayIndex === source.dayIndex ? removedDay : annealed[targetDayIndex];
    const targetCoolIndex = Math.floor(random() * targetDay.cools.length);
    const position = Math.floor(random() * (targetDay.cools[targetCoolIndex].entries.length + 1));
    const movedDay = addAt(targetDay, band, targetCoolIndex, position, bandMap, linkedByDate.get(targetDay.date), source.entry.id);
    if (!movedDay) continue;
    const candidate = annealed.map((day, index) => index === targetDayIndex ? movedDay : index === source.dayIndex ? removedDay : day);
    const candidateScore = scoreSchedule(candidate, bandMap);
    const temperature = 80 * (1 - step / steps) + 1;
    const sameHigherPriorities = candidateScore.sameCoolRepeats === annealedScore.sameCoolRepeats
      && candidateScore.longRunPenalty === annealedScore.longRunPenalty
      && candidateScore.costumeTwoRunPenalty === annealedScore.costumeTwoRunPenalty
      && candidateScore.priority3Missing === annealedScore.priority3Missing
      && candidateScore.priority2Missing === annealedScore.priority2Missing
      && candidateScore.transitionMinutes === annealedScore.transitionMinutes;
    const energyChange = distributionPenalty(annealedScore) + annealedScore.costumeTwoRunPenalty
      + annealedScore.twoRunPenalty - distributionPenalty(candidateScore)
      - candidateScore.costumeTwoRunPenalty - candidateScore.twoRunPenalty;
    if (compareAutoScheduleScores(candidateScore, annealedScore) <= 0
      || (sameHigherPriorities && random() < Math.exp(energyChange / temperature))) {
      annealed = candidate;
      annealedScore = candidateScore;
      if (compareAutoScheduleScores(candidateScore, bestScore) < 0) { bestDays = candidate; bestScore = candidateScore; }
    }
  }
  const updated = new Map(bestDays.map(day => [day.date, day]));
  return {
    dailyTimetables: timetable.dailyTimetables.map(day => updated.get(day.date) ?? day).concat(bestDays.filter(day => !timetable.dailyTimetables.some(existing => existing.date === day.date))),
    placed: bestPlaced,
    remaining: missing.length - bestPlaced,
  };
};

/** Schedule one rehearsal per band, or one per performance day for day-start rehearsals. */
export const autoScheduleRehearsal = (
  rehearsal: Timetable,
  dates: string[],
  bands: Band[],
  duration: number,
  mode: 'rehearsal-day' | 'day-start-rehearsal',
  performance?: Timetable | null,
): AutoScheduleResult => {
  const rehearsalBands = bands.map(band => ({
    ...band, performanceCount: 1, performanceDuration: duration, toriPriority: 1 as const,
  }));
  const targets: AutoScheduleTarget[] = mode === 'day-start-rehearsal'
    ? (performance?.dailyTimetables || []).flatMap(day => {
      const bandIds = new Set((day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries)
        .filter(entry => entry.type === 'band' && entry.bandId)
        .map(entry => entry.bandId!));
      return [...bandIds].map(bandId => ({ bandId, date: day.date }));
    })
    : bands.map(band => ({ bandId: band.id }));

  const mergeSlots = (primary: AvailableTimeSlot[], extra: AvailableTimeSlot[]): AvailableTimeSlot[] => {
    const allDates = new Set([...primary, ...extra].map(slot => slot.date));
    return [...allDates].map(date => ({
      date,
      timeRanges: normalizeTimeRanges([
        ...(primary.find(slot => slot.date === date)?.timeRanges ?? []),
        ...(extra.find(slot => slot.date === date)?.timeRanges ?? []),
      ]),
    }));
  };

  // Already-placed rehearsals in backup time remain valid during the normal-time pass.
  const existingBackupRanges = new Map<string, AvailableTimeSlot[]>();
  rehearsal.dailyTimetables.forEach(day => {
    const entries = day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries;
    entries.forEach(entry => {
      if (!entry.bandId || !entry.startTime || !entry.endTime) return;
      const band = rehearsalBands.find(item => item.id === entry.bandId);
      if (!band || checkBandAvailability(band, day.date, entry.startTime, entry.endTime) === 'normal') return;
      const backupSlot = band.backupRehearsalTimeSlots?.find(slot => slot.date === day.date);
      if (!backupSlot || checkBandAvailability(band, day.date, entry.startTime, entry.endTime, true) !== 'backup') return;
      const previous = existingBackupRanges.get(band.id) ?? [];
      existingBackupRanges.set(band.id, mergeSlots(previous, [{ date: day.date, timeRanges: [{ startTime: entry.startTime!, endTime: entry.endTime! }] }]));
    });
  });
  const normalBands = rehearsalBands.map(band => ({
    ...band,
    availableTimeSlots: mergeSlots(band.availableTimeSlots, existingBackupRanges.get(band.id) ?? []),
  }));
  const normal = autoSchedulePerformance(rehearsal, dates, normalBands, null, targets);
  if (normal.error || normal.remaining === 0) return normal;

  const placedCounts = new Map<string, number>();
  normal.dailyTimetables.forEach(day => {
    const entries = day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries;
    entries.forEach(entry => {
      if (!entry.bandId) return;
      const key = mode === 'day-start-rehearsal' ? `${day.date}:${entry.bandId}` : entry.bandId;
      placedCounts.set(key, (placedCounts.get(key) ?? 0) + 1);
    });
  });
  const missingTargets = targets.filter(target => {
    const key = target.date ? `${target.date}:${target.bandId}` : target.bandId;
    const count = placedCounts.get(key) ?? 0;
    if (count > 0) {
      placedCounts.set(key, count - 1);
      return false;
    }
    return true;
  });
  if (!missingTargets.length) return normal;
  const missingBandIds = new Set(missingTargets.map(target => target.bandId));
  const fallbackBands = normalBands.map(band => missingBandIds.has(band.id) ? {
    ...band,
    availableTimeSlots: mergeSlots(band.availableTimeSlots, band.backupRehearsalTimeSlots ?? []),
  } : band);
  // Keep the sessions placed with normal availability at their original times
  // while attempting to fit only the missing rehearsals into backup time.
  const temporaryFixedIds = new Set<string>();
  const frozenDays = normal.dailyTimetables.map(day => ({
    ...day,
    cools: day.cools.map(cool => ({
      ...cool,
      entries: cool.entries.map(entry => {
        if (!entry.bandId || !entry.startTime || entry.fixedStartTime) return entry;
        temporaryFixedIds.add(entry.id);
        return { ...entry, fixedStartTime: entry.startTime };
      }),
    })),
  }));
  const fallback = autoSchedulePerformance(
    { ...rehearsal, dailyTimetables: frozenDays }, dates, fallbackBands, null, missingTargets,
  );
  if (fallback.error || fallback.remaining >= normal.remaining) return normal;
  return {
    ...fallback,
    placed: normal.placed + fallback.placed,
    dailyTimetables: fallback.dailyTimetables.map(day => ({
      ...day,
      cools: day.cools.map(cool => ({
        ...cool,
        entries: cool.entries.map(entry => {
          if (!temporaryFixedIds.has(entry.id)) return entry;
          const { fixedStartTime: _temporary, ...original } = entry;
          void _temporary;
          return original;
        }),
      })),
    })),
  };
};
