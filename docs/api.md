# Aca-Schedule API リファレンス

外部スクリプトやツールからバンド情報を登録するためのREST APIです。

## ベースURL

```
https://aca-schedule.vercel.app
```

## 認証

APIエンドポイントは2種類の認証方式をサポートしています。

### 方式1: Firebase IDトークン（Bearer）

Firebaseにログイン済みのユーザーが取得できるトークンです。ブラウザからの操作や、管理目的での利用に適しています。

```
Authorization: Bearer <firebase-id-token>
```

### 方式2: Personal Access Token（PAT）

アプリの設定画面から発行できるトークンです。スクリプトや外部ツールからの自動連携に適しています。

```
x-user-api-token: pat_xxxxxxxxxxxxxxxx
```

PATには以下の特徴があります。

- `pat_` で始まる64文字のランダムトークン
- 発行時に有効期限（1〜365日）を設定
- アクセスできるイベントを `allowedEventIds` で制限
- アプリの設定画面からいつでも失効可能

---

## 共通レスポンス形式

すべてのレスポンスは以下のJSON形式で返ります。

**成功時**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": { ... }
}
```

**エラー時**

```json
{
  "success": false,
  "requestId": "req_17783...",
  "error": {
    "code": "ERROR_CODE",
    "message": "エラーの説明",
    "details": [
      { "field": "fieldName", "message": "フィールドごとの詳細" }
    ]
  }
}
```

---

## エラーコード一覧

| コード | HTTPステータス | 説明 |
|---|---|---|
| `MISSING_AUTH` | 401 | 認証情報がない |
| `INVALID_ID_TOKEN` | 401 | FirebaseトークンがないまたはIDトークンが無効・期限切れ |
| `INVALID_USER_API_TOKEN` | 401 | PATが無効 |
| `USER_API_TOKEN_EXPIRED` | 401 | PATの有効期限切れ |
| `USER_API_TOKEN_REVOKED` | 401 | PATが失効済み |
| `MISSING_IDEMPOTENCY_KEY` | 400 | `x-idempotency-key` ヘッダーがない |
| `INVALID_IDEMPOTENCY_KEY` | 400 | `x-idempotency-key` が不正（1〜64文字） |
| `INVALID_BODY` | 400 | JSONのパースに失敗 |
| `INVALID_FIELD` | 400 | リクエストのバリデーション失敗（`details` にフィールド別の詳細あり） |
| `EVENT_NOT_FOUND` | 404 | 指定したイベントが存在しない |
| `EVENT_NOT_EDITABLE` | 403 | そのイベントの編集権限がない |
| `EVENT_NOT_ALLOWED_BY_TOKEN` | 403 | PATの `allowedEventIds` に含まれていないイベント |
| `IDEMPOTENCY_CONFLICT` | 409 | 同じキーで異なる内容のリクエストを送信した |
| `TOKEN_NOT_FOUND` | 404 | 指定したtokenIdが存在しない |
| `TOKEN_NOT_OWNED` | 403 | 他のユーザーのトークンは操作できない |
| `RATE_LIMITED` | 429 | レート制限超過（`Retry-After` ヘッダーに再試行可能秒数が入る） |
| `METHOD_NOT_ALLOWED` | 405 | 許可されていないHTTPメソッド |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |

---

## レート制限

認証済みリクエストには以下の制限があります。

| 種別 | 上限 |
|---|---|
| 1日あたり（ユーザー単位） | 2,000リクエスト |
| 1日あたり（PAT単位） | 2,000リクエスト |

制限を超えた場合は `429 RATE_LIMITED` が返ります。レスポンスの `Retry-After` ヘッダーに次回リクエスト可能までの秒数が含まれます。

---

## エンドポイント

### POST /api/v1/bands

バンドを新規作成します。

**認証**: Firebase IDトークン または PAT（`x-user-api-token`）

**必須ヘッダー**

| ヘッダー | 説明 |
|---|---|
| `x-idempotency-key` | 重複送信を防ぐためのユニークキー（1〜64文字）。同じキーで同じ内容を再送すると、同じ結果が返ります（冪等性）。 |

**リクエストボディ**

```json
{
  "eventId": "Py6woli4L2AFxYtGep6S",
  "name": "バンド名",
  "performanceDuration": 30,
  "performanceCount": 1,
  "members": ["田中太郎", "鈴木花子"],
  "availableTimeSlots": [
    {
      "date": "2026-06-01",
      "timeRanges": [
        { "startTime": "14:00", "endTime": "17:00" }
      ]
    }
  ]
}
```

**フィールド仕様**

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `eventId` | string | ✅ | 1〜64文字 |
| `name` | string | ✅ | 1〜100文字 |
| `performanceDuration` | integer | ✅ | 1〜180（分） |
| `performanceCount` | integer | | 1〜10（デフォルト: 1） |
| `members` | string[] | | 最大30件、各メンバー1〜40文字 |
| `availableTimeSlots` | object[] | | 最大30件 |
| `availableTimeSlots[].date` | string | ✅ | `YYYY-MM-DD` 形式、同じ日付は1回まで |
| `availableTimeSlots[].timeRanges` | object[] | ✅ | 最大8件、重複・逆順不可 |
| `availableTimeSlots[].timeRanges[].startTime` | string | ✅ | `HH:mm` 形式、分は `00` または `30` のみ |
| `availableTimeSlots[].timeRanges[].endTime` | string | ✅ | `HH:mm` 形式、`startTime` より後であること |

**レスポンス例（201 Created）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "bandId": "abc123def456",
    "eventId": "Py6woli4L2AFxYtGep6S",
    "created": true
  }
}
```

