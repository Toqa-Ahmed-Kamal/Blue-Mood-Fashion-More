import { randomUUID } from "node:crypto";

import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { sanitizeStockMove, sanitizeStockTarget, targetProgress } from "@/lib/inventory";
import { loadStockTarget, saveStockMove, saveStockTarget } from "@/lib/inventory-store";
import { RedisUnavailableError } from "@/lib/redis";
import { catalog, isAutoSoldOut, isManualSoldOut } from "@/lib/site-data";
import { computeStock, syncStoreStock, writeStoreStock } from "@/lib/stock-sync";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Stock of every store product and the recent moves. No customer data in the response. */
export async function GET(request: Request) {
  const denied = await accessDenied(request, ["stock", "money"]);
  if (denied) return denied;
  try {
    const [stock, target] = await Promise.all([computeStock(), loadStockTarget()]);
    const { rows, moves, vault, input } = stock;
    // Opening the inventory also brings the store up to date ("نفدت الكمية", sold / left counts).
    const stats = await writeStoreStock(stock).catch(() => null);
    const byId = new Map(rows.map((row) => [row.productId, row]));
    const products = catalog.map((product) => ({
      ...byId.get(product.id)!,
      name: product.name,
      category: product.category,
      image: product.image,
      hidden: Boolean(product.hidden),
      soldOut: isManualSoldOut(product.id),
      autoSoldOut: isAutoSoldOut(product.id),
      /** Typed in by the owner: sold before the system. */
      soldBefore: stock.soldBefore[product.id] ?? 0,
      /** What customers see as "اتباع منها" (system + before); null when the store numbers could not be saved. */
      shownSold: stats ? stats[product.id]?.sold ?? 0 : null,
    }));
    const progress = target ? targetProgress(target, input, rows) : null;
    return json(200, { success: true, products, moves: moves.slice(0, 200), target: progress, vaultConfigured: vault });
  } catch (error) {
    console.error("[admin] inventory load failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحمل المخزون دلوقتي. جربي تاني." } });
  }
}

/** Records a count, an arrival or an adjustment. Body: { productId, kind, quantity, note }. */
export async function POST(request: Request) {
  const denied = await accessDenied(request, ["stock"]);
  if (denied) return denied;
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

/** Sets "عندي كذا قطعة" (counted from now on). Body: { total } or { total: null } to remove it. */
export async function PUT(request: Request) {
  const denied = await accessDenied(request, ["stock"]);
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const remove = typeof body === "object" && body !== null && (body as Record<string, unknown>).total === null;
  const checked = remove ? null : sanitizeStockTarget(body);
  if (checked && "error" in checked) return json(400, { success: false, error: { code: "INVALID_TOTAL", message: checked.error } });
  try {
    const saved = await saveStockTarget(checked ? checked.target : null);
    if (!remove && !saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, target: saved });
  } catch (error) {
    console.error("[admin] stock total save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
