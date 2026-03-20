import { useMemo, useCallback } from 'react';
import type { Band, EventSettings, Timetable, TimetableEntry, Cool } from '../types';

interface UseTimetableHelpersProps {
  bands: Band[];
  eventSettings: EventSettings;
  timetableType: 'performance' | 'rehearsal';
  timetable: Timetable | null;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  selectedDate: string;
}

export const useTimetableHelpers = ({
  bands,
  eventSettings,
  timetableType,
  timetable,
  performanceTimetable,
  rehearsalTimetable,
  selectedDate,
}: UseTimetableHelpersProps) => {
  
  // 各バンドの配置回数を計算（全日程を対象）
  const bandUsageCount = useMemo(() => {
    const counts: Record<string, number> = {};
    timetable?.dailyTimetables.forEach((dailyTimetable) => {
      // クール分けされている場合
      if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
        dailyTimetable.cools.forEach((cool) => {
          cool.entries.forEach((entry) => {
            if (entry.type === 'band' && entry.bandId) {
              counts[entry.bandId] = (counts[entry.bandId] || 0) + 1;
            }
          });
        });
      } else {
        // クール分けされていない場合
        dailyTimetable.entries.forEach((entry) => {
          if (entry.type === 'band' && entry.bandId) {
            counts[entry.bandId] = (counts[entry.bandId] || 0) + 1;
          }
        });
      }
    });
    return counts;
  }, [timetable]);

  // 未配置バンドのリスト
  const unplacedBands = useMemo(() => {
    // リハーサルタイムテーブルで、かつ当日リハーサル(クール直前/当日一括)の場合の特別処理
    if (timetableType === 'rehearsal' && (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')) {
      // 本番タイムテーブルから当日配置されているバンドIDを抽出
      const performanceBandIds = new Set<string>();
      
      if (performanceTimetable) {
        const performanceDailyTimetable = performanceTimetable.dailyTimetables.find(
          (dt) => dt.date === selectedDate
        );
        
        if (performanceDailyTimetable) {
          // クール構造から抽出
          performanceDailyTimetable.cools?.forEach((cool) => {
            cool.entries.forEach((entry) => {
              if (entry.type === 'band' && entry.bandId) {
                performanceBandIds.add(entry.bandId);
              }
            });
          });
          
          // 従来の平坦な構造からも抽出（後方互換性）
          performanceDailyTimetable.entries?.forEach((entry) => {
            if (entry.type === 'band' && entry.bandId) {
              performanceBandIds.add(entry.bandId);
            }
          });
        }
      }
      
      // リハーサルタイムテーブル内での使用回数をカウント
      // 当日一括リハーサル: 同日リハ→本番なので、選択中の日付のみカウント
      // クール直前リハーサル: 本番と同期するので全日程横断でカウント
      const rehearsalUsageCount: Record<string, number> = {};
      if (rehearsalTimetable) {
        const targetDailyTimetables = eventSettings.rehearsalType === 'day-start-rehearsal'
          ? rehearsalTimetable.dailyTimetables.filter(dt => dt.date === selectedDate)
          : rehearsalTimetable.dailyTimetables;
        
        targetDailyTimetables.forEach((dailyTimetable) => {
          // クール構造からカウント
          dailyTimetable.cools?.forEach((cool) => {
            cool.entries.forEach((entry) => {
              if (entry.type === 'band' && entry.bandId) {
                rehearsalUsageCount[entry.bandId] = (rehearsalUsageCount[entry.bandId] || 0) + 1;
              }
            });
          });
          
          // 平坦な構造からもカウント（後方互換性）
          dailyTimetable.entries?.forEach((entry) => {
            if (entry.type === 'band' && entry.bandId) {
              rehearsalUsageCount[entry.bandId] = (rehearsalUsageCount[entry.bandId] || 0) + 1;
            }
          });
        });
      }
      
      // 本番タイムテーブルに配置されたバンドのみをフィルタリング
      // かつ、リハーサルタイムテーブルでまだ1回も配置されていないバンドのみ
      return bands
        .filter((band) => performanceBandIds.has(band.id))
        .map((band) => ({
          ...band,
          placedCount: rehearsalUsageCount[band.id] || 0,
        }))
        .filter((band) => band.placedCount < 1); // リハーサルは各バンド1回まで
    }
    
    // 通常の処理
    if (timetableType === 'rehearsal') {
      // 別日リハーサルの場合も各バンド1回まで
      return bands
        .map((band) => ({
          ...band,
          placedCount: bandUsageCount[band.id] || 0,
        }))
        .filter((band) => band.placedCount < 1);
    }
    
    // 本番タイムテーブルの場合
    return bands
      .map((band) => ({
        ...band,
        placedCount: bandUsageCount[band.id] || 0,
      }))
      .filter((band) => band.placedCount < band.performanceCount);
  }, [bands, bandUsageCount, timetableType, eventSettings.rehearsalType, performanceTimetable, rehearsalTimetable, selectedDate]);

  // 時刻を計算
  const calculateTimes = useCallback((entries: TimetableEntry[], startTime: string) => {
    // リハーサルモードの場合、全バンドが同じリハーサル時間を使用して連続配置
    if (timetableType === 'rehearsal') {
      const rehearsalDuration = eventSettings.rehearsalDuration || 0;
      let currentTime = startTime;
      
      return entries.map((entry, index) => {
        // カスタムイベントは独自のdurationを使用、バンドはリハーサル時間を使用
        const duration = entry.customEvent ? (entry.customEvent.duration || 0) : rehearsalDuration;
        // 転換時間を考慮
        const transitionTime = entry.transitionTime || 0;
        
        const [hours, minutes] = currentTime.split(':').map(Number);
        const startMinutes = hours * 60 + minutes + transitionTime;
        const endMinutes = startMinutes + duration;
        const startHours = Math.floor(startMinutes / 60);
        const startMins = startMinutes % 60;
        const endHours = Math.floor(endMinutes / 60);
        const endMins = endMinutes % 60;
        
        const startTimeStr = `${startHours.toString().padStart(2, '0')}:${startMins.toString().padStart(2, '0')}`;
        const endTimeStr = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
        
        const calculatedEntry = {
          ...entry,
          startTime: startTimeStr,
          endTime: endTimeStr,
          order: index,
        };
        
        currentTime = endTimeStr;
        return calculatedEntry;
      });
    }
    
    // 本番モードの場合、通常の連続時刻計算
    let currentTime = startTime;
    return entries.map((entry, index) => {
      const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
      const duration = band?.performanceDuration || entry.customEvent?.duration || 0;
      
      // 転換時間を考慮
      const transitionTime = entry.transitionTime || 0;

      const [hours, minutes] = currentTime.split(':').map(Number);
      const startMinutes = hours * 60 + minutes + transitionTime;
      const endMinutes = startMinutes + duration;
      const startHours = Math.floor(startMinutes / 60);
      const startMins = startMinutes % 60;
      const endHours = Math.floor(endMinutes / 60);
      const endMins = endMinutes % 60;

      const calculatedEntry = {
        ...entry,
        startTime: `${startHours.toString().padStart(2, '0')}:${startMins.toString().padStart(2, '0')}`,
        endTime: `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`,
        order: index,
      };

      currentTime = calculatedEntry.endTime!;
      return calculatedEntry;
    });
  }, [bands, timetableType, eventSettings.rehearsalDuration]);

  // クール構造を考慮した時刻再計算
  const recalculateTimes = useCallback((cools: Cool[], dailyStartTime: string): Cool[] => {
    if (!cools || cools.length === 0) return cools;

    const getCoolEndTime = (cool?: Cool): string | undefined => {
      if (!cool || !cool.entries || cool.entries.length === 0) return undefined;
      return cool.entries[cool.entries.length - 1].endTime;
    };

    const getLatestCoolEndTimeBefore = (targetCoolIndex: number): string | undefined => {
      const targetCools = performanceDailyTimetable?.cools || [];
      for (let i = targetCoolIndex - 1; i >= 0; i--) {
        const endTime = getCoolEndTime(targetCools[i]);
        if (endTime) return endTime;
      }
      return undefined;
    };

    const performanceDailyTimetable = performanceTimetable?.dailyTimetables.find(
      (dt) => dt.date === selectedDate
    );
    const rehearsalDailyTimetable = rehearsalTimetable?.dailyTimetables.find(
      (dt) => dt.date === selectedDate
    );

    let currentTime = dailyStartTime;
    
    return cools.map((cool, coolIndex) => {
      // クールに開始時刻が設定されている場合はそれを使用
      if (cool.startTime) {
        currentTime = cool.startTime;
      }

      if (eventSettings.rehearsalType === 'cool-pre-rehearsal') {
        // クール直前リハーサル時のデフォルト開始時刻ルール
        if (timetableType === 'performance') {
          // 対応するクールのリハ終了時刻を本番クール開始時刻として常に優先
          const linkedRehearsalEndTime = getCoolEndTime(rehearsalDailyTimetable?.cools?.[coolIndex]);
          if (linkedRehearsalEndTime) {
            currentTime = linkedRehearsalEndTime;
          }
        } else if (timetableType === 'rehearsal' && coolIndex > 0) {
          // あるクールの本番終了時刻を次クールのリハのデフォルト開始時刻にする
          const previousPerformanceEndTime = getLatestCoolEndTimeBefore(coolIndex);
          if (previousPerformanceEndTime) {
            currentTime = previousPerformanceEndTime;
          }
        }
      }
      // 未設定の場合は前のエントリーの終了時刻から継続

      const updatedEntries = calculateTimes(cool.entries, currentTime);
      
      // 最後のエントリーの終了時刻を次のクールの開始時刻として使用
      if (updatedEntries.length > 0) {
        const lastEntry = updatedEntries[updatedEntries.length - 1];
        currentTime = lastEntry.endTime || currentTime;
      }

      return {
        ...cool,
        entries: updatedEntries,
      };
    });
  }, [
    calculateTimes,
    eventSettings.rehearsalType,
    performanceTimetable,
    rehearsalTimetable,
    selectedDate,
    timetableType,
  ]);

  return {
    bandUsageCount,
    unplacedBands,
    calculateTimes,
    recalculateTimes,
  };
};
