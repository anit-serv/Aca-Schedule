import { useState, useMemo } from 'react';
import type { Band, TimeRange, EventSettings } from '../types';

interface BandAvailabilityModalProps {
  band: Band;
  eventSettings: EventSettings;
  onClose: () => void;
  onUpdate: (availableTimeSlots: Band['availableTimeSlots']) => void;
}

// 時間スロット（30分単位）のヘルパー関数
const generateTimeSlots = (): string[] => {
  const slots: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
    slots.push(`${hour.toString().padStart(2, '0')}:30`);
  }
  // 終了時刻として24:00を追加（表示はしないが、範囲計算に必要）
  slots.push('24:00');
  return slots;
};

export const BandAvailabilityModal = ({
  band,
  eventSettings,
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
  const [selectedDate, setSelectedDate] = useState(allDates[0]?.date || '');
  
  // 範囲選択の状態
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'add' | 'remove'>('add'); // 追加または削除モード
  
  const allTimeSlots = useMemo(() => generateTimeSlots(), []);

  // 指定した日付の選択された時間スロットのセットを取得
  const getSelectedSlotsForDate = (date: string): Set<string> => {
    const slot = timeSlots.find(s => s.date === date);
    if (!slot || !slot.timeRanges.length) return new Set();
    
    const selectedSet = new Set<string>();
    slot.timeRanges.forEach(range => {
      const startIdx = allTimeSlots.indexOf(range.startTime);
      const endIdx = allTimeSlots.indexOf(range.endTime);
      
      // インデックスが見つからない場合はスキップ
      if (startIdx === -1 || endIdx === -1) return;
      
      for (let i = startIdx; i < endIdx; i++) {
        selectedSet.add(allTimeSlots[i]);
      }
    });
    return selectedSet;
  };

  // 選択されたスロットセットからTimeRangeの配列を生成
  const slotsSetToTimeRanges = (slotsSet: Set<string>): TimeRange[] => {
    if (slotsSet.size === 0) return [];
    
    const sortedSlots = Array.from(slotsSet).sort();
    const ranges: TimeRange[] = [];
    let rangeStart = sortedSlots[0];
    let prevSlot = sortedSlots[0];
    
    for (let i = 1; i < sortedSlots.length; i++) {
      const currentSlot = sortedSlots[i];
      const prevIdx = allTimeSlots.indexOf(prevSlot);
      const currentIdx = allTimeSlots.indexOf(currentSlot);
      
      // 連続していない場合、範囲を確定
      if (currentIdx !== prevIdx + 1) {
        const endIdx = allTimeSlots.indexOf(prevSlot) + 1;
        ranges.push({
          startTime: rangeStart,
          endTime: allTimeSlots[endIdx],
        });
        rangeStart = currentSlot;
      }
      prevSlot = currentSlot;
    }
    
    // 最後の範囲を追加
    const endIdx = allTimeSlots.indexOf(prevSlot) + 1;
    ranges.push({
      startTime: rangeStart,
      endTime: allTimeSlots[endIdx],
    });
    
    return ranges;
  };

  // 時間スロットの範囲選択（追加）
  const selectTimeRange = (startTime: string, endTime: string) => {
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    const startIdx = allTimeSlots.indexOf(startTime);
    const endIdx = allTimeSlots.indexOf(endTime);
    
    // インデックスが見つからない場合は何もしない
    if (startIdx === -1 || endIdx === -1) return;
    
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    
    // 範囲内のすべてのスロットを選択（24:00は除外）
    for (let i = minIdx; i <= maxIdx; i++) {
      if (i < allTimeSlots.length - 1) { // 24:00（最後の要素）は選択対象外
        selectedSlots.add(allTimeSlots[i]);
      }
    }
    
    const newTimeRanges = slotsSetToTimeRanges(selectedSlots);
    
    const existingIndex = timeSlots.findIndex(slot => slot.date === selectedDate);
    const newSlots = [...timeSlots];
    
    if (newTimeRanges.length === 0) {
      if (existingIndex >= 0) {
        newSlots.splice(existingIndex, 1);
      }
    } else {
      if (existingIndex >= 0) {
        newSlots[existingIndex] = { date: selectedDate, timeRanges: newTimeRanges };
      } else {
        newSlots.push({ date: selectedDate, timeRanges: newTimeRanges });
      }
    }
    
    setTimeSlots(newSlots);
  };

  // 時間スロットの範囲削除
  const deselectTimeRange = (startTime: string, endTime: string) => {
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    const startIdx = allTimeSlots.indexOf(startTime);
    const endIdx = allTimeSlots.indexOf(endTime);
    
    // インデックスが見つからない場合は何もしない
    if (startIdx === -1 || endIdx === -1) return;
    
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    
    // 範囲内のすべてのスロットを削除（24:00は選択対象外なので削除の必要もなし）
    for (let i = minIdx; i <= maxIdx; i++) {
      if (i < allTimeSlots.length - 1) { // 24:00（最後の要素）は選択対象外
        selectedSlots.delete(allTimeSlots[i]);
      }
    }
    
    const newTimeRanges = slotsSetToTimeRanges(selectedSlots);
    
    const existingIndex = timeSlots.findIndex(slot => slot.date === selectedDate);
    const newSlots = [...timeSlots];
    
    if (newTimeRanges.length === 0) {
      if (existingIndex >= 0) {
        newSlots.splice(existingIndex, 1);
      }
    } else {
      if (existingIndex >= 0) {
        newSlots[existingIndex] = { date: selectedDate, timeRanges: newTimeRanges };
      } else {
        newSlots.push({ date: selectedDate, timeRanges: newTimeRanges });
      }
    }
    
    setTimeSlots(newSlots);
  };

  // 単一スロットのトグル
  const toggleSingleSlot = (time: string) => {
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    
    if (selectedSlots.has(time)) {
      selectedSlots.delete(time);
    } else {
      selectedSlots.add(time);
    }
    
    const newTimeRanges = slotsSetToTimeRanges(selectedSlots);
    
    const existingIndex = timeSlots.findIndex(slot => slot.date === selectedDate);
    const newSlots = [...timeSlots];
    
    if (newTimeRanges.length === 0) {
      if (existingIndex >= 0) {
        newSlots.splice(existingIndex, 1);
      }
    } else {
      if (existingIndex >= 0) {
        newSlots[existingIndex] = { date: selectedDate, timeRanges: newTimeRanges };
      } else {
        newSlots.push({ date: selectedDate, timeRanges: newTimeRanges });
      }
    }
    
    setTimeSlots(newSlots);
  };

  // 選択開始
  const handleMouseDown = (time: string) => {
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    const isAlreadySelected = selectedSlots.has(time);
    
    // 既に選択されている場合は削除モード、そうでない場合は追加モード
    setSelectionMode(isAlreadySelected ? 'remove' : 'add');
    setSelectionStart(time);
    setSelectionEnd(time);
    setIsSelecting(true);
  };

  // 選択範囲の更新
  const handleMouseEnter = (time: string) => {
    if (isSelecting && selectionStart) {
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
        if (selectionMode === 'add') {
          selectTimeRange(selectionStart, selectionEnd);
        } else {
          deselectTimeRange(selectionStart, selectionEnd);
        }
      }
    }
    setIsSelecting(false);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

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
      if (i < allTimeSlots.length) {
        previewSet.add(allTimeSlots[i]);
      }
    }
    return previewSet;
  };

  const handleSave = () => {
    onUpdate(timeSlots);
  };

  const selectedSlotsForDate = getSelectedSlotsForDate(selectedDate);
  const previewRange = getPreviewRange();

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onMouseUp={handleMouseUp}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-xl font-bold text-white">
            出演可能時間帯設定: {band.name || '(未設定)'}
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            クリックで選択/解除、ドラッグで範囲選択（選択済みから開始すると削除モード）
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* 日付選択タブ */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {allDates.map(({ date, type }) => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
              const hasSelection = timeSlots.some(s => s.date === date && s.timeRanges.length > 0);
              const label = type === 'rehearsal' ? 'リハ' : '本番';
              
              return (
                <button
                  key={`${date}-${type}`}
                  onClick={() => setSelectedDate(date)}
                  className={`px-4 py-2 rounded-md font-medium transition-colors ${
                    selectedDate === date
                      ? 'bg-blue-600 text-white'
                      : hasSelection
                      ? 'bg-gray-600 text-white hover:bg-gray-500'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <span className="text-xs opacity-70">{label}</span>
                    <span>{formattedDate}</span>
                  </div>
                  {hasSelection && <span className="ml-1">✓</span>}
                </button>
              );
            })}
          </div>

          {/* 時間グリッド */}
          <div className="bg-gray-700 p-4 rounded">
            <div className="grid grid-cols-12 gap-1 select-none">
              {allTimeSlots.map((time, index) => {
                // 24:00以降は表示しない
                if (index >= 48) return null;
                
                const isSelected = selectedSlotsForDate.has(time);
                const isInPreview = previewRange.has(time);
                const hour = parseInt(time.split(':')[0]);
                const minute = time.split(':')[1];
                const isHourMark = minute === '00';
                
                // プレビュー中の色を決定
                let bgColor = 'bg-gray-600 border-gray-500 hover:bg-gray-500';
                if (isSelected) {
                  bgColor = 'bg-blue-600 border-blue-500 hover:bg-blue-500';
                }
                if (isInPreview) {
                  // 削除モードの場合は赤系、追加モードの場合は青系
                  bgColor = selectionMode === 'remove' 
                    ? 'bg-red-400 border-red-300' 
                    : 'bg-blue-400 border-blue-300';
                }
                
                return (
                  <div
                    key={time}
                    onMouseDown={() => handleMouseDown(time)}
                    onMouseEnter={() => handleMouseEnter(time)}
                    className={`
                      h-10 rounded cursor-pointer transition-colors border
                      ${bgColor}
                      ${isHourMark ? 'border-2 border-gray-400' : ''}
                    `}
                    title={time}
                  >
                    {isHourMark && (
                      <div className="text-xs text-center text-gray-200 font-semibold">
                        {hour}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* 選択された時間範囲の表示 */}
            <div className="mt-4 pt-4 border-t border-gray-600">
              <h4 className="text-sm font-semibold text-gray-300 mb-2">
                選択された時間帯:
              </h4>
              {selectedSlotsForDate.size > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {slotsSetToTimeRanges(selectedSlotsForDate).map((range, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded"
                    >
                      {range.startTime} - {range.endTime}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">未選択</p>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
