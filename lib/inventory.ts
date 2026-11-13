// Inventory (المخزون): pieces on hand per store product. Pure (no I/O) and tested; storage is lib/inventory-store.ts.
//
// Stock is worked out, never decremented in place:
//   stock = last count (جرد) + arrivals and adjustments after it − pieces sold after it
// "Sold" = pieces in site / Telegram orders that are confirmed or delivered now and became a sale after the
// count, plus direct sales (friends and family) recorded after it. So an order that is cancelled or returned
// later gives its pieces back by itself, and an edited order counts with its current pieces.
// Waiting orders do not take stock; their pieces are shown as "reserved".
import type { AnalyticsOrder } from "./analytics-report.ts";
import { isSaleStatus } from "./analytics-report.ts";
import type { DirectSale } from "./direct-sales.ts";
import type { OldOrder } from "./old-orders.ts";
import { findProduct } from "./site-data.ts";

export const STOCK_MOVE_KINDS = [
  { id: "count", label: "جرد (العدد الفعلي)" },
  { id: "arrival", label: "وصلت بضاعة" },
  { id: "adjust", label: "تعديل (تالف، هدية…)" },
] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number]["id"];

export type StockMove = {
  id: string;
  productId: string;
  kind: StockMoveKind;
  /** count: the exact number on hand; arrival: pieces added (> 0); adjust: + or − pieces (≠ 0). */
  quantity: number;
  /** ISO time it was recorded. */
  at: string;
  note: string;
};

/** At or below this, the product is flagged "قرب يخلص". */
export const LOW_STOCK = 2;

export type StockRow = {
  productId: string;
  /** false until a count or an arrival is recorded for the product. */
  tracked: boolean;
  /** Starting point: the last count (or 0 at the first arrival when never counted). */
  start: number;
  startAt: string | null;
  counted: boolean;
  arrived: number;
  adjusted: number;
  soldOrders: number;
  soldDirect: number;
  stock: number;
  /** Pieces in orders still waiting for confirmation. */
  reserved: number;
  /** stock − reserved. */
  available: number;
  state: "untracked" | "out" | "low" | "ok";
};

const MAX_QUANTITY = 100_000;
const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

/** Checks a stock move from the admin. Returns the move or an Arabic message. */
export function sanitizeStockMove(raw: unknown, id: string, now = new Date()): { move: StockMove } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "البيانات مش مفهومة." };
  const value = raw as Record<string, unknown>;
  const productId = typeof value.productId === "string" ? value.productId : "";
  if (!findProduct(productId)) return { error: "المنتج مش موجود." };
  if (!STOCK_MOVE_KINDS.some((kind) => kind.id === value.kind)) return { error: "نوع الحركة مش معروف." };
  const kind = value.kind as StockMoveKind;
  const quantity = Number(value.quantity);
  if (!Number.isInteger(quantity) || Math.abs(quantity) > MAX_QUANTITY) return { error: "العدد لازم يبقى رقم صحيح." };
  if (kind === "count" && quantity < 0) return { error: "الجرد لازم يبقى صفر أو أكتر." };
  if (kind === "arrival" && quantity < 1) return { error: "اكتبي عدد القطع اللي وصلت (١ أو أكتر)." };
  if (kind === "adjust" && quantity === 0) return { error: "اكتبي الزيادة (+) أو النقص (−)." };
  return { move: { id, productId, kind, quantity, at: now.toISOString(), note: text(value.note, 200) } };
}

type SoldLine = { productId: string; quantity: number; at: string };

/** When an order became a sale: saved time, else the cost snapshot (taken at confirmation), else the status time, else its creation. */
const soldTime = (order: { soldAt?: string; costSnapshot?: { at: string }; statusAt: string | null; createdAt: string }) =>
  order.soldAt ?? order.costSnapshot?.at ?? order.statusAt ?? order.createdAt;

/** Sold and waiting pieces from site and Telegram orders (an order in both counts once, as the site order). */
function orderLines(live: AnalyticsOrder[], old: OldOrder[]) {
  const sold: SoldLine[] = [];
  const waiting: Omit<SoldLine, "at">[] = [];
  const siteIds = new Set(live.map((order) => order.orderId));
  const seen = new Set<string>();
  const add = (status: string, at: string, lines: { modelId: string; quantity: number }[]) => {
    for (const line of lines) {
      if (!line.modelId) continue;
      if (isSaleStatus(status)) sold.push({ productId: line.modelId, quantity: line.quantity, at });
      else if (status === "submitted") waiting.push({ productId: line.modelId, quantity: line.quantity });
    }
  };
  for (const order of live) add(order.status, soldTime(order), order.products);
  for (const order of old) {
    if (siteIds.has(order.orderId) || seen.has(order.orderId)) continue;
    seen.add(order.orderId);
    add(order.status, soldTime(order), order.products);
  }
  return { sold, waiting };
}

export function buildStock(input: { productIds: string[]; moves: StockMove[]; live: AnalyticsOrder[]; old: OldOrder[]; direct: DirectSale[] }): StockRow[] {
  const { sold, waiting } = orderLines(input.live, input.old);
  const direct: SoldLine[] = input.direct.flatMap((sale) => sale.lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: line.quantity, at: sale.createdAt })));
  const movesOf = new Map<string, StockMove[]>();
  for (const move of input.moves) movesOf.set(move.productId, [...(movesOf.get(move.productId) ?? []), move]);

  return input.productIds.map((productId): StockRow => {
    const moves = (movesOf.get(productId) ?? []).toSorted((a, b) => a.at.localeCompare(b.at));
    const reserved = waiting.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
    if (moves.length === 0) {
      return { productId, tracked: false, start: 0, startAt: null, counted: false, arrived: 0, adjusted: 0, soldOrders: 0, soldDirect: 0, stock: 0, reserved, available: 0, state: "untracked" };
    }
    const lastCount = moves.findLast((move) => move.kind === "count");
    const start = lastCount?.quantity ?? 0;
    // Never counted: start from 0 just before the first arrival (its own pieces are added below).
    const startAt = lastCount?.at ?? moves[0].at;
    const after = (at: string) => (lastCount ? at > startAt : at >= startAt);
    const later = moves.filter((move) => move !== lastCount && after(move.at));
    const arrived = later.filter((move) => move.kind === "arrival").reduce((sum, move) => sum + move.quantity, 0);
    const adjusted = later.filter((move) => move.kind === "adjust").reduce((sum, move) => sum + move.quantity, 0);
    const soldOrders = sold.filter((line) => line.productId === productId && line.at > startAt).reduce((sum, line) => sum + line.quantity, 0);
    const soldDirect = direct.filter((line) => line.productId === productId && line.at > startAt).reduce((sum, line) => sum + line.quantity, 0);
    const stock = start + arrived + adjusted - soldOrders - soldDirect;
    const available = stock - reserved;
    return {
      productId,
      tracked: true,
      start,
      startAt,
      counted: Boolean(lastCount),
      arrived,
      adjusted,
      soldOrders,
      soldDirect,
      stock,
      reserved,
      available,
      state: stock <= 0 ? "out" : available <= LOW_STOCK ? "low" : "ok",
    };
  });
}
