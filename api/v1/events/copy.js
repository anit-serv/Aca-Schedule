import { authenticateFirebaseUser } from "../../_lib/auth.js";
import { copyEventOnServer } from "../../_lib/eventCopy.js";
import { ApiError } from "../../_lib/errors.js";
import { getAdminDb } from "../../_lib/firestoreAdmin.js";
import { generateRequestId } from "../../_lib/request.js";
import { parseEventId } from "../../_lib/viewer.js";

export default async function handler(req, res) {
  const requestId = generateRequestId();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ success: false, requestId, error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }
  try {
    const auth = await authenticateFirebaseUser(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const eventId = parseEventId(body.eventId);
    if (!eventId) throw new ApiError(400, "INVALID_EVENT_ID", "A valid eventId is required.");
    const result = await copyEventOnServer(getAdminDb(), eventId, auth.userId);
    res.status(201).json({ success: true, requestId, data: result });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ success: false, requestId, error: { code: "INVALID_BODY" } });
      return;
    }
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ success: false, requestId, error: { code: error.code, message: error.message } });
      return;
    }
    console.error("[events/copy]", error);
    res.status(500).json({ success: false, requestId, error: { code: "INTERNAL_ERROR" } });
  }
}
