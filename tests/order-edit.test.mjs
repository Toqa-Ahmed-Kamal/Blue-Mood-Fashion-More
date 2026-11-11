import test from "node:test";
import assert from "node:assert/strict";

import { mergeAllOrders, withEdit } from "../lib/all-orders.ts";
import { sanitizeOldOrder } from "../lib/old-orders.ts";
import { applyEditToOldOrder, applyEditToSiteOrder, editTotals, sanitizeOrderEdit } from "../lib/order-edit.ts";
import { findProduct } from "../lib/site-data.ts";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const base = {
  customerName: "منى",
  phone: "01012345678",
  alternatePhone: "",
  governorate: "القاهرة",
  area: "مدينة نصر",
  address: "عنوان جديد",
  notes: "",
  offerName: "بدون عرض — قطع منفردة",
  offerPrice: 0,
  shippingCost: 80,
  lines: [{ modelId: "bm-robe-003", quantity: 1, unitPrice: 250 }],
};

const siteOrder = { orderId: "BM-AAAAAAAAAAAAAAAAAAA1", createdAt: "2026-11-10T10:00:00.000Z", day: "2026-11-10", subtotal: 250, shippingCost: 80, total: 330, governorate: "القاهرة", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-robe-003", category: "robes", quantity: 1, fit: "روب" }], firstTouch: null, lastTouch: null, source: "Facebook Ads", sourceType: "Paid", campaign: "winter_2026", adContent: "", landingPage: "/", status: "confirmed", statusAt: "2026-11-10T11:00:00.000Z", confirmedValue: 330, costSnapshot: { at: "2026-11-10T11:00:00.000Z", unitCosts: [150], factories: ["مصنع القاهرة"] }, deposit: { amount: 80, at: "2026-11-10T11:00:00Z" } };
const siteDetails = { orderId: siteOrder.orderId, createdAt: siteOrder.createdAt, customerName: "منى", phone: "01012345678", alternatePhone: "", governorate: "القاهرة", area: "مدينة نصر", address: "عنوان", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-robe-003", name: "روب", category: "robes", fit: "روب", quantity: 1, unitPrice: 250, link: null }], offerPrice: 0, itemsTotal: 250, subtotal: 250, shippingCost: 80, total: 330, notes: "" };

test("edit check: products must come from the store's catalog; quantities and prices are validated", () => {
  assert.ok("edit" in sanitizeOrderEdit(base));
  assert.match(sanitizeOrderEdit({ ...base, lines: [{ modelId: "not-a-product", quantity: 1, unitPrice: 10 }] }).error, /القائمة/);
  assert.match(sanitizeOrderEdit({ ...base, lines: [] }).error, /منتج واحد/);
  assert.match(sanitizeOrderEdit({ ...base, lines: [{ modelId: "bm-robe-003", quantity: 0, unitPrice: 10 }] }).error, /الكمية/);
  assert.match(sanitizeOrderEdit({ ...base, lines: [{ modelId: "bm-robe-003", quantity: 1, unitPrice: -5 }] }).error, /سعر/);
  assert.match(sanitizeOrderEdit({ ...base, phone: "12" }).error, /الموبايل/);
  assert.match(sanitizeOrderEdit({ ...base, customerName: "" }).error, /اسم/);
  const empty = sanitizeOrderEdit({ ...base, shippingCost: "", lines: [{ modelId: "bm-robe-003", quantity: "2", unitPrice: "" }] }).edit;
  assert.equal(empty.shippingCost, null, "empty shipping = still to be confirmed");
  assert.equal(empty.lines[0].unitPrice, null, "empty price = part of the offer");
  assert.equal(empty.lines[0].quantity, 2);
});

test("edit totals: offer + pieces + shipping; no invented total while shipping is unknown", () => {
  assert.deepEqual(editTotals({ offerPrice: 600, shippingCost: 80, lines: [{ quantity: 2, unitPrice: 250 }, { quantity: 1, unitPrice: null }] }), { itemsTotal: 500, subtotal: 1100, total: 1180 });
  assert.equal(editTotals({ offerPrice: 0, shippingCost: null, lines: [{ quantity: 1, unitPrice: 250 }] }).total, null);
});

test("site order: swapping a piece updates lines and totals, drops the old cost snapshot, keeps status and deposit", () => {
  const edit = sanitizeOrderEdit({ ...base, lines: [{ modelId: "bm-abaya-001", quantity: 2, unitPrice: 350 }] }).edit;
  const { order, details, linesChanged } = applyEditToSiteOrder(siteOrder, siteDetails, edit, NOW);
  assert.equal(linesChanged, true);
  assert.deepEqual(order.products.map((product) => [product.modelId, product.quantity, product.category]), [["bm-abaya-001", 2, "abayas"]]);
  assert.equal(order.subtotal, 700);
  assert.equal(order.total, 780);
  assert.equal(order.costSnapshot, undefined, "re-taken by the store for the new pieces");
  assert.equal(order.confirmedValue, null, "the collected amount was for the old total");
  assert.equal(order.status, "confirmed");
  assert.deepEqual(order.deposit, siteOrder.deposit);
  assert.equal(order.editedAt, NOW.toISOString());
  assert.equal(details.products[0].name, findProduct("bm-abaya-001").name, "name from the catalog");
  assert.equal(details.address, "عنوان جديد");
  assert.equal(details.total, 780);
  assert.equal(JSON.stringify(order).includes("01012345678"), false, "stats record stays free of customer data");
});

test("site order: changing only the address keeps pieces, cost snapshot and collected amount", () => {
  const edit = sanitizeOrderEdit({ ...base, address: "عنوان تاني" }).edit;
  const { order, linesChanged } = applyEditToSiteOrder(siteOrder, siteDetails, edit, NOW);
  assert.equal(linesChanged, false);
  assert.deepEqual(order.costSnapshot, siteOrder.costSnapshot);
  assert.equal(order.confirmedValue, 330);
});

test("Telegram order: pieces from the catalog, color kept only on the same piece, totals recalculated, status/deposit/archive kept", () => {
  const old = { ...sanitizeOldOrder({ orderId: "BM-BBBBBBBBBBBBBBBBBBB1", createdAt: "2026-11-08T10:00:00.000Z", status: "confirmed", customerName: "هالة", phone: "01198765432", governorate: "الجيزة", area: "الدقي", address: "عنوان قديم", offerName: "بدون عرض — قطع منفردة", products: [{ modelId: "bm-robe-003", name: "روب", size: "", color: "أسود", quantity: 1, unitPrice: 250 }, { modelId: "bm-abaya-002", name: "عباية", size: "", color: "كحلي", quantity: 1, unitPrice: 350 }], itemsTotal: 600, shippingCost: 80, total: 680 }), deposit: { amount: 50, at: "2026-11-09T10:00:00Z" }, archived: true };
  const edit = sanitizeOrderEdit({ ...base, customerName: "هالة", phone: "01198765432", governorate: "الجيزة", shippingCost: 70, lines: [{ modelId: "bm-robe-003", quantity: 2, unitPrice: 250 }, { modelId: "bm-winter-pajama-001", quantity: 1, unitPrice: null }], offerPrice: 500 }).edit;
  const next = applyEditToOldOrder(old, edit, NOW);
  assert.equal(next.products[0].color, "أسود", "same piece on the same line keeps its color");
  assert.equal(next.products[1].color, "", "a new piece has no color yet");
  assert.equal(next.products[1].name, findProduct("bm-winter-pajama-001").name);
  assert.ok(next.products[1].size, "pajamas get their size note");
  assert.equal(next.itemsTotal, 500);
  assert.equal(next.total, 500 + 500 + 70);
  assert.equal(next.status, "confirmed");
  assert.deepEqual(next.deposit, old.deposit);
  assert.equal(next.archived, true);
  assert.equal(next.importedAt, old.importedAt);
});

test("all orders: offer price and editability come through for site and Telegram orders", () => {
  const old = sanitizeOldOrder({ orderId: "BM-BBBBBBBBBBBBBBBBBBB1", createdAt: "2026-11-08T10:00:00.000Z", status: "submitted", customerName: "هالة", phone: "01198765432", governorate: "الجيزة", area: "الدقي", address: "عنوان", offerName: "عرض", products: [{ modelId: "bm-robe-003", name: "روب", size: "", color: "", quantity: 1, unitPrice: null }], offerPrice: 900, itemsTotal: 0, shippingCost: 80, total: 980 });
  const rows = mergeAllOrders([{ order: siteOrder, details: { ...siteDetails, offerPrice: 0 } }, { order: { ...siteOrder, orderId: "BM-AAAAAAAAAAAAAAAAAAA9" }, details: null }], [old]);
  const byId = Object.fromEntries(rows.map((row) => [row.orderId, row]));
  assert.equal(byId[old.orderId].offerPrice, 900);
  assert.equal(byId[old.orderId].editable, true);
  assert.equal(byId[siteOrder.orderId].editable, true);
  assert.equal(byId["BM-AAAAAAAAAAAAAAAAAAA9"].editable, false, "pieces/prices unknown → not editable");

  const edited = withEdit(byId[siteOrder.orderId], sanitizeOrderEdit({ ...base, shippingCost: null, lines: [{ modelId: "bm-abaya-001", quantity: 2, unitPrice: 350 }] }).edit);
  assert.deepEqual(edited.products.map((product) => [product.modelId, product.quantity, product.unitPrice]), [["bm-abaya-001", 2, 350]]);
  assert.equal(edited.total, null, "shipping unknown → no invented total");
  assert.equal(edited.value, 700);
  assert.equal(edited.status, "confirmed", "status untouched");
  assert.deepEqual(edited.deposit, siteOrder.deposit, "deposit untouched");
});