冪等性キーの再送時は `200 OK` で同じレスポンスが返ります（`created: true` のまま）。

**cURL例**

```bash
curl -X POST https://aca-schedule.vercel.app/api/v1/bands \
  -H "Content-Type: application/json" \
  -H "x-user-api-token: pat_xxxxxxxxxxxxxxxx" \
  -H "x-idempotency-key: my-unique-key-001" \
  -d '{
    "eventId": "Py6woli4L2AFxYtGep6S",
    "name": "サンプルバンド",
    "performanceDuration": 30,
    "performanceCount": 1,
    "members": ["田中", "鈴木"],
    "availableTimeSlots": [
      {
        "date": "2026-06-01",
        "timeRanges": [{ "startTime": "14:00", "endTime": "17:00" }]
      }
    ]
  }'
```

---

### POST /api/v1/user-api-tokens

PATを新規発行します。

**認証**: Firebase IDトークン（Bearer）のみ

**リクエストボディ**

```json
{
  "name": "自動登録スクリプト用",
  "allowedEventIds": ["Py6woli4L2AFxYtGep6S"],
  "expiresInDays": 90
}
```

| フィールド | 型 | 必須 | 制約 |
|---|---|---|---|
| `name` | string | ✅ | 1〜80文字 |
| `allowedEventIds` | string[] | ✅ | 1〜50件、各ID1〜64文字。自分が編集権限を持つイベントのみ指定可能。 |
| `expiresInDays` | integer | | 1〜365（デフォルト: 90） |

**レスポンス例（201 Created）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "token": "pat_a1b2c3d4e5f6...",
    "metadata": {
      "id": "tokenDocumentId",
      "name": "自動登録スクリプト用",
      "status": "active",
      "tokenPrefix": "pat_a1b2c3d4",
      "allowedEventIds": ["Py6woli4L2AFxYtGep6S"],
      "expiresAt": { "_seconds": 1777000000, "_nanoseconds": 0 },
      "createdAt": { "_seconds": 1746000000, "_nanoseconds": 0 }
    }
  }
}
```

> **注意**: `token` はこのレスポンスでのみ取得できます。再表示はできないため、必ず安全な場所に保存してください。

---

### GET /api/v1/user-api-tokens

自分が発行したPATの一覧を取得します。トークンの平文は含まれません。

**認証**: Firebase IDトークン（Bearer）のみ

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "tokens": [
      {
        "id": "tokenDocumentId",
        "name": "自動登録スクリプト用",
        "status": "active",
        "tokenPrefix": "pat_a1b2c3d4",
        "allowedEventIds": ["Py6woli4L2AFxYtGep6S"],
        "lastUsedAt": { "_seconds": 1746100000, "_nanoseconds": 0 },
        "expiresAt": { "_seconds": 1777000000, "_nanoseconds": 0 },
        "createdAt": { "_seconds": 1746000000, "_nanoseconds": 0 }
      }
    ]
  }
}
```

