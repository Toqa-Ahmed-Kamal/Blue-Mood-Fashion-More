import test from "node:test";
import assert from "node:assert/strict";
import { setPriceClock } from "../lib/site-data.ts";

// Prices go up after the offer countdown: tests use a fixed time before it.
setPriceClock(() => Date.parse("2026-11-20T12:00:00+02:00"));

import {
  addCartItem,
  cartPieceCount,
  emptyCart,
  MAX_ITEM_QUANTITY,
  resolveCart,
  sanitizeCart,
  setCartItemQuantity,
  setCartOffer,
} from "../lib/cart.ts";
import { catalog, findProduct, priceOf, visibleCatalog } from "../lib/site-data.ts";

const visible = (category) => visibleCatalog.filter((product) => product.category === category).map((product) => product.id);
const pajamas = visible("winter-pajamas");
const blankets = visible("wearable-blankets");
const robe = visible("robes")[0];
// A second single piece for the cart tests (the abayas section is closed).
const abaya = visible("robes")[1];
const hiddenAbaya = catalog.find((product) => product.hidden && product.category === "abayas").id;

test("the store has its sections with enough pieces for both offers; the abayas section is closed", () => {
  for (const category of ["robes", "winter-pajamas", "wearable-blankets"]) {
    assert.ok(visible(category).length > 0, category);
  }
  assert.deepEqual(visible("abayas"), [], "no abayas on the store");
  const closed = catalog.find((product) => product.category === "abayas" && !product.hidden).id;
  assert.equal(resolveCart({ items: [{ productId: closed, quantity: 1 }] }).error, "INVALID_ITEM", "an abaya can't be ordered");
  assert.ok(pajamas.length >= 4);
  assert.ok(blankets.length >= 1);
});

test("a complete four-pajama offer is priced at the offer price", () => {
  const result = resolveCart({ offer: { offerId: "four-pajamas", productIds: pajamas.slice(0, 4) }, items: [] });

  assert.equal(result.cart.offerTotal, 1100);
  assert.equal(result.cart.subtotal, 1100);
  assert.equal(result.cart.offer.products.length, 4);
});

test("the mixed offer needs exactly three pajamas and one blanket", () => {
  const valid = resolveCart({ offer: { offerId: "three-pajamas-and-blanket", productIds: [...pajamas.slice(0, 3), blankets[0]] } });
  const fourPajamas = resolveCart({ offer: { offerId: "three-pajamas-and-blanket", productIds: pajamas.slice(0, 4) } });

  assert.ok("cart" in valid);
  assert.equal(fourPajamas.error, "INVALID_BUNDLE");
});

test("offers reject duplicates, wrong counts, unknown ids, hidden pieces and priced pieces", () => {
  const offer = (productIds) => resolveCart({ offer: { offerId: "four-pajamas", productIds } }).error;

  assert.equal(offer([pajamas[0], pajamas[0], pajamas[1], pajamas[2]]), "INVALID_BUNDLE");
  assert.equal(offer(pajamas.slice(0, 3)), "INVALID_BUNDLE");
  assert.equal(offer([...pajamas.slice(0, 3), "bm-does-not-exist"]), "INVALID_BUNDLE");
  assert.equal(offer([...pajamas.slice(0, 3), abaya]), "INVALID_BUNDLE");
  assert.equal(resolveCart({ offer: { offerId: "made-up-offer", productIds: [] } }).error, "INVALID_OFFER");
});

test("single pieces are priced from the catalog, not from the request", () => {
  const result = resolveCart({ offer: null, items: [{ productId: abaya, quantity: 2, unitPrice: 1 }, { productId: robe, quantity: 1 }] });

  assert.equal(result.cart.itemsTotal, priceOf(findProduct(abaya)) * 2 + priceOf(findProduct(robe)));
  assert.equal(result.cart.subtotal, result.cart.itemsTotal);
});

