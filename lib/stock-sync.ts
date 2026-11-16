// Server-only: links the inventory to the store. A tracked product whose stock reaches 0 shows "نفدت الكمية"
// on the store by itself, and comes back when stock is added (arrival, count, cancelled order…).
//
// Key (prefix bm:{prod|preview|dev}:v1:)
//   catalog:soldout:auto   SET   product IDs out of stock by the inventory (rewritten on every sync)
// The admin's own "نفذ" switch (catalog:soldout) is separate and always wins.
import { revalidateTag } from "next/cache";

import { loadAllOrdersForSummary } from "./analytics-store.ts";
import { AUTO_SOLD_OUT, CUSTOM_PRODUCTS_TAG, ensureCustomProducts } from "./custom-products-store.ts";
import { loadDirectSales } from "./finance-store.ts";
import { buildStock, outOfStockIds } from "./inventory.ts";
import { loadStockMoves } from "./inventory-store.ts";
import { loadOldOrders } from "./old-orders-store.ts";
import { isOrderVaultConfigured } from "./order-vault.ts";
import { redisPipeline } from "./redis.ts";
import { catalog } from "./site-data.ts";

export { outOfStockIds };

/** Stock of every store product, from orders, direct sales / personal takes and stock moves. */
export async function computeStock() {
  await ensureCustomProducts();
  const vault = isOrderVaultConfigured();
  const [live, old, direct, moves] = await Promise.all([
    loadAllOrdersForSummary(),
    vault ? loadOldOrders() : Promise.resolve({ orders: [], unreadable: 0 }),
    loadDirectSales(),
    loadStockMoves(),
  ]);
  const rows = buildStock({ productIds: catalog.map((product) => product.id), moves, live: live.map((item) => item.order), old: old.orders, direct });
  return { rows, moves, vault };
}

/** Rewrites the auto sold-out set when it changed, and refreshes the store pages. */
export async function writeAutoSoldOut(ids: string[]) {
  const [current] = await redisPipeline([["SMEMBERS", AUTO_SOLD_OUT()]], "write");
  const before = (Array.isArray(current) ? current.map(String) : []).toSorted();
  if (before.length === ids.length && before.every((id, index) => id === ids[index])) return false;
  await redisPipeline([["DEL", AUTO_SOLD_OUT()], ...(ids.length ? [["SADD", AUTO_SOLD_OUT(), ...ids]] : [])], "write");
  await ensureCustomProducts(true);
  revalidateTag(CUSTOM_PRODUCTS_TAG, { expire: 0 });
  return true;
}

/**
 * Call after anything that changes stock (order status or pieces, stock moves, direct sales). Never throws:
 * the action the admin did already succeeded; the store catches up on the next sync.
 */
export async function syncStoreStock() {
  try {
    const { rows } = await computeStock();
    await writeAutoSoldOut(outOfStockIds(rows));
  } catch (error) {
    console.error("[stock] store sync failed", { reason: error instanceof Error ? error.message : "UNEXPECTED" });
  }
}
