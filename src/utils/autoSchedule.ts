import type { AvailableTimeSlot, Band, Cool, CustomFieldsSettings, DailyTimetable, Timetable, TimetableEntry, TimeRange } from '../types';
import { generateUUID } from './generateUUID';
import { getEntriesWithCoolInfo, hasAnySequenceData, reconcileShiftForDay, shiftSequenceDataForInsertion } from './customFieldsUtils';
import { isValidCoolStart } from './dailyTimeBounds';
import { normalizeTimeRanges } from './availabilityRanges';
import { checkBandAvailability, findConsecutiveMemberRuns } from './scheduleChecks';
import { minimumCoolBreakMinutes } from './coolBreak';
import { venueTimeRanges } from './venueTimeRanges';

const minutes = (time: string): number => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const clockTime = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

const available = (band: Band, date: string, start: number, end: number): boolean => {
  return checkBandAvailability(band, date, clockTime(start), clockTime(end)) === 'normal';
};

const fitsVenue = (ranges: TimeRange[], start: number, end: number): boolean =>
  ranges.some(range => start >= minutes(range.startTime) && end <= minutes(range.endTime));

const nextVenue = (ranges: TimeRange[], from: number, duration: number): number | null => {
  for (const range of ranges) {
    const start = Math.max(from, minutes(range.startTime));
    if (start + duration <= minutes(range.endTime)) return start;
  }
  return null;
};

const assignedVenueWindows = (day: DailyTimetable, venues: TimeRange[]): number[] | null => {
  const anchors = day.cools.map(cool => venues.findIndex((range, index) => index > 0 && cool.startTime
    && minutes(cool.startTime) >= minutes(range.startTime) && minutes(cool.startTime) < minutes(range.endTime)));
  if (anchors.every(index => index < 0)) return null;
  let current = 0;
  return anchors.map(anchor => {
    if (anchor >= 0) current = anchor;
    return current;
  });
};

const coolCrossesVenueClosure = (day: DailyTimetable): boolean => {
  const venues = venueTimeRanges(day);
  return day.cools.some(cool => new Set(cool.entries.map(entry => venues.findIndex(range => entry.startTime && entry.endTime
    && minutes(entry.startTime) >= minutes(range.startTime) && minutes(entry.endTime) <= minutes(range.endTime)))).size > 1);
};

