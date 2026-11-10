import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { liveOrderStates } from "@/lib/analytics-store";
import { OLD_ORDER_ID_PATTERN } from "@/lib/old-orders";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_IDS = 500;

/** Before an import: which order IDs are also dashboard orders, and whether they already have customer details. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });

  let ids: unknown;
  try {
    ids = ((await request.json()) as Record<string, unknown>)?.ids;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (!Array.isArray(ids) || ids.length > MAX_IDS || ids.some((id) => typeof id !== "string" || !OLD_ORDER_ID_PATTERN.test(id))) {
    return json(400, { success: false, error: { code: "INVALID_IDS" } });
  }

  try {
    return json(200, { success: true, live: await liveOrderStates(ids as string[]) });
  } catch (error) {
    console.error("[admin] old orders check failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نراجع الأوردرات دلوقتي." } });
  }
}
