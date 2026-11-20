import { revalidateTag } from "next/cache";

import { CUSTOM_PRODUCT_ID_PATTERN, imagePath, imageTypeOf, inputOf, newImageId, sanitizeProductInput, toCatalogProduct } from "@/lib/custom-products";
import { CUSTOM_PRODUCTS_TAG, deleteCustomProduct, ensureCustomProducts, loadCustomProduct, saveCustomProduct } from "@/lib/custom-products-store";
import { json, readJson, requireTeam, storageError } from "@/lib/team-api";

export const runtime = "nodejs";

type Context = { params: Promise<{ productId: string }> };

/** The team product, or the response to send (only products added from the team page, not removed). */
async function ownProduct(context: Context) {
  const { productId } = await context.params;
  if (!CUSTOM_PRODUCT_ID_PATTERN.test(productId)) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
  const product = await loadCustomProduct(productId);
  if (!product || product.addedBy !== "team" || product.removed) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
  return product;
}

/** Edits a team product. From the team account the change waits for the owner's approval again (hidden until then). */
export async function PATCH(request: Request, context: Context) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  try {
    const current = await ownProduct(context);
    if (current instanceof Response) return current;
    const checked = sanitizeProductInput({ ...body, category: current.category, hidden: false });
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_PRODUCT", message: checked.error } });
    let image: { id: string; type: string; data: string } | undefined;
    if (typeof body.image === "string" && body.image) {
      const type = imageTypeOf(body.image);
      if (!type) return json(400, { success: false, error: { code: "INVALID_IMAGE", message: "الصورة لازم تبقى JPG أو PNG أو WebP." } });
      image = { id: newImageId(), type, data: body.image };
    }
    const team = auth.role === "team";
    const product = toCatalogProduct(current.id, checked.input, image ? imagePath(image.id) : current.image, {
      addedBy: "team",
      ...(current.approved || !team ? { approved: true } : {}),
      ...(team ? { pending: true } : {}),
    });
    const saved = await saveCustomProduct(product, image);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جرب تاني." } });
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true });
  } catch (error) {
    return storageError("product edit", error);
  }
}

/**
 * Removes a team product. Never approved → deleted with its photo. Approved before (it may be in orders) →
 * hidden from the store and from the team page, kept for past orders.
 */
export async function DELETE(request: Request, context: Context) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  try {
    const current = await ownProduct(context);
    if (current instanceof Response) return current;
    if (!current.approved) {
      if (!(await deleteCustomProduct(current))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "المسح ما اتأكدش. جرب تاني." } });
    } else {
      const saved = await saveCustomProduct(toCatalogProduct(current.id, inputOf(current), current.image, { addedBy: "team", approved: true, removed: true }));
      if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "المسح ما اتأكدش. جرب تاني." } });
    }
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true });
  } catch (error) {
    return storageError("product delete", error);
  }
}
