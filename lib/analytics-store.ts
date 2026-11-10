// Server-only persistence for the admin dashboard, on the existing Upstash Redis.
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   visits:{day}          HASH  all | s:<source> | t:<type> | c:<campaign> | a:<ad content>
//                               | sc:<source>|<campaign>                                    (TTL 400 days)
//   visitors:{day}        HLL   anonymous browser IDs, for unique visitors                    (TTL 400 days)
//   seen:{sessionId}      STR   one count per browsing session                                (TTL 24 h)
//   products:{day}        HASH  v:<productId> views | a:<productId> pieces added to cart       (TTL 400 days)
//   adders:{day}:{pid}    HLL   visitor IDs that added the product, for unique customers       (TTL 400 days)
//   funnel:{day}:{step}   HLL   session IDs that reached view / add / checkout / order         (TTL 400 days)
//   journey:{visitorId}   LIST  latest steps of one anonymous visitor (JSON JourneyEntry)      (TTL 30 days)
//   order:{orderId}       STR   JSON AnalyticsOrder, no personal data                         (TTL 730 days)
//   orderdetails:{id}     STR   customer + items, AES-256-GCM encrypted (lib/order-vault)      (TTL 730 days)
//   orderjourney:{id}     STR   JSON JourneyEntry[] snapshot taken when the order was placed   (TTL 730 days)
//   oldorders             HASH  orderId → AES-256-GCM encrypted OldOrder (Telegram import)      (no TTL)
//   orders                ZSET  orderId scored by creation time (old members trimmed on write)
//   rl:visit:{ipHash}     STR   visit rate limit per hashed IP                                (TTL 1 h)
//   rl:event:{ipHash}     STR   journey-event rate limit per hashed IP                        (TTL 1 h)
//   evbatch:{vid}:{batch} STR   journey batch already stored (a re-sent batch is skipped)     (TTL 24 h)
//   rl:login:{ipHash}     STR   failed-login counter per hashed IP                            (TTL 15 min)
// IPs are never stored: only a keyed, daily-rotating HMAC is used as a short-lived counter name.
// Customer name / phone / address exist only inside the encrypted orderdetails blob.
import { createHmac } from "node:crypto";

import type { OrderAttribution, Touch } from "./attribution.ts";
import {
  FUNNEL_STEPS,
  ORDER_STATUSES,
  buildReport,
  orderValue,
  type AnalyticsOrder,
  type DayVisits,
  type FunnelCounts,
  type OrderStatus,
} from "./analytics-report.ts";
import { parseJourney, type ClientJourneyEvent, type JourneyEntry } from "./journey.ts";
import type { OrderRecord } from "./order-record.ts";
import { openOrderDetails, type OrderDetails } from "./order-vault.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { sourceTypeOf, trafficSourceOf, type TrafficSource } from "./traffic-source.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIT_TTL_SECONDS = 400 * 24 * 60 * 60;
const ORDER_TTL_SECONDS = 730 * 24 * 60 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
// Customer details and the journey snapshot live exactly as long as the order record itself.
const ORDER_DETAILS_TTL_SECONDS = ORDER_TTL_SECONDS;
const JOURNEY_TTL_SECONDS = 30 * 24 * 60 * 60;
const JOURNEY_MAX_ENTRIES = 80;
const MAX_EVENT_REQUESTS_PER_IP_PER_HOUR = 300;
export const MAX_REPORT_DAYS = 400;
const MAX_VISITS_PER_IP_PER_HOUR = 60;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;
const MAX_LABEL_LENGTH = 100;

const key = (name: string) => `${keyPrefix()}${name}`;

const cairoFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar day in Cairo, YYYY-MM-DD. */
export function cairoDay(date: Date) {
  return cairoFormatter.format(date);
}

