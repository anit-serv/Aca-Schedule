# Aca-Schedule 開発進捗レポート

## 📅 更新日: 2025年10月11日

---

## ✅ 完了した機能

### v0.2 バンド管理モード (完了✅)

#### 実装内容
- **スプレッドシート形式のUI**: バンド情報を一覧で管理できる表形式のインターフェース
- **バンド情報の管理**:
  - バンド名の入力・編集
  - メンバー情報の管理（自動補完機能付き）
  - 演奏時間の設定（プリセットまたはカスタム入力）
  - 出演回数の設定
  - 利用可能時間帯の設定

#### 主要機能の詳細

**1. メンバー自動補完機能**
- 既存のメンバー名から候補を提示
- **表示件数制限**: 最大10件まで表示してスクロール可能
- **シングルクリック選択**: 1回のクリックで候補を選択
- 複数メンバーをカンマ区切りで入力可能

**2. 利用可能時間帯の選択UI**
- **30分単位のグリッド表示**: 1日を30分刻みで表示
- **ドラッグで範囲選択**: マウスドラッグで連続した時間帯を選択
- **複数範囲の選択**: 異なる時間帯を複数設定可能（例: 10:00-12:00, 14:00-16:00）
- **日付ごとの設定**: イベント各日の利用可能時間を個別に設定

**3. データの永続化**
- Firebase/Firestoreとのリアルタイム同期
- 自動保存機能
- 楽観的更新によるスムーズなUX

#### 実装ファイル
- `src/components/BandManagement.tsx` - メインコンポーネント
- `src/services/firestore.ts` - Firestore連携サービス
- `src/types.ts` - 型定義（Band, TimeRange, AvailableTimeSlot等）

---

### v0.3 基本タイムテーブル編集モード (完了✅)

#### 実装内容
- **3ペイン レイアウト**:
  1. **左ペイン**: 日付選択ナビゲーション
  2. **中央ペイン**: タイムテーブル編集エリア
  3. **右ペイン**: バンドバンク（未配置バンド一覧）

#### 主要機能の詳細

**1. ドラッグ&ドロップ機能**
- **@dnd-kit ライブラリ使用**: 最新のReact向けドラッグ&ドロップライブラリ（v4）
- **バンドバンクからタイムテーブルへの配置**:
  - バンドをドラッグしてタイムテーブルに追加
  - 特定の位置に挿入可能
  - 空のタイムテーブルへのドロップ対応
  
- **タイムテーブル内での並び替え**:
  - エントリーの順序をドラッグで変更
  - ドラッグハンドル（⋮⋮）による直感的な操作

**2. バンド配置管理**
- **出演回数のカウント**: イベント全体を通じた各バンドの配置回数を追跡
- **未配置バンドフィルタリング**: 出演回数に達していないバンドのみをバンドバンクに表示
- **配置状況の表示**: 「配置済み回数/設定出演回数」をバッジで表示（例: 1/2）

**3. 自動時刻計算**
- **開始時刻の設定**: タイムテーブルの開始時刻を設定
- **自動的な時刻計算**: バンドの演奏時間に基づいて各エントリーの開始・終了時刻を自動計算
- **リアルタイム更新**: エントリーの追加・削除・並び替え時に即座に再計算

**4. クロスデート状態管理（修正完了✅）**
- **問題**: 以前は日付ごとに状態が分離され、バンドの配置回数が正しくカウントされない
- **解決策**: 
  - `TimetableEditing`コンポーネントに全体のタイムテーブルデータ（`Timetable`型）を渡すように変更
  - `bandUsageCount`の計算を全日程の`dailyTimetables`を対象に実行
  - 日付を切り替えても、バンドバンクの表示が一貫性を保持

**5. ドロップ位置のビジュアルフィードバック（実装完了✅）**
- **ハイライト表示**: ドラッグ中、カーソルに最も近いエントリーの境界を青いラインでハイライト
- **視覚効果**: 
  - 色: `bg-blue-500`（鮮やかな青）
  - 影: `shadow-lg shadow-blue-500/50`（光るような効果）
  - 高さ: 1px（細いライン）
- **ドロップ位置の明確化**: ユーザーがどこに挿入されるか直感的に理解可能

#### 実装ファイル
- `src/components/TimetableEditing.tsx` - メインコンポーネント（DndContext設定、状態管理）
- `src/components/BandBankItem.tsx` - ドラッグ可能なバンドカード
- `src/components/SortableTimetableRow.tsx` - ソート可能なテーブル行（ハイライト表示対応）
- `src/App.tsx` - 全体の状態管理とモード切り替え

---

### v0.4 高度な構造化とリハーサル対応 (完了✅)

