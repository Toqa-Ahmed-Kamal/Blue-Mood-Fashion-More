import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { loadAllOrdersForSummary } from "@/lib/analytics-store";
import { buildFinanceReport } from "@/lib/finance";
import { loadExpenses, loadProductCosts } from "@/lib/finance-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { catalog, priceOf } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Financial Management: profit report for ?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional), the catalog
 * with factory costs, and all expenses. Read-only; no customer data in the response.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  const params = new URL(request.url).searchParams;
  try {
    const vault = isOrderVaultConfigured();
    const [live, old, costs, expenses] = await Promise.all([
      loadAllOrdersForSummary(),
      vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 }),
      loadProductCosts(),
      loadExpenses(),
    ]);
    const report = buildFinanceReport({ live: live.map((item) => item.order), old: old.orders, costs, expenses, from: params.get("from"), to: params.get("to") });
    const products = catalog.map((product) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      image: product.image,
      hidden: Boolean(product.hidden),
      salePrice: priceOf(product),
      factory: costs[product.id]?.factory ?? "",
      cost: costs[product.id]?.cost ?? null,
      costUpdatedAt: costs[product.id]?.updatedAt ?? null,
    }));
    return json(200, { success: true, report, products, expenses, vaultConfigured: vault, unreadableOldOrders: old.unreadable });
  } catch (error) {
    console.error("[admin] finance report failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب الماليات دلوقتي. جربي تاني." } });
  }
}