export function isDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Inclusive list of days, or null when the range is invalid or longer than MAX_REPORT_DAYS. */
export function daysBetween(from: string, to: string) {
  if (!isDay(from) || !isDay(to) || from > to) return null;
  const days: string[] = [];
  for (let time = Date.parse(`${from}T00:00:00Z`); time <= Date.parse(`${to}T00:00:00Z`); time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
    if (days.length > MAX_REPORT_DAYS) return null;
  }
  return days;
}

/** Keyed, daily-rotating hash so a raw IP never reaches Redis. */
export function hashIp(ip: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.KV_REST_API_TOKEN || "";
  return createHmac("sha256", `bm-ip:${secret}`).update(`${cairoDay(new Date())}|${ip}`).digest("base64url").slice(0, 22);
}

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
}

const label = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);

// ── Visits ────────────────────────────────────────────────────────────────

export type VisitResult = "counted" | "duplicate" | "rate_limited";

/** Counts one browsing session. A repeated sessionId (reload, retry, double send) is ignored. */
export async function recordVisit(input: { sessionId: string; visitorId: string; touch: Touch; ipHash: string; now?: Date }): Promise<VisitResult> {
  const now = input.now ?? new Date();
  const results = await redisPipeline([
    ["INCR", key(`rl:visit:${input.ipHash}`)],
    ["EXPIRE", key(`rl:visit:${input.ipHash}`), 3600, "NX"],
    ["SET", key(`seen:${input.sessionId}`), "1", "NX", "EX", SESSION_TTL_SECONDS],
  ], "write");
  const rateCount = Number(results[0]);
  const firstSeen = results[2];

  if (firstSeen !== "OK") return "duplicate";
  if (rateCount > MAX_VISITS_PER_IP_PER_HOUR) return "rate_limited";

  const day = cairoDay(now);
  const source = trafficSourceOf(input.touch);
  const visitsKey = key(`visits:${day}`);
  const visitorsKey = key(`visitors:${day}`);
  const campaign = label(input.touch.utmCampaign);
  const adContent = label(input.touch.utmContent);

  await redisPipeline([
    ["HINCRBY", visitsKey, "all", 1],
    ["HINCRBY", visitsKey, `s:${source}`, 1],
    ["HINCRBY", visitsKey, `t:${sourceTypeOf(source)}`, 1],
    ...(campaign ? [["HINCRBY", visitsKey, `c:${campaign}`, 1]] : []),
    ...(adContent ? [["HINCRBY", visitsKey, `a:${adContent}`, 1]] : []),
    ["HINCRBY", visitsKey, `sc:${source}|${campaign}`, 1],
    ["EXPIRE", visitsKey, VISIT_TTL_SECONDS],
    ["PFADD", visitorsKey, input.visitorId],
    ["EXPIRE", visitorsKey, VISIT_TTL_SECONDS],
    ...journeyPush(input.visitorId, [visitEntry(input.touch, source, campaign, now)]),
  ], "write");
  return "counted";
}

type Command = (string | number)[];

/** Journey step for a new visit, with the campaign tags that brought it (fbclid only as "present"). */
function visitEntry(touch: Touch, source: TrafficSource, campaign: string, now: Date): JourneyEntry {
  let referrerHost = "";
  try {
    referrerHost = touch.referrer ? new URL(touch.referrer).hostname : "";
  } catch {
    referrerHost = "";
  }
  return {
    e: "visit",
    at: now.toISOString(),
    s: source,
    ...(campaign ? { c: campaign } : {}),
    ...(touch.landingPage ? { l: touch.landingPage.slice(0, 200) } : {}),
    ...(touch.utmSource ? { u: label(touch.utmSource) } : {}),
    ...(touch.utmMedium ? { m: label(touch.utmMedium) } : {}),
    ...(touch.utmContent ? { n: label(touch.utmContent) } : {}),
    ...(touch.fbclid ? { f: 1 as const } : {}),
    ...(referrerHost ? { r: referrerHost.slice(0, 100) } : {}),
  };
}

