import test from "node:test";
import assert from "node:assert/strict";

import { aggregateQuantities, sanitizeOldOrder } from "../lib/old-orders.ts";
import { NO_SIZE, SIZE_NOT_RECORDED, active, buildQuantitySummary, oldOrderLines, productImage, shortSize, siteOrderLines } from "../lib/quantity-summary.ts";
import { findProduct } from "../lib/site-data.ts";
import { buildXlsx } from "../lib/xlsx.ts";

const PAJAMA_70 = "One Size – مقاس واحد يناسب لحد 70 كيلو";
const PAJAMA_90 = "One Size – مقاس واحد يناسب لحد 85–90 كيلو";

function siteOrder(orderId, status, products) {
  return { orderId, createdAt: "2026-11-10T10:00:00.000Z", day: "2026-11-10", subtotal: 0, shippingCost: null, total: null, governorate: "القاهرة", offerName: "", products, firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: null, confirmedValue: null };
}
function oldOrder(orderId, status, products, extra = {}) {
  return sanitizeOldOrder({ orderId, createdAt: "2026-11-08T10:00:00.000Z", status, offerName: "", products, ...extra });
}
const line = (modelId, quantity, size = "", extra = {}) => ({ modelId, name: findProduct(modelId)?.name ?? modelId, size, color: "", quantity, unitPrice: null, ...extra });

const live = [
  // New order: fit saved with the order.
  { order: siteOrder("BM-AAAAAAAAAAAAAAAAAAA1", "submitted", [
    { modelId: "bm-winter-pajama-008", category: "winter-pajamas", quantity: 2, fit: PAJAMA_70 },
    { modelId: "bm-abaya-001", category: "abayas", quantity: 1, fit: "عباية" },
  ]), fits: [PAJAMA_70, "عباية"] },
  // Older order: fit only from its encrypted details.
  { order: siteOrder("BM-AAAAAAAAAAAAAAAAAAA2", "confirmed", [{ modelId: "bm-winter-pajama-008", category: "winter-pajamas", quantity: 1 }]), fits: [PAJAMA_90] },
  // Older order without details: pajama size not recorded, abaya simply has no size.
  { order: siteOrder("BM-AAAAAAAAAAAAAAAAAAA3", "submitted", [
    { modelId: "bm-winter-pajama-008", category: "winter-pajamas", quantity: 1 },
    { modelId: "bm-abaya-001", category: "abayas", quantity: 1 },
  ]), fits: [null, null] },
  { order: siteOrder("BM-AAAAAAAAAAAAAAAAAAA4", "cancelled", [{ modelId: "bm-winter-pajama-008", category: "winter-pajamas", quantity: 5, fit: PAJAMA_70 }]), fits: [PAJAMA_70] },
];
const old = [
  oldOrder("BM-BBBBBBBBBBBBBBBBBBB1", "submitted", [line("bm-winter-pajama-008", 3, PAJAMA_90), line("bm-robe-003", 1)]),
  // Same order also in the site orders (Telegram copy): must be counted once, from the site.
  oldOrder("BM-AAAAAAAAAAAAAAAAAAA2", "cancelled", [line("bm-winter-pajama-008", 1, PAJAMA_90)]),
  oldOrder("BM-BBBBBBBBBBBBBBBBBBB2", "confirmed", [line("bm-winter-pajama-008", 1, PAJAMA_70, { color: "وردي" })]),
  oldOrder("BM-BBBBBBBBBBBBBBBBBBB3", "submitted", [line("bm-robe-003", 4)], { archived: true }),
  // Product no longer in the catalog: photo from its message link only, never a guessed one.
  oldOrder("BM-BBBBBBBBBBBBBBBBBBB4", "submitted", [{ modelId: "bm-old-gone", name: "قطعة قديمة", size: "", color: "", quantity: 2, unitPrice: 300, image: "/images/old/gone.jpg" }]),
  oldOrder("BM-BBBBBBBBBBBBBBBBBBB5", "submitted", [{ modelId: "", name: "قطعة بدون كود", size: "", color: "", quantity: 1, unitPrice: null }]),
];

test("site + old orders are merged; an order in both counts once (site status wins)", () => {
  const summary = buildQuantitySummary({ live, old });
  assert.deepEqual(summary.sources, {
    siteOrders: 4, oldOrders: 6, oldCounted: 4, inBoth: 1, archivedSkipped: 1,
    inBothIds: ["BM-AAAAAAAAAAAAAAAAAAA2"], archivedIds: ["BM-BBBBBBBBBBBBBBBBBBB3"],
  });
  const pajama = summary.products.find((row) => row.productId === "bm-winter-pajama-008");
  // pending: 2 (A1) + 1 (A3) + 3 (B1) = 6; confirmed: 1 (A2, site copy) + 1 (B2) = 2; cancelled: 5 (A4) — the cancelled Telegram copy of A2 is ignored.
  assert.deepEqual(pajama.pieces, { submitted: 6, confirmed: 2, cancelled: 5, returned: 0 });
  assert.deepEqual(pajama.orders, { submitted: 3, confirmed: 2, cancelled: 1, returned: 0 });
  assert.equal(active(pajama.pieces), 8, "cancelled never counts as pieces to make");
  assert.equal(pajama.image, findProduct("bm-winter-pajama-008").image);
  assert.equal(pajama.name, findProduct("bm-winter-pajama-008").name);
});

