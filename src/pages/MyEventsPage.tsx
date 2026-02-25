import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { eventService } from '../services/firestore';
import type { EventSettings } from '../types';

export const MyEventsPage = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    const loadEvents = async () => {
      try {
        const userEvents = await eventService.getEventsByOwner(currentUser.uid);
        setEvents(userEvents);
      } catch (error) {
        console.error('[MyEventsPage] イベント読み込みエラー:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvents();
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('ログアウトエラー:', error);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen font-sans">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-emerald-600">マイイベント</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {currentUser?.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  alt=""
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-sm font-bold text-white">
                  {(currentUser?.displayName || currentUser?.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm text-gray-600">
                {currentUser?.displayName || currentUser?.email}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <p className="text-gray-500">
            {isLoading ? '読み込み中...' : `${events.length}件のイベント`}
          </p>
          <button
            onClick={() => navigate('/events/new')}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md font-medium transition-colors"
          >
            + 新規イベント作成
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🎵</div>
            <h2 className="text-xl font-bold mb-2">イベントがありません</h2>
            <p className="text-gray-500 mb-6">
              最初のイベントを作成して、タイムテーブルの編集を始めましょう
            </p>
            <button
              onClick={() => navigate('/events/new')}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-md font-medium transition-colors"
            >
              新規イベント作成
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((event) => (
              <button
                key={event.id}
                onClick={() => navigate(`/events/${event.id}`)}
                className="bg-white rounded-lg p-5 text-left hover:shadow-md hover:ring-1 hover:ring-emerald-400 transition-all group border-l-4 border-l-emerald-400 border border-gray-200"
              >
                <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-600 transition-colors">
                  {event.name}
                </h3>
                <div className="space-y-1 text-sm text-gray-500">
                  <p>📅 {event.year}年</p>
                  {event.venue && <p>📍 {event.venue}</p>}
                  <p>
                    🎤 本番日:{' '}
                    {event.performanceDates.map(formatDate).join(', ')}
                  </p>
                  <p className="text-xs mt-2 text-gray-400">
                    リハーサル形式:{' '}
                    {event.rehearsalType === 'none'
                      ? 'なし'
                      : event.rehearsalType === 'rehearsal-day'
                        ? '別日リハーサル'
                        : event.rehearsalType === 'cool-pre-rehearsal'
                          ? 'クール直前'
                          : '当日一括'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
