import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Icon } from '../Icon';
import type { Band, Timetable, CustomEvent } from '../../types';

// タッチ開始後180msで touchAction を 'none' に切り替えるフック。
// スクロール手振り（指が動く）が検出されたらタイマーをキャンセルし pan-y を維持。
function useLongPressDrag(delay = 180, threshold = 8) {
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const start = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    origin.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => setActive(true), delay);
  }, [delay]);

  const move = useCallback((e: React.TouchEvent) => {
    if (!timer.current) return;
    const t = e.touches[0];
    const d = Math.hypot(t.clientX - origin.current.x, t.clientY - origin.current.y);
    if (d > threshold) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [threshold]);

  const end = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setActive(false);
  }, []);

  return { active, start, move, end };
}

interface MobileBandBankProps {
  bands: Band[];
  timetableType: 'performance' | 'rehearsal';
  unifiedCoolPre?: boolean;
  onTimetableTypeChange?: (type: 'performance' | 'rehearsal') => void;
  selectedDate?: string;
  showAutomation?: boolean;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  selectedBandId: string | null;
  onSelectBand: (bandId: string | null) => void;
  customEvents: CustomEvent[];
  selectedCustomEvent: CustomEvent | null;
  onSelectCustomEvent: (event: CustomEvent | null) => void;
  onDeleteCustomEvent: (eventId: string) => void;
  onShowCreateCustomEvent: () => void;
  onAutoSchedule: () => void;
  isAutoScheduling: boolean;
  autoScheduleMessage: string | null;
  onResetAll: () => void;
  isResetting: boolean;
  resetEntryCount: number;
  onAddFixed?: (bandId: string) => void;
}

// ドラッグ可能なバンドアイテム
const DraggableBandItem = ({
  band,
  isSelected,
  onSelect,
  onAddFixed,
}: {
  band: Band;
  isSelected: boolean;
  onSelect: (bandId: string | null) => void;
  onAddFixed?: (bandId: string) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [menuOpen]);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `band-${band.id}`,
  });
  const { active: longPressed, start, move, end } = useLongPressDrag();

  const handleClick = useCallback(() => {
    if (isDragging) return;
    onSelect(isSelected ? null : band.id);
  }, [isDragging, isSelected, band.id, onSelect]);

  return (
    <div className="relative flex items-stretch gap-1">
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      onTouchStart={(e) => { start(e); listeners?.onTouchStart?.(e); }}
      onTouchMove={move}
      onTouchEnd={end}
      style={{ touchAction: longPressed ? 'none' : 'pan-y' }}
      className={`min-w-0 flex-1 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all text-left touch-manipulation ${
        isDragging
          ? 'opacity-30'
          : isSelected
            ? 'bg-emerald-500 border-2 border-emerald-600 shadow-md ring-2 ring-emerald-300'
            : 'bg-emerald-50 border border-emerald-200 active:bg-emerald-100'
      }`}
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
        isSelected ? 'bg-white text-emerald-600' : 'bg-emerald-500 text-white'
      }`}>
        {band.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{band.name}</p>
        <p className={`text-[10px] ${isSelected ? 'text-emerald-100' : 'text-gray-500'}`}>
          {band.performanceDuration}分 · {band.members.length}人
        </p>
      </div>
      {isSelected ? (
        <span className="text-[10px] text-emerald-100 font-medium flex-shrink-0">選択中</span>
      ) : (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Icon name="drag_indicator" className="text-base text-gray-300" />
        </div>
      )}
    </button>
    {onAddFixed && <div ref={menuRef} className="relative self-start"><button type="button" aria-label={`${band.name}のメニュー`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} className="rounded-lg border border-emerald-200 px-2 py-1 text-gray-600"><Icon name="more_vert" /></button>
      {menuOpen && <div className="absolute right-0 top-full z-50 mt-1 min-w-48 rounded-lg border bg-white p-1 shadow-lg"><button type="button" onClick={() => { setMenuOpen(false); onAddFixed(band.id); }} className="w-full px-2 py-2 text-left text-sm">時刻を固定して追加</button></div>}
    </div>}
    </div>
  );
};

// ドラッグ可能なカスタムイベントアイテム
const DraggableCustomEventItem = ({
  customEvent,
  isSelected,
  onSelect,
  onDelete,
}: {
  customEvent: CustomEvent;
  isSelected: boolean;
  onSelect: (event: CustomEvent | null) => void;
  onDelete: (eventId: string) => void;
}) => {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `custom-${customEvent.id}`,
  });
  const { active: longPressed, start, move, end } = useLongPressDrag();

  const handleClick = useCallback(() => {
    if (isDragging) return;
    onSelect(isSelected ? null : customEvent);
  }, [isDragging, isSelected, customEvent, onSelect]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={handleClick}
        onTouchStart={(e) => { start(e); listeners?.onTouchStart?.(e); }}
        onTouchMove={move}
        onTouchEnd={end}
        style={{ touchAction: longPressed ? 'none' : 'pan-y' }}
        className={`flex-1 flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all text-left touch-manipulation ${
          isDragging
            ? 'opacity-30'
            : isSelected
              ? 'bg-purple-500 border-2 border-purple-600 shadow-md ring-2 ring-purple-300'
              : 'bg-purple-50 border border-purple-200 active:bg-purple-100'
        }`}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isSelected ? 'bg-white text-purple-600' : 'bg-purple-500 text-white'
        }`}>
          <Icon name="star" filled className="text-sm" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{customEvent.name}</p>
          <p className={`text-[10px] ${isSelected ? 'text-purple-100' : 'text-gray-500'}`}>
            {customEvent.duration}分
          </p>
        </div>
        {isSelected ? (
          <span className="text-[10px] text-purple-100 font-medium flex-shrink-0">選択中</span>
        ) : (
          <Icon name="drag_indicator" className="text-base text-gray-300 flex-shrink-0" />
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(customEvent.id); }}
        className="p-1.5 text-gray-300 active:text-red-500 rounded flex-shrink-0"
      >
        <Icon name="close" className="text-base" />
      </button>
    </div>
  );
};

