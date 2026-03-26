import admin from "firebase-admin";
import { authenticateFirebaseUser } from "../../_lib/auth.js";
import { ApiError } from "../../_lib/errors.js";
import { getAdminAuth, getAdminDb } from "../../_lib/firestoreAdmin.js";
import { methodNotAllowed, sendJson, serverError } from "../../_lib/http.js";
import { generateRequestId } from "../../_lib/request.js";
import { markPendingRegistrationCompleted } from "../../_lib/registration.js";

async function ensureEmailVerified(userId) {
  const userRecord = await getAdminAuth().getUser(userId);
  if (!userRecord.emailVerified) {
    throw new ApiError(400, "EMAIL_NOT_VERIFIED", "Email verification is required to complete registration.");
  }

  if (!userRecord.email) {
    throw new ApiError(400, "EMAIL_NOT_FOUND", "Verified email was not found.");
  }

  return userRecord;
}

export default async function handler(req, res) {
  const requestId = generateRequestId();

  if (req.method !== "POST") {
    methodNotAllowed(res, requestId);
    return;
  }

  try {
    const auth = await authenticateFirebaseUser(req);
    const userRecord = await ensureEmailVerified(auth.userId);

    await markPendingRegistrationCompleted(userRecord.email);

    const db = getAdminDb();
    await db.collection("users").doc(userRecord.uid).set(
      {
        email: userRecord.email,
        displayName: userRecord.displayName || null,
        photoURL: userRecord.photoURL || null,
        emailVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        registrationStatus: "active",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    sendJson(res, 200, {
      success: true,
      requestId,
      data: {
        registrationStatus: "active",
        email: userRecord.email,
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
