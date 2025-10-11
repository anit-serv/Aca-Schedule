import { useMemo } from 'react';
import type { Band, DailyTimetable, TimetableEntry, ConstraintViolation } from '../types';

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

    return violations;
  }, [dailyTimetable, bands, bandNumbers]);
};
