import test from "node:test";
import assert from "node:assert/strict";
import { setPriceClock } from "../lib/site-data.ts";

// Prices go up after the offer countdown: tests use a fixed time before it.
setPriceClock(() => Date.parse("2026-11-20T12:00:00+02:00"));

import { availableBundles, BUNDLE_ID_PATTERN, isBundleAvailable, newBundleId, parseBundle, sanitizeBundleInput, setBundles, splitBundlePrice } from "../lib/bundles.ts";
import { cartPieceCount, emptyCart, removeCartBundle, resolveCart, sanitizeCart, setCartBundle } from "../lib/cart.ts";
import { findProduct, priceOf, setCustomProducts, setSoldOut, visibleCatalog } from "../lib/site-data.ts";
import { createTeamSessionToken, hashTeamPassword, isValidTeamToken, isWellFormedTeamToken, verifyTeamPassword, checkTeamPasswordRules } from "../lib/team-auth.ts";

const visible = (category) => visibleCatalog.filter((product) => product.category === category).map((product) => product.id);
const [robe1, robe2] = visible("robes");
const pajamas = visible("winter-pajamas");
const now = "2026-11-20T10:00:00.000Z";
const bundle = (over = {}) => ({ id: "bnd-test00001", name: "طقم روب وبيجاما", price: 450, kind: "fixed", productIds: [robe1, pajamas[0]], pickCount: 2, status: "live", addedBy: "team", createdAt: now, updatedAt: now, ...over });

test("bundle form: names, prices, kinds, products and pick counts are checked", () => {
  assert.ok(BUNDLE_ID_PATTERN.test(newBundleId()));
  assert.deepEqual(sanitizeBundleInput({ name: " طقم  الشتا ", price: "450", kind: "fixed", productIds: [robe1, pajamas[0], robe1] }), { input: { name: "طقم الشتا", price: 450, kind: "fixed", productIds: [robe1, pajamas[0]], pickCount: 2 } });
  assert.ok("error" in sanitizeBundleInput({ name: "ab", price: 450, kind: "fixed", productIds: [robe1, robe2] }));
  assert.ok("error" in sanitizeBundleInput({ name: "طقم", price: 0, kind: "fixed", productIds: [robe1, robe2] }));
  assert.ok("error" in sanitizeBundleInput({ name: "طقم", price: 450, kind: "fixed", productIds: [robe1] }), "a set needs 2 pieces");
  assert.ok("error" in sanitizeBundleInput({ name: "طقم", price: 450, kind: "fixed", productIds: [robe1, "bm-nope"] }));
  assert.ok("error" in sanitizeBundleInput({ name: "اختاري", price: 600, kind: "pick", productIds: pajamas.slice(0, 3), pickCount: 3 }), "more choices than picks");
  assert.deepEqual(sanitizeBundleInput({ name: "اختاري ٣", price: 600, kind: "pick", productIds: pajamas.slice(0, 5), pickCount: "3" }).input.pickCount, 3);
  assert.equal(parseBundle({ id: "bad" }), null);
  assert.equal(parseBundle(bundle()).status, "live");
  assert.equal(parseBundle({ ...bundle(), status: "x" }).status, "pending", "unknown status is never live");
});

test("bundle price is split over its pieces and adds up exactly", () => {
  const products = [findProduct(robe1), findProduct(pajamas[0]), findProduct(pajamas[1])];
  const shares = splitBundlePrice(701, products);
  assert.equal(shares.reduce((a, b) => a + b, 0), 701);
  assert.ok(shares.every((share) => Number.isInteger(share) && share > 0));
  const weights = products.map(priceOf);
  if (weights[0] > weights[1]) assert.ok(shares[0] >= shares[1]);
});

