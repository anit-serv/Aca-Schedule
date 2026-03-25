export class ApiError extends Error {
  constructor(statusCode, code, message, details, retryAfterSeconds) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function throwApiError(statusCode, code, message, details, retryAfterSeconds) {
  throw new ApiError(statusCode, code, message, details, retryAfterSeconds);
}
