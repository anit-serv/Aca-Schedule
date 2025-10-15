import { useCallback } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { Band, DailyTimetable, TimetableEntry, Cool, CustomEvent } from '../types';

interface UseTimetableDragDropProps {
  bands: Band[];
  customEvents: CustomEvent[];
  currentTimetable: DailyTimetable;
  onTimetableChange: (timetable: DailyTimetable) => void;
  calculateTimes: (entries: TimetableEntry[], startTime: string) => TimetableEntry[];
  recalculateCoolTimes: (cools: Cool[], startTime: string) => Cool[];
  isReadOnly?: boolean;
}

export const useTimetableDragDrop = ({
  bands,
  customEvents,
  currentTimetable,
  onTimetableChange,
  calculateTimes,
  recalculateCoolTimes,
  isReadOnly = false,
}: UseTimetableDragDropProps) => {
  
  // バンドをクール分けされたタイムテーブルに追加
  const handleBandDropToCool = useCallback((bandId: string, overId: string) => {
    const band = bands.find((b) => b.id === bandId);
    if (!band) return;

    const updatedCools = [...currentTimetable.cools!];
    
    // クールのドロップゾーンへのドロップ
    if (overId.startsWith('cool-droppable-')) {
      const coolIndex = parseInt(overId.replace('cool-droppable-', ''));
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'band',
        bandId: band.id,
        order: updatedCools[coolIndex].entries.length,
      };
      
      updatedCools[coolIndex] = {
        ...updatedCools[coolIndex],
        entries: [...updatedCools[coolIndex].entries, newEntry],
      };
    } else if (overId.startsWith('entry-')) {
      // entry-{id}-afterの場合の処理
      const isAfter = overId.includes('-after');
      const entryId = isAfter ? overId.replace('-after', '') : overId;
      
      // 既存エントリーの位置にドロップ
      for (let coolIndex = 0; coolIndex < updatedCools.length; coolIndex++) {
        const targetIndex = updatedCools[coolIndex].entries.findIndex((e) => `entry-${e.id}` === entryId);
        if (targetIndex !== -1) {
          const newEntry: TimetableEntry = {
            id: crypto.randomUUID(),
            type: 'band',
            bandId: band.id,
            order: isAfter ? targetIndex + 1 : targetIndex,
          };
          
          const entries = [...updatedCools[coolIndex].entries];
          // -afterの場合は次の位置に挿入
          entries.splice(isAfter ? targetIndex + 1 : targetIndex, 0, newEntry);
          updatedCools[coolIndex] = {
            ...updatedCools[coolIndex],
            entries,
          };
          break;
        }
      }
    }

    // 時刻を再計算
    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
  }, [bands, currentTimetable, recalculateCoolTimes, onTimetableChange]);

  // バンドをフラットなタイムテーブルに追加
  const handleBandDropToFlat = useCallback((bandId: string, overId: string) => {
    const band = bands.find((b) => b.id === bandId);
    if (!band) return;

    // タイムテーブルの特定の位置に挿入する場合
    if (overId.startsWith('entry-')) {
      const targetIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === overId);
      
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'band',
        bandId: band.id,
        order: targetIndex,
      };

      const updatedEntries = [...currentTimetable.entries];
      updatedEntries.splice(targetIndex, 0, newEntry);
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    } else {
      // タイムテーブルの最後に追加
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'band',
        bandId: band.id,
        order: currentTimetable.entries.length,
      };

      const updatedEntries = [...currentTimetable.entries, newEntry];
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    }
  }, [bands, currentTimetable, calculateTimes, onTimetableChange]);

  // クール内でのエントリー並び替え
  const handleEntryReorderInCools = useCallback((activeId: string, overId: string) => {
    const updatedCools = [...currentTimetable.cools!];
    
    // -afterサフィックスの処理
    const isAfter = overId.includes('-after');
    let targetIdWithoutAfter = isAfter ? overId.replace('-after', '') : overId;
    
    // cool-droppable-、cool-header-などの特殊なIDの処理
    let targetCoolIndex = -1;
    let targetEntryIndex = -1;
    let isEmptyTarget = false;
    
    if (targetIdWithoutAfter.startsWith('cool-droppable-') || targetIdWithoutAfter.startsWith('cool-gap-after-')) {
      // 空のクールの最後、またはクールの最後のギャップ
      targetCoolIndex = parseInt(targetIdWithoutAfter.replace(/^cool-(droppable|gap-after)-/, ''));
      const cool = updatedCools[targetCoolIndex];
      if (cool.entries.length > 0) {
        // エントリーがある場合は最後のエントリーの後に追加
        targetEntryIndex = cool.entries.length - 1;
        targetIdWithoutAfter = `entry-${cool.entries[cool.entries.length - 1].id}`;
        // 強制的にafterモードに
        isEmptyTarget = false;
      } else {
        // 空のクールの場合
        targetEntryIndex = 0;
        isEmptyTarget = true;
      }
    } else if (targetIdWithoutAfter.startsWith('cool-header-') || 
               targetIdWithoutAfter.startsWith('cool-column-header-') || 
               targetIdWithoutAfter.startsWith('cool-gap-before-')) {
      // クールヘッダーまたはクールの前のギャップ → そのクールの最初に追加
      targetCoolIndex = parseInt(targetIdWithoutAfter.replace(/^cool-(header|column-header|gap-before)-/, ''));
      targetEntryIndex = 0;
      isEmptyTarget = updatedCools[targetCoolIndex].entries.length === 0;
    }
    
    // 両方のエントリーがどのクールにあるか検索
    let sourceCoolIndex = -1;
    let sourceEntryIndex = -1;

    for (let i = 0; i < updatedCools.length; i++) {
      const cool = updatedCools[i];
      const sourceIdx = cool.entries.findIndex((e) => `entry-${e.id}` === activeId);
      
      if (sourceIdx !== -1) {
        sourceCoolIndex = i;
        sourceEntryIndex = sourceIdx;
      }
      
      // targetCoolIndexが未設定の場合のみentry-から検索
      if (targetCoolIndex === -1 && targetIdWithoutAfter.startsWith('entry-')) {
        const targetIdx = cool.entries.findIndex((e) => `entry-${e.id}` === targetIdWithoutAfter);
        if (targetIdx !== -1) {
          targetCoolIndex = i;
          targetEntryIndex = targetIdx;
        }
      }
    }

    if (sourceCoolIndex === -1 || targetCoolIndex === -1) return;

    // クール直前リハーサルの場合、クール間移動を禁止
    if (isReadOnly && sourceCoolIndex !== targetCoolIndex) {
      return;
    }

    // -afterの場合、または空のクールにドロップした場合の位置調整
    let adjustedTargetIndex = targetEntryIndex;
    if (isEmptyTarget) {
      // 空のクールの場合は0番目
      adjustedTargetIndex = 0;
    } else if (isAfter || targetIdWithoutAfter.startsWith('cool-droppable-') || targetIdWithoutAfter.startsWith('cool-gap-after-')) {
      // -afterまたはクールの最後の場合は次の位置
      adjustedTargetIndex = targetEntryIndex + 1;
    }
    
    // 同じクール内での並び替え
    if (sourceCoolIndex === targetCoolIndex) {
      const entries = [...updatedCools[sourceCoolIndex].entries];
      // arrayMoveは削除前のインデックスを基準にするため、
      // 後ろに移動する場合は調整不要
      const reordered = arrayMove(entries, sourceEntryIndex, adjustedTargetIndex);
      updatedCools[sourceCoolIndex] = {
        ...updatedCools[sourceCoolIndex],
        entries: reordered,
      };
    } else {
      // 異なるクール間での移動 → 元のクールから削除して、ターゲットクールに追加
      const sourceEntries = [...updatedCools[sourceCoolIndex].entries];
      const targetEntries = [...updatedCools[targetCoolIndex].entries];
      
      // 元のクールから削除
      const [movedEntry] = sourceEntries.splice(sourceEntryIndex, 1);
      // ターゲットクールに追加
      targetEntries.splice(adjustedTargetIndex, 0, movedEntry);
      
      // 両方のクールを更新
      updatedCools[sourceCoolIndex] = {
        ...updatedCools[sourceCoolIndex],
        entries: sourceEntries,
      };
      updatedCools[targetCoolIndex] = {
        ...updatedCools[targetCoolIndex],
        entries: targetEntries,
      };
    }

    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
  }, [currentTimetable, recalculateCoolTimes, onTimetableChange, isReadOnly]);

  // フラットなタイムテーブルでのエントリー並び替え
  const handleEntryReorderFlat = useCallback((activeId: string, overId: string) => {
    const oldIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === activeId);
    const newIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const reorderedEntries = arrayMove(currentTimetable.entries, oldIndex, newIndex);
    const calculatedEntries = calculateTimes(reorderedEntries, currentTimetable.startTime);

    onTimetableChange({
      ...currentTimetable,
      entries: calculatedEntries,
    });
  }, [currentTimetable, calculateTimes, onTimetableChange]);

  // カスタムイベントをクール分けされたタイムテーブルに追加
  const handleCustomEventDropToCool = useCallback((customEventId: string, overId: string) => {
    const customEvent = customEvents.find((ce) => ce.id === customEventId);
    if (!customEvent) return;

    const updatedCools = [...currentTimetable.cools!];
    
    // クールのドロップゾーンへのドロップ
    if (overId.startsWith('cool-droppable-')) {
      const coolIndex = parseInt(overId.replace('cool-droppable-', ''));
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'custom',
        customEvent,
        order: updatedCools[coolIndex].entries.length,
      };
      
      updatedCools[coolIndex] = {
        ...updatedCools[coolIndex],
        entries: [...updatedCools[coolIndex].entries, newEntry],
      };
    } else if (overId.startsWith('entry-')) {
      // entry-{id}-afterの場合の処理
      const isAfter = overId.includes('-after');
      const entryId = isAfter ? overId.replace('-after', '') : overId;
      
      // 既存エントリーの位置にドロップ
      for (let coolIndex = 0; coolIndex < updatedCools.length; coolIndex++) {
        const targetIndex = updatedCools[coolIndex].entries.findIndex((e) => `entry-${e.id}` === entryId);
        if (targetIndex !== -1) {
          const newEntry: TimetableEntry = {
            id: crypto.randomUUID(),
            type: 'custom',
            customEvent,
            order: isAfter ? targetIndex + 1 : targetIndex,
          };
          
          const entries = [...updatedCools[coolIndex].entries];
          // -afterの場合は次の位置に挿入
          entries.splice(isAfter ? targetIndex + 1 : targetIndex, 0, newEntry);
          updatedCools[coolIndex] = {
            ...updatedCools[coolIndex],
            entries,
          };
          break;
        }
      }
    }

    // 時刻を再計算
    const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
  }, [customEvents, currentTimetable, recalculateCoolTimes, onTimetableChange]);

  // カスタムイベントをフラットなタイムテーブルに追加
  const handleCustomEventDropToFlat = useCallback((customEventId: string, overId: string) => {
    const customEvent = customEvents.find((ce) => ce.id === customEventId);
    if (!customEvent) return;

    // タイムテーブルの特定の位置に挿入する場合
    if (overId.startsWith('entry-')) {
      const targetIndex = currentTimetable.entries.findIndex((e) => `entry-${e.id}` === overId);
      
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'custom',
        customEvent,
        order: targetIndex,
      };

      const updatedEntries = [...currentTimetable.entries];
      updatedEntries.splice(targetIndex, 0, newEntry);
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    } else {
      // タイムテーブルの最後に追加
      const newEntry: TimetableEntry = {
        id: crypto.randomUUID(),
        type: 'custom',
        customEvent,
        order: currentTimetable.entries.length,
      };

      const updatedEntries = [...currentTimetable.entries, newEntry];
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    }
  }, [customEvents, currentTimetable, calculateTimes, onTimetableChange]);

  // エントリを削除
  const handleRemoveEntry = useCallback((entryId: string, coolIndex?: number) => {
    if (currentTimetable.cools && currentTimetable.cools.length > 0 && coolIndex !== undefined) {
      // クール内から削除
      const updatedCools = [...currentTimetable.cools];
      updatedCools[coolIndex] = {
        ...updatedCools[coolIndex],
        entries: updatedCools[coolIndex].entries.filter((e) => e.id !== entryId),
      };
      
      const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
      
      onTimetableChange({
        ...currentTimetable,
        cools: calculatedCools,
      });
    } else {
      // フラットなリストから削除
      const updatedEntries = currentTimetable.entries.filter((e) => e.id !== entryId);
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);

      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    }
  }, [currentTimetable, calculateTimes, recalculateCoolTimes, onTimetableChange]);

  return {
    handleBandDropToCool,
    handleBandDropToFlat,
    handleCustomEventDropToCool,
    handleCustomEventDropToFlat,
    handleEntryReorderInCools,
    handleEntryReorderFlat,
    handleRemoveEntry,
  };
};
