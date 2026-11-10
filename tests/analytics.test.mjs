import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";

import { touchFromVisit } from "../lib/attribution.ts";
import { trafficSourceOf, sourceTypeOf } from "../lib/traffic-source.ts";
import { buildReport } from "../lib/analytics-report.ts";
import {
  createAdminSessionToken,
  isAdminRequest,
  isValidAdminSessionToken,
  verifyAdminPassword,
} from "../lib/admin-auth.ts";

// ── In-memory stand-in for the Upstash REST /pipeline endpoint ─────────────
const store = new Map();
const calls = [];
let redisDown = false;
const WRITE_TOKEN = "write-token-test";
const READ_TOKEN = "read-token-test";

function fakeRedis(command) {
  const [name, ...args] = command;
  const get = (key) => store.get(key);
  switch (name.toUpperCase()) {
    case "INCR": { const value = Number(get(args[0]) ?? 0) + 1; store.set(args[0], String(value)); return value; }
    case "EXPIRE": return 1;
    case "GET": return get(args[0]) ?? null;
    case "DEL": return store.delete(args[0]) ? 1 : 0;
    case "SET": {
      const [key, value, ...options] = args;
      if (options.includes("NX") && store.has(key)) return null;
      if (options.includes("XX") && !store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }
    case "HINCRBY": {
      const hash = get(args[0]) ?? {};
      hash[args[1]] = (hash[args[1]] ?? 0) + Number(args[2]);
      store.set(args[0], hash);
      return hash[args[1]];
    }
    case "HGETALL": return Object.entries(get(args[0]) ?? {}).flat().map(String);
    case "HGET": return (get(args[0]) ?? {})[args[1]] ?? null;
    case "HEXISTS": return args[1] in (get(args[0]) ?? {}) ? 1 : 0;
    case "HSET": { const hash = get(args[0]) ?? {}; const added = args[1] in hash ? 0 : 1; hash[args[1]] = args[2]; store.set(args[0], hash); return added; }
    case "HSETNX": { const hash = get(args[0]) ?? {}; if (args[1] in hash) return 0; hash[args[1]] = args[2]; store.set(args[0], hash); return 1; }
    case "HDEL": { const hash = get(args[0]) ?? {}; const had = args[1] in hash; delete hash[args[1]]; return had ? 1 : 0; }
    case "EXISTS": return store.has(args[0]) ? 1 : 0;
    case "PFADD": { const set = get(args[0]) ?? new Set(); const before = set.size; args.slice(1).forEach((v) => set.add(v)); store.set(args[0], set); return set.size > before ? 1 : 0; }
    case "PFCOUNT": return new Set(args.flatMap((key) => [...(get(key) ?? [])])).size;
    case "ZADD": {
      const [key, , score, member] = args;
      const zset = get(key) ?? new Map();
      if (!zset.has(member)) zset.set(member, Number(score));
      store.set(key, zset);
      return 1;
    }
    case "ZRANGE": { const [key, min, max] = args; return [...(get(key) ?? new Map())].filter(([, s]) => s >= Number(min) && s <= Number(max)).sort((a, b) => a[1] - b[1]).map(([m]) => m); }
    case "ZREMRANGEBYSCORE": return 0;
    case "MGET": return args.map((key) => get(key) ?? null);
    case "RPUSH": { const list = get(args[0]) ?? []; list.push(...args.slice(1)); store.set(args[0], list); return list.length; }
    case "LTRIM": { const list = get(args[0]) ?? []; const start = Number(args[1]); store.set(args[0], list.slice(start < 0 ? Math.max(list.length + start, 0) : start)); return "OK"; }
    case "LRANGE": { const list = get(args[0]) ?? []; const start = Number(args[1]); return list.slice(start < 0 ? Math.max(list.length + start, 0) : start); }
    default: return { error: `unsupported ${name}` };
  }
}

globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://fake-upstash.test/")) throw new Error(`unexpected fetch ${url}`);
  if (redisDown) throw new TypeError("fetch failed");
  const token = options.headers.Authorization.replace("Bearer ", "");
  const commands = JSON.parse(options.body);
  calls.push({ token, commands });
  // Like real Redis ACLs, PFCOUNT counts as a write command, so the read-only token is refused.
  const isWrite = commands.some(([name]) => !["GET", "HGET", "HGETALL", "ZRANGE", "MGET", "LRANGE", "EXISTS"].includes(name.toUpperCase()));
  if (token === READ_TOKEN && isWrite) return new Response(JSON.stringify({ error: "NOPERM" }), { status: 403 });
  return new Response(JSON.stringify(commands.map((command) => {
    const result = fakeRedis(command);
    return result && typeof result === "object" && "error" in result ? result : { result };
  })));
};

process.env.KV_REST_API_URL = "https://fake-upstash.test";
process.env.KV_REST_API_TOKEN = WRITE_TOKEN;
process.env.KV_REST_API_READ_ONLY_TOKEN = READ_TOKEN;
process.env.ADMIN_SESSION_SECRET = "s".repeat(40);
delete process.env.VERCEL_ENV;

