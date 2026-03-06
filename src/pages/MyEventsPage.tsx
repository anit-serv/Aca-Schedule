import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { eventService, collaboratorService } from '../services/firestore';
import type { EventSettings } from '../types';

export const MyEventsPage = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventSettings[]>([]);
  const [sharedEvents, setSharedEvents] = useState<EventSettings[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!currentUser) return;

    const loadEvents = async () => {
      try {
        const [userEvents, collaborated] = await Promise.all([
          eventService.getEventsByOwner(currentUser.uid),
          currentUser.email
            ? collaboratorService.getSharedEvents(currentUser.email)
            : Promise.resolve([]),
        ]);
        setEvents(userEvents);
        setSharedEvents(collaborated);
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

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpenId]);

  // イベントを削除
  const handleDeleteEvent = async (eventId: string, eventName: string) => {
    if (!confirm(`「${eventName}」を削除しますか？\nこの操作は取り消せません。`)) {
      return;
    }
    setIsProcessing(true);
    setMenuOpenId(null);
    try {
      await eventService.deleteEvent(eventId);
      setEvents(prev => prev.filter(e => e.id !== eventId));
    } catch (error) {
      console.error('イベント削除エラー:', error);
      alert('イベントの削除に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  // イベントをコピー
  const handleCopyEvent = async (eventId: string) => {
    if (!currentUser) return;
    setIsProcessing(true);
    setMenuOpenId(null);
    try {
      const newEventId = await eventService.copyEvent(eventId, currentUser.uid);
      // イベント一覧を再読み込み
      const userEvents = await eventService.getEventsByOwner(currentUser.uid);
      setEvents(userEvents);
      // 新しいイベントに移動
      navigate(`/events/${newEventId}`);
    } catch (error) {
      console.error('イベントコピーエラー:', error);
      alert('イベントのコピーに失敗しました');
    } finally {
      setIsProcessing(false);
    }
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
              <div
                key={event.id}
                className="bg-white rounded-lg p-5 text-left hover:shadow-md hover:ring-1 hover:ring-emerald-400 transition-all group border-l-4 border-l-emerald-400 border border-gray-200 relative"
              >
                <button
                  onClick={() => navigate(`/events/${event.id}`)}
                  className="w-full text-left"
                  disabled={isProcessing}
                >
                  <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-600 transition-colors pr-8">
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
                
                {/* 三点リーダーメニュー */}
                <div className="absolute top-4 right-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === event.id ? null : event.id);
                    }}
                    className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                    disabled={isProcessing}
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>
                  
                  {menuOpenId === event.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 min-w-[120px]"
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyEvent(event.id);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                        disabled={isProcessing}
                      >
                        <span>📋</span>
                        コピー
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEvent(event.id, event.name);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        disabled={isProcessing}
                      >
                        <span>🗑️</span>
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 共有されたイベント */}
        {sharedEvents.length > 0 && (
          <div className="mt-10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-700">共有されたイベント</h2>
              <p className="text-sm text-gray-400">{sharedEvents.length}件</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedEvents.map((event) => (
                <div
                  key={event.id}
                  className="bg-white rounded-lg p-5 text-left hover:shadow-md hover:ring-1 hover:ring-blue-400 transition-all group border-l-4 border-l-blue-400 border border-gray-200 relative"
                >
                  <button
                    onClick={() => navigate(`/events/${event.id}`)}
                    className="w-full text-left"
                    disabled={isProcessing}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold group-hover:text-blue-600 transition-colors">
                        {event.name}
                      </h3>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                        共有
                      </span>
                    </div>
                    <div className="space-y-1 text-sm text-gray-500">
                      <p>📅 {event.year}年</p>
                      {event.venue && <p>📍 {event.venue}</p>}
                      <p>
                        🎤 本番日:{' '}
                        {event.performanceDates.map(formatDate).join(', ')}
                      </p>
                    </div>
                  </button>

                  {/* 辞退ボタン */}
                  <div className="absolute top-4 right-4">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!currentUser?.email) return;
                        if (!confirm(`「${event.name}」の共同編集を辞退しますか？`)) return;
                        setIsProcessing(true);
                        try {
                          await collaboratorService.declineCollaboration(event.id, currentUser.email);
                          setSharedEvents(prev => prev.filter(e => e.id !== event.id));
                        } catch (error) {
                          console.error('共同編集の辞退に失敗:', error);
                          alert('辞退に失敗しました');
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-red-500 transition-colors"
                      disabled={isProcessing}
                      title="共同編集を辞退"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </button>
                  </div>

                  {/* オーナー権限移譲の通知 */}
                  {event.pendingOwnerEmail && currentUser?.email && event.pendingOwnerEmail.toLowerCase() === currentUser.email.toLowerCase() && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                      <p className="text-xs text-blue-700 font-bold mb-1">📩 オーナー権限の移譲リクエスト</p>
                      <p className="text-xs text-blue-600 mb-2">イベントを開いて共有パネルから承認・拒否できます</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