#### 実装内容
- **クール構造**: タイムテーブルを複数の「クール」に分割して管理
- **複数日対応**: 日付ごとにタブで切り替え可能
- **リハーサル/本番切り替え**: タイムテーブルタイプをタブで切り替え
- **クール番号の自動連番**: 日付をまたいでもクール番号が連続
- **日付ソート**: イベント設定で日付を変更した際、タイムテーブル編集画面のタブが時系列順に自動ソート
- **日付変更時のデータ引き継ぎ**: イベント設定で日付を変更しても、既存のタイムテーブルデータが新しい日付に正しく移行される

#### 主要機能の詳細

**1. クール設定機能**
- **クール数の設定**: 各日のクール数を0〜20の範囲で設定可能
- **動的なクール生成**: 
  - クール数を設定すると、その数の空のクール枠が自動生成
  - 既存のエントリーは保持される
  - クール数を0にすると、フラットなタイムテーブルに戻る
- **クール番号の自動計算**:
  - 日付順にクール番号が連番で割り当てられる
  - 例: 1日目に3クール → 2日目は4クールから開始

**2. クール構造のタイムテーブル表示**
- **クールごとの区切り**: 各クールが独立したセクションとして表示
- **クール番号の表示**: 各セクションのヘッダーに「クール N」と表示
- **クール内でのドラッグ&ドロップ**:
  - バンドを特定のクール内に配置
  - クール内でのエントリー並び替え
  - クール間でのエントリー移動

**3. 時刻の自動計算（クール対応）**
- **クール間での時刻連続**: 前のクールの終了時刻が次のクールの開始時刻に
- **クールごとの再計算**: エントリー追加・削除時、該当クール以降を再計算
- **リアルタイム更新**: すべての操作で即座に時刻を更新

**4. 複数日タブUI**
- **横スクロール可能なタブ**: 多数の日付にも対応
- **日付の視覚的表示**: M/D形式でコンパクトに表示（例: 10/15）
- **選択状態の強調**: 現在選択中の日付を青色でハイライト

**5. リハーサル/本番タブ**
- **タイムテーブルタイプの切り替え**: 「本番用」「リハ用」をタブで選択
- **独立した管理**: 本番とリハーサルで別々のタイムテーブルを作成・編集
- **将来の拡張性**: リハーサル専用機能の追加に対応可能

**6. 後方互換性**
- **フラット形式のサポート**: クール数0の場合、v0.3と同じUIで動作
- **データ構造の共存**: `DailyTimetable`に`cools`と`entries`の両方を保持
- **段階的な移行**: 既存データも問題なく動作

#### 実装ファイル
- `src/types.ts` - Cool型の追加、DailyTimetableの拡張
- `src/components/TimetableEditing.tsx` - 完全リニューアル（クール対応、タブUI）
- `src/components/CoolSection.tsx` - クールセクション表示（TimetableEditing内に含む）

#### 技術的な実装詳細

**クール番号の計算ロジック**:
```typescript
const getBaseCoolNumber = (date: string): number => {
  let coolNumber = 1;
  // 選択された日付より前の日付のクール数を合計
  for (const d of sortedDates) {
    if (d === date) break;
    const dt = timetable.dailyTimetables.find(dt => dt.date === d);
    if (dt && dt.cools) {
      coolNumber += dt.cools.length;
    }
  }
  return coolNumber;
};
```

**クール間のエントリー移動**:
- 同じクール内: `arrayMove`で並び替え
- 異なるクール間: ソースから削除してターゲットに挿入
- どちらの場合も時刻を全体的に再計算

**ドロップ可能領域のID**:
- `cool-droppable-{coolIndex}`: 各クールのドロップゾーン
- `entry-{entryId}`: 各エントリー（挿入位置として機能）
- `timetable-droppable`: フラット形式のドロップゾーン

---

### v0.5 リハーサル機能の拡張 (完了✅)

#### 実装内容
- **3種類のリハーサルパターン**: 
  1. **別日リハーサル** (`rehearsal-day`): 本番とは別の日にリハーサルを実施
  2. **クール直前リハーサル** (`cool-pre-rehearsal`): 本番当日、各クールの直前にリハーサル
  3. **当日一括リハーサル** (`day-start-rehearsal`): 本番当日の最初に全バンドのリハーサルをまとめて実施

#### 主要機能の詳細

**1. イベント作成ウィザード**
- **リハーサルタイプの選択**: 4つのオプション（なし/別日/クール直前/当日一括）
- **日付設定の自動切り替え**: 
  - 別日リハーサル: リハーサル日付の個別設定が必要
  - クール直前/当日一括: 本番日付を使用（リハーサル日付設定不要）
- **バリデーション**: 別日リハーサル選択時のリハーサル日付入力チェック

**2. バンド自動配置機能**
- **リハーサルタイプ別の配置ロジック**:
  - 別日リハーサル: すべてのバンドを自動配置
  - クール直前リハーサル: 本番タイムテーブルと自動同期（手動配置不要）
  - 当日一括リハーサル: 本番に配置されたバンドのみを自動配置
