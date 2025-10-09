import { useState } from 'react';

// === コンポーネント定義 ===

// バンド管理モードの表示コンポーネント
const BandManagementView = () => (
  <div className="p-8">
    <h2 className="text-2xl font-bold mb-4">バンド管理モード</h2>
    <p className="text-gray-400">ここに、バンド情報を一覧で管理する画面を作成します。</p>
  </div>
);

// タイムテーブル編集モードの表示コンポーネント
const TimetableView = () => (
  <div className="p-8">
    <h2 className="text-2xl font-bold mb-4">タイムテーブル編集モード</h2>
    <p className="text-gray-400">ここに、タイムテーブルを編集する画面を作成します。</p>
  </div>
);

// モードを定義するための型
type Mode = 'band-management' | 'timetable-editing';

function App() {
  // 現在のモードを管理するための状態
  const [mode, setMode] = useState<Mode>('band-management');

  return (
    // 全体を囲むコンテナ。ダークテーマの背景色とテキスト色を設定
    <div className="bg-gray-900 text-white min-h-screen font-sans">
      {/* ヘッダーセクション */}
      <header className="bg-gray-800 shadow-lg">
        <nav className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold">Aca-Schedule</h1>
          <div className="flex space-x-2">
            <button
              onClick={() => setMode('band-management')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'band-management'
                  ? 'bg-blue-600 text-white' // アクティブなボタンのスタイル
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600' // 非アクティブなボタンのスタイル
              }`}
            >
              バンド管理
            </button>
            <button
              onClick={() => setMode('timetable-editing')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                mode === 'timetable-editing'
                  ? 'bg-blue-600 text-white' // アクティブなボタンのスタイル
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600' // 非アクティブなボタンのスタイル
              }`}
            >
              タイムテーブル編集
            </button>
          </div>
        </nav>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-6">
        {mode === 'band-management' ? <BandManagementView /> : <TimetableView />}
      </main>
    </div>
  );
}

export default App;

