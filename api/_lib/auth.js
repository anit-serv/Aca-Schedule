import admin from "firebase-admin";
import { getAdminAuth, getAdminDb } from "./firestoreAdmin.js";
import { throwApiError } from "./errors.js";
import { sha256Hex } from "./request.js";

function getHeader(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseBearerToken(req) {
  const authorization = getHeader(req, "authorization");
  if (!authorization) {
    return null;
  }

  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    throwApiError(401, "INVALID_AUTHORIZATION", "Authorization header must use Bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throwApiError(401, "INVALID_AUTHORIZATION", "Bearer token is missing.");
  }

  return token;
}

function parseIdempotencyKey(req) {
  const idempotencyKey = getHeader(req, "x-idempotency-key");
  if (idempotencyKey == null) {
    throwApiError(400, "MISSING_IDEMPOTENCY_KEY", "x-idempotency-key header is required.");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 64) {
    throwApiError(400, "INVALID_IDEMPOTENCY_KEY", "x-idempotency-key must be between 1 and 64 characters.");
  }
  return idempotencyKey;
}

function normalizeAllowedEventIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((eventId) => typeof eventId === "string" && eventId.length > 0))];
}

async function authenticateWithFirebaseIdToken(idToken) {
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    throwApiError(401, "INVALID_ID_TOKEN", "Firebase ID token is invalid or expired.");
  }

  const userId = decoded.uid;
  if (!userId || typeof userId !== "string") {
    throwApiError(401, "INVALID_ID_TOKEN", "Firebase ID token is invalid.");
  }

  return {
    authType: "idToken",
    userId,
    userEmail: typeof decoded.email === "string" ? decoded.email : null,
    tokenId: null,
    allowedEventIds: null,
    rateLimitPolicy: null,
    rateLimitKey: `user:${userId}`,
    idempotencyScopeKey: `user:${userId}`,
  };
}

async function authenticateWithUserApiToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    throwApiError(401, "INVALID_USER_API_TOKEN", "x-user-api-token is invalid.");
  }

  const db = getAdminDb();
  const tokenHash = sha256Hex(rawToken.trim());
  const tokenQuery = await db
    .collection("userApiTokens")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (tokenQuery.empty) {
    throwApiError(401, "INVALID_USER_API_TOKEN", "User API token is invalid.");
  }

  const tokenDoc = tokenQuery.docs[0];
  const tokenData = tokenDoc.data() || {};

  if (tokenData.status !== "active") {
    throwApiError(401, "USER_API_TOKEN_REVOKED", "User API token is not active.");
  }

  const expiresAt = tokenData.expiresAt;
  if (expiresAt?.toMillis && expiresAt.toMillis() <= Date.now()) {
    throwApiError(401, "USER_API_TOKEN_EXPIRED", "User API token is expired.");
  }

  const userId = tokenData.userId;
  if (typeof userId !== "string" || !userId) {
    throwApiError(401, "INVALID_USER_API_TOKEN", "User API token is misconfigured.");
  }

  await tokenDoc.ref.set(
    {
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    authType: "pat",
    userId,
    userEmail: typeof tokenData.userEmail === "string" ? tokenData.userEmail : null,
    tokenId: tokenDoc.id,
    allowedEventIds: normalizeAllowedEventIds(tokenData.allowedEventIds),
    rateLimitPolicy: tokenData.rateLimitPolicy || null,
    rateLimitKey: `token:${tokenDoc.id}`,
    idempotencyScopeKey: `token:${tokenDoc.id}`,
  };
}

export async function authenticateFirebaseUser(req) {
  const idToken = parseBearerToken(req);
  if (!idToken) {
    throwApiError(401, "MISSING_AUTH", "Authorization Bearer token is required.");
  }
  return authenticateWithFirebaseIdToken(idToken);
}

export async function authenticateRequest(req) {
  const idempotencyKey = parseIdempotencyKey(req);
  const idToken = parseBearerToken(req);
  const userApiToken = getHeader(req, "x-user-api-token");

  if (!idToken && !userApiToken) {
    throwApiError(401, "MISSING_AUTH", "Either Authorization Bearer token or x-user-api-token is required.");
  }

  const principal = idToken
    ? await authenticateWithFirebaseIdToken(idToken)
    : await authenticateWithUserApiToken(userApiToken);

  return {
    ...principal,
    idempotencyKey,
  };
}

export async function ensureEventEditableByUser({ eventId, userId, userEmail, allowedEventIds }) {
  if (Array.isArray(allowedEventIds) && !allowedEventIds.includes(eventId)) {
    throwApiError(403, "EVENT_NOT_ALLOWED_BY_TOKEN", "User API token is not allowed for this event.");
  }

  const db = getAdminDb();
  const eventSnap = await db.collection("events").doc(eventId).get();
  if (!eventSnap.exists) {
    throwApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
  }

  const eventData = eventSnap.data() || {};
  const collaboratorEmails = Array.isArray(eventData.collaboratorEmails)
    ? eventData.collaboratorEmails.filter((email) => typeof email === "string")
    : [];

  const isOwner = eventData.ownerId === userId;
  const isCollaborator = !!userEmail && collaboratorEmails.includes(userEmail);

  if (!isOwner && !isCollaborator) {
    throwApiError(403, "EVENT_NOT_EDITABLE", "You do not have edit permission for this event.");
  }

  return {
    event: eventData,
    isOwner,
    isCollaborator,
  };
}

export async function ensureEventsEditableByUser({ eventIds, userId, userEmail }) {
  for (const eventId of eventIds) {
    await ensureEventEditableByUser({
      eventId,
      userId,
      userEmail,
      allowedEventIds: null,
    });
  }
}
