import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { isOrderStatus, setOrderStatus } from "@/lib/analytics-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Marks an order as confirmed sale / cancelled / back to submitted. Uses the write token. */
export async function PATCH(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });

  const { orderId } = await context.params;
  if (!/^BM-[A-F\d]{20}$/.test(orderId)) return json(400, { success: false, error: { code: "INVALID_ORDER_ID" } });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
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
