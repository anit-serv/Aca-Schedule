import admin from "firebase-admin";
import { authenticateRequest } from "../_lib/auth.js";
import { ApiError } from "../_lib/errors.js";
import { getAdminDb } from "../_lib/firestoreAdmin.js";
import { methodNotAllowed, sendJson, serverError } from "../_lib/http.js";
import { ensureIdempotency, saveIdempotencyResult } from "../_lib/idempotency.js";
import { enforceRateLimit } from "../_lib/rateLimit.js";
import { generateRequestId, getRawBody, sha256Hex } from "../_lib/request.js";
import { validateCreateBandPayload } from "../_lib/validation.js";

function normalizeAllowedEvents(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((eventId) => typeof eventId === "string" && eventId.length > 0);
}

async function createBandAndAudit({ requestId, apiKey, payload, requestHash }) {
  const db = getAdminDb();
  const bandId = db.collection("bands").doc().id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const bandDoc = {
    eventId: payload.eventId,
    name: payload.name,
    performanceDuration: payload.performanceDuration,
    performanceCount: payload.performanceCount,
    members: payload.members,
    availableTimeSlots: payload.availableTimeSlots,
    createdAt: now,
    updatedAt: now,
  };

  const auditDoc = {
    requestId,
    apiKey,
    eventId: payload.eventId,
    status: "success",
    statusCode: 201,
    requestHash,
    createdAt: now,
  };

  const batch = db.batch();
  batch.set(db.collection("bands").doc(bandId), bandDoc);
  batch.set(db.collection("apiRequests").doc(requestId), auditDoc);
  await batch.commit();

  return {
    success: true,
    requestId,
    data: {
      bandId,
      eventId: payload.eventId,
      created: true,
    },
  };
}

async function saveErrorAudit({ requestId, apiKey, eventId, statusCode, errorCode, requestHash }) {
  try {
    const db = getAdminDb();
    await db.collection("apiRequests").doc(requestId).set({
      requestId,
      apiKey,
      eventId: eventId || null,
      status: "error",
      statusCode,
      errorCode,
      requestHash,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    // Avoid masking the original request failure.
  }
}

export default async function handler(req, res) {
  const requestId = generateRequestId();

  if (req.method !== "POST") {
    methodNotAllowed(res, requestId);
    return;
  }

  let apiKeyForAudit = null;
  let eventIdForAudit = null;
  const rawBody = getRawBody(req);
  const requestHash = sha256Hex(rawBody);

  try {
    const auth = await authenticateRequest(req);
    apiKeyForAudit = auth.apiKey;

    await enforceRateLimit(auth.apiKey, auth.integration.rateLimitPolicy);

    let payloadSource;
    if (typeof req.body === "string") {
      try {
        payloadSource = JSON.parse(req.body || "{}");
      } catch {
        throw new ApiError(400, "INVALID_BODY", "Body must be valid JSON.");
      }
    } else {
      payloadSource = req.body;
    }
    const payload = validateCreateBandPayload(payloadSource);
    eventIdForAudit = payload.eventId;

    const allowedEventIds = normalizeAllowedEvents(auth.integration.allowedEventIds);
    if (!allowedEventIds.includes(payload.eventId)) {
      throw new ApiError(403, "EVENT_NOT_ALLOWED", "API key is not allowed for this event.");
    }

    const idempotency = await ensureIdempotency({
      apiKey: auth.apiKey,
      idempotencyKey: auth.idempotencyKey,
      requestHash,
    });

    if (idempotency.isReplay) {
      sendJson(res, 200, idempotency.response);
      return;
    }

    const responsePayload = await createBandAndAudit({
      requestId,
      apiKey: auth.apiKey,
      payload,
      requestHash,
    });

    await saveIdempotencyResult(idempotency.ref, responsePayload);
    sendJson(res, 201, responsePayload);
  } catch (error) {
    if (error instanceof ApiError) {
      await saveErrorAudit({
        requestId,
        apiKey: apiKeyForAudit,
        eventId: eventIdForAudit,
        statusCode: error.statusCode,
        errorCode: error.code,
        requestHash,
      });

      if (typeof error.retryAfterSeconds === "number") {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
      }

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

    await saveErrorAudit({
      requestId,
      apiKey: apiKeyForAudit,
      eventId: eventIdForAudit,
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      requestHash,
    });

    serverError(res, requestId);
  }
}
