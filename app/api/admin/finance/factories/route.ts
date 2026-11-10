import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { addFactory } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Adds a factory name to the list. Body: { name }. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let name = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (name.length < 2) return json(400, { success: false, error: { code: "INVALID_NAME", message: "اكتبي اسم المصنع." } });
  try {
    return (await addFactory(name)) ? json(200, { success: true, name }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش." } });
  } catch (error) {
    console.error("[admin] factory add failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي." } });
  }
}
