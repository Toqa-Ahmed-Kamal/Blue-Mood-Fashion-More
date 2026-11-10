import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { imagePath, imageTypeOf, newImageId, newProductId, sanitizeProductInput, toCatalogProduct } from "@/lib/custom-products";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, saveCustomProduct } from "@/lib/custom-products-store";
import { sanitizeProductCost } from "@/lib/finance";
import { saveProductCost } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY_LENGTH = 1_000_000;

/**
 * Adds a product to the store. Body: { name, category, price, imageAlt, maxWeightKg, hidden,
 * image: base64 JPEG/PNG/WebP (resized in the browser), factory, cost }.
 */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return json(413, { success: false, error: { code: "TOO_LARGE", message: "الصورة كبيرة. جربي صورة تانية." } });
    body = JSON.parse(text);
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const checked = sanitizeProductInput(body);
  if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_PRODUCT", message: checked.error } });
  const imageData = typeof body.image === "string" ? body.image : "";
  const imageType = imageTypeOf(imageData);
  if (!imageType) return json(400, { success: false, error: { code: "INVALID_IMAGE", message: "ارفعي صورة المنتج (JPG أو PNG أو WebP)." } });

  try {
    await ensureCustomProducts(true);
    const id = newProductId(checked.input.category);
    const imageId = newImageId();
    const product = toCatalogProduct(id, checked.input, imagePath(imageId));
    const saved = await saveCustomProduct(product, { id: imageId, type: imageType, data: imageData });
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    await ensureCustomProducts(true);
    const cost = sanitizeProductCost(id, { factory: body.factory, cost: body.cost });
    if (cost) await saveProductCost(cost);
    // Store pages pick the new product up on their next visit.
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    console.info("[admin] product added", { id, category: saved.category });
    return json(200, { success: true, product: saved });
  } catch (error) {
    console.error("[admin] product add failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ المنتج دلوقتي. جربي تاني." } });
  }
}
