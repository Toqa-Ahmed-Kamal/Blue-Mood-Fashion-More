import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { parseDepositAmount } from "@/lib/analytics-report";
import { editSiteOrder, isOrderStatus, loadOrderDetails, setOrderDeposit, setOrderStatus } from "@/lib/analytics-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeOrderEdit } from "@/lib/order-edit";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ORDER_ID_PATTERN = /^BM-[A-F\d]{20}$/;

/** Full order for review: customer details (decrypted on the server), items, totals, source and journey. Read-only token. */
export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  const { orderId } = await context.params;
  if (!ORDER_ID_PATTERN.test(orderId)) return json(400, { success: false, error: { code: "INVALID_ORDER_ID" } });

  try {
    const view = await loadOrderDetails(orderId);
    if (!view) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
    return json(200, { success: true, ...view, vaultConfigured: isOrderVaultConfigured() });
  } catch (error) {
    console.error("[admin] order details read failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نقرا الطلب دلوقتي. جربي تاني." } });
  }
}

/** Marks an order as confirmed sale / cancelled / back to submitted. Uses the write token. */
export async function PATCH(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });

  const { orderId } = await context.params;
  if (!ORDER_ID_PATTERN.test(orderId)) return json(400, { success: false, error: { code: "INVALID_ORDER_ID" } });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  // Edit: { edit: { customer fields, lines, offerPrice, shippingCost, offerName } }.
  if (body.edit !== undefined) {
    await ensureCustomProducts();
    const checked = sanitizeOrderEdit(body.edit);
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_EDIT", message: checked.error } });
    try {
      const order = await editSiteOrder(orderId, checked.edit);
      if (order === "no_key") return json(503, { success: false, error: { code: "ORDER_DATA_KEY_MISSING", message: "لازم ORDER_DATA_KEY يبقى متضاف علشان نحفظ بيانات العميلة." } });
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      console.info("[admin] order edited", { orderId, lines: order.products.length });
      return json(200, { success: true, order: { orderId: order.orderId, status: order.status, total: order.total, editedAt: order.editedAt } });
    } catch (error) {
      console.error("[admin] order edit failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  // Deposit only: { deposit: amount | null }.
  if (body.deposit !== undefined && body.status === undefined) {
    const amount = parseDepositAmount(body.deposit);
    if (amount === undefined) return json(400, { success: false, error: { code: "INVALID_DEPOSIT", message: "مبلغ الديبوزيت لازم يبقى رقم أكبر من صفر." } });
    try {
      const order = await setOrderDeposit(orderId, amount);
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      return json(200, { success: true, order: { orderId: order.orderId, deposit: order.deposit ?? null } });
    } catch (error) {
      console.error("[admin] order deposit update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  if (!isOrderStatus(body.status)) return json(400, { success: false, error: { code: "INVALID_STATUS" } });

  let confirmedValue: number | null = null;
  if (body.status === "confirmed" && body.confirmedValue !== undefined && body.confirmedValue !== null && body.confirmedValue !== "") {
    const value = Number(body.confirmedValue);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return json(400, { success: false, error: { code: "INVALID_VALUE", message: "القيمة مش صحيحة." } });
    confirmedValue = Math.round(value);
  }

  try {
    const order = await setOrderStatus(orderId, body.status, confirmedValue);
    if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
    return json(200, { success: true, order: { orderId: order.orderId, status: order.status, statusAt: order.statusAt, confirmedValue: order.confirmedValue } });
  } catch (error) {
    console.error("[admin] order status update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
  }
}
