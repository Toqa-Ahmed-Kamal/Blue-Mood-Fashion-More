import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { MAX_OLD_ORDERS_PER_REQUEST, sanitizeOldOrder } from "@/lib/old-orders";
import { OldOrdersNotPersistedError, VaultNotConfiguredError, importOldOrders, loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { ensureCustomProducts } from "@/lib/custom-products-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY_LENGTH = 400_000;
const NO_KEY = { success: false, error: { code: "ORDER_DATA_KEY_MISSING", message: "لازم ORDER_DATA_KEY يبقى متضاف على Vercel علشان نحفظ بيانات العميلات متشفرة." } };

/** All saved old orders (decrypted on the server). */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isOrderVaultConfigured()) return json(503, NO_KEY);
  try {
    const { orders, unreadable } = await loadOldOrders();
    return json(200, { success: true, orders, unreadable });
  } catch (error) {
    console.error("[admin] old orders read failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نقرا الأوردرات القديمة دلوقتي. جربي تاني." } });
  }
}

/** Imports orders read from a Telegram export. Order IDs already saved are skipped. No message is sent to anyone. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  if (!isOrderVaultConfigured()) return json(503, NO_KEY);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return json(413, { success: false, error: { code: "TOO_LARGE", message: "الدفعة كبيرة. ابعتي أوردرات أقل مرة واحدة." } });
    body = JSON.parse(text);
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).orders : null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OLD_ORDERS_PER_REQUEST) {
    return json(400, { success: false, error: { code: "INVALID_ORDERS", message: "مفيش أوردرات صالحة في الطلب." } });
  }
  const orders = raw.map((item) => sanitizeOldOrder(item));
  const invalid = orders.flatMap((order, index) => (order ? [] : [index]));
  if (invalid.length > 0) {
    return json(400, { success: false, error: { code: "INVALID_ORDERS", message: `فيه ${invalid.length} أوردر ناقص رقم الطلب أو التاريخ.` } });
  }

  try {
    await ensureCustomProducts();
    const result = await importOldOrders(orders.filter((order) => order !== null));
    // Visible in the Vercel logs: proof that an import reached storage (IDs only, no customer data).
    console.info("[admin] old orders imported", { imported: result.imported.length, duplicates: result.duplicates.length, backfilled: result.backfilled.length, totalSaved: result.totalSaved });
    return json(200, { success: true, ...result });
  } catch (error) {
    if (error instanceof VaultNotConfiguredError) return json(503, NO_KEY);
    if (error instanceof OldOrdersNotPersistedError) {
      console.error("[admin] old orders not persisted after write", { missing: error.missing.length });
      return json(502, { success: false, error: { code: "NOT_PERSISTED", message: `الحفظ ما اتأكدش: ${error.missing.length} أوردر مش موجودين في قاعدة البيانات بعد الحفظ. ما تقفليش الصفحة وجربي تاني.` } });
    }
    console.error("[admin] old orders import failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
