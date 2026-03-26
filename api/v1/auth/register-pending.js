import { ApiError } from "../../_lib/errors.js";
import { methodNotAllowed, sendJson, serverError } from "../../_lib/http.js";
import { generateRequestId } from "../../_lib/request.js";
import {
  createOrRefreshUnverifiedUser,
  parseRegisterPendingBody,
  sendVerificationLink,
  upsertPendingRegistration,
} from "../../_lib/registration.js";

function parseBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch {
      throw new ApiError(400, "INVALID_BODY", "Body must be valid JSON.");
    }
  }

  return req.body;
}

export default async function handler(req, res) {
  const requestId = generateRequestId();

  if (req.method !== "POST") {
    methodNotAllowed(res, requestId);
    return;
  }

  try {
    const payload = parseRegisterPendingBody(parseBody(req));
    const user = await createOrRefreshUnverifiedUser(payload);
    await sendVerificationLink({ req, email: payload.email });
    const pendingId = await upsertPendingRegistration({
      userId: user.uid,
      email: payload.email,
      displayName: payload.displayName,
    });

    sendJson(res, 200, {
      success: true,
      requestId,
      data: {
        pendingId,
        email: payload.email,
        status: "pending",
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
