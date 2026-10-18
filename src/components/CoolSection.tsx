import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableTimetableRow } from './SortableTimetableRow';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';
import type { Cool, Band, ConstraintViolation, CustomColumn, TimetableEntry } from '../types';
import { Icon } from './Icon';
import { getDestinationPlaceholderIndex, moveDraggedEntryPlaceholder } from '../utils/dragPlaceholderOrder';

interface CoolSectionProps {
  cool: Cool;
  coolIndex: number;
  totalCools: number;
  bands: Band[];
  overEntryId: string | null;
  reserveInsertionSpace?: boolean;
  onRemoveEntry: (entryId: string) => void;
  onDeleteCool: (coolIndex: number) => void;
  onMoveCoolUp: (coolIndex: number) => void;
  onMoveCoolDown: (coolIndex: number) => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  lockCoolStructure?: boolean;
  rehearsalType?: 'rehearsal-day' | 'cool-pre-rehearsal' | 'day-start-rehearsal' | 'none'; // リハーサルのタイプ
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  onTimeClick?: (entryId: string, field: 'start' | 'end', coolIndex: number) => void;
  onCoolStartTimeChange?: (coolIndex: number, startTime: string | undefined) => void;
  previousCoolEndTime?: string; // 前のクールの終了時刻（デフォルト値として使用）
  overlapBaselineTime?: string; // 開始時刻の重なり判定に使う基準時刻
  nextCoolStartTime?: string; // 次のクールの開始時刻（警告表示用）
  dailyStartTime: string; // その日の開始時刻（最小値として使用）
  dailyEndTime?: string;
  previousCoolStartTime?: string;
  violations?: ConstraintViolation[]; // このクール内の制約違反
  bandNumbers: Map<string, number>; // エントリーIDとバンド番号のマッピング
  searchQuery?: string; // 検索クエリ
  customMode?: boolean;
  customColumns?: CustomColumn[];
  enteringColumnIds?: ReadonlySet<string>;
  renderCustomCell?: (entry: TimetableEntry, column: CustomColumn, index: number) => ReactNode;
  returningEntryId?: string | null;
}

const InsertionGapRow = ({ height, colSpan, destination = false }: { height: number; colSpan: number; destination?: boolean }) => {
  if (destination) return (
    <motion.tr aria-hidden="true" data-drag-placeholder="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <td colSpan={colSpan} className="border-0 p-0 leading-none">
        <motion.div initial={{ height: 0 }} animate={{ height }} exit={{ height: 0 }} transition={{ duration: 0.18, ease: 'easeInOut' }} className="overflow-hidden bg-emerald-100/60" />
      </td>
    </motion.tr>
  );
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} className="border-0 p-0 leading-none">
        <div className="overflow-hidden bg-emerald-100/60" style={{ height, transition: 'height 180ms ease-out' }} />
      </td>
    </tr>
  );
};

