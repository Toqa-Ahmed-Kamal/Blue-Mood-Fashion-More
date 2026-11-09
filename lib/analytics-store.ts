// Server-only persistence for the admin dashboard, on the existing Upstash Redis.
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   visits:{day}          HASH  all | s:<source> | t:<type> | c:<campaign> | a:<ad content>   (TTL 400 days)
//   visitors:{day}        HLL   anonymous browser IDs, for unique visitors                    (TTL 400 days)
//   seen:{sessionId}      STR   one count per browsing session                                (TTL 24 h)
//   order:{orderId}       STR   JSON AnalyticsOrder, no personal data                         (TTL 730 days)
//   orders                ZSET  orderId scored by creation time (old members trimmed on write)
//   rl:visit:{ipHash}     STR   visit rate limit per hashed IP                                (TTL 1 h)
//   rl:login:{ipHash}     STR   failed-login counter per hashed IP                            (TTL 15 min)
// IPs are never stored: only a keyed, daily-rotating HMAC is used as a short-lived counter name.
import { createHmac } from "node:crypto";

import type { OrderAttribution, Touch } from "./attribution.ts";
import { ORDER_STATUSES, buildReport, type AnalyticsOrder, type DayVisits, type OrderStatus } from "./analytics-report.ts";
import type { OrderRecord } from "./order-record.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { sourceTypeOf, trafficSourceOf } from "./traffic-source.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIT_TTL_SECONDS = 400 * 24 * 60 * 60;
const ORDER_TTL_SECONDS = 730 * 24 * 60 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
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
    ["EXPIRE", visitsKey, VISIT_TTL_SECONDS],
    ["PFADD", visitorsKey, input.visitorId],
    ["EXPIRE", visitorsKey, VISIT_TTL_SECONDS],
  ], "write");
  return "counted";
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

/** Idempotent: a retried submission with the same order ID is stored once. */
export async function saveOrder(order: AnalyticsOrder) {
  const createdMs = Date.parse(order.createdAt);
  const [stored] = await redisPipeline([
    ["SET", key(`order:${order.orderId}`), JSON.stringify(order), "NX", "EX", ORDER_TTL_SECONDS],
    ["ZADD", key("orders"), "NX", createdMs, order.orderId],
    ["ZREMRANGEBYSCORE", key("orders"), "-inf", createdMs - ORDER_TTL_SECONDS * 1000],
  ], "write");
  return stored === "OK" ? "saved" : "duplicate";
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
  const [results, visitorCount] = await Promise.all([
    redisPipeline([
      ...days.map((day) => ["HGETALL", key(`visits:${day}`)]),
      ["ZRANGE", key("orders"), fromMs, toMs, "BYSCORE"],
    ], "read", 5000),
    // Redis classifies PFCOUNT as a write (it may refresh the HyperLogLog's cached count), so the
    // read-only token is refused. It only reads data here; this is the one read that needs the write token.
    redisPipeline([["PFCOUNT", ...days.map((day) => key(`visitors:${day}`))]], "write", 5000),
  ]);

  const visits = results.slice(0, days.length).map(parseHash);
  const uniqueVisitors = Number(visitorCount[0]) || 0;
  const orderIds = (results[days.length] as string[] | null) ?? [];

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

  return buildReport({ days, visits, uniqueVisitors, orders });
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
