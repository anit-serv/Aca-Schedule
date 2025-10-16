# Aca-Schedule 技術解説書

## 📚 目次

1. [基礎技術の解説](#基礎技術の解説)
2. [プロジェクト構造](#プロジェクト構造)
3. [データモデル](#データモデル)
4. [コンポーネント階層](#コンポーネント階層)
5. [詳細コンポーネント解説](#詳細コンポーネント解説)
6. [ユーティリティとサービス](#ユーティリティとサービス)
7. [状態管理とフック](#状態管理とフック)

---

## 基礎技術の解説

### React とは？

**React** は、Facebookが開発したJavaScriptのUIライブラリです。

#### コンポーネントベースの考え方
```typescript
// コンポーネント = UIの部品
function Button({ text, onClick }) {
  return <button onClick={onClick}>{text}</button>;
}

// コンポーネントを組み合わせてアプリを作る
function App() {
  return (
    <div>
      <Button text="保存" onClick={() => console.log('保存!')} />
      <Button text="キャンセル" onClick={() => console.log('キャンセル')} />
    </div>
  );
}
```

#### 重要な概念

**1. JSX (JavaScript XML)**
- HTMLのような構文でUIを記述
- 実際はJavaScriptのコードに変換される

```typescript
// JSXで書くと:
const element = <h1>Hello, {name}</h1>;

// 実際にはこう変換される:
const element = React.createElement('h1', null, 'Hello, ', name);
```

**2. Props (プロパティ)**
- 親コンポーネントから子コンポーネントへデータを渡す仕組み
- 読み取り専用（子が変更できない）

```typescript
// 親コンポーネント
<BandRow bandName="The Beatles" performanceTime={20} />

// 子コンポーネント
function BandRow({ bandName, performanceTime }) {
  return <div>{bandName}: {performanceTime}分</div>;
}
```

**3. State (状態)**
- コンポーネント内部で管理する変更可能なデータ
- stateが変わると、画面が自動的に再描画される

```typescript
function Counter() {
  const [count, setCount] = useState(0); // stateの定義
  
  return (
    <div>
      <p>カウント: {count}</p>
      <button onClick={() => setCount(count + 1)}>増やす</button>
    </div>
  );
}
```

**4. Hooks (フック)**
- `use`で始まる特別な関数
- コンポーネントに機能を追加する

主要なフック:
- `useState`: 状態管理
- `useEffect`: 副作用（データ取得など）
- `useMemo`: 計算結果のキャッシュ
- `useCallback`: 関数のキャッシュ

```typescript
// useEffect の例
useEffect(() => {
  // コンポーネントが表示された時に実行
  console.log('マウントされました');
  
  // クリーンアップ関数（コンポーネントが削除される時）
  return () => {
    console.log('アンマウントされます');
  };
}, []); // 空配列 = 初回のみ実行
```

### TypeScript とは？

JavaScriptに「型」の概念を追加した言語。エラーを事前に防げます。

```typescript
// JavaScript (型がない)
function add(a, b) {
  return a + b;
}
add(1, "2"); // "12" になってしまう（バグの原因）

// TypeScript (型がある)
function add(a: number, b: number): number {
  return a + b;
}
add(1, "2"); // エラー！ 文字列は渡せない
```

#### インターフェース (Interface)
オブジェクトの「形」を定義します。

```typescript
interface Band {
  id: string;
  name: string;
  performanceTime: number;
  members: string[];
}

// この形に従わないとエラー
const band: Band = {
  id: "1",
  name: "The Beatles",
  performanceTime: 20,
  members: ["John", "Paul", "George", "Ringo"]
};
```

### Firestore とは？

**Cloud Firestore** は、Googleが提供するNoSQLデータベースです。

#### 基本概念

**1. コレクションとドキュメント**
```
Firestore (データベース)
├── events (コレクション)
│   ├── event1 (ドキュメント)
│   │   ├── name: "春のライブ"
│   │   └── date: "2025-04-01"
│   └── event2 (ドキュメント)
│       ├── name: "夏フェス"
│       └── date: "2025-08-15"
└── users (コレクション)
    └── user1 (ドキュメント)
```

**2. データの読み書き**
```typescript
import { doc, getDoc, setDoc } from 'firebase/firestore';

// データを読み取る
const docRef = doc(db, 'events', 'event1');
const docSnap = await getDoc(docRef);
if (docSnap.exists()) {
  console.log(docSnap.data()); // { name: "春のライブ", ... }
}

// データを書き込む
await setDoc(doc(db, 'events', 'event1'), {
  name: "春のライブ",
  date: "2025-04-01"
});
```

**3. リアルタイム同期**
```typescript
import { onSnapshot } from 'firebase/firestore';

// データが変更されたら自動的に通知される
onSnapshot(doc(db, 'events', 'event1'), (doc) => {
  console.log("最新データ: ", doc.data());
});
```

### ES Modules (モジュールシステム)

ファイル間でコードを共有する仕組みです。

```typescript
// utils/math.ts (エクスポート側)
export function add(a: number, b: number) {
  return a + b;
}

export function subtract(a: number, b: number) {
  return a - b;
}

// App.tsx (インポート側)
import { add, subtract } from './utils/math';

console.log(add(5, 3)); // 8
```

**デフォルトエクスポート vs 名前付きエクスポート**
```typescript
// デフォルトエクスポート (ファイルに1つだけ)
export default function App() { ... }
import App from './App'; // 好きな名前でインポート可能

// 名前付きエクスポート (ファイルに複数可能)
export function add() { ... }
export function subtract() { ... }
import { add, subtract } from './math'; // 名前を合わせる必要がある
```

---

## プロジェクト構造

### ディレクトリ構成

```
Aca-Schedule/
├── public/              # 静的ファイル（画像など）
├── src/                 # ソースコード
│   ├── components/      # UIコンポーネント
│   ├── pages/           # ページコンポーネント
│   ├── hooks/           # カスタムフック（ロジックの再利用）
│   ├── services/        # 外部サービス連携（Firestoreなど）
│   ├── utils/           # ユーティリティ関数
│   ├── assets/          # アセット（画像、スタイルなど）
│   ├── App.tsx          # アプリのルートコンポーネント
│   ├── main.tsx         # エントリーポイント
│   ├── types.ts         # 型定義
│   └── firebase.ts      # Firebase初期化
├── package.json         # 依存パッケージの定義
├── tsconfig.json        # TypeScript設定
├── vite.config.ts       # Vite（ビルドツール）設定
└── tailwind.config.js   # Tailwind CSS設定
```

### 主要な依存パッケージ

**package.json の解説**
```json
{
  "dependencies": {
    "react": "^18.3.1",              // UIライブラリ
    "react-dom": "^18.3.1",          // ReactをDOMに描画
    "firebase": "^10.14.1",          // Firebase SDK
    "@dnd-kit/core": "^6.3.1",       // ドラッグ&ドロップ
    "@dnd-kit/sortable": "^9.0.0",   // ソート可能なリスト
    "react-router-dom": "^6.27.0"    // ページルーティング
  },
  "devDependencies": {
    "typescript": "~5.6.2",          // TypeScriptコンパイラ
    "vite": "^5.4.8",                // 高速ビルドツール
    "tailwindcss": "^3.4.14"         // CSSフレームワーク
  }
}
```

### ビルドとバンドル

**Vite** が各ファイルをまとめて、ブラウザで動くコードに変換します。

```
開発時:
npm run dev → Viteが開発サーバーを起動
           → http://localhost:5173 でアクセス
           → ファイル変更を監視して自動リロード

本番ビルド:
npm run build → dist/フォルダに最適化されたファイルを生成
              → このファイルをサーバーにデプロイ
```

---

## データモデル

### 型定義の全体像 (`src/types.ts`)

このアプリで使用する全てのデータ構造を定義しています。

#### Event (イベント)
```typescript
interface Event {
  id: string;                    // 一意のID (例: "evt_abc123")
  name: string;                  // イベント名 (例: "春のライブ2025")
  year: number;                  // 開催年 (例: 2025)
  venue: string;                 // 会場名 (例: "○○ホール")
  goal?: string;                 // 目標 (任意)
  performanceDates: string[];    // 本番日 (例: ["2025-04-01", "2025-04-02"])
  rehearsalType: RehearsalType;  // リハーサル形式
  rehearsalDates?: string[];     // リハーサル日 (別日の場合)
  bands: Band[];                 // バンド一覧
  customEvents: CustomEvent[];   // カスタムイベント（転換など）
  performanceTimetable?: Timetable;  // 本番タイムテーブル
  rehearsalTimetable?: Timetable;    // リハーサルタイムテーブル
  createdAt: Date;               // 作成日時
  updatedAt: Date;               // 更新日時
}
```

**RehearsalType（リハーサル形式）**
```typescript
type RehearsalType = 
  | 'rehearsal-day'    // 別日リハーサル
  | 'before-cool'      // クール直前リハーサル
  | 'all-at-once';     // 当日一括リハーサル
```

#### Band (バンド)
```typescript
interface Band {
  id: string;                    // バンドID
  name: string;                  // バンド名
  members: string[];             // メンバー名の配列
  performanceTime: number;       // 演奏時間（分）
  performanceCount: number;      // 出演回数
  availableSlots: TimeSlot[];    // 出演可能時間帯
  notes?: string;                // 備考
}
```

**TimeSlot（時間帯）**
```typescript
interface TimeSlot {
  date: string;      // 日付 (例: "2025-04-01")
  start: string;     // 開始時刻 (例: "14:00")
  end: string;       // 終了時刻 (例: "18:00")
}
```

#### Timetable (タイムテーブル)
```typescript
interface Timetable {
  days: TimetableDay[];  // 日ごとのタイムテーブル
}

interface TimetableDay {
  date: string;          // 日付
  cools: Cool[];         // その日のクール
}

interface Cool {
  id: string;            // クールID
  name: string;          // クール名 (例: "1stクール")
  entries: TimetableEntry[];  // エントリー（バンドやイベント）
}
```

**TimetableEntry（タイムテーブルのエントリー）**
```typescript
interface TimetableEntry {
  id: string;
  type: 'band' | 'custom-event' | 'cool-gap';  // エントリーの種類
  startTime: string;     // 開始時刻
  endTime: string;       // 終了時刻
  bandId?: string;       // バンドIDの場合
  customEventId?: string;// カスタムイベントIDの場合
}
```

### データの流れ

```
1. ユーザー入力
   ↓
2. Reactコンポーネント (State更新)
   ↓
3. Firestore (データ保存)
   ↓
4. リアルタイム同期
   ↓
5. 他のユーザーの画面も自動更新
```

---

## コンポーネント階層

### 全体の構造

```
App.tsx (ルートコンポーネント)
│
├── EventCreationWizard.tsx (新規イベント作成)
│
└── EventEditorPage.tsx (イベント編集画面)
    │
    ├── BandManagement.tsx (バンド管理モード)
    │   ├── BandRow.tsx (バンド1行)
    │   ├── BandBankDropZone.tsx (バンクのドロップゾーン)
    │   └── BandBankItem.tsx (バンクのバンドアイテム)
    │
    └── TimetableEditing.tsx (タイムテーブル編集モード)
        │
        ├── TimetableContextBar.tsx (日付選択・クール数設定)
        │
        ├── TimetableContent.tsx (タイムテーブル本体)
        │   │
        │   ├── CoolSection.tsx (クールセクション)
        │   │   ├── SortableTimetableRow.tsx (ドラッグ可能な行)
        │   │   └── CoolGapDropZone.tsx (クール間ドロップゾーン)
        │   │
        │   └── TimetableDropZone.tsx (クール外ドロップゾーン)
        │
        ├── BandBankDropZone.tsx (バンドバンク)
        │   └── BandBankItem.tsx
        │
        ├── TimetableDragOverlay.tsx (ドラッグ中のオーバーレイ)
        │
        ├── ViolationPanel.tsx (制約違反パネル)
        │
        ├── BandAvailabilityModal.tsx (出演可能時間設定モーダル)
        │
        └── EventSettingsModal.tsx (イベント設定モーダル)
```

### データの流れ（Props Drilling）

```
EventEditorPage
  ├── event (イベントデータ)
  │   ├─→ BandManagement
  │   └─→ TimetableEditing
  │       ├─→ TimetableContextBar
  │       └─→ TimetableContent
  │           └─→ CoolSection
  │               └─→ SortableTimetableRow
  │
  └── eventSettings (イベント設定)
      └─→ TimetableEditing
          ├─→ TimetableContextBar
          └─→ TimetableContent
              └─→ CoolSection (rehearsalType を使用)
```

---

## 詳細コンポーネント解説

### レイヤー1: エントリーポイント

#### `src/main.tsx`
**役割**: アプリケーションの起動ポイント

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// id="root"の要素にReactアプリをマウント
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**解説**:
- `ReactDOM.createRoot()`: React 18の新しいレンダリングAPI
- `StrictMode`: 開発時に潜在的な問題を検出するモード
- `index.html`の`<div id="root"></div>`にアプリ全体を描画

#### `src/App.tsx`
**役割**: ルーティングとレイアウトの管理

```typescript
function App() {
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);

  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-blue-600 text-white p-4">
          <h1>Aca-Schedule</h1>
        </header>
        
        <Routes>
          <Route path="/" element={
            <EventCreationWizard onEventCreated={setCurrentEventId} />
          } />
          <Route path="/events/:id" element={<EventEditorPage />} />
        </Routes>
      </div>
    </Router>
  );
}
```

**解説**:
- `Router`: URLに応じて表示するコンポーネントを切り替え
- `Routes` + `Route`: ルート定義
  - `/` → EventCreationWizard（トップページ）
  - `/events/:id` → EventEditorPage（イベント編集画面）
- `useState`: 現在のイベントIDを管理

---

### レイヤー2: ページコンポーネント

#### `src/components/EventCreationWizard.tsx`
**役割**: 新しいイベントを作成するウィザード

**主要なState**:
```typescript
const [step, setStep] = useState(1);  // 現在のステップ (1-4)
const [eventName, setEventName] = useState('');
const [eventYear, setEventYear] = useState(new Date().getFullYear());
const [performanceDates, setPerformanceDates] = useState<Date[]>([]);
const [rehearsalType, setRehearsalType] = useState<RehearsalType>('rehearsal-day');
```

**ステップの流れ**:
```
ステップ1: 基本情報入力
  ↓ (eventName, eventYear, venue, goal)
ステップ2: 開催日選択
  ↓ (performanceDates)
ステップ3: リハーサル設定
  ↓ (rehearsalType, rehearsalDates)
ステップ4: 確認・作成
  ↓
Firestore に保存 → イベントページへ遷移
```

**カレンダーUIの仕組み**:
```typescript
// 月のカレンダーを生成
const generateCalendar = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  
  // 前月の余白
  for (let i = 0; i < firstDay.getDay(); i++) {
    days.push(null);
  }
  
  // 当月の日付
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push(new Date(year, month, i));
  }
  
  return days;
};
```

#### `src/pages/EventEditorPage.tsx`
**役割**: イベント全体の編集画面（最も重要なコンポーネント）

**主要なState**:
```typescript
const [event, setEvent] = useState<Event | null>(null);
const [mode, setMode] = useState<'bands' | 'timetable-editing'>('bands');
const [timetableType, setTimetableType] = useState<'performance' | 'rehearsal'>('performance');
```

**データ読み込みのフロー**:
```typescript
useEffect(() => {
  if (!id) return;
  
  // Firestoreからイベントを取得
  const unsubscribe = onSnapshot(
    doc(db, 'events', id),
    (doc) => {
      if (doc.exists()) {
        setEvent(convertFirestoreEvent(doc.data()));
      }
    }
  );
  
  return () => unsubscribe(); // クリーンアップ
}, [id]);
```

**モード切り替え**:
```typescript
// ヘッダーのボタン
<button onClick={() => setMode('bands')}>バンド管理</button>
<button onClick={() => setMode('timetable-editing')}>タイムテーブル編集</button>

// 条件分岐で表示
{mode === 'bands' && <BandManagement event={event} onUpdate={handleUpdate} />}
{mode === 'timetable-editing' && <TimetableEditing ... />}
```

**設定メニュー**:
```typescript
// CSV出力ボタン（タイムテーブル編集モード時のみ）
{mode === 'timetable-editing' && (
  <>
    <button onClick={() => {
      if (event.performanceTimetable) {
        const csv = timetableToCSV(event.performanceTimetable, event);
        downloadCSV(csv, `${event.name}_本番タイムテーブル.csv`);
      }
    }}>
      本番タイムテーブルをCSV出力
    </button>
  </>
)}
```

---

### レイヤー3: バンド管理

#### `src/components/BandManagement.tsx`
**役割**: バンド情報の一覧管理

**カスタムフックの使用**:
```typescript
const {
  bands,
  updateBandField,
  addBand,
  deleteBand,
  allMembers
} = useBandManagement(event);
```
→ `useBandManagement`フックでバンド操作ロジックを分離

**スプレッドシート風のテーブル**:
```typescript
<table>
  <thead>
    <tr>
      <th>バンド名</th>
      <th>メンバー</th>
      <th>演奏時間</th>
      <th>出演回数</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody>
    {bands.map(band => (
      <BandRow
        key={band.id}
        band={band}
        allMembers={allMembers}
        onUpdate={updateBandField}
        onDelete={deleteBand}
      />
    ))}
  </tbody>
</table>
```

#### `src/components/BandRow.tsx`
**役割**: バンド1行の表示と編集

**メンバー自動補完**:
```typescript
// 入力中の文字列
const [memberInput, setMemberInput] = useState('');

// フィルタリングされた候補
const suggestions = allMembers.filter(m => 
  m.toLowerCase().includes(memberInput.toLowerCase()) &&
  !band.members.includes(m)
);

// 候補を表示
{suggestions.length > 0 && (
  <div className="suggestions">
    {suggestions.map(name => (
      <div onClick={() => addMember(name)}>{name}</div>
    ))}
  </div>
)}
```

**演奏時間のプリセット**:
```typescript
const presets = [10, 15, 20, 25, 30];

<select onChange={(e) => {
  const value = e.target.value;
  if (value === 'custom') {
    // カスタム入力モードに切り替え
  } else {
    onUpdate(band.id, 'performanceTime', Number(value));
  }
}}>
  {presets.map(time => (
    <option value={time}>{time}分</option>
  ))}
  <option value="custom">カスタム</option>
</select>
```

---

### レイヤー4: タイムテーブル編集

#### `src/components/TimetableEditing.tsx`
**役割**: タイムテーブル編集の全体制御とドラッグ&ドロップの管理

**ドラッグ&ドロップの仕組み（@dnd-kit）**:

```typescript
import { DndContext, DragOverlay } from '@dnd-kit/core';

// 1. DndContext でラップ
<DndContext
  sensors={sensors}
  collisionDetection={customCollisionDetection}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
>
  {/* ドラッグ可能な要素 */}
  <TimetableContent ... />
  <BandBankDropZone ... />
  
  {/* ドラッグ中の見た目 */}
  <DragOverlay>
    {activeId && <TimetableDragOverlay ... />}
  </DragOverlay>
</DndContext>
```

**ドラッグイベントの処理**:
```typescript
// ドラッグ開始
const handleDragStart = (event) => {
  setActiveId(event.active.id);  // ドラッグ中のIDを保存
};

// ドラッグ中（位置が変わるたび）
const handleDragOver = (event) => {
  const { active, over } = event;
  
  // ドロップ先の候補を計算
  // 例: バンドバンク → タイムテーブル
  if (over?.id.startsWith('timetable-')) {
    // 挿入位置を計算してプレビュー表示
  }
};

// ドロップ（ドラッグ終了）
const handleDragEnd = (event) => {
  const { active, over } = event;
  
  // データを実際に移動
  if (over?.id === 'band-bank') {
    removeBandFromTimetable(active.id);
  } else if (over?.id.startsWith('timetable-')) {
    addBandToTimetable(active.id, over.id);
  }
  
  setActiveId(null);
};
```

**カスタムフックの活用**:
```typescript
// ドラッグ&ドロップのロジック
const { handleDragStart, handleDragOver, handleDragEnd } = 
  useTimetableDragDrop(currentTimetable, setCurrentTimetable);

// 制約チェック
const violations = useConstraintCheck(currentTimetable, event);

// ヘルパー関数
const { getBandInfo, getCustomEventInfo } = 
  useTimetableHelpers(event);
```

#### `src/components/TimetableContextBar.tsx`
**役割**: 日付選択とクール数の設定

```typescript
// 日付選択
<select value={currentDate} onChange={e => setCurrentDate(e.target.value)}>
  {availableDates.map(date => (
    <option value={date}>{formatDate(date)}</option>
  ))}
</select>

// クール数の設定
<input
  type="number"
  value={coolCount}
  onChange={e => updateCoolCount(date, Number(e.target.value))}
  min={1}
  max={10}
/>
```

**クール数変更時の処理**:
```typescript
const updateCoolCount = (date: string, newCount: number) => {
  const dayIndex = timetable.days.findIndex(d => d.date === date);
  const currentDay = timetable.days[dayIndex];
  
  if (newCount > currentDay.cools.length) {
    // クールを追加
    const newCools = [...currentDay.cools];
    for (let i = currentDay.cools.length; i < newCount; i++) {
      newCools.push({
        id: generateId(),
        name: `${i + 1}stクール`,
        entries: []
      });
    }
    updateDay(date, { cools: newCools });
  } else {
    // クールを削除（エントリーはバンドバンクへ戻す）
    const keptCools = currentDay.cools.slice(0, newCount);
    const removedEntries = currentDay.cools
      .slice(newCount)
      .flatMap(cool => cool.entries);
    
    // 削除されたバンドをバンドバンクに追加
    returnBandsToBank(removedEntries);
    updateDay(date, { cools: keptCools });
  }
};
```

#### `src/components/TimetableContent.tsx`
**役割**: タイムテーブルの日付とクール一覧を表示

```typescript
function TimetableContent({ 
  currentDay, 
  timetableType, 
  rehearsalType,
  ...
}) {
  return (
    <div>
      {/* 日付ヘッダー */}
      <h2>{formatDate(currentDay.date)}</h2>
      
      {/* 各クール */}
      {currentDay.cools.map((cool, index) => (
        <CoolSection
          key={cool.id}
          cool={cool}
          coolIndex={index}
          totalCools={currentDay.cools.length}
          rehearsalType={rehearsalType}  // ← 重要！
          {...otherProps}
        />
      ))}
      
      {/* クール外のドロップゾーン */}
      <TimetableDropZone ... />
    </div>
  );
}
```

**Props の流れ**:
```
EventEditorPage (eventSettings.rehearsalType)
  ↓
TimetableEditing (rehearsalType)
  ↓
TimetableContent (rehearsalType)
  ↓
CoolSection (rehearsalType) ← ここで使用！
```

#### `src/components/CoolSection.tsx`
**役割**: 1つのクールの表示

**クールヘッダーの表示制御**:
```typescript
function CoolSection({ 
  cool, 
  totalCools, 
  rehearsalType,
  isReadOnly 
}) {
  // 表示条件:
  // 1. 別日リハーサルイベントの場合は常に表示
  // 2. それ以外は、複数クールがある日のみ表示
  const shouldShowCoolHeader = 
    rehearsalType === 'rehearsal-day' || 
    (totalCools > 1 && !isReadOnly);
  
  return (
    <div className="cool-section">
      {shouldShowCoolHeader && (
        <div className="cool-header">
          <input
            value={cool.name}
            onChange={e => onUpdateCoolName(cool.id, e.target.value)}
            placeholder={`${coolIndex + 1}stクール`}
          />
        </div>
      )}
      
      {/* エントリー一覧 */}
      <SortableContext items={cool.entries.map(e => e.id)}>
        {cool.entries.map(entry => (
          <SortableTimetableRow
            key={entry.id}
            entry={entry}
            {...otherProps}
          />
        ))}
      </SortableContext>
      
      {/* クール間のドロップゾーン */}
      <CoolGapDropZone coolId={cool.id} />
    </div>
  );
}
```

**ロジック解説**:
- `rehearsalType === 'rehearsal-day'`: 別日リハーサルイベントは、リハーサル・本番ともに全クール名を表示
- `totalCools > 1 && !isReadOnly`: 通常イベントは複数クールがある日のみ表示
- これにより、ユーザーは状況に応じて適切なヘッダーを見ることができる

#### `src/components/SortableTimetableRow.tsx`
**役割**: ドラッグ可能なタイムテーブルの1行

```typescript
function SortableTimetableRow({ entry, ... }) {
  // @dnd-kit のフック
  const { attributes, listeners, setNodeRef, transform, transition } = 
    useSortable({ id: entry.id });
  
  // ドラッグ時のスタイル
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}  // ドラッグイベントをリスン
      className="timetable-row"
    >
      {/* 開始時刻 */}
      <input
        type="time"
        value={entry.startTime}
        onChange={e => onUpdateTime(entry.id, 'start', e.target.value)}
      />
      
      {/* バンド名 / イベント名 */}
      <span>{getEntryName(entry)}</span>
      
      {/* 演奏時間 */}
      <span>{entry.endTime - entry.startTime}分</span>
      
      {/* 終了時刻 */}
      <input
        type="time"
        value={entry.endTime}
        onChange={e => onUpdateTime(entry.id, 'end', e.target.value)}
      />
      
      {/* 削除ボタン */}
      <button onClick={() => onRemove(entry.id)}>×</button>
    </div>
  );
}
```

**時刻の自動計算**:
```typescript
// 開始時刻を変更したら、終了時刻も自動調整
const handleStartTimeChange = (entryId, newStart) => {
  const entry = findEntry(entryId);
  const duration = entry.performanceTime; // 演奏時間
  const newEnd = addMinutes(newStart, duration);
  
  updateEntry(entryId, {
    startTime: newStart,
    endTime: newEnd
  });
  
  // 後続のエントリーも調整
  adjustFollowingEntries(entryId);
};
```

---

### レイヤー5: サポートコンポーネント

#### `src/components/BandBankDropZone.tsx`
**役割**: 未配置のバンドを保管する「バンドバンク」

```typescript
function BandBankDropZone({ availableBands }) {
  const { setNodeRef } = useDroppable({ id: 'band-bank' });
  
  return (
    <div ref={setNodeRef} className="band-bank">
      <h3>バンドバンク</h3>
      {availableBands.map(band => (
        <BandBankItem key={band.id} band={band} />
      ))}
    </div>
  );
}
```

**利用可能なバンドの計算**:
```typescript
const availableBands = useMemo(() => {
  // タイムテーブルに配置済みのバンドIDを集める
  const placedBandIds = new Set();
  currentTimetable.days.forEach(day => {
    day.cools.forEach(cool => {
      cool.entries.forEach(entry => {
        if (entry.type === 'band' && entry.bandId) {
          placedBandIds.add(entry.bandId);
        }
      });
    });
  });
  
  // 全バンドから配置済みを除外
  return event.bands.filter(band => !placedBandIds.has(band.id));
}, [currentTimetable, event.bands]);
```

#### `src/components/ViolationPanel.tsx`
**役割**: 制約違反の一覧表示

```typescript
function ViolationPanel({ violations }) {
  if (violations.length === 0) {
    return <div className="success">✓ 制約違反はありません</div>;
  }
  
  return (
    <div className="violations">
      <h3>⚠️ 制約違反 ({violations.length}件)</h3>
      {violations.map((v, i) => (
        <div key={i} className="violation-item">
          <span className="severity">{v.severity}</span>
          <span className="message">{v.message}</span>
          {v.affectedBands && (
            <span className="bands">
              関連バンド: {v.affectedBands.join(', ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

**制約チェックの種類**:
1. **時間重複**: 同じ時間帯に複数のバンドが配置されている
2. **出演可能時間外**: バンドが指定した時間帯外に配置されている
3. **出演回数不足/超過**: 設定した出演回数と実際の配置回数が異なる
4. **メンバー重複**: 同じメンバーが同時刻に複数のバンドで出演

#### `src/components/BandAvailabilityModal.tsx`
**役割**: バンドの出演可能時間を設定するモーダル

```typescript
function BandAvailabilityModal({ band, onSave, onClose }) {
  const [slots, setSlots] = useState(band.availableSlots);
  
  const addSlot = () => {
    setSlots([...slots, {
      date: '',
      start: '',
      end: ''
    }]);
  };
  
  const updateSlot = (index, field, value) => {
    const newSlots = [...slots];
    newSlots[index][field] = value;
    setSlots(newSlots);
  };
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>{band.name} の出演可能時間</h2>
        
        {slots.map((slot, index) => (
          <div key={index} className="time-slot">
            <select
              value={slot.date}
              onChange={e => updateSlot(index, 'date', e.target.value)}
            >
              {availableDates.map(date => (
                <option value={date}>{formatDate(date)}</option>
              ))}
            </select>
            
            <input
              type="time"
              value={slot.start}
              onChange={e => updateSlot(index, 'start', e.target.value)}
            />
            <span>〜</span>
            <input
              type="time"
              value={slot.end}
              onChange={e => updateSlot(index, 'end', e.target.value)}
            />
            
            <button onClick={() => removeSlot(index)}>削除</button>
          </div>
        ))}
        
        <button onClick={addSlot}>+ 時間帯を追加</button>
        <button onClick={() => onSave(slots)}>保存</button>
      </div>
    </div>
  );
}
```

---

## ユーティリティとサービス

### `src/services/firestore.ts`
**役割**: Firestoreとのデータ通信を一元管理

```typescript
import { db } from '../firebase';
import { 
  doc, getDoc, setDoc, updateDoc, onSnapshot 
} from 'firebase/firestore';

// イベントの保存
export async function saveEvent(event: Event): Promise<void> {
  const eventRef = doc(db, 'events', event.id);
  await setDoc(eventRef, convertEventForFirestore(event));
}

// イベントの読み込み
export async function loadEvent(eventId: string): Promise<Event | null> {
  const eventRef = doc(db, 'events', eventId);
  const docSnap = await getDoc(eventRef);
  
  if (docSnap.exists()) {
    return convertFirestoreEvent(docSnap.data());
  }
  return null;
}

// リアルタイム監視
export function subscribeToEvent(
  eventId: string, 
  callback: (event: Event) => void
): () => void {
  const eventRef = doc(db, 'events', eventId);
  
  return onSnapshot(eventRef, (doc) => {
    if (doc.exists()) {
      callback(convertFirestoreEvent(doc.data()));
    }
  });
}
```

**型変換の必要性**:
Firestoreは`Date`オブジェクトを`Timestamp`として保存するため、変換が必要です。

```typescript
// TypeScript の Event → Firestore用データ
function convertEventForFirestore(event: Event) {
  return {
    ...event,
    createdAt: Timestamp.fromDate(event.createdAt),
    updatedAt: Timestamp.fromDate(event.updatedAt)
  };
}

// Firestore用データ → TypeScript の Event
function convertFirestoreEvent(data: any): Event {
  return {
    ...data,
    createdAt: data.createdAt.toDate(),
    updatedAt: data.updatedAt.toDate()
  };
}
```

### `src/utils/timetableExport.ts`
**役割**: タイムテーブルをCSV形式で出力

```typescript
export function timetableToCSV(
  timetable: Timetable, 
  event: Event
): string {
  const rows: string[][] = [];
  
  // ヘッダー行
  rows.push(['日付', 'クール', '開始時刻', '終了時刻', 'バンド名', '演奏時間']);
  
  // データ行
  timetable.days.forEach(day => {
    day.cools.forEach(cool => {
      cool.entries.forEach(entry => {
        const band = event.bands.find(b => b.id === entry.bandId);
        const duration = calculateDuration(entry.startTime, entry.endTime);
        
        rows.push([
          formatDate(day.date),
          cool.name,
          entry.startTime,
          entry.endTime,
          band?.name || '',
          duration.toString()
        ]);
      });
    });
  });
  
  // CSV文字列に変換
  return rows.map(row => 
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  // BOM（Byte Order Mark）を追加してUTF-8を明示
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  
  // ダウンロードリンクを作成してクリック
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  
  // メモリ解放
  URL.revokeObjectURL(link.href);
}
```

**BOMの重要性**:
```
BOMなし: Excelで開くと文字化け
└─ あ,い,う → ??,??,??

BOM付き: Excelが自動的にUTF-8として認識
└─ あ,い,う → あ,い,う （正しく表示）
```

### `src/utils/calculateBandNumbers.ts`
**役割**: バンドの出演順番号を計算

```typescript
export function calculateBandNumbers(timetable: Timetable): Map<string, number[]> {
  const bandNumbers = new Map<string, number[]>();
  let globalCounter = 1;
  
  // 時系列順にソート
  const sortedEntries = getAllEntriesSorted(timetable);
  
  sortedEntries.forEach(entry => {
    if (entry.type === 'band' && entry.bandId) {
      if (!bandNumbers.has(entry.bandId)) {
        bandNumbers.set(entry.bandId, []);
      }
      bandNumbers.get(entry.bandId)!.push(globalCounter);
      globalCounter++;
    }
  });
  
  return bandNumbers;
}

// 使用例
const numbers = calculateBandNumbers(timetable);
numbers.get('band-1'); // [1, 5, 9] （1番目、5番目、9番目に出演）
```

### `src/utils/timetableCollisionDetection.ts`
**役割**: ドラッグ&ドロップ時の衝突判定をカスタマイズ

```typescript
export function customCollisionDetection(args: any) {
  // 1. まず標準の矩形衝突判定を実行
  const rectCollisions = rectIntersection(args);
  
  if (rectCollisions.length > 0) {
    return rectCollisions;
  }
  
  // 2. 矩形で検出できなければ、中心点での判定
  const centerCollisions = closestCenter(args);
  
  return centerCollisions;
}
```

**なぜカスタムが必要か？**
- デフォルトの判定だと、細いドロップゾーンを検出しにくい
- タイムテーブルの行間の隙間にドロップできるようにしたい
- より直感的なドラッグ体験を提供

---

## 状態管理とフック

### `src/hooks/useBandManagement.ts`
**役割**: バンド管理のロジックをカプセル化

```typescript
export function useBandManagement(event: Event) {
  const [bands, setBands] = useState(event.bands);
  
  // 全メンバーのユニークリスト
  const allMembers = useMemo(() => {
    const members = new Set<string>();
    bands.forEach(band => {
      band.members.forEach(member => members.add(member));
    });
    return Array.from(members).sort();
  }, [bands]);
  
  // バンド情報の更新
  const updateBandField = useCallback((
    bandId: string, 
    field: keyof Band, 
    value: any
  ) => {
    setBands(prev => prev.map(band => 
      band.id === bandId ? { ...band, [field]: value } : band
    ));
  }, []);
  
  // バンドの追加
  const addBand = useCallback(() => {
    const newBand: Band = {
      id: generateId(),
      name: '',
      members: [],
      performanceTime: 20,
      performanceCount: 1,
      availableSlots: []
    };
    setBands(prev => [...prev, newBand]);
  }, []);
  
  // バンドの削除
  const deleteBand = useCallback((bandId: string) => {
    setBands(prev => prev.filter(band => band.id !== bandId));
  }, []);
  
  return {
    bands,
    allMembers,
    updateBandField,
    addBand,
    deleteBand
  };
}
```

**フックのメリット**:
1. **再利用性**: 他のコンポーネントでも同じロジックを使える
2. **テスト容易性**: ロジックだけを独立してテスト可能
3. **可読性**: コンポーネントがシンプルになる

### `src/hooks/useConstraintCheck.ts`
**役割**: タイムテーブルの制約違反をチェック

```typescript
export function useConstraintCheck(
  timetable: Timetable, 
  event: Event
): Violation[] {
  return useMemo(() => {
    const violations: Violation[] = [];
    
    // 1. 時間重複チェック
    violations.push(...checkTimeOverlap(timetable));
    
    // 2. 出演可能時間チェック
    violations.push(...checkAvailability(timetable, event));
    
    // 3. 出演回数チェック
    violations.push(...checkPerformanceCount(timetable, event));
    
    // 4. メンバー重複チェック
    violations.push(...checkMemberConflict(timetable, event));
    
    return violations;
  }, [timetable, event]);
}

// 時間重複チェックの実装例
function checkTimeOverlap(timetable: Timetable): Violation[] {
  const violations: Violation[] = [];
  
  timetable.days.forEach(day => {
    day.cools.forEach(cool => {
      for (let i = 0; i < cool.entries.length - 1; i++) {
        const current = cool.entries[i];
        const next = cool.entries[i + 1];
        
        if (current.endTime > next.startTime) {
          violations.push({
            severity: 'error',
            message: `時間が重複しています: ${current.endTime} > ${next.startTime}`,
            affectedEntries: [current.id, next.id]
          });
        }
      }
    });
  });
  
  return violations;
}
```

### `src/hooks/useTimetableDragDrop.ts`
**役割**: タイムテーブルのドラッグ&ドロップ処理

```typescript
export function useTimetableDragDrop(
  timetable: Timetable,
  setTimetable: (t: Timetable) => void
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);
  
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setActiveId(null);
      return;
    }
    
    // ドロップ先に応じた処理
    if (over.id === 'band-bank') {
      // バンドバンクに戻す
      removeFromTimetable(active.id as string);
    } else if (over.id.toString().startsWith('cool-')) {
      // クールに追加
      const coolId = over.id.toString();
      addToTimetable(active.id as string, coolId);
    } else {
      // 並び替え
      reorderInTimetable(active.id as string, over.id as string);
    }
    
    setActiveId(null);
  }, [timetable]);
  
  return {
    activeId,
    handleDragStart,
    handleDragEnd
  };
}
```

### `src/hooks/useTimetableHelpers.ts`
**役割**: タイムテーブル関連のヘルパー関数

```typescript
export function useTimetableHelpers(event: Event) {
  // バンド情報を取得
  const getBandInfo = useCallback((bandId: string) => {
    return event.bands.find(b => b.id === bandId);
  }, [event.bands]);
  
  // カスタムイベント情報を取得
  const getCustomEventInfo = useCallback((eventId: string) => {
    return event.customEvents.find(e => e.id === eventId);
  }, [event.customEvents]);
  
  // エントリーの表示名を取得
  const getEntryName = useCallback((entry: TimetableEntry) => {
    if (entry.type === 'band') {
      const band = getBandInfo(entry.bandId!);
      return band?.name || '不明なバンド';
    } else if (entry.type === 'custom-event') {
      const customEvent = getCustomEventInfo(entry.customEventId!);
      return customEvent?.name || '不明なイベント';
    } else {
      return 'クール間';
    }
  }, [getBandInfo, getCustomEventInfo]);
  
  // 演奏時間を計算
  const calculateDuration = useCallback((start: string, end: string) => {
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    return endMinutes - startMinutes;
  }, []);
  
  return {
    getBandInfo,
    getCustomEventInfo,
    getEntryName,
    calculateDuration
  };
}

// ヘルパー関数
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
```

---

## まとめ

### アプリケーションの全体フロー

```
1. ユーザーがアクセス
   ↓
2. main.tsx → App.tsx でルーティング
   ↓
3-a. トップページ (/)
   └→ EventCreationWizard でイベント作成
      └→ Firestore に保存
         └→ /events/:id へリダイレクト

3-b. イベントページ (/events/:id)
   └→ EventEditorPage でイベント読み込み
      ├→ バンド管理モード
      │  └→ BandManagement → BandRow (編集)
      └→ タイムテーブル編集モード
         └→ TimetableEditing
            ├→ TimetableContextBar (日付・クール選択)
            ├→ TimetableContent → CoolSection → SortableTimetableRow
            ├→ BandBankDropZone (未配置バンド)
            └→ ViolationPanel (制約違反チェック)
```

### 重要な設計パターン

**1. コンポーネント分割**
- 各コンポーネントは単一責任
- 再利用可能な小さな部品に分ける

**2. Props による状態の伝達**
- データは親から子へ一方向に流れる
- 子から親への通信はコールバック関数

**3. カスタムフックによるロジック分離**
- UIとロジックを分離
- テストしやすく、再利用しやすい

**4. TypeScript による型安全性**
- インターフェースで構造を明確化
- エラーを事前に検出

**5. Firestore によるリアルタイム同期**
- サーバーとの通信を意識しない
- データが変わったら自動的に画面更新

### 今後の学習のために

**React を深く学ぶ**:
- 公式ドキュメント: https://react.dev/
- useEffect のクリーンアップ
- useMemo と useCallback の最適化
- Context API（グローバル状態管理）

**TypeScript を深く学ぶ**:
- ジェネリクス型
- ユーティリティ型（Partial, Omit, Pick など）
- 型ガード

**Firestore を深く学ぶ**:
- クエリの最適化
- セキュリティルール
- インデックス

この解説書が、コードの理解に役立てば幸いです！
