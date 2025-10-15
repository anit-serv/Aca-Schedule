import type { EventSettings, DailyTimetable } from '../types';

interface TimetableContextBarProps {
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  eventSettings: EventSettings;
  currentTimetable: DailyTimetable;
  inputCoolCount: string;
  isReadOnly: boolean;
  onTimetableTypeChange: (type: 'performance' | 'rehearsal') => void;
  onDateChange: (date: string) => void;
  onStartTimeChange: (time: string) => void;
  onCoolCountChange: (count: number) => void;
  onCoolCountInputChange: (value: string) => void;
}

export const TimetableContextBar = ({
  timetableType,
  selectedDate,
  eventSettings,
  currentTimetable,
  inputCoolCount,
  isReadOnly,
  onTimetableTypeChange,
  onDateChange,
  onStartTimeChange,
  onCoolCountChange,
  onCoolCountInputChange,
}: TimetableContextBarProps) => {
  // 現在のタイムテーブルタイプに応じた日付リストを取得
  const dates = timetableType === 'performance'
    ? eventSettings.performanceDates
    : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
      ? eventSettings.performanceDates
      : eventSettings.rehearsalDates || [];

  return (
    <div className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-6 py-3">
      <div className="flex items-center justify-between gap-6">
        {/* 左側: タイムテーブルタイプ選択（セグメントコントロール）と日付選択 */}
        <div className="flex items-center gap-4 flex-1">
          {/* セグメントコントロール（本番用/リハ用） */}
          <div className="inline-flex bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => onTimetableTypeChange('performance')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                timetableType === 'performance'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-300 hover:text-white'
              }`}
            >
              本番用
            </button>
            <button
              onClick={() => onTimetableTypeChange('rehearsal')}
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
            {dates.sort().map((date) => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

              return (
                <button
                  key={date}
                  onClick={() => onDateChange(date)}
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
              onChange={(e) => onStartTimeChange(e.target.value)}
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
              min="1"
              max="20"
              value={inputCoolCount}
              onChange={(e) => onCoolCountInputChange(e.target.value)}
              onBlur={() => onCoolCountChange(Number(inputCoolCount))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onCoolCountChange(Number(inputCoolCount));
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
  );
};
