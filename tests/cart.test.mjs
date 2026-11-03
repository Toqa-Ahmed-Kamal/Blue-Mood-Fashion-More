import test from "node:test";
import assert from "node:assert/strict";

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
import { catalog, categoryPrices, visibleCatalog } from "../lib/site-data.ts";

const visible = (category) => visibleCatalog.filter((product) => product.category === category).map((product) => product.id);
const pajamas = visible("winter-pajamas");
const blankets = visible("wearable-blankets");
const abaya = visible("abayas")[0];
const robe = visible("robes")[0];
const hiddenAbaya = catalog.find((product) => product.hidden && product.category === "abayas").id;

test("the store has all four sections with enough pieces for both offers", () => {
  for (const category of ["abayas", "robes", "winter-pajamas", "wearable-blankets"]) {
    assert.ok(visible(category).length > 0, category);
  }
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

  assert.equal(result.cart.itemsTotal, categoryPrices.abayas * 2 + categoryPrices.robes);
  assert.equal(result.cart.subtotal, result.cart.itemsTotal);
});

test("pajamas and blankets can also be bought singly at their own prices", () => {
  const result = resolveCart({
    items: [
      { productId: pajamas[0], quantity: 1 },
      { productId: "bm-winter-blanket-001", quantity: 1 },
      { productId: "bm-winter-blanket-002", quantity: 1 },
    ],
  });

  assert.deepEqual(result.cart.items.map((line) => line.unitPrice), [275, 350, 250]);
  assert.equal(result.cart.subtotal, 875);
});

test("offer and single pieces add up together", () => {
  const result = resolveCart({
    offer: { offerId: "four-pajamas", productIds: pajamas.slice(0, 4) },
    items: [{ productId: abaya, quantity: 1 }],
  });

  assert.equal(result.cart.subtotal, 1100 + categoryPrices.abayas);
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