---

### PATCH /api/v1/user-api-tokens?tokenId=\<id\>

PATの情報を更新します。

**認証**: Firebase IDトークン（Bearer）のみ

**クエリパラメータ**

| パラメータ | 説明 |
|---|---|
| `tokenId` | 更新対象のトークンID（`GET` で取得した `id`） |

**リクエストボディ**（更新したいフィールドのみ指定）

```json
{
  "name": "新しいトークン名",
  "allowedEventIds": ["Py6woli4L2AFxYtGep6S", "anotherEventId"],
  "expiresInDays": 180
}
```

`expiresInDays` を指定すると、現在時刻から指定日数後に有効期限が延長されます。

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "token": {
      "id": "tokenDocumentId",
      "name": "新しいトークン名",
      "status": "active",
      ...
    }
  }
}
```

---

### DELETE /api/v1/user-api-tokens?tokenId=\<id\>

PATを失効させます。失効後はそのトークンでのAPIアクセスが `401 USER_API_TOKEN_REVOKED` になります。

**認証**: Firebase IDトークン（Bearer）のみ

**クエリパラメータ**

| パラメータ | 説明 |
|---|---|
| `tokenId` | 失効対象のトークンID |

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "revoked": true
  }
}
```

---

### POST /api/v1/auth/register-pending

新規ユーザーの仮登録を行います。確認メールの送信処理が内部で実行されます。

**認証**: 不要

**リクエストボディ**

```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "displayName": "山田太郎"
}
```

| フィールド | 制約 |
|---|---|
| `email` | 有効なメールアドレス形式、最大320文字 |
| `password` | 6〜128文字 |
| `displayName` | 1〜80文字 |

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "pendingId": "pending_abc123",
    "email": "user@example.com",
    "status": "pending"
  }
}
```

---

### POST /api/v1/auth/register-confirm

メール確認後に本登録を完了させます。

**認証**: Firebase IDトークン（Bearer）— メール確認済みのものが必要

**リクエストボディ**: なし

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "registrationStatus": "active",
    "email": "user@example.com"
  }
}
```

---

### POST /api/v1/auth/register-resend

確認メールを再送します。

**認証**: 不要

**リクエストボディ**

```json
{
  "email": "user@example.com"
}
```

**レスポンス例（200 OK）**

```json
{
  "success": true,
  "requestId": "req_17783...",
  "data": {
    "status": "pending"
  }
}
```

メールが確認済みの場合は `"status": "completed"` が返ります。存在しないメールアドレスの場合も同じく `"status": "pending"` を返します（セキュリティ上の理由）。

---

## PATを使ったバンド一括登録の例

```javascript
// register-bands.mjs
const PAT = 'pat_xxxxxxxxxxxxxxxx';
const EVENT_ID = 'Py6woli4L2AFxYtGep6S';
const BASE_URL = 'https://aca-schedule.vercel.app';

const bands = [
  {
    name: 'バンドA',
    performanceDuration: 30,
    members: ['田中', '鈴木', '佐藤'],
    availableTimeSlots: [
      { date: '2026-06-01', timeRanges: [{ startTime: '14:00', endTime: '17:00' }] },
    ],
  },
  {
    name: 'バンドB',
    performanceDuration: 20,
    members: ['伊藤', '渡辺'],
    availableTimeSlots: [
      { date: '2026-06-01', timeRanges: [{ startTime: '10:00', endTime: '12:00' }] },
      { date: '2026-06-02', timeRanges: [{ startTime: '13:00', endTime: '16:00' }] },
    ],
  },
];

for (const band of bands) {
  const res = await fetch(`${BASE_URL}/api/v1/bands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-api-token': PAT,
      'x-idempotency-key': `register-${band.name}-${Date.now()}`,
    },
    body: JSON.stringify({ eventId: EVENT_ID, performanceCount: 1, ...band }),
  });

  const data = await res.json();
  console.log(`${band.name}:`, res.status, data.data?.bandId ?? data.error?.code);
}
```
