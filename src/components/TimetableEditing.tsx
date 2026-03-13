import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent } from '@dnd-kit/core';
import type { Band, EventSettings, Timetable, DailyTimetable, CustomEvent, CustomFieldsSettings, ConstraintViolation } from '../types';
import { TimetableDragOverlay } from './TimetableDragOverlay';
import { ViolationPanel } from './ViolationPanel';
import { TimetableContextBar } from './TimetableContextBar';
import { TimetableContent } from './TimetableContent';
import { BandBankDropZone } from './BandBankDropZone';
import { CustomFieldsTable } from './CustomFieldsTable';
import { CustomColumnManager } from './CustomColumnManager';
import { useCoolManagement, type CoolReductionAction } from '../hooks/useCoolManagement';
import { useTimetableDragDrop } from '../hooks/useTimetableDragDrop';
import { useTimetableHelpers } from '../hooks/useTimetableHelpers';
import { useAllViolations } from '../hooks/useConstraintCheck';
import { useDragHandlers } from '../hooks/useDragHandlers';
import { createTimetableCollisionDetection } from '../utils/timetableCollisionDetection';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';
import { generateUUID } from '../utils/generateUUID';
import { eventService } from '../services/firestore';
import {
  hasCustomFieldsDataForEntry,
  cleanupCustomFieldsForEntry,
  hasAnySequenceData,
  hasSequenceDataAtPosition,
  getSequenceMergeInfoAtPosition,
  getSequenceNumberForEntry,
  renumberSequenceDataForDeletion,
  shiftSequenceDataForInsertion,
  adjustSequenceDataForReorder,
  getEntriesWithCoolInfo,
} from '../utils/customFieldsUtils';

interface TimetableEditingProps {
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onPerformanceTimetableChange: (timetable: DailyTimetable) => void;
  onRehearsalTimetableChange: (timetable: DailyTimetable) => void;
  onEventSettingsChange?: (updates: Partial<EventSettings>) => void;
}

