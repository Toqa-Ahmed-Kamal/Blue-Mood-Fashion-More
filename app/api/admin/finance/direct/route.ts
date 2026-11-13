import { randomUUID } from "node:crypto";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeDirectSale } from "@/lib/direct-sales";
import { loadProductCosts, saveDirectSale } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Adds a direct sale (friends and family). Body: { date, buyer, lines: [{ productId, name, quantity, unitPrice, unitCost }], extraCost, notes }. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  try {
    await ensureCustomProducts();
    const checked = sanitizeDirectSale(body, randomUUID(), await loadProductCosts());
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_SALE", message: checked.error } });
    const saved = await saveDirectSale(checked.sale);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, sale: saved });
  } catch (error) {
    console.error("[admin] direct sale save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