/** Appends steps to a visitor's journey list, keeping only the latest ones. */
function journeyPush(visitorId: string, entries: JourneyEntry[]): Command[] {
  if (entries.length === 0) return [];
  const listKey = key(`journey:${visitorId}`);
  return [
    ["RPUSH", listKey, ...entries.map((entry) => JSON.stringify(entry))],
    ["LTRIM", listKey, -JOURNEY_MAX_ENTRIES, -1],
    ["EXPIRE", listKey, JOURNEY_TTL_SECONDS],
  ];
}

// ── Journey events (pages, product views, cart adds / removals, checkout) ──

export type EventsResult = "recorded" | "rate_limited" | "duplicate" | "empty";
const EVENT_BATCH_TTL_SECONDS = 24 * 60 * 60;

/** Records one batch of browser events: product counters, funnel steps and the visitor's journey. */
export async function recordEvents(input: { sessionId: string; visitorId: string; events: ClientJourneyEvent[]; ipHash: string; batchId?: string | null; now?: Date }): Promise<EventsResult> {
  if (input.events.length === 0) return "empty";
  const [count, , firstTime] = await redisPipeline([
    ["INCR", key(`rl:event:${input.ipHash}`)],
    ["EXPIRE", key(`rl:event:${input.ipHash}`), 3600, "NX"],
    // The browser re-sends a batch it could not confirm (page closed); store each batch once.
    ...(input.batchId ? [["SET", key(`evbatch:${input.visitorId}:${input.batchId}`), "1", "NX", "EX", EVENT_BATCH_TTL_SECONDS]] : []),
  ], "write");
  if (Number(count) > MAX_EVENT_REQUESTS_PER_IP_PER_HOUR) return "rate_limited";
  if (input.batchId && firstTime !== "OK") return "duplicate";

  const now = input.now ?? new Date();
  const day = cairoDay(now);
  const productsKey = key(`products:${day}`);
  const commands: Command[] = [];
  const steps = new Set<string>();
  const addedProducts = new Set<string>();
  const entries: JourneyEntry[] = [];

  for (const event of input.events) {
    // The browser batches events: keep the moment each one actually happened.
    const at = new Date(now.getTime() - (event.ago ?? 0)).toISOString();
    if ((FUNNEL_STEPS as readonly string[]).includes(event.type)) steps.add(event.type);
    if (event.type === "page" && event.path) {
      entries.push({ e: "page", at, l: event.path });
    } else if (event.type === "remove" && event.productId) {
      entries.push({ e: "remove", at, p: event.productId, q: event.quantity ?? 1 });
    } else if (event.type === "view" && event.productId) {
      commands.push(["HINCRBY", productsKey, `v:${event.productId}`, 1]);
      entries.push({ e: "view", at, p: event.productId });
    } else if (event.type === "add" && event.productId) {
      const quantity = event.quantity ?? 1;
      commands.push(["HINCRBY", productsKey, `a:${event.productId}`, quantity]);
      addedProducts.add(event.productId);
      entries.push({ e: "add", at, p: event.productId, q: quantity });
    } else if (event.type === "checkout") {
      entries.push({ e: "checkout", at });
    }
  }
  if (commands.length > 0) commands.push(["EXPIRE", productsKey, VISIT_TTL_SECONDS]);
  for (const productId of addedProducts) {
    const addersKey = key(`adders:${day}:${productId}`);
    commands.push(["PFADD", addersKey, input.visitorId], ["EXPIRE", addersKey, VISIT_TTL_SECONDS]);
  }
  for (const step of steps) {
    const funnelKey = key(`funnel:${day}:${step}`);
    commands.push(["PFADD", funnelKey, input.sessionId], ["EXPIRE", funnelKey, VISIT_TTL_SECONDS]);
  }
  commands.push(...journeyPush(input.visitorId, entries));

  await redisPipeline(commands, "write");
  return "recorded";
}

// ── Orders ────────────────────────────────────────────────────────────────

