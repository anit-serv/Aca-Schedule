# Aca-Schedule 開発進捗レポート

**最終更新**: 2026年3月26日  
**作成者**: AI Development Assistant

---

## 0. 直近アップデート（2026年3月 API刷新）

### 認証フロー強化（2026-03-26）

#### 実装済み（今回）
- メール登録を仮登録/本登録の2段階フローに変更
  - `POST /api/v1/auth/register-pending`
  - `POST /api/v1/auth/register-confirm`
  - `POST /api/v1/auth/register-resend`
- 仮登録ステータス管理を追加
  - Firestore `registrationPendings` を導入
  - `pending/completed` を保存
- フロント導線を更新
  - `LoginPage` に「本登録待ち」状態と再送UIを追加
  - 確認リンク遷移後のメッセージ表示（`/login?registered=1`）
- Google連携ユーザーのパスワード必須化
  - `AuthGuard` で `needsPasswordSetup` 時に `/set-password` へ強制遷移
  - `SetPasswordPage` を追加し、password provider 連携を必須化
- ルール更新
  - `registrationPendings` のクライアント直接アクセスを禁止

#### 実装候補（次フェーズ）
- 確認リンクのメール配信基盤を接続（現在はリンク生成まで実装）
- `register-resend` のレート制限（乱発防止）
- `register-confirm` の監査ログ追加（requestId, userId, status）
- 認証フローE2E自動テストの追加
- 本登録未完了ユーザー向けの運用管理UI（保留一覧/再送）

### 実装済み（今回）
- API認証モデルを刷新
  - 旧: 外部固定キー + HMAC
  - 新: Firebase IDトークン（Bearer）またはユーザー発行APIトークン（PAT）
- Band登録APIをユーザー権限ベースへ変更
  - `POST /api/v1/bands`
  - サーバ側で event の owner / collaborator を検証
  - `x-idempotency-key` による冪等性維持
- ユーザーAPIトークン管理APIを追加
  - `POST /api/v1/user-api-tokens`（発行）
  - `GET /api/v1/user-api-tokens`（一覧）
  - `PATCH /api/v1/user-api-tokens?tokenId=...`（更新）
  - `DELETE /api/v1/user-api-tokens?tokenId=...`（失効）
- UI実装（イベント設定モーダル）
  - APIトークンの発行・一覧・更新・失効を操作可能
  - 平文トークンは発行時のみ表示
- テスト補助スクリプトを追加
  - `test-api-user.cjs`（IDトークンでPAT発行 → PATでBand作成）

### 実装候補（次フェーズ）
- EventEditorに「API連携」専用タブを追加（設定モーダル依存の軽減）
- API利用ログ（`apiRequests`）の閲覧UI追加（誰がいつ追加したか可視化）
- トークン更新時に差分のみ送信する最適化
- Firestore Rules に `userApiTokens` の方針コメントを補強

### テストフェーズ（開始）
現在は「機能追加」から「検証中心」に移行。

#### テスト実績（2026-03-26 実施）
以下は `https://aca-schedule.vercel.app` への実測結果。

- `POST /api/v1/bands`（認証なし） -> `401 MISSING_AUTH`
- `POST /api/v1/bands`（不正PAT） -> `401 INVALID_USER_API_TOKEN`
- `GET /api/v1/user-api-tokens`（認証なし） -> `401 MISSING_AUTH`
- `GET /api/v1/user-api-tokens`（Authorization形式不正） -> `401 INVALID_AUTHORIZATION`
- `GET /api/v1/bands`（メソッド不正） -> `405 METHOD_NOT_ALLOWED`
- `POST /api/v1/bands`（idempotency欠落） -> `400 MISSING_IDEMPOTENCY_KEY`
- `POST /api/v1/user-api-tokens`（Bearer + 実在eventId） -> `201`
- `POST /api/v1/bands`（初回） -> `201`
- `POST /api/v1/bands`（同一idempotency同一body） -> `200`
- `POST /api/v1/bands`（同一idempotency別body） -> `409 IDEMPOTENCY_CONFLICT`
- `POST /api/v1/bands`（PAT許可外eventId） -> `403 EVENT_NOT_ALLOWED_BY_TOKEN`
- `PATCH /api/v1/user-api-tokens?tokenId=...` -> `200`
- `DELETE /api/v1/user-api-tokens?tokenId=...` -> `200`
- 失効後の `POST /api/v1/bands` -> `401 USER_API_TOKEN_REVOKED`

