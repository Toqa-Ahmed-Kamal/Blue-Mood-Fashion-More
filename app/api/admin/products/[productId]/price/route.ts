import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, loadCustomProduct, saveCustomProduct, setProductPrice, setProductWasPrice } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";
import { basePriceOf, findProduct, isBuiltInProduct, priceOf, wasPriceOf } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_PRICE = 100_000;

/**
 * Changes the selling price customers see for one product. Body: { price: number | null, was?: number | null }.
 * price null = back to the original price. was = price before the discount ("بدل كذا"), null = no discount.
 * Orders already placed keep the price they were placed with.
 */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const raw = body.price;
  const hasWas = body.was !== undefined;
  const was = body.was === null || body.was === "" || !hasWas ? null : Number(body.was);
  if (was !== null && (!Number.isInteger(was) || was < 1 || was > MAX_PRICE)) {
    return json(400, { success: false, error: { code: "INVALID_WAS_PRICE", message: "السعر قبل الخصم لازم يبقى رقم صحيح أكبر من صفر." } });
  }
  const price = raw === null ? null : Number(raw);
  if (price !== null && (!Number.isInteger(price) || price < 1 || price > MAX_PRICE)) {
    return json(400, { success: false, error: { code: "INVALID_PRICE", message: "سعر البيع لازم يبقى رقم صحيح أكبر من صفر." } });
  }
  try {
    await ensureCustomProducts();
    const product = findProduct(productId);
    if (!product) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });

    const finalPrice = price ?? basePriceOf(product);
    if (was !== null && finalPrice !== null && was <= finalPrice) {
      return json(400, { success: false, error: { code: "WAS_NOT_HIGHER", message: "السعر قبل الخصم لازم يبقى أكبر من سعر البيع." } });
    }

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

    if (hasWas) {
      const storedWas = await setProductWasPrice(productId, was);
      if (storedWas !== was) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    }

    await ensureCustomProducts(true);
    // Store pages show the new price on their next visit.
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    const updated = findProduct(productId)!;
    console.info("[admin] selling price changed", { productId, price: priceOf(updated), was: wasPriceOf(updated) });
    return json(200, { success: true, productId, price: priceOf(updated), basePrice: basePriceOf(updated), wasPrice: wasPriceOf(updated) });
  } catch (error) {
    console.error("[admin] price update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
