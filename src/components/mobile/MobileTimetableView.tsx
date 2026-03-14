import { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry, CustomEvent, ConstraintViolation, CustomFieldsSettings } from '../../types';
import { calculateBandNumbers } from '../../utils/calculateBandNumbers';
import { generateUUID } from '../../utils/generateUUID';
import { useTimetableHelpers } from '../../hooks/useTimetableHelpers';
import { useAllViolations } from '../../hooks/useConstraintCheck';
import { useTimetableDragDrop } from '../../hooks/useTimetableDragDrop';
import { useDragHandlers } from '../../hooks/useDragHandlers';
import { createTimetableCollisionDetection } from '../../utils/timetableCollisionDetection';
import { TimetableDragOverlay } from '../TimetableDragOverlay';
import { CustomFieldsTable } from '../CustomFieldsTable';
import { CustomColumnManager } from '../CustomColumnManager';
import { MobileBottomSheet, type SheetHeight } from './MobileBottomSheet';
import { MobileBandBank } from './MobileBandBank';
import { eventService } from '../../services/firestore';

interface MobileTimetableViewProps {
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onPerformanceTimetableChange: (timetable: DailyTimetable) => void;
  onRehearsalTimetableChange: (timetable: DailyTimetable) => void;
  selectedBandId: string | null;
  onBandPlaced: () => void;
  onOpenBandBank: () => void;
  onTimetableTypeChange?: (type: 'performance' | 'rehearsal') => void;
  onEventSettingsChange?: (updates: Partial<EventSettings>) => void;
  // D&D用props
  bottomSheetHeight: SheetHeight;
  onBottomSheetHeightChange: (height: SheetHeight) => void;
  onSelectBand: (bandId: string | null) => void;
  isLoading?: boolean;
}

interface MobileTimeInputProps {
  value?: string;
  onChange: (value: string | undefined) => void;
  allowEmpty?: boolean;
  nativeInputClassName?: string;
  fallbackContainerClassName?: string;
  fallbackSelectClassName?: string;
}

