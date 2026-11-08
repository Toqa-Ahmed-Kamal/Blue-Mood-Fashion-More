// Browser-only helpers for Meta Pixel events; imported by client components.
import { landingPromotion, priceOf, type CatalogProduct } from "@/lib/site-data";
import type { ResolvedCart } from "@/lib/cart";

type PixelWindow = Window & { fbq?: (...args: unknown[]) => void };

type PixelEvent = "AddToCart" | "InitiateCheckout" | "Purchase";

const CURRENCY = "EGP";

/** Sends a standard Meta Pixel event. Does nothing when the Pixel is not configured or blocked. */
function track(event: PixelEvent, params: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined") return;
  const fbq = (window as PixelWindow).fbq;
  if (typeof fbq !== "function") return;
  try {
    if (eventId) fbq("track", event, params, { eventID: eventId });
    else fbq("track", event, params);
  } catch {
    // Tracking must never break the store.
  }
}

/** Runs `send` only once per browser tab for `key`, so refreshes and re-renders don't repeat an event. */
function once(key: string, send: () => void) {
  const storageKey = `bm-pixel:${key}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Storage unavailable (private mode): still send, the caller already guards re-renders.
  }
  send();
}

export function trackAddToCart(product: CatalogProduct) {
  const price = priceOf(product);
  track("AddToCart", {
    content_ids: [product.id],
    content_name: product.name,
    content_category: product.category,
    content_type: "product",
    contents: [{ id: product.id, quantity: 1, item_price: price ?? undefined }],
    value: price ?? 0,
    currency: CURRENCY,
  });
}

export function trackAddOfferToCart(offerId: string, productIds: string[]) {
  const offer = landingPromotion.options.find((option) => option.id === offerId);
  track("AddToCart", {
    content_ids: productIds,
    content_name: offer?.label ?? offerId,
    content_category: "offer",
    content_type: "product",
    contents: productIds.map((id) => ({ id, quantity: 1 })),
    value: landingPromotion.price,
    currency: CURRENCY,
  });
}

function cartContents(cart: ResolvedCart) {
  const offerIds = cart.offer?.products.map((product) => product.id) ?? [];
  const items = cart.items.map((line) => ({ id: line.product.id, quantity: line.quantity, item_price: line.unitPrice }));
  return {
    content_ids: [...offerIds, ...items.map((item) => item.id)],
    contents: [...offerIds.map((id) => ({ id, quantity: 1 })), ...items],
    num_items: offerIds.length + items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/** Once per distinct cart per tab: opening checkout again with the same cart (or refreshing) is not re-counted. */
export function trackInitiateCheckout(cart: ResolvedCart, cartKey: string) {
  once(`checkout:${cartKey}`, () => {
    track("InitiateCheckout", { ...cartContents(cart), content_type: "product", value: cart.subtotal, currency: CURRENCY });
  });
}

/** Call only after the server confirmed the order was saved. The order ID doubles as Meta's dedup eventID. */
export function trackPurchase(cart: ResolvedCart, order: { orderId: string; subtotal: number; total: number | null }) {
  once(`purchase:${order.orderId}`, () => {
    track(
      "Purchase",
      { ...cartContents(cart), content_type: "product", value: order.total ?? order.subtotal, currency: CURRENCY, order_id: order.orderId },
      order.orderId,
    );
  });
}
