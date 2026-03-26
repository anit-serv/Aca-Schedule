import admin from "firebase-admin";
import { getAdminDb } from "./firestoreAdmin.js";
import { throwApiError } from "./errors.js";

const DEFAULT_LIMITS = {
  perMinute: 60,
  perDay: 2000,
};

function isMinuteLimitEnabled(policy) {
  if (typeof policy?.trackMinute === "boolean") {
    return policy.trackMinute;
  }

  const raw = String(process.env.RATE_LIMIT_TRACK_MINUTE || "false").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getUtcNow() {
  return new Date();
}

function minuteKey(now) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

function dayKey(now) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function secondsUntilNextMinute(now) {
  return 60 - now.getUTCSeconds();
}

function secondsUntilNextDay(now) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.floor((next.getTime() - now.getTime()) / 1000));
}

export async function enforceRateLimit(apiKey, policy) {
  const limits = {
    perMinute: Number(policy?.perMinute ?? DEFAULT_LIMITS.perMinute),
    perDay: Number(policy?.perDay ?? DEFAULT_LIMITS.perDay),
  };
  const trackMinute = isMinuteLimitEnabled(policy);

  const now = getUtcNow();
  const db = getAdminDb();

  const dayDocId = `${apiKey}_d_${dayKey(now)}`;
  const minRef = trackMinute
    ? db.collection("apiRateLimits").doc(`${apiKey}_m_${minuteKey(now)}`)
    : null;
  const dayRef = db.collection("apiRateLimits").doc(dayDocId);

  const result = await db.runTransaction(async (tx) => {
    const [minSnap, daySnap] = await Promise.all([
      minRef ? tx.get(minRef) : Promise.resolve(null),
      tx.get(dayRef),
    ]);

    const currentMinuteCount = minSnap?.exists ? Number(minSnap.data().count || 0) : 0;
    const currentDayCount = daySnap.exists ? Number(daySnap.data().count || 0) : 0;

    if (trackMinute && currentMinuteCount + 1 > limits.perMinute) {
      return {
        limited: true,
        retryAfterSeconds: secondsUntilNextMinute(now),
      };
    }

    if (currentDayCount + 1 > limits.perDay) {
      return {
        limited: true,
        retryAfterSeconds: secondsUntilNextDay(now),
      };
    }

    if (minRef) {
      tx.set(
        minRef,
        {
          apiKey,
          scope: "minute",
          count: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: admin.firestore.Timestamp.fromMillis(now.getTime() + 2 * 60 * 60 * 1000),
        },
        { merge: true }
      );
    }

    tx.set(
      dayRef,
      {
        apiKey,
        scope: "day",
        count: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      },
      { merge: true }
    );

    return { limited: false };
  });

  if (result.limited) {
    throwApiError(429, "RATE_LIMITED", "Rate limit exceeded.", undefined, result.retryAfterSeconds);
  }
}
