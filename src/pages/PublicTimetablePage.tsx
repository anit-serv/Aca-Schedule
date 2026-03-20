import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { eventService, bandService, timetableService } from '../services/firestore';
import { CustomFieldsTable } from '../components/CustomFieldsTable';
import { TimetableSearch } from '../components/TimetableSearch';
import type { Band, EventSettings, Timetable, DailyTimetable } from '../types';

type LoadingState = 'loading' | 'loaded' | 'not-found' | 'not-public' | 'error';

export const PublicTimetablePage = () => {
  const { eventId } = useParams<{ eventId: string }>();

  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [eventSettings, setEventSettings] = useState<EventSettings | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [performanceTimetable, setPerformanceTimetable] = useState<Timetable | null>(null);
  const [rehearsalTimetable, setRehearsalTimetable] = useState<Timetable | null>(null);

  // タイムテーブルタイプ・日付の選択
  const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
  const [selectedDate, setSelectedDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // データ読み込み
  useEffect(() => {
    if (!eventId) {
      setLoadingState('not-found');
      return;
    }

    const loadData = async () => {
      try {
        const settings = await eventService.getEvent(eventId);
        if (!settings) {
          setLoadingState('not-found');
          return;
        }
        if (!settings.isPublic) {
          setLoadingState('not-public');
          return;
        }

        setEventSettings(settings);

        // 初期日付を設定
        if (settings.performanceDates.length > 0) {
          setSelectedDate(settings.performanceDates[0]);
        }

        // バンドとタイムテーブルを並列で取得
        const [fetchedBands, perfTimetable, rehTimetable] = await Promise.all([
          bandService.getBands(eventId),
          timetableService.getTimetable(eventId, 'performance'),
          settings.rehearsalType !== 'none'
            ? timetableService.getTimetable(eventId, 'rehearsal')
            : Promise.resolve(null),
        ]);

        setBands(fetchedBands);
        setPerformanceTimetable(perfTimetable);
        setRehearsalTimetable(rehTimetable);
        setLoadingState('loaded');
      } catch (err) {
        console.error('[PublicTimetablePage] 読み込みエラー:', err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorCode = (err as any)?.code;
        if (errorCode === 'permission-denied') {
          setLoadingState('not-public');
        } else {
          setLoadingState('error');
        }
      }
    };

    loadData();
  }, [eventId]);

  // 日付リスト
  const dateList = useMemo(() => {
    if (!eventSettings) return [];
    if (timetableType === 'performance') {
      return eventSettings.performanceDates;
    }
    if (eventSettings.rehearsalType === 'cool-pre-rehearsal' || eventSettings.rehearsalType === 'day-start-rehearsal') {
      return eventSettings.performanceDates;
    }
    return eventSettings.rehearsalDates || [];
  }, [eventSettings, timetableType]);

  // タイムテーブルタイプ切り替え
  const handleTypeChange = (newType: 'performance' | 'rehearsal') => {
    setTimetableType(newType);
    const dates = newType === 'performance'
      ? eventSettings?.performanceDates || []
      : (eventSettings?.rehearsalType === 'cool-pre-rehearsal' || eventSettings?.rehearsalType === 'day-start-rehearsal')
        ? eventSettings?.performanceDates || []
        : eventSettings?.rehearsalDates || [];
    if (dates.length > 0 && !dates.includes(selectedDate)) {
      setSelectedDate(dates[0]);
    }
  };

  // 現在のタイムテーブル
  const timetable = timetableType === 'performance' ? performanceTimetable : rehearsalTimetable;

  const currentTimetable: DailyTimetable = useMemo(() => {
    const dt = timetable?.dailyTimetables.find(d => d.date === selectedDate);
    if (!dt) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [],
        entries: [],
      };
    }
    return dt;
  }, [timetable, selectedDate]);

  // 当日一括リハーサル用：本番とリハーサルの日別タイムテーブル
  const performanceDailyTimetable: DailyTimetable = useMemo(() => {
    const dt = performanceTimetable?.dailyTimetables.find(d => d.date === selectedDate);
    if (!dt) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [],
        entries: [],
      };
    }
    return dt;
  }, [performanceTimetable, selectedDate]);

  const rehearsalDailyTimetable: DailyTimetable = useMemo(() => {
    const dt = rehearsalTimetable?.dailyTimetables.find(d => d.date === selectedDate);
    if (!dt) {
      return {
        date: selectedDate,
        startTime: '10:00',
        cools: [],
        entries: [],
      };
    }
    return dt;
  }, [rehearsalTimetable, selectedDate]);

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[date.getDay()];
    return `${month}/${day}(${weekday})`;
  };

  // ローディング
  if (loadingState === 'loading') {
    return (
      <div className="bg-gray-50 text-gray-900 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
          <p className="text-lg text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  // エラー状態
  if (loadingState !== 'loaded' || !eventSettings) {
    const config = {
      'not-found': {
        icon: '🔍',
        title: 'ページが見つかりませんでした',
        message: 'このイベントは存在しないか、削除された可能性があります。',
      },
      'not-public': {
        icon: '🔒',
        title: '非公開のイベントです',
        message: 'このイベントは現在共有されていません。イベント管理者にお問い合わせください。',
      },
      error: {
        icon: '⚠️',
        title: '読み込みエラー',
        message: '情報の読み込みに失敗しました。しばらくしてからもう一度お試しください。',
      },
    }[loadingState as 'not-found' | 'not-public' | 'error'] || {
      icon: '⚠️',
      title: 'エラー',
      message: '予期しないエラーが発生しました。',
    };

    return (
      <div className="bg-gray-50 text-gray-900 min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4">{config.icon}</div>
            <h1 className="text-2xl font-bold mb-2">{config.title}</h1>
            <p className="text-gray-500 mb-6">{config.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const hasRehearsal = eventSettings.rehearsalType !== 'none';
  
  // 当日一括リハーサルの場合、リハと本番を1ページに表示
  const showCombinedView = eventSettings.rehearsalType === 'day-start-rehearsal';
  // クール直前リハーサルの場合、クール単位でリハ→本番の交互表示
  const showInterleavedCoolPreView = eventSettings.rehearsalType === 'cool-pre-rehearsal';

  const rehearsalCoolIds = (rehearsalDailyTimetable.cools || []).map(cool => cool.id);
  const performanceCoolIds = (performanceDailyTimetable.cools || []).map(cool => cool.id);
  const interleavedCoolCount = Math.max(rehearsalCoolIds.length, performanceCoolIds.length);

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen sm:h-screen font-sans flex flex-col sm:overflow-hidden">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{eventSettings.name}</h1>
              <p className="text-sm text-gray-500">
                {eventSettings.year}年 @ {eventSettings.venue}
                <span className="ml-3 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  閲覧専用
                </span>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* コントロールバー */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-2 sm:gap-4">
          {/* 本番/リハーサル切り替え - 当日一括リハーサルでは非表示（両方表示するため） */}
          {hasRehearsal && !showCombinedView && !showInterleavedCoolPreView && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleTypeChange('performance')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  timetableType === 'performance'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                本番
              </button>
              <button
                onClick={() => handleTypeChange('rehearsal')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  timetableType === 'rehearsal'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                リハーサル
              </button>
            </div>
          )}

          {/* 日付セレクター */}
          {dateList.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto">
              {((showCombinedView || showInterleavedCoolPreView) ? eventSettings.performanceDates : dateList).map(date => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    selectedDate === date
                      ? 'bg-emerald-500 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {formatDate(date)}
                </button>
              ))}
            </div>
          )}

          {/* 検索 */}
          <div className="w-full sm:w-auto sm:ml-auto">
            <TimetableSearch
              bands={bands}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="flex-1 flex flex-col min-h-0 overflow-auto p-4">
        {showCombinedView ? (
          // 当日一括リハーサル：リハーサルと本番を縦に並べて表示
          <div className="flex-1 flex flex-col gap-4 overflow-auto pb-8">
            {/* リハーサルセクション */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                  リハーサル
                </span>
              </div>
              <CustomFieldsTable
                currentTimetable={rehearsalDailyTimetable}
                bands={bands}
                timetable={rehearsalTimetable}
                eventSettings={eventSettings}
                timetableType="rehearsal"
                selectedDate={selectedDate}
                onCustomFieldsChange={() => {}}
                readOnly
                searchQuery={searchQuery}
                disablePerformanceBottomSpacer
              />
            </div>
            {/* 本番セクション */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  本番
                </span>
              </div>
              <CustomFieldsTable
                currentTimetable={performanceDailyTimetable}
                bands={bands}
                timetable={performanceTimetable}
                eventSettings={eventSettings}
                timetableType="performance"
                selectedDate={selectedDate}
                onCustomFieldsChange={() => {}}
                readOnly
                searchQuery={searchQuery}
                disablePerformanceBottomSpacer
              />
            </div>
          </div>
        ) : showInterleavedCoolPreView ? (
          // クール直前リハーサル：クール単位でリハ→本番を交互表示
          <div className="flex-1 flex flex-col gap-4 overflow-auto pb-8">
            {Array.from({ length: interleavedCoolCount }, (_, coolIndex) => {
              const rehearsalCoolId = rehearsalCoolIds[coolIndex];
              const performanceCoolId = performanceCoolIds[coolIndex];

              return (
                <div key={`public-cool-pair-${coolIndex}`} className="space-y-3">
                  {rehearsalCoolId && (
                    <div className="flex-shrink-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                          第{coolIndex + 1}クール リハーサル
                        </span>
                      </div>
                      <CustomFieldsTable
                        currentTimetable={rehearsalDailyTimetable}
                        bands={bands}
                        timetable={rehearsalTimetable}
                        eventSettings={eventSettings}
                        timetableType="rehearsal"
                        selectedDate={selectedDate}
                        onCustomFieldsChange={() => {}}
                        readOnly
                        searchQuery={searchQuery}
                        visibleCoolIds={[rehearsalCoolId]}
                        disablePerformanceBottomSpacer
                      />
                    </div>
                  )}

                  {performanceCoolId && (
                    <div className="flex-shrink-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          第{coolIndex + 1}クール 本番
                        </span>
                      </div>
                      <CustomFieldsTable
                        currentTimetable={performanceDailyTimetable}
                        bands={bands}
                        timetable={performanceTimetable}
                        eventSettings={eventSettings}
                        timetableType="performance"
                        selectedDate={selectedDate}
                        onCustomFieldsChange={() => {}}
                        readOnly
                        searchQuery={searchQuery}
                        visibleCoolIds={[performanceCoolId]}
                        disablePerformanceBottomSpacer
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <CustomFieldsTable
            currentTimetable={currentTimetable}
            bands={bands}
            timetable={timetable}
            eventSettings={eventSettings}
            timetableType={timetableType}
            selectedDate={selectedDate}
            onCustomFieldsChange={() => {}}
            readOnly
            searchQuery={searchQuery}
          />
        )}
      </main>
    </div>
  );
};