#### 検証中に判明し修正した事項
- ` /api/v1/user-api-tokens/{tokenId}` の動的パスが環境によりSPAへ解決されるケースを確認。
- 対策として、更新/失効はクエリ形式 `?tokenId=...` を正式ルートとして統一。

#### まず実施する確認項目
1. 認証
   - Bearer で `POST /api/v1/bands` が 201
   - 失効/不正トークンで 401
2. 権限
   - owner/collaborator は追加可能
   - 権限なしユーザーは 403
3. PAT管理
   - 発行後、一覧に表示される
   - 更新後、名前・eventId・期限が反映される
   - 失効後、`POST /api/v1/bands` で 401
4. 冪等性
   - 同一 `x-idempotency-key` 同一Bodyで 200 再送
   - 同一キー・異なるBodyで 409
5. 回帰
   - UI手動追加、CSV追加、公開閲覧に影響なし

#### 現時点のCI相当チェック
- `npm run lint`: エラー0（既存 warning 2件のみ）
- `npm run build`: 成功

---

## 📋 プロジェクト概要

### 技術スタック

#### フロントエンド
- **React 18** + **TypeScript**: 型安全な開発
- **Vite**: 高速な開発サーバーとビルドツール
- **Tailwind CSS**: ユーティリティファーストのスタイリング（ダークテーマ）

#### ドラッグ&ドロップ
- **@dnd-kit/core** (v4): コアライブラリ
- **@dnd-kit/sortable** (v4): ソート可能なリスト
- **@dnd-kit/utilities** (v4): ユーティリティ関数
- **センサー設定**: `PointerSensor`（8pxの移動距離で起動）
- **衝突検出**: カスタム`pointerWithin`アルゴリズム（正確なポインタ位置ベースの判定）
- **DragOverlay**: ドラッグ中の視覚的フィードバック
- **独立SortableContext**: 各クールごとに独立したソート可能コンテキスト

#### バックエンド・データベース
- **Firebase/Firestore**: リアルタイムデータベース
- **Firebase Authentication**: メール/パスワード認証、Googleアカウント連携
- **リアルタイム同期**: `onSnapshot`によるサブスクリプション
- **楽観的更新**: ローカル状態を即座に更新してからFirestoreに保存

#### 状態管理
- **React Hooks**: `useState`, `useEffect`, `useMemo`
- **Context API**: `AuthContext`で認証状態をグローバル管理
- **グローバル状態**: `App.tsx`で管理し、propsで子コンポーネントに渡す
- **ローカル状態**: 各コンポーネント内でUI状態を管理

### プロジェクト構造

