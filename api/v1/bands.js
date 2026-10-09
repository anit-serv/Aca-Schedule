import admin from "firebase-admin";
import { authenticateRequest, ensureEventEditableByUser } from "../_lib/auth.js";
import { ApiError } from "../_lib/errors.js";
import { getAdminDb } from "../_lib/firestoreAdmin.js";
import { sendJson, serverError } from "../_lib/http.js";
import { ensureIdempotency, saveIdempotencyResult } from "../_lib/idempotency.js";
import { enforceRateLimit } from "../_lib/rateLimit.js";
import { generateRequestId, getRawBody, sha256Hex } from "../_lib/request.js";
import { validateAvailabilitySlots, validateBackupRehearsalContext, validateCreateBandPayload } from "../_lib/validation.js";

async function loadRehearsalDays(db, eventId) {
  const snapshot = await db.collection("timetables").where("eventId", "==", eventId).get();
  return snapshot.docs
    .map(doc => doc.data())
    .filter(timetable => timetable.type === "rehearsal")
    .sort((a, b) => (b.dailyTimetables?.length || 0) - (a.dailyTimetables?.length || 0))[0]?.dailyTimetables || [];
}

function shouldWriteSuccessAudit() {
  const mode = String(process.env.API_SUCCESS_AUDIT_MODE || "errors-only").toLowerCase();
  return mode === "always";
}

