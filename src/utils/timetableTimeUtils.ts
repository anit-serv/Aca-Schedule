import type { Band, Cool, DailyTimetable, TimetableEntry } from '../types';

// 日付の最初のクールの開始時刻を取得
export const getFirstCoolStartTime = (dailyTimetable?: DailyTimetable): string | undefined => {
  return dailyTimetable?.cools?.[0]?.startTime;
};

// cool.startTime の未設定（継続）を保持するため、日付開始時刻のみ正規化する
export const normalizeFirstCoolStartTime = (dailyTimetable: DailyTimetable, unifiedStartTime: string): DailyTimetable => {
  return {
    ...dailyTimetable,
    startTime: unifiedStartTime,
  };
};

export const isSameDailyTimetable = (a: DailyTimetable, b: DailyTimetable): boolean => {
  return JSON.stringify(a) === JSON.stringify(b);
};

// リハーサルの最終エントリーの終了時刻を取得
export const getRehearsalEndTime = (dailyTimetable: DailyTimetable): string | null => {
  // クール構造から最終エントリーの終了時刻を取得
  if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
    for (let i = dailyTimetable.cools.length - 1; i >= 0; i--) {
      const cool = dailyTimetable.cools[i];
      if (cool.entries.length > 0) {
        const lastEntry = cool.entries[cool.entries.length - 1];
        if (lastEntry.endTime) return lastEntry.endTime;
      }
    }
  }
  // フラット構造
  if (dailyTimetable.entries && dailyTimetable.entries.length > 0) {
    const lastEntry = dailyTimetable.entries[dailyTimetable.entries.length - 1];
    if (lastEntry.endTime) return lastEntry.endTime;
  }
  return null;
};

// 本番用のエントリー時刻を再計算するヘルパー
export const recalculatePerformanceEntryTimes = (entries: TimetableEntry[], startTime: string, bands: Band[]): TimetableEntry[] => {
  let currentTime = startTime;
  return entries.map((entry, index) => {
    const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
    const duration = band?.performanceDuration || entry.customEvent?.duration || 0;
    const transitionTime = entry.transitionTime || 0;
    const [hours, minutes] = currentTime.split(':').map(Number);
    const startMinutes = entry.fixedStartTime ? Number(entry.fixedStartTime.slice(0, 2)) * 60 + Number(entry.fixedStartTime.slice(3)) : hours * 60 + minutes + transitionTime;
    const endMinutes = startMinutes + duration;
    const entryStart = `${Math.floor(startMinutes / 60).toString().padStart(2, '0')}:${(startMinutes % 60).toString().padStart(2, '0')}`;
    const entryEnd = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
    currentTime = entryEnd;
    return { ...entry, startTime: entryStart, endTime: entryEnd, order: index };
  });
};

// リハーサル用のエントリー時刻を再計算するヘルパー
export const recalculateRehearsalEntryTimes = (entries: TimetableEntry[], startTime: string, rehearsalDuration: number): TimetableEntry[] => {
  let currentTime = startTime;

  return entries.map((entry, index) => {
    const duration = entry.customEvent?.duration || rehearsalDuration;
    const transitionTime = entry.transitionTime || 0;
    const [hours, minutes] = currentTime.split(':').map(Number);
    const startMinutes = entry.fixedStartTime ? Number(entry.fixedStartTime.slice(0, 2)) * 60 + Number(entry.fixedStartTime.slice(3)) : hours * 60 + minutes + transitionTime;
    const endMinutes = startMinutes + duration;
    const entryStart = `${Math.floor(startMinutes / 60).toString().padStart(2, '0')}:${(startMinutes % 60).toString().padStart(2, '0')}`;
    const entryEnd = `${Math.floor(endMinutes / 60).toString().padStart(2, '0')}:${(endMinutes % 60).toString().padStart(2, '0')}`;
    currentTime = entryEnd;
    return { ...entry, startTime: entryStart, endTime: entryEnd, order: index };
  });
};

export const getCoolEndTime = (cool?: Cool): string | undefined => {
  if (!cool || !cool.entries || cool.entries.length === 0) return undefined;
  return cool.entries[cool.entries.length - 1].endTime;
};

export const recalculatePerformanceCoolTimes = (cools: Cool[], dailyStartTime: string, bands: Band[], linkedRehearsalCools?: Cool[]): Cool[] => {
  if (!cools || cools.length === 0) return cools;
  let currentTime = dailyStartTime;
  return cools.map((cool, index) => {
    if (cool.startTime) currentTime = cool.startTime;

    // クール直前リハーサル: 対応するリハ終了時刻を本番開始に反映
    const linkedRehearsalEndTime = getCoolEndTime(linkedRehearsalCools?.[index]);
    if (linkedRehearsalEndTime && !cool.startTime) {
      currentTime = linkedRehearsalEndTime;
    }

    const updatedEntries = recalculatePerformanceEntryTimes(cool.entries, currentTime, bands);
    if (updatedEntries.length > 0) {
      const lastEntry = updatedEntries[updatedEntries.length - 1];
      currentTime = lastEntry.endTime || currentTime;
    }
    return { ...cool, entries: updatedEntries };
  });
};

export const recalculateRehearsalCoolTimes = (cools: Cool[], dailyStartTime: string, rehearsalDuration: number, linkedPerformanceCools?: Cool[]): Cool[] => {
  if (!cools || cools.length === 0) return cools;
  let currentTime = dailyStartTime;

  return cools.map((cool, index) => {
    if (cool.startTime) currentTime = cool.startTime;

    // クール直前リハーサル: 前クール本番終了時刻を次クールリハ開始に反映
    if (index > 0) {
      const previousPerformanceEndTime = getCoolEndTime(linkedPerformanceCools?.[index - 1]);
      if (previousPerformanceEndTime) {
        currentTime = previousPerformanceEndTime;
      }
    }

    const updatedEntries = recalculateRehearsalEntryTimes(cool.entries, currentTime, rehearsalDuration);
    if (updatedEntries.length > 0) {
      const lastEntry = updatedEntries[updatedEntries.length - 1];
      currentTime = lastEntry.endTime || currentTime;
    }

    return { ...cool, entries: updatedEntries };
  });
};
