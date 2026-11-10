import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { CUSTOM_PRODUCT_ID_PATTERN, imagePath, imageTypeOf, newImageId, sanitizeProductInput, toCatalogProduct } from "@/lib/custom-products";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, loadCustomProduct, saveCustomProduct } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY_LENGTH = 1_000_000;

/**
 * Edits an admin-added product (built-in products live in the code). Body: the product fields, and
 * optionally a new `image` (base64). The product ID never changes, so past orders stay linked.
 */
export async function PATCH(request: Request, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  if (!CUSTOM_PRODUCT_ID_PATTERN.test(productId)) return json(400, { success: false, error: { code: "NOT_EDITABLE", message: "المنتج ده من منتجات الموقع الأساسية ومش بيتعدل من هنا." } });
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

  try {
    const current = await loadCustomProduct(productId);
    if (!current) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
    if (checked.input.category !== current.category) return json(400, { success: false, error: { code: "CATEGORY_FIXED", message: "القسم مش بيتغير بعد الإضافة (الكود مربوط بيه)." } });
    let image: { id: string; type: string; data: string } | undefined;
    if (typeof body.image === "string" && body.image) {
      const type = imageTypeOf(body.image);
      if (!type) return json(400, { success: false, error: { code: "INVALID_IMAGE", message: "الصورة لازم تبقى JPG أو PNG أو WebP." } });
      image = { id: newImageId(), type, data: body.image };
    }
    const product = toCatalogProduct(productId, checked.input, image ? imagePath(image.id) : current.image);
    const saved = await saveCustomProduct(product, image);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true, product: saved });
  } catch (error) {
    console.error("[admin] product update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
