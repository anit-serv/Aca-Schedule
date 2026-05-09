# API テスト

## ファイル構成

| ファイル | 用途 |
|---|---|
| `suite.cjs` | 全エンドポイントを網羅する包括的テストスイート（45件） |
| `quick.cjs` | PAT発行→バンド作成→PAT失効の一連フローを素早く確認するスクリプト |

## 前提条件

テストはローカルサーバー（`vercel dev`）または本番環境に対して実行します。
`npm run dev`（Viteのみ）では `/api/*` が動作しないため使用不可です。

```powershell
# 別ターミナルでサーバーを起動
vercel dev
```

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `EVENT_ID` | ✅ | テスト対象のFirestoreイベントID（自分が編集権限を持つもの） |
| `FIREBASE_WEB_API_KEY` | ※ | Firebase Web APIキー（自動ログイン時に使用） |
| `TEST_USER_EMAIL` | ※ | テストユーザーのメールアドレス |
| `TEST_USER_PASSWORD` | ※ | テストユーザーのパスワード |
| `FIREBASE_ID_TOKEN` | ※ | Firebase IDトークン（直接指定する場合） |
| `BASE_URL` | | テスト対象のベースURL（デフォルト: `http://localhost:3000`） |

※ `FIREBASE_ID_TOKEN` か `(FIREBASE_WEB_API_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD)` のいずれかが必須。

## 実行方法

### 包括的テストスイート（推奨）

```powershell
$env:FIREBASE_WEB_API_KEY="AIzaSy..."
$env:TEST_USER_EMAIL="you@example.com"
$env:TEST_USER_PASSWORD="yourpassword"
$env:EVENT_ID="Py6woli4L2AFxYtGep6S"
node tests/api/suite.cjs
```

特定のセクションだけ実行する場合：

```powershell
$env:TEST_SECTIONS="1,2"   # Section 1と2のみ
node tests/api/suite.cjs
```

本番環境に対して実行する場合：

```powershell
$env:BASE_URL="https://aca-schedule.vercel.app"
node tests/api/suite.cjs
```

### クイックフロー確認

```powershell
$env:FIREBASE_WEB_API_KEY="AIzaSy..."
$env:TEST_USER_EMAIL="you@example.com"
$env:TEST_USER_PASSWORD="yourpassword"
$env:EVENT_ID="Py6woli4L2AFxYtGep6S"
node tests/api/quick.cjs
```

## テストスイートの構成

| セクション | テスト数 | 内容 |
|---|---|---|
| Section 1 | 8件 | 認証・メソッドチェック |
| Section 2 | 12件 | PAT管理（CRUD・バリデーション・失効後利用） |
| Section 3 | 17件 | バンド作成（冪等性・権限・バリデーション） |
| Section 4 | 7件 | 登録APIバリデーション |
| **合計** | **44件** | |

## Event IDの確認方法

[Firebase Console](https://console.firebase.google.com/) → Firestore Database → `events` コレクション からドキュメントIDを確認してください。自分が `ownerId` または `collaboratorEmails` に含まれているイベントのIDを使用してください。