test("pajamas and blankets can also be bought singly at their own prices", () => {
  const result = resolveCart({
    items: [
      { productId: pajamas[0], quantity: 1 },
      { productId: "bm-winter-blanket-003", quantity: 1 },
      { productId: "bm-winter-blanket-002", quantity: 1 },
    ],
  });

  // pajamas[0] is One Size up to 70 kg → 285; blankets 295.
  assert.deepEqual(result.cart.items.map((line) => line.unitPrice), [285, 295, 295]);
  assert.equal(result.cart.subtotal, 875);
});

test("offer and single pieces add up together", () => {
  const result = resolveCart({
    offer: { offerId: "four-pajamas", productIds: pajamas.slice(0, 4) },
    items: [{ productId: abaya, quantity: 1 }],
  });

  assert.equal(result.cart.subtotal, 1100 + priceOf(findProduct(abaya)));
});

test("invalid single pieces are rejected", () => {
  const items = (value) => resolveCart({ items: value }).error;

  assert.equal(items([{ productId: hiddenAbaya, quantity: 1 }]), "INVALID_ITEM");
  assert.equal(items([{ productId: abaya, quantity: 0 }]), "INVALID_ITEM");
  assert.equal(items([{ productId: abaya, quantity: 1.5 }]), "INVALID_ITEM");
  assert.equal(items([{ productId: abaya, quantity: MAX_ITEM_QUANTITY + 1 }]), "INVALID_ITEM");
  assert.equal(items([{ productId: abaya, quantity: 1 }, { productId: abaya, quantity: 1 }]), "INVALID_ITEM");
  assert.equal(resolveCart({ offer: null, items: [] }).error, "EMPTY");
  assert.equal(resolveCart("not a cart").error, "INVALID_CART");
});

test("cart helpers add, cap and remove single pieces", () => {
  let cart = addCartItem(emptyCart, abaya);
  cart = addCartItem(cart, abaya);
  assert.deepEqual(cart.items, [{ productId: abaya, quantity: 2 }]);

  cart = setCartItemQuantity(cart, abaya, 99);
  assert.equal(cart.items[0].quantity, MAX_ITEM_QUANTITY);

  cart = setCartItemQuantity(cart, abaya, 0);
  assert.deepEqual(cart.items, []);

  assert.deepEqual(addCartItem(emptyCart, hiddenAbaya), emptyCart, "hidden pieces cannot be added");
});

test("piece count includes offer pieces and quantities", () => {
  const cart = setCartOffer(addCartItem(addCartItem(emptyCart, robe), robe), { offerId: "four-pajamas", productIds: pajamas.slice(0, 4) });
  assert.equal(cartPieceCount(cart), 6);
});

test("a saved cart keeps its valid parts and drops stale ones", () => {
  const cart = sanitizeCart({
    offer: { offerId: "four-pajamas", productIds: pajamas.slice(0, 2) },
    items: [{ productId: abaya, quantity: 1 }, { productId: "bm-removed", quantity: 1 }, { productId: abaya, quantity: 3 }],
  });

  assert.equal(cart.offer, null);
  assert.deepEqual(cart.items, [{ productId: abaya, quantity: 1 }]);
  assert.deepEqual(sanitizeCart(null), emptyCart);
});

test("an offer holds only one pajama with a factory price of 220 (the others are allowed as usual)", async () => {
  const { offerLimitedFromCosts, setOfferLimited } = await import("../lib/site-data.ts");
  const ids = offerLimitedFromCosts([
    { productId: pajamas[0], cost: 220 },
    { productId: pajamas[1], cost: 220 },
    { productId: pajamas[2], cost: 175 },
    { productId: pajamas[3], cost: null },
  ]);
  assert.deepEqual(ids, [pajamas[0], pajamas[1]].toSorted());
  setOfferLimited(ids);
  const offer = (productIds) => resolveCart({ offer: { offerId: "four-pajamas", productIds } });
  assert.ok("cart" in offer([pajamas[0], pajamas[2], pajamas[3], pajamas[4]]), "one at 220 is fine");
  assert.ok("cart" in offer(pajamas.slice(2, 6)), "none at 220 is fine");
  assert.equal(offer(pajamas.slice(0, 4)).error, "INVALID_BUNDLE", "two at 220 are refused");
  setOfferLimited([]);
  assert.ok("cart" in offer(pajamas.slice(0, 4)));
});

