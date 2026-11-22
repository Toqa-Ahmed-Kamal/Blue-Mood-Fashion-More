import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied, checkPassword, cleanName, cleanPermissions, deleteUser, hashUserPassword, loadUser, publicUser, saveUser } from "@/lib/admin-users";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

type Context = { params: Promise<{ userId: string }> };
const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (error: unknown) => {
  console.error("[admin] user update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
};

/**
 * Changes a user (owner only). Body: any of { name, permissions, active, password }.
 * A new password or turning the user off signs them out everywhere; new sections apply at once.
 */
export async function PATCH(request: Request, context: Context) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { userId } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (body.password !== undefined) {
    const problem = checkPassword(body.password);
    if (problem) return json(400, { success: false, error: { code: "WEAK_PASSWORD", message: problem } });
  }
  try {
    const user = await loadUser(userId);
    if (!user) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المستخدم مش موجود." } });
    const next = {
      ...user,
      ...(body.name !== undefined ? { name: cleanName(body.name) || user.username } : {}),
      ...(body.permissions !== undefined ? { permissions: cleanPermissions(body.permissions) } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      ...(body.password !== undefined ? { passwordHash: hashUserPassword(body.password as string) } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (!(await saveUser(next))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, user: publicUser(next) });
  } catch (error) {
    return failed(error);
  }
}

/** Deletes a user (signs them out everywhere). */
export async function DELETE(request: Request, context: Context) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { userId } = await context.params;
  try {
    if (!(await deleteUser(userId))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحذف ما اتأكدش. جربي تاني." } });
    return json(200, { success: true });
  } catch (error) {
    return failed(error);
  }
}
