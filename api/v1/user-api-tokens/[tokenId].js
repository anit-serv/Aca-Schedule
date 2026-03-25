import admin from "firebase-admin";
import { authenticateFirebaseUser, ensureEventsEditableByUser } from "../../_lib/auth.js";
import { ApiError } from "../../_lib/errors.js";
import { getAdminDb } from "../../_lib/firestoreAdmin.js";
import { methodNotAllowed, sendJson, serverError } from "../../_lib/http.js";
import { generateRequestId } from "../../_lib/request.js";

async function revokeUserApiToken({ tokenId, userId }) {
  if (!tokenId || typeof tokenId !== "string") {
    throw new ApiError(400, "INVALID_TOKEN_ID", "tokenId is invalid.");
  }

  const db = getAdminDb();
  const ref = db.collection("userApiTokens").doc(tokenId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new ApiError(404, "TOKEN_NOT_FOUND", "Token not found.");
  }

  const token = snap.data() || {};
  if (token.userId !== userId) {
    throw new ApiError(403, "TOKEN_NOT_OWNED", "You cannot revoke another user's token.");
  }

  await ref.set(
    {
      status: "revoked",
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

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

function parseUpdateBody(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Body must be a JSON object.");
  }

  const update = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      throw new ApiError(400, "INVALID_FIELD", "name must be between 1 and 80 characters.", [
        { field: "name", message: "must be between 1 and 80 characters" },
      ]);
    }
    update.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "allowedEventIds")) {
    if (!Array.isArray(body.allowedEventIds) || body.allowedEventIds.length === 0) {
      throw new ApiError(400, "INVALID_FIELD", "allowedEventIds must be a non-empty array.", [
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

    update.allowedEventIds = allowedEventIds;
  }

  if (Object.prototype.hasOwnProperty.call(body, "expiresInDays")) {
    const expiresInDays = Number(body.expiresInDays);
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
      throw new ApiError(400, "INVALID_FIELD", "expiresInDays must be an integer between 1 and 365.", [
        { field: "expiresInDays", message: "must be an integer between 1 and 365" },
      ]);
    }
    update.expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  }

  if (Object.keys(update).length === 0) {
    throw new ApiError(400, "INVALID_FIELD", "At least one updatable field is required.");
  }

  return update;
}

async function updateUserApiToken({ tokenId, userId, userEmail, body }) {
  const db = getAdminDb();
  const ref = db.collection("userApiTokens").doc(tokenId);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new ApiError(404, "TOKEN_NOT_FOUND", "Token not found.");
  }

  const token = snap.data() || {};
  if (token.userId !== userId) {
    throw new ApiError(403, "TOKEN_NOT_OWNED", "You cannot update another user's token.");
  }

  const update = parseUpdateBody(body);

  if (Array.isArray(update.allowedEventIds)) {
    await ensureEventsEditableByUser({
      eventIds: update.allowedEventIds,
      userId,
      userEmail,
    });
  }

  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.set(update, { merge: true });
  const updated = await ref.get();
  return toClientTokenDoc(ref.id, updated.data() || {});
}

export default async function handler(req, res) {
  const requestId = generateRequestId();

  if (req.method !== "DELETE" && req.method !== "PATCH") {
    methodNotAllowed(res, requestId);
    return;
  }

  try {
    const user = await authenticateFirebaseUser(req);
    const tokenId = req.query.tokenId;

    const normalizedTokenId = Array.isArray(tokenId) ? tokenId[0] : tokenId;

    if (req.method === "DELETE") {
      await revokeUserApiToken({
        tokenId: normalizedTokenId,
        userId: user.userId,
      });

      sendJson(res, 200, {
        success: true,
        requestId,
        data: {
          revoked: true,
        },
      });
      return;
    }

    let bodySource = req.body;
    if (typeof req.body === "string") {
      try {
        bodySource = JSON.parse(req.body || "{}");
      } catch {
        throw new ApiError(400, "INVALID_BODY", "Body must be valid JSON.");
      }
    }
    const updated = await updateUserApiToken({
      tokenId: normalizedTokenId,
      userId: user.userId,
      userEmail: user.userEmail,
      body: bodySource,
    });

    sendJson(res, 200, {
      success: true,
      requestId,
      data: {
        token: updated,
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
