// Turns stored daily visit counters and order records into the dashboard report. Pure (no I/O) and tested.
import type { Touch } from "./attribution.ts";
import { catalog, categoryInfo } from "./site-data.ts";
import { SOURCE_TYPES, TRAFFIC_SOURCES, isTrafficSource, sourceTypeOf, type SourceType, type TrafficSource } from "./traffic-source.ts";

/**
 * "delivered": the customer received it (a sale, like "confirmed").
 * "returned": a confirmed order that came back — not a sale, its pieces cost nothing to the store.
 */
export const ORDER_STATUSES = ["submitted", "confirmed", "delivered", "cancelled", "returned"] as const;

/** Confirmed and delivered orders are sales. */
export function isSaleStatus(status: string) {
  return status === "confirmed" || status === "delivered";
}

/** Booking confirmed by a deposit the customer paid in advance (part of the order total, not extra). */
export type Deposit = { amount: number; at: string };

/** Deposit amount from the admin: a number > 0 (EGP), or null to remove it. undefined = invalid. */
export function parseDepositAmount(value: unknown): number | null | undefined {
  if (value === null || value === "" || value === 0) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? Math.round(amount * 100) / 100 : undefined;
}

/** Factory cost per product line, saved when the order is confirmed (same order as `products`). */
export type CostSnapshot = { unitCosts: (number | null)[]; at: string };

