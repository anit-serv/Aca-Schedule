import { useMemo } from 'react';
import type { Band, DailyTimetable, Timetable, TimetableEntry, ConstraintViolation } from '../types';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';
import { checkBandAvailability, findConsecutiveMemberRuns, type EntryWithCool } from '../utils/scheduleChecks';
import { minimumCoolBreakMinutes } from '../utils/coolBreak';
import { fitsVenueTime, venueTimeRanges } from '../utils/venueTimeRanges';

/**
 * HH:mm形式の時刻文字列を分単位の数値に変換
 */
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const addDayEndViolations = (
  day: DailyTimetable,
  entries: Array<{ entry: TimetableEntry; coolId?: string }>,
  bandMap: Map<string, Band>,
  violations: ConstraintViolation[],
  prefix = '',
) => {
  if (!day.endTime) return;
  for (const { entry, coolId } of entries) {
    if (!entry.endTime || timeToMinutes(entry.endTime) <= timeToMinutes(day.endTime)) continue;
    const name = entry.type === 'band' ? bandMap.get(entry.bandId || '')?.name || 'バンド' : entry.customEvent?.name || 'カスタムイベント';
    violations.push({
      id: `day-end-${entry.id}`,
      type: 'day-end-exceeded', severity: 'high', entryId: entry.id, coolId, date: day.date,
      bandId: entry.type === 'band' ? entry.bandId : undefined,
      message: `${prefix}${name} の終了時刻（${entry.endTime}）が当日の終了時刻（${day.endTime}）を超過しています`,
    });
  }
};

const addVenueTimeViolations = (
  day: DailyTimetable,
  entries: Array<{ entry: TimetableEntry; coolId?: string }>,
  bandMap: Map<string, Band>,
  violations: ConstraintViolation[],
  prefix = '',
) => {
  if (day.venueTimeRanges === undefined) return;
  for (const { entry, coolId } of entries) {
    if (!entry.startTime || !entry.endTime || fitsVenueTime(day, timeToMinutes(entry.startTime), timeToMinutes(entry.endTime))) continue;
    const name = entry.type === 'band' ? bandMap.get(entry.bandId || '')?.name || 'バンド' : entry.customEvent?.name || 'カスタムイベント';
    violations.push({
      id: `venue-time-${entry.id}`, type: 'venue-time-exceeded', severity: 'high',
      entryId: entry.id, coolId, date: day.date, bandId: entry.bandId,
      message: `${prefix}${name} が会場の演奏可能時間外に配置されています（${entry.startTime} - ${entry.endTime}）`,
    });
  }
};

const addCoolBreakViolations = (day: DailyTimetable, violations: ConstraintViolation[], prefix = '') => {
  const required = minimumCoolBreakMinutes(day);
  if (required === 0) return;
  for (let index = 1; index < day.cools.length; index++) {
    const previous = day.cools[index - 1];
    const next = day.cools[index];
    const last = previous.entries.at(-1);
    const first = next.entries[0];
    if (!last?.endTime || !first?.startTime) continue;
    const actual = timeToMinutes(first.startTime) - timeToMinutes(last.endTime);
    if (actual >= required) continue;
    violations.push({
      id: `cool-break-${last.id}-${first.id}`,
      type: 'cool-break-short', severity: 'medium', entryId: first.id, coolId: next.id,
      date: day.date, bandId: first.bandId, relatedEntryIds: [last.id],
      message: `${prefix}第${previous.number}クールと第${next.number}クールの休憩が${actual}分です（設定: ${required}分）`,
    });
  }
};

const addConsecutivePerformanceNotices = (
  entries: EntryWithCool[], bandMap: Map<string, Band>, bandNumbers: Map<string, number>,
  violations: ConstraintViolation[], date: string, prefix: string,
) => {
  findConsecutiveMemberRuns(entries, bandMap).forEach(({ entries: run, members }) => {
    const bands = run.map(({ entry }) => bandMap.get(entry.bandId!)!);
    const costume = bands.some(band => band.costume);
    const severity = run.length >= 4 ? 'high' : run.length >= 3 || costume ? 'medium' : 'low';
    const numbers = run.map(({ entry }) => bandNumbers.get(entry.id)).filter((number): number is number => number !== undefined);
    const numberInfo = numbers.length === run.length ? ` (#${numbers.join('-#')})` : '';
    const message = `${prefix}${members.join('、')}が${run.length}枠連続出演（${bands.map(band => band.name).join(' → ')}）${costume ? '・衣装あり' : ''}${numberInfo}`;
    const id = `consecutive-${run[0].entry.id}-${run.at(-1)!.entry.id}`;
    run.forEach(({ entry, coolId }, index) => {
      violations.push({
        id: index === 0 ? id : `${id}-ref`, type: 'consecutive-performance', severity,
        entryId: entry.id, coolId, date, message, bandId: entry.bandId,
        relatedEntryIds: run.filter(item => item.entry.id !== entry.id).map(item => item.entry.id),
      });
    });
  });
};

