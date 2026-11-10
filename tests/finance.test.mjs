import test from "node:test";
import assert from "node:assert/strict";

import { buildFinanceReport, sanitizeExpense, sanitizeProductCost, snapshotCosts } from "../lib/finance.ts";
import { sanitizeOldOrder } from "../lib/old-orders.ts";

const NOW = new Date("2026-11-11T10:00:00Z");
const cost = (productId, value, factory = "مصنع") => ({ productId, factory, cost: value, updatedAt: NOW.toISOString() });
function site(orderId, day, status, products, extra = {}) {
  return { orderId, createdAt: `${day}T10:00:00.000Z`, day, subtotal: 0, shippingCost: null, total: null, governorate: "", offerName: "", products, firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: null, confirmedValue: null, ...extra };
}
function old(orderId, createdAt, status, products, extra = {}) {
  return { ...sanitizeOldOrder({ orderId, createdAt, status, products, offerName: "", ...extra }), ...(extra.costSnapshot ? { costSnapshot: extra.costSnapshot } : {}) };
}
const line = (modelId, quantity, unitPrice = null) => ({ modelId, name: modelId, size: "", color: "", quantity, unitPrice });

const costs = { "bm-robe-003": cost("bm-robe-003", 120), "bm-abaya-001": cost("bm-abaya-001", 200) };
const expenses = [
  sanitizeExpense({ name: "إعلان فيسبوك", category: "ads", amount: 300, date: "2026-11-09", notes: "" }, "e1", NOW),
  sanitizeExpense({ name: "شحن شركة", category: "order-shipping", amount: 150, date: "2026-11-10", notes: "" }, "e2", NOW),
  sanitizeExpense({ name: "شحن مرتجع", category: "returns-shipping", amount: 60, date: "2026-11-10", notes: "" }, "e3", NOW),
];

const live = [
  // Confirmed with the collected amount entered (includes the customer's shipping) and a cost snapshot taken at confirmation.
  site("BM-AAAAAAAAAAAAAAAAAAA1", "2026-11-09", "confirmed", [{ modelId: "bm-robe-003", category: "robes", quantity: 2 }], { total: 580, confirmedValue: 580, costSnapshot: { unitCosts: [100], at: "2026-11-09T12:00:00Z" } }),
  // Confirmed before costs existed: today's cost, marked estimated. Value falls back to the total.
  site("BM-AAAAAAAAAAAAAAAAAAA2", "2026-11-10", "confirmed", [{ modelId: "bm-abaya-001", category: "abayas", quantity: 1 }], { subtotal: 350, shippingCost: 80, total: 430, costSnapshot: { unitCosts: [null], at: "2026-11-10T12:00:00Z" } }),
  site("BM-AAAAAAAAAAAAAAAAAAA3", "2026-11-10", "cancelled", [{ modelId: "bm-robe-003", category: "robes", quantity: 5 }], { total: 1330 }),
  site("BM-AAAAAAAAAAAAAAAAAAA4", "2026-11-10", "returned", [{ modelId: "bm-abaya-001", category: "abayas", quantity: 1 }], { total: 430, costSnapshot: { unitCosts: [200], at: "2026-11-10T12:00:00Z" } }),
  site("BM-AAAAAAAAAAAAAAAAAAA5", "2026-11-10", "submitted", [{ modelId: "bm-abaya-001", category: "abayas", quantity: 3 }], { total: 1130 }),
];
const oldOrders = [
  // Telegram copy of site order 1: must not count twice.
  old("BM-AAAAAAAAAAAAAAAAAAA1", "2026-11-09T08:00:00Z", "confirmed", [line("bm-robe-003", 2, 250)], { itemsTotal: 500 }),
  // Old confirmed order, no snapshot (confirmed before costs) → estimated; one product has no cost at all → missing.
  old("BM-BBBBBBBBBBBBBBBBBBB1", "2026-11-08T08:00:00Z", "confirmed", [line("bm-robe-003", 1, 250), line("bm-winter-pajama-002", 4)], { offerPrice: 1100, itemsTotal: 250, shippingCost: 80, total: 1430 }),
  old("BM-BBBBBBBBBBBBBBBBBBB2", "2026-11-08T08:00:00Z", "submitted", [line("bm-robe-003", 9, 250)], { itemsTotal: 2250 }),
];