- **初期クール構造の作成**: リハーサルタイムテーブルに1つのクールを自動生成

**3. クール直前リハーサルの特別機能**
- **本番との自動同期**:
  - 本番のクール構造をリハーサルに同期
  - 本番タイムテーブル変更時に自動更新
  - バンドの重複排除（同じバンドが本番に複数回出演してもリハーサルには1回のみ）
- **読み取り専用モード**:
  - リハーサル画面でのクール削除/移動メニューを非表示
  - クール数変更を無効化
  - バンド削除ボタンを無効化
  - クール内での並び替えのみ許可

**4. バンドバンクの改善**
- **リハーサルからの削除対応**: リハーサルからバンドを削除した際、正しくバンドバンクに戻るように修正
- **配置回数カウント**: リハーサルでの配置回数を正確にカウント

#### 実装ファイル
- `src/types.ts` - rehearsalType型の拡張（3パターン対応）
- `src/components/EventCreationWizard.tsx` - リハーサルタイプ選択UI
- `src/pages/EventEditorPage.tsx` - 自動配置ロジック、クール直前リハーサル同期機能
- `src/hooks/useTimetableHelpers.ts` - バンドバンク戻り処理の修正
- `src/hooks/useCoolManagement.ts` - リハーサルタイプ別のクール番号計算
- `src/components/TimetableEditing.tsx` - 読み取り専用モードの実装
- `src/components/CoolSection.tsx` - 読み取り専用UI対応
- `src/components/SortableTimetableRow.tsx` - 削除ボタン無効化

#### 技術的な実装詳細

**クール直前リハーサルの同期ロジック**:
```typescript
const syncCoolPreRehearsalTimetable = (performanceDailyTimetable: DailyTimetable) => {
  // 本番の各クールからバンドIDを抽出
  const rehearsalCools = performanceDailyTimetable.cools?.map((cool, index) => {
    const uniqueBandIds = new Set<string>();
    cool.entries.forEach(entry => {
      if (entry.type === 'band' && entry.bandId) {
        uniqueBandIds.add(entry.bandId);
      }
    });
    
    // リハーサル用エントリーを作成（重複なし）
    const rehearsalEntries = Array.from(uniqueBandIds).map(bandId => ({
      id: crypto.randomUUID(),
      type: 'band' as const,
      bandId,
      order: 0,
    }));
    
    return {
      id: crypto.randomUUID(),
      number: baseCoolNumber + index,
      entries: rehearsalEntries,
    };
  });
};
```

**読み取り専用モードの判定**:
```typescript
const isReadOnly = timetableType === 'rehearsal' && 
                   eventSettings.rehearsalType === 'cool-pre-rehearsal';
```

---

### F-03 カスタムイベント機能 (完了✅)

#### 実装内容
- **カスタムイベントタイプ**: 休憩、MC、その他の3種類のカスタムイベントを追加可能
- **カスタムイベント管理**: バンドバンク内でカスタムイベントを作成・削除
- **ドラッグ&ドロップ対応**: カスタムイベントをタイムテーブルに配置可能
- **視覚的な区別**: カスタムイベントは紫色の背景で表示
- **時間計算**: カスタムイベントの時間もタイムテーブルの時刻計算に反映

#### 主要機能の詳細

**1. カスタムイベント作成**
- **カスタムイベント追加ボタン**: バンドバンクの上部に配置
- **モーダルUI**: イベント名と時間（分単位）を入力
- **プリセットタイプ**: 「休憩」「MC」「その他」から選択（その他の場合は名前を入力）
- **削除機能**: 各カスタムイベントに削除ボタンを配置

**2. タイムテーブルへの配置**
- **ドラッグ対応**: カスタムイベントをバンドと同様にドラッグ可能
- **ID管理**: `custom-{eventId}`形式のIDで識別
- **クール対応**: クール構造のタイムテーブルにも配置可能
- **フラット対応**: クール分けしていないタイムテーブルにも配置可能

**3. 表示の工夫**
- **背景色**: `bg-purple-700/50`（半透明の紫）で視覚的に区別
- **文字色**: `text-purple-300`でイベント名を表示
- **時間表示**: カスタムイベントの所要時間も正確に計算・表示

**4. データ永続化**
- **EventSettings拡張**: `customEvents?: CustomEvent[]`フィールドを追加
- **Firestore対応**: customEventsの保存・読み込み機能を実装
- **デフォルト値**: customEventsが存在しない場合は空配列

#### 実装ファイル
- `src/types.ts` - CustomEvent型の追加、TimetableEntryの拡張
- `src/components/CustomEventBankItem.tsx` - カスタムイベントのドラッグ可能アイテム
- `src/components/BandBankDropZone.tsx` - カスタムイベント追加ボタンとモーダル
- `src/components/SortableTimetableRow.tsx` - カスタムイベント表示対応
- `src/hooks/useTimetableDragDrop.ts` - カスタムイベントのドラッグ&ドロップ処理
- `src/services/firestore.ts` - customEventsのFirestore連携

