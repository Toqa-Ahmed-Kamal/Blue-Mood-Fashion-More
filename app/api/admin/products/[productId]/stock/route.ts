import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, setProductSoldOut } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";
import { findProduct } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Marks any catalog product (built-in or added) as sold out, or available again. Body: { soldOut: boolean }. */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let soldOut: unknown;
  try {
    soldOut = ((await request.json()) as Record<string, unknown>).soldOut;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (typeof soldOut !== "boolean") return json(400, { success: false, error: { code: "INVALID_VALUE" } });
  try {
    await ensureCustomProducts();
    if (!findProduct(productId)) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
    const stored = await setProductSoldOut(productId, soldOut);
    if (stored !== soldOut) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    await ensureCustomProducts(true);
    // Store pages show the change on their next visit.
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true, productId, soldOut });
  } catch (error) {
    console.error("[admin] sold-out update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