const analytics = await import("../lib/analytics-store.ts");
const { RedisUnavailableError } = await import("../lib/redis.ts");

const SITE = "https://bluemood.example";
const AT = "2026-11-09T10:00:00.000Z";
const visit = (query, referrer = "") => touchFromVisit(`${SITE}/${query}`, referrer, AT);

// ── Traffic sources ────────────────────────────────────────────────────────
const sourceCases = [
  ["?utm_source=fb&utm_medium=paid&utm_campaign=w", "", "Facebook Ads", "Paid"],
  ["?utm_source=facebook&utm_medium=cpc", "", "Facebook Ads", "Paid"],
  ["?utm_source=ig&utm_medium=paid", "", "Instagram Ads", "Paid"],
  ["?utm_source=google&utm_medium=cpc", "", "Other Paid", "Paid"],
  ["?fbclid=abc", "https://l.facebook.com/", "Facebook Organic", "Organic"],
  ["?fbclid=abc", "", "Facebook Organic", "Organic"],
  ["", "https://l.instagram.com/", "Instagram Organic", "Organic"],
  ["?utm_source=tiktok&utm_medium=social", "", "Other Social", "Organic"],
  ["?utm_source=whatsapp", "", "WhatsApp", "Organic"],
  ["", "https://www.google.com/", "Google", "Organic"],
  ["", "https://blog.example/", "Referral", "Organic"],
  ["", "", "Direct", "Direct"],
];
for (const [query, referrer, source, type] of sourceCases) {
  test(`source: "${query || "-"}" from "${referrer || "-"}" → ${source} (${type})`, () => {
    const result = trafficSourceOf(visit(query, referrer));
    assert.equal(result, source);
    assert.equal(sourceTypeOf(result), type);
  });
}

test("no attribution at all is Unknown, and Direct is never counted as Organic", () => {
  assert.equal(trafficSourceOf(null), "Unknown");
  assert.equal(sourceTypeOf("Unknown"), "Unknown");
  assert.equal(sourceTypeOf("Direct"), "Direct");
});

// ── Report maths ───────────────────────────────────────────────────────────
const order = (overrides) => ({
  orderId: "BM-00000000000000000001", createdAt: "2026-11-02T10:00:00.000Z", day: "2026-11-02", subtotal: 1100, shippingCost: 50, total: 1150,
  governorate: "القاهرة", offerName: "x", products: [{ modelId: "m", category: "c", quantity: 4 }], firstTouch: null, lastTouch: null,
  source: "Facebook Ads", sourceType: "Paid", campaign: "winter", adContent: "reel1", landingPage: "/", status: "submitted", statusAt: null, confirmedValue: null,
  ...overrides,
});

test("report separates sessions, visitors, submitted orders and confirmed sales", () => {
  const report = buildReport({
    days: ["2026-11-01", "2026-11-02"],
    visits: [
      { all: 60, "s:Facebook Ads": 40, "s:Direct": 20, "t:Paid": 40, "t:Direct": 20, "c:winter": 40 },
      { all: 40, "s:Facebook Ads": 10, "s:Google": 30, "t:Paid": 10, "t:Organic": 30, "c:winter": 10 },
    ],
    uniqueVisitors: 70,
    orders: [
      order({ orderId: "A", status: "confirmed", confirmedValue: 1000 }),
      order({ orderId: "B" }),
      order({ orderId: "C", status: "cancelled", source: "Google", sourceType: "Organic", campaign: "" }),
      order({ orderId: "OUT", day: "2026-10-01" }),
    ],
  });
  assert.equal(report.totals.sessions, 100);
  assert.equal(report.totals.uniqueVisitors, 70);
  assert.equal(report.totals.submitted, 3, "orders outside the range are excluded");
  assert.equal(report.totals.submittedValue, 3450);
  assert.equal(report.totals.confirmed, 1);
  assert.equal(report.totals.confirmedValue, 1000, "the actual collected amount is used");
  assert.equal(report.totals.submittedConversion, 0.03);
  assert.equal(report.totals.confirmedConversion, 0.01);
  assert.equal(report.totals.pending, 1);
  assert.equal(report.totals.cancelled, 1);

  const fbAds = report.bySource.find((row) => row.source === "Facebook Ads");
  assert.equal(fbAds.sessions, 50);
  assert.equal(fbAds.sessionShare, 0.5);
  assert.equal(fbAds.submitted, 2);
  assert.equal(fbAds.submittedConversion, 0.04);
  const direct = report.byType.find((row) => row.type === "Direct");
  const organic = report.byType.find((row) => row.type === "Organic");
  assert.equal(direct.sessions, 20);
  assert.equal(organic.sessions, 30, "Direct sessions are not part of Organic");

  const winter = report.campaigns.find((row) => row.campaign === "winter");
  assert.deepEqual([winter.sessions, winter.submitted, winter.confirmed], [50, 2, 1]);
  assert.deepEqual(report.timeline.map((p) => [p.sessions, p.submitted]), [[60, 0], [40, 3]]);
  assert.equal(report.orders[0].orderId !== undefined, true);
});