test("sizes: a catalog pajama is One Size with its product weight limit (one line); other sizes and colors stay separate", () => {
  const pajama = buildQuantitySummary({ live, old }).products.find((row) => row.productId === "bm-winter-pajama-008");
  const sizes = Object.fromEntries(pajama.sizes.map((size) => [size.size, size.pieces]));
  // Orders recorded "85–90" (old weight note) or no note at all: all counted under the product's corrected 70 kg.
  assert.deepEqual(sizes, {
    "One Size · لحد 70 كيلو": { submitted: 6, confirmed: 1, cancelled: 5, returned: 0 },
    "One Size · لحد 70 كيلو · وردي": { submitted: 0, confirmed: 1, cancelled: 0, returned: 0 },
  });
  const abaya = buildQuantitySummary({ live, old }).products.find((row) => row.productId === "bm-abaya-001");
  assert.deepEqual(abaya.sizes, [{ size: NO_SIZE, pieces: { submitted: 2, confirmed: 0, cancelled: 0, returned: 0 } }]);
  const gone = buildQuantitySummary({ live: [{ order: siteOrder("BM-AAAAAAAAAAAAAAAAAAA9", "submitted", [{ modelId: "bm-retired-pajama", category: "winter-pajamas", quantity: 1 }]), fits: [null] }], old: [] });
  assert.equal(gone.products[0].sizes[0].size, SIZE_NOT_RECORDED, "no size invented for a pajama outside the catalog");
  assert.equal(shortSize(PAJAMA_90), "One Size · لحد 85–90 كيلو");
  assert.equal(shortSize("XL"), "XL");
});

test("pajama 008: 10 pieces recorded with 85–90 and 70 notes count as 10 · One Size · لحد 70 كيلو", () => {
  const orders = [
    ...Array.from({ length: 9 }, (_, i) => oldOrder(`BM-CCCCCCCCCCCCCCCCCCC${i}`, "submitted", [line("bm-winter-pajama-008", 1, PAJAMA_90)])),
    oldOrder("BM-CCCCCCCCCCCCCCCCCCDD", "confirmed", [line("bm-winter-pajama-008", 1, PAJAMA_70)]),
  ];
  const row = buildQuantitySummary({ live: [], old: orders }).products[0];
  assert.equal(active(row.pieces), 10);
  assert.deepEqual(row.sizes, [{ size: "One Size · لحد 70 كيلو", pieces: { submitted: 9, confirmed: 1, cancelled: 0, returned: 0 } }]);
  assert.equal(findProduct("bm-winter-pajama-008").maxWeightKg, 70, "product data says 70 kg");
  const [factoryRow] = aggregateQuantities(orders);
  assert.deepEqual([factoryRow.size, factoryRow.quantity], ["One Size · لحد 70 كيلو", 10], "Old Orders factory table agrees");
  // Pajamas without a weight override stay 85–90.
  assert.equal(buildQuantitySummary({ live: [], old: [oldOrder("BM-CCCCCCCCCCCCCCCCCCEE", "submitted", [line("bm-winter-pajama-002", 2, PAJAMA_90)])] }).products[0].sizes[0].size, "One Size · لحد 85–90 كيلو");
});

test("photos: catalog photo, else the store photo from the message, else none (never another product's)", () => {
  const summary = buildQuantitySummary({ live, old });
  assert.equal(summary.products.find((row) => row.productId === "bm-old-gone").image, "/images/old/gone.jpg");
  assert.equal(summary.products.find((row) => row.name === "قطعة بدون كود").image, null);
  assert.equal(productImage("bm-robe-003"), findProduct("bm-robe-003").image);
  assert.equal(productImage("nope"), null);
  assert.equal(sanitizeOldOrder({ orderId: "BM-BBBBBBBBBBBBBBBBBBB9", createdAt: "2026-11-08T10:00:00Z", products: [{ name: "x", quantity: 1, image: "https://evil.example/x.jpg?track" }] }).products[0].image, undefined);
  assert.equal(sanitizeOldOrder({ orderId: "BM-BBBBBBBBBBBBBBBBBBB9", createdAt: "2026-11-08T10:00:00Z", products: [{ name: "x", quantity: 1, image: "https://blue-mood-fashion-more.vercel.app/images/robe/1.png" }] }).products[0].image, "/images/robe/1.png");
});