export const MobileBandBank = ({
  bands,
  timetableType,
  unifiedCoolPre = false,
  onTimetableTypeChange,
  selectedDate,
  showAutomation = true,
  performanceTimetable,
  rehearsalTimetable,
  selectedBandId,
  onSelectBand,
  customEvents,
  selectedCustomEvent,
  onSelectCustomEvent,
  onDeleteCustomEvent,
  onShowCreateCustomEvent,
  onAutoSchedule,
  isAutoScheduling,
  autoScheduleMessage,
  onResetAll,
  isResetting,
  resetEntryCount,
  onAddFixed,
}: MobileBandBankProps) => {
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;

  // 未配置バンドを計算
  const unplacedBands = useMemo(() => {
    if (!timetable) return bands;

    const placedBandIds = new Set<string>();
    timetable.dailyTimetables.forEach(dt => {
      // クール構造
      dt.cools?.forEach(cool => {
        cool.entries.forEach(entry => {
          if (entry.type === 'band' && entry.bandId) {
            placedBandIds.add(entry.bandId);
          }
        });
      });
      // フラット構造
      dt.entries?.forEach(entry => {
        if (entry.type === 'band' && entry.bandId) {
          placedBandIds.add(entry.bandId);
        }
      });
    });

    if (unifiedCoolPre && timetableType === 'rehearsal') {
      const missingIds = new Set<string>();
      const performanceDay = performanceTimetable?.dailyTimetables.find(day => day.date === selectedDate);
      const rehearsalDay = rehearsalTimetable?.dailyTimetables.find(day => day.date === selectedDate);
      performanceDay?.cools.forEach((cool, index) => {
        const placed = new Set(rehearsalDay?.cools[index]?.entries.filter(entry => entry.type === 'band').map(entry => entry.bandId));
        cool.entries.forEach(entry => {
          if (entry.type === 'band' && entry.bandId && !placed.has(entry.bandId)) missingIds.add(entry.bandId);
        });
      });
      return bands.filter(band => missingIds.has(band.id));
    }
    return bands.filter(band => !placedBandIds.has(band.id));
  }, [bands, timetable, unifiedCoolPre, timetableType, performanceTimetable, rehearsalTimetable, selectedDate]);

  const placedCount = bands.length - unplacedBands.length;

  return (
    <div className="space-y-3" data-band-bank-kind={timetableType}>
      {unifiedCoolPre && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-emerald-50 p-1" aria-label="バンドバンクの種類">
          {(['performance', 'rehearsal'] as const).map(type => (
            <button key={type} type="button" onClick={() => onTimetableTypeChange?.(type)}
              className={`rounded-md px-2 py-2 text-xs font-medium ${timetableType === type ? 'bg-emerald-600 text-white' : 'text-emerald-700'}`}>
              {type === 'performance' ? '本番バンク' : 'リハバンク'}
            </button>
          ))}
        </div>
      )}
      {(showAutomation || resetEntryCount > 0) && (
        <div className="space-y-2">
          {showAutomation && <button
            type="button"
            onClick={onAutoSchedule}
            disabled={isAutoScheduling || isResetting}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isAutoScheduling ? '配置中…' : `${timetableType === 'performance' ? '本番' : 'リハ'}の全日程を自動配置`}
          </button>}
          {resetEntryCount > 0 && (
            <button type="button" onClick={onResetAll} disabled={isAutoScheduling || isResetting}
              className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50">
              {timetableType === 'rehearsal' ? 'リハの全日程をリセット' : unifiedCoolPre ? '本番と連動リハをリセット' : '本番の全日程をリセット'}
            </button>
          )}
          {autoScheduleMessage && <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{autoScheduleMessage}</div>}
        </div>
      )}
      {/* カスタムイベントセクション */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-purple-600">カスタムイベント</span>
          <button
            onClick={onShowCreateCustomEvent}
            className="text-[10px] text-purple-500 active:text-purple-700 font-medium px-1.5 py-0.5 rounded hover:bg-purple-50"
          >
            + 新規
          </button>
        </div>
        {customEvents.length === 0 ? (
          <button
            onClick={onShowCreateCustomEvent}
            className="w-full py-2 border border-dashed border-purple-200 rounded-lg text-xs text-purple-400 active:bg-purple-50"
          >
            タップして作成
          </button>
        ) : (
          <div className="space-y-1.5">
            {customEvents.map((ce) => (
              <DraggableCustomEventItem
                key={ce.id}
                customEvent={ce}
                isSelected={selectedCustomEvent?.id === ce.id}
                onSelect={onSelectCustomEvent}
                onDelete={onDeleteCustomEvent}
              />
            ))}
          </div>
        )}
      </div>

      {/* ステータス表示 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            未配置: <span className="text-emerald-600 font-bold">{unplacedBands.length}</span>
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-xs font-medium text-gray-500">
            配置済み: <span className="text-gray-600 font-bold">{placedCount}</span>
          </span>
        </div>
      </div>

      {/* 未配置バンドリスト */}
      {unplacedBands.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-gray-400">全てのバンドが配置されています</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {unplacedBands.map((band) => (
            <DraggableBandItem
              key={band.id}
              band={band}
              isSelected={selectedBandId === band.id}
              onSelect={onSelectBand}
              onAddFixed={onAddFixed}
            />
          ))}
        </div>
      )}

      {/* 配置済みバンド（折りたたみ） */}
      {placedCount > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors list-none flex items-center gap-1">
            <Icon name="chevron_right" className="text-sm transition-transform group-open:rotate-90" />
            配置済みバンド ({placedCount})
          </summary>
          <div className="mt-2 space-y-1">
            {bands
              .filter(b => !unplacedBands.includes(b))
              .map((band) => (
                <div
                  key={band.id}
                  className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 opacity-60"
                >
                  <div className="w-6 h-6 rounded-full bg-gray-300 text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {band.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-600 truncate">{band.name}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">配置済み</span>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
};