/** Journey steps counted once per browsing session (sessions themselves come from the visit counter). */
export const FUNNEL_STEPS = ["view", "add", "checkout", "order"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export type FunnelCounts = Record<FunnelStep, number>;

export type ProductRow = {
  productId: string;
  name: string;
  category: string;
  image: string;
  views: number;
  /** Pieces added to the cart (an add of 2 counts 2). */
  adds: number;
  /** Different shoppers (browsers) who added it. */
  uniqueAdders: number;
};
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** What Redis keeps per order. Deliberately no name, phone, address, area or free-text notes. */
export type AnalyticsOrder = {
  orderId: string;
  createdAt: string;
  /** Cairo calendar day, YYYY-MM-DD. */
  day: string;
  subtotal: number;
  shippingCost: number | null;
  total: number | null;
  governorate: string;
  offerName: string;
  /** `fit`: size / category note sent with the order (saved from this version on; no personal data). */
  products: { modelId: string; category: string; quantity: number; fit?: string }[];
  firstTouch: Touch | null;
  /** Last non-direct touch (falls back to the direct visit when there never was another one). */
  lastTouch: Touch | null;
  source: TrafficSource;
  sourceType: SourceType;
  campaign: string;
  adContent: string;
  landingPage: string;
  status: OrderStatus;
  statusAt: string | null;
  /** Actual amount collected when it differs from the submitted total. */
  confirmedValue: number | null;
  /** Unit factory costs at confirmation time (Financial Management); absent before that. */
  costSnapshot?: CostSnapshot;
  deposit?: Deposit;
};

/** Fields of one day's visit hash: all, s:<source>, t:<type>, c:<campaign>, a:<ad content>. */
export type DayVisits = Record<string, number>;

type Metric = { sessions: number; submitted: number; submittedValue: number; confirmed: number; confirmedValue: number };

const emptyMetric = (): Metric => ({ sessions: 0, submitted: 0, submittedValue: 0, confirmed: 0, confirmedValue: 0 });

export function orderValue(order: AnalyticsOrder) {
  return order.total ?? order.subtotal;
}

export function confirmedValueOf(order: AnalyticsOrder) {
  return order.confirmedValue ?? orderValue(order);
}

const rate = (count: number, sessions: number) => (sessions > 0 ? count / sessions : null);

function withRates(metric: Metric) {
  return { ...metric, submittedConversion: rate(metric.submitted, metric.sessions), confirmedConversion: rate(metric.confirmed, metric.sessions) };
}

function addOrder(metric: Metric, order: AnalyticsOrder) {
  // Every order that reached Telegram counts as submitted (including ones later cancelled).
  metric.submitted += 1;
  metric.submittedValue += orderValue(order);
  if (isSaleStatus(order.status)) {
    metric.confirmed += 1;
    metric.confirmedValue += confirmedValueOf(order);
  }
}

export function sourceLabel(touch: Touch | null) {
  if (!touch) return "Unknown";
  return touch.utmSource ? `${touch.channel} (${touch.utmSource})` : touch.channel;
}

export type OrderRow = {
  orderId: string;
  createdAt: string;
  day: string;
  value: number;
  confirmedValue: number | null;
  status: OrderStatus;
  statusAt: string | null;
  governorate: string;
  offerName: string;
  pieces: number;
  /** Product IDs and quantities (no prices or personal data; those are in the encrypted details). */
  products: { modelId: string; quantity: number }[];
  subtotal: number;
  shippingCost: number | null;
  total: number | null;
  source: TrafficSource;
  sourceType: SourceType;
  campaign: string;
  adContent: string;
  firstTouch: string;
  lastTouch: string;
  landingPage: string;
  hasFbclid: boolean;
  deposit: Deposit | null;
};

/** Per-product views / adds from the daily `products:{day}` hashes, for every visible product plus any hidden one with data. */
export function buildProductRows(productDays: DayVisits[], uniqueAdders: Record<string, number>): ProductRow[] {
  const views = new Map<string, number>();
  const adds = new Map<string, number>();
  for (const fields of productDays) {
    for (const [field, raw] of Object.entries(fields)) {
      const count = Number(raw) || 0;
      if (field.startsWith("v:")) views.set(field.slice(2), (views.get(field.slice(2)) ?? 0) + count);
      else if (field.startsWith("a:")) adds.set(field.slice(2), (adds.get(field.slice(2)) ?? 0) + count);
    }
  }
  return catalog
    .filter((product) => !product.hidden || views.has(product.id) || adds.has(product.id))
    .map((product) => ({
      productId: product.id,
      name: product.name,
      category: categoryInfo[product.category].singular,
      image: product.image,
      views: views.get(product.id) ?? 0,
      adds: adds.get(product.id) ?? 0,
      uniqueAdders: uniqueAdders[product.id] ?? 0,
    }))
    .toSorted((a, b) => b.adds - a.adds || b.views - a.views);
}

export function buildReport(input: {
  days: string[];
  visits: DayVisits[];
  uniqueVisitors: number;
  orders: AnalyticsOrder[];
  products?: DayVisits[];
  funnel?: FunnelCounts;
  uniqueAdders?: Record<string, number>;
}): AnalyticsReport {
  const { days, visits, uniqueVisitors } = input;
  const daySet = new Set(days);
  const orders = input.orders.filter((order) => daySet.has(order.day));

  const totals = emptyMetric();
  const bySource = new Map<TrafficSource, Metric>(TRAFFIC_SOURCES.map((source) => [source, emptyMetric()]));
  const byType = new Map<SourceType, Metric>(SOURCE_TYPES.map((type) => [type, emptyMetric()]));
  const campaigns = new Map<string, Metric>();
  const adContents = new Map<string, Metric>();
  /** Key "<source>|<campaign>" (campaign may be empty). */
  const sourceCampaigns = new Map<string, Metric>();
  const timeline = new Map(days.map((day) => [day, { date: day, sessions: 0, submitted: 0, confirmed: 0 }]));
  const metricFor = (map: Map<string, Metric>, key: string) => {
    let metric = map.get(key);
    if (!metric) map.set(key, (metric = emptyMetric()));
    return metric;
  };

  visits.forEach((fields, index) => {
    const point = timeline.get(days[index]);
    for (const [field, raw] of Object.entries(fields)) {
      const count = Number(raw) || 0;
      if (field === "all") {
        totals.sessions += count;
        if (point) point.sessions += count;
      } else if (field.startsWith("s:")) {
        const metric = bySource.get(field.slice(2) as TrafficSource);
        if (metric) metric.sessions += count;
      } else if (field.startsWith("t:")) {
        const metric = byType.get(field.slice(2) as SourceType);
        if (metric) metric.sessions += count;
      } else if (field.startsWith("c:")) {
        metricFor(campaigns, field.slice(2)).sessions += count;
      } else if (field.startsWith("a:")) {
        metricFor(adContents, field.slice(2)).sessions += count;
      } else if (field.startsWith("sc:")) {
        metricFor(sourceCampaigns, field.slice(3)).sessions += count;
      }
    }
  });

  for (const order of orders) {
    addOrder(totals, order);
    addOrder(bySource.get(order.source) ?? bySource.get("Unknown")!, order);
    addOrder(byType.get(order.sourceType) ?? byType.get("Unknown")!, order);
    if (order.campaign) addOrder(metricFor(campaigns, order.campaign), order);
    if (order.adContent) addOrder(metricFor(adContents, order.adContent), order);
    addOrder(metricFor(sourceCampaigns, `${order.source}|${order.campaign}`), order);
    const point = timeline.get(order.day);
    if (point) {
      point.submitted += 1;
      if (isSaleStatus(order.status)) point.confirmed += 1;
    }
  }

  const sessionShare = (sessions: number) => (totals.sessions > 0 ? sessions / totals.sessions : 0);
  const rated = (metric: Metric): RatedMetric => ({ ...withRates(metric), sessionShare: sessionShare(metric.sessions) });

  const orderRows: OrderRow[] = orders
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((order) => ({
      orderId: order.orderId,
      createdAt: order.createdAt,
      day: order.day,
      value: orderValue(order),
      confirmedValue: isSaleStatus(order.status) ? confirmedValueOf(order) : null,
      status: order.status,
      statusAt: order.statusAt,
      governorate: order.governorate,
      offerName: order.offerName,
      pieces: order.products.reduce((sum, product) => sum + product.quantity, 0),
      products: order.products.map((product) => ({ modelId: product.modelId, quantity: product.quantity })),
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      total: order.total,
      source: order.source,
      sourceType: order.sourceType,
      campaign: order.campaign,
      adContent: order.adContent,
      firstTouch: sourceLabel(order.firstTouch),
      lastTouch: sourceLabel(order.lastTouch),
      landingPage: order.landingPage,
      hasFbclid: Boolean(order.lastTouch?.fbclid || order.firstTouch?.fbclid),
      deposit: order.deposit ?? null,
    }));

  return {
    range: { from: days[0] ?? "", to: days.at(-1) ?? "", days: days.length },
    totals: {
      ...withRates(totals),
      uniqueVisitors,
      cancelled: orders.filter((order) => order.status === "cancelled").length,
      returned: orders.filter((order) => order.status === "returned").length,
      pending: orders.filter((order) => order.status === "submitted").length,
    },
    bySource: [...bySource].map(([source, metric]) => ({ source, type: sourceTypeOf(source), ...rated(metric) })),
    byType: [...byType].map(([type, metric]) => ({ type, ...rated(metric) })),
    campaigns: [...campaigns]
      .map(([campaign, metric]) => ({ campaign, ...rated(metric) }))
      .toSorted((a, b) => b.sessions - a.sessions || b.submitted - a.submitted),
    adContents: [...adContents]
      .map(([adContent, metric]) => ({ adContent, ...rated(metric) }))
      .toSorted((a, b) => b.submitted - a.submitted || b.sessions - a.sessions),
    sourceCampaigns: [...sourceCampaigns]
      .map(([pair, metric]) => {
        const split = pair.indexOf("|");
        const source = split < 0 ? pair : pair.slice(0, split);
        return {
          source: isTrafficSource(source) ? source : "Unknown" as TrafficSource,
          campaign: split < 0 ? "" : pair.slice(split + 1),
          ...rated(metric),
        };
      })
      .toSorted((a, b) => b.sessions - a.sessions || b.submitted - a.submitted),
    timeline: [...timeline.values()],
    orders: orderRows,
    funnel: {
      sessions: totals.sessions,
      ...(input.funnel ?? { view: 0, add: 0, checkout: 0, order: 0 }),
    },
    products: buildProductRows(input.products ?? [], input.uniqueAdders ?? {}),
  };
}

export type RatedMetric = Metric & { submittedConversion: number | null; confirmedConversion: number | null; sessionShare: number };

export type AnalyticsReport = {
  range: { from: string; to: string; days: number };
  totals: Metric & { submittedConversion: number | null; confirmedConversion: number | null; uniqueVisitors: number; cancelled: number; returned: number; pending: number };
  bySource: (RatedMetric & { source: TrafficSource; type: SourceType })[];
  byType: (RatedMetric & { type: SourceType })[];
  campaigns: (RatedMetric & { campaign: string })[];
  adContents: (RatedMetric & { adContent: string })[];
  /** Sessions by source and campaign together (campaign "" = no utm_campaign). */
  sourceCampaigns: (RatedMetric & { source: TrafficSource; campaign: string })[];
  timeline: { date: string; sessions: number; submitted: number; confirmed: number }[];
  orders: OrderRow[];
  /** Sessions, then sessions that viewed a product, added to cart, opened checkout and sent an order. */
  funnel: { sessions: number } & FunnelCounts;
  products: ProductRow[];
};
