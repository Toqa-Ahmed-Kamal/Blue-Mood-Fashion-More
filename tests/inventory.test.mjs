import test from "node:test";
import assert from "node:assert/strict";

import { buildStock, sanitizeStockMove } from "../lib/inventory.ts";
import { sanitizeOldOrder } from "../lib/old-orders.ts";

const ROBE = "bm-robe-003";
const move = (kind, quantity, at, productId = ROBE) => ({ id: `${kind}-${at}`, productId, kind, quantity, at, note: "" });
function site(orderId, status, quantity, extra = {}) {
  return { orderId, createdAt: "2026-11-01T10:00:00.000Z", day: "2026-11-01", subtotal: 0, shippingCost: null, total: null, governorate: "", offerName: "", products: [{ modelId: ROBE, category: "robes", quantity }], firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: null, confirmedValue: null, ...extra };
}
const direct = (quantity, createdAt) => ({ id: createdAt, date: createdAt.slice(0, 10), buyer: "", lines: [{ productId: ROBE, name: "روب", quantity, unitPrice: 250, unitCost: 120 }], extraCost: 0, notes: "", createdAt, updatedAt: createdAt });
const stockOf = (input) => buildStock({ productIds: [ROBE], live: [], old: [], direct: [], moves: [], ...input })[0];

test("untracked until a count or an arrival; waiting orders still show as reserved", () => {
  const row = stockOf({ live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "submitted", 2)] });
  assert.equal(row.tracked, false);
  assert.equal(row.state, "untracked");
  assert.equal(row.reserved, 2);
});

test("count − sales after it + arrivals; sales before the count are not taken again", () => {
  const moves = [move("count", 10, "2026-11-10T10:00:00.000Z"), move("arrival", 5, "2026-11-11T10:00:00.000Z"), move("adjust", -1, "2026-11-11T12:00:00.000Z")];
  const live = [
    site("BM-AAAAAAAAAAAAAAAAAAA1", "confirmed", 3, { soldAt: "2026-11-09T10:00:00.000Z" }), // before the count
    site("BM-AAAAAAAAAAAAAAAAAAA2", "confirmed", 2, { soldAt: "2026-11-10T11:00:00.000Z" }),
    site("BM-AAAAAAAAAAAAAAAAAAA3", "delivered", 1, { soldAt: "2026-11-12T11:00:00.000Z" }),
    site("BM-AAAAAAAAAAAAAAAAAAA4", "cancelled", 4, { statusAt: "2026-11-12T11:00:00.000Z" }), // gives its pieces back
    site("BM-AAAAAAAAAAAAAAAAAAA5", "returned", 1, { statusAt: "2026-11-12T11:00:00.000Z" }),
    site("BM-AAAAAAAAAAAAAAAAAAA6", "submitted", 2),
  ];
  const row = stockOf({ moves, live, direct: [direct(1, "2026-11-12T09:00:00.000Z"), direct(5, "2026-11-01T09:00:00.000Z")] });
  assert.deepEqual(
    [row.start, row.arrived, row.adjusted, row.soldOrders, row.soldDirect, row.stock, row.reserved, row.available, row.state],
    [10, 5, -1, 3, 1, 10, 2, 8, "ok"],
  );
});

test("an order without a saved sale time uses its confirmation cost snapshot, then status time", () => {
  const moves = [move("count", 5, "2026-11-10T10:00:00.000Z")];
  const live = [
    site("BM-AAAAAAAAAAAAAAAAAAA1", "confirmed", 1, { costSnapshot: { unitCosts: [120], at: "2026-11-11T10:00:00.000Z" }, statusAt: "2026-11-09T00:00:00.000Z" }),
    site("BM-AAAAAAAAAAAAAAAAAAA2", "confirmed", 1, { statusAt: "2026-11-09T10:00:00.000Z" }),
  ];
  assert.equal(stockOf({ moves, live }).soldOrders, 1);
});

test("a Telegram copy of a site order counts once; Telegram-only orders count too", () => {
  const moves = [move("count", 10, "2026-11-10T10:00:00.000Z")];
  const live = [site("BM-AAAAAAAAAAAAAAAAAAA1", "confirmed", 2, { soldAt: "2026-11-11T10:00:00.000Z" })];
  const old = [
    { ...sanitizeOldOrder({ orderId: "BM-AAAAAAAAAAAAAAAAAAA1", createdAt: "2026-11-11T08:00:00Z", status: "confirmed", products: [{ modelId: ROBE, name: "روب", quantity: 2 }] }), soldAt: "2026-11-11T10:00:00.000Z" },
    { ...sanitizeOldOrder({ orderId: "BM-BBBBBBBBBBBBBBBBBBB1", createdAt: "2026-11-11T08:00:00Z", status: "confirmed", products: [{ modelId: ROBE, name: "روب", quantity: 3 }] }), soldAt: "2026-11-11T12:00:00.000Z" },
  ];
  assert.equal(stockOf({ moves, live, old }).soldOrders, 5);
});

test("low and out: low when what is left after waiting orders is 2 or less; out at 0", () => {
  const moves = [move("count", 3, "2026-11-10T10:00:00.000Z")];
  assert.equal(stockOf({ moves }).state, "ok");
  assert.equal(stockOf({ moves, live: [site("BM-AAAAAAAAAAAAAAAAAAA6", "submitted", 1)] }).state, "low");
  assert.equal(stockOf({ moves, live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "confirmed", 3, { soldAt: "2026-11-11T10:00:00.000Z" })] }).state, "out");
});

test("never counted: starts at 0 with the first arrival", () => {
  const moves = [move("arrival", 6, "2026-11-10T10:00:00.000Z"), move("arrival", 2, "2026-11-12T10:00:00.000Z")];
  const live = [
    site("BM-AAAAAAAAAAAAAAAAAAA1", "confirmed", 9, { soldAt: "2026-11-01T10:00:00.000Z" }), // before any stock: ignored
    site("BM-AAAAAAAAAAAAAAAAAAA2", "confirmed", 1, { soldAt: "2026-11-11T10:00:00.000Z" }),
  ];
  const row = stockOf({ moves, live });
  assert.deepEqual([row.counted, row.arrived, row.soldOrders, row.stock], [false, 8, 1, 7]);
});

test("moves from the admin: clear messages", () => {
  const error = (body) => sanitizeStockMove(body, "id").error;
  assert.equal(error({ productId: "nope", kind: "count", quantity: 1 }), "المنتج مش موجود.");
  assert.equal(error({ productId: ROBE, kind: "x", quantity: 1 }), "نوع الحركة مش معروف.");
  assert.match(error({ productId: ROBE, kind: "count", quantity: -1 }), /الجرد/);
  assert.match(error({ productId: ROBE, kind: "arrival", quantity: 0 }), /وصلت/);
  assert.match(error({ productId: ROBE, kind: "adjust", quantity: 0 }), /الزيادة/);
  assert.match(error({ productId: ROBE, kind: "count", quantity: 1.5 }), /رقم صحيح/);
  const ok = sanitizeStockMove({ productId: ROBE, kind: "adjust", quantity: -2, note: "  تالفة  " }, "id", new Date("2026-11-13T10:00:00Z"));
  assert.deepEqual(ok.move, { id: "id", productId: ROBE, kind: "adjust", quantity: -2, at: "2026-11-13T10:00:00.000Z", note: "تالفة" });
});
