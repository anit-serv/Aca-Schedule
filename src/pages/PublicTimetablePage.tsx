import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { eventService, bandService, timetableService } from '../services/firestore';
import { CustomFieldsTable } from '../components/CustomFieldsTable';
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
      <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-lg text-gray-400">読み込み中...</p>
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
      <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full mx-auto p-6">
          <div className="text-center">
            <div className="text-6xl mb-4">{config.icon}</div>
            <h1 className="text-2xl font-bold mb-2">{config.title}</h1>
            <p className="text-gray-400 mb-6">{config.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const hasRehearsal = eventSettings.rehearsalType !== 'none';

  return (
    <div className="bg-gray-900 text-white h-screen font-sans flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <header className="bg-gray-800 shadow-lg flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{eventSettings.name}</h1>
              <p className="text-sm text-gray-400">
                {eventSettings.year}年 @ {eventSettings.venue}
                <span className="ml-3 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-300 border border-green-700/50">
                  閲覧専用
                </span>
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* コントロールバー */}
      <div className="bg-gray-800/50 border-b border-gray-700 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 py-2 flex items-center gap-4">
          {/* 本番/リハーサル切り替え */}
          {hasRehearsal && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleTypeChange('performance')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  timetableType === 'performance'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                本番
              </button>
              <button
                onClick={() => handleTypeChange('rehearsal')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  timetableType === 'rehearsal'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                リハーサル
              </button>
            </div>
          )}

          {/* 日付セレクター */}
          {dateList.length > 0 && (
            <div className="flex items-center gap-1">
              {dateList.map(date => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    selectedDate === date
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {formatDate(date)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="flex-1 flex flex-col overflow-hidden p-4">
        <CustomFieldsTable
          currentTimetable={currentTimetable}
          bands={bands}
          timetable={timetable}
          eventSettings={eventSettings}
          timetableType={timetableType}
          selectedDate={selectedDate}
          onCustomFieldsChange={() => {}}
          readOnly
        />
      </main>
    </div>
  );
};
