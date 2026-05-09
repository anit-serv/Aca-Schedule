// tests/api/suite.cjs
// 包括的APIテストスイート
//
// Usage (A) - メール+パスワードで自動ログイン:
//   FIREBASE_WEB_API_KEY=<key> TEST_USER_EMAIL=<email> TEST_USER_PASSWORD=<password> EVENT_ID=<id> node tests/api/suite.cjs
//
// Usage (B) - IDトークン直接指定:
//   FIREBASE_ID_TOKEN=<token> EVENT_ID=<id> node tests/api/suite.cjs
//
// Optional:
//   BASE_URL=https://your-project.vercel.app  (default: http://localhost:3000)
//   TEST_SECTIONS=1,2,3,4                     (実行するセクション番号、default: all)

'use strict';

// ─── ANSI color codes ────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

// ─── Config ──────────────────────────────────────────────────────────────────
const BASE_URL            = process.env.BASE_URL            || 'http://localhost:3000';
const EVENT_ID            = process.env.EVENT_ID            || '';
const FIREBASE_ID_TOKEN   = process.env.FIREBASE_ID_TOKEN   || null;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || null;
const TEST_USER_EMAIL     = process.env.TEST_USER_EMAIL     || null;
const TEST_USER_PASSWORD  = process.env.TEST_USER_PASSWORD  || null;
const TEST_SECTIONS_RAW   = process.env.TEST_SECTIONS       || 'all';

// ─── State ───────────────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
let skipCount = 0;
const failures = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function callJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function signInWithPassword({ webApiKey, email, password }) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey)}`;
  const { response, data } = await callJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok || !data?.idToken) {
    throw new Error(`Login failed: ${data?.error?.message || response.status}`);
  }
  return data.idToken;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let currentSection = '';

async function test(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ${GREEN}✓${RESET} ${name}`);
  } catch (err) {
    failCount++;
    const msg = err?.message || String(err);
    console.log(`  ${RED}✗${RESET} ${name}`);
    console.log(`    ${RED}→ ${msg}${RESET}`);
    failures.push({ section: currentSection, name, message: msg });
  }
}

function skip(name, reason) {
  skipCount++;
  console.log(`  ${YELLOW}–${RESET} ${name} ${YELLOW}(skipped: ${reason})${RESET}`);
}

function section(title) {
  currentSection = title;
  console.log(`\n${BOLD}${CYAN}${title}${RESET}`);
}

function uniqueKey() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Request builders ────────────────────────────────────────────────────────
function bandUrl() { return `${BASE_URL}/api/v1/bands`; }
function patUrl(tokenId) {
  return tokenId
    ? `${BASE_URL}/api/v1/user-api-tokens?tokenId=${encodeURIComponent(tokenId)}`
    : `${BASE_URL}/api/v1/user-api-tokens`;
}

function bearerHeaders(idToken, extra = {}) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...extra };
}

function patHeaders(pat, extra = {}) {
  return { 'Content-Type': 'application/json', 'x-user-api-token': pat, ...extra };
}

function validBandBody(eventId, overrides = {}) {
  return {
    eventId,
    name: `Test Band ${Date.now()}`,
    performanceDuration: 30,
    performanceCount: 1,
    members: ['Taro', 'Hanako'],
    availableTimeSlots: [
      { date: '2026-06-01', timeRanges: [{ startTime: '14:00', endTime: '17:00' }] },
    ],
    ...overrides,
  };
}

// ─── Test Sections ────────────────────────────────────────────────────────────

