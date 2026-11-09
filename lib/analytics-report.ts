// Turns stored daily visit counters and order records into the dashboard report. Pure (no I/O) and tested.
import type { Touch } from "./attribution.ts";
import { SOURCE_TYPES, TRAFFIC_SOURCES, sourceTypeOf, type SourceType, type TrafficSource } from "./traffic-source.ts";

export const ORDER_STATUSES = ["submitted", "confirmed", "cancelled"] as const;
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
  products: { modelId: string; category: string; quantity: number }[];
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
  if (order.status === "confirmed") {
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
  source: TrafficSource;
  sourceType: SourceType;
  campaign: string;
  adContent: string;
  firstTouch: string;
  lastTouch: string;
  landingPage: string;
  hasFbclid: boolean;
};

export function buildReport(input: { days: string[]; visits: DayVisits[]; uniqueVisitors: number; orders: AnalyticsOrder[] }): AnalyticsReport {
  const { days, visits, uniqueVisitors } = input;
  const daySet = new Set(days);
  const orders = input.orders.filter((order) => daySet.has(order.day));

  const totals = emptyMetric();
  const bySource = new Map<TrafficSource, Metric>(TRAFFIC_SOURCES.map((source) => [source, emptyMetric()]));
  const byType = new Map<SourceType, Metric>(SOURCE_TYPES.map((type) => [type, emptyMetric()]));
  const campaigns = new Map<string, Metric>();
  const adContents = new Map<string, Metric>();
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
      }
    }
  });

  for (const order of orders) {
    addOrder(totals, order);
    addOrder(bySource.get(order.source) ?? bySource.get("Unknown")!, order);
    addOrder(byType.get(order.sourceType) ?? byType.get("Unknown")!, order);
    if (order.campaign) addOrder(metricFor(campaigns, order.campaign), order);
    if (order.adContent) addOrder(metricFor(adContents, order.adContent), order);
    const point = timeline.get(order.day);
    if (point) {
      point.submitted += 1;
      if (order.status === "confirmed") point.confirmed += 1;
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
      confirmedValue: order.status === "confirmed" ? confirmedValueOf(order) : null,
      status: order.status,
      statusAt: order.statusAt,
      governorate: order.governorate,
      offerName: order.offerName,
      pieces: order.products.reduce((sum, product) => sum + product.quantity, 0),
      source: order.source,
      sourceType: order.sourceType,
      campaign: order.campaign,
      adContent: order.adContent,
      firstTouch: sourceLabel(order.firstTouch),
      lastTouch: sourceLabel(order.lastTouch),
      landingPage: order.landingPage,
      hasFbclid: Boolean(order.lastTouch?.fbclid || order.firstTouch?.fbclid),
    }));

  return {
    range: { from: days[0] ?? "", to: days.at(-1) ?? "", days: days.length },
    totals: {
      ...withRates(totals),
      uniqueVisitors,
      cancelled: orders.filter((order) => order.status === "cancelled").length,
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
    timeline: [...timeline.values()],
    orders: orderRows,
  };
}

export type RatedMetric = Metric & { submittedConversion: number | null; confirmedConversion: number | null; sessionShare: number };

export type AnalyticsReport = {
  range: { from: string; to: string; days: number };
  totals: Metric & { submittedConversion: number | null; confirmedConversion: number | null; uniqueVisitors: number; cancelled: number; pending: number };
  bySource: (RatedMetric & { source: TrafficSource; type: SourceType })[];
  byType: (RatedMetric & { type: SourceType })[];
  campaigns: (RatedMetric & { campaign: string })[];
  adContents: (RatedMetric & { adContent: string })[];
  timeline: { date: string; sessions: number; submitted: number; confirmed: number }[];
  orders: OrderRow[];
};
