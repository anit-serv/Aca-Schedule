import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import type { Band, EventSettings, Timetable, DailyTimetable, TimetableEntry, CustomEvent, CustomFieldsSettings, ConstraintViolation, CustomFieldsUndoMeta } from '../types';
import { TimetableDragOverlay } from './TimetableDragOverlay';
import { ViolationPanel } from './ViolationPanel';
import { TimetableContextBar } from './TimetableContextBar';
import { matchesTimetableBandSearch } from '../utils/timetableSearch';
import { TimetableContent } from './TimetableContent';
import { BandBankDropZone } from './BandBankDropZone';
import { FixedTimeDialog } from './FixedTimeDialog';
import { ResetTimetablesDialog } from './ResetTimetablesDialog';
import { CustomFieldsEditor } from './CustomFieldsEditor';
import { CustomColumnManager } from './CustomColumnManager';
import { AnimatePresence, motion } from 'framer-motion';
import { useCoolManagement, type CoolReductionAction } from '../hooks/useCoolManagement';
import { useTimetableDragDrop } from '../hooks/useTimetableDragDrop';
import { useTimetableHelpers } from '../hooks/useTimetableHelpers';
import { useAllViolations } from '../hooks/useConstraintCheck';
import { useDragHandlers } from '../hooks/useDragHandlers';
import { createTimetableCollisionDetection } from '../utils/timetableCollisionDetection';
import { isDropWithinTimetableScope } from '../utils/timetableDropScope';
import { canPlaceInCoolPreRehearsal } from '../utils/coolPreRehearsal';
import { calculateBandNumbers } from '../utils/calculateBandNumbers';
import { getCustomShiftIssues } from '../utils/customShift';
import { isValidCoolStart, isValidDayEnd, timeMinutes } from '../utils/dailyTimeBounds';
import { normalizeTimeRanges } from '../utils/availabilityRanges';
import { generateUUID } from '../utils/generateUUID';
import { preparePerformanceReset, prepareRehearsalReset, prepareTimetablesReset, type ResetTimetablesPlan } from '../utils/resetTimetables';
import { eventService } from '../services/firestore';
import { RateLimitError } from '../utils/writeRateLimiter';
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
  reconcileShiftForDay,
  getEntriesWithCoolInfo,
} from '../utils/customFieldsUtils';

interface TimetableEditingProps {
  initialView?: { type: 'performance' | 'rehearsal'; date: string } | null;
  onViewChange?: (view: { type: 'performance' | 'rehearsal'; date: string }) => void;
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onPerformanceTimetableChange: (timetable: DailyTimetable) => void;
  onAutoScheduleStart: (type: 'performance' | 'rehearsal') => Promise<void>;
  isAutoScheduling: boolean;
  autoScheduleMessage: string | null;
  onDismissAutoScheduleMessage: () => void;
  onResetAllApply: (plan: ResetTimetablesPlan) => Promise<void>;
  onRehearsalTimetableChange: (timetable: DailyTimetable) => void;
  onEventSettingsChange?: (updates: Partial<EventSettings>) => void;
  onUndoRecord?: (meta: CustomFieldsUndoMeta) => void;
}