test("a piece with a factory price of 270 or more is kept out of the offer, but still sold singly", async () => {
  const { offerExcludedFromCosts, setOfferExcluded } = await import("../lib/site-data.ts");
  const ids = offerExcludedFromCosts([
    { productId: pajamas[0], cost: 270 },
    { productId: pajamas[1], cost: 300 },
    { productId: pajamas[2], cost: 269 },
    { productId: pajamas[3], cost: null },
  ]);
  assert.deepEqual(ids, [pajamas[0], pajamas[1]].toSorted());
  setOfferExcluded(ids);
  const offer = (productIds) => resolveCart({ offer: { offerId: "four-pajamas", productIds } });
  assert.equal(offer(pajamas.slice(0, 4)).error, "INVALID_BUNDLE");
  assert.equal(offer([pajamas[0], ...pajamas.slice(2, 5)]).error, "INVALID_BUNDLE", "one is enough to refuse");
  assert.ok("cart" in offer(pajamas.slice(2, 6)));
  assert.ok("cart" in resolveCart({ items: [{ productId: pajamas[0], quantity: 1 }] }), "sold singly as usual");
  setOfferExcluded([]);
  assert.ok("cart" in offer(pajamas.slice(0, 4)));
});

test("prices by size: pajamas up to 70 / 75 kg are 285 instead of 320, other pajamas 300 instead of 350, blankets 295 instead of 400", async () => {
  const { findProduct, priceOf, wasPriceOf, setProductEdits, setPriceOverrides, setWasPrices } = await import("../lib/site-data.ts");
  setPriceOverrides({});
  setWasPrices({});
  const p = (id) => [priceOf(findProduct(id)), wasPriceOf(findProduct(id))];
  assert.deepEqual(p("bm-winter-pajama-001"), [285, 320], "70 kg in the code");
  assert.deepEqual(p("bm-winter-pajama-002"), [300, 350], "default 85–90 kg");
  assert.deepEqual(p("bm-winter-blanket-003"), [295, 400]);
  assert.deepEqual(p("bm-winter-blanket-002"), [295, 400]);
  // The size set from the admin decides.
  setProductEdits({ "bm-winter-pajama-002": { maxWeightKg: 75 }, "bm-winter-pajama-001": { maxWeightKg: 80 }, "bm-winter-pajama-003": { maxWeightKg: 65 } });
  assert.deepEqual(p("bm-winter-pajama-002"), [285, 320]);
  assert.deepEqual(p("bm-winter-pajama-001"), [300, 350]);
  assert.deepEqual(p("bm-winter-pajama-003"), [300, 350], "65 kg is not in the 70 / 75 group");
  // A price set from the admin still wins.
  setPriceOverrides({ "bm-winter-pajama-002": 310 });
  assert.equal(priceOf(findProduct("bm-winter-pajama-002")), 310);
  setPriceOverrides({});
  setProductEdits({});
  assert.deepEqual(p("bm-winter-pajama-001"), [285, 320]);
});

