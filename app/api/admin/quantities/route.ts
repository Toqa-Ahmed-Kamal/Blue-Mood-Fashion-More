import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { loadAllOrdersForSummary } from "@/lib/analytics-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { buildQuantitySummary } from "@/lib/quantity-summary";
import { RedisUnavailableError } from "@/lib/redis";
import { ensureCustomProducts } from "@/lib/custom-products-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Factory quantity summary over every site order and every imported old order (read-only token).
 * Returns products, sizes and counts only — no customer data. ?archived=include also counts archived old orders.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  const includeArchived = new URL(request.url).searchParams.get("archived") === "include";
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    // Old orders are encrypted: without the key they cannot be read (site orders still count).
    const [live, old] = await Promise.all([loadAllOrdersForSummary(), vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 })]);
    const summary = buildQuantitySummary({ live, old: old.orders, includeArchived });
    return json(200, { success: true, summary, unreadableOldOrders: old.unreadable, vaultConfigured: vault, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[admin] quantity summary failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب الكميات دلوقتي. جربي تاني." } });
  }
}