test("sales, products cost, expenses and net profit follow the agreed rules", () => {
  const report = buildFinanceReport({ live, old: oldOrders, costs, expenses });
  // Sales: 580 (A1 collected) + 430 (A2 total incl. shipping) + 1430 (B1 total) = 2440. Cancelled, returned, pending: not sales.
  assert.equal(report.totals.sales, 2440);
  // Cost: A1 2 × 100 (snapshot, not today's 120) + A2 1 × 200 (estimated) + B1 1 × 120 (estimated; pajama-002 has no cost) = 520.
  assert.equal(report.totals.productsCost, 520);
  assert.equal(report.totals.expenses, 510);
  assert.equal(report.totals.netProfit, 2440 - 520 - 510);
  assert.deepEqual(report.counts, { confirmedOrders: 3, returnedOrders: 1, estimatedOrders: 1, missingCostOrders: 1, expenses: 3 });
  assert.equal(report.returnedValue, 430);
  const rows = Object.fromEntries(report.orders.map((row) => [row.orderId, row]));
  assert.equal(rows["BM-AAAAAAAAAAAAAAAAAAA1"].source, "site", "an order in both is the site order");
  assert.equal(rows["BM-AAAAAAAAAAAAAAAAAAA1"].costState, "exact");
  assert.equal(rows["BM-AAAAAAAAAAAAAAAAAAA2"].costState, "estimated");
  assert.equal(rows["BM-BBBBBBBBBBBBBBBBBBB1"].costState, "missing");
  assert.equal(rows["BM-BBBBBBBBBBBBBBBBBBB1"].missingLines, 1);
  assert.deepEqual([rows["BM-AAAAAAAAAAAAAAAAAAA4"].sales, rows["BM-AAAAAAAAAAAAAAAAAAA4"].productsCost], [0, 0], "returned: no sale, no cost (deducted nowhere)");
  assert.equal(rows["BM-AAAAAAAAAAAAAAAAAAA3"], undefined, "cancelled not listed");
  assert.equal(report.expensesByCategory.find((row) => row.category === "returns-shipping").amount, 60, "return shipping is its own expense");
});

test("a later factory price change does not change an order confirmed earlier", () => {
  const before = buildFinanceReport({ live, old: oldOrders, costs, expenses: [] });
  const after = buildFinanceReport({ live, old: oldOrders, costs: { ...costs, "bm-robe-003": cost("bm-robe-003", 999) }, expenses: [] });
  const row = (report) => report.orders.find((item) => item.orderId === "BM-AAAAAAAAAAAAAAAAAAA1");
  assert.equal(row(before).productsCost, 200);
  assert.equal(row(after).productsCost, 200);
});

test("date filter: orders by order day, expenses by expense day", () => {
  const report = buildFinanceReport({ live, old: oldOrders, costs, expenses, from: "2026-11-10", to: "2026-11-10" });
  assert.deepEqual(report.orders.map((row) => row.orderId).sort(), ["BM-AAAAAAAAAAAAAAAAAAA2", "BM-AAAAAAAAAAAAAAAAAAA4"]);
  assert.equal(report.totals.sales, 430);
  assert.equal(report.totals.expenses, 210);
  const bad = buildFinanceReport({ live, old: oldOrders, costs, expenses, from: "nonsense" });
  assert.equal(bad.range.from, null, "an invalid date is ignored, not crashed on");
});

test("old order confirmed with its own snapshot uses it", () => {
  const withSnapshot = [old("BM-CCCCCCCCCCCCCCCCCCC1", "2026-11-08T08:00:00Z", "confirmed", [line("bm-robe-003", 3, 250)], { itemsTotal: 750, costSnapshot: { unitCosts: [90], at: "2026-11-08T09:00:00Z" } })];
  const report = buildFinanceReport({ live: [], old: withSnapshot, costs, expenses: [] });
  assert.equal(report.totals.productsCost, 270);
  assert.equal(report.orders[0].costState, "exact");
});

test("input checks for costs and expenses", () => {
  assert.equal(sanitizeProductCost("not-a-product", { cost: 10 }), null);
  assert.equal(sanitizeProductCost("bm-robe-003", { cost: -1 }), null);
  assert.deepEqual(sanitizeProductCost("bm-robe-003", { factory: "  مصنع   النور ", cost: "" }, NOW), { productId: "bm-robe-003", factory: "مصنع النور", cost: null, updatedAt: NOW.toISOString() });
  assert.equal(sanitizeExpense({ name: "x", category: "rent", amount: 10, date: "2026-11-10" }, "id"), null, "unknown category");
  assert.equal(sanitizeExpense({ name: "x", category: "ads", amount: 0, date: "2026-11-10" }, "id"), null, "zero amount");
  assert.equal(sanitizeExpense({ name: "", category: "ads", amount: 10, date: "2026-11-10" }, "id"), null);
  assert.equal(sanitizeExpense({ name: "x", category: "ads", amount: 10, date: "10/11/2026" }, "id"), null);
  assert.deepEqual(snapshotCosts(["bm-robe-003", "bm-x"], costs, NOW), { unitCosts: [120, null], at: NOW.toISOString() });
});
