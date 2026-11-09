import { cookies } from "next/headers";

import { ADMIN_COOKIE, adminCookieOptions, createAdminSessionToken, isAdminAuthConfigured, isSameOrigin, verifyAdminPassword } from "@/lib/admin-auth";
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
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // Treated as a wrong password below.
  }

  if (!verifyAdminPassword(password)) {
    await recordLoginFailure(ipHash).catch(() => {});
    return json(401, { success: false, error: { code: "INVALID_PASSWORD", message: "الباسورد غلط." } });
  }

  await clearLoginFailures(ipHash).catch(() => {});
  (await cookies()).set(ADMIN_COOKIE, createAdminSessionToken(), adminCookieOptions);
  return json(200, { success: true });
}
