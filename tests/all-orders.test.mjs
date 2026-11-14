import test from "node:test";
import assert from "node:assert/strict";

import { courierCollection, courierText, filterCounts, matchesFilter, matchesSearch, mergeAllOrders } from "../lib/all-orders.ts";
import { applyCourierStep, isSaleStatus, parseCourierChange } from "../lib/analytics-report.ts";
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
  assert.deepEqual(filterCounts(rows), { all: 5, submitted: 1, confirmed: 1, deposit: 2, "to-ship": 1, "with-courier": 0, delivered: 1, returned: 1, cancelled: 1 });
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

test("shipping company: copied details with collection (shipping included, less the deposit) and inspection allowed", () => {
  const rows = mergeAllOrders([
    { order: site("BM-CCCCCCCCCCCCCCCCCCC1", "confirmed", { products: [{ modelId: "bm-robe-003", category: "robes", quantity: 2 }], subtotal: 500, total: 580 }), details: { ...details("BM-CCCCCCCCCCCCCCCCCCC1"), alternatePhone: "01111111111", address: "شارع ٩\nالدور ٣", products: [{ modelId: "bm-robe-003", name: "روب فرو بطبعة نمر", category: "robes", fit: "روب", quantity: 2, unitPrice: 250, link: null }, { modelId: "bm-abaya-001", name: "عباية", category: "abayas", fit: "", quantity: 1, unitPrice: 0, link: null }] } },
  ], []);
  const order = { ...rows[0], deposit: { amount: 80, at: "2026-11-10T11:00:00Z" } };
  assert.equal(courierText(order), [
    "الاسم: منى",
    "رقم التليفون: 01012345678 / 01111111111",
    "المحافظة: القاهرة",
    "المنطقة: مدينة نصر",
    "العنوان: شارع ٩ الدور ٣",
    "التحصيل (شامل الشحن): 500 ج.م",
    "المحتوى: 3 قطع",
    "- روب فرو بطبعة نمر × 2",
    "- عباية",
    "متاح المعاينة: نعم",
    "رقم الأوردر: BM-CCCCCCCCCCCCCCCCCCC1",
  ].join("\n"));
});

test("shipping company: collection when the shipping is not set yet uses the governorate rate; unknown stays empty", () => {
  const base = { total: null, value: 1100, shippingCost: null, deposit: null };
  assert.deepEqual(courierCollection({ ...base, governorate: "الجيزة" }), { amount: 1180, shippingGuessed: true, shippingFee: 80 });
  assert.deepEqual(courierCollection({ ...base, governorate: "مكان مش معروف" }), { amount: null, shippingGuessed: false, shippingFee: null });
  assert.deepEqual(courierCollection({ ...base, total: 430, shippingCost: 80, governorate: "الجيزة", deposit: { amount: 500, at: "" } }), { amount: 0, shippingGuessed: false, shippingFee: 80 }, "never below zero");
});

test("shipping company steps: handed means told too; untelling clears both; filters", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const told = applyCourierStep(undefined, "notified", true, now);
  assert.deepEqual(told, { notifiedAt: now.toISOString() });
  const handed = applyCourierStep(undefined, "handed", true, now);
  assert.deepEqual(handed, { notifiedAt: now.toISOString(), handedAt: now.toISOString() });
  assert.deepEqual(applyCourierStep(handed, "handed", false, now), { notifiedAt: now.toISOString() });
  assert.equal(applyCourierStep(handed, "notified", false, now), undefined);
  assert.deepEqual(applyCourierStep(told, "notified", true, new Date("2026-11-15T00:00:00Z")), told, "marking again keeps the first time");
  assert.equal(parseCourierChange({ step: "handed", done: "yes" }), null);
  assert.deepEqual(parseCourierChange({ step: "handed", done: true }), { step: "handed", done: true });

  const rows = mergeAllOrders([
    { order: site("BM-DDDDDDDDDDDDDDDDDDD1", "confirmed"), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD2", "confirmed", { courier: handed }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD3", "delivered", { courier: handed }), details: null },
  ], []);
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "to-ship")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD1"]);
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "with-courier")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD2"]);
  assert.deepEqual(rows.find((row) => row.orderId === "BM-DDDDDDDDDDDDDDDDDDD3").courier, handed);
});
