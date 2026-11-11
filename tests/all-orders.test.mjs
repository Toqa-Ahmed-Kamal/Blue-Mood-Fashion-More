import test from "node:test";
import assert from "node:assert/strict";

import { filterCounts, matchesFilter, matchesSearch, mergeAllOrders } from "../lib/all-orders.ts";
import { isSaleStatus } from "../lib/analytics-report.ts";
import { buildFinanceReport } from "../lib/finance.ts";
import { sanitizeOldOrder } from "../lib/old-orders.ts";

function site(orderId, status, extra = {}) {
  return { orderId, createdAt: "2026-11-10T10:00:00.000Z", day: "2026-11-10", subtotal: 250, shippingCost: 80, total: 330, governorate: "القاهرة", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-robe-003", category: "robes", quantity: 1, fit: "روب" }], firstTouch: null, lastTouch: null, source: "Facebook Ads", sourceType: "Paid", campaign: "winter_2026", adContent: "", landingPage: "/", status, statusAt: null, confirmedValue: null, ...extra };
}
const details = (orderId) => ({ orderId, createdAt: "2026-11-10T10:00:00.000Z", customerName: "منى", phone: "01012345678", alternatePhone: "", governorate: "القاهرة", area: "مدينة نصر", address: "عنوان", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-robe-003", name: "روب فرو بطبعة نمر", category: "robes", fit: "روب", quantity: 1, unitPrice: 250, link: null }], offerPrice: 0, itemsTotal: 250, subtotal: 250, shippingCost: 80, total: 330, notes: "" });
const old = (orderId, status, extra = {}) => sanitizeOldOrder({ orderId, createdAt: "2026-11-08T10:00:00.000Z", status, customerName: "هالة", phone: "01198765432", governorate: "الجيزة", area: "الدقي", address: "عنوان قديم", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-abaya-002", name: "عباية", size: "", color: "", quantity: 1, unitPrice: 350 }], itemsTotal: 350, shippingCost: 80, total: 430, ...extra });

const live = [
  { order: site("BM-AAAAAAAAAAAAAAAAAAA1", "submitted"), details: details("BM-AAAAAAAAAAAAAAAAAAA1") },
  // Placed before details were stored: its Telegram copy fills the customer in.
  { order: site("BM-AAAAAAAAAAAAAAAAAAA2", "confirmed", { deposit: { amount: 80, at: "2026-11-10T11:00:00Z" } }), details: null },
  { order: site("BM-AAAAAAAAAAAAAAAAAAA3", "delivered"), details: details("BM-AAAAAAAAAAAAAAAAAAA3") },
];
const oldOrders = [
  { ...old("BM-AAAAAAAAAAAAAAAAAAA2", "cancelled"), customerName: "من تيليجرام" },
  old("BM-BBBBBBBBBBBBBBBBBBB1", "cancelled"),
  { ...old("BM-BBBBBBBBBBBBBBBBBBB2", "returned"), deposit: { amount: 50, at: "2026-11-09T10:00:00Z" } },
];

test("one list: every site order and every old order once; site status wins; Telegram fills missing customer details", () => {
  const rows = mergeAllOrders(live, oldOrders);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((row) => row.orderId)).size, 5, "no duplicates");
  const filled = rows.find((row) => row.orderId === "BM-AAAAAAAAAAAAAAAAAAA2");
  assert.equal(filled.source, "site");
  assert.equal(filled.status, "confirmed", "the site status, not the Telegram copy's");
  assert.equal(filled.customerName, "من تيليجرام");
  assert.equal(filled.hasCustomer, true);
  assert.equal(filled.deposit.amount, 80);
  assert.equal(rows.find((row) => row.orderId === "BM-AAAAAAAAAAAAAAAAAAA1").customerName, "منى");
  assert.equal(rows.find((row) => row.orderId === "BM-BBBBBBBBBBBBBBBBBBB1").source, "telegram");
  assert.deepEqual(rows.map((row) => row.createdAt), rows.map((row) => row.createdAt).toSorted().reverse(), "newest first");
});

test("filters: pending, confirmed, deposit paid, delivered, returned, cancelled — with counts", () => {
  const rows = mergeAllOrders(live, oldOrders);
  assert.deepEqual(filterCounts(rows), { all: 5, submitted: 1, confirmed: 1, deposit: 2, delivered: 1, returned: 1, cancelled: 1 });
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "deposit")).map((row) => row.orderId).sort(), ["BM-AAAAAAAAAAAAAAAAAAA2", "BM-BBBBBBBBBBBBBBBBBBB2"]);
});

test("search: order number, name, phone in any format, place, product", () => {
  const rows = mergeAllOrders(live, oldOrders);
  const find = (query) => rows.filter((row) => matchesSearch(row, query)).map((row) => row.orderId).sort();
  assert.deepEqual(find("+20 101 234 5678"), ["BM-AAAAAAAAAAAAAAAAAAA1", "BM-AAAAAAAAAAAAAAAAAAA3"]);
  assert.deepEqual(find("هالة الدقي"), ["BM-BBBBBBBBBBBBBBBBBBB1", "BM-BBBBBBBBBBBBBBBBBBB2"]);
  assert.equal(find("نمر").length, 3);
  assert.equal(find("").length, 5);
});

test("delivered is a sale: counted in sales and products cost like confirmed", () => {
  assert.equal(isSaleStatus("delivered"), true);
  assert.equal(isSaleStatus("returned"), false);
  const report = buildFinanceReport({
    live: [site("BM-CCCCCCCCCCCCCCCCCCC1", "delivered", { costSnapshot: { unitCosts: [120], at: "2026-11-10T10:00:00Z" } }), site("BM-CCCCCCCCCCCCCCCCCCC2", "returned")],
    old: [],
    costs: {},
    expenses: [],
  });
  assert.equal(report.totals.sales, 330);
  assert.equal(report.totals.productsCost, 120);
  assert.equal(report.counts.confirmedOrders, 1);
});
