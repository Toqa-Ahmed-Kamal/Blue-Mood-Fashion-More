import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { saveSoldBefore } from "@/lib/inventory-store";
import { RedisUnavailableError } from "@/lib/redis";
import { findProduct } from "@/lib/site-data";
import { syncStoreStock } from "@/lib/stock-sync";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Pieces of a product sold before the store's system (typed in by the owner). Added to the system's own sales
 * in "اتباع منها" on the store; not used by the inventory or the finance. Body: { count: number | null }.
 */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let raw: unknown;
  try {
    raw = ((await request.json()) as Record<string, unknown>).count;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const count = raw === null || raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > 100_000) return json(400, { success: false, error: { code: "INVALID_VALUE", message: "اكتبي رقم صحيح (صفر أو أكتر)." } });
  try {
    await ensureCustomProducts();
    if (!findProduct(productId)) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
    const stored = await saveSoldBefore(productId, count || null);
    if (stored !== count) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    // Store numbers (sold, best seller) follow right away.
    await syncStoreStock();
    return json(200, { success: true, productId, soldBefore: stored });
  } catch (error) {
    console.error("[admin] sold-before update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