```
Aca-Schedule/
├── src/
│   ├── components/          # UIコンポーネント
│   ├── contexts/            # React Context
│   ├── hooks/               # カスタムフック
│   ├── pages/               # ページコンポーネント
│   ├── services/            # 外部サービス連携
│   ├── utils/               # ユーティリティ関数
│   ├── types.ts            # 型定義
│   ├── App.tsx             # メインアプリ
│   ├── main.tsx            # エントリーポイント
│   └── firebase.ts         # Firebase設定
├── public/
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

### 開発統計

#### コンポーネント数
- **合計**: 15+コンポーネント
- **ページ**: 4 (LoginPage, MyEventsPage, EventEditorPage, PublicTimetablePage)
- **カスタムフック**: 6 (useAuth, useBandManagement, useCoolManagement, useTimetableDragDrop, useTimetableHelpers, useConstraintCheck)

#### 機能実装率
- ✅ 完了: v0.1〜v0.5, v1.0, v1.1（部分）, v2.0
- 🚧 進行中: v1.1（共有機能の拡張）

#### 既知の問題
- **すべての主要な問題が解決済み！** 🎉

---

## 📅 バージョン履歴（時系列順）

詳細な実装内容は長くなるため省略し、主要なポイントのみを記載します。

### v0.1 最小構成の基盤構築 (完了✅)

- プロジェクトセットアップ（Vite + React + TypeScript）
- Firebase/Firestore連携
- イベント作成ウィザード
- UIシェル（ヘッダー、ナビゲーション）

### v0.2 バンド管理モード (完了✅)

- スプレッドシート形式のバンド管理UI
- メンバー自動補完機能
- 利用可能時間帯の選択UI（30分単位グリッド、ドラッグ選択）
- Firestoreリアルタイム同期

### v0.3 基本タイムテーブル編集モード (完了✅)

- 3ペインレイアウト（日付ナビ、タイムテーブル、バンドバンク）
- @dnd-kitによるドラッグ&ドロップ機能
- バンド配置管理（出演回数カウント、未配置フィルタリング）
- 自動時刻計算
- ドロップ位置のビジュアルフィードバック

### v0.4 高度な構造化とリハーサル対応 (完了✅)

- クール設定機能（0〜20クール、動的生成、連番割り当て）
- 複数日対応（タブUI、日付ソート）
- リハーサル/本番切り替え
- 3種類のリハーサルパターン：
  - 別日リハーサル
  - クール直前リハーサル（自動同期、読み取り専用）
  - 当日一括リハーサル
- クール間時刻連続、後方互換性

### v0.5 追加機能 (完了✅)

#### カスタムイベント機能
- 休憩、MC、その他のカスタムイベント作成
- タイムテーブルへのドラッグ&ドロップ配置
- 視覚的な区別（紫色）
- Firestore永続化

#### イベント設定モーダル
- 全イベント設定の一元管理
- 編集可能フィールド（名前、会場、目標、日付、プリセット時間等）
- 読み取り専用フィールド（リハーサル形式）

#### その他の改善
- 日付変更時のタイムテーブル同期
- クール直前リハーサルの自動同期
- バンド削除時のタイムテーブルクリーンアップ
- クール開始時刻設定機能（時刻検証、削除機能、超過警告）

### v1.0 制約チェックと公開バージョン (完了✅)

**実施日**: 2025年10月15日

#### リアルタイム制約チェック
- 3つの制約チェック（出演可能時間帯超過、同一クール内重複、連続出演）
- 視覚的な違反表示（重大度別の色分け、アイコン、ツールチップ）
- 制約違反サマリーパネル（スライドメニューUI）
- バンド番号システム（#列追加、違反メッセージに番号表示）

#### CSV出力機能（2025年10月16日追加）
- タイムテーブルのCSVエクスポート（本番/リハーサル）
- BOM付きUTF-8エンコーディング（Excel対応）
- 設定メニューからの出力

#### クールヘッダー表示ロジックの改善
- 別日リハーサルイベント対応
- `rehearsalType`プロパティの伝播

### v2.0 ログイン機能とユーザー管理 (完了✅)

**実施日**: 2026年2月12日

#### 認証システム
- Firebase Authentication統合（メール/パスワード、Google）
- 認証コンテキスト、認証フック、認証ガード
- ログイン/新規登録ページ（タブUI、バリデーション）

#### ユーザー管理
- マイイベント一覧ページ（カード形式、ソート）
- イベント所有権管理（`ownerId`フィールド）
- Firestoreセキュリティルール（owner制限）

#### UI/UX改善
- ローディング画面、エラー表示
- ナビゲーション、アクセス権限エラーハンドリング

### v1.1 共有機能とバグ修正 (部分完了🚧)

**実施日**: 2026年2月25日

#### 共有機能 (完了✅)
- `/share/:eventId` 閲覧専用ページ
- `isPublic` フィールドによるアクセス制御
- PublicTimetablePage実装
- EventEditorPage共有パネル（公開/非公開トグル、URL表示・コピー）
- CustomFieldsTable読み取り専用モード
- Firestoreセキュリティルール（`isPublic=true`時の未認証読み取り許可）

#### バグ修正 (完了✅)
- カスタムフィールドマージセルバグ（`hasAnySequenceData()`修正）
- 共有ページのスクロール問題（`flex flex-col`レイアウト）
- カスタムフィールド未設定時の表示改善

#### 未実装機能 📋
- PDF/画像エクスポート
- 表示形式選択（シンプル/詳細）
- 共有URLの有効期限設定

---

## 🐛 バグ修正履歴

すべての主要バグが解決されました。以下は過去に発生・解決したバグのリストです。

### 1. バンド情報の更新がタイムテーブルに反映されない (解決✅)

**原因**: Firestoreデータの参照問題 + 時刻自動再計算の欠如  
**解決**: `firestoreToBand`の完全書き直し + bandsの変更監視useEffect追加

### 2. ドラッグ&ドロップのハイライト位置とドロップ位置のズレ (解決✅)

**原因**: `handleDragOver`と`handleDragEnd`で異なるID変換ロジック  
**解決**: ID変換ロジックの統一、`-after`サフィックス対応

### 3. タイムテーブル内バンドのドラッグ&ドロップの改善 (解決✅)

**原因**: 単一SortableContextによるクール間移動の不具合  
**解決**: 各クール独立のSortableContext、クール間移動を削除→追加に変更

### 4. クール間ドラッグ&ドロップ (解決✅)

**原因**: 独立SortableContextによる技術的制約  
**解決**: 削除→再配置ワークフローで対応（実用上問題なし）

### 5. ドラッグ&ドロップのキャンセル機能 (解決✅)

**原因**: 無効なドロップ先の検証不足  
**解決**: バンドバンクを`useDroppable`でラップ、厳密な検証ロジック追加

### 6. カスタムフィールドのマージセルバグ (解決✅)

**原因**: `hasAnySequenceData()`が`rowSpan`マーカーを無視  
**解決**: `cell.rowSpan !== undefined`チェックを追加

---

## 🎯 今後の予定

### v1.1 追加機能（部分実装済み）

#### 実装済み✅
- URL 共有（`/share/:eventId`）
- 読み取り専用モード

#### 未実装📋
- PDF/画像エクスポート
- 表示形式選択
- 共有URLの有効期限設定

### その他の拡張案
- テンプレート機能
- 高度な設定（カスタム項目管理）
- 通知機能

---

## 📝 技術情報と開発メモ

### TypeScript設定
- `verbatimModuleSyntax: true` → `.tsx`拡張子を明記

### Firestore データ変換
- `Timestamp` ↔ `Date` の相互変換
- `toDate()`, `Timestamp.fromDate()`

### dnd-kit ベストプラクティス
- `useDraggable` / `useSortable` の使い分け
- `useDroppable` でドロップ可能領域を明示
- `DragOverlay` で視覚的フィードバック
- `PointerSensor` + `activationConstraint`

### パフォーマンス最適化
- `useMemo` で重い処理をメモ化
- Firestoreリスナーのクリーンアップ
- 楽観的更新でUI応答性向上

### 環境構築

```bash
# 依存関係
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install firebase react-router-dom

# 開発サーバー
npm run dev

# ビルド
npm run build
```

### 問い合わせ・サポート

問題報告時に含める情報：
- 詳細な説明
- 再現手順
- 期待される動作と実際の動作
- ブラウザ情報
- コンソールエラー

---