const earliestStart = (band: Band, day: DailyTimetable, venues: TimeRange[], from: number): number | null => {
  const slot = band.availableTimeSlots.find(item => item.date === day.date);
  if (!slot || slot.timeRanges.length === 0) return null;
  for (const venue of venues) {
    for (const range of normalizeTimeRanges(slot.timeRanges)) {
      const start = Math.max(from, minutes(venue.startTime), minutes(range.startTime));
      if (start + band.performanceDuration <= Math.min(minutes(venue.endTime), minutes(range.endTime))) return start;
    }
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
  const venues = venueTimeRanges(day);
  const assignedWindows = assignedVenueWindows(day, venues);
  const cools: Cool[] = [];
  for (let index = 0; index < day.cools.length; index++) {
    const cool = day.cools[index];
    const previousEnd = index > 0 ? cools[index - 1].entries.at(-1)?.endTime : undefined;
    if (cool.startTime) cursor = minutes(cool.startTime);
    else {
      if (previousEnd) cursor = Math.max(cursor, minutes(previousEnd) + minimumCoolBreakMinutes(day));
      const rehearsalEnd = linkedCools?.[index]?.entries.at(-1)?.endTime;
      if (rehearsalEnd) cursor = Math.max(cursor, minutes(rehearsalEnd));
    }
    if (index > 0) {
      if (previousEnd && cursor < minutes(previousEnd)) return null;
      if (cool.autoGeneratedStartTime && previousEnd
        && cursor < minutes(previousEnd) + minimumCoolBreakMinutes(day)) return null;
    }
    const entries: TimetableEntry[] = [];
    let coolWindow = -1;
    for (const entry of cool.entries) {
      const band = entry.bandId ? bandMap.get(entry.bandId) : undefined;
      const duration = band?.performanceDuration ?? entry.customEvent?.duration ?? 0;
      const start = entry.fixedStartTime ? minutes(entry.fixedStartTime) : band ? earliestStart(band, day, venues, cursor) : nextVenue(venues, cursor, duration);
      if (start === null) return null;
      if (start < cursor) return null;
      const end = start + duration;
      if (end > 1440 || !fitsVenue(venues, start, end)) return null;
      const windowIndex = venues.findIndex(range => start >= minutes(range.startTime) && end <= minutes(range.endTime));
      if (coolWindow !== -1 && windowIndex !== coolWindow) return null;
      if (assignedWindows && windowIndex !== assignedWindows[index]) return null;
      coolWindow = windowIndex;
      const nextCoolStart = day.cools[index + 1]?.startTime;
      if (nextCoolStart && end > minutes(nextCoolStart)) return null;
      entries.push({ ...entry, startTime: clockTime(start), endTime: clockTime(end), transitionTime: start - cursor, order: entries.length });
      cursor = end;
    }
    cools.push({ ...cool, entries });
  }
  return { ...day, cools };
};

/** Record inferred starts after searching, without freezing them during candidate evaluation. */
const materializeCoolStarts = (day: DailyTimetable, linkedCools?: Cool[]): DailyTimetable => {
  let previousEnd: number | null = null;
  const cools = day.cools.map((cool, index) => {
    const first = cool.entries[0];
    if (cool.startTime) {
      previousEnd = cool.entries.at(-1)?.endTime ? minutes(cool.entries.at(-1)!.endTime!) : minutes(cool.startTime);
      return cool;
    }
    const minimum = Math.max(
      minutes(day.startTime),
      previousEnd === null ? 0 : previousEnd + minimumCoolBreakMinutes(day),
      linkedCools?.[index]?.entries.at(-1)?.endTime ? minutes(linkedCools[index].entries.at(-1)!.endTime!) : 0,
    );
    // Put at most five extra minutes into the break. The rest remains a visible
    // transition so a genuinely long wait cannot be hidden in the cool header.
    const start = first?.startTime
      ? Math.min(minutes(first.startTime), minimum + 5)
      : minimum;
    const startTime = clockTime(start);
    const entries = first?.startTime
      ? [{ ...first, transitionTime: minutes(first.startTime) - start }, ...cool.entries.slice(1)]
      : cool.entries;
    previousEnd = entries.at(-1)?.endTime ? minutes(entries.at(-1)!.endTime!) : start;
    return { ...cool, startTime, autoGeneratedStartTime: true, entries };
  });
  return { ...day, cools };
};

const validTimes = (day: DailyTimetable, bandMap: Map<string, Band>, linkedCools?: Cool[]): boolean => {
  if (day.endTime && minutes(day.startTime) >= minutes(day.endTime)) return false;
  const venues = venueTimeRanges(day);
  const assignedWindows = assignedVenueWindows(day, venues);
  const starts = coolStarts(day, linkedCools);
  for (let index = 0; index < day.cools.length; index++) {
    const cool = day.cools[index];
    let coolWindow = -1;
    if (cool.startTime && !isValidCoolStart(day, index, cool.startTime)) return false;
    const lastEnd = cool.entries.at(-1)?.endTime;
    if (cool.autoGeneratedStartTime && index > 0) {
      const previousEnd = day.cools[index - 1].entries.at(-1)?.endTime;
      if (previousEnd && starts[index] < minutes(previousEnd) + minimumCoolBreakMinutes(day)) return false;
    }
    if (lastEnd && (minutes(lastEnd) > 1440 || (index + 1 < starts.length && minutes(lastEnd) > starts[index + 1]))) return false;
    for (const entry of cool.entries) {
      if (!entry.startTime || !entry.endTime || !fitsVenue(venues, minutes(entry.startTime), minutes(entry.endTime)) || minutes(entry.endTime) > 1440
        || (day.endTime && minutes(entry.endTime) > minutes(day.endTime))) return false;
      if (entry.fixedStartTime && entry.startTime !== entry.fixedStartTime) return false;
      const windowIndex = venues.findIndex(range => entry.startTime && entry.endTime
        && minutes(entry.startTime) >= minutes(range.startTime) && minutes(entry.endTime) <= minutes(range.endTime));
      if (coolWindow !== -1 && windowIndex !== coolWindow) return false;
      if (assignedWindows && windowIndex !== assignedWindows[index]) return false;
      coolWindow = windowIndex;
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
  priority2FinalCloser?: number;
  coolCountDispersion: number;
  dayCountDispersion: number;
  transitionMinutes: number;
  longTransitionPenalty?: number;
  preferencePenalty: number;
}

const softScheduleCost = (score: AutoScheduleScore): number => score.twoRunPenalty;

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
  a.priority3Missing - b.priority3Missing
  || (a.priority2FinalCloser ?? 0) - (b.priority2FinalCloser ?? 0)
  || a.sameCoolRepeats - b.sameCoolRepeats
  || a.longRunPenalty - b.longRunPenalty
  || a.costumeTwoRunPenalty - b.costumeTwoRunPenalty
  || a.priority2Missing - b.priority2Missing
  || a.coolCountDispersion - b.coolCountDispersion
  || a.dayCountDispersion - b.dayCountDispersion
  || (a.longTransitionPenalty ?? 0) - (b.longTransitionPenalty ?? 0)
  || softScheduleCost(a) - softScheduleCost(b)
  || a.transitionMinutes - b.transitionMinutes
  || a.preferencePenalty - b.preferencePenalty;

export const scoreSchedule = (days: DailyTimetable[], bandMap: Map<string, Band>): AutoScheduleScore => {
  const score: AutoScheduleScore = { sameCoolRepeats: 0, longRunPenalty: 0, costumeTwoRunPenalty: 0, twoRunPenalty: 0, priority3Missing: 0, priority2Missing: 0, priority2FinalCloser: 0, coolCountDispersion: 0, dayCountDispersion: 0, transitionMinutes: 0, longTransitionPenalty: 0, preferencePenalty: 0 };
  const finalDate = days.at(-1)?.date;
  const finalCoolIndex = (days.at(-1)?.cools.length ?? 1) - 1;
  const priority2Distances = new Map<string, number>();
  const priority3Seen = new Set<string>();
  const priority3InFinalCool = new Set<string>();
  const bandDays = new Map<string, Map<string, number>>();
  for (const day of days) {
    for (const entry of entriesOf(day)) {
      const wait = Math.max(0, entry.transitionTime ?? 0);
      score.transitionMinutes += wait;
      score.longTransitionPenalty! += Math.max(0, wait - 3) ** 2;
    }
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
      const lastBandPosition = cool.entries.reduce((last, entry, index) => entry.type === 'band' ? index : last, -1);
      const isFinalCool = day.date === finalDate && coolIndex === finalCoolIndex;
      if (isFinalCool && lastBandPosition >= 0) {
        const lastBandId = cool.entries[lastBandPosition].bandId;
        if (lastBandId && bandMap.get(lastBandId)?.toriPriority === 2) score.priority2FinalCloser!++;
      }
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
          const distance = lastBandPosition - position;
          if (!isFinalCool) priority2Distances.set(band.id, Math.min(priority2Distances.get(band.id) ?? Infinity, distance));
          else if (!priority2Distances.has(band.id)) priority2Distances.set(band.id, Infinity);
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
    score.preferencePenalty += (Number.isFinite(distance) ? distance * 2 : 0) + (distance > 0 ? 100 : 0);
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

/** Try direct moves and swaps into the final cool when a priority-3 band is still missing there. */
export const refineHeadlinerPlacement = (
  initialDays: DailyTimetable[], bands: Band[], fixedEntryIds: Set<string>, linkedByDate = new Map<string, Cool[]>(),
): DailyTimetable[] => {
  if (!initialDays.length || !initialDays.at(-1)?.cools.length) return initialDays;
  const bandMap = new Map(bands.map(band => [band.id, band]));
  const finalDayIndex = initialDays.length - 1;
  const finalCoolIndex = initialDays[finalDayIndex].cools.length - 1;
  let best = initialDays;
  let bestScore = scoreSchedule(best, bandMap);
  const maxPasses = bands.filter(band => band.toriPriority === 3).length;
  for (let pass = 0; pass < maxPasses && bestScore.priority3Missing; pass++) {
    let attempts = 0;
    const current = best;
    let next = current;
    let nextScore = bestScore;
    const finalBandIds = new Set(current[finalDayIndex].cools[finalCoolIndex].entries.map(entry => entry.bandId));
    for (let dayIndex = 0; dayIndex < current.length && attempts < 3000; dayIndex++) {
      for (let coolIndex = 0; coolIndex < current[dayIndex].cools.length && attempts < 3000; coolIndex++) {
        if (dayIndex === finalDayIndex && coolIndex === finalCoolIndex) continue;
        for (const source of current[dayIndex].cools[coolIndex].entries) {
          const band = source.bandId ? bandMap.get(source.bandId) : undefined;
          if (band?.toriPriority !== 3 || finalBandIds.has(band.id)
            || fixedEntryIds.has(source.id) || source.fixedStartTime) continue;
          const sourceCools = current[dayIndex].cools.map((cool, index) => index === coolIndex
            ? { ...cool, entries: cool.entries.filter(entry => entry.id !== source.id) } : cool);
          const removed = retimeDay({ ...current[dayIndex], cools: sourceCools }, bandMap, linkedByDate.get(current[dayIndex].date));
          if (removed && validTimes(removed, bandMap, linkedByDate.get(removed.date))) {
            const targetDay = dayIndex === finalDayIndex ? removed : current[finalDayIndex];
            for (let position = 0; position <= targetDay.cools[finalCoolIndex].entries.length && attempts < 3000; position++) {
              attempts++;
              const inserted = addAt(targetDay, band, finalCoolIndex, position, bandMap, linkedByDate.get(targetDay.date), source.id);
              if (!inserted) continue;
              const candidate = current.map((day, index) => index === finalDayIndex ? inserted : index === dayIndex ? removed : day);
              const score = scoreSchedule(candidate, bandMap);
              if (compareAutoScheduleScores(score, nextScore) < 0) {
                next = candidate;
                nextScore = score;
              }
            }
          }
          // A full final cool may only admit the headliner if another band takes its old slot.
          for (const target of current[finalDayIndex].cools[finalCoolIndex].entries) {
            if (attempts >= 3000) break;
            if (!target.bandId || fixedEntryIds.has(target.id) || target.fixedStartTime) continue;
            attempts++;
            const swapped = current.map((day, index) => index === dayIndex || index === finalDayIndex
              ? { ...day, cools: day.cools.map((cool, coolPosition) =>
                index === dayIndex && coolPosition === coolIndex
                  ? { ...cool, entries: cool.entries.map(entry => entry.id === source.id ? target : entry) }
                  : index === finalDayIndex && coolPosition === finalCoolIndex
                    ? { ...cool, entries: cool.entries.map(entry => entry.id === target.id ? source : entry) } : cool) }
              : day);
            let valid = true;
            for (const index of new Set([dayIndex, finalDayIndex])) {
              const retimed = retimeDay(swapped[index], bandMap, linkedByDate.get(swapped[index].date));
              if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(swapped[index].date))) { valid = false; break; }
              swapped[index] = retimed;
            }
            if (!valid) continue;
            const score = scoreSchedule(swapped, bandMap);
            if (compareAutoScheduleScores(score, nextScore) < 0) {
              next = swapped;
              nextScore = score;
            }
          }
        }
      }
    }
    // A direct swap can duplicate the displaced band in the source cool.
    // Rotate three movable cards so the final cool gains the headliner without
    // increasing same-cool repeats or changing cool sizes.
    if (bestScore.priority3Missing
      && (next === current || nextScore.sameCoolRepeats > bestScore.sameCoolRepeats)) {
      let cycleAttempts = 0;
      const finalEntries = current[finalDayIndex].cools[finalCoolIndex].entries;
      for (let dayIndex = 0; dayIndex < current.length && cycleAttempts < 6000; dayIndex++) {
        for (let coolIndex = 0; coolIndex < current[dayIndex].cools.length && cycleAttempts < 6000; coolIndex++) {
          if (dayIndex === finalDayIndex && coolIndex === finalCoolIndex) continue;
          for (const source of current[dayIndex].cools[coolIndex].entries) {
            const band = source.bandId ? bandMap.get(source.bandId) : undefined;
            if (band?.toriPriority !== 3 || finalBandIds.has(band.id)
              || fixedEntryIds.has(source.id) || source.fixedStartTime) continue;
            for (const target of finalEntries) {
              if (!target.bandId || fixedEntryIds.has(target.id) || target.fixedStartTime) continue;
              for (let bufferDayIndex = 0; bufferDayIndex < current.length && cycleAttempts < 6000; bufferDayIndex++) {
                for (const bufferCool of current[bufferDayIndex].cools) {
                  for (const buffer of bufferCool.entries) {
                    if (cycleAttempts >= 6000) break;
                    if (!buffer.bandId || buffer.id === source.id || buffer.id === target.id
                      || fixedEntryIds.has(buffer.id) || buffer.fixedStartTime) continue;
                    cycleAttempts++;
                    const rotated = current.map((day, index) =>
                      index === dayIndex || index === finalDayIndex || index === bufferDayIndex
                        ? { ...day, cools: day.cools.map(cool => ({ ...cool, entries: cool.entries.map(entry =>
                          entry.id === source.id ? buffer : entry.id === target.id ? source
                            : entry.id === buffer.id ? target : entry) })) } : day);
                    let valid = true;
                    for (const index of new Set([dayIndex, finalDayIndex, bufferDayIndex])) {
                      const retimed = retimeDay(rotated[index], bandMap, linkedByDate.get(rotated[index].date));
                      if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(rotated[index].date))) {
                        valid = false; break;
                      }
                      rotated[index] = retimed;
                    }
                    if (!valid) continue;
                    const score = scoreSchedule(rotated, bandMap);
                    if (compareAutoScheduleScores(score, nextScore) < 0) {
                      next = rotated;
                      nextScore = score;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    if (next === current) break;
    best = next;
    bestScore = nextScore;
  }
  return best;
};

/** Give every priority-2 band at least one cool-closing performance where a legal move or swap exists. */
export const refineCoolClosers = (
  initialDays: DailyTimetable[], bands: Band[], fixedEntryIds: Set<string>, linkedByDate = new Map<string, Cool[]>(),
): DailyTimetable[] => {
  if (!initialDays.length) return initialDays;
  const bandMap = new Map(bands.map(band => [band.id, band]));
  let best = initialDays;
  let bestScore = scoreSchedule(best, bandMap);
  let attempts = 0;
  for (let pass = 0; pass < 3 && bestScore.priority2Missing && attempts < 3000; pass++) {
    const current = best;
    let next = current;
    let nextScore = bestScore;
    const closingBandIds = new Set(current.flatMap((day, dayIndex) => day.cools.flatMap((cool, coolIndex) => {
      if (dayIndex === current.length - 1 && coolIndex === day.cools.length - 1) return [];
      const lastBand = [...cool.entries].reverse().find(entry => entry.type === 'band');
      return lastBand?.bandId ? [lastBand.bandId] : [];
    })));
    for (let sourceDayIndex = 0; sourceDayIndex < current.length && attempts < 3000; sourceDayIndex++) {
      for (let sourceCoolIndex = 0; sourceCoolIndex < current[sourceDayIndex].cools.length && attempts < 3000; sourceCoolIndex++) {
        for (const source of current[sourceDayIndex].cools[sourceCoolIndex].entries) {
          const band = source.bandId ? bandMap.get(source.bandId) : undefined;
          if (band?.toriPriority !== 2 || closingBandIds.has(band.id)
            || fixedEntryIds.has(source.id) || source.fixedStartTime) continue;
          const sourceCools = current[sourceDayIndex].cools.map((cool, index) => index === sourceCoolIndex
            ? { ...cool, entries: cool.entries.filter(entry => entry.id !== source.id) } : cool);
          const removed = retimeDay({ ...current[sourceDayIndex], cools: sourceCools }, bandMap, linkedByDate.get(current[sourceDayIndex].date));
          for (let targetDayIndex = 0; targetDayIndex < current.length && attempts < 3000; targetDayIndex++) {
            for (let targetCoolIndex = 0; targetCoolIndex < current[targetDayIndex].cools.length && attempts < 3000; targetCoolIndex++) {
              if (targetDayIndex === current.length - 1 && targetCoolIndex === current[targetDayIndex].cools.length - 1) continue;
              const targetDay = targetDayIndex === sourceDayIndex ? removed : current[targetDayIndex];
              if (targetDay && validTimes(targetDay, bandMap, linkedByDate.get(targetDay.date))) {
                const targetEntries = targetDay.cools[targetCoolIndex].entries;
                const lastBandIndex = targetEntries.reduce((last, entry, index) => entry.type === 'band' ? index : last, -1);
                attempts++;
                const inserted = addAt(targetDay, band, targetCoolIndex, lastBandIndex + 1, bandMap, linkedByDate.get(targetDay.date), source.id);
                if (inserted) {
                  const candidate = current.map((day, index) => index === targetDayIndex ? inserted : index === sourceDayIndex ? removed! : day);
                  const score = scoreSchedule(candidate, bandMap);
                  if (compareAutoScheduleScores(score, nextScore) < 0) { next = candidate; nextScore = score; }
                }
              }
              const lastBand = [...current[targetDayIndex].cools[targetCoolIndex].entries]
                .reverse().find(entry => entry.type === 'band');
              if (!lastBand || lastBand.id === source.id || fixedEntryIds.has(lastBand.id) || lastBand.fixedStartTime) continue;
              attempts++;
              const swapped = current.map((day, index) => index === sourceDayIndex || index === targetDayIndex
                ? { ...day, cools: day.cools.map(cool => ({ ...cool, entries: cool.entries.map(entry =>
                  entry.id === source.id ? lastBand : entry.id === lastBand.id ? source : entry) })) } : day);
              let valid = true;
              for (const index of new Set([sourceDayIndex, targetDayIndex])) {
                const retimed = retimeDay(swapped[index], bandMap, linkedByDate.get(swapped[index].date));
                if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(swapped[index].date))) { valid = false; break; }
                swapped[index] = retimed;
              }
              if (!valid) continue;
              const score = scoreSchedule(swapped, bandMap);
              if (compareAutoScheduleScores(score, nextScore) < 0) { next = swapped; nextScore = score; }
            }
          }
        }
      }
    }
    if (next === current) break;
    best = next;
    bestScore = nextScore;
  }
  return best;
};

/** Keep a priority-2 band from closing the event when movable cards can be exchanged legally. */
export const refineFinalCoolCloser = (
  days: DailyTimetable[], bands: Band[], fixedEntryIds: Set<string>, linkedByDate = new Map<string, Cool[]>(),
): DailyTimetable[] => {
  const finalDayIndex = days.length - 1;
  const finalCool = days[finalDayIndex]?.cools.at(-1);
  if (!finalCool) return days;
  const bandMap = new Map(bands.map(band => [band.id, band]));
  const closer = [...finalCool.entries].reverse().find(entry => entry.type === 'band');
  if (!closer?.bandId || bandMap.get(closer.bandId)?.toriPriority !== 2
    || fixedEntryIds.has(closer.id) || closer.fixedStartTime) return days;
  let best = days;
  let bestScore = scoreSchedule(days, bandMap);
  const sourceDay = days[finalDayIndex];
  const sourceCoolIndex = sourceDay.cools.length - 1;
  const closerBand = bandMap.get(closer.bandId);
  const removed = closerBand && retimeDay({ ...sourceDay, cools: sourceDay.cools.map((cool, index) => index === sourceCoolIndex
    ? { ...cool, entries: cool.entries.filter(entry => entry.id !== closer.id) } : cool) }, bandMap, linkedByDate.get(sourceDay.date));
  if (removed && validTimes(removed, bandMap, linkedByDate.get(removed.date)) && closerBand) {
    for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
      for (let coolIndex = 0; coolIndex < days[dayIndex].cools.length; coolIndex++) {
        if (dayIndex === finalDayIndex && coolIndex === sourceCoolIndex) continue;
        const targetDay = dayIndex === finalDayIndex ? removed : days[dayIndex];
        const targetEntries = targetDay.cools[coolIndex].entries;
        const lastBandIndex = targetEntries.reduce((last, entry, index) => entry.type === 'band' ? index : last, -1);
        const inserted = addAt(targetDay, closerBand, coolIndex, lastBandIndex + 1, bandMap,
          linkedByDate.get(targetDay.date), closer.id);
        if (!inserted) continue;
        const candidate = days.map((day, index) => index === dayIndex ? inserted : index === finalDayIndex ? removed : day);
        const score = scoreSchedule(candidate, bandMap);
        if (compareAutoScheduleScores(score, bestScore) < 0) { best = candidate; bestScore = score; }
      }
    }
  }
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    for (const cool of days[dayIndex].cools) {
      for (const target of cool.entries) {
        if (!target.bandId || target.id === closer.id || bandMap.get(target.bandId)?.toriPriority === 2
          || fixedEntryIds.has(target.id) || target.fixedStartTime) continue;
        const swapped = days.map(day => ({ ...day, cools: day.cools.map(item => ({ ...item,
          entries: item.entries.map(entry => entry.id === closer.id ? target : entry.id === target.id ? closer : entry),
        })) }));
        let valid = true;
        for (const index of new Set([dayIndex, finalDayIndex])) {
          const retimed = retimeDay(swapped[index], bandMap, linkedByDate.get(swapped[index].date));
          if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(swapped[index].date))) { valid = false; break; }
          swapped[index] = retimed;
        }
        if (!valid) continue;
        const score = scoreSchedule(swapped, bandMap);
        if (compareAutoScheduleScores(score, bestScore) < 0) { best = swapped; bestScore = score; }
      }
    }
  }
  return best;
};

/** Separate repeat performances by swapping cool slots, even if ordinary two-runs increase. */
export const refineSameCoolRepeats = (
  initialDays: DailyTimetable[], bands: Band[], fixedEntryIds: Set<string>, linkedByDate = new Map<string, Cool[]>(),
): DailyTimetable[] => {
  const bandMap = new Map(bands.map(band => [band.id, band]));
  let best = initialDays;
  let bestScore = scoreSchedule(best, bandMap);
  let attempts = 0;
  for (let pass = 0; pass < 12 && bestScore.sameCoolRepeats > 0 && attempts < 4000; pass++) {
    let next = best;
    let nextScore = bestScore;
    for (let sourceDayIndex = 0; sourceDayIndex < best.length && attempts < 4000; sourceDayIndex++) {
      for (let sourceCoolIndex = 0; sourceCoolIndex < best[sourceDayIndex].cools.length && attempts < 4000; sourceCoolIndex++) {
        const sourceCool = best[sourceDayIndex].cools[sourceCoolIndex];
        const counts = new Map<string, number>();
        sourceCool.entries.forEach(entry => {
          if (entry.bandId) counts.set(entry.bandId, (counts.get(entry.bandId) ?? 0) + 1);
        });
        for (const source of sourceCool.entries) {
          if (!source.bandId || (counts.get(source.bandId) ?? 0) < 2
            || fixedEntryIds.has(source.id) || source.fixedStartTime) continue;
          const band = bandMap.get(source.bandId);
          const removed = band && retimeDay({ ...best[sourceDayIndex], cools: best[sourceDayIndex].cools.map((cool, index) =>
            index === sourceCoolIndex ? { ...cool, entries: cool.entries.filter(entry => entry.id !== source.id) } : cool) },
          bandMap, linkedByDate.get(best[sourceDayIndex].date));
          for (let targetDayIndex = 0; targetDayIndex < best.length && attempts < 4000; targetDayIndex++) {
            for (let targetCoolIndex = 0; targetCoolIndex < best[targetDayIndex].cools.length && attempts < 4000; targetCoolIndex++) {
              if (sourceDayIndex === targetDayIndex && sourceCoolIndex === targetCoolIndex) continue;
              const targetDay = targetDayIndex === sourceDayIndex ? removed : best[targetDayIndex];
              if (band && removed && validTimes(removed, bandMap, linkedByDate.get(removed.date)) && targetDay) {
                for (let position = 0; position <= targetDay.cools[targetCoolIndex].entries.length && attempts < 4000; position++) {
                  attempts++;
                  const inserted = addAt(targetDay, band, targetCoolIndex, position, bandMap,
                    linkedByDate.get(targetDay.date), source.id);
                  if (!inserted) continue;
                  const candidate = best.map((day, index) => index === targetDayIndex ? inserted
                    : index === sourceDayIndex ? removed : day);
                  const score = scoreSchedule(candidate, bandMap);
                  if (compareAutoScheduleScores(score, nextScore) < 0) { next = candidate; nextScore = score; }
                }
              }
              for (const target of best[targetDayIndex].cools[targetCoolIndex].entries) {
                if (attempts >= 4000) break;
                if (!target.bandId || fixedEntryIds.has(target.id) || target.fixedStartTime) continue;
                attempts++;
                const candidate = best.map((day, dayIndex) => dayIndex === sourceDayIndex || dayIndex === targetDayIndex
                  ? { ...day, cools: day.cools.map(cool => ({ ...cool, entries: cool.entries.map(entry =>
                    entry.id === source.id ? target : entry.id === target.id ? source : entry) })) } : day);
                let valid = true;
                for (const index of new Set([sourceDayIndex, targetDayIndex])) {
                  const retimed = retimeDay(candidate[index], bandMap, linkedByDate.get(candidate[index].date));
                  if (!retimed || !validTimes(retimed, bandMap, linkedByDate.get(candidate[index].date))) {
                    valid = false; break;
                  }
                  candidate[index] = retimed;
                }
                if (!valid) continue;
                const score = scoreSchedule(candidate, bandMap);
                if (compareAutoScheduleScores(score, nextScore) < 0) { next = candidate; nextScore = score; }
              }
            }
          }
        }
      }
    }
    if (next === best) break;
    best = next;
    bestScore = nextScore;
  }
  return best;
};

/** Move a performance from a crowded cool to a lighter one when the time windows allow it. */
export const refineCoolBalance = (
  initialDays: DailyTimetable[], bands: Band[], fixedEntryIds: Set<string>, linkedByDate = new Map<string, Cool[]>(),
): DailyTimetable[] => {
  const bandMap = new Map(bands.map(band => [band.id, band]));
  let best = initialDays;
  let bestScore = scoreSchedule(best, bandMap);
  let attempts = 0;
  for (let pass = 0; pass < 12 && attempts < 3000; pass++) {
    let next = best;
    let nextScore = bestScore;
    for (let dayIndex = 0; dayIndex < best.length && attempts < 3000; dayIndex++) {
      const day = best[dayIndex];
      const counts = day.cools.map(cool => cool.entries.filter(entry => entry.type === 'band').length);
      for (let sourceIndex = 0; sourceIndex < day.cools.length && attempts < 3000; sourceIndex++) {
        for (let targetIndex = 0; targetIndex < day.cools.length && attempts < 3000; targetIndex++) {
          if (counts[sourceIndex] - counts[targetIndex] < 2) continue;
          for (const source of day.cools[sourceIndex].entries) {
            if (!source.bandId || fixedEntryIds.has(source.id) || source.fixedStartTime) continue;
            const band = bandMap.get(source.bandId);
            if (!band) continue;
            const removed = retimeDay({ ...day, cools: day.cools.map((cool, index) => index === sourceIndex
              ? { ...cool, entries: cool.entries.filter(entry => entry.id !== source.id) } : cool) },
            bandMap, linkedByDate.get(day.date));
            if (!removed || !validTimes(removed, bandMap, linkedByDate.get(day.date))) continue;
            for (let position = 0; position <= removed.cools[targetIndex].entries.length && attempts < 3000; position++) {
              attempts++;
              const inserted = addAt(removed, band, targetIndex, position, bandMap, linkedByDate.get(day.date), source.id);
              if (!inserted) continue;
              const candidate = best.map((item, index) => index === dayIndex ? inserted : item);
              const score = scoreSchedule(candidate, bandMap);
              if (compareAutoScheduleScores(score, nextScore) < 0) { next = candidate; nextScore = score; }
            }
          }
        }
      }
    }
    if (next === best) break;
    best = next;
    bestScore = nextScore;
  }
  return best;
};

export interface AutoScheduleResult {
  dailyTimetables: DailyTimetable[];
  placed: number;
  remaining: number;
  error?: string;
}

/** Confirm the saved result against the unmodified band availability, including rehearsal backup slots. */
export const findAutoScheduleAvailabilityError = (
  days: DailyTimetable[], bands: Band[], type: 'performance' | 'rehearsal', rehearsalDuration: number,
): string | null => {
  const bandMap = new Map(bands.map(band => [band.id, band]));
  for (const day of days) {
    for (const entry of (day.cools?.length ? day.cools.flatMap(cool => cool.entries) : day.entries)) {
      if (entry.type !== 'band' || !entry.bandId) continue;
      const band = bandMap.get(entry.bandId);
      if (!band || !entry.startTime || !entry.endTime) return `${day.date} のバンドまたは時刻を確認できません。`;
      const duration = type === 'rehearsal' ? rehearsalDuration : band.performanceDuration;
      if (minutes(entry.endTime) - minutes(entry.startTime) !== duration ||
        checkBandAvailability(band, day.date, entry.startTime, entry.endTime, type === 'rehearsal') === 'outside') {
        return `${day.date} の「${band.name}」が出演可能時間外です。`;
      }
    }
  }
  return null;
};

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

/** Enumerate venue-window cool allocations, favoring each window's usable duration. */
const venueBoundaryLayouts = (day: DailyTimetable): number[][] => {
  const venues = venueTimeRanges(day);
  const coolCount = day.cools.length;
  if (venues.length < 2 || coolCount < venues.length) return [[coolCount]];
  const durations = venues.map(range => Math.max(1, minutes(range.endTime) - minutes(range.startTime)));
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const layouts: number[][] = [];
  const enumerate = (remaining: number, index: number, counts: number[]) => {
    if (index === venues.length - 1) {
      layouts.push([...counts, remaining]);
      return;
    }
    for (let count = 1; count <= remaining - (venues.length - index - 1); count++) {
      enumerate(remaining - count, index + 1, [...counts, count]);
    }
  };
  enumerate(coolCount, 0, []);
  layouts.sort((a, b) => {
    const deviation = (counts: number[]) => counts.reduce((sum, count, index) =>
      sum + (count - coolCount * durations[index] / totalDuration) ** 2, 0);
    return deviation(a) - deviation(b) || a.join(',').localeCompare(b.join(','));
  });
  return layouts.slice(0, venues.length === 2 ? layouts.length : 20);
};

const prepareVenueBoundaries = (
  day: DailyTimetable, pass: number, bandMap: Map<string, Band>, linkedCools?: Cool[],
): DailyTimetable | null => {
  const venues = venueTimeRanges(day);
  if (venues.length < 2) return day;
  if (day.cools.length < venues.length) return null;
  const layouts = venueBoundaryLayouts(day);
  const layout = layouts[pass % layouts.length];
  const cools = day.cools.map(cool => ({ ...cool }));
  let previousBoundary = 0;
  for (let windowIndex = 1; windowIndex < venues.length; windowIndex++) {
    const remainingWindows = venues.length - windowIndex;
    const ideal = layout.slice(0, windowIndex).reduce((sum, count) => sum + count, 0);
    const candidates = cools.flatMap((cool, index) => index > previousBoundary && index <= cools.length - remainingWindows
      && cool.startTime && minutes(cool.startTime) >= minutes(venues[windowIndex].startTime)
      && minutes(cool.startTime) < minutes(venues[windowIndex].endTime) ? [index] : []);
    const boundary = candidates.length
      ? candidates.reduce((best, index) => Math.abs(index - ideal) < Math.abs(best - ideal) ? index : best)
      : Math.max(previousBoundary + 1, Math.min(cools.length - remainingWindows, ideal));
    if (!candidates.length) {
      if (cools[boundary].entries.length) return null;
      cools[boundary].startTime = venues[windowIndex].startTime;
      cools[boundary].autoGeneratedStartTime = true;
    }
    previousBoundary = boundary;
  }
  const prepared = retimeDay({ ...day, cools }, bandMap, linkedCools);
  return prepared && validTimes(prepared, bandMap, linkedCools) ? prepared : null;
};

/** Give empty cools a capacity target before inserting bands. Manual starts stay fixed. */
const planCoolStarts = (
  day: DailyTimetable, bands: Band[], targetCoolMinutes: number, linkedCools?: Cool[],
): DailyTimetable | null => {
  const venues = venueTimeRanges(day);
  const windows = assignedVenueWindows(day, venues) ?? day.cools.map(() => 0);
  const cools = day.cools.map(cool => ({ ...cool }));
  const positiveDurations = bands.map(band => band.performanceDuration).filter(value => value > 0);
  const durationStep = positiveDurations.length ? Math.min(...positiveDurations) : 1;
  for (let windowIndex = 0; windowIndex < venues.length; windowIndex++) {
    const indexes = cools.flatMap((_, index) => windows[index] === windowIndex ? [index] : []);
    if (!indexes.length) continue;
    const venue = venues[windowIndex];
    const windowStart = minutes(venue.startTime);
    const windowEnd = minutes(venue.endTime);
    const latestBandEnd = Math.max(0, ...bands.flatMap(band =>
      band.availableTimeSlots.find(slot => slot.date === day.date)?.timeRanges.flatMap(range => {
        const end = Math.min(windowEnd, minutes(range.endTime));
        return end > Math.max(windowStart, minutes(range.startTime)) ? [end] : [];
      }) ?? []));
    const usefulEnd = latestBandEnd > windowStart ? latestBandEnd : windowEnd;
    const breakMinutes = minimumCoolBreakMinutes(day);
    const target = Math.max(1, Math.min(Math.ceil(targetCoolMinutes / durationStep) * durationStep, Math.floor(
      (usefulEnd - windowStart - (indexes.length - 1) * breakMinutes) / indexes.length,
    )));
    const span = indexes.length === 1 ? 0 : Math.max(1, Math.min(
      target + breakMinutes,
      Math.floor((usefulEnd - windowStart - target) / (indexes.length - 1)),
    ));
    indexes.forEach((coolIndex, position) => {
      if (cools[coolIndex].startTime && !cools[coolIndex].autoGeneratedStartTime) return;
      cools[coolIndex].startTime = clockTime(windowStart + position * span);
      cools[coolIndex].autoGeneratedStartTime = true;
    });
  }
  const planned = retimeDay({ ...day, cools }, new Map(bands.map(band => [band.id, band])), linkedCools);
  return planned && validTimes(planned, new Map(bands.map(band => [band.id, band])), linkedCools) ? planned : null;
};

export const autoSchedulePerformance = (
  timetable: Timetable, dates: string[], bands: Band[], linkedRehearsal?: Timetable | null,
  targets?: AutoScheduleTarget[], materializeStarts = true,
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
  if (days.some(day => venueTimeRanges(day).length > day.cools.length)) {
    return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: 0,
      error: '演奏可能時間帯の数よりクール数が少なくなっています。各時間帯に少なくとも1クールを設定してください。' };
  }
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
  const totalPerformanceMinutes = missing.reduce((sum, target) => sum + target.band.performanceDuration, 0)
    + days.reduce((sum, day) => sum + entriesOf(day).reduce((daySum, entry) => daySum
      + (entry.bandId ? bandMap.get(entry.bandId)?.performanceDuration ?? 0 : 0), 0), 0);
  const targetCoolMinutes = totalPerformanceMinutes / Math.max(1, days.reduce((sum, day) => sum + day.cools.length, 0));
  const invalid = days.find(day => !validTimes(day, bandMap, linkedByDate.get(day.date)));
  if (invalid) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: missing.length,
    error: coolCrossesVenueClosure(invalid)
      ? `${invalid.date} に演奏可能時間帯の境目をまたぐクールがあります。既存配置をクールで分けるか、配置をリセットしてから再実行してください。`
      : `${invalid.date} の既存配置に出演可能時間外、終了時刻超過、またはクール開始時刻の矛盾があります。先に修正してください。` };
  if (!missing.length) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: 0 };
  const random = seededRandom(`${timetable.eventId}|${dates.join('|')}|${bands.map(band => band.id).sort().join('|')}`);
  missing.sort((a, b) => a.band.id.localeCompare(b.band.id) || (a.date || '').localeCompare(b.date || ''));

  let bestDays = days;
  let bestPlaced = -1;
  let bestScore: AutoScheduleScore = { sameCoolRepeats: Infinity, longRunPenalty: Infinity, costumeTwoRunPenalty: Infinity, twoRunPenalty: Infinity, priority3Missing: Infinity, priority2Missing: Infinity, priority2FinalCloser: Infinity, coolCountDispersion: Infinity, dayCountDispersion: Infinity, transitionMinutes: Infinity, preferencePenalty: Infinity };
  const boundaryVariants = Math.max(1, ...days.map(day => venueBoundaryLayouts(day).length));
  const maxPasses = missing.length > 40 ? 12 : 20;
  for (let pass = 0; pass < Math.min(maxPasses, Math.max(8, boundaryVariants)); pass++) {
    const prepared = days.map(day => {
      const bounded = prepareVenueBoundaries(day, pass, bandMap, linkedByDate.get(day.date));
      return bounded && planCoolStarts(bounded, bands, targetCoolMinutes, linkedByDate.get(day.date));
    });
    if (prepared.some(day => !day)) continue;
    let current = prepared as DailyTimetable[];
    const pending = [...missing]
      .map(target => ({ target, flexibility: availabilityFlexibility(target.band, target.date ? [target.date] : dates), tie: random() }))
      .sort((a, b) => {
        // Reserve a final-cool slot for a headliner in the first seed. Other
        // seeds keep the availability-first order to protect placement count.
        if (pass === 0) {
          const headlinerOrder = Number(b.target.band.toriPriority === 3) - Number(a.target.band.toriPriority === 3);
          if (headlinerOrder) return headlinerOrder;
        }
        return a.flexibility - b.flexibility
          || (b.target.band.toriPriority ?? 1) - (a.target.band.toriPriority ?? 1) || a.tie - b.tie;
      })
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
    if (bestPlaced === missing.length && pass >= Math.max(2, boundaryVariants - 1)) break;
  }
  if (bestPlaced < 0) return { dailyTimetables: timetable.dailyTimetables, placed: 0, remaining: missing.length,
    error: '演奏可能時間帯の境目にクールを配置できません。クールの開始時刻や既存の配置を確認してください。' };
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
      && candidateScore.priority2FinalCloser === annealedScore.priority2FinalCloser
      && candidateScore.priority3Missing === annealedScore.priority3Missing
      && candidateScore.priority2Missing === annealedScore.priority2Missing
      && candidateScore.longTransitionPenalty === annealedScore.longTransitionPenalty;
    const energyChange = softScheduleCost(annealedScore) - softScheduleCost(candidateScore);
    if (compareAutoScheduleScores(candidateScore, annealedScore) <= 0
      || (sameHigherPriorities && random() < Math.exp(energyChange / temperature))) {
      annealed = candidate;
      annealedScore = candidateScore;
      if (compareAutoScheduleScores(candidateScore, bestScore) < 0) { bestDays = candidate; bestScore = candidateScore; }
    }
  }
  // Greedy insertion can leave a long hole even when a later band fits there.
  // Try a bounded set of same-day moves before accepting that wait as necessary.
  for (let pass = 0; pass < 2; pass++) {
    const gaps = bestDays.flatMap((day, dayIndex) => day.cools.flatMap((cool, coolIndex) =>
      cool.entries.map((entry, position) => ({ dayIndex, coolIndex, position, wait: entry.transitionTime ?? 0 }))
        .filter(item => item.wait > 3)))
      .sort((a, b) => b.wait - a.wait);
    let improved = false;
    let attempts = 0;
    for (const gap of gaps) {
      if (attempts >= 240) break;
      const day = bestDays[gap.dayIndex];
      for (let sourceCoolIndex = 0; sourceCoolIndex < day.cools.length && attempts < 240; sourceCoolIndex++) {
        const sourceCool = day.cools[sourceCoolIndex];
        for (const entry of sourceCool.entries) {
          if (attempts >= 240) break;
          if (!entry.bandId || originalIds.has(entry.id)) continue;
          if (sourceCoolIndex === gap.coolIndex && sourceCool.entries.indexOf(entry) <= gap.position) continue;
          const band = bandMap.get(entry.bandId);
          if (!band) continue;
          attempts++;
          const removed = retimeDay({ ...day, cools: day.cools.map((cool, index) => index === sourceCoolIndex
            ? { ...cool, entries: cool.entries.filter(item => item.id !== entry.id) } : cool) }, bandMap, linkedByDate.get(day.date));
          if (!removed) continue;
          const moved = addAt(removed, band, gap.coolIndex, gap.position, bandMap, linkedByDate.get(day.date), entry.id);
          if (!moved) continue;
          const candidate = bestDays.map((item, index) => index === gap.dayIndex ? moved : item);
          const candidateScore = scoreSchedule(candidate, bandMap);
          if (compareAutoScheduleScores(candidateScore, bestScore) < 0) {
            bestDays = candidate;
            bestScore = candidateScore;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  // Count-preserving reorders and swaps can reduce long transitions or member
  // conflicts after the cool sizes are balanced.
  if (bestPlaced > 0) {
    let attempts = 0;
    const maxAttempts = Math.min(12000, Math.max(1200, bestPlaced * 80));
    for (let pass = 0; pass < 60 && attempts < maxAttempts; pass++) {
      const conflictIds = new Set(bestDays.flatMap(day => [
        ...findConsecutiveMemberRuns(
          day.cools.flatMap(cool => cool.entries.map(entry => ({ entry, coolId: cool.id }))), bandMap,
        ).flatMap(run => run.entries.map(item => item.entry.id)),
        ...day.cools.flatMap(cool => cool.entries.filter(entry => (entry.transitionTime ?? 0) > 3).map(entry => entry.id)),
      ]));
      if (!conflictIds.size) break;
      let improved = false;
      for (let dayIndex = 0; dayIndex < bestDays.length && !improved && attempts < maxAttempts; dayIndex++) {
        const day = bestDays[dayIndex];
        for (let coolIndex = 0; coolIndex < day.cools.length && !improved && attempts < maxAttempts; coolIndex++) {
          const entries = day.cools[coolIndex].entries;
          for (let sourceIndex = 0; sourceIndex < entries.length && !improved && attempts < maxAttempts; sourceIndex++) {
            const source = entries[sourceIndex];
            if (!source.bandId || originalIds.has(source.id) || source.fixedStartTime || !conflictIds.has(source.id)) continue;
            // An insertion changes no cool or day counts and is especially useful
            // when a free separator exists in the same cool.
            for (let targetIndex = 0; targetIndex < entries.length && !improved && attempts < maxAttempts; targetIndex++) {
              if (targetIndex === sourceIndex) continue;
              attempts++;
              const reordered = [...entries];
              reordered.splice(sourceIndex, 1);
              reordered.splice(targetIndex, 0, source);
              const candidateDay = retimeDay({ ...day, cools: day.cools.map((cool, index) => index === coolIndex
                ? { ...cool, entries: reordered } : cool) }, bandMap, linkedByDate.get(day.date));
              if (!candidateDay || !validTimes(candidateDay, bandMap, linkedByDate.get(day.date))) continue;
              const candidate = bestDays.map((item, index) => index === dayIndex ? candidateDay : item);
              const candidateScore = scoreSchedule(candidate, bandMap);
              if (compareAutoScheduleScores(candidateScore, bestScore) >= 0) continue;
              bestDays = candidate;
              bestScore = candidateScore;
              improved = true;
            }
            // One-for-one swaps also preserve cool counts, unlike the existing
            // single-band annealing moves. Keep the search bounded for large shows.
            for (let otherDayIndex = 0; otherDayIndex < bestDays.length && !improved && attempts < maxAttempts; otherDayIndex++) {
              const otherDay = bestDays[otherDayIndex];
              for (let otherCoolIndex = 0; otherCoolIndex < otherDay.cools.length && !improved && attempts < maxAttempts; otherCoolIndex++) {
                if (otherDayIndex === dayIndex && otherCoolIndex === coolIndex) continue;
                const otherEntries = otherDay.cools[otherCoolIndex].entries;
                for (let otherIndex = 0; otherIndex < otherEntries.length && !improved && attempts < maxAttempts; otherIndex++) {
                const other = otherEntries[otherIndex];
                if (!other.bandId || originalIds.has(other.id) || other.fixedStartTime) continue;
                attempts++;
                const sourceEntries = [...entries];
                const targetEntries = [...otherEntries];
                sourceEntries[sourceIndex] = other;
                targetEntries[otherIndex] = source;
                const candidateDay = retimeDay({ ...day, cools: day.cools.map((cool, index) => index === coolIndex
                  ? { ...cool, entries: sourceEntries } : otherDayIndex === dayIndex && index === otherCoolIndex
                    ? { ...cool, entries: targetEntries } : cool) }, bandMap, linkedByDate.get(day.date));
                if (!candidateDay || !validTimes(candidateDay, bandMap, linkedByDate.get(day.date))) continue;
                const candidateOtherDay = otherDayIndex === dayIndex ? candidateDay : retimeDay({ ...otherDay,
                  cools: otherDay.cools.map((cool, index) => index === otherCoolIndex
                    ? { ...cool, entries: targetEntries } : cool),
                }, bandMap, linkedByDate.get(otherDay.date));
                if (!candidateOtherDay || !validTimes(candidateOtherDay, bandMap, linkedByDate.get(otherDay.date))) continue;
                const candidate = bestDays.map((item, index) => index === dayIndex ? candidateDay
                  : index === otherDayIndex ? candidateOtherDay : item);
                const candidateScore = scoreSchedule(candidate, bandMap);
                if (compareAutoScheduleScores(candidateScore, bestScore) >= 0) continue;
                bestDays = candidate;
                bestScore = candidateScore;
                improved = true;
                }
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }
  bestDays = refineHeadlinerPlacement(bestDays, bands, originalIds, linkedByDate);
  bestDays = refineCoolClosers(bestDays, bands, originalIds, linkedByDate);
  bestDays = refineFinalCoolCloser(bestDays, bands, originalIds, linkedByDate);
  bestDays = refineSameCoolRepeats(bestDays, bands, originalIds, linkedByDate);
  bestDays = refineCoolBalance(bestDays, bands, originalIds, linkedByDate);
  const updated = new Map(bestPlaced > 0 ? bestDays.map(day => [day.date,
    materializeStarts ? materializeCoolStarts(day, linkedByDate.get(day.date)) : day] as const) : []);
  return {
    dailyTimetables: timetable.dailyTimetables.map(day => updated.get(day.date) ?? day).concat(bestDays.filter(day => !timetable.dailyTimetables.some(existing => existing.date === day.date))),
    placed: bestPlaced,
    remaining: missing.length - bestPlaced,
  };
};

/** Improve a completed rehearsal without changing its set of performances. */
export const minimizeRehearsalBackupUsage = (
  days: DailyTimetable[], bands: Band[], movableIds: Set<string>,
): DailyTimetable[] => {
  const originalBands = new Map(bands.map(band => [band.id, band]));
  const schedulingBands = new Map(bands.map(band => [band.id, {
    ...band,
    availableTimeSlots: [...new Set([
      ...band.availableTimeSlots, ...(band.backupRehearsalTimeSlots ?? []),
    ].map(slot => slot.date))].map(date => ({
      date,
      timeRanges: normalizeTimeRanges([
        ...(band.availableTimeSlots.find(slot => slot.date === date)?.timeRanges ?? []),
        ...(band.backupRehearsalTimeSlots?.find(slot => slot.date === date)?.timeRanges ?? []),
      ]),
    })),
  }]));
  const backupIds = (items: DailyTimetable[]): Set<string> => new Set(items.flatMap(day =>
    day.cools.flatMap(cool => cool.entries.filter(entry => {
      const band = entry.bandId ? originalBands.get(entry.bandId) : undefined;
      return band && entry.startTime && entry.endTime
        && checkBandAvailability(band, day.date, entry.startTime, entry.endTime, true) === 'backup';
    }).map(entry => entry.id))));
  let current = days;
  let backups = backupIds(current);
  let attempts = 0;
  const maxAttempts = Math.min(8000, Math.max(1000, movableIds.size * 60));
  for (let pass = 0; pass < 40 && backups.size && attempts < maxAttempts; pass++) {
    let improved = false;
    for (let dayIndex = 0; dayIndex < current.length && !improved && attempts < maxAttempts; dayIndex++) {
      const day = current[dayIndex];
      for (let sourceCoolIndex = 0; sourceCoolIndex < day.cools.length && !improved && attempts < maxAttempts; sourceCoolIndex++) {
        const sourceCool = day.cools[sourceCoolIndex];
        for (let sourceIndex = 0; sourceIndex < sourceCool.entries.length && !improved && attempts < maxAttempts; sourceIndex++) {
          const source = sourceCool.entries[sourceIndex];
          if (!backups.has(source.id) || !movableIds.has(source.id) || source.fixedStartTime) continue;
          for (let targetCoolIndex = 0; targetCoolIndex < day.cools.length && !improved && attempts < maxAttempts; targetCoolIndex++) {
            const targetCool = day.cools[targetCoolIndex];
            for (let targetIndex = 0; targetIndex <= targetCool.entries.length && !improved && attempts < maxAttempts; targetIndex++) {
              if (sourceCoolIndex === targetCoolIndex && (targetIndex === sourceIndex || targetIndex === sourceIndex + 1)) continue;
              attempts++;
              const cools = day.cools.map(cool => ({ ...cool, entries: [...cool.entries] }));
              cools[sourceCoolIndex].entries.splice(sourceIndex, 1);
              cools[targetCoolIndex].entries.splice(targetIndex - (sourceCoolIndex === targetCoolIndex && targetIndex > sourceIndex ? 1 : 0), 0, source);
              const candidateDay = retimeDay({ ...day, cools }, schedulingBands);
              if (!candidateDay || !validTimes(candidateDay, schedulingBands)) continue;
              const candidate = current.map((item, index) => index === dayIndex ? candidateDay : item);
              const candidateBackups = backupIds(candidate);
              if (candidateBackups.size >= backups.size) continue;
              current = candidate;
              backups = candidateBackups;
              improved = true;
            }
            // A swap can free a normal slot without changing cool sizes.
            for (let targetIndex = 0; targetIndex < targetCool.entries.length && !improved && attempts < maxAttempts; targetIndex++) {
              const target = targetCool.entries[targetIndex];
              if (sourceCoolIndex === targetCoolIndex && sourceIndex === targetIndex) continue;
              if (!target.bandId || !movableIds.has(target.id) || target.fixedStartTime) continue;
              attempts++;
              const cools = day.cools.map(cool => ({ ...cool, entries: [...cool.entries] }));
              cools[sourceCoolIndex].entries[sourceIndex] = target;
              cools[targetCoolIndex].entries[targetIndex] = source;
              const candidateDay = retimeDay({ ...day, cools }, schedulingBands);
              if (!candidateDay || !validTimes(candidateDay, schedulingBands)) continue;
              const candidate = current.map((item, index) => index === dayIndex ? candidateDay : item);
              const candidateBackups = backupIds(candidate);
              if (candidateBackups.size >= backups.size) continue;
              current = candidate;
              backups = candidateBackups;
              improved = true;
            }
          }
        }
      }
    }
    if (!improved) break;
  }
  return current;
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
  const finish = (result: AutoScheduleResult): AutoScheduleResult => result.error || result.placed <= 0 ? result : {
    ...result,
    dailyTimetables: result.dailyTimetables.map(day => dates.includes(day.date) ? materializeCoolStarts(day) : day),
  };
  const normal = autoSchedulePerformance(rehearsal, dates, normalBands, null, targets, false);
  if (normal.error || normal.remaining === 0) return finish(normal);

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
  if (!missingTargets.length) return finish(normal);
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
    { ...rehearsal, dailyTimetables: frozenDays }, dates, fallbackBands, null, missingTargets, false,
  );
  if (fallback.error || fallback.remaining >= normal.remaining) return finish(normal);
  const combined = {
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
  const existingIds = new Set(rehearsal.dailyTimetables.flatMap(day => entriesOf(day).map(entry => entry.id)));
  const movableIds = new Set(combined.dailyTimetables.flatMap(day => entriesOf(day)
    .filter(entry => entry.bandId && !existingIds.has(entry.id)).map(entry => entry.id)));
  return finish({ ...combined, dailyTimetables: minimizeRehearsalBackupUsage(
    combined.dailyTimetables, rehearsalBands, movableIds,
  ) });
};