test("archived old orders are left out unless asked; a status change moves the pieces", () => {
  const robe = (summary) => summary.products.find((row) => row.productId === "bm-robe-003");
  assert.equal(robe(buildQuantitySummary({ live, old })).pieces.submitted, 1);
  assert.equal(robe(buildQuantitySummary({ live, old, includeArchived: true })).pieces.submitted, 5);

  const cancelledNow = live.map((item) => (item.order.orderId === "BM-AAAAAAAAAAAAAAAAAAA1" ? { ...item, order: { ...item.order, status: "cancelled" } } : item));
  const pajama = buildQuantitySummary({ live: cancelledNow, old }).products.find((row) => row.productId === "bm-winter-pajama-008");
  assert.deepEqual(pajama.pieces, { submitted: 4, confirmed: 2, cancelled: 7, returned: 0 });
});

test("totals add up and products are sorted by pieces to make", () => {
  const summary = buildQuantitySummary({ live, old });
  const sumOf = (status) => summary.products.reduce((total, row) => total + row.pieces[status], 0);
  assert.deepEqual(summary.totals.pieces, { submitted: sumOf("submitted"), confirmed: sumOf("confirmed"), cancelled: sumOf("cancelled"), returned: sumOf("returned") });
  assert.deepEqual(summary.totals.orders, { submitted: 5, confirmed: 2, cancelled: 1, returned: 0 });
  const actives = summary.products.map((row) => active(row.pieces));
  assert.deepEqual(actives, actives.toSorted((a, b) => b - a));
  assert.deepEqual(buildQuantitySummary({ live: [], old: [] }).products, []);
});

test("xlsx with pictures: drawing, relationships and media are packaged", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const data = buildXlsx([{ name: "حصر المصنع", rtl: true, rows: [["الصورة", "المنتج"], ["", "بيجاما"]], rowHeights: { 1: 60 }, images: [{ row: 1, col: 0, data: jpeg, width: 72, height: 72 }] }]);
  const text = new TextDecoder("latin1").decode(data);
  for (const part of ["xl/drawings/drawing1.xml", "xl/drawings/_rels/drawing1.xml.rels", "xl/worksheets/_rels/sheet1.xml.rels", "xl/media/image1_1.jpeg"]) assert.ok(text.includes(part), part);
  assert.ok(text.includes('<drawing r:id="rId1"/>'));
  assert.ok(text.includes('ht="60" customHeight="1"'));
  assert.ok(text.includes('Extension="jpeg"'));
  assert.ok(text.includes(`cx="${72 * 9525}"`));
});

test("both sources become the same line format before counting; pieces are split by source", () => {
  const [siteLine] = siteOrderLines(live[0]);
  const [oldLine] = oldOrderLines(old[0]);
  assert.deepEqual(Object.keys(siteLine).sort(), Object.keys(oldLine).sort());
  assert.deepEqual(
    { ...siteLine, orderId: "", status: "", source: "", quantity: 0 },
    { ...oldLine, orderId: "", status: "", source: "", quantity: 0 },
    "same product → identical id, name, category, size and photo from either source",
  );
  const pajama = buildQuantitySummary({ live, old }).products.find((row) => row.productId === "bm-winter-pajama-008");
  assert.deepEqual(pajama.bySource.site, { submitted: 3, confirmed: 1, cancelled: 5, returned: 0 });
  assert.deepEqual(pajama.bySource.telegram, { submitted: 3, confirmed: 1, cancelled: 0, returned: 0 });
  const totals = buildQuantitySummary({ live, old }).totals;
  assert.equal(active(totals.bySource.site) + active(totals.bySource.telegram), active(totals.pieces));
});

test("mapping by product ID: a Telegram name that differs from the catalog is the same product; different IDs never merge", () => {
  const renamed = oldOrder("BM-DDDDDDDDDDDDDDDDDDD1", "submitted", [{ modelId: "bm-robe-003", name: "روب نمر (اسم قديم)", size: "", color: "", quantity: 2, unitPrice: 250 }]);
  const siteRobe = { order: siteOrder("BM-DDDDDDDDDDDDDDDDDDD2", "submitted", [{ modelId: "bm-robe-003", category: "robes", quantity: 1, fit: "روب" }]), fits: ["روب"] };
  const summary = buildQuantitySummary({ live: [siteRobe], old: [renamed] });
  assert.equal(summary.products.length, 1);
  assert.equal(summary.products[0].name, findProduct("bm-robe-003").name);
  assert.equal(active(summary.products[0].pieces), 3);
  const sameName = buildQuantitySummary({ live: [], old: [
    oldOrder("BM-DDDDDDDDDDDDDDDDDDD3", "submitted", [{ modelId: "bm-gone-1", name: "قطعة", size: "", color: "", quantity: 1, unitPrice: null }]),
    oldOrder("BM-DDDDDDDDDDDDDDDDDDD4", "submitted", [{ modelId: "bm-gone-2", name: "قطعة", size: "", color: "", quantity: 1, unitPrice: null }]),
  ] });
  assert.equal(sameName.products.length, 2, "two unknown products with the same name stay apart");
});

test("an imported order listed twice in storage still counts once", () => {
  const summary = buildQuantitySummary({ live: [], old: [old[0], old[0]] });
  assert.equal(summary.sources.oldOrders, 1);
  assert.equal(active(summary.products.find((row) => row.productId === "bm-robe-003").pieces), 1);
});
