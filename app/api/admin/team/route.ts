import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { RedisUnavailableError } from "@/lib/redis";
import { checkTeamPasswordRules, loadTeamPasswordHash, setTeamPassword } from "@/lib/team-auth";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (error: unknown) => {
  console.error("[admin] team account update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
};

/** Is the team account ("ادمن اكونت") on? */
export async function GET(request: Request) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return denied;
  try {
    return json(200, { success: true, enabled: (await loadTeamPasswordHash()) !== null });
  } catch (error) {
    return failed(error);
  }
}

/** Sets (or changes) the team password. Body: { password }. Changing it signs the team out everywhere. */
export async function PUT(request: Request) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let password: unknown;
  try {
    password = ((await request.json()) as Record<string, unknown>).password;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const problem = checkTeamPasswordRules(password);
  if (problem) return json(400, { success: false, error: { code: "WEAK_PASSWORD", message: problem } });
  try {
    if (!(await setTeamPassword(password as string))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, enabled: true });
  } catch (error) {
    return failed(error);
  }
}

/** Turns the team account off (signs it out everywhere). */
export async function DELETE(request: Request) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  try {
    if (!(await setTeamPassword(null))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, enabled: false });
  } catch (error) {
    return failed(error);
  }
}
