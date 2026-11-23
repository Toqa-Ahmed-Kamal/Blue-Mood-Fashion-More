import {
  findOffer,
  findProduct,
  isOfferExcluded,
  isLimitedIn,
  isOnStore,
  isSoldOut,
  landingPromotion,
  OFFER_LIMITED_MAX,
  optionPrice,
  priceOf,
  type CatalogProduct,
  type LandingPromotionOptionId,
} from "./site-data.ts";
import { bundleChoices, findBundle, isBundleAvailable, splitBundlePrice, type Bundle } from "./bundles.ts";

export type CartOffer = { offerId: LandingPromotionOptionId; productIds: string[] };
export type CartItem = { productId: string; quantity: number };
/** A bundle (عرض) in the cart: fixed bundles carry their own pieces, pick bundles the customer's picks. */
export type CartBundle = { bundleId: string; productIds: string[] };
export type Cart = { offer: CartOffer | null; items: CartItem[]; bundles: CartBundle[] };

export const emptyCart: Cart = { offer: null, items: [], bundles: [] };
export const MAX_ITEM_QUANTITY = 10;

type OfferOption = (typeof landingPromotion.options)[number];

export type ResolvedCartLine = {
  product: CatalogProduct;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ResolvedBundle = {
  bundle: Bundle;
  products: CatalogProduct[];
  /** The bundle price split over its pieces (adds up to the bundle price). */
  unitPrices: number[];
};

export type ResolvedCart = {
  offer: { option: OfferOption; products: CatalogProduct[]; price: number } | null;
  items: ResolvedCartLine[];
  bundles: ResolvedBundle[];
  offerTotal: number;
  itemsTotal: number;
  bundlesTotal: number;
  subtotal: number;
};

export type CartError = "EMPTY" | "INVALID_CART" | "INVALID_OFFER" | "INVALID_BUNDLE" | "INVALID_ITEM";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderable(product: CatalogProduct | undefined): product is CatalogProduct {
  return product !== undefined && isOnStore(product) && !isSoldOut(product.id);
}

export function isSoldSingly(product: CatalogProduct) {
  return priceOf(product) !== null;
}

function resolveOffer(value: unknown): { offer: ResolvedCart["offer"] } | { error: CartError } {
  if (value === null || value === undefined) return { offer: null };
  if (!isRecord(value) || typeof value.offerId !== "string") return { error: "INVALID_OFFER" };

  const option = findOffer(value.offerId);
  if (!option) return { error: "INVALID_OFFER" };

  const ids = value.productIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return { error: "INVALID_BUNDLE" };
  if (new Set(ids).size !== ids.length) return { error: "INVALID_BUNDLE" };

  const products = (ids as string[]).map(findProduct);
  if (!products.every(isOrderable)) return { error: "INVALID_BUNDLE" };

  const pajamas = products.filter((product) => product.category === "winter-pajamas").length;
  const blankets = products.filter((product) => product.category === "wearable-blankets").length;
  if (pajamas !== option.pajamaCount || blankets !== option.wearableBlanketCount || pajamas + blankets !== products.length) {
    return { error: "INVALID_BUNDLE" };
  }
  // At most one pajama of the offer's "one per offer" group (winter: factory price 220; christmas: above 190).
  if (products.filter((product) => isLimitedIn(option, product)).length > OFFER_LIMITED_MAX) return { error: "INVALID_BUNDLE" };
  if (products.some(isOfferExcluded)) return { error: "INVALID_BUNDLE" };

  return { offer: { option, products, price: optionPrice(option) } };
}

function resolveItems(value: unknown): { items: ResolvedCartLine[] } | { error: CartError } {
  if (value === undefined) return { items: [] };
  if (!Array.isArray(value)) return { error: "INVALID_ITEM" };

  const seen = new Set<string>();
  const items: ResolvedCartLine[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.productId !== "string" || seen.has(raw.productId)) return { error: "INVALID_ITEM" };
    const quantity = raw.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return { error: "INVALID_ITEM" };
    }
    const product = findProduct(raw.productId);
    const unitPrice = product ? priceOf(product) : null;
    if (!isOrderable(product) || unitPrice === null) return { error: "INVALID_ITEM" };

    seen.add(raw.productId);
    items.push({ product, quantity, unitPrice, lineTotal: unitPrice * quantity });
  }
  return { items };
}

function resolveOneBundle(raw: unknown): ResolvedBundle | null {
  if (!isRecord(raw) || typeof raw.bundleId !== "string") return null;
  const bundle = findBundle(raw.bundleId);
  if (!bundle || !isBundleAvailable(bundle)) return null;
  let products: CatalogProduct[];
  if (bundle.kind === "fixed") {
    products = bundleChoices(bundle);
  } else {
    const ids = raw.productIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length || ids.length !== bundle.pickCount) return null;
    const allowed = new Map(bundleChoices(bundle).map((product) => [product.id, product]));
    const picked = (ids as string[]).map((id) => allowed.get(id));
    if (picked.some((product) => product === undefined)) return null;
    products = picked as CatalogProduct[];
  }
  return { bundle, products, unitPrices: splitBundlePrice(bundle.price, products) };
}