#### 技術的な実装詳細

**カスタムイベントのドラッグ処理**:
```typescript
if (activeId.startsWith('custom-')) {
  const customEventId = activeId.replace('custom-', '');
  const customEvent = customEvents.find(e => e.id === customEventId);
  
  if (currentTimetable.cools && currentTimetable.cools.length > 0) {
    handleCustomEventDropToCool(customEventId, overId);
  } else {
    handleCustomEventDropToFlat(customEventId, overId);
  }
}
```

**TimetableEntryの拡張**:
```typescript
export interface TimetableEntry {
  id: string;
  type: EntryType; // 'band' | 'custom'
  bandId?: string;
  customEvent?: CustomEvent;
  startTime?: string;
  endTime?: string;
  order: number;
  transitionTime?: number;
}
```

---

### イベント設定モーダル (完了✅)

#### 実装内容
- **イベント情報の表示・編集**: すべてのイベント設定を一元管理
- **編集可能フィールド**: イベント名、会場、目標、開催日、リハーサル日、リハーサル時間、プリセット時間
- **読み取り専用フィールド**: リハーサル形式（変更不可）
- **日付編集**: 日付の個別編集が可能（追加・削除は不可）
- **プリセット管理**: プリセット時間の追加・削除が可能

#### 主要機能の詳細

**1. モーダルアクセス**
- **設定アイコン**: ヘッダーの右上に⚙️アイコンを配置
- **メニュー表示**: クリックでドロップダウンメニューを表示
- **イベント設定オプション**: メニュー内の「イベント設定」を選択してモーダルを開く

**2. 編集可能な情報**
- **イベント名**: テキスト入力
- **開催年**: 数値入力
- **会場**: テキスト入力
- **目標**: テキストエリア（複数行）
- **本番開催日**: 各日付を個別に編集可能（type="date"入力）
- **リハーサル日**: 各日付を個別に編集可能（別日リハーサルの場合のみ）
- **リハーサル時間**: 数値入力（分単位）
- **プリセット時間**: 複数の時間を追加・削除可能

**3. 読み取り専用情報**
- **リハーサル形式**: グレー背景で表示、編集不可（disabled）
- **視覚的な区別**: 背景色を`bg-gray-900`に設定

**4. バリデーションと保存**
- **必須フィールド**: イベント名、開催年、会場は必須
- **保存処理**: 変更内容をFirestoreに保存
- **キャンセル**: 変更を破棄してモーダルを閉じる

#### 実装ファイル
- `src/components/EventSettingsModal.tsx` - イベント設定モーダル
- `src/pages/EventEditorPage.tsx` - モーダル表示制御、保存処理
- `src/services/firestore.ts` - イベント設定の保存・更新

---

### 日付変更時のタイムテーブル同期 (完了✅)

#### 実装内容
- **タイムテーブルデータの引き継ぎ**: 日付を変更しても既存のタイムテーブルが保持される
- **日付マッピング**: 古い日付と新しい日付の対応関係を自動計算
- **本番・リハーサル両対応**: 両方のタイムテーブルを同期

#### 主要機能の詳細

**1. 同期処理（`syncTimetableWithDates`関数）**
```typescript
const syncTimetableWithDates = async (
  timetable: Timetable | null,
  oldDates: string[],
  newDates: string[]
) => {
  // 日付のマッピングを作成
  const dateMapping = new Map<string, string>();
  oldDates.forEach((oldDate, index) => {
    if (newDates[index]) {
      dateMapping.set(oldDate, newDates[index]);
    }
  });
  
  // 既存のタイムテーブルを新しい日付に移行
  // 新しく追加された日付には空のタイムテーブルを作成
  // Firestoreに保存
};
```

**2. 動作例**
- 旧: `["2025-10-20", "2025-10-21"]`
- 新: `["2025-10-25", "2025-10-26"]`
- 結果: 
  - 10/20のタイムテーブル → 10/25に移行（バンド配置保持）
  - 10/21のタイムテーブル → 10/26に移行（バンド配置保持）

**3. イベント設定保存時の自動実行**
- イベント設定モーダルで保存ボタンを押すと自動的に同期
- 本番とリハーサル両方のタイムテーブルを処理
- リハーサルタイプに応じて適切な日付配列を使用

---

### クール直前リハーサルの自動同期 (完了✅)

#### 実装内容
- **本番タイムテーブル監視**: 本番タイムテーブルの変更を自動検知
- **リハーサル自動同期**: 本番の変更をリハーサルタイムテーブルに即座に反映
- **バンド自動配置**: その日に出演するバンドが同日のリハーサルに自動的に配置される

#### 主要機能の詳細