test("prices by time: 1,100 until 5 PM; then the offer 1,200 and every piece +20; after midnight the offer 1,300", async () => {
  const { findProduct, priceOf, listPriceOf, offerPrice, isPromoOver, nextPriceChange, setPriceClock: clock } = await import("../lib/site-data.ts");
  const five = Date.parse("2026-11-20T17:00:00+02:00");
  const midnight = Date.parse("2026-11-21T00:00:00+02:00");
  try {
    clock(() => five - 1000);
    assert.equal(isPromoOver(), false);
    assert.equal(offerPrice(), 1100);
    assert.equal(priceOf(findProduct("bm-winter-pajama-002")), 300);
    assert.deepEqual(nextPriceChange(five - 1000), { at: five, offerChanges: true, piecesChange: true });
    clock(() => five);
    assert.equal(isPromoOver(), true);
    assert.equal(offerPrice(), 1200);
    assert.equal(priceOf(findProduct("bm-winter-pajama-002")), 320);
    assert.equal(priceOf(findProduct("bm-winter-pajama-001")), 305, "small size 285 + 20");
    assert.equal(listPriceOf(findProduct("bm-winter-pajama-002")), 300, "the admin still edits the listed price");
    assert.deepEqual(nextPriceChange(five), { at: midnight, offerChanges: true, piecesChange: false }, "at midnight only the offer changes");
    const four = visible("winter-pajamas").slice(0, 4);
    const result = resolveCart({ offer: { offerId: "four-pajamas", productIds: four }, items: [{ productId: "bm-winter-pajama-002", quantity: 1 }] });
    assert.equal(result.cart.offerTotal, 1200);
    assert.equal(result.cart.itemsTotal, 320);
    clock(() => midnight);
    assert.equal(offerPrice(), 1300);
    assert.equal(priceOf(findProduct("bm-winter-pajama-002")), 320, "pieces stay as they were");
    assert.equal(nextPriceChange(midnight), null, "no more changes, no more timers");
    const later = resolveCart({ offer: { offerId: "four-pajamas", productIds: four }, items: [] });
    assert.equal(later.cart.offerTotal, 1300);
  } finally {
    clock(() => Date.parse("2026-11-20T12:00:00+02:00"));
  }
});

test("عرض الكريسماس: 3 pajamas for 1000; at most one above 190 at the factory; its own name in orders", async () => {
  const { christmasLimitedFromCosts, setChristmasLimited, setOfferLimited, offerPieceCount, optionName, findOffer } = await import("../lib/site-data.ts");
  const ids = christmasLimitedFromCosts([
    { productId: pajamas[0], cost: 220 },
    { productId: pajamas[1], cost: 191 },
    { productId: pajamas[2], cost: 190 },
    { productId: pajamas[3], cost: 175 },
    { productId: pajamas[4], cost: null },
  ]);
  assert.deepEqual(ids, [pajamas[0], pajamas[1]].toSorted(), "above 190 only (190 itself is fine)");
  setChristmasLimited(ids);
  const offer = (productIds) => resolveCart({ offer: { offerId: "christmas-three-pajamas", productIds } });
  const ok = offer([pajamas[0], pajamas[2], pajamas[3]]);
  assert.ok("cart" in ok, "one above 190 is fine");
  assert.equal(ok.cart.offer.price, 1000);
  assert.equal(ok.cart.offerTotal, 1000);
  assert.equal(offer([pajamas[0], pajamas[1], pajamas[2]]).error, "INVALID_BUNDLE", "two above 190 are refused");
  assert.equal(offer(pajamas.slice(2, 6)).error, "INVALID_BUNDLE", "exactly 3 pieces");
  assert.equal(offer([pajamas[2], pajamas[3], blankets[0]]).error, "INVALID_BUNDLE", "pajamas only");
  // The winter rule (one at 220) is separate: the christmas group does not limit the winter offer.
  setOfferLimited([]);
  assert.ok("cart" in resolveCart({ offer: { offerId: "four-pajamas", productIds: [pajamas[0], pajamas[1], pajamas[2], pajamas[3]] } }));
  setChristmasLimited([]);
  assert.ok("cart" in offer([pajamas[0], pajamas[1], pajamas[2]]));
  assert.equal(optionName(findOffer("christmas-three-pajamas")), "عرض الكريسماس: ٣ بيجامات كريسماس");
  assert.equal(offerPieceCount("عرض الكريسماس: ٣ بيجامات كريسماس"), 3);
  assert.equal(offerPieceCount("عرض الشتاء: ٣ بيجامات + بلانكيت"), 4);
  assert.equal(offerPieceCount("عرض الشتاء: ٤ بيجامات شتوية"), 4);
});
