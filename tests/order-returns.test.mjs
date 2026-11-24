import test from "node:test";
import assert from "node:assert/strict";
import { setPriceClock } from "../lib/site-data.ts";

// Prices go up after the offer countdown: tests use a fixed time before it.
setPriceClock(() => Date.parse("2026-11-20T12:00:00+02:00"));

import { courierCollection, matchesChoice, mergeAllOrders } from "../lib/all-orders.ts";
import { confirmedValueOf } from "../lib/analytics-report.ts";
import { buildFinanceReport } from "../lib/finance.ts";
import { buildStock } from "../lib/inventory.ts";
import { sanitizeOldOrder } from "../lib/old-orders.ts";
import { backInStock, keptLines, returnedAmount, sanitizeReturns } from "../lib/order-returns.ts";
import { buildPiecesReport, goodsTotal } from "../lib/piece-analytics.ts";
import { buildQuantitySummary } from "../lib/quantity-summary.ts";

const ROBE = "bm-robe-003";
const ABAYA = "bm-abaya-002";
const products = [{ modelId: ROBE, category: "robes", quantity: 2, fit: "روب" }, { modelId: ABAYA, category: "abayas", quantity: 1, fit: "" }];
function site(orderId, status, extra = {}) {
  return { orderId, createdAt: "2026-11-10T10:00:00.000Z", day: "2026-11-10", subtotal: 850, shippingCost: 80, total: 930, governorate: "القاهرة", offerName: "بدون عرض — قطع منفردة", products, firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: "2026-11-10T12:00:00.000Z", confirmedValue: null, soldAt: "2026-11-10T12:00:00.000Z", ...extra };
}
const ret = (modelId, quantity, amount, state, stateAt = "2026-11-15T10:00:00.000Z") => ({ id: `r${modelId.replace(/\W/g, "")}${state.length}`, modelId, quantity, amount, state, at: "2026-11-14T10:00:00.000Z", stateAt, note: "" });
const NOW = new Date("2026-11-20T10:00:00.000Z");
let next = 0;
const makeId = () => `rtest${++next}`;

test("sanitize: pieces from the order only, never more than ordered, a clear state", () => {
  const ok = sanitizeReturns([{ modelId: ABAYA, quantity: 1, amount: 350, state: "with_courier", note: "  المقاس   صغير " }], products, undefined, NOW, makeId);
  assert.ok("returns" in ok);
  assert.deepEqual(ok.returns[0], { id: "rtest1", modelId: ABAYA, quantity: 1, amount: 350, state: "with_courier", at: NOW.toISOString(), stateAt: NOW.toISOString(), note: "المقاس صغير" });
  assert.ok("error" in sanitizeReturns([{ modelId: "bm-robe-999", quantity: 1, amount: 0, state: "in_stock" }], products, undefined, NOW, makeId));
  assert.ok("error" in sanitizeReturns([{ modelId: ABAYA, quantity: 2, amount: 0, state: "in_stock" }], products, undefined, NOW, makeId), "more than ordered");
  assert.ok("error" in sanitizeReturns([{ modelId: ROBE, quantity: 1, amount: 0, state: "in_stock" }, { modelId: ROBE, quantity: 2, amount: 0, state: "in_stock" }], products, undefined, NOW, makeId), "two rows add up past the order");
  assert.ok("error" in sanitizeReturns([{ modelId: ABAYA, quantity: 1, amount: -5, state: "in_stock" }], products, undefined, NOW, makeId));
  assert.ok("error" in sanitizeReturns([{ modelId: ABAYA, quantity: 1, amount: 0, state: "lost" }], products, undefined, NOW, makeId));
  assert.deepEqual(sanitizeReturns([], products, undefined, NOW, makeId), { returns: [] }, "an empty list removes them all");
});

test("sanitize: an existing return keeps its first time; the state time moves only with the state", () => {
  const before = [ret(ABAYA, 1, 350, "with_courier", "2026-11-15T10:00:00.000Z")];
  const same = sanitizeReturns([{ id: before[0].id, modelId: ABAYA, quantity: 1, amount: 300, state: "with_courier" }], products, before, NOW, makeId);
  assert.equal(same.returns[0].id, before[0].id);
  assert.equal(same.returns[0].at, "2026-11-14T10:00:00.000Z");
  assert.equal(same.returns[0].stateAt, "2026-11-15T10:00:00.000Z");
  assert.equal(same.returns[0].amount, 300);
  const moved = sanitizeReturns([{ id: before[0].id, modelId: ABAYA, quantity: 1, amount: 350, state: "in_stock" }], products, before, NOW, makeId);
  assert.equal(moved.returns[0].stateAt, NOW.toISOString());
  assert.equal(moved.returns[0].at, "2026-11-14T10:00:00.000Z");
});

test("kept lines: same lines, returned pieces taken out", () => {
  const lines = [{ modelId: ROBE, quantity: 1 }, { modelId: ROBE, quantity: 2 }, { modelId: ABAYA, quantity: 1 }];
  assert.deepEqual(keptLines(lines, [ret(ROBE, 2, 0, "in_stock"), ret(ABAYA, 1, 0, "with_customer")]).map((line) => line.quantity), [0, 1, 0]);
  assert.equal(keptLines(lines, undefined), lines);
  assert.equal(returnedAmount([ret(ROBE, 1, 250, "in_stock"), ret(ABAYA, 1, 349.5, "in_stock")]), 599.5);
  assert.deepEqual(backInStock([ret(ROBE, 1, 0, "with_courier"), ret(ABAYA, 1, 0, "in_stock", "2026-11-16T00:00:00.000Z")]), [{ productId: ABAYA, quantity: 1, at: "2026-11-16T00:00:00.000Z" }]);
});

