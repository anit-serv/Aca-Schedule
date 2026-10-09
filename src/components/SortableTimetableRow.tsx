import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Band, TimetableEntry, ConstraintViolation, CustomColumn } from '../types';
import { Icon } from './Icon';
import { BandCard } from './BandCard';
import { matchesTimetableBandSearch } from '../utils/timetableSearch';

interface SortableTimetableRowProps {
  id: string;
  entry: TimetableEntry;
  band: Band | null | undefined;
  isDropTarget?: boolean; // 行の前（上）にドロップ
  isDropTargetAfter?: boolean; // 行の後（下）にドロップ
  onRemove: () => void;
  isReadOnly?: boolean; // クール直前リハーサルなどで編集を制限
  onTransitionTimeChange?: (entryId: string, transitionTime: number) => void;
  onTimeClick?: (entryId: string, field: 'start' | 'end') => void;
  violations?: ConstraintViolation[]; // この行の制約違反リスト
  bandNumber?: number; // バンド番号（カスタムイベントの場合はundefined）
  searchQuery?: string; // 検索クエリ
  customMode?: boolean;
  customColumns?: CustomColumn[];
  renderCustomCell?: (entry: TimetableEntry, column: CustomColumn, index: number) => ReactNode;
  returningToBank?: boolean;
  reserveInsertionSpace?: boolean;
}

