import test from "node:test";
import assert from "node:assert/strict";
import { setPriceClock } from "../lib/site-data.ts";

// Prices go up after the offer countdown: tests use a fixed time before it.
setPriceClock(() => Date.parse("2026-11-20T12:00:00+02:00"));

import { areaOptions, courierCollection, courierText, filterCounts, governorateOptions, matchesFilter, matchesPlace, matchesSearch, mergeAllOrders, placeKey } from "../lib/all-orders.ts";
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
  assert.deepEqual(filterCounts(rows), { all: 5, submitted: 1, "to-call": 1, confirmed: 1, deposit: 2, "to-ship": 1, packed: 0, "courier-notified": 0, "with-courier": 0, delivered: 1, returned: 1, cancelled: 1 });
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
  assert.equal(report.totals.sales, 250, "330 less the customer's 80 shipping");
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
    "المحتوى: ملابس — 3 قطع",
    "متاح المعاينة: نعم",
  ].join("\n"), "only clothes and the number of pieces; no product names, no order number");
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
  const packed = applyCourierStep(undefined, "packed", true, now);
  assert.deepEqual(packed, { packedAt: now.toISOString() });
  assert.equal(applyCourierStep(packed, "packed", false, now), undefined);
  assert.deepEqual(applyCourierStep(packed, "notified", true, now), { packedAt: now.toISOString(), notifiedAt: now.toISOString() });
  assert.deepEqual(parseCourierChange({ step: "packed", done: true }), { step: "packed", done: true });
  assert.equal(parseCourierChange({ step: "handed", done: "yes" }), null);
  assert.deepEqual(parseCourierChange({ step: "handed", done: true }), { step: "handed", done: true });

  const rows = mergeAllOrders([
    { order: site("BM-DDDDDDDDDDDDDDDDDDD1", "confirmed"), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD2", "confirmed", { courier: handed }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD3", "delivered", { courier: handed }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD4", "confirmed", { courier: told }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD5", "cancelled", { courier: told }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD6", "submitted", { courier: packed }), details: null },
    { order: site("BM-DDDDDDDDDDDDDDDDDDD7", "confirmed", { courier: { ...handed, packedAt: now.toISOString() } }), details: null },
  ], []);
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "packed")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD6"], "packed, not picked up yet");
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "courier-notified")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD4"], "told, not picked up yet");
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "to-ship")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD1", "BM-DDDDDDDDDDDDDDDDDDD4"]);
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "with-courier")).map((row) => row.orderId), ["BM-DDDDDDDDDDDDDDDDDDD2", "BM-DDDDDDDDDDDDDDDDDDD7"]);
  assert.deepEqual(rows.find((row) => row.orderId === "BM-DDDDDDDDDDDDDDDDDDD3").courier, handed);
});

test("shipping company: the customer's own note is copied; the site's shipping notes are not", async () => {
  const { customerNote } = await import("../lib/all-orders.ts");
  const [row] = mergeAllOrders([{ order: site("BM-FFFFFFFFFFFFFFFFFFF1", "confirmed"), details: { ...details("BM-FFFFFFFFFFFFFFFFFFF1"), notes: "اتصلوا بعد الساعة ٥\nسعر الشحن مبدئي وقابل للتعديل. الإجمالي تقديري." } }], []);
  assert.match(courierText(row), /\nملاحظات العميل: اتصلوا بعد الساعة ٥$/);
  assert.doesNotMatch(courierText(row), /مبدئي/);
  assert.equal(customerNote("تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ."), "", "only the site's note → nothing");
  assert.equal(customerNote("منطقة غير مخدومة بالشحن العادي (سيوة): سعر الشحن غير محدد، يتأكد من خدمة العملاء قبل التنفيذ."), "");
  assert.equal(customerNote("الدور التالت\nجنب الصيدلية"), "الدور التالت — جنب الصيدلية");
  const [plain] = mergeAllOrders([{ order: site("BM-FFFFFFFFFFFFFFFFFFF2", "confirmed"), details: details("BM-FFFFFFFFFFFFFFFFFFF2") }], []);
  assert.doesNotMatch(courierText(plain), /ملاحظات/, "no note → no line");
});

test("filter 'مستني تأكيد العميل': not received, not cancelled/returned, no deposit, shipping company not told", () => {
  const told = { notifiedAt: "2026-11-14T10:00:00.000Z" };
  const rows = mergeAllOrders([
    { order: site("BM-GGGGGGGGGGGGGGGGGGG1", "submitted"), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG2", "confirmed"), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG3", "confirmed", { deposit: { amount: 100, at: "2026-11-14T10:00:00Z" } }), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG4", "confirmed", { courier: told }), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG5", "delivered"), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG6", "cancelled"), details: null },
    { order: site("BM-GGGGGGGGGGGGGGGGGGG7", "returned"), details: null },
  ], [old("BM-EEEEEEEEEEEEEEEEEEE9", "submitted")]);
  assert.deepEqual(rows.filter((row) => matchesFilter(row, "to-call")).map((row) => row.orderId).sort(), ["BM-EEEEEEEEEEEEEEEEEEE9", "BM-GGGGGGGGGGGGGGGGGGG1", "BM-GGGGGGGGGGGGGGGGGGG2"]);
});

