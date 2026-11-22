import { accessDenied } from "@/lib/admin-users";
import { loadAllOrdersForSummary } from "@/lib/analytics-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { isCancelReason } from "@/lib/analytics-report";
import { isOrderFilter, matchesFilter, matchesReason } from "@/lib/all-orders";
import { buildQuantitySummary } from "@/lib/quantity-summary";
import { RedisUnavailableError } from "@/lib/redis";
import { ensureCustomProducts } from "@/lib/custom-products-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Factory quantity summary over every site order and every imported old order (read-only token).
 * Returns products, sizes and counts only — no customer data. ?archived=include also counts archived old orders;
 * ?filter= (and ?reason= for cancelled) counts only the orders matching that order filter.
 */
export async function GET(request: Request) {
  const denied = await accessDenied(request, ["stock"]);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const includeArchived = params.get("archived") === "include";
  // Optional order filter, the same as in "كل الأوردرات": ?filter=<id> and, for cancelled, ?reason=<id|none>.
  const filter = params.get("filter");
  const reasonParam = params.get("reason") ?? "";
  const reason = reasonParam === "none" || isCancelReason(reasonParam) ? reasonParam : "";
  const keep = isOrderFilter(filter) && filter !== "all"
    ? (order: Parameters<typeof matchesFilter>[0] & Parameters<typeof matchesReason>[0]) => matchesFilter(order, filter) && (filter !== "cancelled" || matchesReason(order, reason))
    : undefined;
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    // Old orders are encrypted: without the key they cannot be read (site orders still count).
    const [live, old] = await Promise.all([loadAllOrdersForSummary(), vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 })]);
    const summary = buildQuantitySummary({ live, old: old.orders, includeArchived, keep });
    return json(200, { success: true, summary, unreadableOldOrders: old.unreadable, vaultConfigured: vault, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[admin] quantity summary failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب الكميات دلوقتي. جربي تاني." } });
  }
}
