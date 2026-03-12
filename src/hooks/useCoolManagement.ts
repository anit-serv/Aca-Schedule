import { useCallback } from 'react';
import type { Cool, DailyTimetable, Timetable, EventSettings } from '../types';
import { generateUUID } from '../utils/generateUUID';

interface UseCoolManagementProps {
  timetableType: 'performance' | 'rehearsal';
  eventSettings: EventSettings;
  timetable: Timetable | null;
  currentTimetable: DailyTimetable;
  selectedDate: string;
  onTimetableChange: (timetable: DailyTimetable) => void;
  recalculateTimes: (cools: Cool[], dailyStartTime: string) => Cool[];
}

export const useCoolManagement = ({
  timetableType,
  eventSettings,
  timetable,
  currentTimetable,
  selectedDate,
  onTimetableChange,
  recalculateTimes,
}: UseCoolManagementProps) => {
  
  // 日付に基づいてクール番号の開始値を計算
  const getBaseCoolNumber = useCallback((date: string): number => {
    if (!timetable) return 1;
    
    let coolNumber = 1;
    
    // 日付リストを取得（本番/リハーサルに応じて）
    const dateList = timetableType === 'performance'
      ? eventSettings.performanceDates
      : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
        ? eventSettings.performanceDates
        : eventSettings.rehearsalDates || [];
    
    const sortedDates = [...dateList].sort();
    
    for (const d of sortedDates) {
      if (d === date) break;
      const dt = timetable.dailyTimetables.find(dt => dt.date === d);
      if (dt && dt.cools && dt.cools.length > 0) {
        coolNumber += dt.cools.length;
      }
    }
    
    return coolNumber;
  }, [timetable, timetableType, eventSettings]);
  
  // クール内の時刻を再計算（非推奨：代わりにrecalculateTimesを使用）
  const recalculateCoolTimes = useCallback((cools: Cool[], startTime: string): Cool[] => {
    // 新しいrecalculateTimesを使用（クール開始時刻を考慮）
    return recalculateTimes(cools, startTime);
  }, [recalculateTimes]);
  
  // クール数を変更
  const handleCoolCountChange = useCallback((newCount: number) => {
    // 最小値を1に制限
    if (newCount < 1) return;
    
    const currentCools = currentTimetable.cools || [];
    const currentCount = currentCools.length;
    
    // クール数が変わっていない場合は何もしない
    if (newCount === currentCount) return;
    
    console.log(`[クール数変更] ${currentCount} → ${newCount}`);
    
    let updatedCools: Cool[] = [];
    const baseNumber = getBaseCoolNumber(selectedDate);
    
    if (newCount > currentCount) {
      // クールを追加する場合：既存のクールを保持して最後に追加
      if (currentCount === 0) {
        // クールが1つもない場合は新規作成（既存のentriesがあれば最初のクールに移行）
        const existingEntries = currentTimetable.entries || [];
        updatedCools.push({
          id: generateUUID(),
          number: baseNumber,
          entries: existingEntries,
        });
        // 2つ目以降のクールを追加
        for (let i = 1; i < newCount; i++) {
          updatedCools.push({
            id: generateUUID(),
            number: baseNumber + i,
            entries: [],
          });
        }
      } else {
        // 既存のクールがある場合は後ろに追加
        updatedCools = [...currentCools];
        for (let i = currentCount; i < newCount; i++) {
          updatedCools.push({
            id: generateUUID(),
            number: baseNumber + i,
            entries: [],
          });
        }
      }
      
      console.log('[クール追加] 新しいクール数:', updatedCools.length);
    } else {
      // クールを削除する場合：削除されるクールのエントリーを前のクールに移行
      updatedCools = [...currentCools];
      
      // 削除するクールのインデックス範囲
      for (let i = currentCount - 1; i >= newCount; i--) {
        const removedCool = updatedCools[i];
        
        if (removedCool.entries.length > 0) {
          // 移行先のクールを決定
          let targetIndex: number;
          
          if (i === 0) {
            // 最初のクールを削除する場合は次のクール（削除前の第2クール）へ
            targetIndex = 1;
          } else {
            // それ以外は前のクールへ
            targetIndex = i - 1;
          }
          
          // エントリーを移行（削除前に確保）
          if (targetIndex < updatedCools.length && targetIndex >= 0) {
            updatedCools[targetIndex] = {
              ...updatedCools[targetIndex],
              entries: [...updatedCools[targetIndex].entries, ...removedCool.entries],
            };
          }
        }
      }
      
      // 不要なクールを削除
      updatedCools = updatedCools.slice(0, newCount);
      
      console.log('[クール削除] 残りのクール数:', updatedCools.length);
    }
    
    // クール番号を再計算
    updatedCools = updatedCools.map((cool, index) => ({
      ...cool,
      number: baseNumber + index,
    }));
    
    // 時刻を再計算
    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    const updatedTimetable: DailyTimetable = {
      ...currentTimetable,
      cools: calculatedCools,
      entries: [],
    };
    
    console.log('[保存前] クール配列:', calculatedCools.map(c => ({ id: c.id, number: c.number, entryCount: c.entries.length })));
    
    onTimetableChange(updatedTimetable);
    
    console.log('[クール数変更] 完了 - 後続日付の更新はApp.tsx側で実行');
  }, [currentTimetable, selectedDate, getBaseCoolNumber, recalculateCoolTimes, onTimetableChange]);
  
  // クールを削除
  const handleDeleteCool = useCallback((coolIndex: number) => {
    if (!currentTimetable.cools || currentTimetable.cools.length === 0) return;
    
    console.log(`[クール削除] クールインデックス: ${coolIndex}, 現在のクール数: ${currentTimetable.cools.length}`);
    
    const updatedCools = [...currentTimetable.cools];
    const deletedCool = updatedCools[coolIndex];
    
    // エントリーを前のクールに移動
    if (deletedCool.entries.length > 0) {
      const targetIndex = coolIndex > 0 ? coolIndex - 1 : (updatedCools.length > 1 ? 1 : -1);
      
      console.log(`[クール削除] ${deletedCool.entries.length}個のエントリーをインデックス${targetIndex}に移動`);
      
      if (targetIndex >= 0 && targetIndex < updatedCools.length) {
        updatedCools[targetIndex] = {
          ...updatedCools[targetIndex],
          entries: [...updatedCools[targetIndex].entries, ...deletedCool.entries],
        };
      }
    }
    
    // クールを削除
    updatedCools.splice(coolIndex, 1);
    
    console.log(`[クール削除] 削除後のクール数: ${updatedCools.length}`);
    
    // クール番号を再計算
    const baseNumber = getBaseCoolNumber(selectedDate);
    const renumberedCools = updatedCools.map((cool, index) => ({
      ...cool,
      number: baseNumber + index,
    }));
    
    const calculatedCools = recalculateCoolTimes(renumberedCools, currentTimetable.startTime);
    
    const updatedTimetable: DailyTimetable = {
      ...currentTimetable,
      cools: calculatedCools,
    };
    
    console.log('[クール削除] 保存前:', calculatedCools.map(c => ({ id: c.id, number: c.number })));
    
    onTimetableChange(updatedTimetable);
    
    console.log('[クール削除] 完了 - 後続日付の更新はApp.tsx側で実行');
  }, [currentTimetable, selectedDate, getBaseCoolNumber, recalculateCoolTimes, onTimetableChange]);
  
  // クールを上に移動（バンド配列のみを入れ替え、クール番号とstartTimeは保持）
  const handleMoveCoolUp = useCallback((coolIndex: number) => {
    if (!currentTimetable.cools || coolIndex === 0) return;
    
    const updatedCools = [...currentTimetable.cools];
    
    // バンド配列(entries)のみを入れ替え
    const tempEntries = updatedCools[coolIndex - 1].entries;
    updatedCools[coolIndex - 1] = {
      ...updatedCools[coolIndex - 1],
      entries: updatedCools[coolIndex].entries,
    };
    updatedCools[coolIndex] = {
      ...updatedCools[coolIndex],
      entries: tempEntries,
    };
    
    // 時刻を再計算（クール番号とstartTimeはそのまま）
    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
  }, [currentTimetable, recalculateCoolTimes, onTimetableChange]);
  
  // クールを下に移動（バンド配列のみを入れ替え、クール番号とstartTimeは保持）
  const handleMoveCoolDown = useCallback((coolIndex: number) => {
    if (!currentTimetable.cools || coolIndex === currentTimetable.cools.length - 1) return;
    
    const updatedCools = [...currentTimetable.cools];
    
    // バンド配列(entries)のみを入れ替え
    const tempEntries = updatedCools[coolIndex].entries;
    updatedCools[coolIndex] = {
      ...updatedCools[coolIndex],
      entries: updatedCools[coolIndex + 1].entries,
    };
    updatedCools[coolIndex + 1] = {
      ...updatedCools[coolIndex + 1],
      entries: tempEntries,
    };
    
    // 時刻を再計算（クール番号とstartTimeはそのまま）
    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
  }, [currentTimetable, recalculateCoolTimes, onTimetableChange]);
  
  return {
    getBaseCoolNumber,
    recalculateCoolTimes,
    handleCoolCountChange,
    handleDeleteCool,
    handleMoveCoolUp,
    handleMoveCoolDown,
  };
};
