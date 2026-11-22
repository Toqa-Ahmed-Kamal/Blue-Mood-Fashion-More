import { can, requireAccess } from "@/lib/admin-users";
import { mergeAllOrders } from "@/lib/all-orders";
import { MAX_DETAILS_PER_REQUEST, loadAllOrdersForSummary, loadOrdersDetails } from "@/lib/analytics-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { orderFinance } from "@/lib/finance";
import { loadExpenses, loadProductCosts } from "@/lib/finance-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured, type OrderDetails } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Every order — site and imported Telegram — in one list, with customer details (admin only, decrypted on the server). */
export async function GET(request: Request) {
  const access = await requireAccess(request, ["orders", "money"]);
  if (access instanceof Response) return access;
  // Profit per order only for who may see the money.
  const showMoney = can(access, "money");
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    const [live, old, costs, expenses] = await Promise.all([
      loadAllOrdersForSummary(),
      vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 }),
      loadProductCosts(),
      loadExpenses(),
    ]);
    const ids = live.map(({ order }) => order.orderId);
    const details: Record<string, OrderDetails | null> = {};
    for (let start = 0; start < ids.length; start += MAX_DETAILS_PER_REQUEST) {
      Object.assign(details, await loadOrdersDetails(ids.slice(start, start + MAX_DETAILS_PER_REQUEST)));
    }
    // Each order's cost, margin, share of its month's expenses and net profit (same rules as الإدارة المالية).
    const money = orderFinance({ live: live.map(({ order }) => order), old: old.orders, costs, expenses });
    const orders = mergeAllOrders(live.map(({ order }) => ({ order, details: details[order.orderId] ?? null })), old.orders)
      .map((order) => ({ ...order, money: showMoney ? money[order.orderId] ?? null : null }));
    return json(200, { success: true, orders, vaultConfigured: vault, unreadableOldOrders: old.unreadable });
  } catch (error) {
    console.error("[admin] all orders read failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نجيب الأوردرات دلوقتي. جربي تاني." } });
  }
}
