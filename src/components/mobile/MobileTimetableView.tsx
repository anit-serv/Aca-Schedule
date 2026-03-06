import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Band, EventSettings, Timetable, DailyTimetable, Cool, TimetableEntry } from '../../types';
import { calculateBandNumbers } from '../../utils/calculateBandNumbers';
import { useTimetableHelpers } from '../../hooks/useTimetableHelpers';

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
}: MobileTimetableViewProps) => {
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

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
  const onTimetableChange = timetableType === 'performance' ? onPerformanceTimetableChange : onRehearsalTimetableChange;

  // タイムテーブルヘルパー
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

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['\u65E5', '\u6708', '\u706B', '\u6C34', '\u6728', '\u91D1', '\u571F'];
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
  };

  // バンド名取得
  const getBandName = (bandId: string) => {
    return bands.find(b => b.id === bandId)?.name || '\u4E0D\u660E';
  };

  // リハーサルタイプの判定
  const hasRehearsal = eventSettings.rehearsalType !== 'none';

  // 選択中バンドの名前
  const selectedBandName = selectedBandId ? getBandName(selectedBandId) : null;

  // --- 編集ハンドラー ---

  // タイムテーブル更新ヘルパー
  const updateTimetable = useCallback((updater: (dt: DailyTimetable) => DailyTimetable) => {
    if (!currentTimetable) return;
    const updated = updater(currentTimetable);
    onTimetableChange(updated);
  }, [currentTimetable, onTimetableChange]);

  // バンドをクールの末尾に配置
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

  // バンドを特定位置に挿入
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

  // エントリー削除
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

  // エントリー移動 (up/down)
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

  // 開始時刻変更
  const handleStartTimeChange = useCallback((newStartTime: string) => {
    if (!currentTimetable) return;
    updateTimetable((dt) => {
      const recalculated = recalculateTimes(dt.cools, newStartTime);
      return { ...dt, startTime: newStartTime, cools: recalculated };
    });
  }, [currentTimetable, updateTimetable, recalculateTimes]);

  // クール数変更
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

  return (
    <div className="flex flex-col h-full">
      {/* 選択中バンドバナー */}
      <AnimatePresence>
        {selectedBandId && selectedBandName && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex-shrink-0 bg-emerald-500 text-white px-3 py-2 flex items-center justify-between overflow-hidden"
          >
            <span className="text-sm font-medium">
              {'\uD83C\uDFB5'} {'\u300C'}{selectedBandName}{'\u300D'}{'\u3092\u914D\u7F6E\u4E2D'} {'\u2014'} {'\u30BF\u30C3\u30D7\u3067\u633F\u5165'}
            </span>
            <button
              onClick={onBandPlaced}
              className="text-emerald-100 hover:text-white text-xs underline flex-shrink-0 ml-2"
            >
              {'\u30AD\u30E3\u30F3\u30BB\u30EB'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
              {'\u672C\u756A'}
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
              {'\u30EA\u30CF\u30FC\u30B5\u30EB'}
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

        {/* 開始時刻（編集可能）+ クール数コントロール */}
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
            {/* クール数コントロール */}
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
        )}
      </div>

      {/* タイムテーブル本体（縦スクロール） */}
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
                totalCools={currentTimetable.cools.length}
                bands={bands}
                bandNumbers={bandNumbers}
                getBandName={getBandName}
                selectedBandId={selectedBandId}
                expandedEntryId={expandedEntryId}
                onToggleExpand={(entryId) =>
                  setExpandedEntryId(prev => prev === entryId ? null : entryId)
                }
                onPlaceBand={() => handlePlaceBandInCool(coolIndex)}
                onInsertBandAt={(insertIndex) => handleInsertBandAt(coolIndex, insertIndex)}
                onRemoveEntry={(entryId) => handleRemoveEntry(coolIndex, entryId)}
                onMoveEntry={(entryIndex, direction) => handleMoveEntry(coolIndex, entryIndex, direction)}
              />
            ))}
          </div>
        )}
      </div>

      {/* バンドバンクFAB */}
      <button
        onClick={onOpenBandBank}
        className="fixed bottom-[calc(60px+env(safe-area-inset-bottom,0px)+12px)] right-4 w-12 h-12 bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center z-30 active:scale-95 transition-transform"
        title={'\u30D0\u30F3\u30C9\u30D0\u30F3\u30AF'}
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
  selectedBandId,
  expandedEntryId,
  onToggleExpand,
  onPlaceBand,
  onInsertBandAt,
  onRemoveEntry,
  onMoveEntry,
}: {
  cool: Cool;
  totalCools: number;
  bands: Band[];
  bandNumbers: Map<string, number>;
  getBandName: (bandId: string) => string;
  selectedBandId: string | null;
  expandedEntryId: string | null;
  onToggleExpand: (entryId: string) => void;
  onPlaceBand: () => void;
  onInsertBandAt: (insertIndex: number) => void;
  onRemoveEntry: (entryId: string) => void;
  onMoveEntry: (entryIndex: number, direction: 'up' | 'down') => void;
}) => {
  // 挿入ゾーンコンポーネント
  const InsertionZone = ({ insertIndex }: { insertIndex: number }) => {
    if (!selectedBandId) return null;
    return (
      <button
        onClick={() => onInsertBandAt(insertIndex)}
        className="w-full py-1 flex items-center justify-center gap-1 group"
      >
        <div className="flex-1 h-px bg-emerald-300 group-active:bg-emerald-500" />
        <span className="text-[10px] text-emerald-500 font-medium px-1.5 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 group-active:bg-emerald-100">
          + {'\u3053\u3053\u306B\u633F\u5165'}
        </span>
        <div className="flex-1 h-px bg-emerald-300 group-active:bg-emerald-500" />
      </button>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* クールヘッダー */}
      <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border-b border-emerald-100">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-emerald-700">
            {totalCools > 1 ? `\u7B2C${cool.number}\u30AF\u30FC\u30EB` : '\u30BF\u30A4\u30E0\u30C6\u30FC\u30D6\u30EB'}
          </span>
          {cool.startTime && (
            <span className="text-xs text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
              {cool.startTime}{'\u301C'}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{cool.entries.length}{'\u7D44'}</span>
      </div>

      {/* エントリーリスト */}
      {cool.entries.length === 0 ? (
        <div className="px-3 py-4">
          {selectedBandId ? (
            <button
              onClick={onPlaceBand}
              className="w-full py-3 border-2 border-dashed border-emerald-300 rounded-lg text-emerald-600 text-xs font-medium bg-emerald-50 active:bg-emerald-100"
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

            return (
              <div key={entry.id}>
                {/* 挿入ゾーン（エントリーの前） */}
                <InsertionZone insertIndex={entryIndex} />

                {/* エントリー行 */}
                <div
                  onClick={() => onToggleExpand(entry.id)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-gray-50' : 'active:bg-gray-50'
                  }`}
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
                        {'\u8EE2\u63DB'}{entry.transitionTime}{'\u5206'}
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
                        {entry.customEvent?.name || '\u30AB\u30B9\u30BF\u30E0'}
                      </span>
                    )}
                  </div>

                  {/* 時間 */}
                  <div className="flex-shrink-0 text-xs text-gray-400">
                    {isBand && band ? `${band.performanceDuration}\u5206` : entry.customEvent?.duration ? `${entry.customEvent.duration}\u5206` : ''}
                  </div>

                  {/* 展開アイコン */}
                  <div className="flex-shrink-0 text-gray-300">
                    <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* アクションパネル（展開時） */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-end gap-2 px-3 py-1.5 bg-gray-50 border-t border-gray-100">
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* 末尾の挿入ゾーン */}
          {selectedBandId && (
            <div className="px-3 py-2">
              <button
                onClick={onPlaceBand}
                className="w-full py-2 border-2 border-dashed border-emerald-300 rounded-lg text-emerald-600 text-xs font-medium bg-emerald-50 active:bg-emerald-100"
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