const addToriPriorityNotices = (
  timetable: Timetable, bandMap: Map<string, Band>, violations: ConstraintViolation[],
) => {
  const days = [...timetable.dailyTimetables].sort((a, b) => a.date.localeCompare(b.date));
  const lastDay = days.at(-1);
  const lastCool = lastDay?.cools.at(-1);
  const lastCoolId = lastCool?.id;
  const finalCoolStart = lastDay && lastCool
    ? timeToMinutes(lastCool.startTime ?? lastCool.entries[0]?.startTime
      ?? lastDay.cools.at(-2)?.entries.at(-1)?.endTime ?? lastDay.startTime)
    : 0;
  const canPerformInFinalCool = (band: Band): boolean => {
    if (!lastDay) return false;
    const availability = band.availableTimeSlots.find(slot => slot.date === lastDay.date);
    if (!availability) return false;
    const dayEnd = timeToMinutes(lastDay.endTime ?? '24:00');
    return availability.timeRanges.some(range => venueTimeRanges(lastDay).some(venue => {
      const start = Math.max(finalCoolStart, timeToMinutes(range.startTime), timeToMinutes(venue.startTime));
      const end = Math.min(dayEnd, timeToMinutes(range.endTime), timeToMinutes(venue.endTime));
      return end - start >= band.performanceDuration;
    }));
  };
  const performances = new Map<string, Array<{ entry: TimetableEntry; coolId: string; date: string; isCoolCloser: boolean; isFinalCool: boolean }>>();
  days.forEach(day => day.cools.forEach(cool => {
    const lastBand = [...cool.entries].reverse().find(entry => entry.type === 'band');
    cool.entries.forEach(entry => {
      if (entry.type !== 'band' || !entry.bandId || !bandMap.has(entry.bandId)) return;
      const items = performances.get(entry.bandId) ?? [];
      items.push({ entry, coolId: cool.id, date: day.date,
        isCoolCloser: entry.id === lastBand?.id && !(day.date === lastDay?.date && cool.id === lastCoolId),
        isFinalCool: day.date === lastDay?.date && cool.id === lastCoolId });
      performances.set(entry.bandId, items);
    });
  }));
  performances.forEach((items, bandId) => {
    const band = bandMap.get(bandId)!;
    const priority = band.toriPriority ?? 1;
    if (priority === 1 || items.some(item => priority === 2 ? item.isCoolCloser : item.isFinalCool)) return;
    const first = items[0];
    violations.push({
      id: `tori-priority-${bandId}`, type: 'tori-priority-unmet',
      severity: priority === 3 && canPerformInFinalCool(band) ? 'medium' : 'low',
      entryId: first.entry.id, coolId: first.coolId, date: first.date, bandId,
      relatedEntryIds: items.slice(1).map(item => item.entry.id),
      message: priority === 3
        ? canPerformInFinalCool(band)
          ? `[本番] ${band.name} はトリ優先度3ですが、最終日の最後のクールに出演していません`
          : `[本番] ${band.name} はトリ優先度3ですが、最終日の最後のクールが出演可能時間外です`
        : `[本番] ${band.name} はトリ優先度2ですが、最終クール以外のクールの最後に出演していません`,
    });
  });
};

/**
 * 制約チェックを行うカスタムフック
 */
