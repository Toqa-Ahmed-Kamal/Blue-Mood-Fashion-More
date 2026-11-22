// Dashboard users (server only): people the owner adds, each with a username, a password and the sections
// they may open. The owner signs in with the main admin password and can do everything; a user reaches only
// the sections ticked for them, and every admin API checks that itself.
//
// Storage: one Redis hash (admin:users) — field = user id, value = JSON (password kept as a scrypt hash).
// Session: an HMAC-signed, expiring token in its own HttpOnly cookie, carrying the user id and a short
// fingerprint of the password hash, so a new password or turning the user off signs them out everywhere.
// Permissions are read from Redis on every request, so a change applies at once.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { ADMIN_COOKIE, isSameOrigin, isValidAdminSessionToken, unauthorized, verifyAdminPassword } from "./admin-auth.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { hashTeamPassword } from "./team-auth.ts";

export const USER_COOKIE = "bm_user";
export const USER_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const USER_PASSWORD_MIN = 8;
export const MAX_USERS = 30;

export const ADMIN_PERMISSIONS = [
  { id: "orders", label: "الأوردرات", note: "كل الأوردرات وأوردرات الموقع والقديمة: تشوف بيانات العميلات، تأكد وتلغي وتعدّل وتبلّغ الشحن." },
  { id: "stock", label: "البضاعة", note: "المخزون وحصر كميات المصنع وتحليل القطع، و\"نفدت الكمية\"." },
  { id: "products", label: "المنتجات والعروض", note: "المنتجات والأسعار وسعر المصنع، وإضافة وتعديل المنتجات، وموافقات الفريق." },
  { id: "money", label: "الفلوس والرسوم البيانية", note: "المكسب والمصروفات والبيع المباشر وخدتها لنفسي، ومكسب كل أوردر، والرسوم البيانية." },
  { id: "marketing", label: "التسويق", note: "الزيارات ورحلة العميلة والمنتجات." },
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]["id"];
export const isAdminPermission = (value: unknown): value is AdminPermission => ADMIN_PERMISSIONS.some((item) => item.id === value);

export type AdminUser = {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
  permissions: AdminPermission[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};
/** What the dashboard may show about a user (never the password hash). */
export type PublicAdminUser = Omit<AdminUser, "passwordHash">;
export const publicUser = ({ passwordHash: _hash, ...rest }: AdminUser): PublicAdminUser => {
  void _hash;
  return rest;
};

/** Who is signed in: the owner (everything) or a user (their sections). */
export type AdminAccess =
  | { owner: true; name: string; username: null; permissions: AdminPermission[] }
  | { owner: false; name: string; username: string; userId: string; permissions: AdminPermission[] };
export const OWNER_ACCESS: AdminAccess = { owner: true, name: "صاحبة المتجر", username: null, permissions: ADMIN_PERMISSIONS.map((item) => item.id) };
export const can = (access: AdminAccess, permission: AdminPermission) => access.owner || access.permissions.includes(permission);

// ── Validation (pure) ──────────────────────────────────────────────────────

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const normalizeUsername = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function checkUsername(value: unknown): string | null {
  return USERNAME.test(normalizeUsername(value)) ? null : "اسم الدخول من 3 لـ 32 حرف إنجليزي صغير أو أرقام (ومسموح . _ -)، من غير مسافات.";
}

export function checkPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length < USER_PASSWORD_MIN) return `الباسورد لازم يبقى ${USER_PASSWORD_MIN} حروف أو أرقام على الأقل.`;
  if (value.length > 128) return "الباسورد طويل أوي.";
  return null;
}

export function cleanName(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

export function cleanPermissions(value: unknown): AdminPermission[] {
  if (!Array.isArray(value)) return [];
  return ADMIN_PERMISSIONS.map((item) => item.id).filter((id) => value.includes(id));
}

/** A stored record, or null when it is not a valid user. */
export function parseUser(raw: unknown): AdminUser | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !/^[a-f0-9]{16}$/.test(item.id)) return null;
  if (checkUsername(item.username) || typeof item.passwordHash !== "string" || !item.passwordHash.startsWith("scrypt:")) return null;
  return {
    id: item.id,
    username: normalizeUsername(item.username),
    name: cleanName(item.name) || normalizeUsername(item.username),
    passwordHash: item.passwordHash,
    permissions: cleanPermissions(item.permissions),
    active: item.active !== false,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    ...(typeof item.lastLoginAt === "string" ? { lastLoginAt: item.lastLoginAt } : {}),
  };
}

// ── Storage ────────────────────────────────────────────────────────────────

const USERS = () => `${keyPrefix()}admin:users`;