test("the order: history kept, value and courier collection less the returned piece", () => {
  const returns = [ret(ABAYA, 1, 350, "with_courier")];
  const order = site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { returns });
  assert.equal(confirmedValueOf(order), 580);
  assert.equal(confirmedValueOf({ ...order, confirmedValue: 900 }), 550, "a collected amount entered earlier also loses the returned piece");
  const [row] = mergeAllOrders([{ order, details: null }], []);
  assert.equal(row.products.reduce((sum, line) => sum + line.quantity, 0), 3, "all the pieces she ordered stay in the order");
  assert.deepEqual(row.returns, returns);
  assert.equal(row.value, 580);
  assert.equal(courierCollection(row).amount, 580);
  assert.equal(matchesChoice(row, [], { returns: true }), true);
  assert.equal(matchesChoice(row, [], { "return-open": true }), true);
  assert.equal(matchesChoice({ ...row, returns: [ret(ABAYA, 1, 350, "in_stock")] }, [], { "return-open": true }), false);
  assert.equal(matchesChoice({ ...row, returns: [] }, [], { returns: false }), true);
});

test("finance: the returned piece is neither sold nor a products cost", () => {
  const costs = { [ROBE]: { productId: ROBE, cost: 150, factory: "", updatedAt: "" }, [ABAYA]: { productId: ABAYA, cost: 200, factory: "", updatedAt: "" } };
  const base = buildFinanceReport({ live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered")], old: [], costs, expenses: [] });
  const after = buildFinanceReport({ live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { returns: [ret(ABAYA, 1, 350, "with_customer")] })], old: [], costs, expenses: [] });
  assert.equal(base.totals.sales, 850);
  assert.equal(base.totals.productsCost, 500);
  assert.equal(after.totals.sales, 500);
  assert.equal(after.totals.productsCost, 300);
  assert.equal(after.totals.netProfit, 200);
});

test("finance: a Telegram order with a returned piece", () => {
  const order = sanitizeOldOrder({ orderId: "BM-CCCCCCCCCCCCCCCCCCC1", createdAt: "2026-11-08T10:00:00.000Z", status: "delivered", customerName: "هالة", phone: "01198765432", governorate: "الجيزة", area: "الدقي", address: "عنوان", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: ABAYA, name: "عباية", size: "", color: "", quantity: 2, unitPrice: 350 }], itemsTotal: 700, shippingCost: 80, total: 780 });
  const costs = { [ABAYA]: { productId: ABAYA, cost: 200, factory: "", updatedAt: "" } };
  const report = buildFinanceReport({ live: [], old: [{ ...order, returns: [ret(ABAYA, 1, 350, "in_stock")] }], costs, expenses: [] });
  assert.equal(report.totals.sales, 350);
  assert.equal(report.totals.productsCost, 200);
});

test("stock: the returned piece comes back only once it reached us, from that time", () => {
  const move = (kind, quantity, at) => ({ id: `${kind}-${at}`, productId: ABAYA, kind, quantity, at, note: "" });
  const stock = (returns, moves = [move("count", 5, "2026-11-01T00:00:00.000Z")]) => buildStock({ productIds: [ABAYA], moves, live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { returns })], old: [], direct: [] })[0].stock;
  assert.equal(stock(undefined), 4);
  assert.equal(stock([ret(ABAYA, 1, 350, "with_customer")]), 4, "still with her: not in the stock");
  assert.equal(stock([ret(ABAYA, 1, 350, "with_courier")]), 4, "with the shipping company: not in the stock");
  assert.equal(stock([ret(ABAYA, 1, 350, "in_stock")]), 5, "back with us");
  // Counted after it came back: the count already has it.
  assert.equal(stock([ret(ABAYA, 1, 350, "in_stock", "2026-11-15T10:00:00.000Z")], [move("count", 7, "2026-11-16T00:00:00.000Z")]), 7);
  // A whole order returned: every piece back, the partial return does not count twice.
  assert.equal(buildStock({ productIds: [ABAYA], moves: [move("count", 5, "2026-11-01T00:00:00.000Z")], live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "returned", { returns: [ret(ABAYA, 1, 350, "in_stock")] })], old: [], direct: [] })[0].stock, 5);
});

test("pieces analysis and the factory summary leave the returned piece out", () => {
  const order = site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { returns: [ret(ROBE, 1, 250, "with_courier")] });
  const pieces = buildPiecesReport({ live: [order], old: [], direct: [], stock: [], moves: [], from: "2026-11-01", to: "2026-11-30" });
  assert.equal(pieces.totals.sold, 2);
  assert.equal(pieces.totals.returned, 1);
  assert.equal(pieces.totals.returning, 1, "with the shipping company: still on its way back");
  assert.equal(pieces.totals.delivered, 2);
  assert.equal(goodsTotal(pieces).returning, 1);
  const home = buildPiecesReport({ live: [{ ...order, returns: [ret(ROBE, 1, 250, "in_stock")] }], old: [], direct: [], stock: [], moves: [], from: "2026-11-01", to: "2026-11-30" });
  assert.equal(home.totals.returning, 0);
  const summary = buildQuantitySummary({ live: [{ order, fits: [] }], old: [] });
  const robe = summary.products.find((row) => row.productId === ROBE);
  assert.equal(robe.pieces.delivered, 1);
});
