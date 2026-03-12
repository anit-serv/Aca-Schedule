import { useMemo, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Band, Timetable, CustomEvent } from '../../types';

interface MobileBandBankProps {
  bands: Band[];
  timetableType: 'performance' | 'rehearsal';
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  selectedBandId: string | null;
  onSelectBand: (bandId: string | null) => void;
  customEvents: CustomEvent[];
  selectedCustomEvent: CustomEvent | null;
  onSelectCustomEvent: (event: CustomEvent | null) => void;
  onDeleteCustomEvent: (eventId: string) => void;
  onShowCreateCustomEvent: () => void;
}

// ドラッグ可能なバンドアイテム
const DraggableBandItem = ({
  band,
  isSelected,
  onSelect,
}: {
  band: Band;
  isSelected: boolean;
  onSelect: (bandId: string | null) => void;
}) => {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `band-${band.id}`,
  });

  const handleClick = useCallback(() => {
    if (isDragging) return;
    onSelect(isSelected ? null : band.id);
  }, [isDragging, isSelected, band.id, onSelect]);

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      style={{ touchAction: 'none' }}
      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all text-left touch-manipulation ${
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
          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </div>
      )}
    </button>
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
        style={{ touchAction: 'none' }}
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
          ★
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
          <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        )}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(customEvent.id); }}
        className="p-1.5 text-gray-300 active:text-red-500 rounded flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export const MobileBandBank = ({
  bands,
  timetableType,
  performanceTimetable,
  rehearsalTimetable,
  selectedBandId,
  onSelectBand,
  customEvents,
  selectedCustomEvent,
  onSelectCustomEvent,
  onDeleteCustomEvent,
  onShowCreateCustomEvent,
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

    return bands.filter(band => !placedBandIds.has(band.id));
  }, [bands, timetable]);

  const placedCount = bands.length - unplacedBands.length;

  return (
    <div className="space-y-3">
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
            />
          ))}
        </div>
      )}

      {/* 配置済みバンド（折りたたみ） */}
      {placedCount > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
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