async function runSection1_Authentication(idToken, eventId) {
  section('Section 1: Authentication');

  await test('bands: 認証なし → 401 MISSING_AUTH', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-idempotency-key': uniqueKey() },
      body: JSON.stringify(validBandBody(eventId)),
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'MISSING_AUTH', `Expected MISSING_AUTH, got ${data.error?.code}`);
  });

  await test('bands: 不正Bearerトークン → 401 INVALID_ID_TOKEN', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.token.here',
        'x-idempotency-key': uniqueKey(),
      },
      body: JSON.stringify(validBandBody(eventId)),
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'INVALID_ID_TOKEN', `Expected INVALID_ID_TOKEN, got ${data.error?.code}`);
  });

  await test('bands: 不正PAT → 401 INVALID_USER_API_TOKEN', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-api-token': 'pat_invalid_fake_token_that_does_not_exist',
        'x-idempotency-key': uniqueKey(),
      },
      body: JSON.stringify(validBandBody(eventId)),
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'INVALID_USER_API_TOKEN', `Expected INVALID_USER_API_TOKEN, got ${data.error?.code}`);
  });

  await test('bands: idempotency-keyなし → 400 MISSING_IDEMPOTENCY_KEY', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify(validBandBody(eventId)),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'MISSING_IDEMPOTENCY_KEY', `Expected MISSING_IDEMPOTENCY_KEY, got ${data.error?.code}`);
  });

  await test('bands: GETメソッド → 405 METHOD_NOT_ALLOWED', async () => {
    const { response } = await callJson(bandUrl(), { method: 'GET' });
    assert(response.status === 405, `Expected 405, got ${response.status}`);
  });

  await test('user-api-tokens: 認証なし → 401 MISSING_AUTH', async () => {
    const { response, data } = await callJson(patUrl(), { method: 'GET' });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'MISSING_AUTH', `Expected MISSING_AUTH, got ${data.error?.code}`);
  });

  await test('user-api-tokens: 不正Bearerトークン → 401 INVALID_ID_TOKEN', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'INVALID_ID_TOKEN', `Expected INVALID_ID_TOKEN, got ${data.error?.code}`);
  });

  await test('user-api-tokens: PUTメソッド → 405 METHOD_NOT_ALLOWED', async () => {
    const { response } = await callJson(patUrl(), { method: 'PUT' });
    assert(response.status === 405, `Expected 405, got ${response.status}`);
  });
}

