import { randomUUID } from "node:crypto";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeStockMove } from "@/lib/inventory";
import { saveStockMove } from "@/lib/inventory-store";
import { RedisUnavailableError } from "@/lib/redis";
import { catalog, isAutoSoldOut, isManualSoldOut } from "@/lib/site-data";
import { computeStock, outOfStockIds, syncStoreStock, writeAutoSoldOut } from "@/lib/stock-sync";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Stock of every store product and the recent moves. No customer data in the response. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const { rows, moves, vault } = await computeStock();
    // Opening the inventory also brings the store's "نفدت الكمية" up to date.
    await writeAutoSoldOut(outOfStockIds(rows)).catch(() => false);
    const byId = new Map(rows.map((row) => [row.productId, row]));
    const products = catalog.map((product) => ({
      ...byId.get(product.id)!,
      name: product.name,
      category: product.category,
      image: product.image,
      hidden: Boolean(product.hidden),
      soldOut: isManualSoldOut(product.id),
      autoSoldOut: isAutoSoldOut(product.id),
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
    if (saved) await syncStoreStock();
    return saved ? json(200, { success: true, move: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    console.error("[admin] stock move save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
