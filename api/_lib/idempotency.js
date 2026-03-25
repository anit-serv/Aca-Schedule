import admin from "firebase-admin";
import { getAdminDb } from "./firestoreAdmin.js";
import { throwApiError } from "./errors.js";
import { sha256Hex } from "./request.js";

function docIdFor(apiKey, idempotencyKey) {
  return sha256Hex(`${apiKey}:${idempotencyKey}`);
}

export async function ensureIdempotency({ apiKey, idempotencyKey, requestHash }) {
  const db = getAdminDb();
  const id = docIdFor(apiKey, idempotencyKey);
  const ref = db.collection("apiIdempotency").doc(id);
  const now = Date.now();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        apiKey,
        idempotencyKeyHash: sha256Hex(idempotencyKey),
        requestHash,
        status: "processing",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
      });
      return { state: "new", ref };
    }

    const data = snap.data() || {};
    const existingHash = data.requestHash;
    if (existingHash !== requestHash) {
      return { state: "conflict" };
    }

    if (data.status === "completed" && data.response) {
      return { state: "replay", response: data.response };
    }

    return { state: "processing" };
  });

  if (outcome.state === "conflict") {
    throwApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request.");
  }

  if (outcome.state === "replay") {
    return {
      isReplay: true,
      response: outcome.response,
      ref,
    };
  }

  if (outcome.state === "processing") {
    throwApiError(409, "IDEMPOTENCY_IN_PROGRESS", "A request with the same idempotency key is still processing.");
  }

  return {
    isReplay: false,
    ref,
  };
}

export async function saveIdempotencyResult(ref, responsePayload) {
  await ref.set(
    {
      status: "completed",
      response: responsePayload,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
