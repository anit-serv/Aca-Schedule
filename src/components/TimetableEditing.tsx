import { useState, useMemo, useEffect } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Band, EventSettings, Timetable, DailyTimetable, CustomEvent } from '../types';
import { TimetableDragOverlay } from './TimetableDragOverlay';
import { ViolationPanel } from './ViolationPanel';
import { TimetableContextBar } from './TimetableContextBar';
import { TimetableContent } from './TimetableContent';
import { BandBankDropZone } from './BandBankDropZone';
import { useCoolManagement } from '../hooks/useCoolManagement';
import { useTimetableDragDrop } from '../hooks/useTimetableDragDrop';
import { useTimetableHelpers } from '../hooks/useTimetableHelpers';
import { useConstraintCheck } from '../hooks/useConstraintCheck';
import { useDragHandlers } from '../hooks/useDragHandlers';
import { createTimetableCollisionDetection } from '../utils/timetableCollisionDetection';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';
import { eventService } from '../services/firestore';

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
  const [inputCoolCount, setInputCoolCount] = useState<string>('1');
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);
  const [isViolationPanelOpen, setIsViolationPanelOpen] = useState(false);

  // カスタムイベントが変更されたらFirestoreのeventSettingsを更新
  useEffect(() => {
    const updateCustomEvents = async () => {
      try {
        await eventService.updateEvent(eventSettings.id, {
          customEvents: customEvents,
        });
        console.log('カスタムイベントを保存しました:', customEvents);
      } catch (error) {
        console.error('カスタムイベントの保存に失敗しました:', error);
      }
    };

    // 初回レンダリング時は更新しない（eventSettings.customEventsと同じ内容のため）
    if (JSON.stringify(customEvents) !== JSON.stringify(eventSettings.customEvents || [])) {
      updateCustomEvents();
    }
  }, [customEvents, eventSettings.id, eventSettings.customEvents]);


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

  // カスタム衝突検出を作成
  const customCollisionDetection = useMemo(
    () => createTimetableCollisionDetection(),
    []
  );

  // 現在選択されている日のタイムテーブルを取得
  const currentTimetable = useMemo(() => {
    const dailyTimetable = timetable?.dailyTimetables.find(dt => dt.date === selectedDate);
    if (!dailyTimetable) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [{
          id: `cool-1-${selectedDate}`,
          number: 1,
          entries: [],
        }],
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
    const currentInputValue = parseInt(inputCoolCount) || 1;
    if (currentInputValue !== coolCount) {
      setInputCoolCount(coolCount.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coolCount]); // inputCoolCountを依存配列から除外（無限ループ防止）

  // タイムテーブルヘルパーフック
  const { unplacedBands, calculateTimes, recalculateTimes } = useTimetableHelpers({
    bands,
    eventSettings,
    timetableType,
    timetable,
    performanceTimetable,
    rehearsalTimetable,
    selectedDate,
  });

  // バンド番号の計算（本番/リハごとに、日付をまたいで連番）
  const bandNumbers = useMemo(() => calculateBandNumbers(timetable), [timetable]);

  // 制約チェック（bandNumbersを使用するため、この順序が必要）
  const violations = useConstraintCheck(currentTimetable, bands, bandNumbers);

  // 読み取り専用モード判定（クール直前リハーサルの場合、リハーサル編集は読み取り専用）
  const isReadOnly = timetableType === 'rehearsal' && eventSettings.rehearsalType === 'cool-pre-rehearsal';

  // バンドの演奏時間が変更されたら、タイムテーブルの時刻を再計算
  // または日付が切り替わったときも再計算
  useEffect(() => {
    if (!currentTimetable || !bands || bands.length === 0) return;
    
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      // クール構造の場合
      const updatedCools = recalculateTimes(currentTimetable.cools, currentTimetable.startTime);
      if (JSON.stringify(updatedCools) !== JSON.stringify(currentTimetable.cools)) {
        onTimetableChange({
          ...currentTimetable,
          cools: updatedCools,
        });
      }
    } else {
      // フラット構造の場合
      const updatedEntries = calculateTimes(currentTimetable.entries, currentTimetable.startTime);
      if (JSON.stringify(updatedEntries) !== JSON.stringify(currentTimetable.entries)) {
        onTimetableChange({
          ...currentTimetable,
          entries: updatedEntries,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, selectedDate]); // bandsの変更と日付の切り替えを監視


  // 開始時刻の変更
  const handleStartTimeChange = (newStartTime: string) => {
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      const calculatedCools = recalculateTimes(currentTimetable.cools, newStartTime);
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
      const calculatedCools = recalculateTimes(updatedCools, currentTimetable.startTime);
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

  // クール開始時刻の変更
  const handleCoolStartTimeChange = (coolIndex: number, startTime: string | undefined) => {
    if (!currentTimetable.cools || currentTimetable.cools.length === 0) return;

    const updatedCools = currentTimetable.cools.map((cool, index) => {
      if (index === coolIndex) {
        // startTimeがundefinedの場合、プロパティ自体を削除
        if (startTime === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { startTime: _, ...coolWithoutStartTime } = cool;
          return coolWithoutStartTime;
        }
        return { ...cool, startTime };
      }
      return cool;
    });

    const calculatedCools = recalculateTimes(updatedCools, currentTimetable.startTime);
    
    onTimetableChange({
      ...currentTimetable,
      cools: calculatedCools,
    });
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
    recalculateTimes,
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
    recalculateCoolTimes: recalculateTimes,
    isReadOnly,
  });

  // ドラッグハンドラー
  const {
    overEntryId,
    dropSucceeded,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    getActiveItems,
  } = useDragHandlers({
    bands,
    customEvents,
    currentTimetable,
    onBandDropToCool: handleBandDropToCool,
    onBandDropToFlat: handleBandDropToFlat,
    onCustomEventDropToCool: handleCustomEventDropToCool,
    onCustomEventDropToFlat: handleCustomEventDropToFlat,
    onEntryReorderInCools: handleEntryReorderInCools,
    onEntryReorderFlat: handleEntryReorderFlat,
  });

  // アクティブアイテム取得
  const { activeBand, activeCustomEvent, activeEntry } = getActiveItems();

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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      autoScroll={{
        threshold: {
          x: 0, // 横スクロールは無効
          y: 0.15, // 画面端から15%の範囲でスクロール開始
        },
        acceleration: 5, // スクロール速度（デフォルトは10、少し遅めに）
      }}
    >
      <div className="flex flex-col h-full">
        {/* コンテキストバー */}
        <TimetableContextBar
          timetableType={timetableType}
          selectedDate={selectedDate}
          eventSettings={eventSettings}
          currentTimetable={currentTimetable}
          inputCoolCount={inputCoolCount}
          isReadOnly={isReadOnly}
          onTimetableTypeChange={handleTimetableTypeChange}
          onDateChange={setSelectedDate}
          onStartTimeChange={handleStartTimeChange}
          onCoolCountChange={handleCoolCountChange}
          onCoolCountInputChange={setInputCoolCount}
        />

        {/* メインコンテンツエリア */}
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-4">
          <div className="flex gap-4 h-full relative">
            {/* 制約違反サマリーパネル - スライドメニュー */}
            <ViolationPanel
              violations={violations}
              isOpen={isViolationPanelOpen}
              onToggle={() => setIsViolationPanelOpen(!isViolationPanelOpen)}
            />
          
          {/* タイムテーブルとバンドバンクのコンテナ */}
          <div className="flex gap-4 flex-1 min-w-0 ml-9">
            {/* 中央ペイン: タイムテーブル */}
            <TimetableContent
              currentTimetable={currentTimetable}
              bands={bands}
              overEntryId={overEntryId}
              violations={violations}
              bandNumbers={bandNumbers}
              isReadOnly={isReadOnly}
              onRemoveEntry={handleRemoveEntry}
              onDeleteCool={handleDeleteCool}
              onMoveCoolUp={handleMoveCoolUp}
              onMoveCoolDown={handleMoveCoolDown}
              onTransitionTimeChange={handleTransitionTimeChange}
              onCoolStartTimeChange={handleCoolStartTimeChange}
            />

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
        </div>

      {/* ドラッグオーバーレイ */}
      <TimetableDragOverlay
        activeBand={activeBand}
        activeCustomEvent={activeCustomEvent}
        activeEntry={activeEntry}
        bands={bands}
        dropSucceeded={dropSucceeded}
      />
      </div>
    </DndContext>
  );
};
