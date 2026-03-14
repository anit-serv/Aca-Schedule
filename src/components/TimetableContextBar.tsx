import type { Band, EventSettings, DailyTimetable } from '../types';
import { ToggleSwitch } from './ToggleSwitch';
import { TimetableSearch } from './TimetableSearch';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';

interface TimetableContextBarProps {
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  eventSettings: EventSettings;
  currentTimetable: DailyTimetable;
  inputCoolCount: string;
  isReadOnly: boolean;
  isCustomMode: boolean;
  showCombinedView?: boolean;
  onTimetableTypeChange: (type: 'performance' | 'rehearsal') => void;
  onDateChange: (date: string) => void;
  onStartTimeChange: (time: string) => void;
  onCoolCountChange: (count: number) => void;
  onCoolCountInputChange: (value: string) => void;
  onCustomModeChange: (enabled: boolean) => void;
  bands: Band[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const TimetableContextBar = ({
  timetableType,
  selectedDate,
  eventSettings,
  currentTimetable,
  inputCoolCount,
  isReadOnly,
  isCustomMode,
  showCombinedView = false,
  onTimetableTypeChange,
  onDateChange,
  onStartTimeChange,
  onCoolCountChange,
  onCoolCountInputChange,
  onCustomModeChange,
  bands,
  searchQuery,
  onSearchChange,
}: TimetableContextBarProps) => {
  // 現在のタイムテーブルタイプに応じた日付リストを取得
  const dates = timetableType === 'performance'
    ? eventSettings.performanceDates
    : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
      ? eventSettings.performanceDates
      : eventSettings.rehearsalDates || [];

  return (
    <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex items-center justify-between gap-6">
        {/* 左側: タイムテーブルタイプ選択（セグメントコントロール）と日付選択 */}
        <div className="flex items-center gap-4 flex-1">
          {/* セグメントコントロール（本番用/リハ用）- 当日一括リハのカスタムモードでは非表示 */}
          {!showCombinedView && (
          <div className="inline-flex bg-emerald-50 rounded-lg p-1">
            <button
              onClick={() => onTimetableTypeChange('performance')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                timetableType === 'performance'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-emerald-600 hover:text-emerald-800'
              }`}
            >
              本番用
            </button>
            <button
              onClick={() => onTimetableTypeChange('rehearsal')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                timetableType === 'rehearsal'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-emerald-600 hover:text-emerald-800'
              }`}
            >
              リハ用
            </button>
          </div>
          )}

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
                      ? 'bg-emerald-500 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {formattedDate}
                </button>
              );
            })}
          </div>
        </div>

        {/* 右側: 開始時刻、クール数、カスタムモード */}
        <div className="flex items-center gap-4">
          {/* 開始時刻 */}
          <div className="flex items-center gap-2">
            <label htmlFor="startTime" className="text-sm text-gray-500 whitespace-nowrap">
              開始時刻:
            </label>
            <DesktopClockTimePicker
              id="startTime"
              value={currentTimetable.startTime}
              onChange={(time) => {
                if (!time) return;
                onStartTimeChange(time);
              }}
              disabled={isCustomMode}
              inputClassName={`px-2 py-1 bg-white border border-gray-300 rounded text-sm text-gray-900 min-w-[96px] ${
                isCustomMode ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            />
          </div>

          {/* クール数（カスタムモード時は非表示） */}
          {!isCustomMode && (
            <div className="flex items-center gap-2">
              <label htmlFor="coolCount" className="text-sm text-gray-500 whitespace-nowrap">
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
                className={`w-16 px-2 py-1 bg-white border border-gray-300 rounded text-sm text-center text-gray-900 ${
                  isReadOnly ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              />
            </div>
          )}

          {/* 検索 */}
          <TimetableSearch
            bands={bands}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
          />

          {/* カスタムモードトグル */}
          <ToggleSwitch
            enabled={isCustomMode}
            onChange={onCustomModeChange}
            label="カスタム"
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h18M3 14h18M3 6h18M3 18h18M10 3v18M14 3v18" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
};
