// Shared helpers for the team account's API routes (server only).
import { RedisUnavailableError } from "./redis.ts";
import { isSameOrigin } from "./admin-auth.ts";
import { teamRole, type TeamRole } from "./team-auth.ts";

export const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const MAX_BODY_LENGTH = 1_000_000;

/** Who may call (owner or team) — or the response to send back. State-changing calls must be same-origin. */
export async function requireTeam(request: Request, write = false): Promise<{ role: TeamRole } | { response: Response }> {
  if (write && !isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  let role: TeamRole | null;
  try {
    role = await teamRole(request);
  } catch {
    return { response: json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نتأكد دلوقتي. جرب تاني." } }) };
  }
  if (!role) return { response: json(401, { success: false, error: { code: "UNAUTHORIZED", message: "سجّل دخول تاني." } }) };
  return { role };
}

export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return json(413, { success: false, error: { code: "TOO_LARGE", message: "الصورة كبيرة. جرب صورة تانية." } });
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : json(400, { success: false, error: { code: "INVALID_JSON" } });
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
}

export function storageError(scope: string, error: unknown) {
  console.error(`[team] ${scope} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جرب تاني." } });
}
