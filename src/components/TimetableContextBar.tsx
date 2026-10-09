import type { Band, EventSettings, DailyTimetable } from '../types';
import { ToggleSwitch } from './ToggleSwitch';
import { TimetableSearch } from './TimetableSearch';
import { DesktopClockTimePicker } from './DesktopClockTimePicker';
import { Icon } from './Icon';

interface TimetableContextBarProps {
  timetableType: 'performance' | 'rehearsal';
  selectedDate: string;
  eventSettings: EventSettings;
  currentTimetable: DailyTimetable;
  inputCoolCount: string;
  isReadOnly: boolean;
  isCustomMode: boolean;
  showCombinedView?: boolean;
  unifiedCoolPre?: boolean;
  onTimetableTypeChange: (type: 'performance' | 'rehearsal') => void;
  onDateChange: (date: string) => void;
  onStartTimeChange: (time: string) => void;
  onEndTimeChange: (time: string | undefined) => void;
  onCoolCountChange: (count: number) => void;
  onCoolCountInputChange: (value: string) => void;
  onCustomModeChange: (enabled: boolean) => void;
  bands: Band[];
  searchQuery: string;
  searchMatchCount: number;
  searchMatchNumber: number;
  onSearchChange: (query: string) => void;
  onSearchSelectBand: (bandId: string) => void;
  onSearchSelectMember: (memberName: string) => void;
  onSearchNextMatch: () => void;
  onSearchPreviousMatch: () => void;
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
  unifiedCoolPre = false,
  onTimetableTypeChange,
  onDateChange,
  onStartTimeChange,
  onEndTimeChange,
  onCoolCountChange,
  onCoolCountInputChange,
  onCustomModeChange,
  bands,
  searchQuery,
  searchMatchCount,
  searchMatchNumber,
  onSearchChange,
  onSearchSelectBand,
  onSearchSelectMember,
  onSearchNextMatch,
  onSearchPreviousMatch,
}: TimetableContextBarProps) => {
  // 現在のタイムテーブルタイプに応じた日付リストを取得
  const dates = timetableType === 'performance'
    ? eventSettings.performanceDates
    : (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal')
      ? eventSettings.performanceDates
      : eventSettings.rehearsalDates || [];

  return (
    <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* 左側: タイムテーブルタイプ選択（セグメントコントロール）と日付選択 */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* セグメントコントロール（本番用/リハ用）- 当日一括リハのカスタムモードでは非表示 */}
          {!showCombinedView && !unifiedCoolPre && (
          <div className="inline-flex flex-none rounded-lg bg-emerald-50 p-1">
            <button
              onClick={() => onTimetableTypeChange('performance')}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                timetableType === 'performance'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-emerald-600 hover:text-emerald-800'
              }`}
            >
              本番
            </button>
            <button
              onClick={() => onTimetableTypeChange('rehearsal')}
              className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                timetableType === 'rehearsal'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-emerald-600 hover:text-emerald-800'
              }`}
            >
              リハ
            </button>
          </div>

          )}

          {/* 日付選択ボタン */}
          <div className="flex min-w-[136px] gap-2 overflow-x-auto">
            {dates.sort().map((date) => {
              const dateObj = new Date(date);
              const formattedDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

              return (
                <button
                  key={date}
                  onClick={() => onDateChange(date)}
                  className={`px-2 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${
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
        <div className="flex flex-none items-center gap-2">
          {/* 開始時刻 */}
          <div className={`flex items-center gap-1.5 transition-opacity duration-200 ${isCustomMode ? 'opacity-50' : ''}`}>
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
              inputClassName={`w-[76px] px-1 py-1 bg-white border border-gray-300 rounded text-sm text-center text-gray-900 ${
                isCustomMode ? 'cursor-not-allowed' : ''
              }`}
            />
          </div>

          {/* 終了時刻 */}
          <div className={`flex items-center gap-1.5 transition-opacity duration-200 ${isCustomMode ? 'opacity-50' : ''}`}>
            <label htmlFor="dayEndTime" className="text-sm text-gray-500 whitespace-nowrap">終了時刻:</label>
            <DesktopClockTimePicker
              id="dayEndTime"
              value={currentTimetable.endTime}
              onChange={onEndTimeChange}
              allowClear
              placeholder="未設定"
              disabled={isReadOnly || isCustomMode}
              inputClassName="w-[76px] px-1 py-1 bg-white border border-gray-300 rounded text-sm text-center text-gray-900"
            />
          </div>

          {/* クール数 */}
            <div className={`flex items-center gap-1.5 transition-opacity duration-200 ${isCustomMode ? 'opacity-50' : ''}`}>
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
                disabled={isReadOnly || isCustomMode}
                className={`w-12 px-1 py-1 bg-white border border-gray-300 rounded text-sm text-center text-gray-900 ${
                  isReadOnly || isCustomMode ? 'cursor-not-allowed' : ''
                }`}
              />
            </div>

          {/* 検索 */}
          <TimetableSearch
            bands={bands}
            searchQuery={searchQuery}
            matchCount={searchMatchCount}
            matchNumber={searchMatchNumber}
            onSearchChange={onSearchChange}
            onSelectBand={onSearchSelectBand}
            onSelectMember={onSearchSelectMember}
            onNextMatch={onSearchNextMatch}
            onPreviousMatch={onSearchPreviousMatch}
          />

          {/* カスタムモードトグル */}
          <ToggleSwitch
            enabled={isCustomMode}
            onChange={onCustomModeChange}
            label="カスタム"
            icon={<Icon name="grid_on" className="text-base" />}
          />
        </div>
      </div>
    </div>
  );
};
