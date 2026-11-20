import { revalidateTag } from "next/cache";

import { BUNDLE_ID_PATTERN, sanitizeBundleInput } from "@/lib/bundles";
import { deleteBundle, loadBundle, saveBundle } from "@/lib/bundles-store";
import { CUSTOM_PRODUCTS_TAG, ensureCustomProducts } from "@/lib/custom-products-store";
import { json, readJson, requireTeam, storageError } from "@/lib/team-api";
import type { TeamRole } from "@/lib/team-auth";

export const runtime = "nodejs";

type Context = { params: Promise<{ bundleId: string }> };

/** The bundle, or the response to send. The team account reaches only the bundles it made; the owner, all. */
async function reachable(context: Context, role: TeamRole) {
  const { bundleId } = await context.params;
  const bundle = BUNDLE_ID_PATTERN.test(bundleId) ? await loadBundle(bundleId) : null;
  if (!bundle || (role === "team" && bundle.addedBy !== "team")) return json(404, { success: false, error: { code: "NOT_FOUND", message: "العرض مش موجود." } });
  return bundle;
}

/** Edits a bundle. From the team account it waits for the owner's approval again (off the store until then). */
export async function PATCH(request: Request, context: Context) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  try {
    await ensureCustomProducts(true);
    const current = await reachable(context, auth.role);
    if (current instanceof Response) return current;
    const checked = sanitizeBundleInput(body);
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_BUNDLE", message: checked.error } });
    const saved = await saveBundle({ ...current, ...checked.input, status: auth.role === "team" ? "pending" : current.status, updatedAt: new Date().toISOString() });
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جرب تاني." } });
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true, bundle: saved });
  } catch (error) {
    return storageError("bundle edit", error);
  }
}

/** Deletes a bundle (orders keep their own copy of the pieces and prices). */
export async function DELETE(request: Request, context: Context) {
  const auth = await requireTeam(request, true);
  if ("response" in auth) return auth.response;
  try {
    const current = await reachable(context, auth.role);
    if (current instanceof Response) return current;
    await deleteBundle(current.id);
    await ensureCustomProducts(true);
    revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
    return json(200, { success: true });
  } catch (error) {
    return storageError("bundle delete", error);
  }
}