export const CoolSection = ({ 
  cool, 
  coolIndex, 
  totalCools,
  bands, 
  overEntryId,
  reserveInsertionSpace = false,
  onRemoveEntry,
  onDeleteCool,
  onMoveCoolUp,
  onMoveCoolDown,
  isReadOnly = false,
  lockCoolStructure = false,
  rehearsalType = 'none',
  onTransitionTimeChange,
  onTimeClick,
  onCoolStartTimeChange,
  previousCoolEndTime,
  overlapBaselineTime,
  nextCoolStartTime,
  dailyStartTime,
  dailyEndTime,
  previousCoolStartTime,
  violations = [],
  bandNumbers,
  searchQuery = '',
  customMode = false,
  customColumns = [],
  enteringColumnIds,
  renderCustomCell,
  returningEntryId = null,
}: CoolSectionProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [startTimeInput, setStartTimeInput] = useState(cool.startTime || '');
  const sectionRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const lastSourceTargetRef = useRef<string | null>(null);
  const rowLayoutRef = useRef<{ order: string; positions: Map<string, number>; dragging: boolean } | null>(null);
  const rowAnimationsRef = useRef<{ row: HTMLTableRowElement; animation: Animation }[]>([]);
  const { active: draggedItem } = useDndContext();
  // BandCard's timetable shape is 56px. The draggable <tr> can include a
  // transient insertion gap, so its measured height must not size this gap.
  const dragRowHeight = 56;
  const draggedEntryId = String(draggedItem?.id ?? '');
  const sourceIsInCool = cool.entries.some(entry => `entry-${entry.id}` === draggedEntryId);
  const targetEntryId = overEntryId?.replace(/-after$/, '');
  const targetIsInCool = cool.entries.some(entry => `entry-${entry.id}` === targetEntryId)
    || overEntryId === `cool-header-${coolIndex}`
    || overEntryId === `cool-column-header-${coolIndex}`
    || overEntryId === `cool-gap-before-${coolIndex}`
    || overEntryId === `cool-gap-after-${coolIndex}`
    || overEntryId === `cool-droppable-${coolIndex}`;
  const moveSourcePlaceholder = reserveInsertionSpace && sourceIsInCool && targetIsInCool;
  const showDestinationPlaceholder = reserveInsertionSpace && draggedEntryId.startsWith('entry-')
    && !sourceIsInCool && targetIsInCool;
  // Keep the source slot at its last dragged position while it shrinks on a
  // cross-cool move. Resetting to cool.entries here makes the gap jump back to
  // the card's original position before its exit animation finishes.
  const sourcePreviewTarget = reserveInsertionSpace && sourceIsInCool
    ? (moveSourcePlaceholder ? overEntryId : lastSourceTargetRef.current)
    : null;
  useLayoutEffect(() => {
    if (moveSourcePlaceholder) lastSourceTargetRef.current = overEntryId;
    else if (!reserveInsertionSpace) lastSourceTargetRef.current = null;
  }, [moveSourcePlaceholder, overEntryId, reserveInsertionSpace]);
  const previewEntries = useMemo(() => {
    return sourcePreviewTarget
      ? moveDraggedEntryPlaceholder(cool.entries, draggedEntryId, sourcePreviewTarget, coolIndex)
      : cool.entries;
  }, [cool.entries, draggedEntryId, sourcePreviewTarget, coolIndex]);

  const destinationPlaceholderIndex = showDestinationPlaceholder
    ? getDestinationPlaceholderIndex(previewEntries, overEntryId, coolIndex)
    : -1;
  const previewOrderIds = previewEntries.map(entry => entry.id);
  if (destinationPlaceholderIndex >= 0) previewOrderIds.splice(destinationPlaceholderIndex, 0, 'drag-placeholder');
  const previewOrder = previewOrderIds.join('\u0000');
  const animatingPlaceholder = moveSourcePlaceholder || showDestinationPlaceholder;
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const viewport = section.closest<HTMLElement>('.timetable-content');
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
    const scrollTop = viewport?.scrollTop ?? 0;
    const rows = Array.from(section.querySelectorAll<HTMLTableRowElement>('tbody > tr[data-entry-id]'));
    const rowOffset = (row: HTMLTableRowElement) => {
      if (!row.dataset.dragAnimating) return 0;
      const transform = getComputedStyle(row).transform;
      return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    };
    const positions = new Map(rows.map(row => [
      row.dataset.entryId!,
      row.getBoundingClientRect().top - rowOffset(row) - viewportTop + scrollTop,
    ]));
    const previous = rowLayoutRef.current;
    const changedOrder = previous?.order !== previewOrder;
    const animateSwap = animatingPlaceholder && previous?.dragging && changedOrder
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (changedOrder || !animatingPlaceholder) {
      const currentOffsets = new Map<HTMLTableRowElement, number>();
      if (animateSwap) {
        for (const row of rows) currentOffsets.set(row, rowOffset(row));
      }
      rowAnimationsRef.current.forEach(({ row, animation }) => {
        animation.cancel();
        delete row.dataset.dragAnimating;
      });
      rowAnimationsRef.current = [];

      if (animateSwap) {
        for (const row of rows) {
          const id = row.dataset.entryId!;
          if (`entry-${id}` === draggedEntryId) continue;
          const before = previous.positions.get(id);
          const after = positions.get(id);
          if (before === undefined || after === undefined) continue;
          const distance = before - after;
          // A swap moves each neighbouring card by one row. Ignore larger
          // deltas caused by section layout changes or a different drag.
          if (Math.abs(distance) < 1 || Math.abs(distance) > 84) continue;
          const animation = row.animate(
            [
              { transform: `translateY(${distance + (currentOffsets.get(row) ?? 0)}px)` },
              { transform: 'translateY(0)' },
            ],
            { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          );
          row.dataset.dragAnimating = 'true';
          animation.onfinish = () => { delete row.dataset.dragAnimating; };
          rowAnimationsRef.current.push({ row, animation });
        }
      }
    }
    rowLayoutRef.current = { order: previewOrder, positions, dragging: animatingPlaceholder };
  }, [previewOrder, animatingPlaceholder, draggedEntryId]);

  useEffect(() => () => rowAnimationsRef.current.forEach(({ row, animation }) => {
    animation.cancel();
    delete row.dataset.dragAnimating;
  }), []);

  
  const { setNodeRef } = useDroppable({
    id: `cool-droppable-${coolIndex}`,
    disabled: isReadOnly,
  });

  // クールヘッダー全体をドロップ可能に（先頭に追加）
  const { setNodeRef: setHeaderRef } = useDroppable({
    id: `cool-header-${coolIndex}`,
    disabled: isReadOnly,
  });

  // 列ヘッダーをドロップ可能に
  const { setNodeRef: setColumnHeaderRef } = useDroppable({
    id: `cool-column-header-${coolIndex}`,
    disabled: isReadOnly,
  });

  // coolの開始時刻が変更されたら入力フィールドも更新
  useEffect(() => {
    setStartTimeInput(cool.startTime || '');
  }, [cool.startTime]);

  // bandsが更新されたときに強制的に再レンダリング
  // このクールに関連するバンドのupdatedAtの合計をシグネチャとして使用
  const bandsSignature = useMemo(() => {
    const signature = cool.entries
      .filter(entry => entry.type === 'band' && entry.bandId)
      .map(entry => {
        const band = bands.find(b => b.id === entry.bandId);
        return band ? band.updatedAt.getTime() : 0;
      })
      .reduce((sum, time) => sum + time, 0);
    return signature;
  }, [bands, cool.entries]);

  // メニュー外をクリックしたときに閉じる
  useEffect(() => {
    if (!isMenuOpen) return;
    
    const handleClickOutside = () => setIsMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (customMode) setIsMenuOpen(false);
  }, [customMode]);

  useEffect(() => {
    const header = stickyHeaderRef.current;
    const section = sectionRef.current;
    if (!header || !section) return;

    const updateHeaderHeight = () => {
      section.style.setProperty('--cool-sticky-header-height', `${header.getBoundingClientRect().height}px`);
    };
    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const handleDeleteClick = () => {
    onDeleteCool(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveUp = () => {
    onMoveCoolUp(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMoveDown = () => {
    onMoveCoolDown(coolIndex);
    setIsMenuOpen(false);
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleStartTimeCommit = (value: string | undefined) => {
    if (!onCoolStartTimeChange) return;

    if (!value || value.trim() === '') {
      setStartTimeInput('');
      onCoolStartTimeChange(coolIndex, undefined);
      return;
    }

    // 開始時刻がdailyStartTimeより前でないか検証
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const inputMinutes = timeToMinutes(value);
    const minMinutes = timeToMinutes(dailyStartTime);

    if (inputMinutes < minMinutes) {
      alert(`開始時刻は${dailyStartTime}以降に設定してください。`);
      setStartTimeInput(cool.startTime || '');
      return;
    }

    if (dailyEndTime && inputMinutes >= timeToMinutes(dailyEndTime)) {
      alert(`クール開始時刻は終了時刻（${dailyEndTime}）より前に設定してください。`);
      setStartTimeInput(cool.startTime || '');
      return;
    }
    if (previousCoolStartTime && inputMinutes <= timeToMinutes(previousCoolStartTime)) {
      alert(`クール開始時刻は前のクール開始時刻（${previousCoolStartTime}）より後に設定してください。`);
      setStartTimeInput(cool.startTime || '');
      return;
    }

    setStartTimeInput(value);
    onCoolStartTimeChange(coolIndex, value);
  };

  // クールの最後のエントリーの終了時刻を取得
  const getLastEntryEndTime = (): string | undefined => {
    if (cool.entries.length === 0) return undefined;
    const lastEntry = cool.entries[cool.entries.length - 1];
    return lastEntry.endTime;
  };

  // 時刻超過警告の判定
  const isTimeExceeded = (): boolean => {
    if (!nextCoolStartTime) return false;
    const lastEndTime = getLastEntryEndTime();
    if (!lastEndTime) return false;
    
    // HH:mm形式の時刻を分単位に変換して比較
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    return timeToMinutes(lastEndTime) > timeToMinutes(nextCoolStartTime);
  };

  // 開始時刻が前タイムラインと重なるかどうかを判定
  const isOverlappingPreviousTimeline = (): boolean => {
    if (!cool.startTime || !overlapBaselineTime) return false;

    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    return timeToMinutes(cool.startTime) < timeToMinutes(overlapBaselineTime);
  };

  const showWarning = isTimeExceeded();
  const showOverlapWarning = isOverlappingPreviousTimeline();

  // 別日リハーサルイベントの場合は常にクール名を表示、それ以外は複数クールかつ編集可能な場合のみ表示
  const shouldShowCoolHeader = rehearsalType === 'rehearsal-day' || totalCools > 1;

  return (
    <div ref={sectionRef} data-cool-index={coolIndex} data-custom-mode={customMode} className={`relative rounded-lg border border-emerald-100 bg-emerald-50/50 ${customMode && customColumns.length > 3 ? 'custom-wide-section' : ''} ${(showWarning || showOverlapWarning) ? 'ring-2 ring-red-500' : ''}`} style={{ ...(customMode && customColumns.length > 3 ? { '--custom-table-width': `calc(var(--custom-fixed-width) + ${customColumns.map(() => 'var(--custom-cell-width)').join(' + ')})` } : {}) } as CSSProperties}>
      {shouldShowCoolHeader && (
        <div ref={stickyHeaderRef} data-cool-heading-index={coolIndex} className="sticky top-0 z-20 shadow-sm">
          {/* クール名ヘッダーの上に表示する線は削除（ドロップ可能だがハイライトなし） */}
          <div ref={setHeaderRef} className="bg-emerald-100 px-4 py-2 flex justify-between items-center">
          <div className="cool-header-left flex items-center gap-4">
            <div className="font-semibold text-emerald-800">第{cool.number}クール</div>
            {(!isReadOnly || customMode) && (
            <div className="mode-cool-control flex items-center gap-2 text-sm" inert={customMode} aria-hidden={customMode}>
              <label htmlFor={`cool-start-time-${coolIndex}`} className="text-gray-600">
                開始時刻:
              </label>
              <div className="flex items-center gap-1">
                <DesktopClockTimePicker
                  id={`cool-start-time-${coolIndex}`}
                  value={startTimeInput}
                  onChange={handleStartTimeCommit}
                  allowClear
                  inputClassName="bg-white text-gray-900 px-2 py-1 rounded border border-gray-300 focus:border-emerald-500 focus:outline-none min-w-[96px] text-sm"
                  placeholder="未設定"
                />
              </div>
              {!startTimeInput && previousCoolEndTime && (
                <span className="text-gray-500 text-xs">
                  ({previousCoolEndTime} から継続)
                </span>
              )}
              {!startTimeInput && !previousCoolEndTime && (
                <span className="text-gray-500 text-xs">(前のクールから継続)</span>
              )}
              {showWarning && (
                <span className="text-red-400 text-xs flex items-center gap-1">
                  <Icon name="warning" className="text-sm" />次のクール開始時刻を超過
                </span>
              )}
              {showOverlapWarning && (
                <span className="text-red-400 text-xs flex items-center gap-1">
                  <Icon name="warning" className="text-sm" />前のタイムラインと時刻が重複
                </span>
              )}
            </div>
            )}
          </div>
          {(!isReadOnly || customMode) && !lockCoolStructure && (
          <div className="mode-cool-control mode-cool-menu relative" inert={customMode} aria-hidden={customMode}>
            <button
              onClick={handleMenuToggle}
              className="px-2 py-1 text-gray-700 hover:bg-gray-300 rounded transition-colors"
              title="メニュー"
            >
              <Icon name="more_vert" className="text-base align-middle" />
            </button>
            
            {isMenuOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded shadow-lg z-10">
                <button
                  onClick={handleMoveUp}
                  disabled={coolIndex === 0}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                    coolIndex === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700'
                  }`}
                >
                  <Icon name="arrow_upward" className="text-sm align-middle mr-1" />上に移動
                </button>
                <button
                  onClick={handleMoveDown}
                  disabled={coolIndex === totalCools - 1}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                    coolIndex === totalCools - 1 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700'
                  }`}
                >
                  <Icon name="arrow_downward" className="text-sm align-middle mr-1" />下に移動
                </button>
                <div className="border-t border-gray-200"></div>
                <button
                  onClick={handleDeleteClick}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 transition-colors"
                >
                  <Icon name="delete" className="text-sm" /> 削除
                </button>
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      )}
      <div ref={setNodeRef} className={cool.entries.length === 0 ? "min-h-[100px]" : ""}>
        <table className={`timetable-grid w-full ${customMode && customColumns.length > 3 ? 'custom-wide-table' : ''}`}>
          {customMode && customColumns.length > 3 && <colgroup>
            <col className="custom-fixed-number" /><col className="custom-fixed-start" />
            <col className="custom-collapsed-column" /><col className="custom-collapsed-column" />
            <col className="custom-fixed-band" /><col className="custom-collapsed-column" />
            {customColumns.map(column => <col key={column.id} className="custom-scrolling-column" />)}
          </colgroup>}
          <thead ref={setColumnHeaderRef} data-cool-column-heading-index={coolIndex} className="sticky z-10 bg-emerald-100 shadow-sm" style={{ top: shouldShowCoolHeader ? 'var(--cool-sticky-header-height, 48px)' : 0 }}>
            <tr>
              <th className="px-3 py-2 text-center text-sm font-semibold text-emerald-800 w-16">#</th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800 w-24"><span className="pl-4">開始</span></th>
              <th className="mode-optional-cell w-24 text-left text-sm font-semibold text-emerald-800"><span className="mode-optional-content">終了</span></th>
              <th className="mode-optional-cell w-20 text-left text-sm font-semibold text-emerald-800"><span className="mode-optional-content">時間</span></th>
              <th className="px-4 py-2 text-left text-sm font-semibold text-emerald-800"><span className="mode-band-name-label inline-block pl-7">バンド名</span></th>
              <th className="mode-optional-cell w-20" aria-label="削除操作" />
              <AnimatePresence>{customMode && customColumns.map(column => <motion.th key={column.id} initial={enteringColumnIds?.has(column.id) ? { width: 0, opacity: 0 } : false} animate={{ width: 160, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.26 }} className="relative min-w-0 overflow-hidden whitespace-nowrap border-l border-emerald-200 p-0 text-left text-sm font-semibold text-emerald-800"><span className="absolute inset-y-0 left-0 flex w-40 items-center px-3"><Icon name={column.bindingType === 'sequence' ? 'push_pin' : 'music_note'} className="mr-1 text-sm align-middle" />{column.name}</span></motion.th>)}</AnimatePresence>
            </tr>
          </thead>
          <SortableContext
            items={cool.entries.map(e => `entry-${e.id}`)}
            strategy={verticalListSortingStrategy}
          >
          <tbody>
            {cool.entries.length === 0 ? (
              <>
                {/* 空のクールの場合のドロップターゲット */}
                {reserveInsertionSpace && (overEntryId === `cool-droppable-${coolIndex}` ||
                  overEntryId === `cool-header-${coolIndex}` ||
                  overEntryId === `cool-column-header-${coolIndex}` ||
                  overEntryId === `cool-gap-before-${coolIndex}` ||
                  overEntryId === `cool-gap-after-${coolIndex}`) && (
                  <tr className="h-14">
                    <td colSpan={6 + (customMode ? customColumns.length : 0)} className="p-0">
                      <div className="h-14 bg-emerald-100/60"></div>
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={6 + (customMode ? customColumns.length : 0)} className="px-4 py-8 text-center text-gray-500">
                    {customMode ? 'このクールにはエントリーがありません' : 'バンドをドラッグ＆ドロップで配置'}
                  </td>
                </tr>
              </>
            ) : (
              <>
                <AnimatePresence initial={false}>
                {previewEntries.flatMap((entry, entryIndex) => {
                  const band = entry.bandId ? bands.find((b) => b.id === entry.bandId) : null;
                  const entryId = `entry-${entry.id}`;
                  const isDropTarget = overEntryId === entryId;
                  const isDropTargetAfter = overEntryId === `${entryId}-after`;
                  const usesSeparateGap = reserveInsertionSpace && !moveSourcePlaceholder && !showDestinationPlaceholder && entry.type === 'band' && Boolean(band);
                  
                  // クールヘッダーまたは列ヘッダー、または前のギャップにドロップした場合、最初のエントリーの前をハイライト
                  const isFirstEntryAndHeaderDrop = entryIndex === 0 && (
                    overEntryId === `cool-header-${coolIndex}` || 
                    overEntryId === `cool-column-header-${coolIndex}` ||
                    overEntryId === `cool-gap-before-${coolIndex}`
                  );
                  
                  // 最後のエントリーで、cool-droppableまたはcool-gap-afterが検出された場合、最後のエントリーの後ろをハイライト
                  const isLastEntryAndCoolEnd = entryIndex === previewEntries.length - 1 && (
                    overEntryId === `cool-droppable-${coolIndex}` ||
                    overEntryId === `cool-gap-after-${coolIndex}`
                  );
                  
                  // バンド情報が更新されたときに確実に再レンダリングするため、keyにbandsSignatureを含める
                  // これにより、バンド情報が変更されるとkeyが変わり、コンポーネントが再マウントされる
                  const rowKey = `${entry.id}-${bandsSignature}`;
                  
                  // このエントリーの制約違反をフィルタ
                  const entryViolations = violations.filter(v => v.entryId === entry.id);
                  
                  // このエントリーのバンド番号を取得
                  const bandNumber = bandNumbers.get(entry.id);
                  
                  return [
                    ...(destinationPlaceholderIndex === entryIndex
                      ? [<InsertionGapRow key="destination-placeholder" height={dragRowHeight} colSpan={6 + (customMode ? customColumns.length : 0)} destination />]
                      : []),
                    <Fragment key={rowKey}>
                    {usesSeparateGap && <InsertionGapRow height={(isDropTarget || isFirstEntryAndHeaderDrop) && draggedItem?.id !== entryId ? dragRowHeight : 0} colSpan={6 + (customMode ? customColumns.length : 0)} />}
                    <SortableTimetableRow
                      id={entryId}
                      entry={entry}
                      band={band}
                      isDropTarget={isDropTarget || isFirstEntryAndHeaderDrop}
                      isDropTargetAfter={isDropTargetAfter || isLastEntryAndCoolEnd}
                      reserveInsertionSpace={reserveInsertionSpace}
                      externalInsertionGap={reserveInsertionSpace && entry.type === 'band' && Boolean(band)}
                      holdDragRowSpace={moveSourcePlaceholder && entryId === draggedEntryId}
                      collapseDragRowSpace={reserveInsertionSpace && sourceIsInCool && !targetIsInCool && entryId === draggedEntryId}
                      suppressInsertionGap={moveSourcePlaceholder || showDestinationPlaceholder}
                      onRemove={() => onRemoveEntry(entry.id)}
                      isReadOnly={isReadOnly}
                      onTransitionTimeChange={onTransitionTimeChange}
                      onTimeClick={(entryId, field) => onTimeClick?.(entryId, field, coolIndex)}
                      violations={entryViolations}
                      bandNumber={bandNumber}
                      searchQuery={searchQuery}
                      customMode={customMode}
                      customColumns={customColumns}
                      renderCustomCell={renderCustomCell}
                      returningToBank={entry.id === returningEntryId}
                    />
                    {usesSeparateGap && <InsertionGapRow height={isDropTargetAfter || isLastEntryAndCoolEnd ? dragRowHeight : 0} colSpan={6 + (customMode ? customColumns.length : 0)} />}</Fragment>,
                  ];
                })}
                {destinationPlaceholderIndex === previewEntries.length && <InsertionGapRow key="destination-placeholder" height={dragRowHeight} colSpan={6 + (customMode ? customColumns.length : 0)} destination />}
                </AnimatePresence>
                {/* クールの最後にドロップできるようにする（エントリーがない場合のみ表示） */}
                {/* エントリーがある場合は最後のエントリーの-afterとして表示される */}
                {cool.entries.length === 0 && (overEntryId === `cool-droppable-${coolIndex}` ||
                  overEntryId === `cool-gap-after-${coolIndex}`) && (
                  <tr className={reserveInsertionSpace ? 'h-14' : 'h-1'}>
                    <td colSpan={6} className="p-0">
                      <div className={reserveInsertionSpace ? 'h-14 bg-emerald-100/60' : 'h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50'}></div>
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
          </SortableContext>
        </table>
      </div>
    </div>
  );
};
