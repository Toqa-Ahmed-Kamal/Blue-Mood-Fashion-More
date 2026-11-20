import { revalidateTag } from "next/cache";

import { imagePath, imageTypeOf, newImageId, newProductId, sanitizeProductInput, toCatalogProduct } from "@/lib/custom-products";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, saveCustomProduct } from "@/lib/custom-products-store";
import { json, readJson, requireTeam, storageError } from "@/lib/team-api";

export const runtime = "nodejs";

/**
 * Adds a product from the team page. Body: { name, category, price, imageAlt, maxWeightKg, image (base64) }.
 * From the team account it waits for the owner's approval (hidden until then); from the owner it is a regular live product.
 */
export async function POST(request: Request) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const checked = sanitizeProductInput({ ...body, hidden: false });
  if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_PRODUCT", message: checked.error } });
  const imageData = typeof body.image === "string" ? body.image : "";
  const imageType = imageTypeOf(imageData);
  if (!imageType) return json(400, { success: false, error: { code: "INVALID_IMAGE", message: "ارفع صورة المنتج (JPG أو PNG أو WebP)." } });
  try {
    await ensureCustomProducts(true);
    const id = newProductId(checked.input.category);
    const imageId = newImageId();
    const team = auth.role === "team";
    const product = toCatalogProduct(id, checked.input, imagePath(imageId), team ? { addedBy: "team", pending: true } : {});
    const saved = await saveCustomProduct(product, { id: imageId, type: imageType, data: imageData });
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جرب تاني." } });
    await ensureCustomProducts(true);
    if (!team) revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    console.info("[team] product added", { id, by: auth.role });
    return json(200, { success: true, product: { id: saved.id } });
  } catch (error) {
    return storageError("product add", error);
  }
}