**1. 自動同期useEffect**
```typescript
useEffect(() => {
  if (eventSettings.rehearsalType !== 'cool-pre-rehearsal') return;
  
  const syncAllDates = async () => {
    for (const performanceDailyTimetable of performanceTimetable.dailyTimetables) {
      await syncCoolPreRehearsalTimetableInternal(performanceDailyTimetable);
    }
  };
  
  syncAllDates();
}, [performanceTimetable?.dailyTimetables, eventSettings?.rehearsalType]);
```

**2. 同期処理**
- 本番の各クールからバンドIDを抽出
- リハーサルタイムテーブルに同じクール構造を作成
- 各クールに対応するバンドを配置
- Firestoreに自動保存

**3. 動作フロー**
1. 本番タイムテーブルにバンドを追加
2. `performanceTimetable.dailyTimetables`が変更される
3. useEffectが発火
4. 該当日付のリハーサルタイムテーブルを自動更新
5. リハーサル画面に即座に反映

---

### バンド削除時のタイムテーブルクリーンアップ (完了✅)

#### 実装内容
- **削除バンドの自動除去**: バンドを削除すると、タイムテーブルからも自動的に削除される
- **本番・リハーサル両方対応**: 両方のタイムテーブルをクリーンアップ
- **Firestore自動更新**: 削除後のタイムテーブルをFirestoreに保存

#### 主要機能の詳細

**1. バンド削除監視**
```typescript
useEffect(() => {
  const cleanupDeletedBands = async () => {
    const bandIds = new Set(bands.map(b => b.id));
    
    // 存在しないバンドIDのエントリーをフィルタリング
    // 本番・リハーサルタイムテーブルから除去
    // Firestoreに更新を保存
  };
  
  cleanupDeletedBands();
}, [bands.length]);
```

**2. クリーンアップ処理**
- バンド数が変更されたことを検知
- 現在のバンドIDセットを作成
- タイムテーブルの全エントリーをチェック
- 存在しないバンドIDを持つエントリーを除去
- 更新されたタイムテーブルをFirestoreに保存

**3. 動作フロー**
1. バンド管理画面でバンドを削除
2. Firestoreから削除
3. リアルタイムリスナーが`bands`配列を更新
4. `bands.length`が変わる
5. クリーンアップuseEffectが実行
6. タイムテーブルから削除されたバンドのエントリーを除去
7. 「(不明)」表示が消える

---

### クール開始時刻設定機能 (完了✅)

#### 実装内容
- **クール別開始時刻設定**: 各クールに固定の開始時刻を設定可能
- **開始時刻の検証**: 本番/リハーサル開始時刻より前には設定できない
- **開始時刻の削除**: 設定した開始時刻をクリアして前のクールから継続可能
- **時刻超過警告**: 次のクール開始時刻を超過した場合に視覚的に警告

#### 主要機能の詳細

**1. クール開始時刻の設定**
- **入力UI**: クールヘッダーに時刻入力フィールドを配置
- **HH:mm形式**: 24時間形式での時刻入力
- **未設定時の動作**: 前のクールの最後のバンドの終了時刻から自動的に継続
- **最小値制限**: その日の開始時刻より前の時刻は設定不可

**2. 開始時刻の削除機能**
- **クリアボタン**: 開始時刻が設定されている場合、「✕」ボタンを表示
- **ワンクリック削除**: ボタンをクリックで開始時刻をクリア
- **状態表示**: 削除後は「(前のクールから継続)」と表示

**3. 検証機能**
- **JavaScript検証**: `handleStartTimeBlur`で時刻を分単位に変換して比較
- **ユーザーフィードバック**: 無効な値の場合、アラートを表示して元の値に戻す
- **HTML5検証**: `min`属性でブラウザレベルの検証も実装

**4. 時刻超過警告**
- **自動判定**: クールの最後のエントリーの終了時刻が次のクールの開始時刻を超過した場合
- **視覚的警告**: 
  - 赤い枠線（`ring-2 ring-red-500`）
  - 警告メッセージ「⚠️ 次のクール開始時刻を超過」
- **リアルタイム**: エントリー追加・削除時に即座に再判定

**5. 時刻計算ロジックの改善**
- **クール開始時刻優先**: `cool.startTime`が設定されている場合はそれを使用
- **未設定時は継続**: 前のエントリーの終了時刻から自動的に継続
- **Firestore互換性**: `startTime`が`undefined`の場合、プロパティ自体を削除

**6. クール移動時の挙動**
- **バンドのみ入れ替え**: クールを上下に移動する際、バンド配列（entries）のみを入れ替え
- **番号と時刻は保持**: クール番号と開始時刻（startTime）は元の位置に残る
- **意図しない変更を防止**: 各クールの開始時刻設定が意図せず変更されることを防ぐ