async function runSection2_UserApiTokens(idToken, eventId) {
  section('Section 2: PAT管理 (User API Tokens)');

  let createdTokenId = null;
  let createdPat = null;

  await test('PAT作成 (正常) → 201', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: `suite-test-${Date.now()}`, allowedEventIds: [eventId], expiresInDays: 1 }),
    });
    assert(response.status === 201, `Expected 201, got ${response.status}: ${JSON.stringify(data.error)}`);
    assert(data.success === true, 'Expected success: true');
    assert(typeof data.data?.token === 'string', 'Expected token string');
    assert(data.data.token.startsWith('pat_'), 'Token must start with pat_');
    createdTokenId = data.data?.metadata?.id;
    createdPat = data.data?.token;
    assert(createdTokenId, 'Expected tokenId in response');
  });

  await test('PAT一覧取得 → 200', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'GET',
      headers: bearerHeaders(idToken),
    });
    assert(response.status === 200, `Expected 200, got ${response.status}`);
    assert(data.success === true, 'Expected success: true');
    assert(Array.isArray(data.data?.tokens), 'Expected tokens array');
    if (createdTokenId) {
      const found = data.data.tokens.find((t) => t.id === createdTokenId);
      assert(found, `Newly created token ${createdTokenId} not found in list`);
    }
  });

  await test('PAT名前を更新 (PATCH) → 200', async () => {
    if (!createdTokenId) { throw new Error('PAT作成が失敗したためスキップ'); }
    const newName = `updated-${Date.now()}`;
    const { response, data } = await callJson(patUrl(createdTokenId), {
      method: 'PATCH',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: newName }),
    });
    assert(response.status === 200, `Expected 200, got ${response.status}: ${JSON.stringify(data.error)}`);
    assert(data.data?.token?.name === newName, `Expected name "${newName}", got "${data.data?.token?.name}"`);
  });

  await test('PAT失効 (DELETE) → 200', async () => {
    if (!createdTokenId) { throw new Error('PAT作成が失敗したためスキップ'); }
    const { response, data } = await callJson(patUrl(createdTokenId), {
      method: 'DELETE',
      headers: bearerHeaders(idToken),
    });
    assert(response.status === 200, `Expected 200, got ${response.status}`);
    assert(data.data?.revoked === true, 'Expected revoked: true');
  });

  await test('失効済みPATでband作成 → 401 USER_API_TOKEN_REVOKED', async () => {
    if (!createdPat) { throw new Error('PAT作成が失敗したためスキップ'); }
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(createdPat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId)),
    });
    assert(response.status === 401, `Expected 401, got ${response.status}`);
    assert(data.error?.code === 'USER_API_TOKEN_REVOKED', `Expected USER_API_TOKEN_REVOKED, got ${data.error?.code}`);
  });

  await test('PAT作成: nameが空 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: '', allowedEventIds: [eventId], expiresInDays: 1 }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('PAT作成: nameが81文字超 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: 'a'.repeat(81), allowedEventIds: [eventId], expiresInDays: 1 }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('PAT作成: allowedEventIdsが空配列 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: 'test', allowedEventIds: [], expiresInDays: 1 }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('PAT作成: expiresInDaysが0 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: 'test', allowedEventIds: [eventId], expiresInDays: 0 }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('PAT作成: expiresInDaysが366 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: 'test', allowedEventIds: [eventId], expiresInDays: 366 }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('PAT更新: フィールドなし → 400 INVALID_FIELD', async () => {
    const { data: createData } = await callJson(patUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: `temp-${Date.now()}`, allowedEventIds: [eventId], expiresInDays: 1 }),
    });
    const tmpId = createData.data?.metadata?.id;
    if (!tmpId) { throw new Error('temp PAT作成失敗'); }

    const { response, data } = await callJson(patUrl(tmpId), {
      method: 'PATCH',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({}),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);

    await callJson(patUrl(tmpId), { method: 'DELETE', headers: bearerHeaders(idToken) });
  });

  await test('PAT更新: 存在しないtokenId → 404 TOKEN_NOT_FOUND', async () => {
    const { response, data } = await callJson(patUrl('nonexistent-token-id-xyz'), {
      method: 'PATCH',
      headers: bearerHeaders(idToken),
      body: JSON.stringify({ name: 'new name' }),
    });
    assert(response.status === 404, `Expected 404, got ${response.status}`);
    assert(data.error?.code === 'TOKEN_NOT_FOUND', `Expected TOKEN_NOT_FOUND, got ${data.error?.code}`);
  });

  await test('PAT削除: tokenIdクエリなし → 400 INVALID_TOKEN_ID', async () => {
    const { response, data } = await callJson(`${BASE_URL}/api/v1/user-api-tokens`, {
      method: 'DELETE',
      headers: bearerHeaders(idToken),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_TOKEN_ID', `Expected INVALID_TOKEN_ID, got ${data.error?.code}`);
  });
}

async function runSection3_Bands(idToken, eventId) {
  section('Section 3: バンド作成');

  const createPatRes = await callJson(patUrl(), {
    method: 'POST',
    headers: bearerHeaders(idToken),
    body: JSON.stringify({ name: `band-test-pat-${Date.now()}`, allowedEventIds: [eventId], expiresInDays: 1 }),
  });
  const pat = createPatRes.data?.data?.token;
  const patId = createPatRes.data?.data?.metadata?.id;

  if (!pat) {
    console.log(`  ${YELLOW}– Section 3全体スキップ: PAT発行失敗${RESET}`);
    skipCount += 10;
    return;
  }

  const idempotencyKey1 = uniqueKey();
  const bandBody1 = validBandBody(eventId);
  let firstResponseData = null;

  await test('バンド作成 (PAT認証, 正常) → 201', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': idempotencyKey1 }),
      body: JSON.stringify(bandBody1),
    });
    assert(response.status === 201, `Expected 201, got ${response.status}: ${JSON.stringify(data.error)}`);
    assert(data.success === true, 'Expected success: true');
    assert(typeof data.data?.bandId === 'string', 'Expected bandId string');
    assert(data.data?.created === true, 'Expected created: true');
    firstResponseData = data;
  });

  await test('バンド作成 (Bearer認証, 正常) → 201', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { name: `Bearer Test Band ${Date.now()}` })),
    });
    assert(response.status === 201, `Expected 201, got ${response.status}: ${JSON.stringify(data.error)}`);
    assert(data.success === true, 'Expected success: true');
  });

  await test('冪等性: 同じキー・同じbody → 200 (replay)', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': idempotencyKey1 }),
      body: JSON.stringify(bandBody1),
    });
    assert(response.status === 200, `Expected 200 (replay), got ${response.status}`);
    assert(data.data?.bandId === firstResponseData?.data?.bandId, 'Expected same bandId on replay');
  });

  await test('冪等性: 同じキー・異なるbody → 409 IDEMPOTENCY_CONFLICT', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': idempotencyKey1 }),
      body: JSON.stringify(validBandBody(eventId, { name: 'Different Band Name' })),
    });
    assert(response.status === 409, `Expected 409, got ${response.status}`);
    assert(data.error?.code === 'IDEMPOTENCY_CONFLICT', `Expected IDEMPOTENCY_CONFLICT, got ${data.error?.code}`);
  });

  await test('PATのallowedEventIds外のeventId → 403 EVENT_NOT_ALLOWED_BY_TOKEN', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody('not-allowed-event-id-xyz')),
    });
    assert(response.status === 403, `Expected 403, got ${response.status}`);
    assert(data.error?.code === 'EVENT_NOT_ALLOWED_BY_TOKEN', `Expected EVENT_NOT_ALLOWED_BY_TOKEN, got ${data.error?.code}`);
  });

  await test('存在しないeventId → 404 EVENT_NOT_FOUND', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: bearerHeaders(idToken, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody('nonexistent-event-xyz-99999')),
    });
    assert(response.status === 404, `Expected 404, got ${response.status}`);
    assert(data.error?.code === 'EVENT_NOT_FOUND', `Expected EVENT_NOT_FOUND, got ${data.error?.code}`);
  });

  await test('バリデーション: nameが空 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { name: '' })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
    const nameError = data.error?.details?.find((d) => d.field === 'name');
    assert(nameError, 'Expected error for field "name"');
  });

  await test('バリデーション: performanceDurationが0 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { performanceDuration: 0 })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: performanceDurationが181 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { performanceDuration: 181 })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: performanceCountが11 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { performanceCount: 11 })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: timeRange endTime <= startTime → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, {
        availableTimeSlots: [
          { date: '2026-06-01', timeRanges: [{ startTime: '17:00', endTime: '14:00' }] },
        ],
      })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: timeRangeが重複 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, {
        availableTimeSlots: [
          {
            date: '2026-06-01',
            timeRanges: [
              { startTime: '14:00', endTime: '16:00' },
              { startTime: '15:00', endTime: '17:00' },
            ],
          },
        ],
      })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: 無効なtimeFormat (HH:15) → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, {
        availableTimeSlots: [
          { date: '2026-06-01', timeRanges: [{ startTime: '14:15', endTime: '17:00' }] },
        ],
      })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: 同じ日付が重複 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, {
        availableTimeSlots: [
          { date: '2026-06-01', timeRanges: [] },
          { date: '2026-06-01', timeRanges: [] },
        ],
      })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: availableTimeSlotsが31件 → 400 INVALID_FIELD', async () => {
    const slots = Array.from({ length: 31 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return { date: `2026-06-${day}`, timeRanges: [] };
    });
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, { availableTimeSlots: slots })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: dateフォーマットが不正 → 400 INVALID_FIELD', async () => {
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: patHeaders(pat, { 'x-idempotency-key': uniqueKey() }),
      body: JSON.stringify(validBandBody(eventId, {
        availableTimeSlots: [{ date: '01/06/2026', timeRanges: [] }],
      })),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_FIELD', `Expected INVALID_FIELD, got ${data.error?.code}`);
  });

  await test('バリデーション: bodyが不正JSON → 400 INVALID_BODY', async () => {
    // Content-Type: text/plain でVercelのJSONパーサーをバイパスし、ハンドラー内のパスを通す
    const { response, data } = await callJson(bandUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'x-user-api-token': pat,
        'x-idempotency-key': uniqueKey(),
      },
      body: 'not json at all',
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_BODY', `Expected INVALID_BODY, got ${data.error?.code}`);
  });

  if (patId) {
    await callJson(patUrl(patId), { method: 'DELETE', headers: bearerHeaders(idToken) });
  }
}