function resolveBundles(value: unknown): { bundles: ResolvedBundle[] } | { error: CartError } {
  if (value === undefined || value === null) return { bundles: [] };
  if (!Array.isArray(value)) return { error: "INVALID_BUNDLE" };
  const seen = new Set<string>();
  const bundles: ResolvedBundle[] = [];
  for (const raw of value) {
    const resolved = resolveOneBundle(raw);
    if (!resolved || seen.has(resolved.bundle.id)) return { error: "INVALID_BUNDLE" };
    seen.add(resolved.bundle.id);
    bundles.push(resolved);
  }
  return { bundles };
}

/** Validates an untrusted cart (request body or saved state) and prices it from the catalog. */
export function resolveCart(value: unknown): { cart: ResolvedCart } | { error: CartError } {
  if (!isRecord(value)) return { error: "INVALID_CART" };

  const offerResult = resolveOffer(value.offer);
  if ("error" in offerResult) return offerResult;
  const itemsResult = resolveItems(value.items);
  if ("error" in itemsResult) return itemsResult;

  const bundlesResult = resolveBundles(value.bundles);
  if ("error" in bundlesResult) return bundlesResult;

  const { offer } = offerResult;
  const { items } = itemsResult;
  const { bundles } = bundlesResult;
  if (!offer && items.length === 0 && bundles.length === 0) return { error: "EMPTY" };

  const offerTotal = offer?.price ?? 0;
  const itemsTotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
  const bundlesTotal = bundles.reduce((sum, entry) => sum + entry.bundle.price, 0);
  return { cart: { offer, items, bundles, offerTotal, itemsTotal, bundlesTotal, subtotal: offerTotal + itemsTotal + bundlesTotal } };
}

/** Keeps whatever parts of a saved cart are still valid, dropping the rest. */
export function sanitizeCart(value: unknown): Cart {
  if (!isRecord(value)) return emptyCart;

  const offerResult = resolveOffer(value.offer);
  const offer = "offer" in offerResult && offerResult.offer
    ? { offerId: offerResult.offer.option.id, productIds: offerResult.offer.products.map((product) => product.id) }
    : null;

  const items = Array.isArray(value.items)
    ? value.items.flatMap((raw): CartItem[] => {
        const result = resolveItems([raw]);
        return "items" in result ? result.items.map((line) => ({ productId: line.product.id, quantity: line.quantity })) : [];
      })
    : [];
  const unique = items.filter((item, index) => items.findIndex((other) => other.productId === item.productId) === index);

  const bundles = Array.isArray(value.bundles)
    ? value.bundles.flatMap((raw): CartBundle[] => {
        const resolved = resolveOneBundle(raw);
        return resolved ? [{ bundleId: resolved.bundle.id, productIds: resolved.products.map((product) => product.id) }] : [];
      })
    : [];
  const uniqueBundles = bundles.filter((entry, index) => bundles.findIndex((other) => other.bundleId === entry.bundleId) === index);

  return { offer, items: unique, bundles: uniqueBundles };
}

export function setCartItemQuantity(cart: Cart, productId: string, quantity: number): Cart {
  const clamped = Math.max(0, Math.min(MAX_ITEM_QUANTITY, Math.floor(quantity)));
  const exists = cart.items.some((item) => item.productId === productId);
  if (clamped === 0) return { ...cart, items: cart.items.filter((item) => item.productId !== productId) };
  if (exists) {
    return { ...cart, items: cart.items.map((item) => item.productId === productId ? { ...item, quantity: clamped } : item) };
  }
  const product = findProduct(productId);
  if (!isOrderable(product) || !isSoldSingly(product)) return cart;
  return { ...cart, items: [...cart.items, { productId, quantity: clamped }] };
}

export function addCartItem(cart: Cart, productId: string): Cart {
  const current = cart.items.find((item) => item.productId === productId)?.quantity ?? 0;
  return setCartItemQuantity(cart, productId, current + 1);
}

export function setCartOffer(cart: Cart, offer: CartOffer | null): Cart {
  return { ...cart, offer };
}

/** Puts a bundle in the cart (replacing the same bundle if it is there already). */
export function setCartBundle(cart: Cart, entry: CartBundle): Cart {
  return { ...cart, bundles: [...(cart.bundles ?? []).filter((other) => other.bundleId !== entry.bundleId), entry] };
}

export function removeCartBundle(cart: Cart, bundleId: string): Cart {
  return { ...cart, bundles: (cart.bundles ?? []).filter((entry) => entry.bundleId !== bundleId) };
}

export function cartPieceCount(cart: Cart) {
  return (cart.offer?.productIds.length ?? 0) + cart.items.reduce((sum, item) => sum + item.quantity, 0) + (cart.bundles ?? []).reduce((sum, entry) => sum + entry.productIds.length, 0);
}