async function createBand({ requestId, authContext, payload, requestHash }) {
  const db = getAdminDb();
  const bandId = db.collection("bands").doc().id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const bandDoc = {
    eventId: payload.eventId,
    name: payload.name,
    performanceDuration: payload.performanceDuration,
    performanceCount: payload.performanceCount,
    toriPriority: payload.toriPriority,
    costume: payload.costume,
    bandMaster: payload.bandMaster,
    members: payload.members,
    availableTimeSlots: payload.availableTimeSlots,
    backupRehearsalTimeSlots: payload.backupRehearsalTimeSlots,
    createdAt: now,
    updatedAt: now,
  };

  if (shouldWriteSuccessAudit()) {
    const auditDoc = {
      requestId,
      authType: authContext.authType,
      userId: authContext.userId,
      userEmail: authContext.userEmail,
      tokenId: authContext.tokenId,
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
  } else {
    await db.collection("bands").doc(bandId).set(bandDoc);
  }

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

async function saveErrorAudit({ requestId, authContext, eventId, statusCode, errorCode, requestHash }) {
  try {
    const db = getAdminDb();
    await db.collection("apiRequests").doc(requestId).set({
      requestId,
      authType: authContext?.authType || null,
      userId: authContext?.userId || null,
      userEmail: authContext?.userEmail || null,
      tokenId: authContext?.tokenId || null,
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

  if (req.method !== "POST" && req.method !== "PATCH") {
    sendJson(res, 405, {
      success: false, requestId,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only POST and PATCH are supported for this endpoint." },
    });
    return;
  }

  let authContext = null;
  let eventIdForAudit = null;
  const rawBody = getRawBody(req);
  const bandId = Array.isArray(req.query?.bandId) ? req.query.bandId[0] : req.query?.bandId;
  const requestHash = sha256Hex(req.method === "PATCH" ? `PATCH:bands:${bandId}:${rawBody}` : rawBody);

  try {
    const auth = await authenticateRequest(req);
    authContext = auth;

    await enforceRateLimit(auth.rateLimitKey, auth.rateLimitPolicy);

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
    if (req.method === "PATCH") {
      if (typeof bandId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(bandId)) {
        throw new ApiError(400, "INVALID_BAND_ID", "A valid bandId query parameter is required.");
      }
      if (!payloadSource || typeof payloadSource !== "object" || Array.isArray(payloadSource)
        || Object.keys(payloadSource).some(key => key !== "backupRehearsalTimeSlots")
        || !Object.hasOwn(payloadSource, "backupRehearsalTimeSlots")) {
        throw new ApiError(400, "INVALID_BODY", "Body must contain only backupRehearsalTimeSlots.");
      }
      const backupSlots = validateAvailabilitySlots(payloadSource.backupRehearsalTimeSlots, "backupRehearsalTimeSlots");
      const db = getAdminDb();
      const bandRef = db.collection("bands").doc(bandId);
      const bandSnapshot = await bandRef.get();
      if (!bandSnapshot.exists) throw new ApiError(404, "BAND_NOT_FOUND", "Band was not found.");
      const band = bandSnapshot.data();
      eventIdForAudit = band.eventId;
      const { event } = await ensureEventEditableByUser({
        eventId: band.eventId,
        userId: auth.userId,
        userEmail: auth.userEmail,
        allowedEventIds: auth.allowedEventIds,
      });
      const rehearsalDays = backupSlots.length ? await loadRehearsalDays(db, band.eventId) : [];
      validateBackupRehearsalContext(backupSlots, band.availableTimeSlots || [], event, rehearsalDays);
      const idempotency = await ensureIdempotency({
        apiKey: auth.idempotencyScopeKey, idempotencyKey: auth.idempotencyKey, requestHash,
      });
      if (idempotency.isReplay) {
        sendJson(res, 200, idempotency.response);
        return;
      }
      await db.runTransaction(async transaction => {
        const current = await transaction.get(bandRef);
        if (!current.exists) throw new ApiError(404, "BAND_NOT_FOUND", "Band was not found.");
        const currentBand = current.data();
        if (currentBand.eventId !== band.eventId) throw new ApiError(409, "BAND_CHANGED", "Band event changed during update.");
        validateBackupRehearsalContext(backupSlots, currentBand.availableTimeSlots || [], event, rehearsalDays);
        transaction.update(bandRef, {
          backupRehearsalTimeSlots: backupSlots,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (shouldWriteSuccessAudit()) {
          transaction.set(db.collection("apiRequests").doc(requestId), {
            requestId, authType: auth.authType, userId: auth.userId,
            userEmail: auth.userEmail, tokenId: auth.tokenId, eventId: band.eventId,
            status: "success", statusCode: 200, requestHash,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      const responsePayload = { success: true, requestId, data: { bandId, eventId: band.eventId, updated: true } };
      await saveIdempotencyResult(idempotency.ref, responsePayload);
      sendJson(res, 200, responsePayload);
      return;
    }

    const payload = validateCreateBandPayload(payloadSource);
    eventIdForAudit = payload.eventId;

    const { event } = await ensureEventEditableByUser({
      eventId: payload.eventId,
      userId: auth.userId,
      userEmail: auth.userEmail,
      allowedEventIds: auth.allowedEventIds,
    });
    if (payload.backupRehearsalTimeSlots.length) {
      const rehearsalDays = await loadRehearsalDays(getAdminDb(), payload.eventId);
      validateBackupRehearsalContext(payload.backupRehearsalTimeSlots, payload.availableTimeSlots, event, rehearsalDays);
    }

    const idempotency = await ensureIdempotency({
      apiKey: auth.idempotencyScopeKey,
      idempotencyKey: auth.idempotencyKey,
      requestHash,
    });

    if (idempotency.isReplay) {
      sendJson(res, 200, idempotency.response);
      return;
    }

    const responsePayload = await createBand({
      requestId,
      authContext: auth,
      payload,
      requestHash,
    });

    await saveIdempotencyResult(idempotency.ref, responsePayload);
    sendJson(res, 201, responsePayload);
  } catch (error) {
    if (error instanceof ApiError) {
      await saveErrorAudit({
        requestId,
        authContext,
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
      authContext,
      eventId: eventIdForAudit,
      statusCode: 500,
      errorCode: "INTERNAL_ERROR",
      requestHash,
    });

    serverError(res, requestId);
  }
}
