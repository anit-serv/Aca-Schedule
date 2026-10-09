import { useState, useMemo, useEffect, useRef } from 'react';
import type { Band, TimeRange, EventSettings, Timetable } from '../types';
import { Icon } from './Icon';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';
import { changeTimeRange, normalizeTimeRanges, timeSlotCoverage, timeSlotSegments, timeToMinutes } from '../utils/availabilityRanges';

interface BandAvailabilityModalProps {
  band: Band;
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onClose: () => void;
  onUpdate: (availableTimeSlots: Band['availableTimeSlots'], backupRehearsalTimeSlots: NonNullable<Band['backupRehearsalTimeSlots']>) => void;
}

// 時間スロット（15分単位）のヘルパー関数
const generateTimeSlots = (): string[] => {
  const slots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 15) {
      slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    }
  }
  // 終了時刻として24:00を追加（表示はしないが、範囲計算に必要）
  slots.push('24:00');
  return slots;
};

export const BandAvailabilityModal = ({
  band,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onClose,
  onUpdate,
}: BandAvailabilityModalProps) => {
  // 本番日とリハーサル日を結合
  const allDates = useMemo(() => {
    const dates: Array<{ date: string; type: 'performance' | 'rehearsal' }> = [];
    
    // 本番日を追加
    eventSettings.performanceDates.forEach(date => {
      dates.push({ date, type: 'performance' });
    });
    
    // リハーサル日を追加
    if (eventSettings.rehearsalType === 'rehearsal-day' && eventSettings.rehearsalDates) {
      eventSettings.rehearsalDates.forEach(date => {
        dates.push({ date, type: 'rehearsal' });
      });
    } else if (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal') {
      // クール直前・当日開始リハの場合は本番日と同じ
      eventSettings.performanceDates.forEach(date => {
        dates.push({ date, type: 'rehearsal' });
      });
    }
    
    // 日付順にソート
    return dates.sort((a, b) => a.date.localeCompare(b.date));
  }, [eventSettings]);

  const [timeSlots, setTimeSlots] = useState(band.availableTimeSlots);
  const [backupTimeSlots, setBackupTimeSlots] = useState(band.backupRehearsalTimeSlots ?? []);
  const [selectedTab, setSelectedTab] = useState(allDates[0] ?? { date: '', type: 'performance' as const });
  const [isBackupMode, setIsBackupMode] = useState(false);
  const selectedDate = selectedTab.date;
  const [editingRangeIndex, setEditingRangeIndex] = useState<number | null>(null);
  const [rangeDraft, setRangeDraft] = useState<TimeRange>({ startTime: '', endTime: '' });
  const [rangeError, setRangeError] = useState('');
  
  // 範囲選択の状態
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'add' | 'remove'>('add'); // 追加または削除モード
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timeGridRef = useRef<HTMLDivElement>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const finishSelectionRef = useRef<() => void>(() => {});
  
  const allTimeSlots = useMemo(() => generateTimeSlots(), []);
  const dayBounds = useMemo(() => {
    const days = [performanceTimetable, rehearsalTimetable]
      .flatMap(timetable => timetable?.dailyTimetables ?? [])
      .filter(day => day.date === selectedDate);
    if (days.length === 0) return { start: 0, end: 1440, hasStart: false, hasEnd: false };
    const starts = days.map(day => timeToMinutes(day.startTime)).filter(Number.isFinite);
    const ends = days.map(day => day.endTime ? timeToMinutes(day.endTime) : NaN);
    return {
      start: starts.length ? Math.min(...starts) : 0,
      end: ends.every(Number.isFinite) ? Math.max(...ends) : 1440,
      hasStart: starts.length > 0,
      hasEnd: ends.every(Number.isFinite),
    };
  }, [performanceTimetable, rehearsalTimetable, selectedDate]);

  const isSlotAvailable = (time: string) => {
    const start = timeToMinutes(time);
    return start + 15 > dayBounds.start && start < dayBounds.end;
  };

  const normalRanges = normalizeTimeRanges(timeSlots.find(slot => slot.date === selectedDate)?.timeRanges ?? []);
  const backupRanges = normalizeTimeRanges(backupTimeSlots.find(slot => slot.date === selectedDate)?.timeRanges ?? []);
  const activeRanges = isBackupMode ? backupRanges : normalRanges;

  const writeRangesForDate = (ranges: TimeRange[], backup: boolean) => {
    const nextRanges = normalizeTimeRanges(ranges);
    const setter = backup ? setBackupTimeSlots : setTimeSlots;
    setter(previous => {
      const otherDays = previous.filter(slot => slot.date !== selectedDate);
      return nextRanges.length ? [...otherDays, { date: selectedDate, timeRanges: nextRanges }] : otherDays;
    });
  };

  const updateGridRange = (startTime: string, endTime: string, mode: 'add' | 'remove') => {
    const startIdx = allTimeSlots.indexOf(startTime);
    const endIdx = allTimeSlots.indexOf(endTime);
    if (startIdx === -1 || endIdx === -1) return;
    const start = Math.max(dayBounds.start, Math.min(startIdx, endIdx) * 15);
    const end = Math.min(dayBounds.end, (Math.max(startIdx, endIdx) + 1) * 15);
    const nextRanges = changeTimeRange(activeRanges, start, end, mode);
    if (editingRangeIndex !== null) {
      const editedRange = activeRanges[editingRangeIndex];
      const newIndex = nextRanges.findIndex(range =>
        range.startTime === editedRange?.startTime && range.endTime === editedRange?.endTime,
      );
      if (newIndex === -1) {
        setEditingRangeIndex(null);
        setRangeError('');
      } else if (newIndex !== editingRangeIndex) {
        setEditingRangeIndex(newIndex);
      }
    }
    writeRangesForDate(nextRanges, isBackupMode);
    if (mode === 'add') {
      writeRangesForDate(changeTimeRange(isBackupMode ? normalRanges : backupRanges, start, end, 'remove'), !isBackupMode);
    }
  };

  const toggleSingleSlot = (time: string) => {
    if (!isSlotAvailable(time)) return;
    const start = timeToMinutes(time);
    const selected = timeSlotCoverage(activeRanges, start, start + 15) !== 'none';
    updateGridRange(time, time, selected ? 'remove' : 'add');
  };

  const saveRangeEdit = () => {
    if (editingRangeIndex === null) return;
    const start = timeToMinutes(rangeDraft.startTime);
    const end = timeToMinutes(rangeDraft.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start < dayBounds.start || end > dayBounds.end) {
      setRangeError('有効な時刻を分単位で入力してください。開始・終了時刻の範囲内で、終了は開始より後にしてください。');
      return;
    }
    const nextRanges = activeRanges.filter((_, index) => index !== editingRangeIndex);
    writeRangesForDate([...nextRanges, { startTime: rangeDraft.startTime, endTime: rangeDraft.endTime }], isBackupMode);
    writeRangesForDate(changeTimeRange(isBackupMode ? normalRanges : backupRanges, start, end, 'remove'), !isBackupMode);
    setEditingRangeIndex(null);
    setRangeError('');
  };

  // 選択開始
  const handleMouseDown = (time: string) => {
    if (!isSlotAvailable(time)) return;
    const start = timeToMinutes(time);
    const isAlreadySelected = timeSlotCoverage(activeRanges, start, start + 15) !== 'none';
    
    // 既に選択されている場合は削除モード、そうでない場合は追加モード
    setSelectionMode(isAlreadySelected ? 'remove' : 'add');
    setSelectionStart(time);
    setSelectionEnd(time);
    setIsSelecting(true);
  };

  // 選択範囲の更新
  const handleMouseEnter = (time: string) => {
    if (isSelecting && selectionStart && isSlotAvailable(time)) {
      setSelectionEnd(time);
    }
  };

  // 選択確定
  const handleMouseUp = () => {
    if (isSelecting && selectionStart && selectionEnd) {
      // クリックのみ（ドラッグなし）の場合はトグル
      if (selectionStart === selectionEnd) {
        toggleSingleSlot(selectionStart);
      } else {
        // ドラッグした場合は範囲選択/削除
        updateGridRange(selectionStart, selectionEnd, selectionMode);
      }
    }
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };
  finishSelectionRef.current = handleMouseUp;

  useEffect(() => {
    if (!isSelecting) return;

    let frameId = 0;
    const updateSelectionEnd = () => {
      const position = pointerPositionRef.current;
      const scrollContainer = scrollContainerRef.current;
      const grid = timeGridRef.current;
      if (!position || !scrollContainer || !grid) return;

      const scrollRect = scrollContainer.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const visibleTop = Math.max(scrollRect.top + 2, gridRect.top + 2);
      const visibleBottom = Math.min(scrollRect.bottom - 2, gridRect.bottom - 2);
      if (visibleTop > visibleBottom) return;
      const x = Math.max(gridRect.left + 2, Math.min(position.x, gridRect.right - 2));
      const y = Math.max(visibleTop, Math.min(position.y, visibleBottom));
      const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-availability-time]');
      if (cell && grid.contains(cell) && !('disabled' in cell && cell.disabled)) {
        setSelectionEnd(cell.dataset.availabilityTime ?? null);
      }
    };

    const scrollWhileDragging = () => {
      const position = pointerPositionRef.current;
      const scrollContainer = scrollContainerRef.current;
      const grid = timeGridRef.current;
      if (position && scrollContainer && grid) {
        const rect = scrollContainer.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const edgeSize = 56;
        const distanceFromTop = position.y - rect.top;
        const distanceFromBottom = rect.bottom - position.y;
        let scrollAmount = 0;
        if (distanceFromTop < edgeSize) {
          scrollAmount = -Math.min(16, Math.max(2, (edgeSize - distanceFromTop) / 4));
        } else if (distanceFromBottom < edgeSize) {
          scrollAmount = Math.min(16, Math.max(2, (edgeSize - distanceFromBottom) / 4));
        }
        if (scrollAmount < 0 && gridRect.top >= rect.top) scrollAmount = 0;
        if (scrollAmount > 0 && gridRect.bottom <= rect.bottom) scrollAmount = 0;
        if (scrollAmount !== 0) {
          scrollContainer.scrollTop += scrollAmount;
          updateSelectionEnd();
        }
      }
      frameId = requestAnimationFrame(scrollWhileDragging);
    };

    const handleWindowMouseMove = (event: MouseEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      updateSelectionEnd();
    };
    const handleWindowMouseUp = () => finishSelectionRef.current();

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    frameId = requestAnimationFrame(scrollWhileDragging);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      cancelAnimationFrame(frameId);
      pointerPositionRef.current = null;
    };
  }, [isSelecting]);

  // 現在の選択プレビュー範囲を取得
  const getPreviewRange = (): Set<string> => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      return new Set();
    }
    
    const startIdx = allTimeSlots.indexOf(selectionStart);
    const endIdx = allTimeSlots.indexOf(selectionEnd);
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    
    const previewSet = new Set<string>();
    for (let i = minIdx; i <= maxIdx; i++) {
      if (i < allTimeSlots.length - 1 && isSlotAvailable(allTimeSlots[i])) {
        previewSet.add(allTimeSlots[i]);
      }
    }
    return previewSet;
  };

  const handleSave = () => {
    onUpdate(timeSlots, backupTimeSlots);
  };

  const previewRange = getPreviewRange();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">
            出演可能時間帯設定: {band.name || '(未設定)'}
          </h3>
          <p className="text-gray-500 text-sm mt-1">
            未選択の日は出演不可です。15分単位でなぞり、選択した時間帯は分単位で調整できます。
          </p>
        </div>

        <div ref={scrollContainerRef} className="px-6 py-4 overflow-y-auto flex-1">
          {/* 日付選択タブ */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {allDates.map(({ date, type }) => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
              const hasSelection = timeSlots.some(s => s.date === date && s.timeRanges.length > 0)
                || (type === 'rehearsal' && backupTimeSlots.some(s => s.date === date && s.timeRanges.length > 0));
              const label = type === 'rehearsal' ? 'リハ' : '本番';
              
              return (
                <button
                  key={`${date}-${type}`}
                  onClick={() => {
                    setSelectedTab({ date, type });
                    setIsBackupMode(false);
                    setEditingRangeIndex(null);
                    setRangeError('');
                  }}
                  className={`px-4 py-2 rounded-md font-medium transition-colors ${
                    selectedTab.date === date && selectedTab.type === type
                      ? 'bg-emerald-500 text-white'
                      : hasSelection
                      ? 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <span className="text-xs opacity-70">{label}</span>
                    <span>{formattedDate}</span>
                  </div>
                  {hasSelection && <Icon name="check" className="ml-1 text-base align-middle" />}
                </button>
              );
            })}
          </div>

          {selectedTab.type === 'rehearsal' && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
              <span className="text-sm font-medium text-gray-700">入力する時間帯</span>
              <button
                type="button"
                role="switch"
                aria-checked={isBackupMode}
                aria-label="予備出演可能時間の入力モード"
                onClick={() => {
                  setIsBackupMode(previous => !previous);
                  setEditingRangeIndex(null);
                  setRangeError('');
                }}
                className={`relative h-7 w-12 rounded-full transition-colors ${isBackupMode ? 'bg-violet-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${isBackupMode ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className={`text-sm font-semibold ${isBackupMode ? 'text-violet-700' : 'text-emerald-700'}`}>
                {isBackupMode ? '予備出演可能時間（紫）' : '通常出演可能時間（緑）'}
              </span>
              <p className="w-full text-xs text-gray-600">予備時間は通常時間でリハーサルを配置できない場合にだけ使用します。色のない枠からなぞると追加、同じ色の枠からなぞると削除します。</p>
            </div>
          )}

          {/* 時間グリッド */}
          <div className="bg-gray-100 p-4 rounded">
            {(dayBounds.hasStart || dayBounds.hasEnd) && (
              <p className="mb-3 text-xs text-gray-600">
                設定済みの時間: {dayBounds.hasStart ? `${String(Math.floor(dayBounds.start / 60)).padStart(2, '0')}:${String(dayBounds.start % 60).padStart(2, '0')}` : '00:00'}〜{dayBounds.hasEnd ? `${String(Math.floor(dayBounds.end / 60)).padStart(2, '0')}:${String(dayBounds.end % 60).padStart(2, '0')}` : '24:00'}（範囲外は選択不可）
              </p>
            )}
            <p className="mb-2 text-xs text-gray-500">{selectedTab.type === 'rehearsal' ? '緑が通常、紫がリハーサルの予備時間です。' : '緑が通常の出演可能時間です。'}分単位の範囲は選択された部分だけ色が付きます。</p>
            <div ref={timeGridRef} className="grid grid-cols-4 gap-1 select-none sm:grid-cols-8 lg:grid-cols-12">
              {allTimeSlots.slice(0, -1).map((time, index) => {
                const slotStart = index * 15;
                const normalSegments = timeSlotSegments(normalRanges, slotStart, slotStart + 15);
                const backupSegments = selectedTab.type === 'rehearsal' ? timeSlotSegments(backupRanges, slotStart, slotStart + 15) : [];
                const coverage = timeSlotCoverage(activeRanges, slotStart, slotStart + 15);
                const isSelected = coverage !== 'none';
                const isDisabled = !isSlotAvailable(time);
                const isInPreview = !isDisabled && previewRange.has(time);
                let bgColor = 'bg-gray-200 text-gray-700 hover:bg-gray-300';
                if (isInPreview) {
                  bgColor = selectionMode === 'remove'
                    ? 'bg-red-400 text-white'
                    : isBackupMode ? 'bg-violet-300 text-violet-950' : 'bg-emerald-300 text-emerald-950';
                }
                if (isDisabled) bgColor = 'bg-gray-300 text-gray-400 cursor-not-allowed opacity-60';

                return (
                  <button
                    key={time}
                    type="button"
                    disabled={isDisabled}
                    data-availability-time={time}
                    onMouseDown={() => handleMouseDown(time)}
                    onMouseEnter={() => handleMouseEnter(time)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleSingleSlot(time);
                      }
                    }}
                    className={`relative h-10 overflow-hidden rounded-sm border-l-2 text-xs font-medium transition-colors ${index % 4 === 0 ? 'border-l-gray-500' : 'border-l-transparent'} ${bgColor}`}
                    aria-label={`${time}〜${allTimeSlots[index + 1]} ${isDisabled ? '選択不可' : coverage === 'partial' ? '一部選択済み' : isSelected ? '選択済み' : '未選択'}`}
                    aria-pressed={isSelected}
                    title={`${time}〜${allTimeSlots[index + 1]}`}
                  >
                    {!isDisabled && !isInPreview && normalSegments.map((segment, segmentIndex) => (
                      <span
                        key={segmentIndex}
                        aria-hidden="true"
                        className="absolute inset-y-0 bg-emerald-500"
                        style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                      />
                    ))}
                    {!isDisabled && !isInPreview && backupSegments.map((segment, segmentIndex) => (
                      <span
                        key={segmentIndex}
                        aria-hidden="true"
                        className="absolute inset-y-0 bg-violet-600"
                        style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                      />
                    ))}
                    <span className={`relative ${coverage === 'full' && !isDisabled && !isInPreview ? 'text-white' : ''}`}>{time}</span>
                  </button>
                );
              })}
            </div>
            
            {/* 選択された時間範囲の表示 */}
            <div className="mt-4 pt-4 border-t border-gray-300">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">
                {isBackupMode ? '予備出演可能時間帯:' : '通常出演可能時間帯:'}
              </h4>
              {activeRanges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {activeRanges.map((range, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setRangeDraft(range);
                        setEditingRangeIndex(idx);
                        setRangeError('');
                      }}
                      className={`px-3 py-1 text-white text-sm rounded ${isBackupMode ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-500 hover:bg-emerald-600'}`}
                      aria-label={`${range.startTime}〜${range.endTime}を分単位で編集`}
                    >
                      {range.startTime} - {range.endTime}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">未選択</p>
              )}
              {editingRangeIndex !== null && (
                <form className={`mt-3 rounded-md border bg-white p-3 ${isBackupMode ? 'border-violet-300' : 'border-emerald-300'}`} onSubmit={event => { event.preventDefault(); saveRangeEdit(); }}>
                  <p className="mb-2 text-sm font-medium text-gray-700">時間帯を分単位で調整</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="text-xs text-gray-600">開始
                      <DesktopClockTimePicker value={rangeDraft.startTime} onChange={value => setRangeDraft(previous => ({ ...previous, startTime: value ?? '' }))} className="mt-1" inputClassName="w-24 rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-900 hover:border-emerald-400" />
                    </div>
                    <span className="pb-2 text-gray-500">〜</span>
                    <div className="text-xs text-gray-600">終了
                      <DesktopClockTimePicker value={rangeDraft.endTime} onChange={value => setRangeDraft(previous => ({ ...previous, endTime: value ?? '' }))} allow24Hour className="mt-1" inputClassName="w-24 rounded border border-gray-300 bg-white px-2 py-1.5 text-left text-sm text-gray-900 hover:border-emerald-400" />
                    </div>
                    <button type="submit" className={`rounded px-3 py-1.5 text-sm text-white ${isBackupMode ? 'bg-violet-600 hover:bg-violet-700' : 'bg-emerald-500 hover:bg-emerald-600'}`}>適用</button>
                    <button type="button" onClick={() => { setEditingRangeIndex(null); setRangeError(''); }} className="rounded px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100">キャンセル</button>
                  </div>
                  {rangeError && <p role="alert" className="mt-2 text-xs text-red-600">{rangeError}</p>}
                  <p className="mt-2 text-xs text-gray-500">時計の分針を動かすか、±1分ボタンで細かく調整できます。</p>
                </form>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={editingRangeIndex !== null}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
