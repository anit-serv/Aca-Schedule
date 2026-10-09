import { authenticateFirebaseUser } from "../_lib/auth.js";
import { getAdminDb } from "../_lib/firestoreAdmin.js";
import { generateRequestId } from "../_lib/request.js";
import { hashViewerPassword, parseEventId } from "../_lib/viewer.js";

export default async function handler(req, res) {
  const requestId = generateRequestId();
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "PUT", "DELETE"].includes(req.method)) {
    res.status(405).json({ success: false, requestId, error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }

  try {
    const auth = await authenticateFirebaseUser(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const eventId = parseEventId(req.method === "GET" ? req.query.eventId : body.eventId);
    if (!eventId) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_EVENT_ID" } });
      return;
    }
    const db = getAdminDb();
    const eventSnap = await db.collection("events").doc(eventId).get();
    if (!eventSnap.exists || eventSnap.data().ownerId !== auth.userId) {
      res.status(403).json({ success: false, requestId, error: { code: "FORBIDDEN" } });
      return;
    }
    const secretRef = db.collection("viewerPasswords").doc(eventId);
    if (req.method === "GET") {
      const secret = await secretRef.get();
      res.status(200).json({ success: true, requestId, data: { configured: secret.exists } });
      return;
    }
    if (req.method === "DELETE") {
      await secretRef.delete();
      res.status(200).json({ success: true, requestId, data: { configured: false } });
      return;
    }
    const password = body.password;
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_PASSWORD", message: "8〜128文字のパスワードを入力してください。" } });
      return;
    }
    const hashed = await hashViewerPassword(password);
    await secretRef.set({ ...hashed, updatedAt: new Date() });
    res.status(200).json({ success: true, requestId, data: { configured: true } });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_BODY" } });
      return;
    }
    if (error?.statusCode === 401) {
      res.status(401).json({ success: false, requestId, error: { code: "UNAUTHORIZED" } });
      return;
    }
    console.error("[viewer-password]", error);
    res.status(500).json({ success: false, requestId, error: { code: "INTERNAL_ERROR" } });
  }
}
