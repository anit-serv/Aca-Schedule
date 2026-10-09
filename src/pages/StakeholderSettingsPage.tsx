import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StakeholderShareControls } from '../components/StakeholderShareControls';
import { Icon } from '../components/Icon';
import { useAuth } from '../hooks/useAuth';
import { eventService } from '../services/firestore';

export const StakeholderSettingsPage = () => {
  const { eventId } = useParams<{ eventId: string }>();
  const { currentUser } = useAuth();
  const [eventName, setEventName] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');

  useEffect(() => {
    if (!eventId || !currentUser) return;
    let active = true;
    eventService.getEvent(eventId)
      .then(settings => {
        if (!active) return;
        if (!settings || settings.ownerId !== currentUser.uid) {
          setState('forbidden');
          return;
        }
        setEventName(settings.name);
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [eventId, currentUser]);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-2xl">
        <Link to={eventId ? `/events/${eventId}` : '/'} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-emerald-700">
          <Icon name="arrow_back" className="text-lg" />イベントに戻る
        </Link>
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-2">
            <Icon name="lock" className="text-2xl text-emerald-600" />
            <h1 className="text-xl font-bold">関係者ページの設定</h1>
          </div>
          {state === 'loading' && <p className="mt-6 text-sm text-gray-500">読み込み中...</p>}
          {state === 'forbidden' && <p role="alert" className="mt-6 text-sm text-red-600">この設定はイベントのオーナーだけが変更できます。</p>}
          {state === 'error' && <p role="alert" className="mt-6 text-sm text-red-600">イベント情報を読み込めませんでした。</p>}
          {state === 'ready' && eventId && (
            <>
              <p className="mt-2 text-sm text-gray-500">{eventName}</p>
              <p className="mt-5 text-sm text-gray-700">関係者に共有するパスワードを設定してください。設定後に表示されるURLとパスワードを別々に伝えられます。</p>
              <StakeholderShareControls eventId={eventId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};
