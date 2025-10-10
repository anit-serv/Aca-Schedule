import { useState, useMemo } from 'react';
import type { Band, TimeRange } from '../types';

interface BandAvailabilityModalProps {
  band: Band;
  performanceDates: string[];
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
  return slots;
};

export const BandAvailabilityModal = ({
  band,
  performanceDates,
  onClose,
  onUpdate,
}: BandAvailabilityModalProps) => {
  const [timeSlots, setTimeSlots] = useState(band.availableTimeSlots);
  const [selectedDate, setSelectedDate] = useState(performanceDates[0] || '');
  
  // ドラッグ選択の状態
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'select' | 'deselect'>('select');
  
  const allTimeSlots = useMemo(() => generateTimeSlots(), []);

  // 指定した日付の選択された時間スロットのセットを取得
  const getSelectedSlotsForDate = (date: string): Set<string> => {
    const slot = timeSlots.find(s => s.date === date);
    if (!slot || !slot.timeRanges.length) return new Set();
    
    const selectedSet = new Set<string>();
    slot.timeRanges.forEach(range => {
      const startIdx = allTimeSlots.indexOf(range.startTime);
      const endIdx = allTimeSlots.indexOf(range.endTime);
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
          endTime: allTimeSlots[endIdx] || '23:59',
        });
        rangeStart = currentSlot;
      }
      prevSlot = currentSlot;
    }
    
    // 最後の範囲を追加
    const endIdx = allTimeSlots.indexOf(prevSlot) + 1;
    ranges.push({
      startTime: rangeStart,
      endTime: allTimeSlots[endIdx] || '23:59',
    });
    
    return ranges;
  };

  // 時間スロットのトグル
  const toggleTimeSlot = (time: string, forceMode?: 'select' | 'deselect') => {
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    const mode = forceMode || dragMode;
    
    if (mode === 'select') {
      selectedSlots.add(time);
    } else {
      selectedSlots.delete(time);
    }
    
    const newTimeRanges = slotsSetToTimeRanges(selectedSlots);
    
    const existingIndex = timeSlots.findIndex(slot => slot.date === selectedDate);
    const newSlots = [...timeSlots];
    
    if (newTimeRanges.length === 0) {
      // 選択がない場合は削除
      if (existingIndex >= 0) {
        newSlots.splice(existingIndex, 1);
      }
    } else {
      // 選択がある場合は更新または追加
      if (existingIndex >= 0) {
        newSlots[existingIndex] = { date: selectedDate, timeRanges: newTimeRanges };
      } else {
        newSlots.push({ date: selectedDate, timeRanges: newTimeRanges });
      }
    }
    
    setTimeSlots(newSlots);
  };

  // ドラッグ開始
  const handleMouseDown = (time: string) => {
    setIsDragging(true);
    const selectedSlots = getSelectedSlotsForDate(selectedDate);
    const mode = selectedSlots.has(time) ? 'deselect' : 'select';
    setDragMode(mode);
    toggleTimeSlot(time, mode);
  };

  // ドラッグ中
  const handleMouseEnter = (time: string) => {
    if (isDragging) {
      toggleTimeSlot(time, dragMode);
    }
  };

  // ドラッグ終了
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSave = () => {
    onUpdate(timeSlots);
  };

  const selectedSlotsForDate = getSelectedSlotsForDate(selectedDate);

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
            ドラッグで時間帯を選択してください（複数範囲選択可）
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* 日付選択タブ */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {performanceDates.map(date => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
              const hasSelection = timeSlots.some(s => s.date === date && s.timeRanges.length > 0);
              
              return (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`px-4 py-2 rounded-md font-medium transition-colors ${
                    selectedDate === date
                      ? 'bg-blue-600 text-white'
                      : hasSelection
                      ? 'bg-gray-600 text-white hover:bg-gray-500'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {formattedDate}
                  {hasSelection && ' ✓'}
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
                const hour = parseInt(time.split(':')[0]);
                const minute = time.split(':')[1];
                const isHourMark = minute === '00';
                
                return (
                  <div
                    key={time}
                    onMouseDown={() => handleMouseDown(time)}
                    onMouseEnter={() => handleMouseEnter(time)}
                    className={`
                      h-10 rounded cursor-pointer transition-colors border
                      ${isSelected 
                        ? 'bg-blue-600 border-blue-500 hover:bg-blue-500' 
                        : 'bg-gray-600 border-gray-500 hover:bg-gray-500'
                      }
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
