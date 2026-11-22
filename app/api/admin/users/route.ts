import { isSameOrigin } from "@/lib/admin-auth";
import {
  ADMIN_PERMISSIONS,
  MAX_USERS,
  accessDenied,
  checkPassword,
  checkUsername,
  cleanName,
  cleanPermissions,
  hashUserPassword,
  loadUsers,
  newUserId,
  normalizeUsername,
  publicUser,
  saveUser,
} from "@/lib/admin-users";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (error: unknown) => {
  console.error("[admin] users update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
};

/** Dashboard users and the sections they can open (owner only). */
export async function GET(request: Request) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  try {
    return json(200, { success: true, users: (await loadUsers()).map(publicUser), permissions: ADMIN_PERMISSIONS });
  } catch (error) {
    return failed(error);
  }
}

/** Adds a user. Body: { name, username, password, permissions: string[] }. */
export async function POST(request: Request) {
  const denied = await accessDenied(request, "owner");
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const problem = checkUsername(body.username) ?? checkPassword(body.password);
  if (problem) return json(400, { success: false, error: { code: "INVALID_USER", message: problem } });
  const username = normalizeUsername(body.username);
  try {
    const users = await loadUsers();
    if (users.length >= MAX_USERS) return json(400, { success: false, error: { code: "TOO_MANY", message: `أقصى عدد ${MAX_USERS} مستخدم.` } });
    if (users.some((user) => user.username === username)) return json(409, { success: false, error: { code: "TAKEN", message: "اسم الدخول ده مستخدم قبل كده. اختاري اسم تاني." } });
    const now = new Date().toISOString();
    const user = {
      id: newUserId(),
      username,
      name: cleanName(body.name) || username,
      passwordHash: hashUserPassword(body.password as string),
      permissions: cleanPermissions(body.permissions),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await saveUser(user))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, user: publicUser(user) });
  } catch (error) {
    return failed(error);
  }
}
