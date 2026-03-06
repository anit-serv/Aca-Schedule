import { useState, useMemo } from 'react';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool } from '../../types';
import { calculateBandNumbers } from '../../utils/calculateBandNumbers';

interface MobileTimetableViewProps {
  bands: Band[];
  eventSettings: EventSettings;
  performanceTimetable: Timetable | null;
  rehearsalTimetable: Timetable | null;
  onOpenBandBank: () => void;
}

export const MobileTimetableView = ({
  bands,
  eventSettings,
  performanceTimetable,
  rehearsalTimetable,
  onOpenBandBank,
}: MobileTimetableViewProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');

  // 日付リスト
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

  // 現在のタイムテーブル
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;

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

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
  };

  // バンド名取得
  const getBandName = (bandId: string) => {
    return bands.find(b => b.id === bandId)?.name || '不明';
  };

  // リハーサルタイプの判定
  const hasRehearsal = eventSettings.rehearsalType !== 'none';

  return (
    <div className="flex flex-col h-full">
      {/* 上部コントロール */}
      <div className="flex-shrink-0 px-3 py-2 space-y-2 bg-white border-b border-gray-100">
        {/* 本番/リハーサル切り替え */}
        {hasRehearsal && (
          <div className="flex gap-1">
            <button
              onClick={() => {
                setTimetableType('performance');
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
              本番
            </button>
            <button
              onClick={() => {
                setTimetableType('rehearsal');
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
              リハーサル
            </button>
          </div>
        )}

        {/* 日付セレクター */}
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

        {/* 開始時刻表示 */}
        {currentTimetable && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>開始: {currentTimetable.startTime}</span>
            {dates.length === 1 && (
              <span className="text-gray-400">• {formatDate(selectedDate)}</span>
            )}
          </div>
        )}
      </div>

      {/* タイムテーブル本体（縦スクロール） */}
      <div className="flex-1 overflow-y-auto pb-32">
        {!currentTimetable || !currentTimetable.cools || currentTimetable.cools.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-400 text-sm">タイムテーブルがまだ作成されていません</p>
            <button
              onClick={onOpenBandBank}
              className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium"
            >
              バンドを配置する
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-3">
            {currentTimetable.cools.map((cool) => (
              <CoolCard
                key={cool.id}
                cool={cool}
                totalCools={currentTimetable.cools.length}
                bands={bands}
                bandNumbers={bandNumbers}
                getBandName={getBandName}
              />
            ))}
          </div>
        )}
      </div>

      {/* バンドバンクFAB */}
      <button
        onClick={onOpenBandBank}
        className="fixed bottom-[calc(60px+env(safe-area-inset-bottom,0px)+12px)] right-4 w-12 h-12 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center z-30 active:scale-95 transition-transform"
        title="バンドバンク"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
};

// クールカード
const CoolCard = ({
  cool,
  totalCools,
  bands,
  bandNumbers,
  getBandName,
}: {
  cool: Cool;
  totalCools: number;
  bands: Band[];
  bandNumbers: Map<string, number>;
  getBandName: (bandId: string) => string;
}) => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* クールヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-emerald-700">
            {totalCools > 1 ? `第${cool.number}クール` : 'タイムテーブル'}
          </span>
          {cool.startTime && (
            <span className="text-xs text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
              {cool.startTime}〜
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{cool.entries.length}組</span>
      </div>

      {/* エントリーリスト */}
      {cool.entries.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-gray-400">
          エントリーがありません
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {cool.entries.map((entry, entryIndex) => {
            const isBand = entry.type === 'band';
            const band = isBand ? bands.find(b => b.id === entry.bandId) : null;
            const bandNum = entry.bandId ? bandNumbers.get(entry.bandId) : undefined;

            return (
              <div
                key={entry.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                {/* 時刻 */}
                <div className="flex-shrink-0 w-12 text-right">
                  <span className="text-xs font-mono text-gray-500">
                    {entry.startTime || '--:--'}
                  </span>
                </div>

                {/* 転換時間表示 */}
                {entry.transitionTime && entry.transitionTime > 0 && entryIndex > 0 && (
                  <div className="flex-shrink-0">
                    <span className="inline-block px-1 py-0.5 bg-amber-50 text-amber-600 text-[10px] rounded">
                      転換{entry.transitionTime}分
                    </span>
                  </div>
                )}

                {/* エントリー内容 */}
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
                    <span className="text-sm text-gray-600 italic truncate">
                      {entry.customEvent?.name || 'カスタム'}
                    </span>
                  )}
                </div>

                {/* 時間 */}
                <div className="flex-shrink-0 text-xs text-gray-400">
                  {isBand && band ? `${band.performanceDuration}分` : entry.customEvent?.duration ? `${entry.customEvent.duration}分` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