#### 実装ファイル
- `src/types.ts` - Cool型にstartTime?: stringを追加
- `src/components/CoolSection.tsx` - 開始時刻入力UI、削除ボタン、警告表示
- `src/components/TimetableEditing.tsx` - handleCoolStartTimeChange、dailyStartTimeの伝播
- `src/hooks/useTimetableHelpers.ts` - recalculateTimes関数の追加
- `src/hooks/useCoolManagement.ts` - クール移動時のバンドのみ入れ替えロジック

#### 技術的な実装詳細

**開始時刻の削除処理**:
```typescript
const handleCoolStartTimeChange = (coolIndex: number, startTime: string | undefined) => {
  const updatedCools = currentTimetable.cools.map((cool, index) => {
    if (index === coolIndex) {
      if (startTime === undefined) {
        // プロパティ自体を削除（Firestore互換性のため）
        const { startTime: _, ...coolWithoutStartTime } = cool;
        return coolWithoutStartTime;
      }
      return { ...cool, startTime };
    }
    return cool;
  });
};
```

**時刻計算ロジック**:
```typescript
const recalculateTimes = useCallback((cools: Cool[], dailyStartTime: string): Cool[] => {
  let currentTime = dailyStartTime;
  
  return cools.map((cool) => {
    // クール開始時刻が設定されている場合はそれを使用
    if (cool.startTime) {
      currentTime = cool.startTime;
    }
    // 未設定の場合は前のエントリーから継続
    
    const updatedEntries = calculateTimes(cool.entries, currentTime);
    // 最後のエントリーの終了時刻を次のクールに引き継ぎ
    if (updatedEntries.length > 0) {
      currentTime = updatedEntries[updatedEntries.length - 1].endTime || currentTime;
    }
    
    return { ...cool, entries: updatedEntries };
  });
}, [calculateTimes]);
```

**クール移動時のバンドのみ入れ替え**:
```typescript
const handleMoveCoolUp = useCallback((coolIndex: number) => {
  const updatedCools = [...currentTimetable.cools];
  
  // バンド配列(entries)のみを入れ替え
  const tempEntries = updatedCools[coolIndex - 1].entries;
  updatedCools[coolIndex - 1] = {
    ...updatedCools[coolIndex - 1],
    entries: updatedCools[coolIndex].entries,
  };
  updatedCools[coolIndex] = {
    ...updatedCools[coolIndex],
    entries: tempEntries,
  };
  // クール番号とstartTimeはそのまま保持
}, [currentTimetable, recalculateCoolTimes, onTimetableChange]);
```

---

## 🐛 既知の問題

### 1. バンド情報の更新がタイムテーブルに反映されない（解決済み✅）

**問題の詳細**:
- バンド管理画面でバンド情報（名前、演奏時間、メンバー）を変更しても、タイムテーブル編集画面に反映されなかった
- バンドバンク上では正しく反映されていた
- バンドを削除・並び替え・追加などのアクションを行うと反映された

**根本原因**:
問題は2層構造になっていた：

1. **Firestoreデータの参照問題**:
   - `firestoreToBand`関数で配列やDateオブジェクトを新しいインスタンスとして作成していなかった
   - Reactの変更検知が機能しなかった

2. **タイムテーブルの時刻計算問題**（決定的な原因）:
   - タイムテーブルに配置されたバンドの表示時間は、**開始時刻と終了時刻の差分**から計算されていた
   - バンドの`performanceDuration`が変更されても、**開始・終了時刻が自動的に再計算されていなかった**
   - そのため、useMemoは正しく動作していても、実際に表示される時間は古い時刻から計算された値のままだった

**解決策**:

1. **Firestoreデータの新しいインスタンス作成**:
```typescript
const firestoreToBand = (id: string, data: DocumentData): Band => {
  return {
    id,
    name: data.name,
    performanceDuration: data.performanceDuration,
    performanceCount: data.performanceCount,
    members: Array.isArray(data.members) ? [...data.members] : [],
    availableTimeSlots: Array.isArray(data.availableTimeSlots) 
      ? data.availableTimeSlots.map((slot) => ({
          date: slot.date,
          timeRanges: slot.timeRanges.map((range) => ({
            startTime: range.startTime,
            endTime: range.endTime,
          })),
        }))
      : [],
    createdAt: new Date(data.createdAt.toDate().getTime()),
    updatedAt: new Date(data.updatedAt.toDate().getTime()),
  };
};
```

2. **バンド情報変更時の時刻自動再計算**（決定的な解決策）:
```typescript
// TimetableEditing.tsx
useEffect(() => {
  if (!currentTimetable || !bands || bands.length === 0) return;

  if (currentTimetable.cools && currentTimetable.cools.length > 0) {
    // クール構造の場合
    const updatedCools = recalculateTimes(currentTimetable.cools, currentTimetable.startTime);
    if (JSON.stringify(updatedCools) !== JSON.stringify(currentTimetable.cools)) {
      onTimetableChange({
        ...currentTimetable,
        cools: updatedCools,
      });
    }
  } else {
    // フラット構造の場合
    const updatedEntries = calculateTimes(currentTimetable.entries, currentTimetable.startTime);
    if (JSON.stringify(updatedEntries) !== JSON.stringify(currentTimetable.entries)) {
      onTimetableChange({
        ...currentTimetable,
        entries: updatedEntries,
      });
    }
  }
}, [bands]); // bandsの変更を監視
```

