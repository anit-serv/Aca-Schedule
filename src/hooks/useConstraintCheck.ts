import { useMemo } from 'react';
import type { Band, DailyTimetable, Timetable, TimetableEntry, ConstraintViolation } from '../types';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';

/**
 * HH:mm形式の時刻文字列を分単位の数値に変換
 */
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
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

    // 1. バンドの利用可能時間帯チェック
    allEntries.forEach(({ entry, coolId }) => {
      if (entry.type !== 'band' || !entry.bandId) return;
      
      const band = bandMap.get(entry.bandId);
      if (!band) return;

      // このバンドの該当日の利用可能時間帯を取得
      const availableSlot = band.availableTimeSlots.find(
        slot => slot.date === dailyTimetable.date
      );

      if (!availableSlot || availableSlot.timeRanges.length === 0) {
        // 利用可能時間帯が設定されていない場合はチェックしない
        return;
      }

      // エントリの開始・終了時刻を取得
      if (!entry.startTime || !entry.endTime) return;

      const entryStart = timeToMinutes(entry.startTime);
      const entryEnd = timeToMinutes(entry.endTime);

      // いずれかの時間範囲内に収まっているかチェック
      const isWithinAvailableTime = availableSlot.timeRanges.some(range => {
        const rangeStart = timeToMinutes(range.startTime);
        const rangeEnd = timeToMinutes(range.endTime);
        return entryStart >= rangeStart && entryEnd <= rangeEnd;
      });

      if (!isWithinAvailableTime) {
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

    // 3. 連続出演チェック
    // 既に処理したペアを記録（重複カウント防止）
    const processedPairs = new Set<string>();
    
    for (let i = 0; i < allEntries.length - 1; i++) {
      const current = allEntries[i];
      const next = allEntries[i + 1];

      if (current.entry.type !== 'band' || !current.entry.bandId) continue;
      if (next.entry.type !== 'band' || !next.entry.bandId) continue;

      const currentBand = bandMap.get(current.entry.bandId);
      const nextBand = bandMap.get(next.entry.bandId);

      if (!currentBand || !nextBand) continue;

      // メンバーの重複をチェック
      const commonMembers = currentBand.members.filter(member =>
        nextBand.members.includes(member)
      );

      if (commonMembers.length > 0) {
        // ペアIDを作成（エントリーIDの組み合わせで一意に識別）
        const pairId = `${current.entry.id}-${next.entry.id}`;
        
        // このペアが既に処理されていないかチェック
        if (!processedPairs.has(pairId)) {
          processedPairs.add(pairId);
          
          // バンド番号を取得
          const currentBandNumber = bandNumbers.get(current.entry.id);
          const nextBandNumber = bandNumbers.get(next.entry.id);
          const bandNumberInfo = currentBandNumber && nextBandNumber 
            ? ` (#${currentBandNumber}-#${nextBandNumber})`
            : '';
          
          // 前のエントリー（current）に違反を追加
          violations.push({
            id: `consecutive-${pairId}`,
            type: 'consecutive-performance',
            severity: 'low',
            entryId: current.entry.id,
            coolId: current.coolId,
            date: dailyTimetable.date,
            message: `${currentBand.name} のメンバー（${commonMembers.join(', ')}）が次のバンド（${nextBand.name}）と連続出演しています${bandNumberInfo}`,
            bandId: currentBand.id,
            relatedEntryIds: [next.entry.id],
          });

          // 次のエントリー（next）にも同じペアの違反を追加（視覚的表示のため）
          violations.push({
            id: `consecutive-${pairId}-ref`,
            type: 'consecutive-performance',
            severity: 'low',
            entryId: next.entry.id,
            coolId: next.coolId,
            date: dailyTimetable.date,
            message: `${nextBand.name} のメンバー（${commonMembers.join(', ')}）が前のバンド（${currentBand.name}）と連続出演しています${bandNumberInfo}`,
            bandId: nextBand.id,
            relatedEntryIds: [current.entry.id],
          });
        }
      }
    }

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

  // 1. バンドの利用可能時間帯チェック
  allEntries.forEach(({ entry, coolId }) => {
    if (entry.type !== 'band' || !entry.bandId) return;
    
    const band = bandMap.get(entry.bandId);
    if (!band) return;

    const availableSlot = band.availableTimeSlots.find(
      slot => slot.date === dailyTimetable.date
    );

    if (!availableSlot || availableSlot.timeRanges.length === 0) return;
    if (!entry.startTime || !entry.endTime) return;

    const entryStart = timeToMinutes(entry.startTime);
    const entryEnd = timeToMinutes(entry.endTime);

    const isWithinAvailableTime = availableSlot.timeRanges.some(range => {
      const rangeStart = timeToMinutes(range.startTime);
      const rangeEnd = timeToMinutes(range.endTime);
      return entryStart >= rangeStart && entryEnd <= rangeEnd;
    });

    if (!isWithinAvailableTime) {
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

  // 3. 連続出演チェック
  const processedPairs = new Set<string>();
  
  for (let i = 0; i < allEntries.length - 1; i++) {
    const current = allEntries[i];
    const next = allEntries[i + 1];

    if (current.entry.type !== 'band' || !current.entry.bandId) continue;
    if (next.entry.type !== 'band' || !next.entry.bandId) continue;

    const currentBand = bandMap.get(current.entry.bandId);
    const nextBand = bandMap.get(next.entry.bandId);

    if (!currentBand || !nextBand) continue;

    const commonMembers = currentBand.members.filter(member =>
      nextBand.members.includes(member)
    );

    if (commonMembers.length > 0) {
      const pairId = `${current.entry.id}-${next.entry.id}`;
      
      if (!processedPairs.has(pairId)) {
        processedPairs.add(pairId);
        
        const currentBandNumber = bandNumbers.get(current.entry.id);
        const nextBandNumber = bandNumbers.get(next.entry.id);
        const bandNumberInfo = currentBandNumber && nextBandNumber 
          ? ` (#${currentBandNumber}-#${nextBandNumber})`
          : '';
        
        violations.push({
          id: `consecutive-${pairId}`,
          type: 'consecutive-performance',
          severity: 'low',
          entryId: current.entry.id,
          coolId: current.coolId,
          date: dailyTimetable.date,
          message: `[${typePrefix} ${formattedDate}] ${currentBand.name} → ${nextBand.name} 連続出演（${commonMembers.join(', ')}）${bandNumberInfo}`,
          bandId: currentBand.id,
          relatedEntryIds: [next.entry.id],
        });

        violations.push({
          id: `consecutive-${pairId}-ref`,
          type: 'consecutive-performance',
          severity: 'low',
          entryId: next.entry.id,
          coolId: next.coolId,
          date: dailyTimetable.date,
          message: `[${typePrefix} ${formattedDate}] ${currentBand.name} → ${nextBand.name} 連続出演（${commonMembers.join(', ')}）${bandNumberInfo}`,
          bandId: nextBand.id,
          relatedEntryIds: [current.entry.id],
        });
      }
    }
  }

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
