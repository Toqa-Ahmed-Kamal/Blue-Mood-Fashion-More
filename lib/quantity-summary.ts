// Product Quantity Summary (حصر كميات المصنع): pieces needed per product and size across every
// order — the site's own orders and the old orders imported from Telegram. Pure and tested.
//
// Both sources are first turned into the same FactoryLine shape (siteOrderLines / oldOrderLines),
// then aggregated together.
//
// Rules
// - Each order counts once. An order that is both a site order and an imported Telegram message
//   (same order ID) is taken from the site, with the status set in the Orders tab.
// - Cancelled orders are kept apart (never part of the pieces to make); pending and confirmed are
//   reported separately so either or both can be shown. Archived old orders count only on request.
// - Products are matched by catalog product ID (Telegram lines carry it), never by name, so two
//   different pieces are never merged; name and photo come from the catalog, and so does a
//   pajama's size (One Size + the product's weight limit). Nothing is guessed: a product without
//   a photo has image null.
import type { AnalyticsOrder, OrderStatus } from "./analytics-report.ts";
import { factorySize, shortSize, sizeFromFit, type OldOrder } from "./old-orders.ts";
import { findProduct, type CatalogCategory } from "./site-data.ts";

export { shortSize };

export const NO_SIZE = "بدون مقاس";
export const SIZE_NOT_RECORDED = "المقاس مش متسجل";

/** A site order with the fit note of each product line (from the order, or from its encrypted details). */
export type LiveOrderForSummary = { order: AnalyticsOrder; fits: (string | null)[] };

type Counts = Record<OrderStatus, number>;
const zero = (): Counts => ({ submitted: 0, confirmed: 0, delivered: 0, cancelled: 0, returned: 0 });
const STATUSES: OrderStatus[] = ["submitted", "confirmed", "delivered", "cancelled", "returned"];

export type OrderSource = "site" | "telegram";

/** One product line of one order, in the shared shape both sources are converted to. */
export type FactoryLine = {
  orderId: string;
  status: OrderStatus;
  source: OrderSource;
  /** Catalog product ID, or "" when the line had none. */
  productId: string;
  /** Catalog name when the product is known, else the name written in the order. */
  name: string;
  category: CatalogCategory | "";
  /** Size shown to the factory (already normalised), or NO_SIZE / SIZE_NOT_RECORDED. */
  size: string;
  quantity: number;
  image: string | null;
};

export type SizeRow = { size: string; pieces: Counts };

export type ProductSummary = {
  /** Catalog product ID ("" for a line that had none). */
  productId: string;
  name: string;
  category: CatalogCategory | "";
  /** Real product photo, or null when there is none. */
  image: string | null;
  pieces: Counts;
  /** The same pieces split by where the order came from. */
  bySource: Record<OrderSource, Counts>;
  /** Number of different orders, per status. */
  orders: Counts;
  sizes: SizeRow[];
};

export type QuantitySummary = {
  products: ProductSummary[];
  totals: { pieces: Counts; orders: Counts; bySource: Record<OrderSource, Counts> };
  sources: {
    siteOrders: number;
    oldOrders: number;
    /** Old orders whose pieces are in the totals. */
    oldCounted: number;
    inBoth: number;
    archivedSkipped: number;
    /** Order IDs behind the two numbers above, so it is clear which old orders are not added. */
    inBothIds: string[];
    archivedIds: string[];
  };
};

/** Photo of a product: the catalog's, else the store photo linked in the message, else null. */
export function productImage(productId: string, fallback?: string | null) {
  return findProduct(productId)?.image ?? (fallback || null);
}

function line(base: Omit<FactoryLine, "name" | "category" | "image" | "size"> & { name: string; recordedSize: string; color?: string; image?: string | null }): FactoryLine {
  const product = base.productId ? findProduct(base.productId) : undefined;
  const size = base.recordedSize === SIZE_NOT_RECORDED ? SIZE_NOT_RECORDED : [factorySize(base.productId, base.recordedSize), base.color?.trim()].filter(Boolean).join(" · ") || NO_SIZE;
  return {
    orderId: base.orderId,
    status: base.status,
    source: base.source,
    productId: product?.id ?? base.productId,
    name: product?.name ?? base.name,
    category: product?.category ?? "",
    size,
    quantity: base.quantity,
    image: product ? product.image : base.image || null,
  };
}