3. **補助的な改善**:
   - `CoolSection`と`TimetableDropZone`で`bandsSignature`を計算
   - `rowKey`に`bandsSignature`を含めることで、React keyの変更を保証
   - `SortableTimetableRow`のuseMemo依存配列に`band`オブジェクト全体を含める

**修正したファイル**:
- `src/services/firestore.ts` (lines 38-61): `firestoreToBand`関数の完全書き直し
- `src/components/TimetableEditing.tsx`: バンド変更監視useEffectを追加
- `src/components/CoolSection.tsx`: bandsSignature計算とrowKeyへの反映
- `src/components/TimetableDropZone.tsx`: 同上
- `src/components/SortableTimetableRow.tsx`: useMemo依存配列の修正

**結果**: ✅ 完全に解決！バンド情報（名前、演奏時間、メンバー）の変更が即座にタイムテーブルに反映されるようになりました。

---

### 2. クール間ドラッグ&ドロップの問題（未解決⚠️）

**問題の詳細**:
- 当日一括リハーサルおよび別日リハーサルで、クールを超えたドラッグ&ドロップ移動ができない
- クール内での並び替えは正常に動作
- クール直前リハーサルでは意図的にクール間移動を禁止（これは正常）

**試行した解決策**:
1. **`isReadOnly`フラグによる制御**:
   - `useTimetableDragDrop`に`isReadOnly`パラメータを追加
   - クール直前リハーサルの場合のみクール間移動を禁止
   - 当日一括/別日リハーサルでは`isReadOnly = false`
   - **結果**: ロジック上は正しいが、動作しない ❌

2. **SortableContextの再構成（試行中）**:
   - 問題の根本原因: 各クールが独自の`SortableContext`を持つため、DnD Kitの制約によりクール間移動ができない
   - 解決案: 全エントリーを含む単一の`SortableContext`を親レベルに配置
   - `TimetableEditing.tsx`で`allEntryIds`を計算し、クール表示全体を`SortableContext`でラップ
   - `CoolSection.tsx`から個別の`SortableContext`を削除
   - **結果**: 実装したが動作せず ❌

**考えられる原因**:
- DnD Kitの`SortableContext`の動作仕様とクール構造の相性問題
- ドロップゾーンのID管理が複雑化している可能性
- `handleEntryReorderInCools`関数のドロップ検出ロジックに問題がある可能性

**次のステップ**:
1. DnD Kitのドキュメントで複数コンテナ間のドラッグ&ドロップパターンを再確認
2. `useDraggable`/`useDroppable`の組み合わせで完全カスタム実装を検討
3. 他のドラッグ&ドロップライブラリ（react-beautiful-dnd等）への移行を検討
4. クール間移動を一時的に無効化し、代替UI（ボタンで移動）を提供

---

### 3. ドラッグ&ドロップのキャンセル機能（未解決🟡）

**問題の詳細**:
- バンドバンクからバンドをドラッグした際、タイムテーブル以外の場所にドロップしてもタイムテーブルに追加されてしまう
- 期待動作: タイムテーブル以外にドロップした場合、追加をキャンセルしてバンドバンクに戻るべき

**試行した解決策**:
1. **バンドバンク領域を`useDroppable`でラップ**:
   - `BandBankDropZone`コンポーネントを作成（`id: 'band-bank-droppable'`）
   - バンドバンクへのドロップを明示的にキャンセル処理
   - **結果**: バンドバンクへのドロップはキャンセルできた ✅

2. **タイムテーブル関連要素のみを許可するロジック**:
   ```typescript
   if (activeId.startsWith('band-')) {
     if (!over) return; // ドロップ先がない場合
     
     const overId = over.id as string;
     
     // タイムテーブル関連の要素のみを許可
     if (!overId.startsWith('entry-') && overId !== 'timetable-droppable') {
       return; // キャンセル
     }
   }
   ```
   - **結果**: 依然として一部の領域で問題が残る ❌

**考えられる原因**:
- ナビゲーションパネルや他のUI要素が`over`オブジェクトを生成している可能性
- `@dnd-kit`の衝突検出アルゴリズム（`closestCenter`）が意図しない要素を検出
- 一部のDOM要素がドロップ可能領域として認識されている

**次のステップ**:
1. デバッグ用のコンソールログを追加して`over.id`の値を確認
2. すべてのドロップ不可領域を明示的に`useDroppable`でラップし、個別にキャンセル処理を実装
3. または、衝突検出アルゴリズムを`closestCorners`や`rectIntersection`に変更して動作を確認
4. `DndContext`の`onDragOver`イベントで詳細なログを取得