async function runSection4_AuthRegistration() {
  section('Section 4: 認証登録API (バリデーション)');

  const pendingUrl = `${BASE_URL}/api/v1/auth/register-pending`;
  const resendUrl  = `${BASE_URL}/api/v1/auth/register-resend`;

  await test('register-pending: GETメソッド → 405', async () => {
    const { response } = await callJson(pendingUrl, { method: 'GET' });
    assert(response.status === 405, `Expected 405, got ${response.status}`);
  });

  await test('register-pending: bodyなし → 400', async () => {
    const { response, data } = await callJson(pendingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(!data.success, 'Expected success: false');
  });

  await test('register-pending: 不正JSONボディ → 400 INVALID_BODY', async () => {
    const { response, data } = await callJson(pendingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{ invalid json',
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_BODY', `Expected INVALID_BODY, got ${data.error?.code}`);
  });

  await test('register-pending: メールアドレスなし → 400', async () => {
    const { response, data } = await callJson(pendingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Test', password: 'pass1234' }),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(!data.success, 'Expected success: false');
  });

  await test('register-resend: GETメソッド → 405', async () => {
    const { response } = await callJson(resendUrl, { method: 'GET' });
    assert(response.status === 405, `Expected 405, got ${response.status}`);
  });

  await test('register-resend: 不正JSONボディ → 400 INVALID_BODY', async () => {
    const { response, data } = await callJson(resendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{ bad',
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(data.error?.code === 'INVALID_BODY', `Expected INVALID_BODY, got ${data.error?.code}`);
  });

  await test('register-resend: メールアドレスなし → 400', async () => {
    const { response, data } = await callJson(resendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(response.status === 400, `Expected 400, got ${response.status}`);
    assert(!data.success, 'Expected success: false');
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  Aca-Schedule API 包括的テストスイート${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`  Base URL : ${BASE_URL}`);
  console.log(`  Event ID : ${EVENT_ID || '(未設定)'}`);

  let idToken = FIREBASE_ID_TOKEN;

  if (!idToken && FIREBASE_WEB_API_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD) {
    process.stdout.write('\n  Firebase ログイン中...');
    try {
      idToken = await signInWithPassword({
        webApiKey: FIREBASE_WEB_API_KEY,
        email: TEST_USER_EMAIL,
        password: TEST_USER_PASSWORD,
      });
      console.log(` ${GREEN}OK${RESET}`);
    } catch (err) {
      console.log(` ${RED}FAILED${RESET}`);
      console.error(`  ${RED}${err.message}${RESET}`);
      process.exit(1);
    }
  }

  if (!idToken) {
    console.error(`\n${RED}エラー: 認証情報が不足しています。${RESET}`);
    console.error('以下のいずれかを環境変数で指定してください:');
    console.error('  FIREBASE_ID_TOKEN=<token>');
    console.error('  FIREBASE_WEB_API_KEY=<key> TEST_USER_EMAIL=<email> TEST_USER_PASSWORD=<password>');
    process.exit(1);
  }

  if (!EVENT_ID) {
    console.error(`\n${RED}エラー: EVENT_ID が未設定です。${RESET}`);
    process.exit(1);
  }

  const sectionsToRun = TEST_SECTIONS_RAW === 'all'
    ? [1, 2, 3, 4]
    : TEST_SECTIONS_RAW.split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);

  if (sectionsToRun.includes(1)) await runSection1_Authentication(idToken, EVENT_ID);
  if (sectionsToRun.includes(2)) await runSection2_UserApiTokens(idToken, EVENT_ID);
  if (sectionsToRun.includes(3)) await runSection3_Bands(idToken, EVENT_ID);
  if (sectionsToRun.includes(4)) await runSection4_AuthRegistration();

  const total = passCount + failCount + skipCount;
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  結果サマリー${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`  合計: ${total} テスト`);
  console.log(`  ${GREEN}✓ PASS: ${passCount}${RESET}`);
  if (failCount > 0) console.log(`  ${RED}✗ FAIL: ${failCount}${RESET}`);
  if (skipCount > 0) console.log(`  ${YELLOW}– SKIP: ${skipCount}${RESET}`);

  if (failures.length > 0) {
    console.log(`\n${BOLD}${RED}失敗したテスト:${RESET}`);
    failures.forEach(({ section: sec, name, message }, i) => {
      console.log(`  ${i + 1}. [${sec}] ${name}`);
      console.log(`     ${RED}${message}${RESET}`);
    });
  }

  console.log('');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
