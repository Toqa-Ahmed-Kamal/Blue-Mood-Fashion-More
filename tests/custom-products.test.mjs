import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_PRODUCT_ID_PATTERN,
  IMAGE_ID_PATTERN,
  imageTypeOf,
  newImageId,
  newProductId,
  parseCustomProduct,
  sanitizeProductInput,
  toCatalogProduct,
} from "../lib/custom-products.ts";
import { resolveCart } from "../lib/cart.ts";
import { buildFinanceReport, sanitizeExpense } from "../lib/finance.ts";
import { catalog, findProduct, isBuiltInProduct, productsIn, setCustomProducts, visibleCatalog } from "../lib/site-data.ts";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString("base64");

test("product codes and photo IDs follow the catalog style and never clash with built-in products", () => {
  const id = newProductId("abayas", 1_800_000_000_000, 0.5);
  assert.match(id, CUSTOM_PRODUCT_ID_PATTERN);
  assert.ok(id.startsWith("bm-abaya-n"));
  assert.ok(newProductId("winter-pajamas").startsWith("bm-winter-pajama-n"));
  assert.ok(newProductId("wearable-blankets").startsWith("bm-winter-blanket-n"));
  assert.equal(catalog.some((product) => CUSTOM_PRODUCT_ID_PATTERN.test(product.id)), false, "built-in codes never look like added ones");
  assert.match(newImageId(), IMAGE_ID_PATTERN);
});

test("product form checks: name, category, price rules, pajama weight", () => {
  assert.ok("error" in sanitizeProductInput({ name: "ab", category: "abayas", price: 350 }));
  assert.ok("error" in sanitizeProductInput({ name: "عباية جديدة", category: "shoes", price: 350 }));
  assert.equal(sanitizeProductInput({ name: "عباية جديدة", category: "abayas", price: "" }).error, "العبايات والأرواب لازم يبقى ليها سعر بيع.");
  assert.ok("error" in sanitizeProductInput({ name: "عباية جديدة", category: "abayas", price: -5 }));
  assert.ok("error" in sanitizeProductInput({ name: "بيجاما جديدة", category: "winter-pajamas", price: null, maxWeightKg: 5 }));
  const pajama = sanitizeProductInput({ name: "  بيجاما   نجوم ", category: "winter-pajamas", price: "", maxWeightKg: "75", imageAlt: "", hidden: false });
  assert.deepEqual(pajama.input, { name: "بيجاما نجوم", category: "winter-pajamas", price: null, imageAlt: "بيجاما نجوم", maxWeightKg: 75, hidden: false });
  const abaya = sanitizeProductInput({ name: "عباية جديدة", category: "abayas", price: "399.6", maxWeightKg: 70 });
  assert.equal(abaya.input.price, 400);
  assert.equal(abaya.input.maxWeightKg, null, "weight limit only for pajamas");
});

test("photos: JPEG / PNG accepted by their bytes; anything else refused", () => {
  assert.equal(imageTypeOf(JPEG), "image/jpeg");
  assert.equal(imageTypeOf(PNG), "image/png");
  assert.equal(imageTypeOf(Buffer.from("<svg onload=alert(1)>".repeat(20)).toString("base64")), null);
  assert.equal(imageTypeOf("not base64 !!"), null);
  assert.equal(imageTypeOf("A".repeat(1_000_000)), null, "too large");
});

test("added products join the catalog everywhere (store, offer, cart) without replacing built-in ones", () => {
  const before = catalog.length;
  const robe = toCatalogProduct("bm-robe-nabc123", { name: "روب جديد", category: "robes", price: 300, imageAlt: "روب", maxWeightKg: null, hidden: false }, "/api/product-images/img-aaaaaaaa");
  const pajama = toCatalogProduct("bm-winter-pajama-nabc124", { name: "بيجاما جديدة", category: "winter-pajamas", price: null, imageAlt: "بيجاما", maxWeightKg: 75, hidden: false }, "/api/product-images/img-bbbbbbbb");
  const hidden = toCatalogProduct("bm-abaya-nabc125", { name: "عباية مخفية", category: "abayas", price: 350, imageAlt: "", maxWeightKg: null, hidden: true }, "/api/product-images/img-cccccccc");
  const clash = { ...robe, id: "bm-robe-001", name: "محاولة تغيير منتج أساسي" };
  try {
    setCustomProducts([robe, pajama, hidden, clash]);
    assert.equal(catalog.length, before + 3);
    assert.equal(findProduct("bm-robe-001").name, "روب فرو مورد فوشيا بغطاء رأس", "built-in product untouched");
    assert.equal(findProduct("bm-robe-nabc123").name, "روب جديد");
    assert.ok(productsIn("robes").some((product) => product.id === robe.id), "shown in its store section");
    assert.ok(productsIn("winter-pajamas").some((product) => product.id === pajama.id), "selectable in the winter offer");
    assert.equal(visibleCatalog.some((product) => product.id === hidden.id), false, "hidden stays off the store");
    assert.equal(isBuiltInProduct(robe.id), false);
    const cart = resolveCart({ offer: null, items: [{ productId: robe.id, quantity: 2 }] });
    assert.equal(cart.cart.subtotal, 600, "orderable at its own price");
    assert.ok("error" in resolveCart({ offer: null, items: [{ productId: hidden.id, quantity: 1 }] }), "a hidden product cannot be ordered");
    setCustomProducts([robe, pajama, hidden]);
    assert.equal(catalog.length, before + 3, "calling again does not duplicate");
  } finally {
    setCustomProducts([]);
  }
  assert.equal(catalog.length, before);
});

