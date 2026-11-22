import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeDirectSale } from "@/lib/direct-sales";
import { deleteDirectSale, loadDirectSale, loadProductCosts, saveDirectSale } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";
import { syncStoreStock } from "@/lib/stock-sync";

export const runtime = "nodejs";

type Context = { params: Promise<{ saleId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const NOT_FOUND = { success: false, error: { code: "NOT_FOUND", message: "البيعة دي مش موجودة." } };

async function guard(request: Request, context: Context) {
  const denied = await accessDenied(request, ["money"]);
  if (denied) return { response: denied };
  if (!isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  const { saleId } = await context.params;
  if (!ID_PATTERN.test(saleId)) return { response: json(400, { success: false, error: { code: "INVALID_ID" } }) };
  return { saleId };
}

function storageError(error: unknown, action: string) {
  console.error(`[admin] direct sale ${action} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
}

/** Edits a direct sale (full copy). */
export async function PATCH(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  try {
    const current = await loadDirectSale(checked.saleId);
    if (!current) return json(404, NOT_FOUND);
    await ensureCustomProducts();
    // A sale stays a sale and a personal take stays one.
    const result = sanitizeDirectSale(typeof body === "object" && body !== null ? { ...body, kind: current.kind ?? "sale" } : body, current.id, await loadProductCosts(), new Date(), current.createdAt);
    if ("error" in result) return json(400, { success: false, error: { code: "INVALID_SALE", message: result.error } });
    const saved = await saveDirectSale(result.sale);
    if (saved) await syncStoreStock();
    return saved ? json(200, { success: true, sale: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    return storageError(error, "update");
  }
}

export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    const removed = await deleteDirectSale(checked.saleId);
    if (removed) await syncStoreStock();
    return removed ? json(200, { success: true }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "delete");
  }
}