export const TimetableEditing = ({
  initialView,
  onViewChange,
  bands,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onPerformanceTimetableChange,
  onAutoScheduleStart,
  isAutoScheduling,
  autoScheduleMessage,
  onDismissAutoScheduleMessage,
  onResetAllApply,
  onRehearsalTimetableChange,
  onEventSettingsChange,
  onUndoRecord,
}: TimetableEditingProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>(
    initialView?.type === 'rehearsal' && eventSettings.rehearsalType !== 'none' ? 'rehearsal' : 'performance',
  );
  const unifiedCoolPre = eventSettings.rehearsalType === 'cool-pre-rehearsal';
  const [selectedDate, setSelectedDate] = useState(() => {
    const dates = timetableType === 'performance' || unifiedCoolPre || eventSettings.rehearsalType === 'day-start-rehearsal'
      ? eventSettings.performanceDates : eventSettings.rehearsalDates || [];
    return initialView?.date && dates.includes(initialView.date) ? initialView.date : dates[0] || '';
  });
  useEffect(() => {
    onViewChange?.({ type: timetableType, date: selectedDate });
  }, [timetableType, selectedDate, onViewChange]);
  const [inputCoolCount, setInputCoolCount] = useState<string>('1');
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);
  const [isViolationPanelOpen, setIsViolationPanelOpen] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fixedDialog, setFixedDialog] = useState<{ bandId: string; entryId?: string; coolIndex: number } | null>(null);
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const [pendingMemberSearch, setPendingMemberSearch] = useState<string | null>(null);
  const [searchTarget, setSearchTarget] = useState<{ entryId: string; date: string; type: 'performance' | 'rehearsal' } | null>(null);
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const matchingBandIds = new Set(bands.filter(band => matchesTimetableBandSearch(band, searchQuery)).map(band => band.id));
    return ([performanceTimetable, rehearsalTimetable] as const).flatMap(table =>
      (table?.dailyTimetables || []).flatMap(day =>
        (day.cools.length ? day.cools.flatMap(cool => cool.entries) : day.entries)
          .filter(entry => entry.type === 'band' && entry.bandId && matchingBandIds.has(entry.bandId))
          .map(entry => ({ entryId: entry.id, bandId: entry.bandId!, date: day.date, type: table!.type }))
      )
    );
  }, [bands, performanceTimetable, rehearsalTimetable, searchQuery]);
  const navigateToSearchMatch = useCallback((index: number) => {
    const match = searchMatches[index];
    if (!match) return;
    setSearchMatchIndex(index);
    setSearchTarget({ entryId: match.entryId, date: match.date, type: match.type });
    setTimetableType(match.type);
    setSelectedDate(match.date);
  }, [searchMatches]);
  useEffect(() => {
    if (pendingMemberSearch === null || searchQuery !== pendingMemberSearch) return;
    if (searchMatches.length) navigateToSearchMatch(0);
    setPendingMemberSearch(null);
  }, [pendingMemberSearch, searchQuery, searchMatches, navigateToSearchMatch]);
  useEffect(() => {
    if (!searchTarget || searchTarget.date !== selectedDate || searchTarget.type !== timetableType) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const findRow = () => {
      const scope = document.querySelector(`[data-timetable-kind="${searchTarget.type}"]`);
      const row = Array.from(scope?.querySelectorAll<HTMLElement>('[data-entry-id]') || [])
        .find(element => element.dataset.entryId === searchTarget.entryId);
      if (!row && attempts++ < 15) { timer = setTimeout(findRow, 50); return; }
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('violation-highlight');
        void row.offsetWidth;
        row.classList.add('violation-highlight');
        row.addEventListener('animationend', () => row.classList.remove('violation-highlight'), { once: true });
      }
      setSearchTarget(null);
    };
    timer = setTimeout(findRow, 0);
    return () => clearTimeout(timer);
  }, [searchTarget, selectedDate, timetableType]);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const resetPlan = useMemo(() => performanceTimetable
    ? timetableType === 'rehearsal' && rehearsalTimetable
      ? prepareRehearsalReset(performanceTimetable, rehearsalTimetable, eventSettings.customFields)
      : eventSettings.rehearsalType === 'cool-pre-rehearsal'
        ? prepareTimetablesReset(performanceTimetable, rehearsalTimetable, eventSettings.customFields)
        : preparePerformanceReset(performanceTimetable, eventSettings.customFields)
    : null, [performanceTimetable, rehearsalTimetable, eventSettings.customFields, eventSettings.rehearsalType, timetableType]);
  const resetEntryCount = (resetPlan?.bandEntries ?? 0) + (resetPlan?.customEntries ?? 0);
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
  const [returningEntryId, setReturningEntryId] = useState<string | null>(null);
  const [arrivalBandId, setArrivalBandId] = useState<string | null>(null);
  const [dragRowWidth, setDragRowWidth] = useState(900);
  const [dragRowLeft, setDragRowLeft] = useState(0);
  const [dragSourceSize, setDragSourceSize] = useState({ width: 240, height: 68 });
  const [dragSourcePosition, setDragSourcePosition] = useState<{ left: number; top: number } | null>(null);
  const pointerDownRowRectRef = useRef<{ id: string; left: number; top: number; width: number; height: number } | null>(null);
  const dragSourceSizeRef = useRef(dragSourceSize);
  const dragSourcePositionRef = useRef(dragSourcePosition);
  const returnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bankArrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBankReturnRef = useRef<{ entryId: string; bandId: string | null } | null>(null);
  const hasSkippedInitialAutoRecalcRef = useRef(false);

  useEffect(() => () => {
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    if (bankArrivalTimerRef.current) clearTimeout(bankArrivalTimerRef.current);
  }, []);

  useEffect(() => {
    // dnd-kit が行を詰める前の座標を、ドラッグハンドルを押した時点で保存する。
    const capturePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.mode-drag-handle')) return;
      const row = target.closest<HTMLTableRowElement>('tr[data-entry-id]');
      if (!row?.dataset.entryId) return;
      const rect = row.getBoundingClientRect();
      pointerDownRowRectRef.current = {
        id: `entry-${row.dataset.entryId}`,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    document.addEventListener('pointerdown', capturePointerDown, true);
    return () => document.removeEventListener('pointerdown', capturePointerDown, true);
  }, []);

  // カスタムイベントの保存追跡用ref（フリッカー防止）
  const customEventsSavingCountRef = useRef(0);
  const lastSavedCustomEventsRef = useRef<string>(JSON.stringify(eventSettings.customEvents || []));

  // Firestore → ローカルへの一方向同期（保存中はスキップ）
  useEffect(() => {
    if (customEventsSavingCountRef.current > 0) return;
    const firestoreEvents = eventSettings.customEvents || [];
    const firestoreSerialized = JSON.stringify(firestoreEvents);
    // 自分が保存した内容のエコーは無視
    if (firestoreSerialized === lastSavedCustomEventsRef.current) return;
    if (JSON.stringify(customEvents) !== firestoreSerialized) {
      setCustomEvents(firestoreEvents);
      lastSavedCustomEventsRef.current = firestoreSerialized;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSettings.customEvents]);

  const saveCustomEvents = useCallback(
    async (newList: CustomEvent[], previousList: CustomEvent[]) => {
      const serialized = JSON.stringify(newList);
      lastSavedCustomEventsRef.current = serialized;
      customEventsSavingCountRef.current += 1;
      try {
        await eventService.updateEvent(eventSettings.id, { customEvents: newList });
      } catch (error) {
        console.error('カスタムイベントの保存に失敗しました:', error);
        // ロールバック
        setCustomEvents(previousList);
        lastSavedCustomEventsRef.current = JSON.stringify(previousList);
        alert(error instanceof RateLimitError ? error.message : 'カスタムイベントの保存に失敗しました。通信状態を確認して再度お試しください。');
      } finally {
        customEventsSavingCountRef.current -= 1;
      }
    },
    [eventSettings.id]
  );


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
        alert(error instanceof RateLimitError ? error.message : 'カスタムフィールドの保存に失敗しました。通信状態を確認して再度お試しください。');
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

  const alternateType = timetableType === 'performance' ? 'rehearsal' : 'performance';
  const alternateTimetable = timetableType === 'performance' ? rehearsalTimetable : performanceTimetable;
  const alternateDailyTimetable = useMemo<DailyTimetable>(() => {
    return alternateTimetable?.dailyTimetables.find(day => day.date === selectedDate) || {
      date: selectedDate,
      startTime: '10:00',
      cools: [{ id: `cool-1-${alternateType}-${selectedDate}`, number: 1, entries: [] }],
      entries: [],
    };
  }, [alternateTimetable, alternateType, selectedDate]);
  const alternateBandNumbers = useMemo(() => calculateBandNumbers(alternateTimetable), [alternateTimetable]);

  // 当日一括リハーサル＋カスタムモードで両方表示するかどうか
  const showCombinedView = isCustomMode && eventSettings.rehearsalType === 'day-start-rehearsal';
  // クール直前リハーサル＋カスタムモードではクール単位でリハ→本番を交互表示
  const showInterleavedCoolPreView = unifiedCoolPre;

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
  const customShiftIssues = useMemo(() => getCustomShiftIssues(
    performanceTimetable, rehearsalTimetable, eventSettings.customFields, bands,
  ), [performanceTimetable, rehearsalTimetable, eventSettings.customFields, bands]);

  // 読み取り専用モード判定（クール直前リハーサルの場合、リハーサル編集は読み取り専用）
  const isReadOnly = isCustomMode;
  const rehearsalCoolStructureLocked = unifiedCoolPre && timetableType === 'rehearsal';
  const canPlaceBandInCool = useCallback((bandId: string, coolIndex: number) =>
    !rehearsalCoolStructureLocked || canPlaceInCoolPreRehearsal(
      performanceTimetable?.dailyTimetables.find(day => day.date === selectedDate), bandId, coolIndex,
    ), [rehearsalCoolStructureLocked, performanceTimetable, selectedDate]);

  // バンドの演奏時間が変更されたら、タイムテーブルの時刻を再計算
  // または日付が切り替わったときも再計算
  useEffect(() => {
    // 初回表示時の自動再計算はスキップし、読み込み直後の時刻チラつきを防ぐ
    if (!hasSkippedInitialAutoRecalcRef.current) {
      hasSkippedInitialAutoRecalcRef.current = true;
      return;
    }

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
  }, [bands, selectedDate, currentTimetable.startTime, recalculateTimes]); // bandsの変更、日付の切り替え、開始時刻/デフォルト計算ロジックの変更を監視


  // 開始時刻の変更
  const handleStartTimeChange = (newStartTime: string) => {
    if (currentTimetable.endTime && timeMinutes(newStartTime) >= timeMinutes(currentTimetable.endTime)) {
      alert(`開始時刻は終了時刻（${currentTimetable.endTime}）より前に設定してください。`);
      return;
    }
    if (currentTimetable.cools && currentTimetable.cools.length > 0) {
      const baseCools = eventSettings.rehearsalType === 'cool-pre-rehearsal'
        ? currentTimetable.cools.map((cool, index) => index === 0 ? { ...cool, startTime: newStartTime } : cool)
        : currentTimetable.cools;
      const calculatedCools = recalculateTimes(baseCools, newStartTime);
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

  const handleEndTimeChange = (newEndTime: string | undefined) => {
    if (newEndTime && !isValidDayEnd(currentTimetable, newEndTime)) {
      alert('終了時刻はその日の開始時刻と、すべてのクール開始時刻より後に設定してください。');
      return;
    }
    if (!newEndTime) {
      // Firestore は undefined を保存できないため、未設定時はキーを削除する。
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { endTime: _removedEndTime, ...dayWithoutEndTime } = currentTimetable;
      onTimetableChange(dayWithoutEndTime);
      return;
    }
    onTimetableChange({ ...currentTimetable, endTime: newEndTime });
  };

  // 転換時間の変更
  const handleTransitionTimeChange = (entryId: string, transitionTime: number) => {
    if (isCustomMode) return;
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
    if (startTime && !isValidCoolStart(currentTimetable, coolIndex, startTime)) {
      alert('クール開始時刻は前のクール開始時刻より後、当日の終了時刻より前に設定してください。');
      return;
    }

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
    const oldEntries = getEntriesWithCoolInfo(currentTimetable);
    const newEntries = getEntriesWithCoolInfo(newDailyTimetable);
    if (!eventSettings.customFields) {
      onTimetableChange(newDailyTimetable);
      return;
    }

    let updatedCustomFields = eventSettings.customFields;
    let didAdjust = false;
    const hasSequenceData = hasAnySequenceData(updatedCustomFields, timetableType, selectedDate);

    if (hasSequenceData && newEntries.length > oldEntries.length) {
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
    } else if (hasSequenceData && newEntries.length === oldEntries.length && lastDraggedEntryIdRef.current) {
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

    const reconciledShifts = reconcileShiftForDay(updatedCustomFields, timetableType, newDailyTimetable);
    if (reconciledShifts !== updatedCustomFields) {
      updatedCustomFields = reconciledShifts;
      didAdjust = true;
    }

    if (didAdjust && onEventSettingsChange) {
      onEventSettingsChange({ customFields: updatedCustomFields });
      setInsertionNotification('位置固定のカスタム項目データが自動調整されました');
      setTimeout(() => setInsertionNotification(null), 3000);
    }

    onTimetableChange(newDailyTimetable);
  }, [currentTimetable, eventSettings.customFields, timetableType, selectedDate, onEventSettingsChange, onTimetableChange]);

  const saveFixedTime = (coolIndex: number, start: string | null): string | null => {
    if (!fixedDialog || !currentTimetable.cools[coolIndex]) return 'クールが見つかりません。';
    if (!start && !fixedDialog.entryId) return '追加する時刻を指定してください。';
    const band = bands.find(item => item.id === fixedDialog.bandId);
    if (!band) return 'バンドが見つかりません。';
    if (!fixedDialog.entryId && !canPlaceBandInCool(band.id, coolIndex)) return 'このクールには配置できません。';
    if (!fixedDialog.entryId && rehearsalCoolStructureLocked && currentTimetable.cools[coolIndex].entries.some(entry => entry.bandId === band.id)) return 'このクールにはすでにリハが配置されています。';
    if (start) {
      const duration = timetableType === 'rehearsal' ? eventSettings.rehearsalDuration || 0 : band.performanceDuration;
      const ranges = normalizeTimeRanges([
        ...(band.availableTimeSlots.find(item => item.date === selectedDate)?.timeRanges ?? []),
        ...(timetableType === 'rehearsal' ? band.backupRehearsalTimeSlots?.find(item => item.date === selectedDate)?.timeRanges ?? [] : []),
      ]);
      if (!ranges.some(range => timeMinutes(start) >= timeMinutes(range.startTime) && timeMinutes(start) + duration <= timeMinutes(range.endTime))) return '出演可能時間内の時刻を指定してください。';
    }

    const updatedCools = currentTimetable.cools.map((cool, index) => {
      if (index !== coolIndex) return cool;
      if (fixedDialog.entryId) return { ...cool, entries: cool.entries.map(entry => {
        if (entry.id !== fixedDialog.entryId) return entry;
        if (!start) { const { fixedStartTime: _fixed, ...unfixed } = entry; void _fixed; return unfixed; }
        return { ...entry, fixedStartTime: start };
      }) };
      const newEntry: TimetableEntry = { id: generateUUID(), type: 'band', bandId: band.id, order: 0, fixedStartTime: start! };
      const entries = [...cool.entries];
      const insertAt = entries.findIndex(entry => entry.startTime && timeMinutes(entry.startTime) > timeMinutes(start!));
      entries.splice(insertAt < 0 ? entries.length : insertAt, 0, newEntry);
      return { ...cool, entries };
    });
    const calculated = recalculateTimes(updatedCools, currentTimetable.startTime);
    for (let index = 0; index < calculated.length; index++) {
      let cursor = timeMinutes(calculated[index].startTime || (index === 0 ? currentTimetable.startTime : calculated[index - 1].entries.at(-1)?.endTime || currentTimetable.startTime));
      const upper = currentTimetable.cools[index + 1]?.startTime || currentTimetable.endTime || '24:00';
      for (const entry of calculated[index].entries) {
        if (!entry.startTime || !entry.endTime || timeMinutes(entry.startTime) < cursor || timeMinutes(entry.endTime) > timeMinutes(upper) || timeMinutes(entry.endTime) > 1440) return '前後の出演枠と重なります。時刻または順序を調整してください。';
        if (entry.fixedStartTime && entry.startTime !== entry.fixedStartTime) return '固定時刻を維持できません。';
        cursor = timeMinutes(entry.endTime);
      }
    }
    onTimetableChangeWithInsertionTracking({ ...currentTimetable, cools: calculated });
    return null;
  };

  const handleAutoSchedule = useCallback(() => {
    if (!isReadOnly && timetable && !isAutoScheduling) {
      void onAutoScheduleStart(timetableType);
    }
  }, [timetableType, isReadOnly, timetable, isAutoScheduling, onAutoScheduleStart]);

  const handleResetAll = async () => {
    if (!resetPlan || !resetEntryCount || isResetting) return;
    setIsResetting(true);
    try {
      await onResetAllApply(resetPlan);
      setIsResetDialogOpen(false);
      setResetMessage(`${resetPlan.scope === 'rehearsal' ? 'リハ' : resetPlan.scope === 'performance' ? '本番' : '本番と連動リハ'}の${resetEntryCount}枠をリセットしました。元に戻すボタンで取り消せます。`);
    } catch (error) {
      console.error('配置リセットエラー:', error);
      setResetMessage('配置のリセットに失敗しました。通信状態を確認して再度お試しください。');
    } finally {
      setIsResetting(false);
    }
  };

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
    canPlaceBandInCool,
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
    canDrop: event => !unifiedCoolPre || isDropWithinTimetableScope(event, timetableType),
  });

  // アクティブアイテム取得
  const { activeBand, activeCustomEvent, activeEntry } = getActiveItems();
  const isOverTimetable = !isReadOnly && (
    activeEntry
      ? overEntryId === null || /^(entry-|cool-|timetable-droppable)/.test(overEntryId)
      : Boolean((activeBand || activeCustomEvent) && overEntryId && /^(entry-|cool-|timetable-droppable)/.test(overEntryId))
  );
  useEffect(() => {
    // 表に入る前に座標を確定し、境界をまたぐ最初のフレームで古い値を使わない。
    if (!activeBand && !activeCustomEvent && !activeEntry) return;
    const row = document.querySelector<HTMLTableRowElement>('tr[data-entry-id]');
    const target = row || document.querySelector<HTMLTableElement>('[data-custom-mode] table');
    if (target) {
      const rect = target.getBoundingClientRect();
      setDragRowWidth(Math.min(Math.round(rect.width), window.innerWidth - 32));
      setDragRowLeft(rect.left);
    }
  }, [activeBand, activeCustomEvent, activeEntry, selectedDate, timetableType]);
  const previewReturnEntryId = returningEntryId || (
    overEntryId === 'band-bank-droppable' && !isReadOnly ? lastDraggedEntryIdRef.current : null
  );

  // ドラッグ開始時にエントリーIDを記録するラッパー
  const wrappedHandleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = event.active.id as string;
    const pointerDownRect = pointerDownRowRectRef.current?.id === activeId
      ? pointerDownRowRectRef.current : null;
    pointerDownRowRectRef.current = null;
    const sourceRow = activeId.startsWith('entry-')
      ? Array.from(document.querySelectorAll<HTMLTableRowElement>('tr[data-entry-id]'))
          .find(row => `entry-${row.dataset.entryId}` === activeId && row.getBoundingClientRect().width > 0)
      : null;
    const initialRect = pointerDownRect ?? sourceRow?.getBoundingClientRect() ?? event.active.rect.current.initial;
    if (initialRect) {
      dragSourceSizeRef.current = { width: initialRect.width, height: initialRect.height };
      dragSourcePositionRef.current = { left: initialRect.left, top: initialRect.top };
      setDragSourceSize(dragSourceSizeRef.current);
      setDragSourcePosition(dragSourcePositionRef.current);
    } else {
      dragSourcePositionRef.current = null;
      setDragSourcePosition(null);
    }
    if (activeId.startsWith('entry-') && initialRect) {
      setDragRowWidth(Math.min(Math.round(initialRect.width), window.innerWidth - 32));
      setDragRowLeft(initialRect.left);
    }
    if (activeId.startsWith('band-') || activeId.startsWith('custom-')) {
      const target = document.querySelector<HTMLTableRowElement>('tr[data-entry-id]')
        || document.querySelector<HTMLTableElement>('[data-custom-mode] table');
      if (target) {
        const rect = target.getBoundingClientRect();
        setDragRowWidth(Math.min(Math.round(rect.width), window.innerWidth - 32));
        setDragRowLeft(rect.left);
      }
    }
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
    const previousList = customEvents;
    const newList = [...customEvents, newEvent];
    setCustomEvents(newList);
    void saveCustomEvents(newList, previousList);
  };

  const handleDeleteCustomEvent = (id: string) => {
    const previousList = customEvents;
    const newList = customEvents.filter((e) => e.id !== id);
    setCustomEvents(newList);
    void saveCustomEvents(newList, previousList);
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
        const row = document.querySelector(violation.shiftSlotId
          ? `[data-shift-slot-id="${CSS.escape(violation.shiftSlotId)}"]`
          : `[data-entry-id="${CSS.escape(violation.entryId)}"]`);
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
      const row = document.querySelector(violation.shiftSlotId
        ? `[data-shift-slot-id="${CSS.escape(violation.shiftSlotId)}"]`
        : `[data-entry-id="${CSS.escape(violation.entryId)}"]`);
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
      return true;
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
      return false;
    } else {
      // データがなければそのまま削除
      handleRemoveEntry(entryId, coolIndex);
      return true;
    }
  }, [currentTimetable, eventSettings.customFields, timetableType, selectedDate, bands, handleRemoveEntry]);

  const finishBankReturn = useCallback(() => {
    const bandId = pendingBankReturnRef.current?.bandId;
    pendingBankReturnRef.current = null;
    setReturningEntryId(null);
    if (!bandId) return;
    setArrivalBandId(bandId);
    if (bankArrivalTimerRef.current) clearTimeout(bankArrivalTimerRef.current);
    bankArrivalTimerRef.current = setTimeout(() => setArrivalBandId(null), 550);
  }, []);

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

      const updatedDay: DailyTimetable = {
        ...currentTimetable,
        cools: currentTimetable.cools.map(cool => ({ ...cool, entries: cool.entries.filter(entry => entry.id !== entryId) })),
        entries: currentTimetable.entries.filter(entry => entry.id !== entryId),
      };
      updatedCustomFields = reconcileShiftForDay(updatedCustomFields, timetableType, updatedDay);

      onEventSettingsChange({ customFields: updatedCustomFields });
    }

    // エントリーを削除
    handleRemoveEntry(entryId, coolIndex);
    setDeleteConfirmDialog(null);
    if (pendingBankReturnRef.current?.entryId === entryId) finishBankReturn();
  }, [deleteConfirmDialog, eventSettings.customFields, timetableType, selectedDate, currentTimetable, onEventSettingsChange, handleRemoveEntry, finishBankReturn]);

  const handleDragEndWithBankReturn = useCallback((event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const dropTargetId = String(event.over?.id || '');
    const targetId = dropTargetId === 'band-bank-droppable' ? dropTargetId : overEntryId || dropTargetId;
    handleDragEnd(event);

    if (isReadOnly || !activeId.startsWith('entry-') || targetId !== 'band-bank-droppable') return;
    const entryId = activeId.slice('entry-'.length);
    const coolIndex = currentTimetable.cools?.findIndex(cool => cool.entries.some(entry => entry.id === entryId));
    const entry = currentTimetable.cools?.[coolIndex ?? -1]?.entries.find(item => item.id === entryId)
      || currentTimetable.entries.find(item => item.id === entryId);
    pendingBankReturnRef.current = { entryId, bandId: entry?.type === 'band' ? entry.bandId || null : null };
    setReturningEntryId(entryId);
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => {
      const removedImmediately = handleRemoveEntryWithConfirm(entryId, coolIndex !== undefined && coolIndex >= 0 ? coolIndex : undefined);
      if (removedImmediately) finishBankReturn();
    }, 190);
  }, [handleDragEnd, overEntryId, isReadOnly, currentTimetable, handleRemoveEntryWithConfirm, finishBankReturn]);

  return (
    <DndContext
      sensors={isCustomMode ? [] : sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={wrappedHandleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEndWithBankReturn}
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
          isReadOnly={isReadOnly || rehearsalCoolStructureLocked}
          isCustomMode={isCustomMode}
          showCombinedView={showCombinedView}
          unifiedCoolPre={unifiedCoolPre}
          onTimetableTypeChange={handleTimetableTypeChange}
          onDateChange={setSelectedDate}
          onStartTimeChange={handleStartTimeChange}
          onEndTimeChange={handleEndTimeChange}
          onCoolCountChange={handleCoolCountChangeWithConfirm}
          onCoolCountInputChange={setInputCoolCount}
          onCustomModeChange={setIsCustomMode}
          bands={bands}
          searchQuery={searchQuery}
          onSearchChange={query => { setPendingMemberSearch(null); setSearchMatchIndex(-1); setSearchQuery(query); }}
          searchMatchCount={searchMatches.length}
          searchMatchNumber={searchMatchIndex >= 0 && searchMatchIndex < searchMatches.length ? searchMatchIndex + 1 : 0}
          onSearchSelectBand={bandId => {
            const index = searchMatches.findIndex(match => match.bandId === bandId);
            navigateToSearchMatch(index);
          }}
          onSearchSelectMember={memberName => {
            setSearchMatchIndex(-1);
            setSearchQuery(memberName);
            setPendingMemberSearch(memberName);
          }}
          onSearchNextMatch={() => {
            if (searchMatches.length) navigateToSearchMatch((searchMatchIndex + 1) % searchMatches.length);
          }}
          onSearchPreviousMatch={() => {
            if (searchMatches.length) navigateToSearchMatch((searchMatchIndex - 1 + searchMatches.length) % searchMatches.length);
          }}
        />

        {/* メインコンテンツエリア */}
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-4">
          <div className="flex gap-4 h-full relative">
            {/* 制約違反サマリーパネル */}
              <ViolationPanel
                violations={isCustomMode ? customShiftIssues : violations}
                isOpen={isViolationPanelOpen}
                onToggle={() => setIsViolationPanelOpen(!isViolationPanelOpen)}
                onViolationClick={handleViolationClick}
              />
          
          {/* タイムテーブルとバンドバンク/列管理のコンテナ */}
          <div className="flex gap-4 flex-1 min-w-0 ml-9">
            {/* 通常・カスタムの両モードで同じタイムテーブルと行を使用する */}
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-4 overflow-y-auto">
            {(showCombinedView || showInterleavedCoolPreView) && (
              <div className="text-xs font-semibold text-emerald-700">{timetableType === 'performance' ? '本番' : 'リハーサル'}</div>
            )}
            <div data-timetable-kind={timetableType} className={`flex min-h-0 ${showCombinedView || showInterleavedCoolPreView ? 'min-h-[400px] flex-shrink-0' : 'flex-1'}`}>
            <CustomFieldsEditor
              currentTimetable={currentTimetable}
              bands={bands}
              timetable={timetable}
              eventSettings={eventSettings}
              timetableType={timetableType}
              selectedDate={selectedDate}
              onCustomFieldsChange={handleCustomFieldsChange}
              onUndoRecord={onUndoRecord}
              customMode={isCustomMode}
              renderTable={(columns, renderCustomCell, enteringColumnIds) => (
                <TimetableContent
                  currentTimetable={currentTimetable}
                  bands={bands}
                  overEntryId={overEntryId}
                  reserveInsertionSpace={Boolean(activeBand || activeEntry) && !isReadOnly}
                  violations={violations}
                  bandNumbers={bandNumbers}
                  isReadOnly={isReadOnly}
                  lockCoolStructure={rehearsalCoolStructureLocked}
                  timetableType={timetableType}
                  rehearsalType={eventSettings.rehearsalType}
                  linkedRehearsalDailyTimetable={eventSettings.rehearsalType === 'cool-pre-rehearsal' ? rehearsalDailyTimetable : undefined}
                  onRemoveEntry={handleRemoveEntryWithConfirm}
                  onDeleteCool={rehearsalCoolStructureLocked ? () => {} : handleDeleteCool}
                  onMoveCoolUp={rehearsalCoolStructureLocked ? () => {} : handleMoveCoolUp}
                  onMoveCoolDown={rehearsalCoolStructureLocked ? () => {} : handleMoveCoolDown}
                  onTransitionTimeChange={handleTransitionTimeChange}
                  onTimeClick={(entryId, _field, coolIndex) => { const entry = currentTimetable.cools[coolIndex]?.entries.find(item => item.id === entryId); if (entry?.bandId) setFixedDialog({ bandId: entry.bandId, entryId, coolIndex }); }}
                  onCoolStartTimeChange={handleCoolStartTimeChange}
                  searchQuery={searchQuery}
                  customMode={isCustomMode}
                  customColumns={columns}
                  enteringColumnIds={enteringColumnIds}
                  renderCustomCell={renderCustomCell}
                  returningEntryId={previewReturnEntryId}
                />
              )}
            />
            </div>
            {(showCombinedView || showInterleavedCoolPreView) && (
              <div data-timetable-kind={alternateType} className="flex flex-col gap-2 min-h-[400px] flex-shrink-0">
                <div className="text-xs font-semibold text-emerald-700">{alternateType === 'performance' ? '本番' : 'リハーサル'}</div>
                <CustomFieldsEditor
                  currentTimetable={alternateDailyTimetable}
                  bands={bands}
                  timetable={alternateTimetable}
                  eventSettings={eventSettings}
                  timetableType={alternateType}
                  selectedDate={selectedDate}
                  onCustomFieldsChange={handleCustomFieldsChange}
                  onUndoRecord={onUndoRecord}
                  customMode={isCustomMode}
                  renderTable={(columns, renderCustomCell, enteringColumnIds) => (
                    <TimetableContent
                      currentTimetable={alternateDailyTimetable}
                      bands={bands}
                      overEntryId={null}
                      violations={[]}
                      bandNumbers={alternateBandNumbers}
                      isReadOnly
                      timetableType={alternateType}
                      rehearsalType={eventSettings.rehearsalType}
                      onRemoveEntry={() => {}}
                      onDeleteCool={() => {}}
                      onMoveCoolUp={() => {}}
                      onMoveCoolDown={() => {}}
                      onTransitionTimeChange={() => {}}
                      onCoolStartTimeChange={() => {}}
                      searchQuery={searchQuery}
                      customMode={isCustomMode}
                      customColumns={columns}
                      enteringColumnIds={enteringColumnIds}
                      renderCustomCell={renderCustomCell}
                    />
                  )}
                />
              </div>
            )}
            </div>

          {/* 右ペイン: カスタムモード時は列管理、通常時はバンドバンク */}
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={isCustomMode ? 'column-manager' : 'band-bank'}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="flex-shrink-0 flex"
          >
          {isCustomMode ? (
            <CustomColumnManager
              customFields={eventSettings.customFields}
              timetableType={timetableType}
              bands={bands}
              timetable={timetable}
              counterpartTimetable={alternateTimetable}
              onCustomFieldsChange={handleCustomFieldsChange}
              onUndoRecord={onUndoRecord}
              applyToBoth={showCombinedView || showInterleavedCoolPreView}
            />
          ) : (
            <BandBankDropZone 
              unplacedBands={unplacedBands} 
              timetableType={timetableType}
              unifiedCoolPre={unifiedCoolPre}
              onTimetableTypeChange={handleTimetableTypeChange}
              showAutomation={timetableType === 'performance' || eventSettings.rehearsalType !== 'cool-pre-rehearsal'}
              rehearsalDuration={eventSettings.rehearsalDuration}
              customEvents={customEvents}
              onAddCustomEvent={handleAddCustomEvent}
              onDeleteCustomEvent={handleDeleteCustomEvent}
              arrivalBandId={arrivalBandId}
              onAutoSchedule={handleAutoSchedule}
              isAutoScheduling={isAutoScheduling}
              autoScheduleMessage={autoScheduleMessage || resetMessage}
              onDismissAutoScheduleMessage={() => { onDismissAutoScheduleMessage(); setResetMessage(null); }}
              onResetAll={() => setIsResetDialogOpen(true)}
              isResetting={isResetting}
              resetEntryCount={resetEntryCount}
              onAddFixed={!isAutoScheduling && !isResetting ? bandId => setFixedDialog({ bandId, coolIndex: 0 }) : undefined}
            />
          )}
          </motion.div>
          </AnimatePresence>
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
          isOverTimetable={isOverTimetable}
          timetableWidth={dragRowWidth}
          timetableLeft={dragRowLeft}
          sourceWidth={dragSourceSizeRef.current.width}
          sourceHeight={dragSourceSizeRef.current.height}
          sourcePosition={dragSourcePositionRef.current}
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
                onClick={() => {
                  setDeleteConfirmDialog(null);
                  pendingBankReturnRef.current = null;
                  setReturningEntryId(null);
                }}
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
      {isResetDialogOpen && resetPlan && (
        <ResetTimetablesDialog scope={resetPlan.scope} bandEntries={resetPlan.bandEntries} customEntries={resetPlan.customEntries}
          isResetting={isResetting} onCancel={() => setIsResetDialogOpen(false)} onConfirm={() => { void handleResetAll(); }} />
      )}
      {fixedDialog && (() => {
        const band = bands.find(item => item.id === fixedDialog.bandId);
        const entry = fixedDialog.entryId ? currentTimetable.cools[fixedDialog.coolIndex]?.entries.find(item => item.id === fixedDialog.entryId) : undefined;
        if (!band) return null;
        return <FixedTimeDialog day={currentTimetable} coolIndex={fixedDialog.coolIndex} duration={timetableType === 'rehearsal' ? eventSettings.rehearsalDuration || 0 : band.performanceDuration} title={band.name} initialStart={entry?.fixedStartTime || entry?.startTime || currentTimetable.startTime} initiallyFixed={Boolean(entry?.fixedStartTime)} allowCoolSelection={!fixedDialog.entryId} onSave={saveFixedTime} onClose={() => setFixedDialog(null)} />;
      })()}
      </div>
    </DndContext>
  );
};