test("conversion rate is null (not 0% or ∞) when there were no sessions", () => {
  const report = buildReport({ days: ["2026-11-01"], visits: [{}], uniqueVisitors: 0, orders: [] });
  assert.equal(report.totals.submittedConversion, null);
});

// ── Redis storage (fake Upstash) ───────────────────────────────────────────
test("the same session is counted once; a new session is counted again", async () => {
  store.clear();
  const sessionId = randomUUID();
  const visitorId = randomUUID();
  const touch = visit("?utm_source=ig&utm_medium=paid&utm_campaign=winter&utm_content=reel1");
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(await analytics.recordVisit({ sessionId, visitorId, touch, ipHash: "h1", now }), "counted");
  assert.equal(await analytics.recordVisit({ sessionId, visitorId, touch, ipHash: "h1", now }), "duplicate");
  assert.equal(await analytics.recordVisit({ sessionId: randomUUID(), visitorId, touch, ipHash: "h1", now }), "counted");

  const hash = store.get("bm:dev:v1:visits:2026-11-09");
  assert.equal(hash.all, 2);
  assert.equal(hash["s:Instagram Ads"], 2);
  assert.equal(hash["t:Paid"], 2);
  assert.equal(hash["c:winter"], 2);
  assert.equal(hash["a:reel1"], 2);
  assert.equal(store.get("bm:dev:v1:visitors:2026-11-09").size, 1, "same browser = one unique visitor");
});

test("visit flooding from one IP is capped", async () => {
  store.clear();
  const results = [];
  for (let i = 0; i < 65; i++) results.push(await analytics.recordVisit({ sessionId: randomUUID(), visitorId: randomUUID(), touch: visit(""), ipHash: "flood", now: new Date(AT) }));
  assert.equal(results.filter((r) => r === "counted").length, 60);
  assert.equal(results.at(-1), "rate_limited");
});

const orderRecord = {
  orderId: "BM-ABCDEF0123456789ABCD",
  createdAt: "2026-11-09T21:30:00.000Z",
  customerName: "سارة الاختبار",
  phone: "01011112222",
  alternatePhone: "01233334444",
  governorate: "الجيزة",
  area: "الدقي",
  address: "١٢ شارع التجربة",
  offerName: "بدون عرض — قطع منفردة",
  products: [{ modelId: "bm-abaya-001", name: "عباية", category: "abayas", fit: "x", quantity: 2, unitPrice: 350 }],
  offerPrice: 0,
  itemsTotal: 700,
  subtotal: 700,
  shippingCost: 60,
  total: 760,
  notes: "اتصلوا بيا على 01099998888",
};

