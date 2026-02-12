import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

type AuthMode = 'login' | 'register';

export const LoginPage = () => {
  const { loginWithEmail, registerWithEmail, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getFirebaseErrorMessage = (code: string): string => {
    switch (code) {
      case 'auth/invalid-email':
        return 'メールアドレスの形式が正しくありません';
      case 'auth/user-disabled':
        return 'このアカウントは無効化されています';
      case 'auth/user-not-found':
        return 'このメールアドレスのアカウントが見つかりません';
      case 'auth/wrong-password':
        return 'パスワードが正しくありません';
      case 'auth/invalid-credential':
        return 'メールアドレスまたはパスワードが正しくありません';
      case 'auth/email-already-in-use':
        return 'このメールアドレスは既に使用されています';
      case 'auth/weak-password':
        return 'パスワードは6文字以上で設定してください';
      case 'auth/too-many-requests':
        return 'ログイン試行回数が多すぎます。しばらく時間をおいてからお試しください';
      case 'auth/popup-closed-by-user':
        return 'ログインがキャンセルされました';
      default:
        return 'エラーが発生しました。もう一度お試しください';
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('パスワードが一致しません');
        return;
      }
      if (!displayName.trim()) {
        setError('表示名を入力してください');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, displayName.trim());
      }
      navigate('/');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firebaseError = err as any;
      setError(getFirebaseErrorMessage(firebaseError.code || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await loginWithGoogle();
      navigate('/');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firebaseError = err as any;
      setError(getFirebaseErrorMessage(firebaseError.code || ''));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-900 text-white min-h-screen font-sans flex items-center justify-center">
      <div className="w-full max-w-md mx-auto p-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Aca-Schedule</h1>
          <p className="text-gray-400">アカペラサークルのスケジュール管理</p>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
          <h2 className="text-xl font-bold mb-6 text-center">
            {mode === 'login' ? 'ログイン' : 'アカウント作成'}
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-md text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium mb-1">表示名</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 田中太郎"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="example@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="6文字以上"
                minLength={6}
                required
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium mb-1">パスワード（確認）</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="パスワードを再入力"
                  minLength={6}
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md font-medium transition-colors"
            >
              {isSubmitting
                ? '処理中...'
                : mode === 'login'
                  ? 'メールアドレスでログイン'
                  : 'アカウントを作成'}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-800 text-gray-400">または</span>
            </div>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={isSubmitting}
            className="w-full py-2.5 bg-white text-gray-900 hover:bg-gray-100 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Googleアカウントでログイン
          </button>

          <div className="mt-6 text-center text-sm">
            {mode === 'login' ? (
              <p className="text-gray-400">
                アカウントをお持ちでない方は{' '}
                <button
                  type="button"
                  onClick={() => { setMode('register'); setError(null); }}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  新規登録
                </button>
              </p>
            ) : (
              <p className="text-gray-400">
                既にアカウントをお持ちの方は{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  ログイン
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