---

## 🏗️ 技術スタック

### フロントエンド
- **React 18** + **TypeScript**: 型安全な開発
- **Vite**: 高速な開発サーバーとビルドツール
- **Tailwind CSS**: ユーティリティファーストのスタイリング（ダークテーマ）

### ドラッグ&ドロップ
- **@dnd-kit/core** (v4): コアライブラリ
- **@dnd-kit/sortable** (v4): ソート可能なリスト
- **@dnd-kit/utilities** (v4): ユーティリティ関数
- **センサー設定**: `PointerSensor`（8pxの移動距離で起動）
- **衝突検出**: `closestCenter`アルゴリズム

### バックエンド・データベース
- **Firebase/Firestore**: リアルタイムデータベース
- **リアルタイム同期**: `onSnapshot`によるサブスクリプション
- **楽観的更新**: ローカル状態を即座に更新してからFirestoreに保存

### 状態管理
- **React Hooks**: `useState`, `useEffect`, `useMemo`
- **グローバル状態**: `App.tsx`で管理し、propsで子コンポーネントに渡す
- **ローカル状態**: 各コンポーネント内でUI状態を管理

---

## 📁 プロジェクト構造

```
Aca-Schedule/
├── src/
│   ├── components/
│   │   ├── BandManagement.tsx          # v0.2 バンド管理UI
│   │   ├── TimetableEditing.tsx        # v0.3 タイムテーブル編集UI
│   │   ├── BandBankItem.tsx            # ドラッグ可能なバンドカード
│   │   └── SortableTimetableRow.tsx    # ソート可能なテーブル行
│   ├── services/
│   │   └── firestore.ts                # Firestore CRUD操作
│   ├── types.ts                        # TypeScript型定義
│   ├── App.tsx                         # メインアプリケーション
│   ├── main.tsx                        # エントリーポイント
│   └── firebase.ts                     # Firebase設定
├── public/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## 🎯 次のマイルストーン

### v0.6 カスタムイベント機能（未実装）
- タイムテーブルにカスタムイベント（MC、転換時間、休憩など）を追加
- カスタムイベントの編集・削除
- カスタムイベント専用のUI
- クール内への配置対応

### v0.7 タイムテーブルのエクスポート（未実装）
- PDF出力機能
- 画像エクスポート
- 印刷最適化
- クール単位でのページ区切り

### v1.0 制約チェックと公開バージョン（未実装）
- バンドの利用可能時間帯を考慮した警告
- 同一クール内での重複チェック
- 出演者の連続出演チェック
- 制約違反の視覚的表示

---

## 📝 開発メモ

### TypeScript設定の注意点
- `tsconfig.json`で`verbatimModuleSyntax: true`を使用
- インポート時に`.tsx`拡張子を明記する必要がある:
  ```typescript
  import { BandBankItem } from './BandBankItem.tsx';
  ```

### Firestore データ変換
- Firestoreの`Timestamp`型とJavaScriptの`Date`型の相互変換が必要
- `toDate()`メソッドでTimestampをDateに変換
- 保存時は`Timestamp.fromDate()`を使用

### dnd-kit のベストプラクティス
- `useDraggable`と`useSortable`の使い分け
- `useDroppable`でドロップ可能領域を明示
- `DragOverlay`で視覚的なフィードバックを提供
- `PointerSensor`に`activationConstraint`を設定してクリックとドラッグを区別

### パフォーマンス最適化
- `useMemo`で計算コストの高い処理をメモ化
- Firestoreのリアルタイム監視は`useEffect`のクリーンアップで解除
- 楽観的更新でUIの応答性を向上

---

## 🔧 環境構築

### 必要な依存関係
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install firebase
```

### 開発サーバー起動
```bash
npm run dev
```

### ビルド
```bash
npm run build
```

---

## 📞 問い合わせ・サポート

問題が発生した場合は、以下の情報を含めて報告してください：
- 問題の詳細な説明
- 再現手順
- 期待される動作と実際の動作
- ブラウザ情報
- コンソールエラー（あれば）

---

## 📊 開発統計

### コンポーネント数
- **合計**: 12コンポーネント
- **ページ**: 1 (EventEditorPage)
- **UI コンポーネント**: 11
- **カスタムフック**: 4

### 機能実装率
- ✅ 完了: 5 マイルストーン (v0.1〜v0.5)
- ⚠️ 部分完了: 0
- 🚧 進行中: 0
- 📋 未着手: 3 マイルストーン (v0.6〜v1.0)

### 既知の問題
- 🔴 Critical: 0
- 🟡 Medium: 2 (クール間D&D、D&Dキャンセル)
- 🟢 Low: 0

---

**最終更新**: 2025年10月11日
**作成者**: AI Development Assistant
