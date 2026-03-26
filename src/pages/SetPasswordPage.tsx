import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export const SetPasswordPage = () => {
  const { currentUser, needsPasswordSetup, setPasswordForCurrentUser, logout } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      navigate('/login', { replace: true });
      return;
    }

    if (!needsPasswordSetup) {
      navigate('/', { replace: true });
    }
  }, [currentUser, needsPasswordSetup, navigate]);

  if (!currentUser || !needsPasswordSetup) {
    return null;
  }

  const getErrorMessage = (code: string) => {
    switch (code) {
      case 'auth/weak-password':
        return 'パスワードは6文字以上で設定してください';
      case 'auth/requires-recent-login':
        return 'セキュリティのため、再ログイン後にもう一度お試しください';
      case 'auth/email-already-in-use':
      case 'auth/provider-already-linked':
        return 'このアカウントは既にパスワード設定済みです。';
      default:
        return 'パスワード設定に失敗しました。もう一度お試しください';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (password.length < 6) {
      setError('パスワードは6文字以上で設定してください');
      return;
    }

    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    setIsSubmitting(true);
    try {
      await setPasswordForCurrentUser(password);
      navigate('/', { replace: true });
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firebaseError = err as any;
      setError(getErrorMessage(firebaseError.code || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 text-gray-900 min-h-screen font-sans flex items-center justify-center">
      <div className="w-full max-w-md mx-auto p-6">
        <div className="bg-white rounded-lg p-6 shadow-lg border border-gray-200">
          <h1 className="text-xl font-bold mb-2 text-center">パスワード設定</h1>
          <p className="text-sm text-gray-600 mb-6 text-center">
            セキュリティのため、利用を続けるにはパスワード設定が必要です。
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">新しいパスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="6文字以上"
                minLength={6}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">パスワード（確認）</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="もう一度入力"
                minLength={6}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md font-medium transition-colors text-white"
            >
              {isSubmitting ? '設定中...' : 'パスワードを設定'}
            </button>
          </form>

          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
            className="mt-4 w-full py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            別アカウントでログイン
          </button>
        </div>
      </div>
    </div>
  );
};