test("margin filter: more / less than an amount; cancelled, returned and orders without numbers are left out", async () => {
  const { matchesMargin, MARGIN_PRESETS } = await import("../lib/all-orders.ts");
  const order = (status, margin) => ({ status, money: margin === undefined ? null : { margin } });
  const range = (id) => MARGIN_PRESETS.find((preset) => preset.id === id).range;
  assert.ok(matchesMargin(order("cancelled", undefined), range("")), "no filter → everything");
  assert.ok(matchesMargin(order("confirmed", 345), range("gte300")));
  assert.ok(!matchesMargin(order("confirmed", 299), range("gte300")));
  assert.ok(matchesMargin(order("submitted", 199.5), range("lt200")));
  assert.ok(!matchesMargin(order("submitted", 200), range("lt200")));
  assert.ok(matchesMargin(order("delivered", 200), range("200-300")));
  assert.ok(!matchesMargin(order("delivered", 300), range("200-300")));
  assert.ok(matchesMargin(order("confirmed", -20), range("loss")));
  assert.ok(!matchesMargin(order("cancelled", 400), range("gte200")), "cancelled has no profit");
  assert.ok(!matchesMargin(order("returned", 400), range("gte200")));
  assert.ok(!matchesMargin(order("confirmed", undefined), range("gte200")));
  assert.ok(matchesMargin(order("confirmed", 250), { min: 240, max: null }), "custom");
});

test("cancel reasons: only from the list, only on cancelled orders, and the reason filter", async () => {
  const { CANCEL_REASONS, parseCancelReason } = await import("../lib/analytics-report.ts");
  const { matchesReason } = await import("../lib/all-orders.ts");
  assert.deepEqual(CANCEL_REASONS.map((reason) => reason.label), ["العميل مأكدش ومش بيرد", "العميل رجع في كلامه", "الأوردر متكرر", "تأخير مننا", "تأخير من شركة الشحن", "لتعديل الطلب", "منتج مش موجود", "العميل هيغير المنتجات", "مكسبه أقل من 50 ج"]);
  assert.equal(parseCancelReason("duplicate"), "duplicate");
  assert.equal(parseCancelReason(null), null, "clear");
  assert.equal(parseCancelReason(""), null, "clear");
  assert.equal(parseCancelReason("anything else"), undefined, "refused");
  const rows = mergeAllOrders([
    { order: site("BM-EEEEEEEEEEEEEEEEEEE1", "cancelled", { cancelReason: "our-delay" }), details: null },
    { order: site("BM-EEEEEEEEEEEEEEEEEEE2", "cancelled"), details: null },
    { order: site("BM-EEEEEEEEEEEEEEEEEEE3", "confirmed"), details: null },
  ], []);
  assert.equal(rows.find((row) => row.orderId === "BM-EEEEEEEEEEEEEEEEEEE1").cancelReason, "our-delay");
  assert.equal(rows.find((row) => row.orderId === "BM-EEEEEEEEEEEEEEEEEEE2").cancelReason, null);
  const pick = (reason) => rows.filter((row) => matchesReason(row, reason)).map((row) => row.orderId);
  assert.deepEqual(pick("our-delay"), ["BM-EEEEEEEEEEEEEEEEEEE1"]);
  assert.deepEqual(pick("none"), ["BM-EEEEEEEEEEEEEEEEEEE2"]);
  assert.equal(pick("").length, 3, "no reason filter: everything");
});

test("net profit filter: works on the net profit (not the margin); cancelled and returned are left out", async () => {
  const { matchesNetProfit, NET_PROFIT_PRESETS } = await import("../lib/all-orders.ts");
  const order = (status, margin, netProfit) => ({ status, money: { margin, netProfit } });
  const range = (id) => NET_PROFIT_PRESETS.find((preset) => preset.id === id).range;
  assert.ok(matchesNetProfit(order("confirmed", 210, 118.6), range("100-200")), "the order from the screenshot");
  assert.ok(!matchesNetProfit(order("confirmed", 210, 38.6), range("100-200")), "its margin is 210 but its net is 38.6");
  assert.ok(matchesNetProfit(order("confirmed", 210, 38.6), range("lt50")));
  assert.ok(matchesNetProfit(order("submitted", 80, -12), range("loss")));
  assert.ok(!matchesNetProfit(order("cancelled", 400, 300), range("gte200")));
  assert.ok(matchesNetProfit(order("cancelled", 400, 300), range("")), "no filter → everything");
  assert.ok(matchesNetProfit(order("delivered", 300, 150), { min: 140, max: 160 }), "custom");
});

