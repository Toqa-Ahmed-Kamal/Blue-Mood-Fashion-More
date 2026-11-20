import { revalidateTag } from "next/cache";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { BUNDLE_ID_PATTERN, bundleChoices } from "@/lib/bundles";
import { deleteBundle, loadBundle, loadBundles, saveBundle } from "@/lib/bundles-store";
import { CUSTOM_PRODUCT_ID_PATTERN, inputOf, toCatalogProduct } from "@/lib/custom-products";
import { CUSTOM_PRODUCTS_TAG, deleteCustomProduct, ensureCustomProducts, loadCustomProduct, saveCustomProduct } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";
import { catalog, findProduct, priceOf } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Everything waiting for the owner, plus all bundles (to manage them). */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    await ensureCustomProducts(true);
    const bundles = await loadBundles();
    const pieceView = (id: string) => {
      const product = findProduct(id);
      return { id, name: product?.name ?? id, image: product?.image ?? null, price: product ? priceOf(product) : null, available: Boolean(product && !product.hidden) };
    };
    return json(200, {
      success: true,
      products: catalog.filter((product) => product.pending).map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        image: product.image,
        imageAlt: product.imageAlt,
        price: priceOf(product),
        maxWeightKg: product.maxWeightKg ?? null,
        edited: Boolean(product.approved),
      })),
      bundles: bundles.map((bundle) => ({ ...bundle, pieces: bundle.productIds.map(pieceView), orderableNow: bundle.kind === "fixed" ? bundleChoices(bundle).length === bundle.productIds.length : bundleChoices(bundle).length >= bundle.pickCount })),
    });
  } catch (error) {
    console.error("[admin] approvals load failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نجيب البيانات دلوقتي. جربي تاني." } });
  }
}

/**
 * Body: { type: "product" | "bundle", id, action: "approve" | "reject" | "stop" }.
 * Product: approve → on the store; reject → deleted if it was never approved, else stays hidden.
 * Bundle: approve → on the store; reject → deleted; stop → off the store (back to waiting).
 */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const { type, id, action } = body;
  if (typeof id !== "string" || (action !== "approve" && action !== "reject" && action !== "stop")) return json(400, { success: false, error: { code: "INVALID_ACTION" } });
  const notFound = () => json(404, { success: false, error: { code: "NOT_FOUND", message: "مش موجود." } });
  try {
    if (type === "product") {
      if (!CUSTOM_PRODUCT_ID_PATTERN.test(id)) return notFound();
      const product = await loadCustomProduct(id);
      if (!product || !product.pending) return notFound();
      if (action === "approve") {
        const saved = await saveCustomProduct(toCatalogProduct(id, { ...inputOf(product), hidden: false }, product.image, { addedBy: "team", approved: true }));
        if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
      } else if (!product.approved) {
        await deleteCustomProduct(product);
      } else {
        // An approved product whose change was refused: kept hidden (it may be in past orders).
        const saved = await saveCustomProduct(toCatalogProduct(id, { ...inputOf(product), hidden: true }, product.image, { addedBy: "team", approved: true }));
        if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
      }
    } else if (type === "bundle") {
      if (!BUNDLE_ID_PATTERN.test(id)) return notFound();
      const bundle = await loadBundle(id);
      if (!bundle) return notFound();
      if (action === "reject") await deleteBundle(id);
      else {
        const saved = await saveBundle({ ...bundle, status: action === "approve" ? "live" : "pending", updatedAt: new Date().toISOString() });
        if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
      }
    } else {
      return json(400, { success: false, error: { code: "INVALID_ACTION" } });
    }
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true });
  } catch (error) {
    console.error("[admin] approval failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
