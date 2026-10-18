import { useState, useEffect, useRef, useCallback } from 'react';
import type { DragStartEvent, DragOverEvent, DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import type { Band, CustomEvent, DailyTimetable } from '../types';
import { getAdjacentEntryTarget, getDestinationCoolEntryTarget, getPlaceholderEntryTarget, toTimetableContentRect } from '../utils/dragInsertionTarget';

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
  canDrop?: (event: DragEndEvent) => boolean;
  trackPointerY?: boolean;
  preferStableEntryTarget?: boolean;
}

export interface CancelAbsorbAnimation {
  id: number;
  label: string;
  subLabel: string;
  kind: 'band' | 'custom';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  cardWidth?: number;
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
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
  canDrop,
  trackPointerY = false,
  preferStableEntryTarget = false,
}: UseDragHandlersParams) => {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overEntryId, setOverEntryId] = useState<string | null>(null);
  const [dropSucceeded, setDropSucceeded] = useState(false);
  const [cancelAbsorbAnimation, setCancelAbsorbAnimation] = useState<CancelAbsorbAnimation | null>(null);
  const [isPointerOverCancelZone, setIsPointerOverCancelZone] = useState(false);
  const [currentPointerY, setCurrentPointerY] = useState(0);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const publishPointerYRef = useRef(false);
  const latestOverIdRef = useRef<string | null>(null);
  const entryRectsRef = useRef<{ id: string; element: HTMLTableRowElement }[]>([]);
  const coolTargetsRef = useRef<{ index: number; section: HTMLElement; rows: { id: string; element: HTMLTableRowElement }[] }[]>([]);
  const sourceCoolIndexRef = useRef(-1);
  const entryViewportRef = useRef<HTMLElement | null>(null);
  const entryPreviewRef = useRef<HTMLElement | null>(null);
  const entryDragGeometryRef = useRef<{ activeId: string; initial: { top: number; height: number }; translated: { top: number; height: number } } | null>(null);

  const updatePointer = useCallback((x: number, y: number) => {
    pointerRef.current = { x, y };
    if (trackPointerY && publishPointerYRef.current) setCurrentPointerY(y);
  }, [trackPointerY]);

  const publishEntryTarget = (target: string | null) => {
    if (latestOverIdRef.current === target) return;
    latestOverIdRef.current = target;
    setOverEntryId(target);
  };

  const resolveEntryTarget = (activeId: string, _initial: { top: number; height: number }, translated: { top: number; height: number }) => {
    const viewport = entryViewportRef.current;
    if (!entryPreviewRef.current?.isConnected) {
      entryPreviewRef.current = document.querySelector<HTMLElement>('[data-timetable-drag-preview]');
    }
    const previewRect = entryPreviewRef.current?.getBoundingClientRect();
    const preview = previewRect && previewRect.height > 0 ? previewRect : translated;
    const previewCenterY = preview.top + preview.height / 2;
    const pointerY = pointerRef.current.y > 0 ? pointerRef.current.y : previewCenterY;
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
    const scrollTop = viewport?.scrollTop ?? 0;
    const contentPreview = toTimetableContentRect(preview, viewportTop, scrollTop);
    const sections = coolTargetsRef.current;
    // Between cools, the gap belongs to the following cool. This also keeps
    // the destination stable while its placeholder changes the section height.
    const targetCool = sections.find(({ section }) => pointerY < section.getBoundingClientRect().bottom)
      ?? sections[sections.length - 1];
    const targetSection = targetCool?.section;
    const coolIndex = targetCool?.index ?? -1;
    const currentCool = currentTimetable.cools?.[coolIndex];
    const liveRows = (targetCool?.rows ?? entryRectsRef.current)
      .map(({ id, element }) => {
        const bounds = element.getBoundingClientRect();
        const transform = element.dataset.dragAnimating ? getComputedStyle(element).transform : 'none';
        const visualOffset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
        return { id, ...toTimetableContentRect({ top: bounds.top - visualOffset, height: bounds.height }, viewportTop, scrollTop) };
      });
    if (currentCool) {
      const lastTarget = latestOverIdRef.current?.replace(/-after$/, '');
      const enteringFromBelow = sourceCoolIndexRef.current > coolIndex
        && !liveRows.some(row => row.id === lastTarget);
      // Sticky headings can overlap the pointer while entering from below.
      // Nonempty cools use the card and placeholder positions instead.
      if (enteringFromBelow && liveRows.length) {
        const lastRow = liveRows.reduce((last, row) => row.top > last.top ? row : last);
        return `${lastRow.id}-after`;
      }
      if (!liveRows.length) return `cool-droppable-${coolIndex}`;
      const activeRow = liveRows.find(row => row.id === activeId);
      if (activeRow && activeRow.height > 0) {
        return getPlaceholderEntryTarget(activeId, latestOverIdRef.current ?? activeId, contentPreview, liveRows);
      }
      const destinationPlaceholder = targetSection!.querySelector<HTMLTableRowElement>('tr[data-drag-placeholder]');
      const placeholderRect = destinationPlaceholder?.getBoundingClientRect();
      return getDestinationCoolEntryTarget(coolIndex, latestOverIdRef.current, contentPreview, liveRows, {
        incomingFromBelow: sourceCoolIndexRef.current > coolIndex,
        placeholder: placeholderRect
          ? toTimetableContentRect(placeholderRect, viewportTop, scrollTop)
          : null,
      });
    }
    const activeRow = liveRows.find(row => row.id === activeId);
    if (activeRow && activeRow.height > 0) {
      return getPlaceholderEntryTarget(activeId, latestOverIdRef.current ?? activeId, contentPreview, liveRows);
    }
    return getAdjacentEntryTarget(activeId, latestOverIdRef.current ?? activeId, contentPreview, liveRows);
  };

  useEffect(() => {
    if (!activeDragId?.startsWith('entry-')) return;
    const viewport = entryViewportRef.current;
    if (!viewport) return;
    const updateOnScroll = () => {
      const geometry = entryDragGeometryRef.current;
      if (!geometry) return;
      const target = resolveEntryTarget(geometry.activeId, geometry.initial, geometry.translated);
      publishEntryTarget(target);
    };
    viewport.addEventListener('scroll', updateOnScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', updateOnScroll);
  }, [activeDragId]);

  const isPointerInCancelZone = (x: number, y: number): boolean => {
    if (x <= 0 || y <= 0 || typeof document === 'undefined') return false;
    const cancelZone = document.getElementById('mobile-cancel-dropzone');
    if (!cancelZone) return false;
    const rect = cancelZone.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const triggerCancelAbsorbAnimation = (activeId: string, startPoint?: Point, size?: Size) => {
    if (!(activeId.startsWith('band-') || activeId.startsWith('custom-'))) return;

    const isBand = activeId.startsWith('band-');
    const sourceId = activeId.replace(isBand ? 'band-' : 'custom-', '');

    const bandSource = isBand ? bands.find((b) => b.id === sourceId) : undefined;
    const customSource = !isBand ? customEvents.find((ce) => ce.id === sourceId) : undefined;

    if (isBand && !bandSource) return;
    if (!isBand && !customSource) return;

    const iconEl = typeof document !== 'undefined'
      ? document.getElementById('mobile-cancel-icon') || document.getElementById('mobile-cancel-dropzone')
      : null;

    const iconRect = iconEl?.getBoundingClientRect();
    const endX = iconRect ? iconRect.left + iconRect.width / 2 : window.innerWidth / 2;
    const endY = iconRect ? iconRect.top + iconRect.height / 2 : window.innerHeight - 80;

    const startX = startPoint?.x ?? (pointerRef.current.x > 0 ? pointerRef.current.x : window.innerWidth / 2);
    const startY = startPoint?.y ?? (pointerRef.current.y > 0 ? pointerRef.current.y : window.innerHeight / 2);

    setCancelAbsorbAnimation({
      id: Date.now(),
      label: isBand ? bandSource!.name : customSource!.name,
      subLabel: `${isBand ? bandSource!.performanceDuration : customSource!.duration}分`,
      kind: isBand ? 'band' : 'custom',
      startX,
      startY,
      endX,
      endY,
      cardWidth: size?.width,
    });
    // 元位置へ戻るドロップアニメーションを抑止
    setDropSucceeded(true);
  };

  // ポインタ座標は ref に保持し、描画に必要なモバイルのバンクドラッグ中だけ state を更新する。
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (activeDragId) {
        let x = 0;
        let y = 0;
        if ('clientY' in e) {
          x = e.clientX;
          y = e.clientY;
        } else if ('touches' in e && e.touches.length > 0) {
          x = e.touches[0].clientX;
          y = e.touches[0].clientY;
        }
        updatePointer(x, y);
        if (!activeDragId.startsWith('entry-')) setIsPointerOverCancelZone(isPointerInCancelZone(x, y));
      }
    };

    if (activeDragId) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('touchmove', handlePointerMove as (e: TouchEvent) => void);
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('touchmove', handlePointerMove as (e: TouchEvent) => void);
      };
    }
  }, [activeDragId, updatePointer]);

  // ドラッグ開始
  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    publishPointerYRef.current = !activeId.startsWith('entry-');
    const sourceRow = activeId.startsWith('entry-')
      ? Array.from(document.querySelectorAll<HTMLTableRowElement>('tr[data-entry-id]'))
          .find(row => `entry-${row.dataset.entryId}` === activeId)
      : undefined;
    entryViewportRef.current = sourceRow?.closest<HTMLElement>('.timetable-content')
      ?? document.querySelector<HTMLElement>('.timetable-content')
      ?? document.querySelector<HTMLElement>('[data-timetable-scroll-viewport]');
    entryPreviewRef.current = null;
    const viewport = entryViewportRef.current;
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
    const scrollTop = viewport?.scrollTop ?? 0;
    const toContentRect = (rect: DOMRect) => toTimetableContentRect(rect, viewportTop, scrollTop);
    const sourceRect = sourceRow ? toContentRect(sourceRow.getBoundingClientRect()) : null;
    entryDragGeometryRef.current = activeId.startsWith('entry-') && event.active.rect.current.initial && sourceRect
      ? { activeId, initial: sourceRect, translated: event.active.rect.current.initial }
      : null;
    const validEntryIds = new Set([
      ...(currentTimetable.cools?.flatMap(cool => cool.entries) || []),
      ...(currentTimetable.entries || []),
    ].map(entry => entry.id));
    entryRectsRef.current = activeId.startsWith('entry-')
      ? Array.from((viewport ?? document).querySelectorAll<HTMLTableRowElement>('tr[data-entry-id]'))
          .filter(row => validEntryIds.has(row.dataset.entryId || '') && row.getBoundingClientRect().height > 0)
          .map(row => ({ id: `entry-${row.dataset.entryId}`, element: row }))
      : [];
    sourceCoolIndexRef.current = activeId.startsWith('entry-')
      ? currentTimetable.cools?.findIndex(cool => cool.entries.some(entry => `entry-${entry.id}` === activeId)) ?? -1
      : -1;
    coolTargetsRef.current = activeId.startsWith('entry-') && viewport && currentTimetable.cools
      ? Array.from(viewport.querySelectorAll<HTMLElement>('[data-cool-index]')).map(section => ({
          index: Number(section.dataset.coolIndex),
          section,
          rows: entryRectsRef.current.filter(({ element }) => element.closest('[data-cool-index]') === section),
        }))
      : [];
    setActiveDragId(activeId);
    // Keep the original slot open until the dragged card passes a neighbour's midpoint.
    latestOverIdRef.current = activeId.startsWith('entry-') ? activeId : null;
    setOverEntryId(latestOverIdRef.current);
    setDropSucceeded(false);
    setCancelAbsorbAnimation(null);
    setIsPointerOverCancelZone(false);
  };

  // ドラッグ中
  const handleDragMove = (event: DragMoveEvent) => {
    const { active } = event;
    const activeId = active.id as string;
    if (!(activeId.startsWith('band-') || activeId.startsWith('custom-') || activeId.startsWith('entry-'))) {
      return;
    }

    const translatedRect = active.rect.current.translated;
    if (!translatedRect) return;

    if (activeId.startsWith('entry-') && active.rect.current.initial) {
      const initial = entryDragGeometryRef.current?.initial ?? active.rect.current.initial;
      entryDragGeometryRef.current = { activeId, initial, translated: translatedRect };
      const bank = latestOverIdRef.current === 'band-bank-droppable'
        ? document.querySelector<HTMLElement>('[data-band-bank-kind]')?.getBoundingClientRect()
        : null;
      const pointer = pointerRef.current;
      const stillInBank = bank && pointer.x >= bank.left && pointer.x <= bank.right && pointer.y >= bank.top && pointer.y <= bank.bottom;
      if (!stillInBank) publishEntryTarget(resolveEntryTarget(activeId, initial, translatedRect));
    }

    const centerX = translatedRect.left + translatedRect.width / 2;
    const centerY = translatedRect.top + translatedRect.height / 2;
    if (!pointerRef.current.x) updatePointer(centerX, centerY);
    if (!activeId.startsWith('entry-')) setIsPointerOverCancelZone(isPointerInCancelZone(pointerRef.current.x, pointerRef.current.y));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    const activeId = active.id as string;
    let pointerX = pointerRef.current.x;
    let pointerY = pointerRef.current.y;

    // touch環境でpointer/touchイベント座標が取れない場合に備えて、
    // dnd-kitが持つ現在のドラッグ矩形から中心座標を補完する
    const translatedRect = active.rect.current.translated;
    if (translatedRect) {
      if (activeId.startsWith('entry-') && active.rect.current.initial) {
        const initial = entryDragGeometryRef.current?.initial ?? active.rect.current.initial;
        entryDragGeometryRef.current = { activeId, initial, translated: translatedRect };
      }
      const centerX = translatedRect.left + translatedRect.width / 2;
      const centerY = translatedRect.top + translatedRect.height / 2;
      if (!pointerX) {
        pointerX = centerX;
        pointerY = centerY;
        updatePointer(centerX, centerY);
      }
      if (!activeId.startsWith('entry-')) setIsPointerOverCancelZone(isPointerInCancelZone(pointerX, pointerY));
    }

    // overが不安定なモバイル向けフォールバック: 座標がキャンセルゾーン内なら最優先でキャンセル扱い
    if ((activeId.startsWith('band-') || activeId.startsWith('custom-')) && isPointerInCancelZone(pointerX, pointerY)) {
      latestOverIdRef.current = 'mobile-cancel-dropzone';
      setOverEntryId('mobile-cancel-dropzone');
      setIsPointerOverCancelZone(true);
      return;
    }

    if (preferStableEntryTarget && activeId.startsWith('entry-')) {
      const overId = String(over?.id ?? '');
      if (overId === 'band-bank-droppable') {
        publishEntryTarget(overId);
      } else if (overId.startsWith('cool-')) {
        const coolIndex = Number(overId.match(/(\d+)$/)?.[1]);
        if (currentTimetable.cools?.[coolIndex]?.entries.length === 0) publishEntryTarget(`cool-droppable-${coolIndex}`);
      }
      // handleDragMove and the scroll listener own all nonempty insertion targets.
      // A transient null/heading collision must not erase the visible gap.
      return;
    }
    
    if (over) {
      const overId = over.id as string;
      
      // エントリーの場合、ドラッグ元に応じて判定方法を変える
      if (overId.startsWith('entry-')) {
        setIsPointerOverCancelZone(false);
        const overRect = over.rect;

        if (activeId.startsWith('entry-') && translatedRect && active.rect.current.initial) {
          const nextOverId = resolveEntryTarget(activeId, entryDragGeometryRef.current?.initial ?? active.rect.current.initial, translatedRect);
          latestOverIdRef.current = nextOverId;
          setOverEntryId(nextOverId);
          return;
        }
        
        // バンドバンクからのドラッグ、またはタイムテーブル内での並び替え：マウス位置で判定
        if (activeId.startsWith('band-') || activeId.startsWith('custom-') || activeId.startsWith('entry-')) {
          if (overRect && pointerY > 0) {
            const overCenter = overRect.top + overRect.height / 2;
            
            if (pointerY > overCenter) {
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
        overId === 'band-bank-droppable' ||
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
      // 自動スクロールで droppable が一時的に消えても、表の横幅内では
      // スクロール量を反映した位置を使う。縦端の外へ素早く動かしても空間を保つ。
      if (activeId.startsWith('entry-') && translatedRect && active.rect.current.initial) {
        const bounds = entryViewportRef.current?.getBoundingClientRect();
        const centerX = translatedRect.left + translatedRect.width / 2;
        if (bounds && centerX >= bounds.left && centerX <= bounds.right) {
          const target = resolveEntryTarget(activeId, entryDragGeometryRef.current?.initial ?? active.rect.current.initial, translatedRect);
          latestOverIdRef.current = target;
          setOverEntryId(target);
          return;
        }
      }
      latestOverIdRef.current = null;
      setOverEntryId(null);
      setIsPointerOverCancelZone(false);
    }
  };

  // ドラッグ終了
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const translatedRect = active.rect.current.translated;
    const dragCenter = translatedRect
      ? {
          x: translatedRect.left + translatedRect.width / 2,
          y: translatedRect.top + translatedRect.height / 2,
        }
      : undefined;
    const dragSize = translatedRect
      ? {
          width: translatedRect.width,
          height: translatedRect.height,
        }
      : undefined;
    
    // overEntryIdを保存（handleDragOverで計算済みの正確な挿入位置）
    // モバイルではタッチ離脱時にoverがnullになることがあるため、
    // overEntryIdをフォールバックとして使用する
    const savedOverEntryId = latestOverIdRef.current || overEntryId;
    const endPointer = pointerRef.current;
    
    setActiveDragId(null);
    setOverEntryId(null);
    setIsPointerOverCancelZone(false);
    updatePointer(0, 0);
    publishPointerYRef.current = false;
    if (trackPointerY) setCurrentPointerY(0);
    latestOverIdRef.current = null;
    entryRectsRef.current = [];
    coolTargetsRef.current = [];
    sourceCoolIndexRef.current = -1;
    entryViewportRef.current = null;
    entryPreviewRef.current = null;
    entryDragGeometryRef.current = null;

    const activeId = active.id as string;
    // 詰められたドラッグ元の行へ dnd-kit が戻すアニメーションを行うと、
    // 幅 0 の行が画面左端の目標座標として扱われる。
    if (activeId.startsWith('entry-')) setDropSucceeded(true);
    if (canDrop && !canDrop(event)) return;
    

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      if (!over && !savedOverEntryId) {
        if (isPointerInCancelZone(endPointer.x, endPointer.y)) {
          triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
          return;
        }
        return;
      }
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);

      if (overId === 'mobile-cancel-dropzone') {
        triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
        return;
      }

      if (isPointerInCancelZone(endPointer.x, endPointer.y)) {
        triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
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
        if (isPointerInCancelZone(endPointer.x, endPointer.y)) {
          triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
          return;
        }
        return;
      }
      
      // savedOverEntryIdを優先（-afterサフィックス含む正確な位置情報）
      const overId = savedOverEntryId || (over!.id as string);

      if (overId === 'mobile-cancel-dropzone') {
        triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
        return;
      }

      if (isPointerInCancelZone(endPointer.x, endPointer.y)) {
        triggerCancelAbsorbAnimation(activeId, dragCenter ?? endPointer, dragSize);
        return;
      }
      
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
    
    const targetId = over?.id === 'band-bank-droppable'
      ? 'band-bank-droppable'
      : savedOverEntryId || (over!.id as string);
    
    if (activeId.startsWith('entry-')) {
      if (targetId === 'band-bank-droppable') {
        setDropSucceeded(true);
        return;
      }
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
      ? currentTimetable.cools?.flatMap(cool => cool.entries).find(entry => `entry-${entry.id}` === activeDragId)
        || currentTimetable.entries.find(entry => `entry-${entry.id}` === activeDragId)
      : null;

    return { activeBand, activeCustomEvent, activeEntry };
  };

  return {
    activeDragId,
    overEntryId,
    isPointerOverCancelZone,
    currentPointerY,
    dropSucceeded,
    cancelAbsorbAnimation,
    clearCancelAbsorbAnimation: () => setCancelAbsorbAnimation(null),
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    getActiveItems,
  };
};
