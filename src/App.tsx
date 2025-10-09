import { useState, useEffect } from 'react';
import { BandManagement } from './components/BandManagement';
import { bandService } from './services/firestore';
import type { Band, EventSettings } from './types';

// === コンポーネント定義 ===

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
  
  // バンドとイベント設定の状態管理
  const [bands, setBands] = useState<Band[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [eventSettings, setEventSettings] = useState<EventSettings>({
    id: 'demo-event', // TODO: 実際のイベントIDを使用
    name: 'サンプルイベント',
    year: 2025,
    venue: 'サンプル会場',
    goal: 'イベントを成功させる',
    performanceDates: ['2025-10-15', '2025-10-16'], // デモ用の日付
    rehearsalType: 'none',
    presetDurations: [10, 15, 20, 25], // デフォルトのプリセット演奏時間
  });

  // バンドデータの読み込み
  useEffect(() => {
    // デモモードの場合はFirebaseを使用しない
    // TODO: 実際のイベントIDでFirebaseからデータを取得
    const eventId = eventSettings.id;
    
    // リアルタイム監視を設定
    const unsubscribe = bandService.subscribeToBands(eventId, (fetchedBands) => {
      setBands(fetchedBands);
    });

    // クリーンアップ
    return () => unsubscribe();
  }, [eventSettings.id]);

  // バンドデータの変更を処理
  const handleBandsChange = async (updatedBands: Band[]) => {
    // ローカル状態を即座に更新（楽観的更新）
    setBands(updatedBands);

    // TODO: Firestoreへの保存処理
    // 現時点では、各バンドの更新をFirestoreに反映する処理を実装
    // (BandManagementコンポーネント内で個別に処理する方が効率的)
  };

  return (
    // 全体を囲むコンテナ。ダークテーマの背景色とテキスト色を設定
    <div className="bg-gray-900 text-white min-h-screen font-sans">
      {/* ヘッダーセクション */}
      <header className="bg-gray-800 shadow-lg">
        <nav className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">{eventSettings.name}</h1>
            <p className="text-sm text-gray-400">{eventSettings.year}年 @ {eventSettings.venue}</p>
          </div>
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
      <main className="max-w-7xl mx-auto">
        {mode === 'band-management' ? (
          <BandManagement
            bands={bands}
            eventSettings={eventSettings}
            onBandsChange={handleBandsChange}
          />
        ) : (
          <TimetableView />
        )}
      </main>
    </div>
  );
}

export default App;