/** A site order's product lines. */
export function siteOrderLines({ order, fits }: LiveOrderForSummary): FactoryLine[] {
  return order.products.map((product, index) => {
    const fit = product.fit ?? fits[index] ?? null;
    // Catalog pajamas get their size from the product data. Only a pajama no longer in the catalog
    // with no saved note is "not recorded"; other categories have no size.
    const recordedSize = fit !== null ? sizeFromFit(fit) : product.category === "winter-pajamas" && !findProduct(product.modelId) ? SIZE_NOT_RECORDED : "";
    return line({ orderId: order.orderId, status: order.status, source: "site", productId: product.modelId, name: product.modelId, recordedSize, quantity: product.quantity });
  });
}

/** An imported Telegram order's product lines. */
export function oldOrderLines(order: OldOrder): FactoryLine[] {
  return order.products.map((product) => line({
    orderId: order.orderId,
    status: order.status,
    source: "telegram",
    productId: product.modelId,
    name: product.name,
    recordedSize: product.size,
    color: product.color,
    quantity: product.quantity,
    image: product.image,
  }));
}

export function buildQuantitySummary(input: { live: LiveOrderForSummary[]; old: OldOrder[]; includeArchived?: boolean }): QuantitySummary {
  const siteIds = new Set(input.live.map(({ order }) => order.orderId));
  const inBothIds: string[] = [];
  const archivedIds: string[] = [];
  const countedOld: OldOrder[] = [];
  const seenOld = new Set<string>();
  for (const order of input.old) {
    if (seenOld.has(order.orderId)) continue; // never twice, even if storage held a repeat
    seenOld.add(order.orderId);
    if (siteIds.has(order.orderId)) inBothIds.push(order.orderId);
    else if (order.archived && !input.includeArchived) archivedIds.push(order.orderId);
    else countedOld.push(order);
  }

  const lines = [...input.live.flatMap(siteOrderLines), ...countedOld.flatMap(oldOrderLines)];

  type Row = ProductSummary & { orderIds: Record<OrderStatus, Set<string>>; sizeMap: Map<string, Counts> };
  const products = new Map<string, Row>();
  const orderIds: Record<OrderStatus, Set<string>> = { submitted: new Set(), confirmed: new Set(), delivered: new Set(), cancelled: new Set(), returned: new Set() };
  const pieces = zero();
  const bySource: Record<OrderSource, Counts> = { site: zero(), telegram: zero() };
  for (const item of lines) {
    // Known products are matched by catalog ID only; a line without one stays on its own name.
    const key = item.productId && findProduct(item.productId) ? item.productId : `name:${item.productId}|${item.name}`;
    let row = products.get(key);
    if (!row) {
      row = {
        productId: item.productId,
        name: item.name,
        category: item.category,
        image: item.image,
        pieces: zero(),
        bySource: { site: zero(), telegram: zero() },
        orders: zero(),
        sizes: [],
        orderIds: { submitted: new Set(), confirmed: new Set(), delivered: new Set(), cancelled: new Set(), returned: new Set() },
        sizeMap: new Map(),
      };
      products.set(key, row);
    }
    const sizeCounts = row.sizeMap.get(item.size) ?? zero();
    sizeCounts[item.status] += item.quantity;
    row.sizeMap.set(item.size, sizeCounts);
    row.pieces[item.status] += item.quantity;
    row.bySource[item.source][item.status] += item.quantity;
    row.orderIds[item.status].add(item.orderId);
    pieces[item.status] += item.quantity;
    bySource[item.source][item.status] += item.quantity;
    orderIds[item.status].add(item.orderId);
  }

  const countsOf = (ids: Record<OrderStatus, Set<string>>) => Object.fromEntries(STATUSES.map((status) => [status, ids[status].size])) as Counts;
  const rows = [...products.values()].map(({ orderIds: ids, sizeMap, ...row }) => ({
    ...row,
    orders: countsOf(ids),
    sizes: [...sizeMap].map(([size, counts]) => ({ size, pieces: counts })).toSorted((a, b) => active(b.pieces) - active(a.pieces) || a.size.localeCompare(b.size)),
  }));

  return {
    products: rows.toSorted((a, b) => active(b.pieces) - active(a.pieces) || a.name.localeCompare(b.name, "ar")),
    totals: { pieces, orders: countsOf(orderIds), bySource },
    sources: {
      siteOrders: input.live.length,
      oldOrders: seenOld.size,
      oldCounted: countedOld.length,
      inBoth: inBothIds.length,
      archivedSkipped: archivedIds.length,
      inBothIds,
      archivedIds,
    },
  };
}

/** Pieces ordered: pending + confirmed + delivered (cancelled and returned never count). */
export function active(counts: Counts) {
  return counts.submitted + counts.confirmed + counts.delivered;
}