test("place filter: governorate and area, spellings merged", () => {
  assert.equal(placeKey(" مدينه  نصر "), placeKey("مدينة نصر"));
  assert.equal(placeKey("محافظة الإسكندرية"), placeKey("الاسكندريه"));
  assert.equal(placeKey("شبرا الخيمى"), placeKey("شبرا الخيمي"));
  const orders = [
    { governorate: "القاهرة", area: "مدينة نصر" },
    { governorate: "القاهره", area: "مدينه نصر" },
    { governorate: "القاهرة", area: "المعادي" },
    { governorate: "القاهرة", area: "" },
    { governorate: "الجيزة", area: "الهرم" },
  ];
  const governorates = governorateOptions(orders);
  assert.deepEqual(governorates.map((item) => [item.label, item.count]), [["القاهرة", 4], ["الجيزة", 1]]);
  const cairo = governorates[0].key;
  assert.deepEqual(areaOptions(orders, cairo).map((item) => [item.label, item.count]), [["مدينة نصر", 2], ["المعادي", 1]]);
  assert.equal(orders.filter((order) => matchesPlace(order, cairo, "")).length, 4);
  assert.equal(orders.filter((order) => matchesPlace(order, cairo, placeKey("مدينة نصر"))).length, 2);
  assert.equal(orders.filter((order) => matchesPlace(order, cairo, "none")).length, 1);
  assert.equal(orders.filter((order) => matchesPlace(order, "", "")).length, 5);
  // Area alone, without a governorate: every area, named with its governorate.
  assert.deepEqual(areaOptions(orders, "").map((item) => [item.label, item.count]), [["مدينة نصر · القاهرة", 2], ["المعادي · القاهرة", 1], ["الهرم · الجيزة", 1]]);
  assert.equal(orders.filter((order) => matchesPlace(order, "", placeKey("الهرم"))).length, 1);
});

test("filters together: several statuses, each step has / has not, dates and offer", async () => {
  const { matchesChoice, ORDER_SHORTCUTS, matchesTime, matchesHours, cairoStamp, offerKindOf, countValues } = await import("../lib/all-orders.ts");
  const told = { notifiedAt: "2026-11-20T10:00:00Z" };
  const orders = [
    { id: 1, status: "confirmed", deposit: null, courier: null },
    { id: 2, status: "confirmed", deposit: null, courier: told },
    { id: 3, status: "submitted", deposit: { amount: 50, at: "x" }, courier: null },
    { id: 4, status: "delivered", deposit: null, courier: { ...told, handedAt: "2026-11-21T10:00:00Z" } },
  ];
  const ids = (statuses, facts) => orders.filter((order) => matchesChoice(order, statuses, facts)).map((order) => order.id);
  assert.deepEqual(ids(["confirmed"], { notified: false }), [1], "confirmed and the company not told yet");
  assert.deepEqual(ids(["confirmed", "submitted"], {}), [1, 2, 3], "any of the statuses");
  assert.deepEqual(ids([], { deposit: true }), [3]);
  assert.deepEqual(ids([], { deposit: false, handed: false }), [1, 2]);
  assert.deepEqual(ids([], {}), [1, 2, 3, 4]);
  const shortcut = ORDER_SHORTCUTS.find((item) => item.id === "confirmed-not-notified");
  assert.deepEqual(ids(shortcut.statuses, shortcut.facts), [1]);
  assert.equal(cairoStamp("2026-11-22T23:30:00Z"), "2026-11-23T01:30", "Cairo time (UTC+2)");
  assert.equal(matchesTime({ createdAt: "2026-11-22T23:30:00Z" }, "2026-11-23", "2026-11-23"), true, "a day alone = the whole day");
  assert.equal(matchesTime({ createdAt: "2026-11-22T20:00:00Z" }, "2026-11-23", ""), false);
  assert.equal(matchesTime({ createdAt: "2026-11-23T10:00:00Z" }, "2026-11-23T12:00", "2026-11-23T12:30"), true, "12:00 Cairo, within 12:00–12:30");
  assert.equal(matchesTime({ createdAt: "2026-11-23T10:31:00Z" }, "2026-11-23T12:00", "2026-11-23T12:30"), false);
  assert.equal(matchesHours({ createdAt: "2026-11-23T19:15:00Z" }, "20", "23"), true, "21:15 Cairo between 8 and 11 pm");
  assert.equal(matchesHours({ createdAt: "2026-11-23T09:15:00Z" }, "20", "23"), false);
  assert.equal(matchesHours({ createdAt: "2026-11-23T23:15:00Z" }, "22", "2"), true, "01:15 Cairo, 10 pm → 2 am wraps");
  assert.equal(matchesHours({ createdAt: "2026-11-23T12:00:00Z" }, "", ""), true);
  assert.equal(offerKindOf({ offerName: "عرض الكريسماس: ٣ بيجامات كريسماس" }), "christmas");
  assert.equal(offerKindOf({ offerName: "عرض الشتاء: ٤ بيجامات شتوية" }), "winter");
  assert.equal(offerKindOf({ offerName: "بدون عرض — قطع منفردة" }), "none");
  assert.deepEqual(countValues(["a", "", "b", "a"]), [{ value: "a", count: 2 }, { value: "b", count: 1 }]);
});