export const TimetableEditing = ({
  bands,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onPerformanceTimetableChange,
  onRehearsalTimetableChange,
  onEventSettingsChange,
}: TimetableEditingProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [selectedDate, setSelectedDate] = useState(eventSettings.performanceDates[0] || '');
  const [inputCoolCount, setInputCoolCount] = useState<string>('1');
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);
  const [isViolationPanelOpen, setIsViolationPanelOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // ドラッグ中のエントリーIDを追跡（reorder時にどのエントリーが移動されたか特定するため）
  const lastDraggedEntryIdRef = useRef<string | null>(null);
  // 削除確認ダイアログ
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    entryId: string;
    coolIndex?: number;
    entryName: string;
    hasEntityData: boolean;
    hasSeqData: boolean;
    seqMergeAffected: boolean;
  } | null>(null);
  // 挿入時の通知
  const [insertionNotification, setInsertionNotification] = useState<string | null>(null);
  const [coolReductionModal, setCoolReductionModal] = useState<{
    pendingCount: number;
    entryCount: number;
  } | null>(null);

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

  // eventSettings.customEventsが外部（Firestore）から変更されたらローカル状態を同期
  useEffect(() => {
    const firestoreEvents = eventSettings.customEvents || [];
    if (JSON.stringify(customEvents) !== JSON.stringify(firestoreEvents)) {
      setCustomEvents(firestoreEvents);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSettings.customEvents]);


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

  // カスタムフィールド変更ハンドラー
  const handleCustomFieldsChange = useCallback(
    async (customFields: CustomFieldsSettings) => {
      try {
        await eventService.updateEvent(eventSettings.id, { customFields });
        if (onEventSettingsChange) {
          onEventSettingsChange({ customFields });
        }
      } catch (error) {
        console.error('カスタムフィールドの保存に失敗しました:', error);
      }
    },
    [eventSettings.id, onEventSettingsChange]
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
    // coolsが空またはundefinedの場合、entriesを使って初期クールを作成
    if (!dailyTimetable.cools || dailyTimetable.cools.length === 0) {
      return {
        ...dailyTimetable,
        cools: [{
          id: `cool-1-${selectedDate}`,
          number: 1,
          entries: dailyTimetable.entries || [],
        }],
      };
    }
    return dailyTimetable;
  }, [timetable, selectedDate]);

  // 当日一括リハーサル用：本番とリハーサルの日別タイムテーブルを取得
  const performanceDailyTimetable = useMemo(() => {
    const dt = performanceTimetable?.dailyTimetables.find(dt => dt.date === selectedDate);
    if (!dt) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [{ id: `cool-1-perf-${selectedDate}`, number: 1, entries: [] }],
        entries: [],
      };
    }
    return dt;
  }, [performanceTimetable, selectedDate]);

  const rehearsalDailyTimetable = useMemo(() => {
    const dt = rehearsalTimetable?.dailyTimetables.find(dt => dt.date === selectedDate);
    if (!dt) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [{ id: `cool-1-reh-${selectedDate}`, number: 1, entries: [] }],
        entries: [],
      };
    }
    return dt;
  }, [rehearsalTimetable, selectedDate]);

  // 当日一括リハーサル＋カスタムモードで両方表示するかどうか
  const showCombinedView = isCustomMode && eventSettings.rehearsalType === 'day-start-rehearsal';

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

  // 制約チェック（本番・リハーサル両方の全日程）
  const violations = useAllViolations(performanceTimetable, rehearsalTimetable, bands);

  // 読み取り専用モード判定（クール直前リハーサルの場合、リハーサル編集は読み取り専用）
  const isReadOnly = (timetableType === 'rehearsal' && eventSettings.rehearsalType === 'cool-pre-rehearsal') || isCustomMode;

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
  }, [bands, selectedDate, currentTimetable.startTime]); // bandsの変更、日付の切り替え、開始時刻の変更を監視


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

  const handleCoolCountChangeWithConfirm = useCallback((newCount: number) => {
    const currentCount = currentTimetable.cools.length;
    if (newCount < 1 || newCount === currentCount) return;

    if (newCount < currentCount) {
      const bottomCool = currentTimetable.cools[currentCount - 1];
      if (bottomCool && bottomCool.entries.length > 0) {
        const removedEntryCount = currentTimetable.cools
          .slice(newCount)
          .reduce((sum, cool) => sum + cool.entries.length, 0);
        setCoolReductionModal({ pendingCount: newCount, entryCount: removedEntryCount });
        return;
      }
    }

    handleCoolCountChange(newCount, 'move');
  }, [currentTimetable, handleCoolCountChange]);

  const executeCoolReduction = useCallback((action: CoolReductionAction) => {
    if (!coolReductionModal) return;
    handleCoolCountChange(coolReductionModal.pendingCount, action);
    setCoolReductionModal(null);
  }, [coolReductionModal, handleCoolCountChange]);

  // 挿入・reorder検知付きのtimetable変更ハンドラー
  const onTimetableChangeWithInsertionTracking = useCallback((newDailyTimetable: DailyTimetable) => {
    if (!eventSettings.customFields || !hasAnySequenceData(eventSettings.customFields, timetableType, selectedDate)) {
      onTimetableChange(newDailyTimetable);
      return;
    }

    const oldEntries = getEntriesWithCoolInfo(currentTimetable);
    const newEntries = getEntriesWithCoolInfo(newDailyTimetable);
    let updatedCustomFields = eventSettings.customFields;
    let didAdjust = false;

    if (newEntries.length > oldEntries.length) {
      // 新規挿入: 新しいentryIdが増えた場合
      const oldIds = new Set(oldEntries.map(e => e.entryId));
      const insertedEntry = newEntries.find(e => !oldIds.has(e.entryId));

      if (insertedEntry) {
        const insertedSeq = insertedEntry.sequenceNumber;
        updatedCustomFields = shiftSequenceDataForInsertion(
          updatedCustomFields,
          timetableType,
          selectedDate,
          insertedSeq
        );
        didAdjust = true;
      }
    } else if (newEntries.length === oldEntries.length && lastDraggedEntryIdRef.current) {
      // reorder検知: ドラッグされたエントリーのoldSeq/newSeqを特定し、削除+挿入で処理
      const movedEntryId = lastDraggedEntryIdRef.current;
      const oldEntry = oldEntries.find(e => e.entryId === movedEntryId);
      const newEntry = newEntries.find(e => e.entryId === movedEntryId);

      if (oldEntry && newEntry && oldEntry.sequenceNumber !== newEntry.sequenceNumber) {
        updatedCustomFields = adjustSequenceDataForReorder(
          updatedCustomFields,
          timetableType,
          selectedDate,
          oldEntry.sequenceNumber,
          newEntry.sequenceNumber
        );
        didAdjust = true;
      }
    }

    if (didAdjust && onEventSettingsChange) {
      onEventSettingsChange({ customFields: updatedCustomFields });
      setInsertionNotification('位置固定のカスタム項目データが自動調整されました');
      setTimeout(() => setInsertionNotification(null), 3000);
    }

    onTimetableChange(newDailyTimetable);
  }, [currentTimetable, eventSettings.customFields, timetableType, selectedDate, onEventSettingsChange, onTimetableChange]);

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
    onTimetableChange: onTimetableChangeWithInsertionTracking,
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

  // ドラッグ開始時にエントリーIDを記録するラッパー
  const wrappedHandleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = event.active.id as string;
    lastDraggedEntryIdRef.current = activeId.startsWith('entry-')
      ? activeId.replace('entry-', '')
      : null;
    handleDragStart(event);
  }, [handleDragStart]);

  // カスタムイベント管理
  const handleAddCustomEvent = (customEvent: Omit<CustomEvent, 'id'>) => {
    const newEvent: CustomEvent = {
      id: generateUUID(),
      ...customEvent,
    };
    setCustomEvents([...customEvents, newEvent]);
  };

  const handleDeleteCustomEvent = (id: string) => {
    setCustomEvents(customEvents.filter((e) => e.id !== id));
  };

  // 制約違反クリック時にエントリーまでスクロール＆ハイライト
  const handleViolationClick = useCallback((violation: ConstraintViolation) => {
    // メッセージから本番/リハを判定
    const isRehearsal = violation.message.startsWith('[リハ');
    const targetType = isRehearsal ? 'rehearsal' : 'performance';
    const targetDate = violation.date;

    // タイムテーブルタイプや日付が異なる場合は切り替える
    const needsTypeChange = timetableType !== targetType;
    const needsDateChange = selectedDate !== targetDate;

    if (needsTypeChange || needsDateChange) {
      if (needsTypeChange) {
        setTimetableType(targetType);
      }
      if (needsDateChange) {
        setSelectedDate(targetDate);
      }
      // 状態変更後にスクロール
      setTimeout(() => {
        const row = document.querySelector(`[data-entry-id="${violation.entryId}"]`);
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          row.classList.remove('violation-highlight');
          void (row as HTMLElement).offsetWidth;
          row.classList.add('violation-highlight');
          const onEnd = () => {
            row.classList.remove('violation-highlight');
            row.removeEventListener('animationend', onEnd);
          };
          row.addEventListener('animationend', onEnd);
        }
      }, 100);
    } else {
      // 同じタイムテーブル内の場合は即座にスクロール
      const row = document.querySelector(`[data-entry-id="${violation.entryId}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('violation-highlight');
        void (row as HTMLElement).offsetWidth;
        row.classList.add('violation-highlight');
        const onEnd = () => {
          row.classList.remove('violation-highlight');
          row.removeEventListener('animationend', onEnd);
        };
        row.addEventListener('animationend', onEnd);
      }
    }
  }, [timetableType, selectedDate]);

  // カスタムフィールドデータがあるエントリーの削除確認
  const handleRemoveEntryWithConfirm = useCallback((entryId: string, coolIndex?: number) => {
    // エントリーを探す
    let entry = null;
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      if (coolIndex !== undefined) {
        entry = currentTimetable.cools[coolIndex]?.entries.find(e => e.id === entryId);
      } else {
        for (const cool of currentTimetable.cools) {
          entry = cool.entries.find(e => e.id === entryId);
          if (entry) break;
        }
      }
    } else {
      entry = currentTimetable.entries.find(e => e.id === entryId);
    }

    if (!entry) {
      handleRemoveEntry(entryId, coolIndex);
      return;
    }

    // entity型のカスタムフィールドデータがあるかチェック
    const hasEntityData = hasCustomFieldsDataForEntry(
      eventSettings.customFields,
      timetableType,
      selectedDate,
      entryId
    );

    // sequence型のデータ影響チェック
    const seq = getSequenceNumberForEntry(currentTimetable, entryId);
    const hasSeqData = seq !== undefined && hasSequenceDataAtPosition(
      eventSettings.customFields, timetableType, selectedDate, seq
    );
    const mergeInfo = seq !== undefined
      ? getSequenceMergeInfoAtPosition(eventSettings.customFields, timetableType, selectedDate, seq)
      : { isInMerge: false, isParent: false };
    const hasAnySeqDataForDate = hasAnySequenceData(eventSettings.customFields, timetableType, selectedDate);

    if (hasEntityData || hasSeqData || mergeInfo.isInMerge || hasAnySeqDataForDate) {
      // 確認ダイアログを表示
      const entryName = entry.type === 'band'
        ? bands.find(b => b.id === entry.bandId)?.name || '不明なバンド'
        : entry.customEvent?.name || 'カスタムイベント';
      setDeleteConfirmDialog({
        entryId,
        coolIndex,
        entryName,
        hasEntityData,
        hasSeqData,
        seqMergeAffected: mergeInfo.isInMerge,
      });
    } else {
      // データがなければそのまま削除
      handleRemoveEntry(entryId, coolIndex);
    }
  }, [currentTimetable, eventSettings.customFields, timetableType, selectedDate, bands, handleRemoveEntry]);

  // 削除確認後の実際の削除処理
  const executeRemoveEntry = useCallback(() => {
    if (!deleteConfirmDialog) return;
    const { entryId, coolIndex } = deleteConfirmDialog;

    if (eventSettings.customFields && onEventSettingsChange) {
      let updatedCustomFields = eventSettings.customFields;

      // 1. entity型データのクリーンアップ
      if (deleteConfirmDialog.hasEntityData) {
        updatedCustomFields = cleanupCustomFieldsForEntry(
          updatedCustomFields,
          timetableType,
          selectedDate,
          entryId
        );
      }

      // 2. sequence型データのリナンバリング（マージ自動調整含む）
      const seq = getSequenceNumberForEntry(currentTimetable, entryId);
      if (seq !== undefined && hasAnySequenceData(updatedCustomFields, timetableType, selectedDate)) {
        updatedCustomFields = renumberSequenceDataForDeletion(
          updatedCustomFields,
          timetableType,
          selectedDate,
          seq
        );
      }

      onEventSettingsChange({ customFields: updatedCustomFields });
    }

    // エントリーを削除
    handleRemoveEntry(entryId, coolIndex);
    setDeleteConfirmDialog(null);
  }, [deleteConfirmDialog, eventSettings.customFields, timetableType, selectedDate, currentTimetable, onEventSettingsChange, handleRemoveEntry]);

  return (
    <DndContext
      sensors={isCustomMode ? [] : sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={wrappedHandleDragStart}
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
          isCustomMode={isCustomMode}
          showCombinedView={showCombinedView}
          onTimetableTypeChange={handleTimetableTypeChange}
          onDateChange={setSelectedDate}
          onStartTimeChange={handleStartTimeChange}
          onCoolCountChange={handleCoolCountChangeWithConfirm}
          onCoolCountInputChange={setInputCoolCount}
          onCustomModeChange={setIsCustomMode}
          bands={bands}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* メインコンテンツエリア */}
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-4">
          <div className="flex gap-4 h-full relative">
            {/* 制約違反サマリーパネル - カスタムモード時は非表示 */}
            {!isCustomMode && (
              <ViolationPanel
                violations={violations}
                isOpen={isViolationPanelOpen}
                onToggle={() => setIsViolationPanelOpen(!isViolationPanelOpen)}
                onViolationClick={handleViolationClick}
              />
            )}
          
          {/* タイムテーブルとバンドバンク/列管理のコンテナ */}
          <div className={`flex gap-4 flex-1 min-w-0 ${isCustomMode ? '' : 'ml-9'}`}>
            {/* 中央ペイン */}
            {isCustomMode ? (
              showCombinedView ? (
                // 当日一括リハーサル：リハーサルと本番を縦に並べて表示
                <div className="flex-1 flex flex-col gap-4 overflow-auto">
                  {/* リハーサルセクション */}
                  <div className="flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-orange-400 bg-orange-500/20 px-2 py-0.5 rounded">
                        リハーサル
                      </span>
                    </div>
                    <CustomFieldsTable
                      currentTimetable={rehearsalDailyTimetable}
                      bands={bands}
                      timetable={rehearsalTimetable}
                      eventSettings={eventSettings}
                      timetableType="rehearsal"
                      selectedDate={selectedDate}
                      onCustomFieldsChange={handleCustomFieldsChange}
                      searchQuery={searchQuery}
                    />
                  </div>
                  {/* 本番セクション */}
                  <div className="flex-shrink-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded">
                        本番
                      </span>
                    </div>
                    <CustomFieldsTable
                      currentTimetable={performanceDailyTimetable}
                      bands={bands}
                      timetable={performanceTimetable}
                      eventSettings={eventSettings}
                      timetableType="performance"
                      selectedDate={selectedDate}
                      onCustomFieldsChange={handleCustomFieldsChange}
                      searchQuery={searchQuery}
                    />
                  </div>
                </div>
              ) : (
                <CustomFieldsTable
                  currentTimetable={currentTimetable}
                  bands={bands}
                  timetable={timetable}
                  eventSettings={eventSettings}
                  timetableType={timetableType}
                  selectedDate={selectedDate}
                  onCustomFieldsChange={handleCustomFieldsChange}
                  searchQuery={searchQuery}
                />
              )
            ) : (
              <TimetableContent
                currentTimetable={currentTimetable}
                bands={bands}
                overEntryId={overEntryId}
                violations={violations}
                bandNumbers={bandNumbers}
                isReadOnly={isReadOnly}
                rehearsalType={eventSettings.rehearsalType}
                onRemoveEntry={handleRemoveEntryWithConfirm}
                onDeleteCool={handleDeleteCool}
                onMoveCoolUp={handleMoveCoolUp}
                onMoveCoolDown={handleMoveCoolDown}
                onTransitionTimeChange={handleTransitionTimeChange}
                onCoolStartTimeChange={handleCoolStartTimeChange}
                searchQuery={searchQuery}
              />
            )}

          {/* 右ペイン: カスタムモード時は列管理、通常時はバンドバンク */}
          {isCustomMode ? (
            <CustomColumnManager
              customFields={eventSettings.customFields}
              timetableType={timetableType}
              onCustomFieldsChange={handleCustomFieldsChange}
              applyToBoth={showCombinedView}
            />
          ) : (
            <BandBankDropZone 
              unplacedBands={unplacedBands} 
              timetableType={timetableType}
              rehearsalDuration={eventSettings.rehearsalDuration}
              customEvents={customEvents}
              onAddCustomEvent={handleAddCustomEvent}
              onDeleteCustomEvent={handleDeleteCustomEvent}
            />
          )}
          </div>
        </div>
        </div>

      {/* ドラッグオーバーレイ */}
      {!isCustomMode && (
        <TimetableDragOverlay
          activeBand={activeBand}
          activeCustomEvent={activeCustomEvent}
          activeEntry={activeEntry}
          bands={bands}
          dropSucceeded={dropSucceeded}
        />
      )}

      {/* 挿入時の通知バナー */}
      {insertionNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-fade-in">
          {insertionNotification}
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {deleteConfirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg shadow-2xl p-6 max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-3">削除の確認</h3>
            <div className="text-gray-600 text-sm mb-4 space-y-1">
              <p>「{deleteConfirmDialog.entryName}」を削除します。</p>
              {deleteConfirmDialog.hasEntityData && (
                <p className="text-amber-600">• エントリー追従のカスタム項目データが失われます</p>
              )}
              {deleteConfirmDialog.hasSeqData && (
                <p className="text-amber-600">• この位置の位置固定カスタム項目データが失われます</p>
              )}
              {deleteConfirmDialog.seqMergeAffected && (
                <p className="text-amber-600">• セル結合が自動的に調整されます</p>
              )}
              {!deleteConfirmDialog.hasEntityData && !deleteConfirmDialog.hasSeqData && !deleteConfirmDialog.seqMergeAffected && (
                <p className="text-amber-600">• 位置固定のカスタム項目データが繰り上がります</p>
              )}
              <p className="mt-2">削除しますか？</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={executeRemoveEntry}
                className="px-4 py-2 text-sm font-medium rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* クール削減時の選択モーダル */}
      {coolReductionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-gray-200 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-3">クール数を減らす確認</h3>
            <p className="text-gray-600 text-sm mb-4">
              一番下の削除対象クールに {coolReductionModal.entryCount} 件の項目があります。どのように処理しますか？
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => executeCoolReduction('move')}
                className="w-full px-4 py-2 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                ひとつ前のクール末尾に追加
              </button>
              <button
                onClick={() => executeCoolReduction('bank')}
                className="w-full px-4 py-2 text-sm font-medium rounded-md bg-amber-600 hover:bg-amber-500 text-white transition-colors"
              >
                バンドバンクに戻す
              </button>
              <button
                onClick={() => setCoolReductionModal(null)}
                className="w-full px-4 py-2 text-sm font-medium rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </DndContext>
  );
};
