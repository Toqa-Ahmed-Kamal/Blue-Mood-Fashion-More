import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { parseCancelReason, parseCourierChange, parseDepositAmount } from "@/lib/analytics-report";
import { editSiteOrder, isOrderStatus, loadOrderDetails, setOrderCancelReason, setOrderCourier, setOrderDeposit, setOrderReturns, setOrderShipment, setOrderStatus } from "@/lib/analytics-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeOrderEdit } from "@/lib/order-edit";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { syncStoreStock } from "@/lib/stock-sync";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ORDER_ID_PATTERN = /^BM-[A-F\d]{20}$/;

/** Full order for review: customer details (decrypted on the server), items, totals, source and journey. Read-only token. */
export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const denied = await accessDenied(request, ["orders"]);
  if (denied) return denied;
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
  const denied = await accessDenied(request, ["orders"]);
  if (denied) return denied;
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
      await syncStoreStock();
      return json(200, { success: true, order: { orderId: order.orderId, status: order.status, total: order.total, editedAt: order.editedAt } });
    } catch (error) {
      console.error("[admin] order edit failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  // Pieces she gave back: { returns: [{ id?, modelId, quantity, amount, state, note }] } (the full list).
  if (body.returns !== undefined) {
    try {
      const order = await setOrderReturns(orderId, body.returns);
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      if (order === "not_sold") return json(409, { success: false, error: { code: "NOT_SOLD", message: "المرتجع بيتسجل للأوردر المؤكد أو اللي اتسلم بس." } });
      if ("error" in order) return json(400, { success: false, error: { code: "INVALID_RETURNS", message: order.error } });
      await syncStoreStock();
      return json(200, { success: true, order: { orderId: order.orderId, returns: order.returns ?? [] } });
    } catch (error) {
      console.error("[admin] order returns update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  // Shipping company box: { shipment: { company, tracking, charges: [{ id?, kind, amount, note }], collected } | null }.
  if (body.shipment !== undefined) {
    try {
      const order = await setOrderShipment(orderId, body.shipment);
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      if ("error" in order) return json(400, { success: false, error: { code: "INVALID_SHIPMENT", message: order.error } });
      return json(200, { success: true, order: { orderId: order.orderId, shipment: order.shipment ?? null } });
    } catch (error) {
      console.error("[admin] order shipment update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  // Shipping company step only: { courier: { step: "notified" | "handed", done } }.
  if (body.courier !== undefined) {
    const change = parseCourierChange(body.courier);
    if (!change) return json(400, { success: false, error: { code: "INVALID_COURIER" } });
    try {
      const order = await setOrderCourier(orderId, change.step, change.done);
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      return json(200, { success: true, order: { orderId: order.orderId, courier: order.courier ?? null } });
    } catch (error) {
      console.error("[admin] order courier update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
      return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
    }
  }
  // Cancel reason only (cancelled orders): { cancelReason: id | null }.
  if (body.cancelReason !== undefined && body.status === undefined) {
    const reason = parseCancelReason(body.cancelReason);
    if (reason === undefined) return json(400, { success: false, error: { code: "INVALID_REASON", message: "اختاري سبب من القايمة." } });
    try {
      const order = await setOrderCancelReason(orderId, reason);
      if (order === "not_cancelled") return json(409, { success: false, error: { code: "NOT_CANCELLED", message: "سبب الإلغاء بيتحدد للأوردر الملغي بس." } });
      if (!order) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الطلب مش موجود." } });
      return json(200, { success: true, order: { orderId: order.orderId, cancelReason: order.cancelReason ?? null } });
    } catch (error) {
      console.error("[admin] order cancel reason update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
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
    await syncStoreStock();
    return json(200, { success: true, order: { orderId: order.orderId, status: order.status, statusAt: order.statusAt, confirmedValue: order.confirmedValue } });
  } catch (error) {
    console.error("[admin] order status update failed", { orderId, reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحفظ دلوقتي. جربي تاني." } });
  }
}
