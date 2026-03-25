export function sendJson(res, statusCode, body) {
  res.status(statusCode).json(body);
}

export function methodNotAllowed(res, requestId) {
  sendJson(res, 405, {
    success: false,
    requestId,
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Only POST is supported for this endpoint.",
    },
  });
}

export function serverError(res, requestId) {
  sendJson(res, 500, {
    success: false,
    requestId,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
}
