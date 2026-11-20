// The team account ("ادمن اكونت"): a second login that can only add products and bundles (server only).
// The owner sets its password from her dashboard; it is stored as a scrypt hash in Redis (team:password).
// Session: an HMAC-signed, expiring token in its own HttpOnly cookie. The token carries a short fingerprint
// of the password hash, so changing the password (or turning the account off) signs everybody out.
// What the team adds waits for the owner's approval before customers see it.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { isAdminRequest, verifyAdminPassword } from "./admin-auth.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

export const TEAM_COOKIE = "bm_team";
export const TEAM_SESSION_SECONDS = 14 * 24 * 60 * 60;
export const TEAM_PASSWORD_MIN = 8;
const PASSWORD = () => `${keyPrefix()}team:password`;

export type TeamRole = "owner" | "team";

/** scrypt:N:r:p:salt:hash — the same format as ADMIN_PASSWORD_HASH. */
export function hashTeamPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function checkTeamPasswordRules(password: unknown): string | null {
  if (typeof password !== "string" || password.length < TEAM_PASSWORD_MIN) return `الباسورد لازم يبقى ${TEAM_PASSWORD_MIN} حروف أو أرقام على الأقل.`;
  if (password.length > 128) return "الباسورد طويل أوي.";
  return null;
}

export async function loadTeamPasswordHash(): Promise<string | null> {
  const [stored] = await redisPipeline([["GET", PASSWORD()]], "write");
  return typeof stored === "string" && stored.startsWith("scrypt:") ? stored : null;
}

/** Sets the team password (signs out old sessions), or turns the account off with null. */
export async function setTeamPassword(password: string | null) {
  const value = password === null ? null : hashTeamPassword(password);
  const [, stored] = await redisPipeline([value ? ["SET", PASSWORD(), value] : ["DEL", PASSWORD()], ["GET", PASSWORD()]], "write");
  return value ? stored === value : stored === null || stored === undefined;
}

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
  return value.length >= 32 ? `team:${value}` : null;
}

const fingerprint = (hash: string) => createHash("sha256").update(hash).digest("base64url").slice(0, 12);
const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function createTeamSessionToken(passwordHash: string, now = Date.now()) {
  const key = secret();
  if (!key) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const payload = `t1.${now + TEAM_SESSION_SECONDS * 1000}.${fingerprint(passwordHash)}`;
  return `${payload}.${sign(payload, key)}`;
}

/** Signature and expiry only (no Redis) — for the proxy's first check. */
export function isWellFormedTeamToken(token: string | undefined | null, now = Date.now()) {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "t1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const expected = Buffer.from(sign(parts.slice(0, 3).join("."), key));
  const actual = Buffer.from(parts[3]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Full check: well formed, and made with the password that is set now. */
export function isValidTeamToken(token: string | undefined | null, passwordHash: string | null, now = Date.now()) {
  if (!passwordHash || !isWellFormedTeamToken(token, now)) return false;
  return token!.split(".")[2] === fingerprint(passwordHash);
}

export function verifyTeamPassword(password: string, passwordHash: string | null) {
  return passwordHash !== null && verifyAdminPassword(password, passwordHash);
}

function cookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Who is calling a team API: the owner (her admin session works here too), the team account, or nobody. */
export async function teamRole(request: Request): Promise<TeamRole | null> {
  if (isAdminRequest(request)) return "owner";
  const token = cookieValue(request.headers.get("cookie") ?? "", TEAM_COOKIE);
  if (!token || !isWellFormedTeamToken(token)) return null;
  return isValidTeamToken(token, await loadTeamPasswordHash()) ? "team" : null;
}

/** Same as teamRole, for pages (cookie values from next/headers). */
export async function teamRoleFromCookies(adminToken: string | undefined, teamToken: string | undefined, isAdmin: (token: string | undefined) => boolean): Promise<TeamRole | null> {
  if (isAdmin(adminToken)) return "owner";
  if (!teamToken || !isWellFormedTeamToken(teamToken)) return null;
  return isValidTeamToken(teamToken, await loadTeamPasswordHash().catch(() => null)) ? "team" : null;
}

export const teamCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: TEAM_SESSION_SECONDS,
};
