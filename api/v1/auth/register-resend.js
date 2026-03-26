import { ApiError } from "../../_lib/errors.js";
import { getAdminAuth } from "../../_lib/firestoreAdmin.js";
import { methodNotAllowed, sendJson, serverError } from "../../_lib/http.js";
import { generateRequestId } from "../../_lib/request.js";
import { parseResendBody, sendVerificationLink, upsertPendingRegistration } from "../../_lib/registration.js";

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
    const { email } = parseResendBody(parseBody(req));
    const adminAuth = getAdminAuth();

    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        sendJson(res, 200, {
          success: true,
          requestId,
          data: {
            status: "pending",
          },
        });
        return;
      }
      throw error;
    }

    if (!user.emailVerified) {
      await sendVerificationLink({ req, email });
      await upsertPendingRegistration({
        userId: user.uid,
        email,
        displayName: user.displayName || "",
      });
    }

    sendJson(res, 200, {
      success: true,
      requestId,
      data: {
        status: user.emailVerified ? "completed" : "pending",
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
