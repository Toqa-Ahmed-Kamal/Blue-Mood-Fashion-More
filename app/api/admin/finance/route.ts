import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { loadAllOrdersForSummary } from "@/lib/analytics-store";
import { DEFAULT_FACTORY, buildFinanceReport } from "@/lib/finance";
import { loadDirectSales, loadExpenses, loadFactories, loadProductCosts } from "@/lib/finance-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { basePriceOf, catalog, isBuiltInProduct, isSoldOut, priceOf, wasPriceOf } from "@/lib/site-data";
import { ensureCustomProducts } from "@/lib/custom-products-store";

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
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    const [live, old, costs, expenses, directSales] = await Promise.all([
      loadAllOrdersForSummary(),
      vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 }),
      loadProductCosts(),
      loadExpenses(),
      loadDirectSales(),
    ]);
    const report = buildFinanceReport({ live: live.map((item) => item.order), old: old.orders, costs, expenses, direct: directSales, from: params.get("from"), to: params.get("to") });
    const factories = await loadFactories(costs);
    const products = catalog.map((product) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      image: product.image,
      hidden: Boolean(product.hidden),
      salePrice: priceOf(product),
      // Original price (code, or saved with an added product); differs from salePrice after a change.
      basePrice: basePriceOf(product),
      // Price before the discount ("بدل كذا"), shown struck through on the store.
      wasPrice: wasPriceOf(product),
      // Every product without a saved factory comes from the default factory.
      factory: costs[product.id]?.factory || DEFAULT_FACTORY,
      custom: !isBuiltInProduct(product.id),
      soldOut: isSoldOut(product.id),
      imageAlt: product.imageAlt,
      price: product.price ?? null,
      maxWeightKg: product.maxWeightKg ?? null,
      cost: costs[product.id]?.cost ?? null,
      costUpdatedAt: costs[product.id]?.updatedAt ?? null,
    }));
    return json(200, { success: true, report, products, expenses, directSales, factories, vaultConfigured: vault, unreadableOldOrders: old.unreadable });
  } catch (error) {
    console.error("[admin] finance report failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب الماليات دلوقتي. جربي تاني." } });
  }
}
