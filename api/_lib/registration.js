import admin from "firebase-admin";
import { ApiError } from "./errors.js";
import { getAdminAuth, getAdminDb } from "./firestoreAdmin.js";
import { sha256Hex } from "./request.js";

const REGISTRATION_PENDING_TTL_HOURS = 48;

function getAppBaseUrl(req) {
  const envBaseUrl = process.env.APP_BASE_URL || process.env.PUBLIC_APP_BASE_URL;
  if (envBaseUrl) {
    return envBaseUrl.replace(/\/$/, "");
  }

  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";

  if (!hostHeader || typeof hostHeader !== "string") {
    throw new ApiError(500, "APP_BASE_URL_NOT_CONFIGURED", "Application base URL is not configured.");
  }

  return `${protocol}://${hostHeader}`.replace(/\/$/, "");
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function parseRegisterPendingBody(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Body must be a JSON object.");
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

  const errors = [];

  if (!email || email.length > 320 || !email.includes("@")) {
    errors.push({ field: "email", message: "must be a valid email address" });
  }

  if (password.length < 6 || password.length > 128) {
    errors.push({ field: "password", message: "must be between 6 and 128 characters" });
  }

  if (!displayName || displayName.length > 80) {
    errors.push({ field: "displayName", message: "must be between 1 and 80 characters" });
  }

  if (errors.length > 0) {
    throw new ApiError(400, "INVALID_FIELD", "Request validation failed.", errors);
  }

  return {
    email,
    password,
    displayName,
  };
}

export function parseResendBody(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Body must be a JSON object.");
  }

  const email = normalizeEmail(body.email);
  if (!email || email.length > 320 || !email.includes("@")) {
    throw new ApiError(400, "INVALID_FIELD", "email must be a valid email address.", [
      { field: "email", message: "must be a valid email address" },
    ]);
  }

  return { email };
}

export function getPendingDocRef(email) {
  const db = getAdminDb();
  const pendingId = `pending_${sha256Hex(normalizeEmail(email))}`;
  return db.collection("registrationPendings").doc(pendingId);
}

export async function upsertPendingRegistration({ userId, email, displayName }) {
  const now = Date.now();
  const ref = getPendingDocRef(email);

  await ref.set(
    {
      userId,
      email,
      emailLower: normalizeEmail(email),
      displayName,
      status: "pending",
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(now + REGISTRATION_PENDING_TTL_HOURS * 60 * 60 * 1000),
      completedAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return ref.id;
}

export async function markPendingRegistrationCompleted(email) {
  const ref = getPendingDocRef(email);
  const snap = await ref.get();
  if (!snap.exists) {
    return false;
  }

  await ref.set(
    {
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return true;
}

export async function createOrRefreshUnverifiedUser({ email, password, displayName }) {
  const adminAuth = getAdminAuth();

  try {
    const existing = await adminAuth.getUserByEmail(email);

    if (existing.emailVerified) {
      throw new ApiError(409, "EMAIL_ALREADY_VERIFIED", "This email is already registered and verified.");
    }

    await adminAuth.updateUser(existing.uid, {
      password,
      displayName,
      disabled: false,
      emailVerified: false,
    });

    return { uid: existing.uid, email: existing.email || email };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  const created = await adminAuth.createUser({
    email,
    password,
    displayName,
    emailVerified: false,
    disabled: false,
  });

  return { uid: created.uid, email: created.email || email };
}

export async function sendVerificationLink({ req, email }) {
  const adminAuth = getAdminAuth();
  const appBaseUrl = getAppBaseUrl(req);

  const actionCodeSettings = {
    url: `${appBaseUrl}/login?registered=1`,
    handleCodeInApp: false,
  };

  return adminAuth.generateEmailVerificationLink(email, actionCodeSettings);
}