export const useConstraintCheck = (
  dailyTimetable: DailyTimetable | null,
  bands: Band[],
  bandNumbers: Map<string, number>
): ConstraintViolation[] => {
  return useMemo(() => {
    if (!dailyTimetable) return [];

    const violations: ConstraintViolation[] = [];
    const bandMap = new Map(bands.map(b => [b.id, b]));

    // 全エントリを取得（クール構造の有無に関わらず）
    const allEntries: Array<{ entry: TimetableEntry; coolId?: string }> = [];
    
    if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
      // クール構造がある場合
      dailyTimetable.cools.forEach(cool => {
        cool.entries.forEach(entry => {
          allEntries.push({ entry, coolId: cool.id });
        });
      });
    } else {
      // クール構造がない場合
      dailyTimetable.entries.forEach(entry => {
        allEntries.push({ entry });
      });
    }

    addDayEndViolations(dailyTimetable, allEntries, bandMap, violations);
    addVenueTimeViolations(dailyTimetable, allEntries, bandMap, violations);
    addCoolBreakViolations(dailyTimetable, violations);

    // 1. バンドの利用可能時間帯チェック
    allEntries.forEach(({ entry, coolId }) => {
      if (entry.type !== 'band' || !entry.bandId) return;
      
      const band = bandMap.get(entry.bandId);
      if (!band) return;

      // このバンドの該当日の利用可能時間帯を取得
      // エントリの開始・終了時刻を取得
      if (!entry.startTime || !entry.endTime) return;
      if (checkBandAvailability(band, dailyTimetable.date, entry.startTime, entry.endTime) === 'outside') {
        const bandNumber = bandNumbers.get(entry.id);
        const bandNumberInfo = bandNumber ? ` (#${bandNumber})` : '';
        
        violations.push({
          id: `availability-${entry.id}`,
          type: 'availability-exceeded',
          severity: 'high',
          entryId: entry.id,
          coolId,
          date: dailyTimetable.date,
          message: `${band.name}${bandNumberInfo} の出演可能時間帯外に配置されています（${entry.startTime} - ${entry.endTime}）`,
          bandId: band.id,
        });
      }
    });

    // 2. 同一クール内での重複チェック
    if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
      dailyTimetable.cools.forEach(cool => {
        const bandCounts = new Map<string, TimetableEntry[]>();

        cool.entries.forEach(entry => {
          if (entry.type === 'band' && entry.bandId) {
            const existing = bandCounts.get(entry.bandId) || [];
            existing.push(entry);
            bandCounts.set(entry.bandId, existing);
          }
        });

        // 重複があるバンドをチェック
        // 同じクール内の同じバンドの重複は1件としてカウント
        bandCounts.forEach((entries, bandId) => {
          if (entries.length > 1) {
            const band = bandMap.get(bandId);
            if (!band) return;

            // バンド番号のリストを取得
            const bandNumbersList = entries
              .map(e => bandNumbers.get(e.id))
              .filter((num): num is number => num !== undefined)
              .map(num => `#${num}`)
              .join(', ');
            const bandNumberInfo = bandNumbersList ? ` (${bandNumbersList})` : '';

            // 重複グループ全体で1つの違反として記録
            // 最初のエントリーに代表して違反を記録
            const representativeEntry = entries[0];
            violations.push({
              id: `duplicate-${cool.id}-${bandId}`,
              type: 'duplicate-in-cool',
              severity: 'medium',
              entryId: representativeEntry.id,
              coolId: cool.id,
              date: dailyTimetable.date,
              message: `${band.name}${bandNumberInfo} がクール${cool.number}内で${entries.length}回重複しています`,
              bandId: band.id,
              relatedEntryIds: entries.slice(1).map(e => e.id),
            });

            // 他のエントリーにも同じ違反IDで参照を追加（視覚的表示のため）
            entries.slice(1).forEach(entry => {
              violations.push({
                id: `duplicate-${cool.id}-${bandId}-ref-${entry.id}`,
                type: 'duplicate-in-cool',
                severity: 'medium',
                entryId: entry.id,
                coolId: cool.id,
                date: dailyTimetable.date,
                message: `${band.name}${bandNumberInfo} がクール${cool.number}内で${entries.length}回重複しています`,
                bandId: band.id,
                relatedEntryIds: [representativeEntry.id, ...entries.filter(e => e.id !== entry.id).map(e => e.id)],
              });
            });
          }
        });
      });
    }

    addConsecutivePerformanceNotices(allEntries, bandMap, bandNumbers, violations, dailyTimetable.date, '');

    // 4. 次のクール開始時刻超過チェック
    if (dailyTimetable.cools && dailyTimetable.cools.length > 1) {
      for (let i = 0; i < dailyTimetable.cools.length - 1; i++) {
        const currentCool = dailyTimetable.cools[i];
        const nextCool = dailyTimetable.cools[i + 1];
        
        // 次のクールに固定開始時刻が設定されている場合のみチェック
        if (!nextCool.startTime) continue;
        
        // 現在のクールの最後のエントリーを取得
        const lastEntry = currentCool.entries[currentCool.entries.length - 1];
        if (!lastEntry || !lastEntry.endTime) continue;
        
        const lastEntryEnd = timeToMinutes(lastEntry.endTime);
        const nextCoolStart = timeToMinutes(nextCool.startTime);
        
        // 現在のクールの終了時刻が次のクールの開始時刻を超過している場合
        if (lastEntryEnd > nextCoolStart) {
          const bandNumber = bandNumbers.get(lastEntry.id);
          const bandNumberInfo = bandNumber ? ` (#${bandNumber})` : '';
          
          let bandName = '';
          if (lastEntry.type === 'band' && lastEntry.bandId) {
            const band = bandMap.get(lastEntry.bandId);
            if (band) bandName = band.name;
          } else if (lastEntry.type === 'custom' && lastEntry.customEvent) {
            bandName = lastEntry.customEvent.name;
          }
          
          violations.push({
            id: `cool-time-${lastEntry.id}`,
            type: 'cool-time-exceeded',
            severity: 'high',
            entryId: lastEntry.id,
            coolId: currentCool.id,
            date: dailyTimetable.date,
            message: `${bandName}${bandNumberInfo} の終了時刻（${lastEntry.endTime}）が次のクール${nextCool.number}の開始時刻（${nextCool.startTime}）を超過しています`,
            bandId: lastEntry.type === 'band' ? lastEntry.bandId : undefined,
          });
        }
      }
    }

    return violations;
  }, [dailyTimetable, bands, bandNumbers]);
};

