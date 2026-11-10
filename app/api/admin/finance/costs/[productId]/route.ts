import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { sanitizeProductCost } from "@/lib/finance";
import { saveProductCost } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Saves a catalog product's factory name and factory price per piece. Body: { factory, cost }. */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const cost = sanitizeProductCost(productId, body);
  if (!cost) return json(400, { success: false, error: { code: "INVALID_COST", message: "راجعي المنتج وسعر المصنع (رقم موجب أو فاضي)." } });
  try {
    const saved = await saveProductCost(cost);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, cost: saved });
  } catch (error) {
    console.error("[admin] product cost save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
