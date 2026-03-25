// test-api-user.cjs
// Usage:
//   FIREBASE_ID_TOKEN=<id_token> node test-api-user.cjs
// Optional:
//   BASE_URL=https://your-project.vercel.app
//   EVENT_ID=<event-id>

const BASE_URL = process.env.BASE_URL || 'https://aca-schedule-ansdbp7t3-anit-servs-projects.vercel.app';
const FIREBASE_ID_TOKEN = process.env.FIREBASE_ID_TOKEN;
const EVENT_ID = process.env.EVENT_ID || 'event-1';

if (!FIREBASE_ID_TOKEN) {
  console.error('FIREBASE_ID_TOKEN is required.');
  process.exit(1);
}

async function callJson(url, init) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function main() {
  const createTokenBody = {
    name: `local-test-${Date.now()}`,
    allowedEventIds: [EVENT_ID],
    expiresInDays: 90,
  };

  const createTokenResult = await callJson(`${BASE_URL}/api/v1/user-api-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIREBASE_ID_TOKEN}`,
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

  const createBandBody = {
    eventId: EVENT_ID,
    name: `Script Added Band ${new Date().toISOString()}`,
    performanceDuration: 30,
    performanceCount: 1,
    members: [],
    availableTimeSlots: [],
  };

  const createBandResult = await callJson(`${BASE_URL}/api/v1/bands`, {
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