const MobileTimeInput = ({
  value,
  onChange,
  allowEmpty = false,
  nativeInputClassName,
  fallbackContainerClassName,
  fallbackSelectClassName,
}: MobileTimeInputProps) => {
  const canUseNativeTimeInput = useMemo(() => {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return true;

    const input = document.createElement('input');
    input.setAttribute('type', 'time');
    const supportsTimeType = input.type === 'time';

    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform
      ?? '';
    const isDesktopPlatform = /Win|Mac|Linux|X11/i.test(platform);
    const isIPadLike = platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const isDesktopEmulation = isDesktopPlatform && !isIPadLike && window.matchMedia('(max-width: 1023px)').matches;

    // PCブラウザのモバイルエミュレーションではフォールバックUIを優先する
    return supportsTimeType && !isDesktopEmulation;
  }, []);

  const currentValue = value ?? '';
  const [rawHour = '', rawMinute = ''] = currentValue.split(':');
  const hourValue = rawHour.padStart(2, '0');
  const minuteValue = rawMinute.padStart(2, '0');

  const buildTime = (hour: string, minute: string) => {
    if (!hour || !minute) return undefined;
    return `${hour}:${minute}`;
  };

  if (canUseNativeTimeInput) {
    return (
      <input
        type="time"
        value={currentValue}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={nativeInputClassName}
      />
    );
  }

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  return (
    <div className={fallbackContainerClassName}>
      <select
        value={hourValue}
        onChange={(e) => onChange(buildTime(e.target.value, minuteValue || '00'))}
        className={fallbackSelectClassName}
      >
        {allowEmpty && !hourValue && <option value="">--</option>}
        {hours.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-gray-400 text-xs">:</span>
      <select
        value={minuteValue}
        onChange={(e) => onChange(buildTime(hourValue || '00', e.target.value))}
        className={fallbackSelectClassName}
      >
        {allowEmpty && !minuteValue && <option value="">--</option>}
        {minutes.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      {allowEmpty && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-emerald-400 hover:text-red-400 p-1"
          title={'開始時刻を削除'}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export const MobileTimetableView = ({
  bands,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onPerformanceTimetableChange,
  onRehearsalTimetableChange,
  selectedBandId,
  onBandPlaced,
  onOpenBandBank,
  onTimetableTypeChange,
  onEventSettingsChange,
  bottomSheetHeight,
  onBottomSheetHeightChange,
  onSelectBand,
  isLoading = false,
}: MobileTimetableViewProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [showCustomEventSheet, setShowCustomEventSheet] = useState(false);
  const [customEventName, setCustomEventName] = useState('');
  const [customEventDuration, setCustomEventDuration] = useState('5');
  const [showViolationSheet, setShowViolationSheet] = useState(false);
  const [coolReductionModal, setCoolReductionModal] = useState<{
    pendingCount: number;
    entryCount: number;
  } | null>(null);
  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u914d\u7f6e\u30e2\u30fc\u30c9
  const [selectedCustomEvent, setSelectedCustomEvent] = useState<CustomEvent | null>(null);
  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u30ea\u30b9\u30c8
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);
  // \u30ab\u30b9\u30bf\u30e0\u30e2\u30fc\u30c9\uff08\u30c6\u30fc\u30d6\u30eb\u8868\u793a\uff09
  const [isCustomMode, setIsCustomMode] = useState(false);

  // eventSettings.customEvents\u304c\u5916\u90e8\u304b\u3089\u5909\u66f4\u3055\u308c\u305f\u3089\u30ed\u30fc\u30ab\u30eb\u72b6\u614b\u3092\u540c\u671f
  useEffect(() => {
    const firestoreEvents = eventSettings.customEvents || [];
    if (JSON.stringify(customEvents) !== JSON.stringify(firestoreEvents)) {
      setCustomEvents(firestoreEvents);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventSettings.customEvents]);

  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u304c\u5909\u66f4\u3055\u308c\u305f\u3089Firestore\u3092\u66f4\u65b0
  useEffect(() => {
    if (JSON.stringify(customEvents) !== JSON.stringify(eventSettings.customEvents || [])) {
      eventService.updateEvent(eventSettings.id, { customEvents }).catch(err =>
        console.error('\u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u306e\u4fdd\u5b58\u306b\u5931\u6557:', err)
      );
      if (onEventSettingsChange) {
        onEventSettingsChange({ customEvents });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customEvents]);

  // timetableType\u304c\u5909\u308f\u3063\u305f\u3089\u89aa\u306b\u901a\u77e5
  const handleTimetableTypeChange = useCallback((newType: 'performance' | 'rehearsal') => {
    setTimetableType(newType);
    onTimetableTypeChange?.(newType);
  }, [onTimetableTypeChange]);

  // \u65e5\u4ed8\u30ea\u30b9\u30c8
  const dates = useMemo(() => {
    if (timetableType === 'performance') {
      return eventSettings.performanceDates;
    }
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal') {
      return eventSettings.performanceDates;
    }
    return eventSettings.rehearsalDates || [];
  }, [timetableType, eventSettings]);

  const [selectedDate, setSelectedDate] = useState(dates[0] || '');

  // \u73fe\u5728\u306e\u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;
  const onTimetableChange = timetableType === 'performance' ? onPerformanceTimetableChange : onRehearsalTimetableChange;

  // \u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb\u30d8\u30eb\u30d1\u30fc
  const { recalculateTimes, calculateTimes } = useTimetableHelpers({
    bands,
    eventSettings,
    timetableType,
    timetable,
    performanceTimetable,
    rehearsalTimetable,
    selectedDate,
  });

  const currentTimetable: DailyTimetable | null = useMemo(() => {
    const dt = timetable?.dailyTimetables.find(d => d.date === selectedDate);
    if (!dt) return null;
    if (!dt.cools || dt.cools.length === 0) {
      return {
        ...dt,
        cools: [{
          id: `cool-1-${selectedDate}`,
          number: 1,
          entries: dt.entries || [],
        }],
      };
    }
    return dt;
  }, [timetable, selectedDate]);

  const bandNumbers = useMemo(() => calculateBandNumbers(timetable), [timetable]);

  // カスタムフィールド変更ハンドラ
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

  // --- D&Dセットアップ ---
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const sensors = useSensors(touchSensor, pointerSensor);

  const customCollisionDetection = useMemo(() => createTimetableCollisionDetection(), []);

  // \u30c0\u30df\u30fc\u306eDailyTimetable\uff08currentTimetable\u304cnull\u306e\u6642\u306e\u30d5\u30a9\u30fc\u30eb\u30d0\u30c3\u30af\uff09
  const dndTimetable: DailyTimetable = useMemo(() => {
    if (currentTimetable) return currentTimetable;
    return {
      date: selectedDate,
      startTime: '10:00',
      entries: [],
      cools: [{ id: 'empty', number: 1, entries: [] }],
    };
  }, [currentTimetable, selectedDate]);

  const {
    handleBandDropToCool,
    handleBandDropToFlat,
    handleCustomEventDropToCool,
    handleCustomEventDropToFlat,
    handleEntryReorderInCools,
    handleEntryReorderFlat,
  } = useTimetableDragDrop({
    bands,
    customEvents,
    currentTimetable: dndTimetable,
    onTimetableChange,
    calculateTimes,
    recalculateCoolTimes: recalculateTimes,
  });

  const {
    overEntryId,
    isPointerOverCancelZone,
    dropSucceeded,
    cancelAbsorbAnimation,
    clearCancelAbsorbAnimation,
    handleDragStart: baseDragStart,
    handleDragOver,
    handleDragEnd: baseDragEnd,
    getActiveItems,
  } = useDragHandlers({
    bands,
    customEvents,
    currentTimetable: dndTimetable,
    onBandDropToCool: handleBandDropToCool,
    onBandDropToFlat: handleBandDropToFlat,
    onCustomEventDropToCool: handleCustomEventDropToCool,
    onCustomEventDropToFlat: handleCustomEventDropToFlat,
    onEntryReorderInCools: handleEntryReorderInCools,
    onEntryReorderFlat: handleEntryReorderFlat,
  });

  const {
    setNodeRef: setCancelDropRef,
    isOver: isCancelDropOver,
  } = useDroppable({ id: 'mobile-cancel-dropzone' });

  // \u30c9\u30e9\u30c3\u30b0\u958b\u59cb\u6642\u306b\u30dc\u30c8\u30e0\u30b7\u30fc\u30c8\u3092\u6700\u5c0f\u5316
  const handleDragStart = useCallback((event: Parameters<typeof baseDragStart>[0]) => {
    baseDragStart(event);
    // \u30d0\u30f3\u30c9\u30d0\u30f3\u30af\u304b\u3089\u30c9\u30e9\u30c3\u30b0\u958b\u59cb\u6642\u3001\u30dc\u30c8\u30e0\u30b7\u30fc\u30c8\u3092peek\u306b\u7e2e\u5c0f
    const activeId = event.active.id as string;
    if ((activeId.startsWith('band-') || activeId.startsWith('custom-')) && bottomSheetHeight !== 'third') {
      onBottomSheetHeightChange('closed');
    }
    // \u30bf\u30c3\u30d7\u914d\u7f6e\u30e2\u30fc\u30c9\u3092\u89e3\u9664
    if (selectedBandId) onBandPlaced();
    setSelectedCustomEvent(null);
  }, [baseDragStart, onBottomSheetHeightChange, bottomSheetHeight, selectedBandId, onBandPlaced]);

  // \u30c9\u30e9\u30c3\u30b0\u7d42\u4e86\u6642\u306e\u30e9\u30c3\u30d7
  const handleDragEnd = useCallback((event: Parameters<typeof baseDragEnd>[0]) => {
    baseDragEnd(event);
  }, [baseDragEnd]);

  const { activeBand, activeCustomEvent, activeEntry } = getActiveItems();
  const isDraggingFromBank = Boolean(activeBand || activeCustomEvent) && !activeEntry;
  const isCancelTargetVisible = isDraggingFromBank || Boolean(cancelAbsorbAnimation);
  const isCancelZoneActive = isCancelDropOver || overEntryId === 'mobile-cancel-dropzone' || isPointerOverCancelZone;

  // \u5236\u7d04\u30c1\u30a7\u30c3\u30af
  const violations = useAllViolations(performanceTimetable, rehearsalTimetable, bands);

  // \u30a8\u30f3\u30c8\u30ea\u30fcID\u3054\u3068\u306e\u9055\u53cdMap
  const violationsByEntry = useMemo(() => {
    const map = new Map<string, ConstraintViolation[]>();
    violations.forEach(v => {
      const existing = map.get(v.entryId) || [];
      existing.push(v);
      map.set(v.entryId, existing);
    });
    return map;
  }, [violations]);

  // \u4e00\u610f\u306e\u9055\u53cd\u6570
  const uniqueViolationCount = useMemo(() => {
    const uniqueIds = new Set<string>();
    violations.forEach(v => {
      if (v.type === 'duplicate-in-cool') {
        uniqueIds.add(v.id.replace(/-ref-.*$/, ''));
      } else if (v.type === 'consecutive-performance') {
        uniqueIds.add(v.id.replace(/-ref$/, ''));
      } else {
        uniqueIds.add(v.id);
      }
    });
    return uniqueIds.size;
  }, [violations]);

  // 最も重大な違反の判定
  const mostSevereSeverity = useMemo(() => {
    if (violations.some(v => v.severity === 'high')) return 'high';
    if (violations.some(v => v.severity === 'medium')) return 'medium';
    if (violations.some(v => v.severity === 'low')) return 'low';
    return null;
  }, [violations]);

  // 制約違反クリック時にシートを閉じて該当エントリーにスクロール＆ハイライト
  const handleViolationClick = useCallback((violation: ConstraintViolation) => {
    setShowViolationSheet(false);

    // メッセージから本番/リハを判定
    const isRehearsal = violation.message.startsWith('[リハ');
    const targetType = isRehearsal ? 'rehearsal' : 'performance';
    const targetDate = violation.date;

    // タイムテーブルタイプや日付が異なる場合は切り替える
    const needsTypeChange = timetableType !== targetType;
    const needsDateChange = selectedDate !== targetDate;

    const scrollToEntry = () => {
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
    };

    if (needsTypeChange || needsDateChange) {
      if (needsTypeChange) {
        handleTimetableTypeChange(targetType);
      }
      if (needsDateChange) {
        setSelectedDate(targetDate);
      }
      // 状態変更＋シート閉じ後にスクロール
      setTimeout(scrollToEntry, 400);
    } else {
      // 同じタイムテーブル内の場合はシート閉じ後にスクロール
      setTimeout(scrollToEntry, 350);
    }
  }, [timetableType, selectedDate, handleTimetableTypeChange]);

  // \u65e5\u4ed8\u30d5\u30a9\u30fc\u30de\u30c3\u30c8
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['\u65E5', '\u6708', '\u706B', '\u6C34', '\u6728', '\u91D1', '\u571F'];
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
  };

  // \u30d0\u30f3\u30c9\u540d\u53d6\u5f97
  const getBandName = (bandId: string) => {
    return bands.find(b => b.id === bandId)?.name || '\u4E0D\u660E';
  };

  // \u30ea\u30cf\u30fc\u30b5\u30eb\u30bf\u30a4\u30d7\u306e\u5224\u5b9a
  const hasRehearsal = eventSettings.rehearsalType !== 'none';

  // \u9078\u629e\u4e2d\u30d0\u30f3\u30c9\u306e\u540d\u524d
  const selectedBandName = selectedBandId ? getBandName(selectedBandId) : null;

  // \u30dc\u30c8\u30e0\u30b7\u30fc\u30c8\u306b\u96a0\u308c\u306a\u3044\u3088\u3046\u3001\u8868\u793a\u9ad8\u3055\u306b\u5fdc\u3058\u3066\u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb\u4e0b\u4f59\u767d\u3092\u8abf\u6574
  const timetableBottomPadding = useMemo(() => {
    switch (bottomSheetHeight) {
      case 'full':
        return 'calc(92vh + env(safe-area-inset-bottom,0px))';
      case 'half':
        return 'calc(54vh + env(safe-area-inset-bottom,0px))';
      case 'third':
        return 'calc(38vh + env(safe-area-inset-bottom,0px))';
      case 'closed':
      default:
        return 'calc(110px + env(safe-area-inset-bottom,0px))';
    }
  }, [bottomSheetHeight]);

  // --- \u7de8\u96c6\u30cf\u30f3\u30c9\u30e9\u30fc ---

  // \u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb\u66f4\u65b0\u30d8\u30eb\u30d1\u30fc
  const updateTimetable = useCallback((updater: (dt: DailyTimetable) => DailyTimetable) => {
    if (!currentTimetable) return;
    const updated = updater(currentTimetable);
    onTimetableChange(updated);
  }, [currentTimetable, onTimetableChange]);

  // \u30d0\u30f3\u30c9\u3092\u30af\u30fc\u30eb\u306e\u672b\u5c3e\u306b\u914d\u7f6e
  const handlePlaceBandInCool = useCallback((coolIndex: number) => {
    if (!selectedBandId || !currentTimetable) return;
    const band = bands.find(b => b.id === selectedBandId);
    if (!band) return;

    const newEntry: TimetableEntry = {
      id: generateUUID(),
      type: 'band',
      bandId: selectedBandId,
      order: currentTimetable.cools[coolIndex].entries.length,
    };

    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        return { ...cool, entries: [...cool.entries, newEntry] };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
    onBandPlaced();
  }, [selectedBandId, currentTimetable, bands, updateTimetable, recalculateTimes, onBandPlaced]);

  // \u30d0\u30f3\u30c9\u3092\u7279\u5b9a\u4f4d\u7f6e\u306b\u633f\u5165
  const handleInsertBandAt = useCallback((coolIndex: number, insertIndex: number) => {
    if (!selectedBandId || !currentTimetable) return;
    const band = bands.find(b => b.id === selectedBandId);
    if (!band) return;

    const newEntry: TimetableEntry = {
      id: generateUUID(),
      type: 'band',
      bandId: selectedBandId,
      order: insertIndex,
    };

    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        const entries = [...cool.entries];
        entries.splice(insertIndex, 0, newEntry);
        const reordered = entries.map((e, i) => ({ ...e, order: i }));
        return { ...cool, entries: reordered };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
    onBandPlaced();
  }, [selectedBandId, currentTimetable, bands, updateTimetable, recalculateTimes, onBandPlaced]);

  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u3092\u30af\u30fc\u30eb\u306e\u672b\u5c3e\u306b\u914d\u7f6e
  const handlePlaceCustomEventInCool = useCallback((coolIndex: number) => {
    if (!selectedCustomEvent || !currentTimetable) return;

    const newEntry: TimetableEntry = {
      id: generateUUID(),
      type: 'custom',
      customEvent: { ...selectedCustomEvent },
      order: currentTimetable.cools[coolIndex].entries.length,
    };

    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        return { ...cool, entries: [...cool.entries, newEntry] };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
    setSelectedCustomEvent(null);
  }, [selectedCustomEvent, currentTimetable, updateTimetable, recalculateTimes]);

  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u3092\u7279\u5b9a\u4f4d\u7f6e\u306b\u633f\u5165
  const handleInsertCustomEventAt = useCallback((coolIndex: number, insertIndex: number) => {
    if (!selectedCustomEvent || !currentTimetable) return;

    const newEntry: TimetableEntry = {
      id: generateUUID(),
      type: 'custom',
      customEvent: { ...selectedCustomEvent },
      order: insertIndex,
    };

    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        const entries = [...cool.entries];
        entries.splice(insertIndex, 0, newEntry);
        const reordered = entries.map((e, i) => ({ ...e, order: i }));
        return { ...cool, entries: reordered };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
    setSelectedCustomEvent(null);
  }, [selectedCustomEvent, currentTimetable, updateTimetable, recalculateTimes]);

  // \u30a8\u30f3\u30c8\u30ea\u30fc\u524a\u9664
  const handleRemoveEntry = useCallback((coolIndex: number, entryId: string) => {
    if (!currentTimetable) return;
    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        const entries = cool.entries.filter(e => e.id !== entryId).map((e, i) => ({ ...e, order: i }));
        return { ...cool, entries };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
    setExpandedEntryId(null);
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // \u30a8\u30f3\u30c8\u30ea\u30fc\u79fb\u52d5 (up/down)
  const handleMoveEntry = useCallback((coolIndex: number, entryIndex: number, direction: 'up' | 'down') => {
    if (!currentTimetable) return;
    const cool = currentTimetable.cools[coolIndex];
    if (!cool) return;
    const targetIndex = direction === 'up' ? entryIndex - 1 : entryIndex + 1;
    if (targetIndex < 0 || targetIndex >= cool.entries.length) return;

    updateTimetable((dt) => {
      const newCools = dt.cools.map((c, ci) => {
        if (ci !== coolIndex) return c;
        const entries = [...c.entries];
        [entries[entryIndex], entries[targetIndex]] = [entries[targetIndex], entries[entryIndex]];
        const reordered = entries.map((e, i) => ({ ...e, order: i }));
        return { ...c, entries: reordered };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // \u958b\u59cb\u6642\u523b\u5909\u66f4
  const handleStartTimeChange = useCallback((newStartTime: string) => {
    if (!currentTimetable) return;
    updateTimetable((dt) => {
      const recalculated = recalculateTimes(dt.cools, newStartTime);
      return { ...dt, startTime: newStartTime, cools: recalculated };
    });
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // クール数変更を実行
  const applyCoolCountChange = useCallback((newCount: number, reductionAction: 'move' | 'bank' = 'move') => {
    if (!currentTimetable) return;
    const currentCount = currentTimetable.cools.length;
    if (newCount < 1 || newCount === currentCount) return;

    updateTimetable((dt) => {
      let newCools: Cool[];
      if (newCount > currentCount) {
        newCools = [...dt.cools];
        for (let i = currentCount; i < newCount; i++) {
          newCools.push({
            id: `cool-${i + 1}-${selectedDate}`,
            number: i + 1,
            entries: [],
          });
        }
      } else {
        const keptCools = dt.cools.slice(0, newCount);
        const removedCools = dt.cools.slice(newCount);

        if (reductionAction === 'move' && keptCools.length > 0) {
          const movedEntries = removedCools.flatMap(cool => cool.entries);
          if (movedEntries.length > 0) {
            const lastIndex = keptCools.length - 1;
            keptCools[lastIndex] = {
              ...keptCools[lastIndex],
              entries: [...keptCools[lastIndex].entries, ...movedEntries],
            };
          }
        }

        // 'bank' の場合は removedCools の項目を破棄（= バンドバンクへ戻す）
        newCools = keptCools;
      }
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
  }, [currentTimetable, selectedDate, updateTimetable, recalculateTimes]);

  // クール数変更（必要なら選択モーダルを表示）
  const handleCoolCountChange = useCallback((newCount: number) => {
    if (!currentTimetable) return;
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

    applyCoolCountChange(newCount, 'move');
  }, [currentTimetable, applyCoolCountChange]);

  const executeCoolReduction = useCallback((action: 'move' | 'bank') => {
    if (!coolReductionModal) return;
    applyCoolCountChange(coolReductionModal.pendingCount, action);
    setCoolReductionModal(null);
  }, [coolReductionModal, applyCoolCountChange]);

  // \u8ee2\u63db\u6642\u9593\u5909\u66f4
  const handleTransitionTimeChange = useCallback((coolIndex: number, entryId: string, newTime: number) => {
    if (!currentTimetable) return;
    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        const entries = cool.entries.map(e => {
          if (e.id !== entryId) return e;
          return { ...e, transitionTime: newTime > 0 ? newTime : undefined };
        });
        return { ...cool, entries };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // \u30af\u30fc\u30eb\u958b\u59cb\u6642\u523b\u8a2d\u5b9a
  const handleCoolStartTimeChange = useCallback((coolIndex: number, startTime: string | undefined) => {
    if (!currentTimetable) return;
    updateTimetable((dt) => {
      const newCools = dt.cools.map((cool, ci) => {
        if (ci !== coolIndex) return cool;
        if (startTime === undefined) {
          // Firestoreはundefinedを保存できないため、キー自体を除去する
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { startTime: _removedStartTime, ...coolWithoutStartTime } = cool;
          return coolWithoutStartTime;
        }
        return { ...cool, startTime };
      });
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u4f5c\u6210
  const handleCreateCustomEvent = useCallback(() => {
    const name = customEventName.trim();
    const duration = parseInt(customEventDuration, 10);
    if (!name || isNaN(duration) || duration <= 0) return;

    const newEvent: CustomEvent = {
      id: generateUUID(),
      name,
      duration,
    };
    setCustomEvents(prev => [...prev, newEvent]);
    setCustomEventName('');
    setCustomEventDuration('5');
    setShowCustomEventSheet(false);
  }, [customEventName, customEventDuration]);

  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u524a\u9664
  const handleDeleteCustomEvent = useCallback((eventId: string) => {
    setCustomEvents(prev => prev.filter(e => e.id !== eventId));
  }, []);

  // \u914d\u7f6e\u4e2d\u304b\u3069\u3046\u304b\u306e\u5224\u5b9a(\u30d0\u30f3\u30c9 or \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8)
  const isPlacingItem = selectedBandId !== null || selectedCustomEvent !== null;
  const placingItemName = selectedBandId
    ? selectedBandName
    : selectedCustomEvent
      ? selectedCustomEvent.name
      : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      autoScroll={{
        threshold: { x: 0, y: 0.15 },
        acceleration: 5,
      }}
    >
    <div className="flex flex-col h-full">
      {/* \u914d\u7f6e\u4e2d\u30d0\u30ca\u30fc */}
      <AnimatePresence>
        {isPlacingItem && placingItemName && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={`flex-shrink-0 ${selectedCustomEvent ? 'bg-purple-500' : 'bg-emerald-500'} text-white px-3 py-2 flex items-center justify-between overflow-hidden`}
          >
            <span className="text-sm font-medium">
              {selectedCustomEvent ? '\uD83D\uDCCB' : '\uD83C\uDFB5'} {'\u300C'}{placingItemName}{'\u300D'}{'\u3092\u914D\u7F6E\u4E2D'} {'\u2014'} {'\u30BF\u30C3\u30D7\u3067\u633F\u5165'}
            </span>
            <button
              onClick={() => {
                if (selectedBandId) onBandPlaced();
                setSelectedCustomEvent(null);
              }}
              className={`${selectedCustomEvent ? 'text-purple-100' : 'text-emerald-100'} hover:text-white text-xs underline flex-shrink-0 ml-2`}
            >
              {'\u30AD\u30E3\u30F3\u30BB\u30EB'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* \u4e0a\u90e8\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb */}
      <div className="flex-shrink-0 px-3 py-2 space-y-2 bg-white border-b border-gray-100">
        {/* \u672c\u756a/\u30ea\u30cf\u30fc\u30b5\u30eb\u5207\u308a\u66ff\u3048 */}
        {hasRehearsal && (
          <div className="flex gap-1">
            <button
              onClick={() => {
                handleTimetableTypeChange('performance');
                if (!eventSettings.performanceDates.includes(selectedDate)) {
                  setSelectedDate(eventSettings.performanceDates[0] || '');
                }
              }}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                timetableType === 'performance'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {'\u672C\u756A'}
            </button>
            <button
              onClick={() => {
                handleTimetableTypeChange('rehearsal');
                const rehDates = (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
                  ? eventSettings.performanceDates
                  : eventSettings.rehearsalDates || [];
                if (rehDates.length > 0 && !rehDates.includes(selectedDate)) {
                  setSelectedDate(rehDates[0]);
                }
              }}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                timetableType === 'rehearsal'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {'\u30EA\u30CF\u30FC\u30B5\u30EB'}
            </button>
          </div>
        )}

        {/* \u65e5\u4ed8\u30bb\u30ec\u30af\u30bf\u30fc */}
        {dates.length > 1 && (
          <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedDate === date
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                    : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                {formatDate(date)}
              </button>
            ))}
          </div>
        )}

        {/* \u958b\u59cb\u6642\u523b + \u30af\u30fc\u30eb\u6570\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb + \u9055\u53cd\u30d0\u30c3\u30b8 */}
        {currentTimetable && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
              <span className="whitespace-nowrap">{'\u958B\u59CB'}:</span>
              <MobileTimeInput
                value={currentTimetable.startTime}
                onChange={(next) => {
                  if (!next) return;
                  handleStartTimeChange(next);
                }}
                nativeInputClassName="h-9 border border-emerald-200 rounded-md px-2 text-[16px] leading-none text-emerald-700 bg-white focus:outline-none focus:border-emerald-400 w-[120px]"
                fallbackContainerClassName="flex items-center gap-1"
                fallbackSelectClassName="h-9 border border-emerald-200 rounded-md px-2 text-[16px] leading-none text-emerald-700 bg-white focus:outline-none focus:border-emerald-400"
              />
              {dates.length === 1 && (
                <span className="text-gray-400">{'\u2022'} {formatDate(selectedDate)}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* \u30ab\u30b9\u30bf\u30e0\u30e2\u30fc\u30c9\u30c8\u30b0\u30eb */}
              <button
                onClick={() => setIsCustomMode(!isCustomMode)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                  isCustomMode
                    ? 'bg-blue-100 text-blue-700 border border-blue-300'
                    : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {'\u30C6\u30FC\u30D6\u30EB'}
              </button>
              {/* \u9055\u53cd\u30d0\u30c3\u30b8 */}
              {uniqueViolationCount > 0 && (
                <button
                  onClick={() => setShowViolationSheet(true)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    mostSevereSeverity === 'high' ? 'bg-rose-50 border border-rose-200 text-rose-600' :
                    mostSevereSeverity === 'medium' ? 'bg-amber-50 border border-amber-200 text-amber-600' :
                    'bg-sky-50 border border-sky-200 text-sky-600'
                  }`}
                >
                  <span className="text-xs">
                    {mostSevereSeverity === 'high' ? '🚫' : mostSevereSeverity === 'medium' ? '⚠️' : 'ℹ️'}
                  </span>
                  {uniqueViolationCount}
                </button>
              )}
              {/* \u30af\u30fc\u30eb\u6570\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb\uff08\u30ab\u30b9\u30bf\u30e0\u30e2\u30fc\u30c9\u6642\u306f\u975e\u8868\u793a\uff09 */}
              {!isCustomMode && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">{'\u30AF\u30FC\u30EB'}:</span>
                  <button
                    onClick={() => handleCoolCountChange(currentTimetable.cools.length - 1)}
                    disabled={currentTimetable.cools.length <= 1}
                    className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-sm font-bold flex items-center justify-center disabled:opacity-30 active:bg-gray-200"
                  >
                    {'\u2212'}
                  </button>
                  <span className="text-xs font-medium text-gray-700 w-4 text-center">
                    {currentTimetable.cools.length}
                  </span>
                  <button
                    onClick={() => handleCoolCountChange(currentTimetable.cools.length + 1)}
                    className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold flex items-center justify-center active:bg-emerald-200"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* \u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb\u672c\u4f53 */}
      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: timetableBottomPadding }}>
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400 text-sm">{'\u8AAD\u307F\u8FBC\u307F\u4E2D...'}</p>
          </div>
        ) : !currentTimetable || !currentTimetable.cools || currentTimetable.cools.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">{'\uD83D\uDCCB'}</div>
            <p className="text-gray-400 text-sm">{'\u30BF\u30A4\u30E0\u30C6\u30FC\u30D6\u30EB\u304C\u307E\u3060\u4F5C\u6210\u3055\u308C\u3066\u3044\u307E\u305B\u3093'}</p>
            <button
              onClick={onOpenBandBank}
              className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium"
            >
              {'\u30D0\u30F3\u30C9\u3092\u914D\u7F6E\u3059\u308B'}
            </button>
          </div>
        ) : isCustomMode ? (
          <div className="px-2 py-2">
            <CustomFieldsTable
              currentTimetable={currentTimetable}
              bands={bands}
              timetable={timetable}
              eventSettings={eventSettings}
              timetableType={timetableType}
              selectedDate={selectedDate}
              onCustomFieldsChange={handleCustomFieldsChange}
              readOnly={false}
            />
          </div>
        ) : (
          <div className="px-3 py-3 space-y-3">
            {currentTimetable.cools.map((cool, coolIndex) => (
              <CoolCard
                key={cool.id}
                cool={cool}
                coolIndex={coolIndex}
                totalCools={currentTimetable.cools.length}
                bands={bands}
                bandNumbers={bandNumbers}
                getBandName={getBandName}
                selectedBandId={selectedBandId}
                selectedCustomEvent={selectedCustomEvent}
                expandedEntryId={expandedEntryId}
                violationsByEntry={violationsByEntry}
                overEntryId={overEntryId}
                onToggleExpand={(entryId) =>
                  setExpandedEntryId(prev => prev === entryId ? null : entryId)
                }
                onPlaceBand={() => handlePlaceBandInCool(coolIndex)}
                onInsertBandAt={(insertIndex) => handleInsertBandAt(coolIndex, insertIndex)}
                onPlaceCustomEvent={() => handlePlaceCustomEventInCool(coolIndex)}
                onInsertCustomEventAt={(insertIndex) => handleInsertCustomEventAt(coolIndex, insertIndex)}
                onRemoveEntry={(entryId) => handleRemoveEntry(coolIndex, entryId)}
                onMoveEntry={(entryIndex, direction) => handleMoveEntry(coolIndex, entryIndex, direction)}
                onTransitionTimeChange={(entryId, time) => handleTransitionTimeChange(coolIndex, entryId, time)}
                onCoolStartTimeChange={(startTime) => handleCoolStartTimeChange(coolIndex, startTime)}
              />
            ))}
          </div>
        )}
      </div>

      {/* カスタムイベントシート */}
      <AnimatePresence>
        {showCustomEventSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setShowCustomEventSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-2" />
              <div className="px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <h3 className="text-sm font-bold text-gray-900 mb-3">{'\u30AB\u30B9\u30BF\u30E0\u30A4\u30D9\u30F3\u30C8'}</h3>

                {/* \u65e2\u5b58\u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u30ea\u30b9\u30c8 */}
                {customEvents.length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    <p className="text-xs text-gray-500 mb-1">{'\u4F5C\u6210\u6E08\u307F'}</p>
                    {customEvents.map((ce) => (
                      <div key={ce.id} className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSelectedCustomEvent(ce);
                            setShowCustomEventSheet(false);
                          }}
                          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                            selectedCustomEvent?.id === ce.id
                              ? 'bg-purple-50 border-purple-300 text-purple-700'
                              : 'bg-gray-50 border-gray-200 text-gray-700 active:bg-gray-100'
                          }`}
                        >
                          <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {ce.name.charAt(0)}
                          </span>
                          <span className="text-sm flex-1">{ce.name}</span>
                          <span className="text-xs text-gray-400">{ce.duration}{'\u5206'}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCustomEvent(ce.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* \u65b0\u898f\u4f5c\u6210\u30d5\u30a9\u30fc\u30e0 */}
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-500 mb-2">{'\u65B0\u898F\u4F5C\u6210'}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customEventName}
                      onChange={(e) => setCustomEventName(e.target.value)}
                      placeholder={'\u4F8B: \u4F11\u61A9, MC, \u30EA\u30CF\u30FC\u30B5\u30EB'}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-400"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={customEventDuration}
                        onChange={(e) => setCustomEventDuration(e.target.value)}
                        className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:border-purple-400"
                        min="1"
                      />
                      <span className="text-xs text-gray-500">{'\u5206'}</span>
                    </div>
                    <button
                      onClick={handleCreateCustomEvent}
                      disabled={!customEventName.trim() || !customEventDuration}
                      className="px-3 py-2 bg-purple-500 text-white rounded-lg text-sm font-medium disabled:opacity-40 active:bg-purple-600"
                    >
                      {'\u4F5C\u6210'}
                    </button>
                  </div>
                  {/* \u30d7\u30ea\u30bb\u30c3\u30c8\u30dc\u30bf\u30f3 */}
                  <div className="flex gap-1.5 mt-2">
                    {[
                      { name: '\u4F11\u61A9', duration: 10 },
                      { name: 'MC', duration: 5 },
                      { name: '\u8EE2\u63DB', duration: 3 },
                    ].map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => {
                          setCustomEventName(preset.name);
                          setCustomEventDuration(String(preset.duration));
                        }}
                        className="px-2.5 py-1 bg-purple-50 text-purple-600 rounded text-[10px] font-medium border border-purple-200 active:bg-purple-100"
                      >
                        {preset.name} ({preset.duration}{'\u5206'})
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* \u9055\u53cd\u30d1\u30cd\u30eb\u30b7\u30fc\u30c8 */}
      <AnimatePresence>
        {showViolationSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setShowViolationSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl max-h-[70vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-2 flex-shrink-0" />
              <div className="px-4 pt-3 pb-2 flex-shrink-0">
                <h3 className="text-sm font-bold text-gray-900">{'\u5236\u7D04\u9055\u53CD'} ({uniqueViolationCount}{'\u4EF6'})</h3>
              </div>
              <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <ViolationList violations={violations} onViolationClick={handleViolationClick} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {coolReductionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setCoolReductionModal(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto mt-2" />
              <div className="px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <h3 className="text-sm font-bold text-gray-900 mb-2">クール数を減らす確認</h3>
                <p className="text-xs text-gray-600 mb-3">
                  一番下の削除対象クールに {coolReductionModal.entryCount} 件の項目があります。処理方法を選択してください。
                </p>
                <div className="space-y-2">
                  <button
                    onClick={() => executeCoolReduction('move')}
                    className="w-full px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium active:bg-emerald-700"
                  >
                    ひとつ前のクール末尾に追加
                  </button>
                  <button
                    onClick={() => executeCoolReduction('bank')}
                    className="w-full px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium active:bg-amber-700"
                  >
                    バンドバンクに戻す
                  </button>
                  <button
                    onClick={() => setCoolReductionModal(null)}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium active:bg-gray-200"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDraggingFromBank && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: isCancelZoneActive ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/25 pointer-events-none"
          />
        )}
      </AnimatePresence>

      <div
        ref={setCancelDropRef}
        id="mobile-cancel-dropzone"
        className="fixed inset-x-0 bottom-0 z-[65]"
        style={{
          height: 'calc(60px + env(safe-area-inset-bottom,0px) + 118px)',
          pointerEvents: isDraggingFromBank ? 'auto' : 'none',
        }}
      />

      <motion.div
        className="fixed inset-x-0 z-[70] bottom-[calc(60px+env(safe-area-inset-bottom,0px)+6px)] h-28 flex items-end justify-center pointer-events-none"
        animate={{ opacity: isCancelTargetVisible ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <motion.div
          id="mobile-cancel-icon"
          animate={{ scale: isCancelZoneActive ? 1.12 : 1, y: isCancelTargetVisible ? 0 : 12 }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
          className={`w-16 h-16 rounded-full border-2 shadow-xl flex items-center justify-center select-none ${
            isCancelZoneActive
              ? 'bg-red-600 border-red-500 text-white'
              : 'bg-white border-red-300 text-red-500'
          }`}
        >
          <span className="text-3xl leading-none">×</span>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {cancelAbsorbAnimation && (
          <motion.div
            key={cancelAbsorbAnimation.id}
            initial={{
              left: cancelAbsorbAnimation.startX,
              top: cancelAbsorbAnimation.startY,
              opacity: 0.95,
            }}
            animate={{
              left: cancelAbsorbAnimation.endX,
              top: cancelAbsorbAnimation.endY,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            onAnimationComplete={clearCancelAbsorbAnimation}
            className="fixed z-[130] pointer-events-none"
          >
            <div className="-translate-x-1/2 -translate-y-1/2">
              <motion.div
                initial={{ scale: 1 }}
                animate={{ scale: 0.14 }}
                exit={{ scale: 0.14 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ width: cancelAbsorbAnimation.cardWidth }}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 shadow-xl border ${
                  cancelAbsorbAnimation.kind === 'band'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-purple-50 border-purple-200'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    cancelAbsorbAnimation.kind === 'band'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-purple-500 text-white'
                  }`}
                >
                  {cancelAbsorbAnimation.kind === 'band' ? (cancelAbsorbAnimation.label.charAt(0) || 'B') : '★'}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      cancelAbsorbAnimation.kind === 'band' ? 'text-gray-900' : 'text-gray-900'
                    }`}
                  >
                    {cancelAbsorbAnimation.label}
                  </p>
                  <p
                    className={`text-[10px] ${
                      cancelAbsorbAnimation.kind === 'band' ? 'text-gray-500' : 'text-gray-500'
                    }`}
                  >
                    {cancelAbsorbAnimation.subLabel}
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>

      {/* D&D\u30c9\u30e9\u30c3\u30b0\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4 */}
      <TimetableDragOverlay
        activeBand={activeBand}
        activeCustomEvent={activeCustomEvent}
        activeEntry={activeEntry}
        bands={bands}
        dropSucceeded={dropSucceeded}
      />

      {/* ボトムシート（バンドバンク / 列管理）- DndContext内に配置 */}
      <MobileBottomSheet
        height={bottomSheetHeight}
        onHeightChange={onBottomSheetHeightChange}
        title={isCustomMode ? '列管理' : 'バンドバンク'}
      >
        {isCustomMode ? (
          <CustomColumnManager
            customFields={eventSettings.customFields}
            timetableType={timetableType}
            onCustomFieldsChange={handleCustomFieldsChange}
            applyToBoth={false}
            mobile
          />
        ) : (
          <MobileBandBank
            bands={bands}
            timetableType={timetableType}
            performanceTimetable={performanceTimetable}
            rehearsalTimetable={rehearsalTimetable}
            selectedBandId={selectedBandId}
            onSelectBand={onSelectBand}
            customEvents={customEvents}
            selectedCustomEvent={selectedCustomEvent}
            onSelectCustomEvent={(event) => {
              setSelectedCustomEvent(event);
              if (event) onSelectBand(null);
            }}
            onDeleteCustomEvent={handleDeleteCustomEvent}
            onShowCreateCustomEvent={() => setShowCustomEventSheet(true)}
          />
        )}
      </MobileBottomSheet>
    </DndContext>
  );
};

// 違反リストコンポーネント（アコーディオン形式）
const ViolationList = ({ violations, onViolationClick }: { violations: ConstraintViolation[]; onViolationClick?: (v: ConstraintViolation) => void }) => {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['performance', 'rehearsal']));

  // 一意の違反のみを抽出
  const uniqueViolations = useMemo(() => {
    const map = new Map<string, ConstraintViolation>();
    violations.forEach(v => {
      if (v.type === 'duplicate-in-cool') {
        const baseId = v.id.replace(/-ref-.*$/, '');
        if (!v.id.includes('-ref-')) map.set(baseId, v);
      } else if (v.type === 'consecutive-performance') {
        const baseId = v.id.replace(/-ref$/, '');
        if (!v.id.includes('-ref')) map.set(baseId, v);
      } else {
        map.set(v.id, v);
      }
    });
    return Array.from(map.values());
  }, [violations]);

  // 本番・リハに分類
  const performanceViolations = uniqueViolations.filter(v => v.message.startsWith('[本番'));
  const rehearsalViolations = uniqueViolations.filter(v => v.message.startsWith('[リハ'));

  // 最も重大な違反を判定
  const getMostSeverity = (list: ConstraintViolation[]): 'high' | 'medium' | 'low' | null => {
    if (list.some(v => v.severity === 'high')) return 'high';
    if (list.some(v => v.severity === 'medium')) return 'medium';
    if (list.some(v => v.severity === 'low')) return 'low';
    return null;
  };

  const performanceSeverity = getMostSeverity(performanceViolations);
  const rehearsalSeverity = getMostSeverity(rehearsalViolations);

  // 重大度ごとの色・記号
  const severityConfig = {
    high: { icon: '🚫', bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-600' },
    medium: { icon: '⚠️', bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-600' },
    low: { icon: 'ℹ️', bg: 'bg-sky-100', border: 'border-sky-300', text: 'text-sky-600' },
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // 重大度でソートしたviolationsを返す
  const sortByPriority = (list: ConstraintViolation[]) => {
    const priority = { high: 0, medium: 1, low: 2 };
    return [...list].sort((a, b) => priority[a.severity] - priority[b.severity]);
  };

  // セクションのレンダリング
  const renderSection = (
    title: string,
    sectionKey: string,
    sectionViolations: ConstraintViolation[],
    severity: 'high' | 'medium' | 'low' | null
  ) => {
    if (sectionViolations.length === 0) return null;

    const config = severity ? severityConfig[severity] : severityConfig.medium;
    const isExpanded = expandedSections.has(sectionKey);
    const sorted = sortByPriority(sectionViolations);
    const highCount = sectionViolations.filter(v => v.severity === 'high').length;
    const mediumCount = sectionViolations.filter(v => v.severity === 'medium').length;
    const lowCount = sectionViolations.filter(v => v.severity === 'low').length;

    return (
      <div className="mb-3">
        <button
          onClick={() => toggleSection(sectionKey)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg ${config.bg} ${config.border} border active:opacity-80`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">{config.icon}</span>
            <span className={`font-bold text-sm ${config.text}`}>{title}</span>
            <span className="text-[10px] text-gray-500">
              ({sectionViolations.length}件)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 text-[9px]">
              {highCount > 0 && <span className="text-rose-600">🚫{highCount}</span>}
              {mediumCount > 0 && <span className="text-amber-600">⚠️{mediumCount}</span>}
              {lowCount > 0 && <span className="text-sky-600">ℹ️{lowCount}</span>}
            </div>
            <motion.span
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-xs"
            >▼</motion.span>
          </div>
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-1.5 pl-1">
                {sorted.map((v) => {
                  const itemConfig = severityConfig[v.severity];
                  return (
                    <div
                      key={v.id}
                      className={`text-xs px-2 py-1.5 rounded cursor-pointer active:opacity-70 ${
                        v.severity === 'high' ? 'bg-rose-50 text-rose-700' :
                        v.severity === 'medium' ? 'bg-amber-50 text-amber-700' :
                        'bg-sky-50 text-sky-700'
                      }`}
                      onClick={() => onViolationClick?.(v)}
                    >
                      {itemConfig.icon} {v.message}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div>
      {renderSection('本番', 'performance', performanceViolations, performanceSeverity)}
      {renderSection('リハーサル', 'rehearsal', rehearsalViolations, rehearsalSeverity)}
    </div>
  );
};

// \u30c9\u30ed\u30c3\u30d7\u53ef\u80fd\u306a\u30a8\u30f3\u30c8\u30ea\u30fc\u30e9\u30c3\u30d1\u30fc
const SortableEntry = ({
  entryId,
  overEntryId,
  children,
}: {
  entryId: string;
  overEntryId: string | null;
  children: (props: { dragHandleProps: Record<string, unknown> }) => React.ReactNode;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `entry-${entryId}` });

  const isDropBefore = overEntryId === `entry-${entryId}`;
  const isDropAfter = overEntryId === `entry-${entryId}-after`;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? 'relative' as const : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isDropBefore && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center">
          <div className="w-2 h-2 rounded-full bg-emerald-500 -ml-1" />
          <div className="flex-1 h-0.5 bg-emerald-500" />
        </div>
      )}
      {children({ dragHandleProps: { ...listeners, ...attributes, style: { touchAction: 'none' } } })}
      {isDropAfter && (
        <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center">
          <div className="w-2 h-2 rounded-full bg-emerald-500 -ml-1" />
          <div className="flex-1 h-0.5 bg-emerald-500" />
        </div>
      )}
    </div>
  );
};

// \u30c9\u30ed\u30c3\u30d7\u53ef\u80fd\u306a\u30af\u30fc\u30eb\u30d8\u30c3\u30c0\u30fc
const DroppableCoolHeader = ({
  coolIndex,
  children,
}: {
  coolIndex: number;
  children: React.ReactNode;
}) => {
  const { setNodeRef } = useDroppable({ id: `cool-header-${coolIndex}` });
  return <div ref={setNodeRef}>{children}</div>;
};

// \u30c9\u30ed\u30c3\u30d7\u53ef\u80fd\u306a\u30af\u30fc\u30eb\u30be\u30fc\u30f3\uff08\u7a7a\u306e\u30af\u30fc\u30eb\u306e\u672b\u5c3e\uff09
const DroppableCoolZone = ({
  coolIndex,
  children,
}: {
  coolIndex: number;
  children: React.ReactNode;
}) => {
  const { setNodeRef } = useDroppable({ id: `cool-droppable-${coolIndex}` });
  return <div ref={setNodeRef}>{children}</div>;
};

// \u30af\u30fc\u30eb\u30ab\u30fc\u30c9
const CoolCard = ({
  cool,
  coolIndex,
  totalCools,
  bands,
  bandNumbers,
  getBandName,
  selectedBandId,
  selectedCustomEvent,
  expandedEntryId,
  violationsByEntry,
  overEntryId,
  onToggleExpand,
  onPlaceBand,
  onInsertBandAt,
  onPlaceCustomEvent,
  onInsertCustomEventAt,
  onRemoveEntry,
  onMoveEntry,
  onTransitionTimeChange,
  onCoolStartTimeChange,
}: {
  cool: Cool;
  coolIndex: number;
  totalCools: number;
  bands: Band[];
  bandNumbers: Map<string, number>;
  getBandName: (bandId: string) => string;
  selectedBandId: string | null;
  selectedCustomEvent: CustomEvent | null;
  expandedEntryId: string | null;
  violationsByEntry: Map<string, ConstraintViolation[]>;
  overEntryId: string | null;
  onToggleExpand: (entryId: string) => void;
  onPlaceBand: () => void;
  onInsertBandAt: (insertIndex: number) => void;
  onPlaceCustomEvent: () => void;
  onInsertCustomEventAt: (insertIndex: number) => void;
  onRemoveEntry: (entryId: string) => void;
  onMoveEntry: (entryIndex: number, direction: 'up' | 'down') => void;
  onTransitionTimeChange: (entryId: string, time: number) => void;
  onCoolStartTimeChange: (startTime: string | undefined) => void;
}) => {
  const [showCoolStartTime, setShowCoolStartTime] = useState(!!cool.startTime);
  const isPlacing = selectedBandId !== null || selectedCustomEvent !== null;

  const handlePlace = () => {
    if (selectedBandId) onPlaceBand();
    else if (selectedCustomEvent) onPlaceCustomEvent();
  };

  const handleInsertAt = (insertIndex: number) => {
    if (selectedBandId) onInsertBandAt(insertIndex);
    else if (selectedCustomEvent) onInsertCustomEventAt(insertIndex);
  };

  // \u633f\u5165\u30be\u30fc\u30f3\u30b3\u30f3\u30dd\u30fc\u30cd\u30f3\u30c8
  const InsertionZone = ({ insertIndex }: { insertIndex: number }) => {
    if (!isPlacing) return null;
    const isCustom = selectedCustomEvent !== null;
    return (
      <button
        onClick={() => handleInsertAt(insertIndex)}
        className="w-full py-1 flex items-center justify-center gap-1 group"
      >
        <div className={`flex-1 h-px ${isCustom ? 'bg-purple-300 group-active:bg-purple-500' : 'bg-emerald-300 group-active:bg-emerald-500'}`} />
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
          isCustom
            ? 'text-purple-500 border-purple-300 bg-purple-50 group-active:bg-purple-100'
            : 'text-emerald-500 border-emerald-300 bg-emerald-50 group-active:bg-emerald-100'
        }`}>
          + {'\u3053\u3053\u306B\u633F\u5165'}
        </span>
        <div className={`flex-1 h-px ${isCustom ? 'bg-purple-300 group-active:bg-purple-500' : 'bg-emerald-300 group-active:bg-emerald-500'}`} />
      </button>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* \u30af\u30fc\u30eb\u30d8\u30c3\u30c0\u30fc */}
      <DroppableCoolHeader coolIndex={coolIndex}>
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-emerald-700">
            {totalCools > 1 ? `\u7B2C${cool.number}\u30AF\u30FC\u30EB` : '\u30BF\u30A4\u30E0\u30C6\u30FC\u30D6\u30EB'}
          </span>
          {/* \u30af\u30fc\u30eb\u958b\u59cb\u6642\u523b */}
          {totalCools > 1 && coolIndex > 0 && (
            <div className="flex items-center gap-1">
              {showCoolStartTime ? (
                <div className="flex items-center gap-1">
                  <MobileTimeInput
                    value={cool.startTime || ''}
                    onChange={(next) => {
                      if (!next) {
                        setShowCoolStartTime(false);
                        onCoolStartTimeChange(undefined);
                        return;
                      }
                      onCoolStartTimeChange(next);
                    }}
                    allowEmpty
                    nativeInputClassName="h-8 border border-emerald-200 rounded-md px-2 text-[16px] leading-none text-emerald-700 focus:outline-none focus:border-emerald-400 w-[112px] bg-white"
                    fallbackContainerClassName="flex items-center gap-1"
                    fallbackSelectClassName="h-8 border border-emerald-200 rounded-md px-2 text-[16px] leading-none text-emerald-700 focus:outline-none focus:border-emerald-400 bg-white"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowCoolStartTime(true)}
                  className="text-[10px] text-emerald-500 underline"
                >
                  {'\u6642\u523B\u8A2D\u5B9A'}
                </button>
              )}
            </div>
          )}
          {cool.startTime && !showCoolStartTime && coolIndex > 0 && (
            <span className="text-xs text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
              {cool.startTime}{'\u301C'}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{cool.entries.length}{'\u7D44'}</span>
      </div>
      </DroppableCoolHeader>

      {/* \u30a8\u30f3\u30c8\u30ea\u30fc\u30ea\u30b9\u30c8 */}
      {cool.entries.length === 0 ? (
        <DroppableCoolZone coolIndex={coolIndex}>
        <div className="px-3 py-4">
          {isPlacing ? (
            <button
              onClick={handlePlace}
              className={`w-full py-3 border-2 border-dashed rounded-lg text-xs font-medium ${
                selectedCustomEvent
                  ? 'border-purple-300 text-purple-600 bg-purple-50 active:bg-purple-100'
                  : 'border-emerald-300 text-emerald-600 bg-emerald-50 active:bg-emerald-100'
              }`}
            >
              + {'\u30BF\u30C3\u30D7\u3057\u3066\u914D\u7F6E'}
            </button>
          ) : (
            <div className="text-center text-xs text-gray-400">
              {'\u30A8\u30F3\u30C8\u30EA\u30FC\u304C\u3042\u308A\u307E\u305B\u3093'}
            </div>
          )}
        </div>
        </DroppableCoolZone>
      ) : (
        <SortableContext items={cool.entries.map(e => `entry-${e.id}`)} strategy={verticalListSortingStrategy}>
        <div>
          {cool.entries.map((entry, entryIndex) => {
            const isBand = entry.type === 'band';
            const band = isBand ? bands.find(b => b.id === entry.bandId) : null;
            const bandNum = entry.bandId ? bandNumbers.get(entry.bandId) : undefined;
            const isExpanded = expandedEntryId === entry.id;
            const entryViolations = violationsByEntry.get(entry.id) || [];
            const hasViolation = entryViolations.length > 0;
            const highestSeverity = entryViolations.reduce((max, v) => {
              const order = { high: 3, medium: 2, low: 1 };
              return order[v.severity] > order[max] ? v.severity : max;
            }, 'low' as 'high' | 'medium' | 'low');

            return (
              <SortableEntry key={entry.id} entryId={entry.id} overEntryId={overEntryId}>
                {({ dragHandleProps }) => (<>
                {/* \u633f\u5165\u30be\u30fc\u30f3 */}
                <InsertionZone insertIndex={entryIndex} />

                {/* \u30a8\u30f3\u30c8\u30ea\u30fc\u884c */}
                <div
                  data-entry-id={entry.id}
                  onClick={() => onToggleExpand(entry.id)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-gray-50' : 'active:bg-gray-50'
                  } ${hasViolation ? (
                    highestSeverity === 'high' ? 'border-l-2 border-l-red-400' :
                    highestSeverity === 'medium' ? 'border-l-2 border-l-amber-400' :
                    'border-l-2 border-l-blue-400'
                  ) : ''}`}
                >
                  {/* \u30c9\u30e9\u30c3\u30b0\u30cf\u30f3\u30c9\u30eb */}
                  <div
                    {...dragHandleProps}
                    className="flex-shrink-0 touch-manipulation cursor-grab active:cursor-grabbing text-gray-300 active:text-emerald-500 p-0.5 -ml-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="9" cy="6" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" />
                      <circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </div>

                  {/* \u6642\u523b */}
                  <div className="flex-shrink-0 w-12 text-right">
                    <span className="text-xs font-mono text-gray-500">
                      {entry.startTime || '--:--'}
                    </span>
                  </div>

                  {/* \u8ee2\u63db\u6642\u9593\u8868\u793a */}
                  {entry.transitionTime && entry.transitionTime > 0 && entryIndex > 0 && (
                    <div className="flex-shrink-0">
                      <span className="inline-block px-1 py-0.5 bg-amber-50 text-amber-600 text-[10px] rounded">
                        {'\u8EE2\u63DB'}{entry.transitionTime}{'\u5206'}
                      </span>
                    </div>
                  )}

                  {/* \u30a8\u30f3\u30c8\u30ea\u30fc\u5185\u5bb9 */}
                  <div className="flex-1 min-w-0">
                    {isBand ? (
                      <div className="flex items-center gap-1.5">
                        {bandNum !== undefined && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                            {bandNum}
                          </span>
                        )}
                        <span className="text-sm text-gray-900 font-medium truncate">
                          {getBandName(entry.bandId!)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-purple-600 bg-purple-50 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                          {'\u2605'}
                        </span>
                        <span className="text-sm text-purple-700 font-medium truncate">
                          {entry.customEvent?.name || '\u30AB\u30B9\u30BF\u30E0'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* \u9055\u53cd\u30a2\u30a4\u30b3\u30f3 */}
                  {hasViolation && (
                    <div className="flex-shrink-0">
                      <span className={`text-[10px] ${
                        highestSeverity === 'high' ? 'text-red-500' :
                        highestSeverity === 'medium' ? 'text-amber-500' :
                        'text-blue-500'
                      }`}>
                        {highestSeverity === 'high' ? '\u26A0\uFE0F' : highestSeverity === 'medium' ? '\u26A1' : '\u2139\uFE0F'}
                      </span>
                    </div>
                  )}

                  {/* \u6642\u9593 */}
                  <div className="flex-shrink-0 text-xs text-gray-400">
                    {isBand && band ? `${band.performanceDuration}\u5206` : entry.customEvent?.duration ? `${entry.customEvent.duration}\u5206` : ''}
                  </div>

                  {/* \u5c55\u958b\u30a2\u30a4\u30b3\u30f3 */}
                  <div className="flex-shrink-0 text-gray-300">
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* \u30a2\u30af\u30b7\u30e7\u30f3\u30d1\u30cd\u30eb */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 space-y-2">
                        {/* \u9055\u53cd\u8868\u793a */}
                        {hasViolation && (
                          <div className="space-y-1">
                            {entryViolations.map(v => (
                              <div
                                key={v.id}
                                className={`text-[10px] px-2 py-1 rounded ${
                                  v.severity === 'high' ? 'bg-red-50 text-red-600 border border-red-200' :
                                  v.severity === 'medium' ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                                  'bg-blue-50 text-blue-600 border border-blue-200'
                                }`}
                              >
                                {v.message}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* \u8ee2\u63db\u6642\u9593\u7de8\u96c6 */}
                        {entryIndex > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-10">{'\u8EE2\u63DB'}:</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTransitionTimeChange(entry.id, Math.max(0, (entry.transitionTime || 0) - 1));
                                }}
                                className="w-5 h-5 rounded bg-gray-200 text-gray-600 text-xs flex items-center justify-center active:bg-gray-300"
                              >
                                -
                              </button>
                              <span className="text-xs text-gray-700 w-8 text-center font-mono">{entry.transitionTime || 0}{'\u5206'}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onTransitionTimeChange(entry.id, (entry.transitionTime || 0) + 1);
                                }}
                                className="w-5 h-5 rounded bg-gray-200 text-gray-600 text-xs flex items-center justify-center active:bg-gray-300"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}

                        {/* \u64cd\u4f5c\u30dc\u30bf\u30f3 */}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); onMoveEntry(entryIndex, 'up'); }}
                            disabled={entryIndex === 0}
                            className="px-2.5 py-1 rounded text-xs font-medium text-gray-600 bg-white border border-gray-200 active:bg-gray-100 disabled:opacity-30"
                          >
                            {'\u2191'} {'\u4E0A\u3078'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onMoveEntry(entryIndex, 'down'); }}
                            disabled={entryIndex === cool.entries.length - 1}
                            className="px-2.5 py-1 rounded text-xs font-medium text-gray-600 bg-white border border-gray-200 active:bg-gray-100 disabled:opacity-30"
                          >
                            {'\u2193'} {'\u4E0B\u3078'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveEntry(entry.id); }}
                            className="px-2.5 py-1 rounded text-xs font-medium text-red-600 bg-red-50 border border-red-200 active:bg-red-100"
                          >
                            {'\u524A\u9664'}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </>)}
              </SortableEntry>
            );
          })}

          {/* \u672b\u5c3e\u306e\u914d\u7f6e\u30dc\u30bf\u30f3 */}
          {isPlacing && (
            <div className="px-3 py-2">
              <button
                onClick={handlePlace}
                className={`w-full py-2 border-2 border-dashed rounded-lg text-xs font-medium ${
                  selectedCustomEvent
                    ? 'border-purple-300 text-purple-600 bg-purple-50 active:bg-purple-100'
                    : 'border-emerald-300 text-emerald-600 bg-emerald-50 active:bg-emerald-100'
                }`}
              >
                + {'\u672B\u5C3E\u306B\u914D\u7F6E'}
              </button>
            </div>
          )}
        </div>
        </SortableContext>
      )}
    </div>
  );
};
