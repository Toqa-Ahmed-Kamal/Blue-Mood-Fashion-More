import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { mergeAllOrders } from "@/lib/all-orders";
import { MAX_DETAILS_PER_REQUEST, loadAllOrdersForSummary, loadOrdersDetails } from "@/lib/analytics-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured, type OrderDetails } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Every order — site and imported Telegram — in one list, with customer details (admin only, decrypted on the server). */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    const [live, old] = await Promise.all([loadAllOrdersForSummary(), vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 })]);
    const ids = live.map(({ order }) => order.orderId);
    const details: Record<string, OrderDetails | null> = {};
    for (let start = 0; start < ids.length; start += MAX_DETAILS_PER_REQUEST) {
      Object.assign(details, await loadOrdersDetails(ids.slice(start, start + MAX_DETAILS_PER_REQUEST)));
    }
    const orders = mergeAllOrders(live.map(({ order }) => ({ order, details: details[order.orderId] ?? null })), old.orders);
    return json(200, { success: true, orders, vaultConfigured: vault, unreadableOldOrders: old.unreadable });
  } catch (error) {
    console.error("[admin] all orders read failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نجيب الأوردرات دلوقتي. جربي تاني." } });
  }
}
