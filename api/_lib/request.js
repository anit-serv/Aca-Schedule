import crypto from "node:crypto";

export function generateRequestId() {
  return `req_${Date.now()}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function getRawBody(req) {
  if (typeof req.body === "string") {
    return req.body;
  }

  if (req.rawBody) {
    return req.rawBody.toString("utf8");
  }

  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

  return "";
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualHex(a, b) {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length) {
      return false;
    }
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function makeHmacHex(secret, content) {
  return crypto.createHmac("sha256", secret).update(content).digest("hex");
}
