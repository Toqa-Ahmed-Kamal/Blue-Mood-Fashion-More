import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeDirectSale } from "@/lib/direct-sales";
import { deleteDirectSale, loadDirectSale, loadProductCosts, saveDirectSale } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

type Context = { params: Promise<{ saleId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const NOT_FOUND = { success: false, error: { code: "NOT_FOUND", message: "البيعة دي مش موجودة." } };

async function guard(request: Request, context: Context) {
  if (!isAdminRequest(request)) return { response: unauthorized() };
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
    const result = sanitizeDirectSale(body, current.id, await loadProductCosts(), new Date(), current.createdAt);
    if ("error" in result) return json(400, { success: false, error: { code: "INVALID_SALE", message: result.error } });
    const saved = await saveDirectSale(result.sale);
    return saved ? json(200, { success: true, sale: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    return storageError(error, "update");
  }
}

export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    return (await deleteDirectSale(checked.saleId)) ? json(200, { success: true }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "delete");
  }
}
