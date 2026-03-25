import { getAdminDb } from "./firestoreAdmin.js";
import { throwApiError } from "./errors.js";
import { getRawBody, makeHmacHex, timingSafeEqualHex } from "./request.js";

const TIMESTAMP_TOLERANCE_SECONDS = 300;

function getHeader(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseTimestampOrThrow(timestampHeader) {
  if (!timestampHeader || !/^\d+$/.test(timestampHeader)) {
    throwApiError(401, "INVALID_TIMESTAMP", "x-timestamp header is invalid.");
  }

  const timestampSeconds = Number(timestampHeader);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    throwApiError(401, "EXPIRED_TIMESTAMP", "x-timestamp is outside the allowed window.");
  }

  return timestampSeconds;
}

export async function authenticateRequest(req) {
  const apiKey = getHeader(req, "x-api-key");
  const signature = getHeader(req, "x-signature");
  const timestamp = getHeader(req, "x-timestamp");
  const idempotencyKey = getHeader(req, "x-idempotency-key");

  if (!apiKey || !signature || !timestamp || !idempotencyKey) {
    throwApiError(401, "MISSING_AUTH_HEADER", "Required auth headers are missing.");
  }

  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 64) {
    throwApiError(400, "INVALID_IDEMPOTENCY_KEY", "x-idempotency-key must be between 1 and 64 characters.");
  }

  parseTimestampOrThrow(timestamp);

  const db = getAdminDb();
  const integrationRef = db.collection("apiIntegrations").doc(apiKey);
  const integrationSnap = await integrationRef.get();

  if (!integrationSnap.exists) {
    throwApiError(401, "API_KEY_NOT_FOUND", "API key is invalid.");
  }

  const integration = integrationSnap.data();
  if (!integration || integration.status !== "active") {
    throwApiError(401, "API_KEY_REVOKED", "API key is not active.");
  }

  const secret = integration.secret;
  if (!secret || typeof secret !== "string") {
    throwApiError(401, "INVALID_API_KEY_CONFIG", "API key is misconfigured.");
  }

  const rawBody = getRawBody(req);
  const canonical = `${timestamp}\n${rawBody}`;
  const expectedSignature = makeHmacHex(secret, canonical);

  if (!timingSafeEqualHex(signature, expectedSignature)) {
    throwApiError(401, "INVALID_SIGNATURE", "Request signature is invalid.");
  }

  return {
    apiKey,
    idempotencyKey,
    integration,
    rawBody,
  };
}
