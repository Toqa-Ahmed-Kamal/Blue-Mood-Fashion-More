import { revalidateTag } from "next/cache";

import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts, setProductBigSize } from "@/lib/custom-products-store";
import { RedisUnavailableError } from "@/lib/redis";
import { findProduct } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Adds a product to the store's "بيج سايز" section, or removes it. Body: { bigSize: boolean }. */
export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { productId } = await context.params;
  let bigSize: unknown;
  try {
    bigSize = ((await request.json()) as Record<string, unknown>).bigSize;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (typeof bigSize !== "boolean") return json(400, { success: false, error: { code: "INVALID_VALUE" } });
  try {
    await ensureCustomProducts();
    if (!findProduct(productId)) return json(404, { success: false, error: { code: "NOT_FOUND", message: "المنتج مش موجود." } });
    const stored = await setProductBigSize(productId, bigSize);
    if (stored !== bigSize) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true, productId, bigSize });
  } catch (error) {
    console.error("[admin] big-size update failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
