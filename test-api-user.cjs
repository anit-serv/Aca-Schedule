// test-api-user.cjs
// Usage (A):
//   FIREBASE_ID_TOKEN=<id_token> EVENT_ID=<event-id> node test-api-user.cjs
// Usage (B):
//   FIREBASE_WEB_API_KEY=<web_api_key> TEST_USER_EMAIL=<email> TEST_USER_PASSWORD=<password> EVENT_ID=<event-id> node test-api-user.cjs
// Optional:
//   BASE_URL=https://your-project.vercel.app

/**
 * @typedef {Object} PasswordLoginInput
 * @property {string} webApiKey
 * @property {string} email
 * @property {string} password
 */

/**
 * @typedef {Object} ScriptConfig
 * @property {string} baseUrl
 * @property {string} eventId
 * @property {string | null} idToken
 * @property {PasswordLoginInput | null} passwordLogin
 */

const BASE_URL = process.env.BASE_URL || 'https://aca-schedule.vercel.app';
const EVENT_ID = process.env.EVENT_ID || 'event-1';
const FIREBASE_ID_TOKEN = process.env.FIREBASE_ID_TOKEN || null;
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || null;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || null;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || null;

async function callJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/**
 * @param {PasswordLoginInput} input
 */
async function signInWithPassword(input) {
  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(input.webApiKey)}`;
  const { response, data } = await callJson(signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      returnSecureToken: true,
    }),
  });

  if (!response.ok || !data?.idToken) {
    throw new Error(`Failed to sign in with email/password: ${data?.error?.message || response.status}`);
  }

  return data.idToken;
}

/**
 * @returns {ScriptConfig}
 */
function getConfig() {
  const passwordLogin =
    FIREBASE_WEB_API_KEY && TEST_USER_EMAIL && TEST_USER_PASSWORD
      ? {
          webApiKey: FIREBASE_WEB_API_KEY,
          email: TEST_USER_EMAIL,
          password: TEST_USER_PASSWORD,
        }
      : null;

  return {
    baseUrl: BASE_URL,
    eventId: EVENT_ID,
    idToken: FIREBASE_ID_TOKEN,
    passwordLogin,
  };
}

async function main() {
  const config = getConfig();
  let idToken = config.idToken;

  if (!idToken && config.passwordLogin) {
    idToken = await signInWithPassword(config.passwordLogin);
  }

  if (!idToken) {
    console.error('FIREBASE_ID_TOKEN もしくは (FIREBASE_WEB_API_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD) が必要です。');
    process.exit(1);
  }

  const createTokenBody = {
    name: `local-test-${Date.now()}`,
    allowedEventIds: [config.eventId],
    expiresInDays: 90,
  };

  const createTokenResult = await callJson(`${config.baseUrl}/api/v1/user-api-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(createTokenBody),
  });

  console.log('\n=== Create PAT Response ===');
  console.log('status:', createTokenResult.response.status);
  console.log(JSON.stringify(createTokenResult.data, null, 2));

  const pat = createTokenResult.data?.data?.token;
  if (!pat) {
    console.error('\nPAT creation failed.');
    process.exit(1);
  }

  const tokenId = createTokenResult.data?.data?.metadata?.id;

  const createBandBody = {
    eventId: config.eventId,
    name: `Script Added Band ${new Date().toISOString()}`,
    performanceDuration: 30,
    performanceCount: 1,
    members: [],
    availableTimeSlots: [],
  };

  const createBandResult = await callJson(`${config.baseUrl}/api/v1/bands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-api-token': pat,
      'x-idempotency-key': `script-${Date.now()}`,
    },
    body: JSON.stringify(createBandBody),
  });

  console.log('\n=== Create Band Response ===');
  console.log('status:', createBandResult.response.status);
  console.log(JSON.stringify(createBandResult.data, null, 2));

  if (tokenId) {
    const revokeResult = await callJson(`${config.baseUrl}/api/v1/user-api-tokens?tokenId=${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    console.log('\n=== Revoke PAT Response ===');
    console.log('status:', revokeResult.response.status);
    console.log(JSON.stringify(revokeResult.data, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