test("cart: fixed and pick bundles are priced; pending, broken or wrong picks are refused", () => {
  setBundles([
    bundle(),
    bundle({ id: "bnd-test00002", name: "اختاري ٢", price: 500, kind: "pick", productIds: pajamas.slice(0, 4), pickCount: 2 }),
    bundle({ id: "bnd-test00003", status: "pending" }),
  ]);
  assert.deepEqual(availableBundles().map((item) => item.id).toSorted(), ["bnd-test00001", "bnd-test00002"]);

  const ok = resolveCart({ items: [], bundles: [{ bundleId: "bnd-test00001", productIds: [] }, { bundleId: "bnd-test00002", productIds: [pajamas[1], pajamas[3]] }] });
  assert.ok("cart" in ok, JSON.stringify(ok));
  assert.equal(ok.cart.bundlesTotal, 950);
  assert.equal(ok.cart.subtotal, 950);
  assert.deepEqual(ok.cart.bundles[0].products.map((product) => product.id), [robe1, pajamas[0]], "fixed bundles use their own pieces");
  assert.equal(ok.cart.bundles[1].unitPrices.reduce((a, b) => a + b, 0), 500);

  const bad = (bundles) => resolveCart({ bundles }).error;
  assert.equal(bad([{ bundleId: "bnd-test00003", productIds: [] }]), "INVALID_BUNDLE", "pending");
  assert.equal(bad([{ bundleId: "bnd-test00002", productIds: [pajamas[1]] }]), "INVALID_BUNDLE", "too few picks");
  assert.equal(bad([{ bundleId: "bnd-test00002", productIds: [pajamas[1], pajamas[1]] }]), "INVALID_BUNDLE", "duplicate");
  assert.equal(bad([{ bundleId: "bnd-test00002", productIds: [pajamas[1], pajamas[6]] }]), "INVALID_BUNDLE", "not in the bundle");
  assert.equal(bad([{ bundleId: "bnd-test00001", productIds: [] }, { bundleId: "bnd-test00001", productIds: [] }]), "INVALID_BUNDLE", "twice");
  assert.equal(resolveCart({ items: [], bundles: [] }).error, "EMPTY");

  // A sold-out piece takes a fixed set off the store; a pick bundle just loses that choice.
  setSoldOut([pajamas[0]]);
  assert.equal(isBundleAvailable(bundle()), false);
  assert.equal(bad([{ bundleId: "bnd-test00001", productIds: [] }]), "INVALID_BUNDLE");
  assert.equal(bad([{ bundleId: "bnd-test00002", productIds: [pajamas[0], pajamas[1]] }]), "INVALID_BUNDLE");
  setSoldOut([]);

  let cart = setCartBundle(emptyCart, { bundleId: "bnd-test00002", productIds: [pajamas[1], pajamas[2]] });
  cart = setCartBundle(cart, { bundleId: "bnd-test00002", productIds: [pajamas[2], pajamas[3]] });
  assert.equal(cart.bundles.length, 1, "same bundle is replaced");
  assert.equal(cartPieceCount(cart), 2);
  assert.deepEqual(sanitizeCart({ offer: null, items: [], bundles: [...cart.bundles, { bundleId: "bnd-test00003", productIds: [] }] }).bundles, cart.bundles);
  assert.deepEqual(sanitizeCart({ offer: null, items: [] }).bundles, [], "old saved carts");
  assert.equal(removeCartBundle(cart, "bnd-test00002").bundles.length, 0);
  setBundles([]);
});

test("team products waiting for approval are hidden from the store", async () => {
  const { toCatalogProduct, parseCustomProduct, inputOf } = await import("../lib/custom-products.ts");
  const input = { name: "بيجاما تجربة الفريق", category: "winter-pajamas", price: 300, imageAlt: "وصف", maxWeightKg: 80, hidden: false };
  const pending = toCatalogProduct("bm-winter-pajama-nteam12345", input, "/api/product-images/img-abcdefgh12", { addedBy: "team", pending: true });
  assert.equal(pending.hidden, true);
  assert.deepEqual(parseCustomProduct(JSON.parse(JSON.stringify(pending))), pending);
  assert.equal(inputOf(pending).hidden, false, "the form's own hide switch is not the approval");
  const approved = toCatalogProduct(pending.id, inputOf(pending), pending.image, { addedBy: "team", approved: true });
  assert.equal(approved.hidden, undefined);
  setCustomProducts([pending]);
  assert.ok(!visibleCatalog.some((product) => product.id === pending.id));
  setCustomProducts([approved]);
  assert.ok(visibleCatalog.some((product) => product.id === pending.id));
  setCustomProducts([]);
});

test("team login: password hash, signed tokens, password change signs out", () => {
  process.env.ADMIN_SESSION_SECRET ??= "test-secret-test-secret-test-secret-123";
  assert.ok(checkTeamPasswordRules("short"));
  assert.equal(checkTeamPasswordRules("long-enough-1"), null);
  const hash = hashTeamPassword("team-pass-123");
  assert.ok(verifyTeamPassword("team-pass-123", hash));
  assert.ok(!verifyTeamPassword("wrong-pass-123", hash));
  assert.ok(!verifyTeamPassword("team-pass-123", null));
  const token = createTeamSessionToken(hash);
  assert.ok(isWellFormedTeamToken(token));
  assert.ok(isValidTeamToken(token, hash));
  assert.ok(!isValidTeamToken(token, hashTeamPassword("team-pass-123")), "new password (new salt) → old sessions out");
  assert.ok(!isValidTeamToken(token, null), "account off");
  assert.ok(!isWellFormedTeamToken(token.slice(0, -2) + "xx"), "tampered");
  assert.ok(!isWellFormedTeamToken(createTeamSessionToken(hash, Date.now() - 15 * 24 * 3600 * 1000)), "expired");
});