test("stored products are accepted only when well-formed", () => {
  const good = { id: "bm-abaya-nabc999", name: "عباية", category: "abayas", image: "/api/product-images/img-abcdefgh", imageAlt: "x", price: 350 };
  assert.deepEqual(parseCustomProduct(good), good);
  assert.equal(parseCustomProduct({ ...good, id: "bm-abaya-001" }), null, "cannot shadow a built-in code");
  assert.equal(parseCustomProduct({ ...good, image: "https://evil.example/x.jpg" }), null, "photo only from the store");
  assert.equal(parseCustomProduct({ ...good, category: "shoes" }), null);
});

test("stock purchases from the factory are recorded but not deducted from net profit (no double counting)", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  const expenses = [
    sanitizeExpense({ name: "بضاعة مصنع القاهرة", category: "stock-purchase", amount: 5000, date: "2026-11-10", notes: "" }, "s1", now),
    sanitizeExpense({ name: "إعلانات", category: "ads", amount: 300, date: "2026-11-10", notes: "" }, "s2", now),
  ];
  const order = { orderId: "BM-AAAAAAAAAAAAAAAAAAA1", createdAt: "2026-11-10T10:00:00Z", day: "2026-11-10", subtotal: 500, shippingCost: 80, total: 580, governorate: "", offerName: "", products: [{ modelId: "bm-robe-003", category: "robes", quantity: 2 }], firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status: "confirmed", statusAt: null, confirmedValue: null, costSnapshot: { unitCosts: [120], at: now.toISOString() } };
  const report = buildFinanceReport({ live: [order], old: [], costs: {}, expenses });
  assert.deepEqual(report.totals, { sales: 580, productsCost: 240, expenses: 300, stockPurchases: 5000, netProfit: 40 });
  assert.equal(report.expensesByCategory.find((row) => row.category === "stock-purchase").amount, 5000);
});

test("selling price changed from the admin: the store, cart and order use it; a bad price is ignored", async () => {
  const { basePriceOf, findProduct, priceOf, setPriceOverrides } = await import("../lib/site-data.ts");
  const { resolveCart } = await import("../lib/cart.ts");
  const robe = findProduct("bm-robe-003");
  const original = basePriceOf(robe);
  try {
    setPriceOverrides({ "bm-robe-003": 299, "bm-winter-pajama-001": 150, "bm-abaya-001": -5 });
    assert.equal(priceOf(robe), 299);
    assert.equal(basePriceOf(robe), original, "the original price is still known");
    assert.equal(priceOf(findProduct("bm-winter-pajama-001")), 150, "pajamas (sold singly too) take the new price");
    assert.equal(priceOf(findProduct("bm-abaya-001")), basePriceOf(findProduct("bm-abaya-001")), "a bad price is ignored");
    const { cart } = resolveCart({ offer: null, items: [{ productId: "bm-robe-003", quantity: 2 }] });
    assert.equal(cart.items[0].unitPrice, 299);
    assert.equal(cart.items[0].lineTotal, 598);
    setPriceOverrides({});
    assert.equal(priceOf(robe), original, "back to the original price");
  } finally {
    setPriceOverrides({});
  }
});

test("discount: 'بدل كذا' shows only while it is higher than today's price; percent off is rounded", async () => {
  const { discountPercentOf, findProduct, priceOf, setPriceOverrides, setWasPrices, wasPriceOf } = await import("../lib/site-data.ts");
  const robe = findProduct("bm-robe-003");
  try {
    setPriceOverrides({ "bm-robe-003": 250 });
    setWasPrices({ "bm-robe-003": 320 });
    assert.equal(wasPriceOf(robe), 320);
    assert.equal(discountPercentOf(robe), 22, "(320 − 250) ÷ 320 = 21.9%");
    assert.equal(priceOf(robe), 250, "the customer pays today's price");
    // Raising the price above the old one hides the discount instead of showing a fake one.
    setPriceOverrides({ "bm-robe-003": 330 });
    assert.equal(wasPriceOf(robe), null);
    assert.equal(discountPercentOf(robe), null);
  } finally {
    setPriceOverrides({});
    setWasPrices({});
  }
});
