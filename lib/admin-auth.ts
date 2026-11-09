// Admin authentication (server only). Password checked against a scrypt hash; the session is an
// HMAC-signed, expiring token in an HttpOnly cookie. Fails closed when the secrets are not configured.
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "bm_admin";
export const ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60;

/** Format: scrypt:N:r:p:<salt base64url>:<hash base64url> (no "$", so .env files don't expand it). */
export function verifyAdminPassword(password: string, stored = process.env.ADMIN_PASSWORD_HASH?.trim() ?? "") {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt" || password.length === 0 || password.length > 256) return false;
  const [, n, r, p, saltText, hashText] = parts;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(password, Buffer.from(saltText, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return expected.length >= 32 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function isAdminAuthConfigured() {
  return sessionSecret() !== null && (process.env.ADMIN_PASSWORD_HASH ?? "").startsWith("scrypt:");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSessionToken(now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const payload = `v1.${now + ADMIN_SESSION_SECONDS * 1000}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function isValidAdminSessionToken(token: string | undefined | null, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const actual = Buffer.from(parts[2]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** For Route Handlers: every admin API checks this itself (the proxy is only the first layer). */
export function isAdminRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.split(/;\s*/).find((part) => part.startsWith(`${ADMIN_COOKIE}=`));
  return isValidAdminSessionToken(match ? decodeURIComponent(match.slice(ADMIN_COOKIE.length + 1)) : null);
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite=Strict). */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: ADMIN_SESSION_SECONDS,
};

export const unauthorized = () =>
  Response.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
