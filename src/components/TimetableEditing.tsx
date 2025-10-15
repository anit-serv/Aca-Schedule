import { useState, useMemo, useEffect } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  PointerSensor,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  type CollisionDetection,
  pointerWithin,
} from '@dnd-kit/core';
import type { Band, EventSettings, Timetable, DailyTimetable, CustomEvent } from '../types';
import { CoolSection } from './CoolSection';
import { TimetableDropZone } from './TimetableDropZone';
import { BandBankDropZone } from './BandBankDropZone';
import { CoolGapDropZone } from './CoolGapDropZone';
import { useCoolManagement } from '../hooks/useCoolManagement';
import { useTimetableDragDrop } from '../hooks/useTimetableDragDrop';
import { useTimetableHelpers } from '../hooks/useTimetableHelpers';
import { useConstraintCheck } from '../hooks/useConstraintCheck';

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
  const [isViolationPanelOpen, setIsViolationPanelOpen] = useState(false);
  const [dropSucceeded, setDropSucceeded] = useState(false);
  const [currentMouseY, setCurrentMouseY] = useState<number>(0);

  // バンドバンクからのドラッグの場合のみマウス位置をトラッキング
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (activeDragId && (activeDragId.startsWith('band-') || activeDragId.startsWith('custom-'))) {
        setCurrentMouseY(e.clientY);
      }
    };

    if (activeDragId) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }
  }, [activeDragId]);

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

  // カスタム衝突検出: タイムテーブル関連とバンドバンクのみを検出
  const customCollisionDetection: CollisionDetection = (args) => {
    // まずpointerWithinで正確なポインタ位置を使った衝突を検出
    const pointerCollisions = pointerWithin(args);
    
    // ドロップ可能な要素のIDパターン
    const validDropTargetPatterns = [
      /^entry-/,                    // エントリーの前
      /^cool-droppable-/,          // クールの最後
      /^cool-header-/,             // クールのヘッダー（先頭に追加）
      /^cool-column-header-/,      // 列ヘッダー（先頭に追加）
      /^cool-gap-before-/,         // クールの前のギャップ
      /^cool-gap-after-/,          // クールの後のギャップ
      /^timetable-droppable$/,     // フラット構造の空タイムテーブル
      /^band-bank-droppable$/,     // バンドバンク（キャンセル用）
    ];
    
    // パターンに一致するもののみを返す（上半分・下半分の判定は後で行う）
    return pointerCollisions.filter(collision => {
      const id = String(collision.id);
      return validDropTargetPatterns.some(pattern => pattern.test(id));
    });
  };

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
  const bandNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    
    if (!timetable) return numbers;
    
    let bandCounter = 1;
    
    // 全ての日付のタイムテーブルを順番に処理
    timetable.dailyTimetables
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(dailyTimetable => {
        if (dailyTimetable.cools && dailyTimetable.cools.length > 0) {
          // クール構造の場合
          dailyTimetable.cools.forEach(cool => {
            cool.entries.forEach(entry => {
              if (entry.type === 'band') {
                numbers.set(entry.id, bandCounter++);
              }
            });
          });
        } else {
          // フラット構造の場合
          dailyTimetable.entries.forEach(entry => {
            if (entry.type === 'band') {
              numbers.set(entry.id, bandCounter++);
            }
          });
        }
      });
    
    return numbers;
  }, [timetable]);

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
    setDropSucceeded(false); // ドラッグ開始時にリセット
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
        
        // バンドバンクからのドラッグの場合：マウス位置で判定
        if (activeId.startsWith('band-') || activeId.startsWith('custom-')) {
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
        } 
        // タイムテーブル内での並び替えの場合：要素の中心位置で判定
        else if (activeId.startsWith('entry-')) {
          const activeRect = active.rect.current.translated;
          
          if (overRect && activeRect) {
            const activeCenter = activeRect.top + activeRect.height / 2;
            const overCenter = overRect.top + overRect.height / 2;
            
            if (activeCenter > overCenter) {
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
        overId.startsWith('cool-gap-after-')
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
    setActiveDragId(null);
    setOverEntryId(null);
    setCurrentMouseY(0);

    const activeId = active.id as string;
    
    // デバッグ: ドロップ先のIDをコンソールに出力
    console.log('Drag ended:', { activeId, overId: over?.id });

    // バンドバンクからタイムテーブルへの追加
    if (activeId.startsWith('band-')) {
      // ドロップ先がない、またはバンドバンクの場合はキャンセル
      if (!over) return;
      
      const overId = over.id as string;
      
      // バンドバンクへのドロップはキャンセル
      if (overId === 'band-bank-droppable') return;
      
      // タイムテーブル関連のIDのみ許可
      // - entry-*: 既存エントリーの前に挿入
      // - cool-droppable-*: クールの最後に追加
      // - cool-header-*: クールのヘッダー（そのクールの最初に追加）
      // - cool-column-header-*: 列ヘッダー（そのクールの最初に追加）
      // - cool-gap-before-*: クールの前のギャップ（そのクールの最初に追加）
      // - cool-gap-after-*: クールの後のギャップ（そのクールの最後に追加）
      // - timetable-droppable: フラット構造の空タイムテーブルに追加
      const isValidDropTarget = 
        overId.startsWith('entry-') || 
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        (overId === 'timetable-droppable' && (!currentTimetable.cools || currentTimetable.cools.length === 0) && currentTimetable.entries.length === 0);
      
      if (!isValidDropTarget) return;

      const bandId = activeId.replace('band-', '');
      const band = bands.find((b) => b.id === bandId);
      if (!band) return;

      // ドロップ成功
      setDropSucceeded(true);

      // クールヘッダー、列ヘッダー、またはギャップにドロップした場合の変換
      // handleDragOverと同じロジックで変換
      let targetDropId = overId;
      
      // cool-droppableまたはcool-gap-afterの場合、そのクールの最後のエントリーの後に変換
      if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool && cool.entries.length > 0) {
          const lastEntry = cool.entries[cool.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        } else {
          // 空のクールの場合はそのまま
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId.startsWith('cool-header-') || overId.startsWith('cool-column-header-') || overId.startsWith('cool-gap-before-')) {
        // クールヘッダー、列ヘッダー、またはクールの前のギャップにドロップ → そのクールの最初のエントリーの前
        const coolIndex = parseInt(overId.replace(/^cool-(header|column-header|gap-before)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool.entries.length > 0) {
          targetDropId = `entry-${cool.entries[0].id}`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      }

      // クール分けされている場合
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleBandDropToCool(bandId, targetDropId);
      } else {
        handleBandDropToFlat(bandId, targetDropId);
      }
      return;
    }

    // カスタムイベントをタイムテーブルへ追加
    if (activeId.startsWith('custom-')) {
      // ドロップ先がない、またはバンドバンクの場合はキャンセル
      if (!over) return;
      
      const overId = over.id as string;
      
      // バンドバンクへのドロップはキャンセル
      if (overId === 'band-bank-droppable') return;
      
      // タイムテーブル関連のIDのみ許可
      const isValidDropTarget = 
        overId.startsWith('entry-') || 
        overId.startsWith('cool-droppable-') ||
        overId.startsWith('cool-header-') ||
        overId.startsWith('cool-column-header-') ||
        overId.startsWith('cool-gap-before-') ||
        overId.startsWith('cool-gap-after-') ||
        (overId === 'timetable-droppable' && (!currentTimetable.cools || currentTimetable.cools.length === 0) && currentTimetable.entries.length === 0);
      
      if (!isValidDropTarget) return;

      const customEventId = activeId.replace('custom-', '');
      const customEvent = customEvents.find((ce) => ce.id === customEventId);
      if (!customEvent) return;

      // ドロップ成功
      setDropSucceeded(true);

      // クールヘッダー、列ヘッダー、またはギャップにドロップした場合の変換
      // handleDragOverと同じロジックで変換
      let targetDropId = overId;
      
      // cool-droppableまたはcool-gap-afterの場合、そのクールの最後のエントリーの後に変換
      if (overId.startsWith('cool-droppable-') || overId.startsWith('cool-gap-after-')) {
        const coolIndex = parseInt(overId.replace(/^cool-(droppable|gap-after)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool && cool.entries.length > 0) {
          const lastEntry = cool.entries[cool.entries.length - 1];
          targetDropId = `entry-${lastEntry.id}-after`;
        } else {
          // 空のクールの場合はそのまま
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      } else if (overId.startsWith('cool-header-') || overId.startsWith('cool-column-header-') || overId.startsWith('cool-gap-before-')) {
        // クールヘッダー、列ヘッダー、またはクールの前のギャップにドロップ → そのクールの最初のエントリーの前
        const coolIndex = parseInt(overId.replace(/^cool-(header|column-header|gap-before)-/, ''));
        const cool = currentTimetable.cools![coolIndex];
        if (cool.entries.length > 0) {
          targetDropId = `entry-${cool.entries[0].id}`;
        } else {
          targetDropId = `cool-droppable-${coolIndex}`;
        }
      }

      // クール分けされている場合
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleCustomEventDropToCool(customEventId, targetDropId);
      } else {
        handleCustomEventDropToFlat(customEventId, targetDropId);
      }
      return;
    }

    // タイムテーブル内での並び替え
    if (!over) return;
    
    // overEntryIdを使用して、-afterサフィックスを反映
    const targetId = overEntryId || (over.id as string);
    
    if (activeId.startsWith('entry-') && targetId.startsWith('entry-')) {
      if (currentTimetable.cools && currentTimetable.cools.length > 0) {
        handleEntryReorderInCools(activeId, targetId);
      } else {
        handleEntryReorderFlat(activeId, targetId);
      }
    }
  };

  // ドラッグ中のアイテムを取得
  const activeBand = activeDragId?.startsWith('band-')
    ? bands.find((b) => `band-${b.id}` === activeDragId)
    : null;

  const activeCustomEvent = activeDragId?.startsWith('custom-')
    ? customEvents.find((ce) => `custom-${ce.id}` === activeDragId)
    : null;

  const activeEntry = activeDragId?.startsWith('entry-')
    ? currentTimetable.entries.find((e) => `entry-${e.id}` === activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      autoScroll={false}
    >
      <div className="flex flex-col h-full">
        {/* コンテキストバー */}
        <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-6 py-3">
          <div className="flex items-center justify-between gap-6">
            {/* 左側: タイムテーブルタイプ選択（セグメントコントロール）と日付選択 */}
            <div className="flex items-center gap-4 flex-1">
              {/* セグメントコントロール（本番用/リハ用） */}
              <div className="inline-flex bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => handleTimetableTypeChange('performance')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    timetableType === 'performance'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  本番用
                </button>
                <button
                  onClick={() => handleTimetableTypeChange('rehearsal')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    timetableType === 'rehearsal'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  リハ用
                </button>
              </div>

              {/* 日付選択ボタン */}
              <div className="flex gap-2 overflow-x-auto">
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
                      className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
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
            </div>

            {/* 右側: 開始時刻とクール数 */}
            <div className="flex items-center gap-4">
              {/* 開始時刻 */}
              <div className="flex items-center gap-2">
                <label htmlFor="startTime" className="text-sm text-gray-400 whitespace-nowrap">
                  開始時刻:
                </label>
                <input
                  id="startTime"
                  type="time"
                  value={currentTimetable.startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm"
                />
              </div>

              {/* クール数 */}
              <div className="flex items-center gap-2">
                <label htmlFor="coolCount" className="text-sm text-gray-400 whitespace-nowrap">
                  クール数:
                </label>
                <input
                  id="coolCount"
                  type="number"
                  min="0"
                  max="20"
                  value={inputCoolCount}
                  onChange={(e) => setInputCoolCount(e.target.value)}
                  onBlur={() => handleCoolCountChange(Number(inputCoolCount))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCoolCountChange(Number(inputCoolCount));
                    }
                  }}
                  disabled={isReadOnly}
                  className={`w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-center ${
                    isReadOnly ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* メインコンテンツエリア */}
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-4">
          <div className="flex gap-4 h-full relative">
            {/* 制約違反サマリーパネル - スライドメニュー */}
            {violations.length > 0 && (
              <>
                {/* スライドパネル */}
                <div 
                  className={`fixed left-0 bg-gray-800 rounded-r-lg p-4 overflow-y-auto shadow-xl border-r border-t border-b border-gray-700 transition-transform duration-300 ease-in-out z-30 ${
                    isViolationPanelOpen ? 'translate-x-0' : '-translate-x-full'
                  }`}
                  style={{ 
                    width: '320px',
                    top: '8.5rem', // グローバルヘッダー(4rem) + コンテキストバー(約4.5rem)
                    height: 'calc(100vh - 8.5rem - 1.5rem)' // 画面高さ - 上部 - 下部マージン
                  }}
                >
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2 whitespace-nowrap">
                  <span className="text-yellow-400">⚠️</span>
                  制約違反 ({(() => {
                    const uniqueViolations = new Map<string, typeof violations[0]>();
                    violations.forEach(v => {
                      if (v.type === 'duplicate-in-cool') {
                        const baseId = v.id.replace(/-ref-.*$/, '');
                        if (!v.id.includes('-ref-')) {
                          uniqueViolations.set(baseId, v);
                        }
                      } else if (v.type === 'consecutive-performance') {
                        const baseId = v.id.replace(/-ref$/, '');
                        if (!v.id.includes('-ref')) {
                          uniqueViolations.set(baseId, v);
                        }
                      } else {
                        uniqueViolations.set(v.id, v);
                      }
                    });
                    return uniqueViolations.size;
                  })()}件)
                </h3>
                <div className="space-y-2">
                {(() => {
                  // 一意の違反のみを抽出
                  const uniqueViolations = new Map<string, typeof violations[0]>();
                  violations.forEach(v => {
                    if (v.type === 'duplicate-in-cool') {
                      const baseId = v.id.replace(/-ref-.*$/, '');
                      if (!v.id.includes('-ref-')) {
                        uniqueViolations.set(baseId, v);
                      }
                    } else if (v.type === 'consecutive-performance') {
                      const baseId = v.id.replace(/-ref$/, '');
                      if (!v.id.includes('-ref')) {
                        uniqueViolations.set(baseId, v);
                      }
                    } else {
                      uniqueViolations.set(v.id, v);
                    }
                  });
                  
                  const uniqueList = Array.from(uniqueViolations.values());
                  const highViolations = uniqueList.filter(v => v.severity === 'high');
                  const mediumViolations = uniqueList.filter(v => v.severity === 'medium');
                  const lowViolations = uniqueList.filter(v => v.severity === 'low');
                  
                  return (
                    <>
                      {highViolations.length > 0 && (
                        <div className="bg-red-900/30 border border-red-700 rounded p-3">
                          <div className="text-sm font-bold text-red-400 mb-2 flex items-center gap-1">
                            <span>🚫</span> 重大 ({highViolations.length}件)
                          </div>
                          {highViolations.map((v, idx) => (
                            <div key={idx} className="text-xs text-gray-300 mb-1">
                              • {v.message}
                            </div>
                          ))}
                        </div>
                      )}
                      {mediumViolations.length > 0 && (
                        <div className="bg-yellow-900/30 border border-yellow-700 rounded p-3">
                          <div className="text-sm font-bold text-yellow-400 mb-2 flex items-center gap-1">
                            <span>⚠️</span> 警告 ({mediumViolations.length}件)
                          </div>
                          {mediumViolations.map((v, idx) => (
                            <div key={idx} className="text-xs text-gray-300 mb-1">
                              • {v.message}
                            </div>
                          ))}
                        </div>
                      )}
                      {lowViolations.length > 0 && (
                        <div className="bg-blue-900/30 border border-blue-700 rounded p-3">
                          <div className="text-sm font-bold text-blue-400 mb-2 flex items-center gap-1">
                            <span>ℹ️</span> 情報 ({lowViolations.length}件)
                          </div>
                          {lowViolations.map((v, idx) => (
                            <div key={idx} className="text-xs text-gray-300 mb-1">
                              • {v.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              </div>
              
              {/* 取っ手部分 - パネル右上に小さく配置 */}
              <button
                onClick={() => setIsViolationPanelOpen(!isViolationPanelOpen)}
                className={`fixed bg-yellow-900/70 hover:bg-yellow-900/90 transition-all duration-300 ease-in-out rounded-r-lg shadow-lg border-r-2 border-t-2 border-b-2 border-yellow-700 z-30 ${
                  isViolationPanelOpen ? 'left-[320px]' : 'left-0'
                }`}
                style={{ 
                  top: '9rem' // グローバルヘッダー + コンテキストバー + 少しマージン
                }}
                title={isViolationPanelOpen ? "制約違反を閉じる" : "制約違反を表示"}
              >
                <div className="px-1.5 py-2 flex flex-col items-center gap-1">
                  <span className="text-base">⚠️</span>
                  <span className="text-[10px] font-bold text-yellow-400">{(() => {
                    const uniqueViolations = new Map<string, typeof violations[0]>();
                    violations.forEach(v => {
                      if (v.type === 'duplicate-in-cool') {
                        const baseId = v.id.replace(/-ref-.*$/, '');
                        if (!v.id.includes('-ref-')) {
                          uniqueViolations.set(baseId, v);
                        }
                      } else if (v.type === 'consecutive-performance') {
                        const baseId = v.id.replace(/-ref$/, '');
                        if (!v.id.includes('-ref')) {
                          uniqueViolations.set(baseId, v);
                        }
                      } else {
                        uniqueViolations.set(v.id, v);
                      }
                    });
                    return uniqueViolations.size;
                  })()}</span>
                </div>
              </button>
            </>
          )}
          
          {/* タイムテーブルとバンドバンクのコンテナ */}
          <div className="flex gap-4 flex-1 min-w-0" style={{ marginLeft: violations.length > 0 ? '36px' : '0' }}>
            {/* 中央ペイン: タイムテーブル（上下のパディングを削除、左右は維持） */}
            <div className="flex-1 bg-gray-800 rounded-lg px-6 overflow-y-auto min-w-0">
              {/* タイムテーブル表示 */}
              <div>
              {currentTimetable.cools && currentTimetable.cools.length > 0 ? (
                <div>
                  {currentTimetable.cools.map((cool, coolIndex) => {
                    // 前のクールの終了時刻を取得（デフォルト値として使用）
                    // 第1クールの場合は本番/リハーサル開始時刻を使用
                    const previousCoolEndTime = coolIndex > 0
                      ? (() => {
                          const prevCool = currentTimetable.cools![coolIndex - 1];
                          if (prevCool.entries.length > 0) {
                            const lastEntry = prevCool.entries[prevCool.entries.length - 1];
                            return lastEntry.endTime;
                          }
                          return undefined;
                        })()
                      : currentTimetable.startTime; // 第1クールの場合は開始時刻を使用

                    // 次のクールの開始時刻を取得（警告表示用）
                    const nextCoolStartTime = coolIndex < currentTimetable.cools!.length - 1
                      ? currentTimetable.cools![coolIndex + 1].startTime
                      : undefined;

                    const isFirstCool = coolIndex === 0;
                    const isLastCool = coolIndex === currentTimetable.cools!.length - 1;

                    return (
                      <div key={cool.id}>
                        {/* クールの前のギャップ（最初のクールのみ、上部パディング付き） */}
                        {isFirstCool && (
                          <div className="pt-6">
                            <CoolGapDropZone
                              id={`cool-gap-before-${coolIndex}`}
                            />
                          </div>
                        )}

                        <CoolSection
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
                          onCoolStartTimeChange={handleCoolStartTimeChange}
                          previousCoolEndTime={previousCoolEndTime}
                          nextCoolStartTime={nextCoolStartTime}
                          dailyStartTime={currentTimetable.startTime}
                          violations={violations.filter(v => v.coolId === cool.id)}
                          bandNumbers={bandNumbers}
                        />

                        {/* クールの後のギャップ */}
                        {!isLastCool ? (
                          <CoolGapDropZone
                            id={`cool-gap-after-${coolIndex}`}
                          />
                        ) : (
                          <div className="pb-6">
                            <CoolGapDropZone
                              id={`cool-gap-after-${coolIndex}`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            ) : (
              <TimetableDropZone
                entries={currentTimetable.entries}
                bands={bands}
                overEntryId={overEntryId}
                onRemoveEntry={handleRemoveEntry}
                onTransitionTimeChange={handleTransitionTimeChange}
                violations={violations}
                bandNumbers={bandNumbers}
              />
            )}
              </div>
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
        </div>

      {/* ドラッグオーバーレイ */}
      <DragOverlay
        dropAnimation={
          dropSucceeded
            ? null // ドロップ成功時はアニメーションなし
            : {
                duration: 250,
                easing: 'ease',
                sideEffects: defaultDropAnimationSideEffects({
                  styles: {
                    active: {
                      opacity: '0.5',
                    },
                  },
                }),
              }
        }
      >
        {activeBand && (
          <div className="bg-blue-600 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">{activeBand.name}</div>
            <div className="text-sm">{activeBand.performanceDuration}分</div>
          </div>
        )}
        {activeCustomEvent && (
          <div className="bg-purple-600 text-white px-4 py-3 rounded shadow-lg">
            <div className="font-semibold">{activeCustomEvent.name}</div>
            <div className="text-sm">{activeCustomEvent.duration}分</div>
          </div>
        )}
        {activeEntry && (
          <div className="bg-gray-700 text-white px-4 py-3 rounded shadow-lg min-w-[300px]">
            {activeEntry.type === 'band' && activeEntry.bandId ? (
              <>
                <div className="font-semibold">
                  {bands.find((b) => b.id === activeEntry.bandId)?.name || '(不明)'}
                </div>
                <div className="text-sm text-gray-300">
                  {bands.find((b) => b.id === activeEntry.bandId)?.performanceDuration || 0}分
                </div>
              </>
            ) : activeEntry.type === 'custom' && activeEntry.customEvent ? (
              <>
                <div className="font-semibold text-purple-300">
                  {activeEntry.customEvent.name}
                </div>
                <div className="text-sm text-gray-300">
                  {activeEntry.customEvent.duration}分
                </div>
              </>
            ) : (
              <div className="font-semibold">(不明)</div>
            )}
          </div>
        )}
      </DragOverlay>
      </div>
    </DndContext>
  );
};