export async function loadUsers(): Promise<AdminUser[]> {
  const [raw] = await redisPipeline([["HGETALL", USERS()]], "write");
  const flat = Array.isArray(raw) ? raw : [];
  const users: AdminUser[] = [];
  for (let index = 1; index < flat.length; index += 2) {
    const user = parseUser(flat[index]);
    if (user) users.push(user);
  }
  return users.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function loadUser(id: string): Promise<AdminUser | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const [raw] = await redisPipeline([["HGET", USERS(), id]], "write");
  return parseUser(raw);
}

/** Saves a user and confirms it was stored. */
export async function saveUser(user: AdminUser) {
  const value = JSON.stringify(user);
  const [, stored] = await redisPipeline([["HSET", USERS(), user.id, value], ["HGET", USERS(), user.id]], "write");
  return stored === value;
}

export async function deleteUser(id: string) {
  const [, stored] = await redisPipeline([["HDEL", USERS(), id], ["HGET", USERS(), id]], "write");
  return stored === null || stored === undefined;
}

export const newUserId = () => randomBytes(8).toString("hex");
export const hashUserPassword = (password: string) => hashTeamPassword(password);
export const verifyUserPassword = (password: string, user: AdminUser) => verifyAdminPassword(password, user.passwordHash);

// ── Session ────────────────────────────────────────────────────────────────

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
  return value.length >= 32 ? `user:${value}` : null;
}
const fingerprint = (user: Pick<AdminUser, "passwordHash">) => createHash("sha256").update(user.passwordHash).digest("base64url").slice(0, 12);
const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function createUserSessionToken(user: AdminUser, now = Date.now()) {
  const key = secret();
  if (!key) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const payload = `u1.${user.id}.${now + USER_SESSION_SECONDS * 1000}.${fingerprint(user)}`;
  return `${payload}.${sign(payload, key)}`;
}

/** Signature and expiry only (no Redis): the user id, or null. For the proxy's first check. */
export function userIdFromToken(token: string | undefined | null, now = Date.now()): string | null {
  const key = secret();
  if (!key || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "u1" || !/^[a-f0-9]{16}$/.test(parts[1])) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const expected = Buffer.from(sign(parts.slice(0, 4).join("."), key));
  const actual = Buffer.from(parts[4]);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? parts[1] : null;
}

/** Full check: well formed, made with the user's current password, and the user is on. */
export function isValidUserToken(token: string | undefined | null, user: AdminUser | null, now = Date.now()) {
  if (!user || !user.active) return false;
  if (userIdFromToken(token, now) !== user.id) return false;
  return token!.split(".")[3] === fingerprint(user);
}

function cookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Who is signed in, from the two cookie values (for pages and APIs). */
export async function accessFromTokens(adminToken: string | null | undefined, userToken: string | null | undefined): Promise<AdminAccess | null> {
  if (isValidAdminSessionToken(adminToken)) return OWNER_ACCESS;
  const id = userIdFromToken(userToken);
  if (!id) return null;
  const user = await loadUser(id);
  if (!isValidUserToken(userToken, user)) return null;
  return { owner: false, name: user!.name, username: user!.username, userId: user!.id, permissions: user!.permissions };
}

export async function accessFromRequest(request: Request): Promise<AdminAccess | null> {
  const header = request.headers.get("cookie") ?? "";
  return accessFromTokens(cookieValue(header, ADMIN_COOKIE), cookieValue(header, USER_COOKIE));
}

const noStore = { "Cache-Control": "no-store" };
export const forbiddenSection = () =>
  Response.json({ success: false, error: { code: "NO_PERMISSION", message: "مش مسموحلك بالقسم ده. اطلبي من صاحبة المتجر تفتحهولك." } }, { status: 403, headers: noStore });

/**
 * For Route Handlers: null when the caller may go on, otherwise the response to send back.
 * `need` = any one of these sections is enough; "owner" = only the owner.
 */
export async function accessDenied(request: Request, need: AdminPermission[] | "owner"): Promise<Response | null> {
  const result = await requireAccess(request, need);
  return result instanceof Response ? result : null;
}

/** Same as accessDenied, but hands back who is calling when allowed. */
export async function requireAccess(request: Request, need: AdminPermission[] | "owner"): Promise<AdminAccess | Response> {
  let access: AdminAccess | null;
  try {
    access = await accessFromRequest(request);
  } catch {
    return Response.json({ success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نتأكد من الدخول دلوقتي. جربي تاني." } }, { status: 502, headers: noStore });
  }
  if (!access) return unauthorized();
  if (access.owner) return access;
  if (need === "owner" || !need.some((permission) => access.permissions.includes(permission))) return forbiddenSection();
  return access;
}

export const userCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: USER_SESSION_SECONDS,
};

export { isSameOrigin };
