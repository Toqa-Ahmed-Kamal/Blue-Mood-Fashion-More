import { cookies } from "next/headers";

import { ADMIN_COOKIE, adminCookieOptions, createAdminSessionToken, isAdminAuthConfigured, isSameOrigin, verifyAdminPassword } from "@/lib/admin-auth";
import { USER_COOKIE, createUserSessionToken, loadUsers, normalizeUsername, saveUser, userCookieOptions, verifyUserPassword } from "@/lib/admin-users";
import { clearLoginFailures, clientIp, hashIp, isLoginLocked, recordLoginFailure } from "@/lib/analytics-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  if (!isAdminAuthConfigured()) {
    console.error("[admin] ADMIN_PASSWORD_HASH / ADMIN_SESSION_SECRET are missing or invalid");
    return json(503, { success: false, error: { code: "NOT_CONFIGURED", message: "الدخول مش متفعّل لسه على السيرفر." } });
  }

  const ipHash = hashIp(clientIp(request));
  // Throttling needs Redis; if Redis is down the slow scrypt check still limits guessing.
  const locked = await isLoginLocked(ipHash).catch(() => false);
  if (locked) return json(429, { success: false, error: { code: "TOO_MANY_ATTEMPTS", message: "محاولات كتير غلط. استني ربع ساعة وجربي تاني." } });

  let password = "";
  let username = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
    username = normalizeUsername(body?.username);
  } catch {
    // Treated as a wrong password below.
  }

  // A dashboard user (username + password): their own session, limited to their sections.
  if (username) {
    let user = null;
    try {
      user = (await loadUsers()).find((item) => item.username === username) ?? null;
    } catch {
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نتأكد دلوقتي. جربي تاني." } });
    }
    if (!user || !user.active || !verifyUserPassword(password, user)) {
      await recordLoginFailure(ipHash).catch(() => {});
      return json(401, { success: false, error: { code: "INVALID_PASSWORD", message: "اسم الدخول أو الباسورد غلط." } });
    }
    await clearLoginFailures(ipHash).catch(() => {});
    await saveUser({ ...user, lastLoginAt: new Date().toISOString() }).catch(() => false);
    const jar = await cookies();
    jar.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
    jar.set(USER_COOKIE, createUserSessionToken(user), userCookieOptions);
    return json(200, { success: true });
  }

  if (!verifyAdminPassword(password)) {
    await recordLoginFailure(ipHash).catch(() => {});
    return json(401, { success: false, error: { code: "INVALID_PASSWORD", message: "الباسورد غلط." } });
  }

  await clearLoginFailures(ipHash).catch(() => {});
  const jar = await cookies();
  jar.set(USER_COOKIE, "", { ...userCookieOptions, maxAge: 0 });
  jar.set(ADMIN_COOKIE, createAdminSessionToken(), adminCookieOptions);
  return json(200, { success: true });
}
