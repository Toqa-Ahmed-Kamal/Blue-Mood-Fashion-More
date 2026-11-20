import { cookies } from "next/headers";

import { isSameOrigin } from "@/lib/admin-auth";
import { clearLoginFailures, clientIp, hashIp, isLoginLocked, recordLoginFailure } from "@/lib/analytics-store";
import { createTeamSessionToken, loadTeamPasswordHash, TEAM_COOKIE, teamCookieOptions, verifyTeamPassword } from "@/lib/team-auth";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Team account sign-in. Body: { password }. Off (503) until the owner sets a password. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const ipHash = hashIp(clientIp(request));
  if (await isLoginLocked(ipHash).catch(() => false)) return json(429, { success: false, error: { code: "TOO_MANY_ATTEMPTS", message: "محاولات كتير غلط. استنى ربع ساعة وجرب تاني." } });

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    // Treated as a wrong password below.
  }
  let hash: string | null;
  try {
    hash = await loadTeamPasswordHash();
  } catch {
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نتأكد دلوقتي. جرب تاني." } });
  }
  if (!hash) return json(503, { success: false, error: { code: "NOT_ENABLED", message: "الحساب ده مش متفعّل. كلّم صاحبة المحل." } });
  if (!verifyTeamPassword(password, hash)) {
    await recordLoginFailure(ipHash).catch(() => {});
    return json(401, { success: false, error: { code: "INVALID_PASSWORD", message: "الباسورد غلط." } });
  }
  await clearLoginFailures(ipHash).catch(() => {});
  (await cookies()).set(TEAM_COOKIE, createTeamSessionToken(hash), teamCookieOptions);
  return json(200, { success: true });
}