test("stored orders contain no name, phone, address, area or notes", () => {
  const attribution = { firstTouch: visit("", "https://www.google.com/"), lastTouch: visit("?utm_source=fb&utm_medium=paid&utm_campaign=winter&utm_content=ad7&fbclid=X") };
  const stored = analytics.toAnalyticsOrder(orderRecord, attribution);
  const text = JSON.stringify(stored);
  for (const secret of [orderRecord.customerName, orderRecord.phone, orderRecord.alternatePhone, orderRecord.address, orderRecord.area, "01099998888"]) {
    assert.equal(text.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(stored.day, "2026-11-09", "21:30 UTC is still 9 Nov in Cairo (UTC+2)");
  assert.equal(stored.source, "Facebook Ads");
  assert.equal(stored.campaign, "winter");
  assert.equal(stored.adContent, "ad7");
  assert.equal(stored.firstTouch.channel, "Google");
  assert.equal(stored.status, "submitted");
});

test("orders are saved once, read back with the read-only token, and confirmed separately", async () => {
  store.clear();
  calls.length = 0;
  const stored = analytics.toAnalyticsOrder({ ...orderRecord, createdAt: "2026-11-09T10:00:00.000Z" }, { firstTouch: null, lastTouch: visit("?utm_source=ig&utm_medium=paid&utm_campaign=winter") });
  assert.equal(await analytics.saveOrder(stored), "saved");
  assert.equal(await analytics.saveOrder(stored), "duplicate", "a retried submission is not stored twice");

  let report = await analytics.loadReport(["2026-11-09"]);
  assert.equal(report.totals.submitted, 1);
  assert.equal(report.totals.confirmed, 0, "a submitted order is not a sale");
  assert.ok(calls.at(-1).token === READ_TOKEN, "dashboard reads use the read-only token");

  await analytics.setOrderStatus(stored.orderId, "confirmed", 700);
  report = await analytics.loadReport(["2026-11-09"]);
  assert.equal(report.totals.confirmed, 1);
  assert.equal(report.totals.confirmedValue, 700);
  assert.equal(report.bySource.find((row) => row.source === "Instagram Ads").confirmed, 1);
  assert.equal(await analytics.setOrderStatus("BM-00000000000000000000", "confirmed", null), null, "unknown order → not found");
});

test("raw IPs never reach Redis", async () => {
  store.clear();
  calls.length = 0;
  const ip = "196.218.12.34";
  await analytics.recordVisit({ sessionId: randomUUID(), visitorId: randomUUID(), touch: visit(""), ipHash: analytics.hashIp(ip) });
  assert.equal(JSON.stringify(calls).includes(ip), false);
  assert.notEqual(analytics.hashIp(ip), ip);
});

test("Redis failures surface as RedisUnavailableError (callers log and carry on)", async () => {
  redisDown = true;
  try {
    await assert.rejects(analytics.saveOrder(analytics.toAnalyticsOrder(orderRecord, null)), (error) => error instanceof RedisUnavailableError && error.message === "NETWORK_FAILURE");
  } finally {
    redisDown = false;
  }
});

test("date ranges are validated and capped", () => {
  assert.equal(analytics.daysBetween("2026-11-01", "2026-11-03").length, 3);
  assert.equal(analytics.daysBetween("2026-11-03", "2026-11-01"), null);
  assert.equal(analytics.daysBetween("2025-01-01", "2026-11-01"), null, "longer than 400 days");
  assert.equal(analytics.daysBetween("bad", "2026-11-01"), null);
});

// ── Admin auth ─────────────────────────────────────────────────────────────
test("password is checked against the scrypt hash", () => {
  const salt = randomBytes(16);
  const stored = `scrypt:16384:8:1:${salt.toString("base64url")}:${scryptSync("correct horse battery", salt, 32, { N: 16384, r: 8, p: 1 }).toString("base64url")}`;
  assert.equal(verifyAdminPassword("correct horse battery", stored), true);
  assert.equal(verifyAdminPassword("wrong", stored), false);
  assert.equal(verifyAdminPassword("", stored), false);
  assert.equal(verifyAdminPassword("anything", ""), false, "no hash configured → nobody gets in");
});

test("session tokens are signed and expire", () => {
  const token = createAdminSessionToken();
  assert.equal(isValidAdminSessionToken(token), true);
  const [v, exp, sig] = token.split(".");
  assert.equal(isValidAdminSessionToken(`${v}.${Number(exp) + 999999}.${sig}`), false, "edited expiry is rejected");
  assert.equal(isValidAdminSessionToken(`${v}.${exp}.${sig.slice(0, -2)}xx`), false, "bad signature is rejected");
  assert.equal(isValidAdminSessionToken(token, Number(exp) + 1), false, "expired");
  assert.equal(isValidAdminSessionToken(undefined), false);
  assert.equal(isAdminRequest(new Request("https://x/api/admin/analytics", { headers: { cookie: `a=1; bm_admin=${token}` } })), true);
  assert.equal(isAdminRequest(new Request("https://x/api/admin/analytics")), false);
});

test("without ADMIN_SESSION_SECRET every session is rejected (fails closed)", () => {
  const token = createAdminSessionToken();
  const saved = process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_SESSION_SECRET;
  try {
    assert.equal(isValidAdminSessionToken(token), false);
  } finally {
    process.env.ADMIN_SESSION_SECRET = saved;
  }
});

// ── Encrypted order details, journey events and products ───────────────────
const vault = await import("../lib/order-vault.ts");
const { sanitizeJourneyEvents } = await import("../lib/journey.ts");
const TEST_ORDER_KEY = randomBytes(32).toString("base64url");

test("customer details are encrypted, bound to their order and unreadable without the key", () => {
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  const details = vault.orderDetailsOf({ ...orderRecord, attribution: { firstTouch: null, lastTouch: null } });
  assert.equal("attribution" in details, false);
  const sealed = vault.sealOrderDetails(details);
  for (const secret of [orderRecord.customerName, orderRecord.phone, orderRecord.address]) assert.equal(sealed.includes(secret), false);
  assert.deepEqual(vault.openOrderDetails(orderRecord.orderId, sealed), details);
  assert.equal(vault.openOrderDetails("BM-00000000000000000000", sealed), null, "a blob cannot be moved to another order");
  const [v, iv, tag, data] = sealed.split(".");
  assert.equal(vault.openOrderDetails(orderRecord.orderId, [v, iv, tag, data.slice(0, -3) + "AAA"].join(".")), null, "tampering is detected");
  process.env.ORDER_DATA_KEY = randomBytes(32).toString("base64url");
  assert.equal(vault.openOrderDetails(orderRecord.orderId, sealed), null, "another key cannot read it");
  delete process.env.ORDER_DATA_KEY;
  assert.equal(vault.sealOrderDetails(details), null, "no key → nothing personal is stored");
  process.env.ORDER_DATA_KEY = "too-short";
  assert.equal(vault.isOrderVaultConfigured(), false);
  delete process.env.ORDER_DATA_KEY;
});

test("journey events accept only real catalog products and known event types", () => {
  const events = sanitizeJourneyEvents([
    { type: "view", productId: "bm-abaya-001" },
    { type: "add", productId: "bm-abaya-001", quantity: 99 },
    { type: "add", productId: "not-a-product" },
    { type: "checkout", productId: "ignored" },
    { type: "purchase" },
    "junk",
  ]);
  assert.deepEqual(events, [
    { type: "view", productId: "bm-abaya-001", ago: 0 },
    { type: "add", productId: "bm-abaya-001", quantity: 10, ago: 0 },
    { type: "checkout", ago: 0 },
  ]);
  assert.deepEqual(sanitizeJourneyEvents("nope"), []);
});

test("journey: views, adds, unique customers, funnel and the order's own journey + encrypted details", async () => {
  store.clear();
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  try {
    const now = new Date("2026-11-09T12:00:00Z");
    const day = "2026-11-09";
    const shopperA = { sessionId: randomUUID(), visitorId: randomUUID() };
    const shopperB = { sessionId: randomUUID(), visitorId: randomUUID() };
    const adTouch = visit("?utm_source=facebook&utm_medium=paid_social&utm_campaign=winter_2026");

    await analytics.recordVisit({ ...shopperA, touch: adTouch, ipHash: "a", now });
    await analytics.recordVisit({ ...shopperB, touch: visit("?utm_source=whatsapp&utm_medium=messaging"), ipHash: "b", now });
    await analytics.recordEvents({ ...shopperA, ipHash: "a", now, events: [
      { type: "view", productId: "bm-abaya-001" },
      { type: "add", productId: "bm-abaya-001", quantity: 2 },
      { type: "view", productId: "bm-winter-pajama-001" },
    ] });
    await analytics.recordEvents({ ...shopperA, ipHash: "a", now, events: [{ type: "add", productId: "bm-abaya-001", quantity: 1 }, { type: "checkout" }] });
    await analytics.recordEvents({ ...shopperB, ipHash: "b", now, events: [{ type: "view", productId: "bm-abaya-001" }, { type: "add", productId: "bm-abaya-001", quantity: 1 }] });

    const record = { ...orderRecord, createdAt: "2026-11-09T12:05:00.000Z" };
    const order = analytics.toAnalyticsOrder(record, { firstTouch: adTouch, lastTouch: adTouch });
    const sealedDetails = vault.sealOrderDetails(vault.orderDetailsOf(record));
    assert.equal(await analytics.saveOrder(order, { sealedDetails, visit: shopperA }), "saved");
    assert.equal(await analytics.saveOrder(order, { sealedDetails, visit: shopperA }), "duplicate");

    // Nothing personal is readable anywhere in Redis.
    const everything = JSON.stringify([...store.entries()].map(([k, v]) => [k, v instanceof Set ? [...v] : v instanceof Map ? [...v] : v]));
    for (const secret of [record.customerName, record.phone, record.alternatePhone, record.address, "01099998888"]) {
      assert.equal(everything.includes(secret), false, `leaked ${secret}`);
    }

    const report = await analytics.loadReport([day]);
    assert.deepEqual(report.funnel, { sessions: 2, view: 2, add: 2, checkout: 1, order: 1 });
    const abaya = report.products.find((row) => row.productId === "bm-abaya-001");
    assert.equal(abaya.views, 2);
    assert.equal(abaya.adds, 4, "2 + 1 by A and 1 by B");
    assert.equal(abaya.uniqueAdders, 2, "two different shoppers");
    assert.equal(report.products[0].productId, "bm-abaya-001", "most added first");
    assert.equal(report.products.find((row) => row.productId === "bm-winter-pajama-001").adds, 0);
    const fbWinter = report.sourceCampaigns.find((row) => row.source === "Facebook Ads" && row.campaign === "winter_2026");
    assert.equal(fbWinter.sessions, 1);
    assert.equal(fbWinter.submitted, 1);
    assert.equal(report.sourceCampaigns.find((row) => row.source === "WhatsApp" && row.campaign === "").sessions, 1);

    calls.length = 0;
    const view = await analytics.loadOrderDetails(order.orderId);
    assert.ok(calls.every((call) => call.token === READ_TOKEN), "order details use the read-only token");
    assert.equal(view.detailsState, "ok");
    assert.equal(view.details.customerName, record.customerName);
    assert.equal(view.details.phone, record.phone);
    assert.equal(view.details.products[0].unitPrice, 350);
    assert.deepEqual(view.journey.map((entry) => entry.e), ["visit", "view", "add", "view", "add", "checkout", "order"]);
    assert.equal(view.journey[0].s, "Facebook Ads");
    assert.equal(view.journey.at(-1).o, order.orderId);

    process.env.ORDER_DATA_KEY = randomBytes(32).toString("base64url");
    assert.equal((await analytics.loadOrderDetails(order.orderId)).detailsState, "unreadable");
    assert.equal(await analytics.loadOrderDetails("BM-00000000000000000000"), null);
  } finally {
    delete process.env.ORDER_DATA_KEY;
  }
});

test("an order saved without ORDER_DATA_KEY keeps working, just without customer details", async () => {
  store.clear();
  const order = analytics.toAnalyticsOrder(orderRecord, null);
  assert.equal(await analytics.saveOrder(order, { sealedDetails: vault.sealOrderDetails(vault.orderDetailsOf(orderRecord)) }), "saved");
  const view = await analytics.loadOrderDetails(order.orderId);
  assert.equal(view.detailsState, "not_stored");
  assert.equal(view.details, null);
  assert.deepEqual(view.journey.map((entry) => entry.e), ["order"]);
});

test("journey-event flooding from one IP is capped", async () => {
  store.clear();
  const ids = { sessionId: randomUUID(), visitorId: randomUUID() };
  const results = [];
  for (let i = 0; i < 302; i++) results.push(await analytics.recordEvents({ ...ids, ipHash: "flood", events: [{ type: "checkout" }] }));
  assert.equal(results.filter((r) => r === "recorded").length, 300);
  assert.equal(results.at(-1), "rate_limited");
  assert.equal(await analytics.recordEvents({ ...ids, ipHash: "x", events: [] }), "empty");
});

test("the orders list loads decrypted details for many orders at once (read-only token)", async () => {
  store.clear();
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  try {
    const second = { ...orderRecord, orderId: "BM-11111111111111111111", customerName: "منى التجربة" };
    for (const record of [orderRecord, second]) {
      await analytics.saveOrder(analytics.toAnalyticsOrder(record, null), { sealedDetails: vault.sealOrderDetails(vault.orderDetailsOf(record)) });
    }
    await analytics.saveOrder(analytics.toAnalyticsOrder({ ...orderRecord, orderId: "BM-22222222222222222222" }, null));
    calls.length = 0;
    const details = await analytics.loadOrdersDetails([orderRecord.orderId, second.orderId, "BM-22222222222222222222"]);
    assert.ok(calls.every((call) => call.token === READ_TOKEN));
    assert.equal(details[orderRecord.orderId].customerName, orderRecord.customerName);
    assert.equal(details[second.orderId].customerName, "منى التجربة");
    assert.equal(details["BM-22222222222222222222"], null, "no details stored → null, not an error");
    assert.deepEqual(await analytics.loadOrdersDetails([]), {});
  } finally {
    delete process.env.ORDER_DATA_KEY;
  }
});

// ── Full journey: pages, removals, UTM / fbclid on the visit, real event times ─────────
test("journey events: pages and cart removals are kept, admin/API paths and junk are dropped", () => {
  const events = sanitizeJourneyEvents([
    { type: "page", path: "/offer/four-pajamas?utm_source=fb#x", ago: 1500 },
    { type: "page", path: "/admin/analytics" },
    { type: "page", path: "/api/orders" },
    { type: "page", path: "https://evil.example/" },
    { type: "remove", productId: "bm-robe-001", quantity: 0 },
    { type: "remove", productId: "nope" },
    { type: "view", productId: "bm-robe-001", ago: 99_999_999 },
  ]);
  assert.deepEqual(events, [
    { type: "page", path: "/offer/four-pajamas", ago: 1500 },
    { type: "remove", productId: "bm-robe-001", quantity: 1, ago: 0 },
    { type: "view", productId: "bm-robe-001", ago: 600000 },
  ]);
});

test("journey: Facebook ad visit → pages → product → add → remove → checkout → order, in time order", async () => {
  store.clear();
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  try {
    const shopper = { sessionId: randomUUID(), visitorId: randomUUID() };
    const adTouch = visit("?utm_source=facebook&utm_medium=paid_social&utm_campaign=winter_2026&utm_content=video1&fbclid=IwAR123", "https://m.facebook.com/");
    const t0 = new Date("2026-11-10T15:00:00Z");
    await analytics.recordVisit({ ...shopper, touch: adTouch, ipHash: "fb", now: t0 });
    // One batch sent 3 s after the first event: each keeps its own moment.
    await analytics.recordEvents({ ...shopper, ipHash: "fb", now: new Date("2026-11-10T15:00:10Z"), events: [
      { type: "page", path: "/", ago: 9000 },
      { type: "view", productId: "bm-robe-001", ago: 6000 },
      { type: "add", productId: "bm-robe-001", quantity: 1, ago: 5000 },
      { type: "add", productId: "bm-abaya-001", quantity: 1, ago: 4000 },
    ] });
    await analytics.recordEvents({ ...shopper, ipHash: "fb", now: new Date("2026-11-10T15:01:00Z"), events: [
      { type: "page", path: "/checkout", ago: 2000 },
      { type: "remove", productId: "bm-abaya-001", quantity: 1, ago: 1000 },
      { type: "checkout", ago: 0 },
    ] });
    const record = { ...orderRecord, orderId: "BM-AAAAAAAAAAAAAAAAAAAA", createdAt: "2026-11-10T15:02:00.000Z" };
    await analytics.saveOrder(analytics.toAnalyticsOrder(record, { firstTouch: adTouch, lastTouch: adTouch }), {
      sealedDetails: vault.sealOrderDetails(vault.orderDetailsOf(record)),
      visit: shopper,
    });

    const view = await analytics.loadOrderDetails(record.orderId);
    assert.deepEqual(view.journey.map((entry) => entry.e), ["visit", "page", "view", "add", "add", "page", "remove", "checkout", "order"]);
    const times = view.journey.map((entry) => entry.at);
    assert.deepEqual(times, times.toSorted(), "chronological");
    assert.equal(view.journey[1].at, "2026-11-10T15:00:01.000Z", "page time = sent time − ago");
    const [visitEntry] = view.journey;
    assert.equal(visitEntry.s, "Facebook Ads");
    assert.equal(visitEntry.c, "winter_2026");
    assert.equal(visitEntry.u, "facebook");
    assert.equal(visitEntry.m, "paid_social");
    assert.equal(visitEntry.n, "video1");
    assert.equal(visitEntry.f, 1, "fbclid recorded as present");
    assert.equal(visitEntry.r, "m.facebook.com");
    assert.equal(JSON.stringify(view.journey).includes("IwAR123"), false, "the click ID itself stays on the order's attribution only");
    assert.equal(view.order.lastTouch.fbclid, "IwAR123");
    assert.equal(view.journey.find((entry) => entry.e === "remove").p, "bm-abaya-001");
    assert.equal(view.details.customerName, record.customerName);

    const report = await analytics.loadReport(["2026-11-10"]);
    assert.deepEqual(report.funnel, { sessions: 1, view: 1, add: 1, checkout: 1, order: 1 }, "page / remove never enter the funnel");
    assert.equal([...store.keys()].some((key) => /funnel:.*:(page|remove)$/.test(key)), false);
  } finally {
    delete process.env.ORDER_DATA_KEY;
  }
});

// ── Old Orders store (Telegram import) ─────────────────────────────────────
const oldOrdersStore = await import("../lib/old-orders-store.ts");
const oldOrdersLib = await import("../lib/old-orders.ts");

function oldOrder(id, extra = {}) {
  return oldOrdersLib.sanitizeOldOrder({
    orderId: id,
    createdAt: "2026-11-08T14:22:47.000Z",
    customerName: "سارة الاختبار",
    phone: "01000000001",
    alternatePhone: "",
    governorate: "الجيزة",
    area: "فيصل",
    address: "شارع التجربة ١",
    notes: "بعد العصر",
    offerName: "بدون عرض — قطع منفردة",
    products: [{ modelId: "bm-robe-001", name: "روب فرو مورد فوشيا بغطاء رأس", size: "", color: "", quantity: 2, unitPrice: 250 }],
    offerPrice: 0,
    itemsTotal: 500,
    shippingCost: null,
    total: null,
    ...extra,
  });
}

test("old orders: encrypted, imported once, readable back, editable, archivable, deletable", async () => {
  store.clear();
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  try {
    const a = oldOrder("BM-0A0A0A0A0A0A0A0A0A0A");
    const b = oldOrder("BM-0B0B0B0B0B0B0B0B0B0B", { customerName: "نهى التجربة", phone: "01000000002" });
    const first = await oldOrdersStore.importOldOrders([a, b]);
    assert.deepEqual(first.imported, [a.orderId, b.orderId]);
    const again = await oldOrdersStore.importOldOrders([a, { ...b, customerName: "تغيير" }]);
    assert.deepEqual(again.imported, [], "same file twice → nothing new");
    assert.deepEqual(again.duplicates, [a.orderId, b.orderId]);

    const everything = JSON.stringify([...store.entries()].map(([k, v]) => [k, v instanceof Set ? [...v] : v instanceof Map ? [...v] : v]));
    for (const secret of ["سارة الاختبار", "01000000001", "شارع التجربة"]) assert.equal(everything.includes(secret), false, `leaked ${secret}`);

    calls.length = 0;
    const { orders, unreadable } = await oldOrdersStore.loadOldOrders();
    assert.ok(calls.every((call) => call.token === READ_TOKEN));
    assert.equal(unreadable, 0);
    assert.equal(orders.length, 2);
    assert.equal(orders.find((order) => order.orderId === b.orderId).customerName, "نهى التجربة", "first import kept, not overwritten");

    const edited = await oldOrdersStore.updateOldOrder({ ...a, status: "confirmed", archived: true, address: "عنوان جديد" });
    assert.equal(edited.status, "confirmed");
    const reread = await oldOrdersStore.loadOldOrder(a.orderId);
    assert.equal(reread.address, "عنوان جديد");
    assert.equal(reread.archived, true);
    assert.equal(await oldOrdersStore.updateOldOrder(oldOrder("BM-0C0C0C0C0C0C0C0C0C0C")), null, "editing never creates");
    assert.equal(await oldOrdersStore.deleteOldOrder(a.orderId), true);
    assert.equal(await oldOrdersStore.deleteOldOrder(a.orderId), false);
    assert.equal((await oldOrdersStore.loadOldOrders()).orders.length, 1);

    process.env.ORDER_DATA_KEY = randomBytes(32).toString("base64url");
    assert.deepEqual(await oldOrdersStore.loadOldOrders(), { orders: [], unreadable: 1 });
    delete process.env.ORDER_DATA_KEY;
    await assert.rejects(oldOrdersStore.importOldOrders([a]), oldOrdersStore.VaultNotConfiguredError, "no key → nothing personal is stored");
  } finally {
    delete process.env.ORDER_DATA_KEY;
  }
});

test("old orders: importing fills in customer details of dashboard orders that have none (never overwrites)", async () => {
  store.clear();
  process.env.ORDER_DATA_KEY = TEST_ORDER_KEY;
  try {
    const withoutDetails = { ...orderRecord, orderId: "BM-EE583464D00C5E4BC228" };
    const withDetails = { ...orderRecord, orderId: "BM-11111111111111111111", customerName: "الأصلية" };
    await analytics.saveOrder(analytics.toAnalyticsOrder(withoutDetails, null));
    await analytics.saveOrder(analytics.toAnalyticsOrder(withDetails, null), { sealedDetails: vault.sealOrderDetails(vault.orderDetailsOf(withDetails)) });
    assert.equal((await analytics.loadOrderDetails(withoutDetails.orderId)).detailsState, "not_stored");

    const states = await analytics.liveOrderStates([withoutDetails.orderId, withDetails.orderId, "BM-99999999999999999999"]);
    assert.deepEqual(states, { [withoutDetails.orderId]: "no_details", [withDetails.orderId]: "details" });

    const result = await oldOrdersStore.importOldOrders([
      oldOrder(withoutDetails.orderId),
      oldOrder(withDetails.orderId, { customerName: "من تيليجرام" }),
      oldOrder("BM-99999999999999999999"),
    ]);
    assert.deepEqual(result.backfilled, [withoutDetails.orderId]);

    const filled = await analytics.loadOrderDetails(withoutDetails.orderId);
    assert.equal(filled.detailsState, "ok");
    assert.equal(filled.details.customerName, "سارة الاختبار");
    assert.equal(filled.details.importedFrom, "telegram");
    assert.equal(filled.details.products[0].unitPrice, 250);
    assert.equal(filled.details.products[0].fit, "روب");
    assert.equal((await analytics.loadOrderDetails(withDetails.orderId)).details.customerName, "الأصلية", "existing details untouched");
    assert.equal(await analytics.loadOrderDetails("BM-99999999999999999999"), null, "no dashboard order is invented");
  } finally {
    delete process.env.ORDER_DATA_KEY;
  }
});

test("journey batches: a batch re-sent after a reload is stored once; malformed batches are dropped", async () => {
  store.clear();
  const { sanitizeJourneyBatches, sanitizeBatchId } = await import("../lib/journey.ts");
  const ids = { sessionId: randomUUID(), visitorId: randomUUID() };
  const batchId = randomUUID();
  const events = [{ type: "add", productId: "bm-abaya-001", quantity: 1, ago: 0 }];
  assert.equal(await analytics.recordEvents({ ...ids, ipHash: "r", events, batchId }), "recorded");
  assert.equal(await analytics.recordEvents({ ...ids, ipHash: "r", events, batchId }), "duplicate");
  assert.equal(await analytics.recordEvents({ ...ids, ipHash: "r", events, batchId: randomUUID() }), "recorded");
  const journey = store.get(`bm:dev:v1:journey:${ids.visitorId}`).map((entry) => JSON.parse(entry).e);
  assert.deepEqual(journey, ["add", "add"]);
  assert.equal(sanitizeBatchId("x"), null);
  assert.equal(sanitizeBatchId("<script>alert(1)</script>"), null);
  const batches = sanitizeJourneyBatches([
    { batchId, events },
    { batchId: "bad id!", events },
    { batchId: randomUUID(), events: [{ type: "nope" }] },
    { batchId: randomUUID(), events }, { batchId: randomUUID(), events }, { batchId: randomUUID(), events },
  ]);
  assert.equal(batches.length, 1, "max 3 batches checked; bad IDs and empty batches dropped");
  assert.deepEqual(sanitizeJourneyBatches("nope"), []);
});
