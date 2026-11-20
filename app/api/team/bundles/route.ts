import { revalidateTag } from "next/cache";

import { newBundleId, sanitizeBundleInput, type Bundle } from "@/lib/bundles";
import { saveBundle } from "@/lib/bundles-store";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts } from "@/lib/custom-products-store";
import { json, readJson, requireTeam, storageError } from "@/lib/team-api";

export const runtime = "nodejs";

/** Adds a bundle. Body: { name, price, kind: "fixed" | "pick", productIds, pickCount }. Team → waits for approval. */
export async function POST(request: Request) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  try {
    await ensureCustomProducts(true);
    const checked = sanitizeBundleInput(body);
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_BUNDLE", message: checked.error } });
    const now = new Date().toISOString();
    const bundle: Bundle = { id: newBundleId(), ...checked.input, status: auth.role === "team" ? "pending" : "live", addedBy: auth.role, createdAt: now, updatedAt: now };
    const saved = await saveBundle(bundle);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جرب تاني." } });
    await ensureCustomProducts(true);
    if (saved.status === "live") revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true, bundle: saved });
  } catch (error) {
    return storageError("bundle add", error);
  }
}
