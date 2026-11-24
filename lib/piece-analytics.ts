// Pieces analysis (تحليل القطع): how many pieces went out, came in, are left, and which products sell most.
// Pure (no I/O) and tested. Same rules as the finance report and the inventory:
// - An order counts once (a Telegram copy of a site order is the site order), on the day it was placed.
// - "Sold" = confirmed or delivered orders; returned and cancelled orders are not sold.
// - Direct sales (friends and family) are sold too; pieces taken for herself went out but were not sold.
// - "Came in" = goods received (وصلت بضاعة) plus each product's first entry in the inventory.
// - "Left" = the inventory's stock now (tracked products only) — not limited by the dates.
import { isSaleStatus, type AnalyticsOrder, type OrderStatus } from "./analytics-report.ts";
import { isPersonalTake, type DirectSale } from "./direct-sales.ts";
import type { StockMove, StockRow } from "./inventory.ts";
import type { OldOrder } from "./old-orders.ts";
import { keptLines, type PieceReturn } from "./order-returns.ts";
import { categoryInfo, categoryOrder, findProduct, type CatalogCategory } from "./site-data.ts";

export type PieceProductRow = {
  productId: string;
  name: string;
  category: CatalogCategory | null;
  image: string | null;
  /** Pieces in confirmed / delivered orders. */
  soldOnline: number;
  soldDirect: number;
  sold: number;
  /** Orders (site + Telegram) with the product that became a sale. */
  orders: number;
  returned: number;
  waiting: number;
  personal: number;
  /** Stock now; null when the product is not in the inventory yet. */
  stock: number | null;
  /** Share of all sold pieces (0–1). */
  share: number;
};

export type PiecesReport = {
  range: { from: string | null; to: string | null };
  totals: {
    /** Sold (online + direct) + taken for herself. */
    out: number;
    sold: number;
    soldOnline: number;
    soldDirect: number;
    delivered: number;
    /** Confirmed, handed to the shipping company, not delivered yet. */
    withCourier: number;
    /** Pieces she gave back that have not reached the stock yet (with her or the shipping company). */
    returning: number;
    personal: number;
    returned: number;
    waiting: number;
    cameIn: number;
    /** Stock now (all tracked products, not limited by the dates). */
    left: number;
    trackedProducts: number;
  };
  products: PieceProductRow[];
  categories: { category: CatalogCategory; label: string; sold: number; share: number }[];
  /** Sold pieces per month (inside the dates), oldest first. */
  months: { month: string; sold: number }[];
  /** In stock but nothing sold in the dates. */
  still: { productId: string; name: string; stock: number }[];
};

type Line = { productId: string; quantity: number };
/** `back`: pieces she gave back from a sold order (`home`: already back in the stock). */
type Order = { orderId: string; day: string; status: OrderStatus; handed: boolean; lines: Line[]; back: (Line & { home: boolean })[] };
const backOf = (status: OrderStatus, returns: PieceReturn[] | undefined) =>
  isSaleStatus(status) ? (returns ?? []).map((item) => ({ productId: item.modelId, quantity: item.quantity, home: item.state === "in_stock" })) : [];

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const cairoDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));

function ordersOnce(live: AnalyticsOrder[], old: OldOrder[]): Order[] {
  const orders: Order[] = live.map((order) => ({ orderId: order.orderId, day: order.day, status: order.status, handed: Boolean(order.courier?.handedAt), lines: keptLines(order.products, order.returns).map((line) => ({ productId: line.modelId, quantity: line.quantity })), back: backOf(order.status, order.returns) }));
  const seen = new Set(orders.map((order) => order.orderId));
  for (const order of old) {
    if (seen.has(order.orderId)) continue;
    seen.add(order.orderId);
    orders.push({ orderId: order.orderId, day: cairoDay(order.createdAt), status: order.status, handed: Boolean(order.courier?.handedAt), lines: keptLines(order.products, order.returns).map((line) => ({ productId: line.modelId, quantity: line.quantity })), back: backOf(order.status, order.returns) });
  }
  return orders;
}

