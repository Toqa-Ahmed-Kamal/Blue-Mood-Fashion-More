import { can, requireAccess } from "@/lib/admin-users";
import { MAX_DETAILS_PER_REQUEST, loadAllOrdersForSummary, loadOrdersDetails } from "@/lib/analytics-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { isCancelReason } from "@/lib/analytics-report";
import { isOrderFilter, matchesFilter, matchesReason } from "@/lib/all-orders";
import { buildQuantitySummary, parseOrderIds, pickerOrders } from "@/lib/quantity-summary";
import { RedisUnavailableError } from "@/lib/redis";
import { ensureCustomProducts } from "@/lib/custom-products-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Factory quantity summary over every site order and every imported old order (read-only token).
 * Returns products, sizes and counts (no customer data, except names in ?list=1 below). ?archived=include also counts archived old orders;
 * ?filter= (and ?reason= for cancelled) counts only the orders matching that order filter.
 * ?orders=BM-…,BM-… counts only those orders (archived ones too: they were picked by hand).
 * ?list=1 also returns every order to pick from; the customer's name only for who may open the orders.
 */
export async function GET(request: Request) {
  const access = await requireAccess(request, ["stock"]);
  if (access instanceof Response) return access;
  const params = new URL(request.url).searchParams;
  const picked = params.has("orders") ? new Set(parseOrderIds(params.get("orders"))) : null;
  const includeArchived = picked !== null || params.get("archived") === "include";
  // Optional order filter, the same as in "كل الأوردرات": ?filter=<id> and, for cancelled, ?reason=<id|none>.
  const filter = params.get("filter");
  const reasonParam = params.get("reason") ?? "";
  const reason = reasonParam === "none" || isCancelReason(reasonParam) ? reasonParam : "";
  const keep = picked
    ? (order: { orderId: string }) => picked.has(order.orderId)
    : isOrderFilter(filter) && filter !== "all"
    ? (order: Parameters<typeof matchesFilter>[0] & Parameters<typeof matchesReason>[0]) => matchesFilter(order, filter) && (filter !== "cancelled" || matchesReason(order, reason))
    : undefined;
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    // Old orders are encrypted: without the key they cannot be read (site orders still count).
    const [live, old] = await Promise.all([loadAllOrdersForSummary(), vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 })]);
    const summary = buildQuantitySummary({ live, old: old.orders, includeArchived, keep });
    let orders = params.get("list") === "1" ? pickerOrders({ live, old: old.orders }) : undefined;
    if (orders && can(access, "orders")) {
      // Names help pick the right orders; only for who can already see the customers.
      const names = new Map(old.orders.map((order) => [order.orderId, order.customerName]));
      const ids = live.map(({ order }) => order.orderId);
      for (let start = 0; start < ids.length; start += MAX_DETAILS_PER_REQUEST) {
        const details = await loadOrdersDetails(ids.slice(start, start + MAX_DETAILS_PER_REQUEST));
        for (const [id, item] of Object.entries(details)) if (item?.customerName) names.set(id, item.customerName);
      }
      orders = orders.map((order) => ({ ...order, customer: names.get(order.orderId) || "" }));
    }
    return json(200, { success: true, summary, ...(orders ? { orders } : {}), unreadableOldOrders: old.unreadable, vaultConfigured: vault, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[admin] quantity summary failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب الكميات دلوقتي. جربي تاني." } });
  }
}
