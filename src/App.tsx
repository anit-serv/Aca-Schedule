import { useState } from 'react';

// 将来作成する各モードのコンポーネントの仮の姿です
const BandManagementView = () => (
  <div className="p-8">
    <h2 className="text-2xl font-bold mb-4">バンド管理モード</h2>
    <p>ここに、バンド情報を一覧で管理する画面を作成します。</p>
  </div>
);

const TimetableView = () => (
  <div className="p-8">
    <h2 className="text-2xl font-bold mb-4">タイムテーブル編集モード</h2>
    <p>ここに、タイムテーブルを編集する画面を作成します。</p>
  </div>
);

// モードを切り替えるための型を定義します
type Mode = 'band-management' | 'timetable-editing';

function App() {
  // 現在のモードを管理するための状態（State）
  // 初期状態は 'band-management' に設定
  const [mode, setMode] = useState<Mode>('band-management');

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans">
      <header className="bg-gray-800 shadow-md">
        <nav className="container mx-auto px-6 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-200">Aca-Schedule</h1>
          {/* モードを切り替えるためのボタン */}
          <div className="flex space-x-2">
            <button
              onClick={() => setMode('band-management')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'band-management'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              バンド管理
            </button>
            <button
              onClick={() => setMode('timetable-editing')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'timetable-editing'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              タイムテーブル編集
            </button>
          </div>
        </nav>
      </header>

      <main>
        {/* 現在のモードに応じて、表示するコンポーネントを切り替える */}
        {mode === 'band-management' ? <BandManagementView /> : <TimetableView />}
      </main>
    </div>
  );
}

export default App;