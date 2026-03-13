import { useState, useEffect, useRef } from 'react';
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
  const [isPointerOverCancelZone, setIsPointerOverCancelZone] = useState(false);
  const [currentMouseX, setCurrentMouseX] = useState<number>(0);
  const [currentMouseY, setCurrentMouseY] = useState<number>(0);
  const latestOverIdRef = useRef<string | null>(null);

  const isPointerInCancelZone = (x: number, y: number): boolean => {
    if (x <= 0 || y <= 0 || typeof document === 'undefined') return false;
    const cancelZone = document.getElementById('mobile-cancel-dropzone');
    if (!cancelZone) return false;
    const rect = cancelZone.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  // バンドバンクからのドラッグの場合のみポインタ位置をトラッキング
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (activeDragId && (activeDragId.startsWith('band-') || activeDragId.startsWith('custom-'))) {
        let x = 0;
        let y = 0;
        if ('clientY' in e) {
          x = e.clientX;
          y = e.clientY;
        } else if ('touches' in e && e.touches.length > 0) {
          x = e.touches[0].clientX;
          y = e.touches[0].clientY;
        }
        setCurrentMouseX(x);
        setCurrentMouseY(y);
        setIsPointerOverCancelZone(isPointerInCancelZone(x, y));
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
    setIsPointerOverCancelZone(false);
  };

  // ドラッグ中
  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    const activeId = active.id as string;

    // overが不安定なモバイル向けフォールバック: 座標がキャンセルゾーン内なら最優先でキャンセル扱い
    if ((activeId.startsWith('band-') || activeId.startsWith('custom-')) && isPointerInCancelZone(currentMouseX, currentMouseY)) {
      latestOverIdRef.current = 'mobile-cancel-dropzone';
      setOverEntryId('mobile-cancel-dropzone');
      setIsPointerOverCancelZone(true);
      return;
    }
    
    if (over) {
      const overId = over.id as string;
      
      // エントリーの場合、ドラッグ元に応じて判定方法を変える
      if (overId.startsWith('entry-')) {
        setIsPointerOverCancelZone(false);
        const overRect = over.rect;
        
        // バンドバンクからのドラッグ、またはタイムテーブル内での並び替え：マウス位置で判定
        if (activeId.startsWith('band-') || activeId.startsWith('custom-') || activeId.startsWith('entry-')) {
          if (overRect && currentMouseY > 0) {
            const overCenter = overRect.top + overRect.height / 2;
            
            if (currentMouseY > overCenter) {
              const nextOverId = `${overId}-after`;
              latestOverIdRef.current = nextOverId;
              setOverEntryId(nextOverId);
            } else {
              latestOverIdRef.current = overId;
              setOverEntryId(overId);
            }
          } else {
            latestOverIdRef.current = overId;
            setOverEntryId(overId);
          }
        } else {
          latestOverIdRef.current = overId;
          setOverEntryId(overId);
        }
      } else if (
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        overId === 'timetable-droppable' ||
        overId === 'mobile-cancel-dropzone'
      ) {
        if (overId === 'mobile-cancel-dropzone') {
          latestOverIdRef.current = overId;
          setOverEntryId(overId);
          setIsPointerOverCancelZone(true);
          return;
        }

        setIsPointerOverCancelZone(false);

        // cool-droppableまたはcool-gap-afterの場合、そのクールに最後のエントリーがあれば、
        // そのエントリーの-afterに変換する
        if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
          const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
          const cool = currentTimetable.cools?.[coolIndex];
          
          if (cool && cool.entries.length > 0) {
            const lastEntry = cool.entries[cool.entries.length - 1];
            setOverEntryId(`entry-${lastEntry.id}-after`);
            latestOverIdRef.current = `entry-${lastEntry.id}-after`;
          } else {
            latestOverIdRef.current = overId;
            setOverEntryId(overId);
          }
        } else if (overId === 'timetable-droppable') {
          // フラット構造のタイムテーブルへのドロップ
          // エントリーがあれば最後のエントリーの-afterに変換
          if (currentTimetable.entries && currentTimetable.entries.length > 0) {
            const lastEntry = currentTimetable.entries[currentTimetable.entries.length - 1];
            const nextOverId = `entry-${lastEntry.id}-after`;
            latestOverIdRef.current = nextOverId;
            setOverEntryId(nextOverId);
          } else {
            latestOverIdRef.current = overId;
            setOverEntryId(overId);
          }
        } else {
          latestOverIdRef.current = overId;
          setOverEntryId(overId);
        }
      } else {
        latestOverIdRef.current = null;
        setOverEntryId(null);
        setIsPointerOverCancelZone(false);
      }
    } else {
      latestOverIdRef.current = null;
      setOverEntryId(null);
      setIsPointerOverCancelZone(false);
    }
  };

  // ドラッグ終了
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    // overEntryIdを保存（handleDragOverで計算済みの正確な挿入位置）
    // モバイルではタッチ離脱時にoverがnullになることがあるため、
    // overEntryIdをフォールバックとして使用する
    const savedOverEntryId = latestOverIdRef.current || overEntryId;
    
    setActiveDragId(null);
    setOverEntryId(null);
    setIsPointerOverCancelZone(false);
    setCurrentMouseX(0);
    setCurrentMouseY(0);
    latestOverIdRef.current = null;

    const activeId = active.id as string;
    

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      if (!over && !savedOverEntryId) {
        if (isPointerInCancelZone(currentMouseX, currentMouseY)) {
          return;
        }
        return;
      }
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);

      if (overId === 'mobile-cancel-dropzone') {
        return;
      }

      if (isPointerInCancelZone(currentMouseX, currentMouseY)) {
        return;
      }
      
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
      if (!over && !savedOverEntryId) {
        if (isPointerInCancelZone(currentMouseX, currentMouseY)) return;
        return;
      }
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);

      if (overId === 'mobile-cancel-dropzone') return;

      if (isPointerInCancelZone(currentMouseX, currentMouseY)) return;
      
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
    isPointerOverCancelZone,
    dropSucceeded,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    getActiveItems,
  };
};