/** Builds the stored copy of an order. Personal fields of OrderRecord are intentionally not copied. */
export function toAnalyticsOrder(order: OrderRecord, attribution: OrderAttribution | null): AnalyticsOrder {
  const firstTouch = attribution?.firstTouch ?? null;
  const lastTouch = attribution?.lastTouch ?? null;
  // Last non-direct touch: the browser keeps the last campaign/referral visit as lastTouch.
  const creditTouch = lastTouch ?? firstTouch;
  const source = trafficSourceOf(creditTouch);
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    day: cairoDay(new Date(order.createdAt)),
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    total: order.total,
    governorate: order.governorate,
    offerName: order.offerName,
    products: order.products.map((product) => ({ modelId: product.modelId, category: product.category, quantity: product.quantity })),
    firstTouch,
    lastTouch,
    source,
    sourceType: sourceTypeOf(source),
    campaign: label(creditTouch?.utmCampaign ?? ""),
    adContent: label(creditTouch?.utmContent ?? ""),
    landingPage: creditTouch?.landingPage ?? firstTouch?.landingPage ?? "",
    status: "submitted",
    statusAt: null,
    confirmedValue: null,
  };
}

/** Anonymous browser IDs sent with the order, so it joins the shopper's journey and the funnel. */
export type OrderVisitIds = { sessionId: string | null; visitorId: string | null };

/**
 * Idempotent: a retried submission with the same order ID is stored once.
 * `sealedDetails` is the encrypted customer copy (null when ORDER_DATA_KEY is not set).
 */
export async function saveOrder(order: AnalyticsOrder, extra: { sealedDetails?: string | null; visit?: OrderVisitIds } = {}) {
  const createdMs = Date.parse(order.createdAt);
  const visitorId = extra.visit?.visitorId ?? null;
  const sessionId = extra.visit?.sessionId ?? null;
  const orderEntry: JourneyEntry = { e: "order", at: order.createdAt, o: order.orderId, v: orderValue(order) };

  // Snapshot of the steps that led to this order (the live list expires after 30 days).
  let journey: JourneyEntry[] = [];
  if (visitorId) {
    const [list] = await redisPipeline([["LRANGE", key(`journey:${visitorId}`), -JOURNEY_MAX_ENTRIES, -1]], "write");
    journey = parseJourney(list);
  }

  const funnelKey = key(`funnel:${order.day}:order`);
  const [stored] = await redisPipeline([
    ["SET", key(`order:${order.orderId}`), JSON.stringify(order), "NX", "EX", ORDER_TTL_SECONDS],
    ["ZADD", key("orders"), "NX", createdMs, order.orderId],
    ["ZREMRANGEBYSCORE", key("orders"), "-inf", createdMs - ORDER_TTL_SECONDS * 1000],
    ...(extra.sealedDetails ? [["SET", key(`orderdetails:${order.orderId}`), extra.sealedDetails, "NX", "EX", ORDER_DETAILS_TTL_SECONDS]] : []),
    ["SET", key(`orderjourney:${order.orderId}`), JSON.stringify([...journey, orderEntry]), "NX", "EX", ORDER_DETAILS_TTL_SECONDS],
    ...(sessionId ? [["PFADD", funnelKey, sessionId], ["EXPIRE", funnelKey, VISIT_TTL_SECONDS]] : []),
  ], "write");
  if (stored === "OK" && visitorId) await redisPipeline(journeyPush(visitorId, [orderEntry]), "write");
  return stored === "OK" ? "saved" : "duplicate";
}

export type OrderDetailsView = {
  order: AnalyticsOrder;
  /** null when not stored (no ORDER_DATA_KEY at the time, or an older order) or not readable with the current key. */
  details: OrderDetails | null;
  detailsState: "ok" | "not_stored" | "unreadable";
  journey: JourneyEntry[];
};

export const MAX_DETAILS_PER_REQUEST = 100;

