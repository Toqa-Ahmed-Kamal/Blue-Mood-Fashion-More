// Customer journey events (pure, shared by browser and server).
//
// The browser reports what a shopper did — opened a product, added it to the cart, opened
// checkout — under the same anonymous session/visitor IDs used for visit counting. Nothing
// personal is sent: only product IDs from the catalog and the event type.
import { findProduct } from "./site-data.ts";
import { isTrafficSource, type TrafficSource } from "./traffic-source.ts";

export const CLIENT_JOURNEY_EVENTS = ["view", "add", "checkout"] as const;
export type ClientJourneyEventType = (typeof CLIENT_JOURNEY_EVENTS)[number];
export type ClientJourneyEvent = { type: ClientJourneyEventType; productId?: string; quantity?: number };

export const MAX_EVENTS_PER_REQUEST = 25;
export const MAX_QUANTITY_PER_EVENT = 10;

/** One step of a stored journey (compact keys keep Redis small). */
export type JourneyEntry =
  | { e: "visit"; at: string; s: TrafficSource; c?: string; l?: string }
  | { e: "view"; at: string; p: string }
  | { e: "add"; at: string; p: string; q: number }
  | { e: "checkout"; at: string }
  | { e: "order"; at: string; o: string; v: number };

/** Keeps only well-formed events about real catalog products; drops anything else. */
export function sanitizeJourneyEvents(raw: unknown): ClientJourneyEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: ClientJourneyEvent[] = [];
  for (const item of raw.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (typeof item !== "object" || item === null) continue;
    const { type, productId, quantity } = item as Record<string, unknown>;
    if (type === "checkout") {
      events.push({ type });
      continue;
    }
    if ((type !== "view" && type !== "add") || typeof productId !== "string" || !findProduct(productId)) continue;
    if (type === "view") {
      events.push({ type, productId });
    } else {
      const count = Number.isInteger(quantity) ? Math.min(Math.max(Number(quantity), 1), MAX_QUANTITY_PER_EVENT) : 1;
      events.push({ type, productId, quantity: count });
    }
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
    else if ((item.e === "view" || item.e === "add") && typeof item.p === "string") entries.push(item as JourneyEntry);
    else if (item.e === "checkout") entries.push(item as JourneyEntry);
    else if (item.e === "order" && typeof item.o === "string") entries.push(item as JourneyEntry);
  }
  return entries;
}
