import { getAdminDb } from "../_lib/firestoreAdmin.js";
import { enforceRateLimit } from "../_lib/rateLimit.js";
import { generateRequestId, sha256Hex } from "../_lib/request.js";
import { parseEventId, projectViewerData, verifyViewerPassword } from "../_lib/viewer.js";
import handleStakeholderProgress from "../_lib/stakeholderProgress.js";

export default async function handler(req, res) {
  const requestId = generateRequestId();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ success: false, requestId, error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }

  try {
    const source = req.method === "GET" ? req.query : req.body;
    const body = typeof source === "string" ? JSON.parse(source) : source || {};
    if (req.method === "POST" && (body.action === "read" || body.action === "apply")) {
      return handleStakeholderProgress(req, res);
    }
    const eventId = parseEventId(body.eventId);
    if (!eventId) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_EVENT_ID" } });
      return;
    }
    const db = getAdminDb();
    const eventSnap = await db.collection("events").doc(eventId).get();
    if (!eventSnap.exists) {
      res.status(404).json({ success: false, requestId, error: { code: "NOT_FOUND" } });
      return;
    }
    const settings = eventSnap.data();
    let audience = "public";
    if (req.method === "GET") {
      if (settings.isPublic !== true) {
        res.status(403).json({ success: false, requestId, error: { code: "NOT_PUBLIC" } });
        return;
      }
    } else {
      const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
      await enforceRateLimit(`viewer_${sha256Hex(`${eventId}:${ip}`).slice(0, 32)}`, { perMinute: 5, perDay: 100, trackMinute: true });
      const password = body.password;
      if (typeof password !== "string" || password.length > 128) {
        res.status(400).json({ success: false, requestId, error: { code: "INVALID_PASSWORD" } });
        return;
      }
      const secretSnap = await db.collection("viewerPasswords").doc(eventId).get();
      const valid = await verifyViewerPassword(password, secretSnap.data());
      if (!valid) {
        res.status(401).json({ success: false, requestId, error: { code: "INVALID_PASSWORD" } });
        return;
      }
      audience = "stakeholder";
    }

    const [bandsSnap, timetablesSnap, progressSnap] = await Promise.all([
      db.collection("bands").where("eventId", "==", eventId).get(),
      db.collection("timetables").where("eventId", "==", eventId).get(),
      audience === "public" ? db.collection("stakeholderProgress").doc(eventId).get() : Promise.resolve(null),
    ]);
    const bands = bandsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const timetablesByType = new Map();
    for (const doc of timetablesSnap.docs) {
      const timetable = { id: doc.id, ...doc.data() };
      if (timetable.type !== "performance" && timetable.type !== "rehearsal") continue;
      const previous = timetablesByType.get(timetable.type);
      if (!previous || (timetable.dailyTimetables?.length || 0) > (previous.dailyTimetables?.length || 0)) {
        timetablesByType.set(timetable.type, timetable);
      }
    }
    res.status(200).json({
      success: true,
      requestId,
      data: projectViewerData(eventId, settings, bands, [...timetablesByType.values()], audience, progressSnap?.data()),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_BODY" } });
      return;
    }
    if (error?.statusCode === 429) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds || 60));
      res.status(429).json({ success: false, requestId, error: { code: "RATE_LIMITED" } });
      return;
    }
    console.error("[viewer]", error);
    res.status(500).json({ success: false, requestId, error: { code: "INTERNAL_ERROR" } });
  }
}