/** Decrypted customer details for several orders at once (orders list). Read-only token. */
export async function loadOrdersDetails(orderIds: string[]): Promise<Record<string, OrderDetails | null>> {
  const ids = orderIds.slice(0, MAX_DETAILS_PER_REQUEST);
  if (ids.length === 0) return {};
  const [values] = await redisPipeline([["MGET", ...ids.map((id) => key(`orderdetails:${id}`))]], "read", 5000);
  const result: Record<string, OrderDetails | null> = {};
  ids.forEach((id, index) => {
    const sealed = (values as (string | null)[] | null)?.[index];
    result[id] = typeof sealed === "string" ? openOrderDetails(id, sealed) : null;
  });
  return result;
}

/** Full order for the admin: stats record, decrypted customer details and the journey. Read-only token. */
export async function loadOrderDetails(orderId: string): Promise<OrderDetailsView | null> {
  const [rawOrder, sealed, rawJourney] = await redisPipeline([
    ["GET", key(`order:${orderId}`)],
    ["GET", key(`orderdetails:${orderId}`)],
    ["GET", key(`orderjourney:${orderId}`)],
  ], "read");
  if (typeof rawOrder !== "string") return null;
  const order = JSON.parse(rawOrder) as AnalyticsOrder;
  const details = typeof sealed === "string" ? openOrderDetails(orderId, sealed) : null;
  let journey: JourneyEntry[] = [];
  if (typeof rawJourney === "string") {
    try {
      journey = parseJourney(JSON.parse(rawJourney));
    } catch {
      journey = [];
    }
  }
  return { order, details, detailsState: typeof sealed !== "string" ? "not_stored" : details ? "ok" : "unreadable", journey };
}

/** Which of these IDs are dashboard orders, and whether their customer details are stored. */
export async function liveOrderStates(orderIds: string[]): Promise<Record<string, "details" | "no_details">> {
  if (orderIds.length === 0) return {};
  const results = await redisPipeline(
    orderIds.flatMap((id) => [["EXISTS", key(`order:${id}`)], ["EXISTS", key(`orderdetails:${id}`)]]),
    "read",
    5000,
  );
  const states: Record<string, "details" | "no_details"> = {};
  orderIds.forEach((id, index) => {
    if (Number(results[index * 2]) === 1) states[id] = Number(results[index * 2 + 1]) === 1 ? "details" : "no_details";
  });
  return states;
}

/**
 * Fills in encrypted customer details for dashboard orders that have none (orders placed before
 * details were stored). Never overwrites details that exist, and skips IDs that are not orders.
 */
export async function backfillOrderDetails(entries: { orderId: string; sealed: string }[]) {
  const states = await liveOrderStates(entries.map((entry) => entry.orderId));
  const missing = entries.filter((entry) => states[entry.orderId] === "no_details");
  if (missing.length === 0) return [];
  const results = await redisPipeline(
    missing.map((entry) => ["SET", key(`orderdetails:${entry.orderId}`), entry.sealed, "NX", "EX", ORDER_DETAILS_TTL_SECONDS]),
    "write",
    5000,
  );
  return missing.filter((_, index) => results[index] === "OK").map((entry) => entry.orderId);
}