/**
 * 本番・リハーサル両方の全日程の制約違反を取得するフック
 * @param timetableType 現在のタイムテーブルタイプ（表示用のプレフィックス決定に使用）
 */
export const useAllViolations = (
  performanceTimetable: Timetable | null,
  rehearsalTimetable: Timetable | null,
  bands: Band[]
): ConstraintViolation[] => {
  return useMemo(() => {
    const violations: ConstraintViolation[] = [];
    const bandMap = new Map(bands.map(b => [b.id, b]));

    // タイムテーブルごとに制約チェック
    const checkTimetable = (timetable: Timetable | null, prefix: string) => {
      if (!timetable) return;
      
      const bandNumbers = calculateBandNumbers(timetable);
      
      timetable.dailyTimetables.forEach(dailyTimetable => {
        checkDailyTimetable(dailyTimetable, bandMap, bandNumbers, violations, prefix);
      });
    };

    checkTimetable(performanceTimetable, '本番');
    checkTimetable(rehearsalTimetable, 'リハ');
    if (performanceTimetable) addToriPriorityNotices(performanceTimetable, bandMap, violations);

    return violations;
  }, [performanceTimetable, rehearsalTimetable, bands]);
};

/**
 * 日次タイムテーブルの制約チェック（内部ヘルパー関数）
 */
