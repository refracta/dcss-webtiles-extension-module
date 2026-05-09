import crypto from "node:crypto";

const COOKIE_NAME = "cnc_profiles_session";

export class SessionManager {
  constructor({ secret, maxAgeSeconds = 604800, secureCookie = true }) {
    this.secret = secret;
    this.maxAgeSeconds = maxAgeSeconds;
    this.secureCookie = secureCookie;
  }

  createCookie({ username }) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      username,
      exp: now + this.maxAgeSeconds
    };
    const value = signPayload(payload, this.secret);
    const parts = [
      `${COOKIE_NAME}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${this.maxAgeSeconds}`
    ];

    if (this.secureCookie) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  clearCookie() {
    return [
      `${COOKIE_NAME}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      this.secureCookie ? "Secure" : null
    ].filter(Boolean).join("; ");
  }

  readSession(request) {
    const cookies = parseCookies(request.headers.cookie ?? "");
    const value = cookies[COOKIE_NAME];
    if (!value) return null;

    const payload = verifyPayload(value, this.secret);
    if (!payload) return null;

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      username: payload.username
    };
  }
}

function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyPayload(value, secret) {
  const [encoded, signature] = String(value).split(".");
  if (!encoded || !signature) return null;

  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result[key] = value;
  }
  return result;
}
