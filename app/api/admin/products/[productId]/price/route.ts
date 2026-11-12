import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, loadCustomProduct, saveCustomProduct, setProductPrice } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";
import { basePriceOf, findProduct, isBuiltInProduct, priceOf } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_PRICE = 100_000;

/**
 * Changes the selling price customers see for one product. Body: { price: number | null }.
 * null = back to the original price. Orders already placed keep the price they were placed with.
 */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let raw: unknown;
  try {
    raw = ((await request.json()) as Record<string, unknown>).price;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const price = raw === null ? null : Number(raw);
  if (price !== null && (!Number.isInteger(price) || price < 1 || price > MAX_PRICE)) {
    return json(400, { success: false, error: { code: "INVALID_PRICE", message: "سعر البيع لازم يبقى رقم صحيح أكبر من صفر." } });
  }
  try {
    await ensureCustomProducts();
    const product = findProduct(productId);
    if (!product) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });

    if (isBuiltInProduct(productId)) {
      if (basePriceOf(product) === null) return json(400, { success: false, error: { code: "OFFER_ONLY", message: "المنتج ده بيتباع ضمن العرض بس، مالوش سعر قطعة." } });
      // Saving the original price is the same as going back to it.
      const wanted = price === basePriceOf(product) ? null : price;
      const stored = await setProductPrice(productId, wanted);
      if (stored !== wanted) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    } else {
      // An added product keeps its price with the product itself (same field as "تعديل المنتج").
      const saved = await loadCustomProduct(productId);
      if (!saved) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
      const { price: _old, ...rest } = saved;
      void _old;
      const stored = await saveCustomProduct(price === null ? rest : { ...rest, price });
      if (!stored || (stored.price ?? null) !== price) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    }

    await ensureCustomProducts(true);
    // Store pages show the new price on their next visit.
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    const updated = findProduct(productId)!;
    console.info("[admin] selling price changed", { productId, price: priceOf(updated) });
    return json(200, { success: true, productId, price: priceOf(updated), basePrice: basePriceOf(updated) });
  } catch (error) {
    console.error("[admin] price update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