function checkDailyTimetable(
  dailyTimetable: DailyTimetable,
  bandMap: Map<string, Band>,
  bandNumbers: Map<string, number>,
  violations: ConstraintViolation[],
  typePrefix: string
): void {
  // 全エントリを取得
  const allEntries: Array<{ entry: TimetableEntry; coolId?: string }> = [];
  
  if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
    dailyTimetable.cools.forEach(cool => {
      cool.entries.forEach(entry => {
        allEntries.push({ entry, coolId: cool.id });
      });
    });
  } else {
    dailyTimetable.entries.forEach(entry => {
      allEntries.push({ entry });
    });
  }

  // 日付フォーマット（MM/DD形式）
  const dateStr = dailyTimetable.date;
  const d = new Date(dateStr);
  const formattedDate = `${d.getMonth() + 1}/${d.getDate()}`;

  addDayEndViolations(dailyTimetable, allEntries, bandMap, violations, `[${typePrefix} ${formattedDate}] `);
  addVenueTimeViolations(dailyTimetable, allEntries, bandMap, violations, `[${typePrefix} ${formattedDate}] `);
  addCoolBreakViolations(dailyTimetable, violations, `[${typePrefix} ${formattedDate}] `);

  // 1. バンドの利用可能時間帯チェック
  allEntries.forEach(({ entry, coolId }) => {
    if (entry.type !== 'band' || !entry.bandId) return;
    
    const band = bandMap.get(entry.bandId);
    if (!band) return;

    if (!entry.startTime || !entry.endTime) return;
    const availability = checkBandAvailability(
      band, dailyTimetable.date, entry.startTime, entry.endTime, typePrefix === 'リハ',
    );

    if (availability === 'backup') {
      const bandNumber = bandNumbers.get(entry.id);
      const bandNumberInfo = bandNumber ? ` (#${bandNumber})` : '';
      violations.push({
        id: `backup-rehearsal-${entry.id}`,
        type: 'backup-rehearsal-used',
        severity: 'low',
        entryId: entry.id,
        coolId,
        date: dailyTimetable.date,
        message: `[${typePrefix} ${formattedDate}] ${band.name}${bandNumberInfo} は予備出演可能時間を使用しています（${entry.startTime} - ${entry.endTime}）`,
        bandId: band.id,
      });
    }

    if (availability === 'outside') {
      const bandNumber = bandNumbers.get(entry.id);
      const bandNumberInfo = bandNumber ? ` (#${bandNumber})` : '';
      
      violations.push({
        id: `availability-${entry.id}`,
        type: 'availability-exceeded',
        severity: 'high',
        entryId: entry.id,
        coolId,
        date: dailyTimetable.date,
        message: `[${typePrefix} ${formattedDate}] ${band.name}${bandNumberInfo} の出演可能時間帯外（${entry.startTime} - ${entry.endTime}）`,
        bandId: band.id,
      });
    }
  });

  // 2. 同一クール内での重複チェック
  if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
    dailyTimetable.cools.forEach(cool => {
      const bandCounts = new Map<string, TimetableEntry[]>();

      cool.entries.forEach(entry => {
        if (entry.type === 'band' && entry.bandId) {
          const existing = bandCounts.get(entry.bandId) || [];
          existing.push(entry);
          bandCounts.set(entry.bandId, existing);
        }
      });

      bandCounts.forEach((entries, bandId) => {
        if (entries.length > 1) {
          const band = bandMap.get(bandId);
          if (!band) return;

          const bandNumbersList = entries
            .map(e => bandNumbers.get(e.id))
            .filter((num): num is number => num !== undefined)
            .map(num => `#${num}`)
            .join(', ');
          const bandNumberInfo = bandNumbersList ? ` (${bandNumbersList})` : '';

          const representativeEntry = entries[0];
          violations.push({
            id: `duplicate-${cool.id}-${bandId}`,
            type: 'duplicate-in-cool',
            severity: 'medium',
            entryId: representativeEntry.id,
            coolId: cool.id,
            date: dailyTimetable.date,
            message: `[${typePrefix} ${formattedDate}] ${band.name}${bandNumberInfo} がクール${cool.number}内で${entries.length}回重複`,
            bandId: band.id,
            relatedEntryIds: entries.slice(1).map(e => e.id),
          });

          entries.slice(1).forEach(entry => {
            violations.push({
              id: `duplicate-${cool.id}-${bandId}-ref-${entry.id}`,
              type: 'duplicate-in-cool',
              severity: 'medium',
              entryId: entry.id,
              coolId: cool.id,
              date: dailyTimetable.date,
              message: `[${typePrefix} ${formattedDate}] ${band.name}${bandNumberInfo} がクール${cool.number}内で${entries.length}回重複`,
              bandId: band.id,
              relatedEntryIds: [representativeEntry.id, ...entries.filter(e => e.id !== entry.id).map(e => e.id)],
            });
          });
        }
      });
    });
  }

  addConsecutivePerformanceNotices(allEntries, bandMap, bandNumbers, violations, dailyTimetable.date, `[${typePrefix} ${formattedDate}] `);

  // 4. 次のクール開始時刻超過チェック
  if (dailyTimetable.cools && dailyTimetable.cools.length > 1) {
    for (let i = 0; i < dailyTimetable.cools.length - 1; i++) {
      const currentCool = dailyTimetable.cools[i];
      const nextCool = dailyTimetable.cools[i + 1];
      
      if (!nextCool.startTime) continue;
      
      const lastEntry = currentCool.entries[currentCool.entries.length - 1];
      if (!lastEntry || !lastEntry.endTime) continue;
      
      const lastEntryEnd = timeToMinutes(lastEntry.endTime);
      const nextCoolStart = timeToMinutes(nextCool.startTime);
      
      if (lastEntryEnd > nextCoolStart) {
        const bandNumber = bandNumbers.get(lastEntry.id);
        const bandNumberInfo = bandNumber ? ` (#${bandNumber})` : '';
        
        let bandName = '';
        if (lastEntry.type === 'band' && lastEntry.bandId) {
          const band = bandMap.get(lastEntry.bandId);
          if (band) bandName = band.name;
        } else if (lastEntry.type === 'custom' && lastEntry.customEvent) {
          bandName = lastEntry.customEvent.name;
        }
        
        violations.push({
          id: `cool-time-${lastEntry.id}`,
          type: 'cool-time-exceeded',
          severity: 'high',
          entryId: lastEntry.id,
          coolId: currentCool.id,
          date: dailyTimetable.date,
          message: `[${typePrefix} ${formattedDate}] ${bandName}${bandNumberInfo} がクール${nextCool.number}開始時刻（${nextCool.startTime}）を超過（終了${lastEntry.endTime}）`,
          bandId: lastEntry.type === 'band' ? lastEntry.bandId : undefined,
        });
      }
    }
  }
}
