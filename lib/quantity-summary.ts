// Product Quantity Summary (حصر كميات المصنع): pieces needed per product and size across every
// order — the site's own orders and the old orders imported from Telegram. Pure and tested.
//
// Rules
// - Each order counts once. An order that is both a site order and an imported Telegram message
//   (same order ID) is taken from the site, with the status set in the Orders tab.
// - Cancelled orders are kept apart (never part of the pieces to make); pending and confirmed are
//   reported separately so either or both can be shown.
// - Product name and photo come from the catalog by product ID, and so does a pajama's size (One
//   Size + the product's weight limit). Nothing is guessed: a product without a photo has image null.
import type { AnalyticsOrder, OrderStatus } from "./analytics-report.ts";
import { factorySize, shortSize, sizeFromFit, type OldOrder } from "./old-orders.ts";

export { shortSize };
import { findProduct, type CatalogCategory } from "./site-data.ts";

export const NO_SIZE = "بدون مقاس";
export const SIZE_NOT_RECORDED = "المقاس مش متسجل";

/** A site order with the fit note of each product line (from the order, or from its encrypted details). */
export type LiveOrderForSummary = { order: AnalyticsOrder; fits: (string | null)[] };

type Counts = Record<OrderStatus, number>;
const zero = (): Counts => ({ submitted: 0, confirmed: 0, cancelled: 0 });

export type SizeRow = { size: string; pieces: Counts };

export type ProductSummary = {
  /** Catalog product ID ("" for a line that had none). */
  productId: string;
  name: string;
  category: CatalogCategory | "";
  /** Real product photo, or null when there is none. */
  image: string | null;
  pieces: Counts;
  /** Number of different orders, per status. */
  orders: Counts;
  sizes: SizeRow[];
};

export type QuantitySummary = {
  products: ProductSummary[];
  totals: { pieces: Counts; orders: Counts };
  sources: { siteOrders: number; oldOrders: number; inBoth: number; archivedSkipped: number };
};

/** Photo of a product: the catalog's, else the store photo linked in the message, else null. */
export function productImage(productId: string, fallback?: string | null) {
  return findProduct(productId)?.image ?? (fallback || null);
}


type Line = { productId: string; name: string; size: string; color: string; quantity: number; image?: string | null };

export function buildQuantitySummary(input: { live: LiveOrderForSummary[]; old: OldOrder[]; includeArchived?: boolean }): QuantitySummary {
  const products = new Map<string, ProductSummary & { orderIds: Record<OrderStatus, Set<string>>; sizeMap: Map<string, Counts> }>();
  const orderIds: Record<OrderStatus, Set<string>> = { submitted: new Set(), confirmed: new Set(), cancelled: new Set() };
  const pieces = zero();

  const add = (orderId: string, status: OrderStatus, line: Line) => {
    const catalogProduct = line.productId ? findProduct(line.productId) : undefined;
    const productKey = catalogProduct ? catalogProduct.id : `name:${line.name}`;
    let row = products.get(productKey);
    if (!row) {
      row = {
        productId: catalogProduct?.id ?? line.productId,
        name: catalogProduct?.name ?? line.name,
        category: catalogProduct?.category ?? "",
        image: catalogProduct ? catalogProduct.image : line.image || null,
        pieces: zero(),
        orders: zero(),
        sizes: [],
        orderIds: { submitted: new Set(), confirmed: new Set(), cancelled: new Set() },
        sizeMap: new Map(),
      };
      products.set(productKey, row);
    }
    const size = [factorySize(line.productId, line.size), line.color.trim()].filter(Boolean).join(" · ") || NO_SIZE;
    const sizeCounts = row.sizeMap.get(size) ?? zero();
    sizeCounts[status] += line.quantity;
    row.sizeMap.set(size, sizeCounts);
    row.pieces[status] += line.quantity;
    row.orderIds[status].add(orderId);
    pieces[status] += line.quantity;
    orderIds[status].add(orderId);
  };

  const siteIds = new Set(input.live.map(({ order }) => order.orderId));
  for (const { order, fits } of input.live) {
    order.products.forEach((product, index) => {
      const fit = product.fit ?? fits[index] ?? null;
      // Catalog pajamas get their size from the product data (factorySize). Only a pajama that is no
      // longer in the catalog and has no saved note is "not recorded"; other categories have no size.
      const size = fit !== null ? sizeFromFit(fit) : product.category === "winter-pajamas" && !findProduct(product.modelId) ? SIZE_NOT_RECORDED : "";
      add(order.orderId, order.status, { productId: product.modelId, name: product.modelId, size, color: "", quantity: product.quantity });
    });
  }

  let inBoth = 0;
  let archivedSkipped = 0;
  for (const order of input.old) {
    if (siteIds.has(order.orderId)) {
      inBoth += 1;
      continue;
    }
    if (order.archived && !input.includeArchived) {
      archivedSkipped += 1;
      continue;
    }
    for (const product of order.products) {
      add(order.orderId, order.status, { productId: product.modelId, name: product.name, size: product.size, color: product.color, quantity: product.quantity, image: product.image });
    }
  }

  const statuses: OrderStatus[] = ["submitted", "confirmed", "cancelled"];
  const rows = [...products.values()].map(({ orderIds: ids, sizeMap, ...row }) => ({
    ...row,
    orders: Object.fromEntries(statuses.map((status) => [status, ids[status].size])) as Counts,
    sizes: [...sizeMap].map(([size, counts]) => ({ size, pieces: counts })).toSorted((a, b) => active(b.pieces) - active(a.pieces) || a.size.localeCompare(b.size)),
  }));

  return {
    products: rows.toSorted((a, b) => active(b.pieces) - active(a.pieces) || a.name.localeCompare(b.name, "ar")),
    totals: { pieces, orders: Object.fromEntries(statuses.map((status) => [status, orderIds[status].size])) as Counts },
    sources: { siteOrders: input.live.length, oldOrders: input.old.length, inBoth, archivedSkipped },
  };
}

/** Pieces to make: pending + confirmed (cancelled never counts). */
export function active(counts: Counts) {
  return counts.submitted + counts.confirmed;
}
