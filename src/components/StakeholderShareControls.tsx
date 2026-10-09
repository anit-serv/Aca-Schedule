import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { viewerPasswordService } from '../services/viewer';
import { PasswordField } from './PasswordField';

export const StakeholderShareControls = ({ eventId }: { eventId: string }) => {
  const { firebaseUser } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    viewerPasswordService.status(firebaseUser, eventId)
      .then(result => { if (active) setConfigured(result.configured); })
      .catch(() => { if (active) setError('設定を読み込めませんでした。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [firebaseUser, eventId]);

  const save = async () => {
    if (!firebaseUser || working) return;
    if (password.length < 8 || password.length > 128) {
      setError('8〜128文字のパスワードを入力してください。');
      return;
    }
    if (password !== confirmPassword) {
      setError('確認用パスワードが一致しません。');
      return;
    }
    setWorking(true);
    setError('');
    try {
      await viewerPasswordService.set(firebaseUser, eventId, password);
      setConfigured(true);
      setPassword('');
      setConfirmPassword('');
    } catch {
      setError('パスワードを保存できませんでした。');
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!firebaseUser || working || !window.confirm('関係者ページのパスワードを解除しますか？')) return;
    setWorking(true);
    setError('');
    try {
      await viewerPasswordService.remove(firebaseUser, eventId);
      setConfigured(false);
    } catch {
      setError('パスワードを解除できませんでした。');
    } finally {
      setWorking(false);
    }
  };

  const url = `${window.location.origin}/stakeholder/${eventId}`;
  return (
    <section className="mt-6 border-t border-gray-200 pt-6">
      <h2 className="text-base font-semibold text-gray-900">閲覧パスワード</h2>
      <p className="mt-1 text-sm text-gray-500">パスワードを知る人は、一般非公開のカスタム列も閲覧できます。</p>
      {!loading && (
        <>
          <label htmlFor={`stakeholder-password-${eventId}`} className="mt-5 block text-sm font-medium text-gray-700">
            {configured ? 'パスワードを変更' : 'パスワードを設定'}
          </label>
          <form onSubmit={event => { event.preventDefault(); void save(); }} className="mt-2 space-y-3">
            <PasswordField
              id={`stakeholder-password-${eventId}`}
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); confirmPasswordRef.current?.focus(); } }}
              placeholder="8文字以上"
              minLength={8}
              maxLength={128}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
            <div>
              <label htmlFor={`stakeholder-password-confirm-${eventId}`} className="mb-1 block text-sm font-medium text-gray-700">パスワードを再入力</label>
              <PasswordField
                ref={confirmPasswordRef}
                id={`stakeholder-password-confirm-${eventId}`}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                maxLength={128}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <button type="submit" disabled={working || password.length < 8 || !confirmPassword} className="rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">{configured ? 'パスワードを変更' : 'パスワードを設定'}</button>
          </form>
          {configured && (
            <div className="mt-6 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-800">関係者ページは利用可能です</p>
              <label htmlFor={`stakeholder-url-${eventId}`} className="block text-xs text-gray-600">関係者用URL</label>
              <div className="flex gap-2">
                <input id={`stakeholder-url-${eventId}`} type="text" readOnly value={url} onClick={event => event.currentTarget.select()} className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700" />
                <button type="button" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }} className="rounded bg-emerald-500 px-3 py-2 text-sm text-white">{copied ? 'コピー済' : 'コピー'}</button>
              </div>
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-emerald-700 underline">入力画面を確認する</a>
              <div><button type="button" onClick={remove} disabled={working} className="text-sm text-red-600 hover:underline disabled:opacity-50">関係者ページを無効にする</button></div>
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  );
};
