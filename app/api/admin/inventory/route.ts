import { randomUUID } from "node:crypto";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { loadAllOrdersForSummary } from "@/lib/analytics-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { loadDirectSales } from "@/lib/finance-store";
import { buildStock, sanitizeStockMove } from "@/lib/inventory";
import { loadStockMoves, saveStockMove } from "@/lib/inventory-store";
import { loadOldOrders } from "@/lib/old-orders-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { catalog, isSoldOut } from "@/lib/site-data";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Stock of every store product and the recent moves. No customer data in the response. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    await ensureCustomProducts();
    const vault = isOrderVaultConfigured();
    const [live, old, direct, moves] = await Promise.all([
      loadAllOrdersForSummary(),
      vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 }),
      loadDirectSales(),
      loadStockMoves(),
    ]);
    const rows = buildStock({ productIds: catalog.map((product) => product.id), moves, live: live.map((item) => item.order), old: old.orders, direct });
    const byId = new Map(rows.map((row) => [row.productId, row]));
    const products = catalog.map((product) => ({
      ...byId.get(product.id)!,
      name: product.name,
      category: product.category,
      image: product.image,
      hidden: Boolean(product.hidden),
      soldOut: isSoldOut(product.id),
    }));
    return json(200, { success: true, products, moves: moves.slice(0, 200), vaultConfigured: vault });
  } catch (error) {
    console.error("[admin] inventory load failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحمل المخزون دلوقتي. جربي تاني." } });
  }
}

/** Records a count, an arrival or an adjustment. Body: { productId, kind, quantity, note }. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  try {
    await ensureCustomProducts();
    const checked = sanitizeStockMove(body, randomUUID());
    if ("error" in checked) return json(400, { success: false, error: { code: "INVALID_MOVE", message: checked.error } });
    const saved = await saveStockMove(checked.move);
    return saved ? json(200, { success: true, move: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    console.error("[admin] stock move save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
