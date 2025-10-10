import { useState, useMemo, useEffect } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, CustomEvent } from '../types';
import { CoolSection } from './CoolSection';
import { TimetableDropZone } from './TimetableDropZone';
import { BandBankDropZone } from './BandBankDropZone';
import { useCoolManagement } from '../hooks/useCoolManagement';
import { useTimetableDragDrop } from '../hooks/useTimetableDragDrop';
import { useTimetableHelpers } from '../hooks/useTimetableHelpers';

interface TimetableEditingProps {
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onPerformanceTimetableChange: (timetable: DailyTimetable) => void;
  onRehearsalTimetableChange: (timetable: DailyTimetable) => void;
}

export const TimetableEditing = ({
  bands,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onPerformanceTimetableChange,
  onRehearsalTimetableChange,
}: TimetableEditingProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [selectedDate, setSelectedDate] = useState(eventSettings.performanceDates[0] || '');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overEntryId, setOverEntryId] = useState<string | null>(null);
  const [inputCoolCount, setInputCoolCount] = useState<string>('1');
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);

  // カスタムイベントが変更されたらeventSettingsを更新
  useEffect(() => {
    // TODO: eventSettingsの更新処理をここに追加
    // 現時点ではローカルステートのみで管理
  }, [customEvents]);

  // タイムテーブルタイプが切り替わったときに日付を適切に設定
  const handleTimetableTypeChange = (newType: 'performance' | 'rehearsal') => {
    setTimetableType(newType);
    
    const dates = newType === 'performance'
      ? eventSettings.performanceDates
      : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
        ? eventSettings.performanceDates
        : eventSettings.rehearsalDates || [];
    
    if (dates.length > 0 && !dates.includes(selectedDate)) {
      setSelectedDate(dates[0]);
    }
  };

  // 現在のタイムテーブルとハンドラーを選択
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;
  const onTimetableChange = timetableType === 'performance' 
    ? onPerformanceTimetableChange 
    : onRehearsalTimetableChange;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // 現在選択されている日のタイムテーブルを取得
  const currentTimetable = useMemo(() => {
    const dailyTimetable = timetable?.dailyTimetables.find(dt => dt.date === selectedDate);
    if (!dailyTimetable) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [],
        entries: [],
      };
    }
    return dailyTimetable;
  }, [timetable, selectedDate]);

  // クール数の現在値を計算
  const coolCount = useMemo(() => {
    if (!currentTimetable.cools || currentTimetable.cools.length === 0) {
      return 1;
    }
    return currentTimetable.cools.length;
  }, [currentTimetable.cools]);

  // coolCountが変わったらinputCoolCountも同期（ただし、ユーザー入力中でない場合のみ）
  useEffect(() => {
    // 入力値が数値として同じ場合は更新しない（ユーザーが編集中の可能性）
    const currentInputValue = parseInt(inputCoolCount) || 0;
    if (currentInputValue !== coolCount) {
      setInputCoolCount(coolCount.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coolCount]); // inputCoolCountを依存配列から除外（無限ループ防止）

  // タイムテーブルヘルパーフック
  const { unplacedBands, calculateTimes } = useTimetableHelpers({
    bands,
    eventSettings,
    timetableType,
    timetable,
    performanceTimetable,
    rehearsalTimetable,
    selectedDate,
  });

  // 読み取り専用モード判定（クール直前リハーサルの場合、リハーサル編集は読み取り専用）
  const isReadOnly = timetableType === 'rehearsal' && eventSettings.rehearsalType === 'cool-pre-rehearsal';

  // すべてのエントリーIDを取得（クール間ドラッグ＆ドロップのため）
  const allEntryIds = useMemo(() => {
    if (!currentTimetable.cools || currentTimetable.cools.length === 0) {
      return currentTimetable.entries.map(e => `entry-${e.id}`);
    }
    return currentTimetable.cools.flatMap(cool => 
      cool.entries.map(e => `entry-${e.id}`)
    );
  }, [currentTimetable]);

  // クール内の時刻を再計算
  const recalculateCoolTimes = (cools: Cool[], startTime: string): Cool[] => {
    let currentTime = startTime;
    
    return cools.map((cool) => {
      const calculatedEntries = calculateTimes(cool.entries, currentTime);
      if (calculatedEntries.length > 0) {
        currentTime = calculatedEntries[calculatedEntries.length - 1].endTime!;
      }
      return {
        ...cool,
        entries: calculatedEntries,
      };
    });
  };

  // 開始時刻の変更
  const handleStartTimeChange = (newStartTime: string) => {
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      const calculatedCools = recalculateCoolTimes(currentTimetable.cools, newStartTime);
      onTimetableChange({
        ...currentTimetable,
        startTime: newStartTime,
        cools: calculatedCools,
      });
    } else {
      const calculatedEntries = calculateTimes(currentTimetable.entries, newStartTime);
      onTimetableChange({
        ...currentTimetable,
        startTime: newStartTime,
        entries: calculatedEntries,
      });
    }
  };

  // 転換時間の変更
  const handleTransitionTimeChange = (entryId: string, transitionTime: number) => {
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      const updatedCools = currentTimetable.cools.map((cool) => ({
        ...cool,
        entries: cool.entries.map((entry) =>
          entry.id === entryId ? { ...entry, transitionTime } : entry
        ),
      }));
      const calculatedCools = recalculateCoolTimes(updatedCools, currentTimetable.startTime);
      onTimetableChange({
        ...currentTimetable,
        cools: calculatedCools,
      });
    } else {
      const updatedEntries = currentTimetable.entries.map((entry) =>
        entry.id === entryId ? { ...entry, transitionTime } : entry
      );
      const calculatedEntries = calculateTimes(updatedEntries, currentTimetable.startTime);
      onTimetableChange({
        ...currentTimetable,
        entries: calculatedEntries,
      });
    }
  };

  // クール管理フック
  const {
    handleCoolCountChange,
    handleDeleteCool,
    handleMoveCoolUp,
    handleMoveCoolDown,
  } = useCoolManagement({
    timetableType,
    eventSettings,
    timetable,
    currentTimetable,
    selectedDate,
    onTimetableChange,
    calculateTimes,
  });

  // ドラッグ&ドロップフック
  const {
    handleBandDropToCool,
    handleBandDropToFlat,
    handleCustomEventDropToCool,
    handleCustomEventDropToFlat,
    handleEntryReorderInCools,
    handleEntryReorderFlat,
    handleRemoveEntry,
  } = useTimetableDragDrop({
    bands,
    customEvents,
    currentTimetable,
    onTimetableChange,
    calculateTimes,
    recalculateCoolTimes,
    isReadOnly,
  });

  // カスタムイベント管理
  const handleAddCustomEvent = (customEvent: Omit<CustomEvent, 'id'>) => {
    const newEvent: CustomEvent = {
      id: crypto.randomUUID(),
      ...customEvent,
    };
    setCustomEvents([...customEvents, newEvent]);
  };

  const handleDeleteCustomEvent = (id: string) => {
    setCustomEvents(customEvents.filter((e) => e.id !== id));
  };

  // ドラッグ開始
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  // ドラッグ中
  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    
    if (over && (over.id as string).startsWith('entry-')) {
      setOverEntryId(over.id as string);
    } else {
      setOverEntryId(null);
    }
  };

  // ドラッグ終了
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setOverEntryId(null);

    const activeId = active.id as string;

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      if (!over) return;
      
      const overId = over.id as string;
      
      if (!overId.startsWith('entry-') && !overId.startsWith('cool-droppable-') && overId !== 'timetable-droppable') {
        return;
      }

      const bandId = activeId.replace('band-', '');
      const band = bands.find((b) => b.id === bandId);
      if (!band) return;

      // クール分けされている場合
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleBandDropToCool(bandId, overId);
      } else {
        handleBandDropToFlat(bandId, overId);
      }
      return;
    }

    // カスタムイベントをタイムテーブルへ追加
    if (activeId.startsWith('custom-')) {
      if (!over) return;
      
      const overId = over.id as string;
      
      if (!overId.startsWith('entry-') && !overId.startsWith('cool-droppable-') && overId !== 'timetable-droppable') {
        return;
      }

      const customEventId = activeId.replace('custom-', '');
      const customEvent = customEvents.find((ce) => ce.id === customEventId);
      if (!customEvent) return;

      // クール分けされている場合
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleCustomEventDropToCool(customEventId, overId);
      } else {
        handleCustomEventDropToFlat(customEventId, overId);
      }
      return;
    }

    // タイムテーブル内での並び替え
    if (!over) return;
    
    const overId = over.id as string;
    
    if (activeId.startsWith('entry-') && overId.startsWith('entry-')) {
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleEntryReorderInCools(activeId, overId);
      } else {
        handleEntryReorderFlat(activeId, overId);
      }
    }
  };

  // ドラッグ中のアイテムを取得
  const activeBand = activeDragId?.startsWith('band-')
    ? bands.find((b) => `band-${b.id}` === activeDragId)
    : null;

  const activeEntry = activeDragId?.startsWith('entry-')
    ? currentTimetable.entries.find((e) => `entry-${e.id}` === activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {/* タイムテーブルタイプ選択タブ */}
        <div className="flex gap-2 border-b border-gray-700">
          <button
            onClick={() => handleTimetableTypeChange('performance')}
            className={`px-6 py-3 font-medium transition-colors ${
              timetableType === 'performance'
                ? 'border-b-2 border-blue-500 text-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            本番用
          </button>
          <button
            onClick={() => handleTimetableTypeChange('rehearsal')}
            className={`px-6 py-3 font-medium transition-colors ${
              timetableType === 'rehearsal'
                ? 'border-b-2 border-blue-500 text-blue-500'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            リハ用
          </button>
        </div>

        {/* 日付選択タブ */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(timetableType === 'performance' 
              ? eventSettings.performanceDates 
              : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
                ? eventSettings.performanceDates
                : eventSettings.rehearsalDates || []
          ).sort().map((date) => {
            const dateObj = new Date(date);
            const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`px-4 py-2 rounded-md whitespace-nowrap transition-colors ${
                  selectedDate === date
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {formattedDate}
              </button>
            );
          })}
        </div>

        {/* メインコンテンツエリア */}
        <div className="flex h-[calc(100vh-14rem)] gap-4">
          {/* 中央ペイン: タイムテーブル */}
          <div className="flex-1 bg-gray-800 rounded-lg p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">タイムテーブル</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400">開始時刻:</label>
                  <input
                    type="time"
                    value={currentTimetable.startTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-400">クール数:</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={inputCoolCount}
                    onChange={(e) => setInputCoolCount(e.target.value)}
                    onBlur={(e) => {
                      const newCount = parseInt(e.target.value) || 1;
                      handleCoolCountChange(newCount);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const newCount = parseInt(inputCoolCount) || 1;
                        handleCoolCountChange(newCount);
                        e.currentTarget.blur();
                      }
                    }}
                    disabled={isReadOnly}
                    className={`w-16 px-2 py-1 border rounded text-sm ${
                      isReadOnly 
                        ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed' 
                        : 'bg-gray-700 border-gray-600 text-white'
                    }`}
                    title={isReadOnly ? 'クール直前リハーサルではクール数を変更できません' : ''}
                  />
                </div>
              </div>
            </div>

            {/* タイムテーブル表示 */}
            {currentTimetable.cools && currentTimetable.cools.length > 0 ? (
              <SortableContext
                items={allEntryIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-6">
                  {currentTimetable.cools.map((cool, coolIndex) => (
                    <CoolSection
                      key={cool.id}
                      cool={cool}
                      coolIndex={coolIndex}
                      totalCools={currentTimetable.cools!.length}
                      bands={bands}
                      overEntryId={overEntryId}
                      onRemoveEntry={(entryId) => handleRemoveEntry(entryId, coolIndex)}
                      onDeleteCool={handleDeleteCool}
                      onMoveCoolUp={handleMoveCoolUp}
                      onMoveCoolDown={handleMoveCoolDown}
                      isReadOnly={isReadOnly}
                      onTransitionTimeChange={handleTransitionTimeChange}
                    />
                  ))}
                </div>
              </SortableContext>
            ) : (
              <TimetableDropZone
                entries={currentTimetable.entries}
                bands={bands}
                overEntryId={overEntryId}
                onRemoveEntry={handleRemoveEntry}
                onTransitionTimeChange={handleTransitionTimeChange}
              />
            )}
          </div>

          {/* 右ペイン: バンドバンク */}
          <BandBankDropZone 
            unplacedBands={unplacedBands} 
            timetableType={timetableType}
            rehearsalDuration={eventSettings.rehearsalDuration}
            customEvents={customEvents}
            onAddCustomEvent={handleAddCustomEvent}
            onDeleteCustomEvent={handleDeleteCustomEvent}
          />
        </div>
      </div>

      {/* ドラッグオーバーレイ */}
      <DragOverlay>
        {activeBand && (
          <div className="bg-blue-600 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">{activeBand.name}</div>
            <div className="text-sm">{activeBand.performanceDuration}分</div>
          </div>
        )}
        {activeEntry && (
          <div className="bg-gray-700 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">
              {activeEntry.bandId
                ? bands.find((b) => b.id === activeEntry.bandId)?.name
                : activeEntry.customEvent?.name}
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};
