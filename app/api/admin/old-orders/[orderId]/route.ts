import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { applyCourierStep, isSaleStatus, parseCourierChange, parseDepositAmount } from "@/lib/analytics-report";
import { isOrderStatus } from "@/lib/analytics-store";
import { OLD_ORDER_ID_PATTERN, sanitizeOldOrder } from "@/lib/old-orders";
import { VaultNotConfiguredError, deleteOldOrder, loadOldOrder, updateOldOrder } from "@/lib/old-orders-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { snapshotCosts } from "@/lib/finance";
import { applyEditToOldOrder, sanitizeOrderEdit } from "@/lib/order-edit";
import { productCostsFor } from "@/lib/finance-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const NOT_FOUND = { success: false, error: { code: "NOT_FOUND", message: "الأوردر مش موجود." } };
const NO_KEY = { success: false, error: { code: "ORDER_DATA_KEY_MISSING", message: "لازم ORDER_DATA_KEY يبقى متضاف على Vercel." } };

function storageError(error: unknown, action: string) {
  if (error instanceof VaultNotConfiguredError) return json(503, NO_KEY);
  console.error(`[admin] old order ${action} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
}

async function guard(request: Request, context: Context) {
  if (!isAdminRequest(request)) return { response: unauthorized() };
  if (!isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  if (!isOrderVaultConfigured()) return { response: json(503, NO_KEY) };
  const { orderId } = await context.params;
  if (!OLD_ORDER_ID_PATTERN.test(orderId)) return { response: json(400, { success: false, error: { code: "INVALID_ORDER_ID" } }) };
  return { orderId };
}

/**
 * Edits a saved old order. Body: { order } (full edited copy), or any of { status, archived }.
 * The order ID and import time never change.
 */
export async function PATCH(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  const { orderId } = checked;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }

  try {
    const current = await loadOldOrder(orderId);
    if (!current) return json(404, NOT_FOUND);
    const now = new Date();
    let next = { ...current };
    if (body.order !== undefined) {
      const edited = sanitizeOldOrder({ ...(body.order as object), orderId, importedAt: current.importedAt }, now);
      if (!edited) return json(400, { success: false, error: { code: "INVALID_ORDER", message: "راجعي التاريخ والمنتجات." } });
      next = { ...edited, statusAt: edited.status === current.status ? current.statusAt : now.toISOString() };
    }
    // Edit from "كل الأوردرات": { edit } — pieces chosen from the catalog, totals recalculated.
    if (body.edit !== undefined) {
      await ensureCustomProducts();
      const checked = sanitizeOrderEdit(body.edit);
      if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_EDIT", message: checked.error } });
      next = applyEditToOldOrder(next, checked.edit, now);
    }
    if (body.status !== undefined) {
      if (!isOrderStatus(body.status)) return json(400, { success: false, error: { code: "INVALID_STATUS" } });
      if (body.status !== next.status) next = { ...next, status: body.status, statusAt: now.toISOString() };
    }
    // Deposit: kept through edits; changed only by { deposit: amount | null }.
    let deposit = current.deposit;
    if (body.deposit !== undefined) {
      const amount = parseDepositAmount(body.deposit);
      if (amount === undefined) return json(400, { success: false, error: { code: "INVALID_DEPOSIT", message: "مبلغ الديبوزيت لازم يبقى رقم أكبر من صفر." } });
      deposit = amount === null ? undefined : { amount, at: now.toISOString() };
    }
    // Shipping company steps: kept through edits; changed only by { courier: { step, done } }.
    let courier = current.courier;
    if (body.courier !== undefined) {
      const change = parseCourierChange(body.courier);
      if (!change) return json(400, { success: false, error: { code: "INVALID_COURIER" } });
      courier = applyCourierStep(current.courier, change.step, change.done, now);
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean") return json(400, { success: false, error: { code: "INVALID_ARCHIVED" } });
      next = { ...next, archived: body.archived };
    }
    // Cost snapshot: never sent by the browser. Kept from the first confirmation; taken again only when
    // the pieces themselves were edited (the old snapshot would no longer match the lines).
    const sameLines = JSON.stringify(next.products.map((product) => [product.modelId, product.quantity])) === JSON.stringify(current.products.map((product) => [product.modelId, product.quantity]));
    let costSnapshot = sameLines ? current.costSnapshot : undefined;
    if (!costSnapshot && isSaleStatus(next.status)) {
      const ids = next.products.map((product) => product.modelId);
      costSnapshot = snapshotCosts(ids, await productCostsFor(ids), now);
    }
    // Time it became a sale (inventory): kept while it stays a sale, cleared otherwise. Never from the browser.
    const soldAt = isSaleStatus(next.status) ? (isSaleStatus(current.status) ? current.soldAt : now.toISOString()) : undefined;
    const { costSnapshot: _ignored, deposit: _ignoredDeposit, soldAt: _ignoredSoldAt, courier: _ignoredCourier, ...withoutSnapshot } = next;
    void _ignored;
    void _ignoredDeposit;
    void _ignoredSoldAt;
    void _ignoredCourier;
    const saved = await updateOldOrder({ ...withoutSnapshot, ...(costSnapshot ? { costSnapshot } : {}), ...(soldAt ? { soldAt } : {}), ...(deposit ? { deposit } : {}), ...(courier ? { courier } : {}), updatedAt: now.toISOString() });
    return saved ? json(200, { success: true, order: saved }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "update");
  }
}

export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    return (await deleteOldOrder(checked.orderId)) ? json(200, { success: true }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "delete");
  }
}
