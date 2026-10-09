import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Band, EventSettings, Timetable } from '../types';
import { viewerService } from '../services/viewer';
import { Icon } from '../components/Icon';
import { PublicCardTimetable } from '../components/PublicCardTimetable';
import { StakeholderProgressPage } from '../components/StakeholderProgressPage';
import { PasswordField } from '../components/PasswordField';
import type { ProgressRecord } from '../services/stakeholderProgress';

type LoadingState = 'loading' | 'loaded' | 'not-found' | 'not-public' | 'password' | 'error';

export const PublicTimetablePage = ({ audience = 'public' }: { audience?: 'public' | 'stakeholder' }) => {
  const { eventId } = useParams<{ eventId: string }>();
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [password, setPassword] = useState('');
  const [stakeholderPassword, setStakeholderPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [eventSettings, setEventSettings] = useState<EventSettings | null>(null);
  const [bands, setBands] = useState<Band[]>([]);
  const [performanceTimetable, setPerformanceTimetable] = useState<Timetable | null>(null);
  const [rehearsalTimetable, setRehearsalTimetable] = useState<Timetable | null>(null);
  const [progressRecords, setProgressRecords] = useState<Record<string, ProgressRecord>>({});

  useEffect(() => {
    setEventSettings(null); setBands([]); setPerformanceTimetable(null); setRehearsalTimetable(null); setProgressRecords({});
    setPassword(''); setStakeholderPassword(''); setPasswordError('');
    if (!eventId) { setLoadingState('not-found'); return; }
    if (audience === 'stakeholder') { setLoadingState('password'); return; }
    let active = true;
    setLoadingState('loading');
    viewerService.loadPublic(eventId).then(data => {
      if (!active) return;
      setEventSettings(data.settings);
      setBands(data.bands);
      setPerformanceTimetable(data.timetables.find(table => table.type === 'performance') || null);
      setProgressRecords(data.progressRecords);
      setLoadingState('loaded');
    }).catch(error => {
      if (!active) return;
      const code = error instanceof Error ? error.message : '';
      setLoadingState(code === 'NOT_FOUND' ? 'not-found' : code === 'NOT_PUBLIC' ? 'not-public' : 'error');
    });
    return () => { active = false; };
  }, [eventId, audience]);

  useEffect(() => {
    if (audience !== 'public' || loadingState !== 'loaded' || !eventId) return;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || refreshing) return;
      refreshing = true;
      try {
        const data = await viewerService.loadPublic(eventId);
        if (!active) return;
        setEventSettings(data.settings);
        setBands(data.bands);
        setPerformanceTimetable(data.timetables.find(table => table.type === 'performance') || null);
        setProgressRecords(data.progressRecords);
      } catch (error) {
        if (active && error instanceof Error && (error.message === 'NOT_PUBLIC' || error.message === 'NOT_FOUND')) {
          setLoadingState(error.message === 'NOT_PUBLIC' ? 'not-public' : 'not-found');
        }
      } finally { refreshing = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [audience, eventId, loadingState]);

  const handleStakeholderLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!eventId || !password) return;
    setLoadingState('loading'); setPasswordError('');
    try {
      const data = await viewerService.loadStakeholder(eventId, password);
      setEventSettings(data.settings);
      setBands(data.bands);
      setPerformanceTimetable(data.timetables.find(table => table.type === 'performance') || null);
      setRehearsalTimetable(data.timetables.find(table => table.type === 'rehearsal') || null);
      setStakeholderPassword(password); setPassword(''); setLoadingState('loaded');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setPasswordError(code === 'RATE_LIMITED' ? '試行回数が多すぎます。しばらくしてから再度お試しください。' : 'パスワードを確認してください。');
      setLoadingState('password');
    }
  };

  if (loadingState === 'loading') return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" /><p className="text-gray-500">読み込み中...</p></div></div>;
  if (loadingState === 'password') return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 text-gray-900"><form onSubmit={handleStakeholderLogin} className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2 mb-2"><Icon name="lock" className="text-emerald-600" /><h1 className="text-xl font-semibold">関係者ページ</h1></div><p className="text-sm text-gray-500 mb-5">共有されたパスワードを入力してください。</p><label htmlFor="viewer-password" className="block text-sm font-medium mb-1">パスワード</label><PasswordField id="viewer-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded border border-gray-300 px-3 py-2" required />{passwordError && <p role="alert" className="mt-2 text-sm text-red-600">{passwordError}</p>}<button type="submit" className="mt-4 w-full rounded bg-emerald-500 px-4 py-2 font-medium text-white hover:bg-emerald-600">開く</button></form></div>;
  if (loadingState !== 'loaded' || !eventSettings) {
    const config = loadingState === 'not-found' ? { icon: 'search', title: 'ページが見つかりませんでした', message: 'このイベントは存在しないか、削除された可能性があります。' }
      : loadingState === 'not-public' ? { icon: 'lock', title: '非公開のイベントです', message: 'このイベントは現在共有されていません。イベント管理者にお問い合わせください。' }
      : { icon: 'warning', title: '読み込みエラー', message: '情報の読み込みに失敗しました。しばらくしてからもう一度お試しください。' };
    return <div className="min-h-screen bg-gray-50 text-gray-900 flex items-center justify-center p-6"><div className="text-center"><Icon name={config.icon} className="text-6xl" /><h1 className="text-2xl font-bold my-2">{config.title}</h1><p className="text-gray-500">{config.message}</p></div></div>;
  }
  if (audience === 'public') return <PublicCardTimetable settings={eventSettings} bands={bands} dailyTimetables={performanceTimetable?.dailyTimetables || []} progressRecords={progressRecords} eventId={eventId || ''} />;
  return <StakeholderProgressPage eventId={eventId || ''} password={stakeholderPassword} settings={eventSettings} bands={bands} performanceTimetable={performanceTimetable} rehearsalTimetable={rehearsalTimetable} />;
};
