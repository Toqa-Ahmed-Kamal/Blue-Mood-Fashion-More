// Customer journey events (pure, shared by browser and server).
//
// The browser reports what a shopper did — opened a page, opened a product, added it to the cart
// or removed it, opened checkout — under the same anonymous session/visitor IDs used for visit
// counting. Nothing personal is sent: only page paths, product IDs from the catalog and the event type.
import { findProduct } from "./site-data.ts";
import { isTrafficSource, type TrafficSource } from "./traffic-source.ts";

export const CLIENT_JOURNEY_EVENTS = ["page", "view", "add", "remove", "checkout"] as const;
export type ClientJourneyEventType = (typeof CLIENT_JOURNEY_EVENTS)[number];
/** `ago`: milliseconds between the action and the request (events are sent in small batches). */
export type ClientJourneyEvent = { type: ClientJourneyEventType; productId?: string; quantity?: number; path?: string; ago?: number };

export const MAX_EVENTS_PER_REQUEST = 25;
export const MAX_QUANTITY_PER_EVENT = 10;
const MAX_PATH_LENGTH = 120;
const MAX_EVENT_AGE_MS = 10 * 60 * 1000;

/** One step of a stored journey (compact keys keep Redis small). */
export type JourneyEntry =
  /** s source, c campaign, l landing page, u utm_source, m utm_medium, n utm_content, f fbclid present, r referrer host. */
  | { e: "visit"; at: string; s: TrafficSource; c?: string; l?: string; u?: string; m?: string; n?: string; f?: 1; r?: string }
  | { e: "page"; at: string; l: string }
  | { e: "view"; at: string; p: string }
  | { e: "add"; at: string; p: string; q: number }
  | { e: "remove"; at: string; p: string; q: number }
  | { e: "checkout"; at: string }
  | { e: "order"; at: string; o: string; v: number };

/** Batch ID chosen by the browser, so a re-sent batch is stored once. */
export function sanitizeBatchId(value: unknown) {
  return typeof value === "string" && /^[\w-]{8,64}$/.test(value) ? value : null;
}

export const MAX_ORDER_JOURNEY_BATCHES = 3;

/** Batches of not-yet-delivered steps sent along with an order. */
export function sanitizeJourneyBatches(raw: unknown): { batchId: string; events: ClientJourneyEvent[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ORDER_JOURNEY_BATCHES).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const batchId = sanitizeBatchId((item as Record<string, unknown>).batchId);
    const events = sanitizeJourneyEvents((item as Record<string, unknown>).events);
    return batchId && events.length > 0 ? [{ batchId, events }] : [];
  });
}

/** Store paths only: "/", "/checkout", "/offer/<id>" (no query string, no admin pages). */
export function sanitizeJourneyPath(value: unknown) {
  if (typeof value !== "string") return null;
  const path = value.split(/[?#]/)[0].slice(0, MAX_PATH_LENGTH);
  if (!/^\/[\w\-/]*$/.test(path) || path.startsWith("/admin") || path.startsWith("/api")) return null;
  return path;
}

const clampQuantity = (quantity: unknown) =>
  Number.isInteger(quantity) ? Math.min(Math.max(Number(quantity), 1), MAX_QUANTITY_PER_EVENT) : 1;

/** Keeps only well-formed events about real catalog products and store pages; drops anything else. */
export function sanitizeJourneyEvents(raw: unknown): ClientJourneyEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: ClientJourneyEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (typeof item !== "object" || item === null) continue;
    const { type, productId, quantity, path, ago: rawAgo } = item as Record<string, unknown>;
    const ago = Number.isInteger(rawAgo) ? Math.min(Math.max(Number(rawAgo), 0), MAX_EVENT_AGE_MS) : 0;
    if (type === "checkout") {
      events.push({ type, ago });
      continue;
    }
    if (type === "page") {
      const clean = sanitizeJourneyPath(path);
      if (clean) events.push({ type, path: clean, ago });
      continue;
    }
    if ((type !== "view" && type !== "add" && type !== "remove") || typeof productId !== "string" || !findProduct(productId)) continue;
    if (type === "view") events.push({ type, productId, ago });
    else events.push({ type, productId, quantity: clampQuantity(quantity), ago });
  }
  return events;
}

/** Parses stored journey entries, skipping anything malformed. */
export function parseJourney(raw: unknown): JourneyEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const entries: JourneyEntry[] = [];
  for (const value of list) {
    let entry: unknown = value;
    if (typeof value === "string") {
      try {
        entry = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.at !== "string") continue;
    if (item.e === "visit" && isTrafficSource(item.s)) entries.push(item as JourneyEntry);
    else if (item.e === "page" && typeof item.l === "string") entries.push(item as JourneyEntry);
    else if ((item.e === "view" || item.e === "add" || item.e === "remove") && typeof item.p === "string") entries.push(item as JourneyEntry);
    else if (item.e === "checkout") entries.push(item as JourneyEntry);
    else if (item.e === "order" && typeof item.o === "string") entries.push(item as JourneyEntry);
  }
  return entries;
}
