// Browser-only: sends customer-journey events (page opened, product opened, added to / removed
// from the cart, checkout opened) to /api/track/events in small batches. Each event carries how
// long ago it happened, so the server stores the real time.
//
// Nothing is lost on reload or navigation, and nothing is counted twice: every batch has an ID
// and stays saved in sessionStorage until a request for it is confirmed. A batch sent while the
// page was closing (sendBeacon) is sent again by the next page, and the server ignores a batch
// ID it has already stored. Steps still waiting when the order is placed travel with the order.
// Best-effort — it never throws and never blocks the store.
import { currentVisitIds } from "@/lib/attribution-store";
import type { ClientJourneyEvent } from "@/lib/journey";

const FLUSH_DELAY_MS = 3_000;
const DEDUPE_PREFIX = "bm-journey:";
const STATE_KEY = "bm-journey-state-v1";
const ENDPOINT = "/api/track/events";
const MAX_EVENTS = 25;
const MAX_UNCONFIRMED_BATCHES = 6;
/** Batches carried by the order request (keeps it small). */
const MAX_ORDER_BATCHES = 3;

type Queued = { event: ClientJourneyEvent; ts: number };
type Batch = { id: string; items: Queued[] };

let queue: Queued[] = [];
/** Batches sent but not confirmed yet (or sent while the page was closing). */
let unconfirmed: Batch[] = [];
let restored = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let lastPage = { path: "", ts: 0 };

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

function persist() {
  try {
    if (queue.length === 0 && unconfirmed.length === 0) window.sessionStorage.removeItem(STATE_KEY);
    else window.sessionStorage.setItem(STATE_KEY, JSON.stringify({ queue: queue.slice(-MAX_EVENTS), unconfirmed: unconfirmed.slice(-MAX_UNCONFIRMED_BATCHES) }));
  } catch {
    // Storage blocked: events still go out from memory.
  }
}

const isQueued = (item: unknown): item is Queued =>
  typeof item === "object" && item !== null && typeof (item as Queued).ts === "number" && typeof (item as Queued).event?.type === "string";

/** Steps the previous page of this tab had not delivered (reload / navigation / closing). */
function restore() {
  if (restored) return;
  restored = true;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STATE_KEY) ?? "{}");
    if (Array.isArray(saved.queue)) queue = [...saved.queue.filter(isQueued), ...queue].slice(-MAX_EVENTS);
    if (Array.isArray(saved.unconfirmed)) {
      unconfirmed = saved.unconfirmed
        .filter((batch: Batch) => typeof batch?.id === "string" && Array.isArray(batch.items))
        .map((batch: Batch) => ({ id: batch.id, items: batch.items.filter(isQueued) }))
        .slice(-MAX_UNCONFIRMED_BATCHES);
    }
  } catch {
    // Ignore a broken copy.
  }
  // Re-send what the previous page could not confirm (the server skips batch IDs it already has).
  if (unconfirmed.length > 0) setTimeout(() => resendUnconfirmed(), 0);
  if (queue.length > 0) schedule();
}

function newBatchId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function payload(batch: Batch) {
  const ids = currentVisitIds();
  if (!ids) return null;
  const now = Date.now();
  return JSON.stringify({ ...ids, batchId: batch.id, events: batch.items.map(({ event, ts }) => ({ ...event, ago: Math.max(0, now - ts) })) });
}

function confirm(batchId: string) {
  unconfirmed = unconfirmed.filter((batch) => batch.id !== batchId);
  persist();
}

function send(batch: Batch, leaving: boolean) {
  const body = payload(batch);
  if (!body) return;
  try {
    if (leaving && typeof navigator.sendBeacon === "function") {
      // Kept as unconfirmed either way: the next page re-sends it and the server skips duplicates.
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .then((response) => { if (response.ok) confirm(batch.id); })
      .catch(() => {});
  } catch {
    // Stays unconfirmed; re-sent later.
  }
}

function resendUnconfirmed() {
  if (!currentVisitIds()) return;
  for (const batch of unconfirmed) send(batch, false);
}

/** `leaving`: the page is being hidden or unloaded. */
function flush(leaving = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  // The visit is registered right after the first page load; keep the events until it exists.
  if (!currentVisitIds()) {
    if (!leaving) schedule();
    return;
  }
  const batch: Batch = { id: newBatchId(), items: queue.slice(0, MAX_EVENTS) };
  queue = queue.slice(batch.items.length);
  unconfirmed = [...unconfirmed, batch].slice(-MAX_UNCONFIRMED_BATCHES);
  persist();
  send(batch, leaving);
  if (queue.length > 0 && !leaving) schedule();
}

function schedule() {
  if (!timer) timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
}

function listenForPageExit() {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

function enqueue(event: ClientJourneyEvent) {
  try {
    if (window.location.pathname.startsWith("/admin")) return;
    restore();
    listenForPageExit();
    queue.push({ event, ts: Date.now() });
    persist();
    if (queue.length >= 20) flush();
    else schedule();
  } catch {
    // Never break the store.
  }
}

/** A store page was opened (each navigation and each reload counts). */
export function trackPageView(path: string) {
  if (typeof window === "undefined" || path.startsWith("/admin")) return;
  const now = Date.now();
  // React may run the same navigation effect twice in a row.
  if (lastPage.path === path && now - lastPage.ts < 2_000) return;
  lastPage = { path, ts: now };
  enqueue({ type: "page", path });
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

/** A piece was removed from the cart (quantity lowered, line deleted, or the offer removed). */
export function trackCartRemove(productId: string, quantity = 1) {
  if (typeof window === "undefined") return;
  enqueue({ type: "remove", productId, quantity });
}

/**
 * Checkout was opened with a cart. Once per tab. Sent right away (with anything still queued)
 * so it is stored before a quick order. The checkout page itself is logged first.
 */
export function trackCheckoutStep() {
  if (typeof window === "undefined" || !firstInTab("checkout")) return;
  trackPageView(window.location.pathname);
  enqueue({ type: "checkout" });
  flush();
}

/**
 * Steps not delivered yet, to travel with the order request as one more batch: the server stores
 * them (skipping any batch it already has) before it takes the order's journey snapshot.
 */
export function takePendingJourney(): { batchId: string; events: ClientJourneyEvent[] }[] {
  if (typeof window === "undefined") return [];
  restore();
  if (timer) clearTimeout(timer);
  timer = null;
  const batches = [...unconfirmed.slice(-(MAX_ORDER_BATCHES - 1)), ...(queue.length > 0 ? [{ id: newBatchId(), items: queue.slice(-MAX_EVENTS) }] : [])];
  queue = [];
  unconfirmed = [];
  persist();
  const now = Date.now();
  return batches.map((batch) => ({ batchId: batch.id, events: batch.items.map(({ event, ts }) => ({ ...event, ago: Math.max(0, now - ts) })) }));
}