export const SortableTimetableRow = ({
  id,
  entry,
  band,
  isDropTarget = false,
  isDropTargetAfter = false,
  onRemove,
  isReadOnly = false,
  onTransitionTimeChange,
  onTimeClick,
  violations = [],
  bandNumber,
  searchQuery = '',
  customMode = false,
  customColumns = [],
  renderCustomCell,
  returningToBank = false,
  reserveInsertionSpace = false,
}: SortableTimetableRowProps) => {
  const dragDisabled = customMode || isReadOnly || Boolean(entry.fixedStartTime);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, active } =
    useSortable({ id, disabled: { draggable: dragDisabled, droppable: customMode || isReadOnly } });

  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [transitionInput, setTransitionInput] = useState((entry.transitionTime || 0).toString());
  const [tooltipStyle, setTooltipStyle] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const [sourceRectCaptured, setSourceRectCaptured] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // DragOverlay が元の行の位置を測定するまでは、行をレイアウト内に残す。
    const frame = requestAnimationFrame(() => setSourceRectCaptured(isDragging));
    return () => cancelAnimationFrame(frame);
  }, [isDragging]);

  // バンド情報が更新されたときに転換時間入力をリセット
  useEffect(() => {
    setTransitionInput((entry.transitionTime || 0).toString());
  }, [entry.transitionTime]);

  useEffect(() => {
    if (customMode) setShowTransitionModal(false);
  }, [customMode]);

  // ツールチップの位置を計算
  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const spaceBelow = windowHeight - rect.bottom;
      const spaceAbove = rect.top;
      
      // 下に400px以上の余裕がない場合は上に表示
      if (spaceBelow < 400 && spaceAbove > spaceBelow) {
        setTooltipStyle({
          bottom: windowHeight - rect.top + 4,
          left: rect.left,
        });
      } else {
        setTooltipStyle({
          top: rect.bottom + 4,
          left: rect.left,
        });
      }
    }
  };

  const style = {
    // ドラッグ元の行を表のレイアウトから外す。挿入先の空間はドロップターゲット側だけで作る。
    transform: active?.id.toString().startsWith('entry-') ? undefined : CSS.Transform.toString(transform),
    transition: returningToBank || isDragging ? `${transition ? `${transition}, ` : ''}opacity 180ms ease-out` : transition,
    opacity: returningToBank ? 0 : isDragging ? 0.5 : 1,
    visibility: isDragging && sourceRectCaptured ? 'collapse' as const : 'visible' as const,
  };

  // バンド情報をメモ化して、確実に最新の情報を使用
  // band オブジェクトが変更されたときに再計算されるよう、band 自体を依存配列に含める
  const bandName = useMemo(() => {
    if (entry.type === 'band' && band) {
      return band.name;
    }
    if (entry.type === 'custom' && entry.customEvent) {
      return entry.customEvent.name;
    }
    return '(不明)';
  }, [entry.type, entry.customEvent, band]);

  const bandMembers = useMemo(() => {
    if (!band || band.members.length === 0) return null;
    return band.members;
  }, [band]);

  const performanceDuration = useMemo(() => {
    const duration = band?.performanceDuration || entry.customEvent?.duration || 0;
    return duration;
  }, [band, entry.customEvent?.duration]);

  // 開始時刻と終了時刻から実際の時間を計算
  const duration = (() => {
    if (entry.startTime && entry.endTime) {
      const [startHours, startMinutes] = entry.startTime.split(':').map(Number);
      const [endHours, endMinutes] = entry.endTime.split(':').map(Number);
      const startTotalMinutes = startHours * 60 + startMinutes;
      const endTotalMinutes = endHours * 60 + endMinutes;
      return endTotalMinutes - startTotalMinutes;
    }
    return performanceDuration;
  })();

  // 検索マッチ判定
  const isSearchMatch = useMemo(() => {
    return band ? matchesTimetableBandSearch(band, searchQuery) : false;
  }, [searchQuery, band]);

  // 制約違反の最も重大度の高いものを取得
  const highestSeverityViolation = useMemo(() => {
    if (violations.length === 0) return null;
    
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])[0];
  }, [violations]);

  // 違反の重大度に応じた背景色とアイコンを取得
  const getViolationStyle = () => {
    if (!highestSeverityViolation) return { bgColor: '', icon: '' };
    
    switch (highestSeverityViolation.severity) {
      case 'high':
        return { bgColor: 'bg-rose-100/80', icon: 'block', iconColor: 'text-rose-500' };
      case 'medium':
        return { bgColor: 'bg-amber-100/80', icon: 'warning', iconColor: 'text-amber-500' };
      case 'low':
        return { bgColor: 'bg-sky-100/80', icon: 'info', iconColor: 'text-sky-500' };
      default:
        return { bgColor: '', icon: '', iconColor: '' };
    }
  };

  const violationStyle = getViolationStyle();
  const usesBackupRehearsalTime = violations.some(violation => violation.type === 'backup-rehearsal-used');
  const useCardGap = reserveInsertionSpace && entry.type === 'band' && Boolean(band);
  const timetableBackground = isDragging ? 'bg-emerald-100'
    : usesBackupRehearsalTime ? 'bg-violet-100/80'
    : violationStyle.bgColor || (entry.type === 'custom' ? 'bg-emerald-100/70' : '');
  const visibleTimetableBackground = `${timetableBackground} ${isSearchMatch ? 'bg-emerald-50' : ''}`;
  const fixedCellBackground = customMode ? visibleTimetableBackground : '';

  return (
    <>
      {isDropTarget && !reserveInsertionSpace && (
        <tr className="h-1">
          <td colSpan={6} className="p-0">
            <div className="h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
          </td>
        </tr>
      )}
      <tr
        ref={setNodeRef}
        style={style}
        data-entry-id={entry.id}
        className={`timetable-card-row border-b border-gray-200 ${
          reserveInsertionSpace && !useCardGap && isDropTarget ? 'insertion-gap-before ' : ''
        }${reserveInsertionSpace && !useCardGap && isDropTargetAfter ? 'insertion-gap-after ' : ''}${
          customMode ? '' : visibleTimetableBackground
        } ${isSearchMatch ? 'ring-2 ring-inset ring-emerald-400' : ''} ${
          searchQuery && !isSearchMatch && entry.type === 'band' ? 'opacity-40' : ''
        }`}
      >
      {entry.type === 'band' && band ? <td colSpan={6} className={`p-0 ${fixedCellBackground}`}>
        <motion.div initial={false} animate={{ height: useCardGap && isDropTarget ? 56 : 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="overflow-hidden bg-emerald-100/60" />
        <BandCard band={band} mode="timetable" duration={duration} number={bandNumber} startTime={entry.startTime} endTime={entry.endTime} fixedTime={Boolean(entry.fixedStartTime)} onTimeClick={!isReadOnly ? field => onTimeClick?.(entry.id, field) : undefined} transitionTime={entry.transitionTime} onTransitionClick={!customMode && !isReadOnly ? () => setShowTransitionModal(true) : undefined} onRemove={onRemove} isReadOnly={isReadOnly} violations={violations} dragListeners={dragDisabled ? undefined : listeners} dragAttributes={dragDisabled ? undefined : attributes} customMode={customMode} />
        <motion.div initial={false} animate={{ height: useCardGap && isDropTargetAfter ? 56 : 0 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="overflow-hidden bg-emerald-100/60" />
      </td> : <>
      {/* バンド番号列 */}
      <td className={`px-3 py-3 text-sm text-center font-semibold text-gray-600 ${fixedCellBackground}`}>
        {bandNumber !== undefined ? bandNumber : ''}
      </td>
      <td className={`px-2 py-3 text-sm ${fixedCellBackground}`}>
        <div className="relative flex items-center gap-1">
          {entry.fixedStartTime && <Icon name="lock" className="absolute -left-4 top-1/2 -translate-y-1/2 text-sm leading-none text-emerald-700" />}
          {/* 転換時間アイコン */}
          <button
            onClick={() => setShowTransitionModal(true)}
            disabled={customMode || isReadOnly}
            className={`w-5 flex-shrink-0 text-xs px-1 rounded hover:bg-gray-600 transition-colors ${
              entry.transitionTime && entry.transitionTime > 0
                ? 'text-yellow-400'
                : 'text-gray-500'
            }`}
            title={entry.transitionTime && entry.transitionTime > 0 
              ? `転換時間: ${entry.transitionTime}分` 
              : '転換時間を設定'}
          >
            <Icon name="schedule" className="text-sm align-middle" />
          </button>
          <span>{entry.startTime || '-'}</span>
        </div>
      </td>
      <td className={`mode-optional-cell w-24 text-sm ${fixedCellBackground}`}><span className="mode-optional-content">{entry.endTime || '-'}</span></td>
      <td className={`mode-optional-cell w-20 text-sm ${fixedCellBackground}`}><span className="mode-optional-content">{duration}分</span></td>
      <td className={`px-4 py-3 ${fixedCellBackground}`}>
        <div className="mode-band-cell flex items-center gap-2">
          <div
            {...(dragDisabled ? {} : listeners)}
            {...(dragDisabled ? {} : attributes)}
            className={`mode-drag-handle w-5 flex-shrink-0 ${dragDisabled ? '' : 'cursor-grab active:cursor-grabbing text-emerald-400 hover:text-emerald-600'}`}
          >
            {!dragDisabled && <Icon name="drag_indicator" className="text-base align-middle" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex w-full items-center gap-2">
              {/* バンド名（ツールチップでメンバー表示） */}
              {bandMembers && bandMembers.length > 0 ? (
                <div className="group relative min-w-0 flex-1">
                  <div className={`truncate font-medium ${entry.type === 'custom' ? 'text-emerald-600' : 'text-gray-900'}`}>
                    {bandName}
                  </div>
                  {/* メンバーツールチップ */}
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-40 w-max max-w-xs">
                    <div className="bg-white border border-gray-200 rounded-lg p-2 shadow-lg">
                      <div className="text-xs text-gray-600">
                        {bandMembers.join(', ')}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`min-w-0 flex-1 truncate font-medium ${entry.type === 'custom' ? 'text-emerald-600' : 'text-gray-900'}`}>
                  {bandName}
                </div>
              )}
              {highestSeverityViolation && (
                <div 
                  ref={iconRef}
                  className="group relative ml-auto flex-shrink-0"
                  onMouseEnter={handleMouseEnter}
                >
                  <span className={violationStyle.iconColor}>
                    <Icon name={violationStyle.icon} className="text-lg align-middle" />
                  </span>
                  {/* ツールチップ（fixedポジショニングでスクロールコンテナの外に表示） */}
                  <div 
                    className="fixed hidden group-hover:block z-50 w-80"
                    style={tooltipStyle}
                  >
                    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-2xl max-h-96 overflow-y-auto">
                      <div className="text-xs font-bold mb-2 text-gray-900">
                        確認事項 ({violations.length}件)
                      </div>
                      {violations.map((violation, idx) => (
                        <div key={idx} className="text-xs text-gray-600 mb-1 break-words">
                          • {violation.message}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className={`mode-optional-cell w-20 ${fixedCellBackground}`}>
        <div className="mode-optional-content">
        <button
          onClick={onRemove}
          disabled={isReadOnly}
          className={`inline-flex h-8 w-8 items-center justify-center rounded transition-colors ${
            isReadOnly 
              ? 'cursor-not-allowed text-gray-400 opacity-50'
              : 'text-red-600 hover:bg-red-50'
          }`}
          title={isReadOnly ? 'クール直前リハーサルでは削除できません' : '削除'}
          aria-label={`${bandName}を削除`}
        >
          <Icon name="delete" className="text-xl" />
        </button>
        </div>
      </td>
      </>}
      <AnimatePresence>{customMode && customColumns.map((column, index) => renderCustomCell?.(entry, column, index))}</AnimatePresence>
    </tr>
    
    {/* 転換時間設定モーダル */}
    {showTransitionModal && !customMode && !isReadOnly && (
      <tr>
        <td colSpan={6} className="p-0">
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-bold mb-4 text-gray-900">転換時間の設定</h3>
              <p className="text-sm text-gray-500 mb-4">
                このエントリーの前に挿入される転換時間（分単位）を設定します。
              </p>
              <div className="mb-4">
                <label className="block text-sm text-gray-500 mb-2">転換時間（分）</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={transitionInput}
                  onChange={(e) => setTransitionInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded text-gray-900"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowTransitionModal(false);
                    setTransitionInput((entry.transitionTime || 0).toString());
                  }}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded text-gray-700"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    const time = parseInt(transitionInput) || 0;
                    if (onTransitionTimeChange) {
                      onTransitionTimeChange(entry.id, time);
                    }
                    setShowTransitionModal(false);
                  }}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded text-white"
                >
                  設定
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    )}
    {/* 行の後ろ（下）にドロップする場合のハイライト */}
    {isDropTargetAfter && !reserveInsertionSpace && (
      <tr className="h-1">
        <td colSpan={6} className="p-0">
          <div className="h-1 bg-emerald-500 shadow-lg shadow-emerald-500/50"></div>
        </td>
      </tr>
    )}
  </>
  );
};
