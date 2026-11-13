import test from "node:test";
import assert from "node:assert/strict";

import { directSaleMoney, sanitizeDirectSale } from "../lib/direct-sales.ts";
import { buildFinanceReport, sanitizeExpense } from "../lib/finance.ts";

const NOW = new Date("2026-11-13T10:00:00Z");
const costs = { "bm-robe-003": { cost: 120 } };

test("direct sale: store product takes its factory cost; something not on the site needs a name", () => {
  const result = sanitizeDirectSale({
    date: "2026-11-12",
    buyer: "  صاحبتي   منى ",
    extraCost: "30",
    lines: [
      { productId: "bm-robe-003", quantity: 2, unitPrice: 230 },
      { productId: "", name: "شنطة", quantity: 1, unitPrice: 150, unitCost: 90 },
    ],
  }, "s1", costs, NOW);
  assert.ok("sale" in result);
  const { sale } = result;
  assert.equal(sale.buyer, "صاحبتي منى");
  assert.equal(sale.lines[0].name, "روب فرو بطبعة نمر", "name from the store");
  assert.equal(sale.lines[0].unitCost, 120, "factory cost filled in");
  assert.deepEqual(directSaleMoney(sale), { pieces: 3, sales: 610, productsCost: 330, extraCost: 30, profit: 250, missingCostLines: 0 });
});

test("direct sale: a typed factory cost wins; unknown cost is flagged, not guessed", () => {
  const typed = sanitizeDirectSale({ date: "2026-11-12", lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: 250, unitCost: 100 }] }, "s2", costs, NOW);
  assert.equal(typed.sale.lines[0].unitCost, 100);
  const unknown = sanitizeDirectSale({ date: "2026-11-12", lines: [{ productId: "", name: "طرحة", quantity: 1, unitPrice: 80 }] }, "s3", costs, NOW);
  assert.deepEqual(directSaleMoney(unknown.sale), { pieces: 1, sales: 80, productsCost: 0, extraCost: 0, profit: 80, missingCostLines: 1 });
});

test("direct sale: clear messages for bad input", () => {
  const error = (body) => sanitizeDirectSale(body, "x", costs, NOW).error;
  assert.equal(error({ lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: 1 }] }), "اختاري التاريخ.");
  assert.equal(error({ date: "2026-11-12", lines: [] }), "ضيفي قطعة واحدة على الأقل.");
  assert.match(error({ date: "2026-11-12", lines: [{ productId: "nope", quantity: 1, unitPrice: 1 }] }), /مش موجود/);
  assert.match(error({ date: "2026-11-12", lines: [{ productId: "", name: "", quantity: 1, unitPrice: 1 }] }), /اسم الحاجة/);
  assert.match(error({ date: "2026-11-12", lines: [{ productId: "bm-robe-003", quantity: 0, unitPrice: 1 }] }), /العدد/);
  assert.match(error({ date: "2026-11-12", lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: "" }] }), /سعر القطعة/);
  assert.match(error({ date: "2026-11-12", lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: 5, unitCost: -1 }] }), /سعر المصنع/);
  assert.match(error({ date: "2026-11-12", extraCost: "abc", lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: 5 }] }), /المصاريف/);
});

test("direct sales join the finance totals; the month's expenses stay on online orders", () => {
  const sale = sanitizeDirectSale({ date: "2026-11-12", extraCost: 30, lines: [{ productId: "bm-robe-003", quantity: 2, unitPrice: 230 }] }, "s1", costs, NOW).sale;
  const before = sanitizeDirectSale({ date: "2026-10-01", lines: [{ productId: "bm-robe-003", quantity: 1, unitPrice: 250 }] }, "s0", costs, NOW).sale;
  const order = { orderId: "BM-AAAAAAAAAAAAAAAAAAA1", createdAt: "2026-11-10T10:00:00Z", day: "2026-11-10", subtotal: 500, shippingCost: 80, total: 580, governorate: "", offerName: "", products: [{ modelId: "bm-robe-003", category: "robes", quantity: 2 }], firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status: "confirmed", statusAt: null, confirmedValue: null, costSnapshot: { unitCosts: [120], at: NOW.toISOString() } };
  const expenses = [sanitizeExpense({ name: "إعلانات", category: "ads", amount: 100, date: "2026-11-05", notes: "" }, "e1", NOW)];
  const report = buildFinanceReport({ live: [order], old: [], costs: {}, expenses, direct: [sale, before], from: "2026-11-01", to: "2026-11-30" });
  // Online: 580 − 240 − 100 = 240. Direct: 460 − 240 − 30 = 190.
  assert.deepEqual(report.direct, { count: 1, pieces: 2, sales: 460, productsCost: 240, extraCost: 30, profit: 190, missingCostLines: 0 }, "October sale outside the dates");
  assert.deepEqual(report.totals, { sales: 1040, productsCost: 480, expenses: 100, stockPurchases: 0, netProfit: 430 });
  assert.equal(report.orders[0].expenseShare, 100, "ads carried by the online order only");
  assert.equal(report.stages.confirmed.netProfit + report.stages.delivered.netProfit + report.direct.profit, report.totals.netProfit);
});