export async function setOrderStatus(orderId: string, status: OrderStatus, confirmedValue: number | null) {
  const [raw] = await redisPipeline([["GET", key(`order:${orderId}`)]], "write");
  if (typeof raw !== "string") return null;
  const order = JSON.parse(raw) as AnalyticsOrder;
  const updated: AnalyticsOrder = {
    ...order,
    status,
    statusAt: new Date().toISOString(),
    confirmedValue: status === "confirmed" ? confirmedValue : null,
  };
  const [result] = await redisPipeline([["SET", key(`order:${orderId}`), JSON.stringify(updated), "XX", "KEEPTTL"]], "write");
  return result === "OK" ? updated : null;
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

// ── Report (read-only token) ──────────────────────────────────────────────

function parseHash(result: unknown): DayVisits {
  const fields: DayVisits = {};
  if (Array.isArray(result)) {
    for (let index = 0; index + 1 < result.length; index += 2) fields[String(result[index])] = Number(result[index + 1]) || 0;
  }
  return fields;
}

export async function loadReport(days: string[]) {
  const fromMs = Date.parse(`${days[0]}T00:00:00Z`) - DAY_MS;
  const toMs = Date.parse(`${days.at(-1)}T00:00:00Z`) + 2 * DAY_MS;
  const [results, counts] = await Promise.all([
    redisPipeline([
      ...days.map((day) => ["HGETALL", key(`visits:${day}`)]),
      ...days.map((day) => ["HGETALL", key(`products:${day}`)]),
      ["ZRANGE", key("orders"), fromMs, toMs, "BYSCORE"],
    ], "read", 5000),
    // Redis classifies PFCOUNT as a write (it may refresh the HyperLogLog's cached count), so the
    // read-only token is refused. They only read data here; these are the reads that need the write token.
    redisPipeline([
      ["PFCOUNT", ...days.map((day) => key(`visitors:${day}`))],
      ...FUNNEL_STEPS.map((step) => ["PFCOUNT", ...days.map((day) => key(`funnel:${day}:${step}`))]),
    ], "write", 5000),
  ]);

  const visits = results.slice(0, days.length).map(parseHash);
  const products = results.slice(days.length, 2 * days.length).map(parseHash);
  const uniqueVisitors = Number(counts[0]) || 0;
  const funnel = Object.fromEntries(FUNNEL_STEPS.map((step, index) => [step, Number(counts[index + 1]) || 0])) as FunnelCounts;
  const orderIds = (results[2 * days.length] as string[] | null) ?? [];

  // Unique customers per product, counted over the days on which that product was actually added.
  const adderDays = new Map<string, string[]>();
  products.forEach((fields, index) => {
    for (const field of Object.keys(fields)) {
      if (!field.startsWith("a:")) continue;
      const productId = field.slice(2);
      adderDays.set(productId, [...(adderDays.get(productId) ?? []), days[index]]);
    }
  });
  const uniqueAdders: Record<string, number> = {};
  if (adderDays.size > 0) {
    const entries = [...adderDays];
    const adderCounts = await redisPipeline(
      entries.map(([productId, productDays]) => ["PFCOUNT", ...productDays.map((day) => key(`adders:${day}:${productId}`))]),
      "write",
      5000,
    );
    entries.forEach(([productId], index) => { uniqueAdders[productId] = Number(adderCounts[index]) || 0; });
  }

  const orders: AnalyticsOrder[] = [];
  for (let start = 0; start < orderIds.length; start += 200) {
    const chunk = orderIds.slice(start, start + 200);
    const [values] = await redisPipeline([["MGET", ...chunk.map((id) => key(`order:${id}`))]], "read", 5000);
    for (const value of (values as (string | null)[]) ?? []) {
      if (typeof value !== "string") continue;
      try {
        orders.push(JSON.parse(value) as AnalyticsOrder);
      } catch {
        // Skip a corrupt record instead of failing the whole dashboard.
      }
    }
  }

  return buildReport({ days, visits, uniqueVisitors, orders, products, funnel, uniqueAdders });
}

// ── Login throttling ──────────────────────────────────────────────────────

export async function isLoginLocked(ipHash: string) {
  const [count] = await redisPipeline([["GET", key(`rl:login:${ipHash}`)]], "write");
  return Number(count) >= MAX_LOGIN_FAILURES;
}

export async function recordLoginFailure(ipHash: string) {
  await redisPipeline([
    ["INCR", key(`rl:login:${ipHash}`)],
    ["EXPIRE", key(`rl:login:${ipHash}`), LOGIN_LOCK_SECONDS, "NX"],
  ], "write");
}

export async function clearLoginFailures(ipHash: string) {
  await redisPipeline([["DEL", key(`rl:login:${ipHash}`)]], "write");
}
