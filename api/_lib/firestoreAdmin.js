import admin from "firebase-admin";

let appInstance = null;

function parseServiceAccountFromEnv() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }

  const parsed = JSON.parse(json);
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

export function getAdminApp() {
  if (appInstance) {
    return appInstance;
  }

  const serviceAccount = parseServiceAccountFromEnv();
  appInstance = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
  });

  return appInstance;
}

export function getAdminDb() {
  return getAdminApp().firestore();
}