export function buildPiecesReport(input: {
  live: AnalyticsOrder[];
  old: OldOrder[];
  direct: DirectSale[];
  moves: StockMove[];
  stock: StockRow[];
  from?: string | null;
  to?: string | null;
}): PiecesReport {
  const from = isDay(input.from) ? input.from : null;
  const to = isDay(input.to) ? input.to : null;
  const inRange = (day: string) => (!from || day >= from) && (!to || day <= to);

  const rows = new Map<string, Omit<PieceProductRow, "share">>();
  const row = (productId: string) => {
    let current = rows.get(productId);
    if (!current) {
      const product = findProduct(productId);
      current = { productId, name: product?.name ?? productId, category: product?.category ?? null, image: product?.image ?? null, soldOnline: 0, soldDirect: 0, sold: 0, orders: 0, returned: 0, waiting: 0, personal: 0, stock: null };
      rows.set(productId, current);
    }
    return current;
  };
  const months = new Map<string, number>();
  let delivered = 0;
  let withCourier = 0;
  let returning = 0;

  for (const order of ordersOnce(input.live, input.old)) {
    if (!inRange(order.day)) continue;
    const counted = new Set<string>();
    for (const line of order.lines) {
      if (!line.productId || line.quantity <= 0) continue;
      const target = row(line.productId);
      if (isSaleStatus(order.status)) {
        target.soldOnline += line.quantity;
        target.sold += line.quantity;
        if (!counted.has(line.productId)) target.orders += 1;
        counted.add(line.productId);
        if (order.status === "delivered") delivered += line.quantity;
        else if (order.handed) withCourier += line.quantity;
        months.set(order.day.slice(0, 7), (months.get(order.day.slice(0, 7)) ?? 0) + line.quantity);
      } else if (order.status === "returned") target.returned += line.quantity;
      else if (order.status === "submitted") target.waiting += line.quantity;
    }
    // Pieces she gave back from a received order: returned, and on their way until they reach the stock.
    for (const item of order.back) {
      if (!item.productId) continue;
      row(item.productId).returned += item.quantity;
      if (!item.home) returning += item.quantity;
    }
  }
  for (const sale of input.direct) {
    if (!inRange(sale.date)) continue;
    for (const line of sale.lines) {
      if (!line.productId) continue;
      const target = row(line.productId);
      if (isPersonalTake(sale)) {
        target.personal += line.quantity;
        continue;
      }
      target.soldDirect += line.quantity;
      target.sold += line.quantity;
      months.set(sale.date.slice(0, 7), (months.get(sale.date.slice(0, 7)) ?? 0) + line.quantity);
    }
  }
  for (const stock of input.stock) if (stock.tracked) row(stock.productId).stock = stock.stock;

  // Came in: every arrival, and the first entry of each product (count or arrival) — later counts are corrections.
  const firstMove = new Map<string, StockMove>();
  for (const move of input.moves.toSorted((a, b) => a.at.localeCompare(b.at))) if (!firstMove.has(move.productId)) firstMove.set(move.productId, move);
  let cameIn = 0;
  for (const move of input.moves) {
    if (!inRange(cairoDay(move.at))) continue;
    if (move.kind === "arrival" || (move.kind === "count" && firstMove.get(move.productId) === move)) cameIn += move.quantity;
  }

  const list = [...rows.values()];
  const sum = (pick: (item: Omit<PieceProductRow, "share">) => number) => list.reduce((total, item) => total + pick(item), 0);
  const sold = sum((item) => item.sold);
  const products = list
    .filter((item) => item.sold || item.returned || item.waiting || item.personal || item.stock !== null)
    .map((item) => ({ ...item, share: sold > 0 ? item.sold / sold : 0 }))
    .toSorted((a, b) => b.sold - a.sold || b.orders - a.orders || a.name.localeCompare(b.name, "ar"));
  const categories = categoryOrder
    .map((category) => {
      const pieces = list.filter((item) => item.category === category).reduce((total, item) => total + item.sold, 0);
      return { category, label: categoryInfo[category].label, sold: pieces, share: sold > 0 ? pieces / sold : 0 };
    })
    .filter((item) => item.sold > 0)
    .toSorted((a, b) => b.sold - a.sold);
  const tracked = input.stock.filter((item) => item.tracked);
  return {
    range: { from, to },
    totals: {
      out: sold + sum((item) => item.personal),
      sold,
      soldOnline: sum((item) => item.soldOnline),
      soldDirect: sum((item) => item.soldDirect),
      delivered,
      withCourier,
      returning,
      personal: sum((item) => item.personal),
      returned: sum((item) => item.returned),
      waiting: sum((item) => item.waiting),
      cameIn,
      left: tracked.reduce((total, item) => total + Math.max(0, item.stock), 0),
      trackedProducts: tracked.length,
    },
    products,
    categories,
    months: [...months.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([month, pieces]) => ({ month, sold: pieces })),
    still: products.filter((item) => item.sold === 0 && (item.stock ?? 0) > 0).map((item) => ({ productId: item.productId, name: item.name, stock: item.stock ?? 0 })),
  };
}

