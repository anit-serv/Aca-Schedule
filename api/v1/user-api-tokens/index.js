import admin from "firebase-admin";
import crypto from "crypto";
import { authenticateFirebaseUser, ensureEventsEditableByUser } from "../../_lib/auth.js";
import { ApiError } from "../../_lib/errors.js";
import { getAdminDb } from "../../_lib/firestoreAdmin.js";
import { methodNotAllowed, sendJson, serverError } from "../../_lib/http.js";
import { generateRequestId, sha256Hex } from "../../_lib/request.js";

function toClientTokenDoc(id, data) {
  return {
    id,
    name: data.name,
    status: data.status,
    tokenPrefix: data.tokenPrefix,
    allowedEventIds: Array.isArray(data.allowedEventIds) ? data.allowedEventIds : [],
    userId: data.userId,
    userEmail: data.userEmail || null,
    expiresAt: data.expiresAt || null,
    lastUsedAt: data.lastUsedAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

function parseCreateTokenBody(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Body must be a JSON object.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    throw new ApiError(400, "INVALID_FIELD", "name must be between 1 and 80 characters.", [
      { field: "name", message: "must be between 1 and 80 characters" },
    ]);
  }

  if (!Array.isArray(body.allowedEventIds) || body.allowedEventIds.length === 0) {
    throw new ApiError(400, "INVALID_FIELD", "allowedEventIds must contain at least one eventId.", [
      { field: "allowedEventIds", message: "must be a non-empty array" },
    ]);
  }

  const allowedEventIds = [...new Set(body.allowedEventIds)]
    .filter((eventId) => typeof eventId === "string")
    .map((eventId) => eventId.trim())
    .filter(Boolean);

  if (allowedEventIds.length === 0 || allowedEventIds.length > 50) {
    throw new ApiError(400, "INVALID_FIELD", "allowedEventIds must have between 1 and 50 items.", [
      { field: "allowedEventIds", message: "must have between 1 and 50 items" },
    ]);
  }

  const invalidEventId = allowedEventIds.find((eventId) => eventId.length > 64);
  if (invalidEventId) {
    throw new ApiError(400, "INVALID_FIELD", "Each eventId must be at most 64 characters.", [
      { field: "allowedEventIds", message: "each eventId must be at most 64 characters" },
    ]);
  }

  const expiresInDays = body.expiresInDays == null ? 90 : Number(body.expiresInDays);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
    throw new ApiError(400, "INVALID_FIELD", "expiresInDays must be an integer between 1 and 365.", [
      { field: "expiresInDays", message: "must be an integer between 1 and 365" },
    ]);
  }

  return {
    name,
    allowedEventIds,
    expiresInDays,
  };
}

async function createUserApiToken({ userId, userEmail, body }) {
  const payload = parseCreateTokenBody(body);

  await ensureEventsEditableByUser({
    eventIds: payload.allowedEventIds,
    userId,
    userEmail,
  });

  const plainToken = `pat_${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = sha256Hex(plainToken);
  const nowMs = Date.now();

  const db = getAdminDb();
  const ref = db.collection("userApiTokens").doc();
  await ref.set({
    name: payload.name,
    userId,
    userEmail: userEmail || null,
    tokenHash,
    tokenPrefix: plainToken.slice(0, 12),
    allowedEventIds: payload.allowedEventIds,
    status: "active",
    rateLimitPolicy: {
      perMinute: 60,
      perDay: 2000,
    },
    lastUsedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(nowMs + payload.expiresInDays * 24 * 60 * 60 * 1000),
  });

  const created = await ref.get();
  return {
    token: plainToken,
    metadata: toClientTokenDoc(ref.id, created.data() || {}),
  };
}

async function listUserApiTokens(userId) {
  const db = getAdminDb();
  const snapshot = await db.collection("userApiTokens").where("userId", "==", userId).get();

  return snapshot.docs
    .map((docSnap) => toClientTokenDoc(docSnap.id, docSnap.data()))
    .sort((a, b) => {
      const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bMs - aMs;
    });
}

export default async function handler(req, res) {
  const requestId = generateRequestId();

  if (req.method !== "POST" && req.method !== "GET") {
    methodNotAllowed(res, requestId);
    return;
  }

  try {
    const user = await authenticateFirebaseUser(req);

    if (req.method === "POST") {
      let bodySource = req.body;
      if (typeof req.body === "string") {
        try {
          bodySource = JSON.parse(req.body || "{}");
        } catch {
          throw new ApiError(400, "INVALID_BODY", "Body must be valid JSON.");
        }
      }

      const created = await createUserApiToken({
        userId: user.userId,
        userEmail: user.userEmail,
        body: bodySource,
      });

      sendJson(res, 201, {
        success: true,
        requestId,
        data: created,
      });
      return;
    }

    const tokens = await listUserApiTokens(user.userId);
    sendJson(res, 200, {
      success: true,
      requestId,
      data: {
        tokens,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.statusCode, {
        success: false,
        requestId,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    serverError(res, requestId);
  }
}
