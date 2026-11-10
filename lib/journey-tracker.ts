// Browser-only: sends customer-journey events (product opened, added to cart, checkout opened)
// to /api/track/events in small batches. Best-effort — it never throws and never blocks the store.
import { currentVisitIds } from "@/lib/attribution-store";
import type { ClientJourneyEvent } from "@/lib/journey";

const FLUSH_DELAY_MS = 3_000;
const DEDUPE_PREFIX = "bm-journey:";

let queue: ClientJourneyEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/** True the first time `key` is seen in this tab. */
function firstInTab(key: string) {
  try {
    if (window.sessionStorage.getItem(DEDUPE_PREFIX + key)) return false;
    window.sessionStorage.setItem(DEDUPE_PREFIX + key, "1");
  } catch {
    // Storage blocked: count it anyway.
  }
  return true;
}

function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  const ids = currentVisitIds();
  if (!ids) return;
  try {
    void fetch("/api/track/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ids, events }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Best-effort.
  }
}

function listenForPageExit() {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function enqueue(event: ClientJourneyEvent) {
  try {
    if (window.location.pathname.startsWith("/admin")) return;
    listenForPageExit();
    queue.push(event);
    if (queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  } catch {
    // Never break the store.
  }
}

/** The shopper opened a product (full photo / details). Counted once per product per tab. */
export function trackProductView(productId: string) {
  if (typeof window === "undefined" || !firstInTab(`view:${productId}`)) return;
  enqueue({ type: "view", productId });
}

/** A piece was added to the cart (each add counts). */
export function trackProductAdd(productId: string, quantity = 1) {
  if (typeof window === "undefined") return;
  enqueue({ type: "add", productId, quantity });
}

/**
 * Checkout was opened with a cart. Once per tab. Sent right away (with anything still queued)
 * so it is stored before a quick order and shows up in that order's journey.
 */
export function trackCheckoutStep() {
  if (typeof window === "undefined" || !firstInTab("checkout")) return;
  enqueue({ type: "checkout" });
  flush();
}
