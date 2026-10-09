import { DragOverlay, defaultDropAnimationSideEffects } from '@dnd-kit/core';
import { motion, useMotionValue } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { Band, CustomEvent, TimetableEntry } from '../types';
import { Icon } from './Icon';
import { BandCard } from './BandCard';

interface TimetableDragOverlayProps {
  activeBand: Band | null | undefined;
  activeCustomEvent: CustomEvent | null | undefined;
  activeEntry: TimetableEntry | null | undefined;
  bands: Band[];
  dropSucceeded: boolean;
  isOverTimetable?: boolean;
  timetableWidth?: number;
  timetableLeft?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  sourcePosition?: { left: number; top: number } | null;
}

interface DragCardProps {
  name: string;
  duration: number;
  isTimetableShape: boolean;
  isEntryCard: boolean;
  isCustom: boolean;
  timetableWidth: number;
  sourceWidth: number;
  sourceHeight: number;
}

// ドラッグ中は同じカードを保ち、配置先に合わせて見た目だけ変形する。
const DragCard = ({ name, duration, isTimetableShape, isEntryCard, isCustom, timetableWidth, sourceWidth, sourceHeight }: DragCardProps) => (
  <motion.div
    id="mobile-drag-overlay-card"
    initial={false}
    animate={{
      width: isTimetableShape ? timetableWidth : isEntryCard ? Math.max(300, sourceWidth) : sourceWidth,
      height: isTimetableShape ? 56 : sourceHeight,
      x: isTimetableShape ? -(timetableWidth - sourceWidth) / 2 : 0,
      borderRadius: isTimetableShape ? 4 : 8,
      backgroundColor: isTimetableShape ? '#d1fae5' : isEntryCard ? '#ffffff' : isCustom ? '#059669' : '#10b981',
      color: isTimetableShape || isEntryCard ? '#111827' : '#ffffff',
    }}
    transition={{ type: 'spring', stiffness: 280, damping: 26 }}
    className="relative overflow-hidden shadow-lg"
  >
    <motion.div
      animate={{ opacity: isTimetableShape ? 0 : 1, x: isTimetableShape ? -24 : 0 }}
      transition={{ duration: 0.16 }}
      className="absolute inset-0 flex flex-col justify-center px-4"
    >
      <div className="truncate font-semibold">{name}</div>
      <div className={`text-sm ${isEntryCard ? 'text-gray-500' : ''}`}>{duration}分</div>
    </motion.div>
    <motion.div
      animate={{ opacity: isTimetableShape ? 1 : 0, x: isTimetableShape ? 0 : 24 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 grid items-center border-b border-gray-200 text-sm"
      style={{ gridTemplateColumns: '64px 96px 96px 80px minmax(0, 1fr) 80px' }}
    >
      <span className="text-center text-gray-400">—</span>
      <span className="flex items-center gap-1 text-gray-500"><Icon name="schedule" className="text-sm" />—</span>
      <span className="text-gray-400">—</span>
      <span>{duration}分</span>
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <Icon name="drag_indicator" className="text-base text-emerald-400" />
        <span className="truncate">{name}</span>
      </span>
      <Icon name="delete" className="text-xl text-red-500" />
    </motion.div>
  </motion.div>
);

export const TimetableDragOverlay = ({
  activeBand,
  activeCustomEvent,
  activeEntry,
  bands,
  dropSucceeded,
  isOverTimetable = false,
  timetableWidth = 900,
  timetableLeft = 0,
  sourceWidth = 240,
  sourceHeight = 68,
  sourcePosition = null,
}: TimetableDragOverlayProps) => {
  const horizontalOffset = useMotionValue(0);
  const visualXRef = useRef(0);
  const transformXRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const cursorXRef = useRef<number | null>(null);
  const livePointerXRef = useRef(0);
  const previousPosition = useRef<{ bandId: string; locked: boolean; fixedX: number } | null>(null);
  const entryBand = activeEntry?.type === 'band' && activeEntry.bandId
    ? bands.find(band => band.id === activeEntry.bandId)
    : null;
  const draggedBand = activeBand || entryBand;
  const bankWidth = activeEntry ? 300 : sourceWidth;
  const activeBandId = draggedBand?.id;
  useEffect(() => {
    if (!activeBandId) return;
    const trackPointer = (event: PointerEvent) => { cursorXRef.current = event.clientX; };
    window.addEventListener('pointermove', trackPointer, true);
    return () => window.removeEventListener('pointermove', trackPointer, true);
  }, [activeBandId]);
  useEffect(() => {
    if (draggedBand) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    horizontalOffset.set(0);
    visualXRef.current = 0;
    transformXRef.current = 0;
    cursorXRef.current = null;
    livePointerXRef.current = 0;
    previousPosition.current = null;
  }, [draggedBand, horizontalOffset]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const dragCard = activeEntry
    ? {
        name: activeEntry.type === 'band' ? entryBand?.name || '(不明)' : activeEntry.customEvent?.name || '(不明)',
        duration: activeEntry.type === 'band' ? entryBand?.performanceDuration || 0 : activeEntry.customEvent?.duration || 0,
        isCustom: activeEntry.type === 'custom',
      }
    : activeBand
      ? { name: activeBand.name, duration: activeBand.performanceDuration, isCustom: false }
      : activeCustomEvent
        ? { name: activeCustomEvent.name, duration: activeCustomEvent.duration, isCustom: true }
        : null;

  return (
    <DragOverlay
      // ドラッグ元の行は開始後に詰められるため、dnd-kit の再計測値ではなく開始時の座標を使う。
      style={activeEntry && sourcePosition ? {
        left: sourcePosition.left,
        top: sourcePosition.top,
        width: sourceWidth,
        height: sourceHeight,
      } : undefined}
      modifiers={draggedBand ? [({ transform, activeNodeRect, overlayNodeRect, activatorEvent }) => {
        const activationX = activatorEvent && 'clientX' in activatorEvent
          ? Number(activatorEvent.clientX) : null;
        const pointerDeltaX = cursorXRef.current !== null && activationX !== null
          ? cursorXRef.current - activationX : transform.x;
        transformXRef.current = transform.x;
        const sourceLeft = activeEntry && sourcePosition
          ? sourcePosition.left : activeNodeRect?.left ?? overlayNodeRect?.left;
        // タイムテーブル行のドラッグハンドルは横長の行の中央付近にある。
        // バンク形状ではつかんだ位置を引き継がず、カードをカーソルの中央に置く。
        const grabOffset = sourceLeft !== undefined && activationX !== null
          ? activationX - sourceLeft : sourceWidth / 2;
        const freeX = pointerDeltaX + (activeEntry ? grabOffset - bankWidth / 2 : 0);
        livePointerXRef.current = freeX;
        const locked = isOverTimetable && sourceLeft !== undefined;
        const fixedX = locked
          ? timetableLeft - sourceLeft + (timetableWidth - sourceWidth) / 2
          : 0;
        let previous = previousPosition.current;
        if (previous?.bandId !== draggedBand.id) {
          if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
          visualXRef.current = activeEntry && locked ? fixedX : freeX;
          previous = { bandId: draggedBand.id, locked: Boolean(activeEntry && locked), fixedX };
        }
        if (previous.locked !== locked || (locked && Math.abs(previous.fixedX - fixedX) > 1)) {
          if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
          // 表に入る瞬間は必ずその時点のカーソル位置から始める。
          if (locked && !previous.locked) visualXRef.current = freeX;
          const from = visualXRef.current;
          const startedAt = performance.now();
          const move = (now: number) => {
            // 表から出るときは先にカードを縮め、横移動は後から始める。
            const delay = locked ? 0 : 140;
            const progress = Math.min(Math.max((now - startedAt - delay) / 300, 0), 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            // 出るときの行き先は、その間に動いた最新のカーソル位置を使う。
            const destination = locked ? fixedX : livePointerXRef.current;
            visualXRef.current = from + (destination - from) * eased;
            horizontalOffset.set(visualXRef.current - transformXRef.current);
            frameRef.current = progress < 1 ? requestAnimationFrame(move) : null;
          };
          frameRef.current = requestAnimationFrame(move);
        } else if (frameRef.current === null) {
          visualXRef.current = locked ? fixedX : freeX;
        }
        previousPosition.current = { bandId: draggedBand.id, locked, fixedX };
        horizontalOffset.set(visualXRef.current - transform.x);
        // 親は常にカーソルに追従。子の差分だけを横方向にアニメーションする。
        return transform;
      }] : undefined}
      dropAnimation={activeEntry || dropSucceeded
        ? null
        : {
            duration: 250,
            easing: 'ease',
            sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.5' } } }),
          }}
    >
      {draggedBand ? (
        <motion.div style={{ x: horizontalOffset }}>
        <BandCard
          band={draggedBand}
          mode={isOverTimetable ? 'timetable' : 'bank'}
          duration={draggedBand.performanceDuration}
          preview
          width={timetableWidth}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          bankWidth={bankWidth}
        />
        </motion.div>
      ) : dragCard && (
        <DragCard
          {...dragCard}
          isTimetableShape={isOverTimetable}
          isEntryCard={Boolean(activeEntry)}
          timetableWidth={timetableWidth}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
        />
      )}
    </DragOverlay>
  );
};
