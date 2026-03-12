import { useState, useEffect } from 'react';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import type { Band, CustomEvent, DailyTimetable } from '../types';

interface UseDragHandlersParams {
  bands: Band[];
  customEvents: CustomEvent[];
  currentTimetable: DailyTimetable;
  onBandDropToCool: (bandId: string, targetId: string) => void;
  onBandDropToFlat: (bandId: string, targetId: string) => void;
  onCustomEventDropToCool: (customEventId: string, targetId: string) => void;
  onCustomEventDropToFlat: (customEventId: string, targetId: string) => void;
  onEntryReorderInCools: (activeId: string, targetId: string) => void;
  onEntryReorderFlat: (activeId: string, targetId: string) => void;
}

export const useDragHandlers = ({
  bands,
  customEvents,
  currentTimetable,
  onBandDropToCool,
  onBandDropToFlat,
  onCustomEventDropToCool,
  onCustomEventDropToFlat,
  onEntryReorderInCools,
  onEntryReorderFlat,
}: UseDragHandlersParams) => {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overEntryId, setOverEntryId] = useState<string | null>(null);
  const [dropSucceeded, setDropSucceeded] = useState(false);
  const [currentMouseY, setCurrentMouseY] = useState<number>(0);

  // バンドバンクからのドラッグの場合のみポインタ位置をトラッキング
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (activeDragId && (activeDragId.startsWith('band-') || activeDragId.startsWith('custom-'))) {
        if ('clientY' in e) {
          setCurrentMouseY(e.clientY);
        } else if ('touches' in e && e.touches.length > 0) {
          setCurrentMouseY(e.touches[0].clientY);
        }
      }
    };

    if (activeDragId) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('mousemove', handlePointerMove as (e: MouseEvent) => void);
      window.addEventListener('touchmove', handlePointerMove as (e: TouchEvent) => void);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('mousemove', handlePointerMove as (e: MouseEvent) => void);
        window.removeEventListener('touchmove', handlePointerMove as (e: TouchEvent) => void);
      };
    }
  }, [activeDragId]);

  // ドラッグ開始
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
    setDropSucceeded(false);
  };

  // ドラッグ中
  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    
    if (over) {
      const overId = over.id as string;
      const activeId = active.id as string;
      
      // エントリーの場合、ドラッグ元に応じて判定方法を変える
      if (overId.startsWith('entry-')) {
        const overRect = over.rect;
        
        // バンドバンクからのドラッグ、またはタイムテーブル内での並び替え：マウス位置で判定
        if (activeId.startsWith('band-') || activeId.startsWith('custom-') || activeId.startsWith('entry-')) {
          if (overRect && currentMouseY > 0) {
            const overCenter = overRect.top + overRect.height / 2;
            
            if (currentMouseY > overCenter) {
              setOverEntryId(`${overId}-after`);
            } else {
              setOverEntryId(overId);
            }
          } else {
            setOverEntryId(overId);
          }
        } else {
          setOverEntryId(overId);
        }
      } else if (
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        overId === 'timetable-droppable'
      ) {
        // cool-droppableまたはcool-gap-afterの場合、そのクールに最後のエントリーがあれば、
        // そのエントリーの-afterに変換する
        if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
          const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
          const cool = currentTimetable.cools?.[coolIndex];
          
          if (cool && cool.entries.length > 0) {
            const lastEntry = cool.entries[cool.entries.length - 1];
            setOverEntryId(`entry-${lastEntry.id}-after`);
          } else {
            setOverEntryId(overId);
          }
        } else if (overId === 'timetable-droppable') {
          // フラット構造のタイムテーブルへのドロップ
          // エントリーがあれば最後のエントリーの-afterに変換
          if (currentTimetable.entries && currentTimetable.entries.length > 0) {
            const lastEntry = currentTimetable.entries[currentTimetable.entries.length - 1];
            setOverEntryId(`entry-${lastEntry.id}-after`);
          } else {
            setOverEntryId(overId);
          }
        } else {
          setOverEntryId(overId);
        }
      } else {
        setOverEntryId(null);
      }
    } else {
      setOverEntryId(null);
    }
  };

  // ドラッグ終了
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    // overEntryIdを保存（handleDragOverで計算済みの正確な挿入位置）
    // モバイルではタッチ離脱時にoverがnullになることがあるため、
    // overEntryIdをフォールバックとして使用する
    const savedOverEntryId = overEntryId;
    
    setActiveDragId(null);
    setOverEntryId(null);
    setCurrentMouseY(0);

    const activeId = active.id as string;
    

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      if (!over && !savedOverEntryId) {
        return;
      }
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);
      
      if (overId === 'band-bank-droppable') {
        return;
      }
      
      const isValidDropTarget = 
        overId.startsWith('entry-') || 
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        overId === 'timetable-droppable';
      
      if (!isValidDropTarget) {
        return;
      }

      const bandId = activeId.replace('band-', '');
      const band = bands.find((b) => b.id === bandId);
      if (!band) {
        return;
      }

      setDropSucceeded(true);

      let targetDropId = overId;
      
      if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool && cool.entries.length > 0) {
          const lastEntry = cool.entries[cool.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId.startsWith('cool-header-') || overId.startsWith('cool-column-header-') || overId.startsWith('cool-gap-before-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(header|column-header|gap-before)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool.entries.length > 0) {
          targetDropId = `entry-${cool.entries[0].id}`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId === 'timetable-droppable') {
        // フラット構造のタイムテーブルへのドロップ - エントリーがあれば最後の-afterに変換
        if (currentTimetable.entries && currentTimetable.entries.length > 0) {
          const lastEntry = currentTimetable.entries[currentTimetable.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        }
      }

      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        onBandDropToCool(bandId, targetDropId);
      } else {
        onBandDropToFlat(bandId, targetDropId);
      }
      return;
    }

    // カスタムイベントをタイムテーブルへ追加
    if (activeId.startsWith('custom-')) {
      if (!over && !savedOverEntryId) return;
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);
      
      if (overId === 'band-bank-droppable') return;
      
      const isValidDropTarget = 
        overId.startsWith('entry-') || 
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        overId === 'timetable-droppable';
      
      if (!isValidDropTarget) return;

      const customEventId = activeId.replace('custom-', '');
      const customEvent = customEvents.find((ce) => ce.id === customEventId);
      if (!customEvent) return;

      setDropSucceeded(true);

      let targetDropId = overId;
      
      if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool && cool.entries.length > 0) {
          const lastEntry = cool.entries[cool.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId.startsWith('cool-header-') || overId.startsWith('cool-column-header-') || overId.startsWith('cool-gap-before-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(header|column-header|gap-before)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool.entries.length > 0) {
          targetDropId = `entry-${cool.entries[0].id}`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId === 'timetable-droppable') {
        // フラット構造のタイムテーブルへのドロップ - エントリーがあれば最後の-afterに変換
        if (currentTimetable.entries && currentTimetable.entries.length > 0) {
          const lastEntry = currentTimetable.entries[currentTimetable.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        }
      }

      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        onCustomEventDropToCool(customEventId, targetDropId);
      } else {
        onCustomEventDropToFlat(customEventId, targetDropId);
      }
      return;
    }

    // タイムテーブル内での並び替え
    if (!over && !savedOverEntryId) return;
    
    const targetId = savedOverEntryId || (over!.id as string);
    
    if (activeId.startsWith('entry-')) {
      const isValidTarget = targetId.startsWith('entry-') ||
        targetId.startsWith('cool-droppable-') ||
        targetId.startsWith('cool-header-') ||
        targetId.startsWith('cool-column-header-') ||
        targetId.startsWith('cool-gap-before-') ||
        targetId.startsWith('cool-gap-after-');
      
      if (isValidTarget) {
        if (currentTimetable.cools && currentTimetable.cools.length > 0) {
          onEntryReorderInCools(activeId, targetId);
        } else {
          onEntryReorderFlat(activeId, targetId);
        }
      }
    }
  };

  // アクティブなアイテムを取得
  const getActiveItems = () => {
    const activeBand = activeDragId?.startsWith('band-')
      ? bands.find((b) => `band-${b.id}` === activeDragId)
      : null;

    const activeCustomEvent = activeDragId?.startsWith('custom-')
      ? customEvents.find((ce) => `custom-${ce.id}` === activeDragId)
      : null;

    const activeEntry = activeDragId?.startsWith('entry-')
      ? currentTimetable.entries.find((e) => `entry-${e.id}` === activeDragId)
      : null;

    return { activeBand, activeCustomEvent, activeEntry };
  };

  return {
    activeDragId,
    overEntryId,
    dropSucceeded,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    getActiveItems,
  };
};
