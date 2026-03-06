import { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry, CustomEvent, ConstraintViolation } from '../../types';
import { calculateBandNumbers } from '../../utils/calculateBandNumbers';
import { useTimetableHelpers } from '../../hooks/useTimetableHelpers';
import { useConstraintCheck } from '../../hooks/useConstraintCheck';
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
}

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
}: MobileTimetableViewProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [showCustomEventSheet, setShowCustomEventSheet] = useState(false);
  const [customEventName, setCustomEventName] = useState('');
  const [customEventDuration, setCustomEventDuration] = useState('5');
  const [showViolationSheet, setShowViolationSheet] = useState(false);
  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u914d\u7f6e\u30e2\u30fc\u30c9
  const [selectedCustomEvent, setSelectedCustomEvent] = useState<CustomEvent | null>(null);
  // \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u30ea\u30b9\u30c8
  const [customEvents, setCustomEvents] = useState<CustomEvent[]>(eventSettings.customEvents || []);

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
  const { recalculateTimes } = useTimetableHelpers({
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

  // \u5236\u7d04\u30c1\u30a7\u30c3\u30af
  const violations = useConstraintCheck(currentTimetable, bands, bandNumbers);

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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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

  // \u30af\u30fc\u30eb\u6570\u5909\u66f4
  const handleCoolCountChange = useCallback((newCount: number) => {
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
        newCools = dt.cools.slice(0, newCount);
      }
      const recalculated = recalculateTimes(newCools, dt.startTime);
      return { ...dt, cools: recalculated };
    });
  }, [currentTimetable, selectedDate, updateTimetable, recalculateTimes]);

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
      id: crypto.randomUUID(),
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{'\u958B\u59CB'}:</span>
              <input
                type="time"
                value={currentTimetable.startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:border-emerald-400 w-20"
              />
              {dates.length === 1 && (
                <span className="text-gray-400">{'\u2022'} {formatDate(selectedDate)}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* \u9055\u53cd\u30d0\u30c3\u30b8 */}
              {uniqueViolationCount > 0 && (
                <button
                  onClick={() => setShowViolationSheet(true)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-600 text-[10px] font-medium"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {uniqueViolationCount}
                </button>
              )}
              {/* \u30af\u30fc\u30eb\u6570\u30b3\u30f3\u30c8\u30ed\u30fc\u30eb */}
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
            </div>
          </div>
        )}
      </div>

      {/* \u30bf\u30a4\u30e0\u30c6\u30fc\u30d6\u30eb\u672c\u4f53 */}
      <div className="flex-1 overflow-y-auto pb-32">
        {!currentTimetable || !currentTimetable.cools || currentTimetable.cools.length === 0 ? (
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

      {/* FAB\u30dc\u30bf\u30f3 */}
      <div className="fixed bottom-[calc(60px+env(safe-area-inset-bottom,0px)+12px)] right-4 flex flex-col gap-2 z-30">
        {/* \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8FAB */}
        <button
          onClick={() => setShowCustomEventSheet(true)}
          className="w-10 h-10 bg-purple-500 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          title={'\u30AB\u30B9\u30BF\u30E0\u30A4\u30D9\u30F3\u30C8'}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        {/* \u30d0\u30f3\u30c9\u30d0\u30f3\u30afFAB */}
        <button
          onClick={onOpenBandBank}
          className="w-12 h-12 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform"
          title={'\u30D0\u30F3\u30C9\u30D0\u30F3\u30AF'}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* \u30ab\u30b9\u30bf\u30e0\u30a4\u30d9\u30f3\u30c8\u30b7\u30fc\u30c8 */}
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
                <ViolationList violations={violations} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// \u9055\u53cd\u30ea\u30b9\u30c8\u30b3\u30f3\u30dd\u30fc\u30cd\u30f3\u30c8
const ViolationList = ({ violations }: { violations: ConstraintViolation[] }) => {
  // \u4e00\u610f\u306e\u9055\u53cd\u306e\u307f\u3092\u62bd\u51fa
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

  const highViolations = uniqueViolations.filter(v => v.severity === 'high');
  const mediumViolations = uniqueViolations.filter(v => v.severity === 'medium');
  const lowViolations = uniqueViolations.filter(v => v.severity === 'low');

  const renderViolation = (v: ConstraintViolation) => {
    const severityStyles = {
      high: 'bg-red-50 border-red-200 text-red-700',
      medium: 'bg-amber-50 border-amber-200 text-amber-700',
      low: 'bg-blue-50 border-blue-200 text-blue-700',
    };
    const severityIcons = {
      high: '\u26A0\uFE0F',
      medium: '\u26A1',
      low: '\u2139\uFE0F',
    };

    return (
      <div
        key={v.id}
        className={`rounded-lg border px-3 py-2 text-xs ${severityStyles[v.severity]}`}
      >
        <span>{severityIcons[v.severity]} {v.message}</span>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {highViolations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-red-600 uppercase">{'\u91CD\u5927'} ({highViolations.length})</p>
          {highViolations.map(renderViolation)}
        </div>
      )}
      {mediumViolations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-amber-600 uppercase">{'\u6CE8\u610F'} ({mediumViolations.length})</p>
          {mediumViolations.map(renderViolation)}
        </div>
      )}
      {lowViolations.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-blue-600 uppercase">{'\u60C5\u5831'} ({lowViolations.length})</p>
          {lowViolations.map(renderViolation)}
        </div>
      )}
    </div>
  );
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
                  <input
                    type="time"
                    value={cool.startTime || ''}
                    onChange={(e) => onCoolStartTimeChange(e.target.value || undefined)}
                    className="border border-emerald-200 rounded px-1 py-0.5 text-[10px] text-emerald-700 focus:outline-none focus:border-emerald-400 w-[70px] bg-white"
                  />
                  <button
                    onClick={() => {
                      setShowCoolStartTime(false);
                      onCoolStartTimeChange(undefined);
                    }}
                    className="text-emerald-400 hover:text-red-400 p-0.5"
                    title={'\u958B\u59CB\u6642\u523B\u3092\u524A\u9664'}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
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

      {/* \u30a8\u30f3\u30c8\u30ea\u30fc\u30ea\u30b9\u30c8 */}
      {cool.entries.length === 0 ? (
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
      ) : (
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
              <div key={entry.id}>
                {/* \u633f\u5165\u30be\u30fc\u30f3 */}
                <InsertionZone insertIndex={entryIndex} />

                {/* \u30a8\u30f3\u30c8\u30ea\u30fc\u884c */}
                <div
                  onClick={() => onToggleExpand(entry.id)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-gray-50' : 'active:bg-gray-50'
                  } ${hasViolation ? (
                    highestSeverity === 'high' ? 'border-l-2 border-l-red-400' :
                    highestSeverity === 'medium' ? 'border-l-2 border-l-amber-400' :
                    'border-l-2 border-l-blue-400'
                  ) : ''}`}
                >
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
              </div>
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
      )}
    </div>
  );
};