/** What the store shows on each product: pieces sold so far, pieces left (null = not in the inventory), best seller. */
export type ProductStat = { sold: number; left: number | null; best?: true };

/** A product is a best seller when it is in the top 3 and sold at least this many pieces. */
export const BEST_SELLER_MIN = 3;

/**
 * `soldBefore` = pieces the owner sold before the store's system (typed in from the admin); they are added to
 * the system's own sales for what customers see and for the best-seller ranking — nowhere else.
 */
export function productStats(report: PiecesReport, stock: StockRow[], soldBefore: Record<string, number> = {}): Record<string, ProductStat> {
  const stats: Record<string, ProductStat> = {};
  for (const row of stock) if (row.tracked) stats[row.productId] = { sold: 0, left: Math.max(0, row.stock) };
  const sold = new Map<string, number>();
  for (const row of report.products) if (row.sold > 0) sold.set(row.productId, row.sold);
  for (const [productId, count] of Object.entries(soldBefore)) if (count > 0) sold.set(productId, (sold.get(productId) ?? 0) + count);
  [...sold.entries()]
    .toSorted(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .forEach(([productId, total], index) => {
      stats[productId] = { sold: total, left: stats[productId]?.left ?? null, ...(index < 3 && total >= BEST_SELLER_MIN ? { best: true as const } : {}) };
    });
  return stats;
}

/**
 * "اشتريت كام قطعة": every piece of goods she has had, wherever it is now (all dates, not the chosen ones):
 * in the stock now + delivered + with the shipping company + confirmed not shipped yet + given back and still on the way + direct sales +
 * taken for herself. Only what is recorded on the system: "sold before the system" is left out (it is for the
 * store's display only). Each piece is in one place only, so nothing is counted twice.
 */
export type GoodsTotal = {
  total: number;
  inStock: number;
  delivered: number;
  withCourier: number;
  confirmedNotShipped: number;
  /** Given back by a customer, not back in the stock yet. */
  returning: number;
  direct: number;
  personal: number;
};

export function goodsTotal(allTime: PiecesReport): GoodsTotal {
  const t = allTime.totals;
  const parts = {
    inStock: t.left,
    delivered: t.delivered,
    withCourier: t.withCourier,
    confirmedNotShipped: t.soldOnline - t.delivered - t.withCourier,
    returning: t.returning ?? 0,
    direct: t.soldDirect,
    personal: t.personal,
  };
  return { total: Object.values(parts).reduce((sum, value) => sum + value, 0), ...parts };
}
