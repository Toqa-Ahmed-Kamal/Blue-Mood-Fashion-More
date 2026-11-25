// "كل الأوردرات": site orders and imported Telegram orders in one list (pure, tested).
//
// Each order appears once. A site order is taken from the site (its status, deposit and totals);
// when its customer details were never stored, the matching Telegram message fills them in.
import type { AnalyticsOrder, CancelReason, Courier, Deposit, OrderStatus } from "./analytics-report.ts";
import type { OrderMoney } from "./finance.ts";
import { SHIPPING_SYSTEM_NOTES, type OldOrder } from "./old-orders.ts";
import { editRecordProducts, editTotals, type OrderEdit } from "./order-edit.ts";
import { returnedAmount, type PieceReturn } from "./order-returns.ts";
import type { OrderDetails } from "./order-vault.ts";
import type { Shipment } from "./shipment.ts";
import { governorateShippingFee } from "./shipping-rates.ts";
import { findProduct } from "./site-data.ts";

export type UnifiedProduct = { modelId: string; name: string; quantity: number; size: string; unitPrice: number | null };

export type UnifiedOrder = {
  orderId: string;
  source: "site" | "telegram";
  createdAt: string;
  status: OrderStatus;
  deposit: Deposit | null;
  /** Shipping company steps (told / handed over). */
  courier: Courier | null;
  /** Why it was cancelled (cancelled orders only). */
  cancelReason: CancelReason | null;
  archived: boolean;
  /** false when neither the site nor a Telegram message has the customer's details. */
  hasCustomer: boolean;
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
  offerName: string;
  /** Price of the offer in this order (0 when none). */
  offerPrice: number;
  /** true when the pieces and prices are known, so the order can be edited safely. */
  editable: boolean;
  products: UnifiedProduct[];
  shippingCost: number | null;
  total: number | null;
  /** Amount of the order: collected amount, else total, else items without shipping. */
  value: number;
  /** Where the visit came from (site orders), e.g. "Facebook Ads · winter_2026". */
  origin: string;
  /** The visit's source alone ("Facebook Ads"…) and its campaign (utm_campaign); "" when unknown. */
  trafficSource: string;
  campaign: string;
  /** Pieces she gave back after receiving the order (they stay in `products`, the order's history). */
  returns: PieceReturn[];
  /** Shipping company, its extra charges and what it paid over; null when none set. */
  shipment: Shipment | null;
  /** Cost, margin, share of expenses and net profit (added by the API; none for cancelled/returned). */
  money?: OrderMoney | null;
};

export const ORDER_FILTERS = [
  { id: "all", label: "الكل" },
  { id: "submitted", label: "مستني تأكيد" },
  { id: "to-call", label: "مستني تأكيد العميل" },
  { id: "confirmed", label: "مؤكد" },
  { id: "deposit", label: "دفع ديبوزيت" },
  { id: "to-ship", label: "مؤكد ولسه مراحش للشحن" },
  { id: "packed", label: "متجهز للشحن ولسه مراحش" },
  { id: "courier-notified", label: "اتبلغت شركة الشحن ولسه مجتش" },
  { id: "with-courier", label: "مع شركة الشحن" },
  { id: "delivered", label: "تم الاستلام" },
  { id: "returned", label: "مرتجع" },
  { id: "cancelled", label: "اتلغى" },
] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number]["id"];

/** Cancel reason filter: any, one reason, or "none" (cancelled without a reason). Only cancelled orders match a reason. */
export type ReasonFilter = "" | CancelReason | "none";

export function matchesReason(order: Pick<UnifiedOrder, "status" | "cancelReason">, reason: ReasonFilter) {
  if (!reason) return true;
  if (order.status !== "cancelled") return false;
  return reason === "none" ? !order.cancelReason : order.cancelReason === reason;
}

export function isOrderFilter(value: unknown): value is OrderFilter {
  return ORDER_FILTERS.some((item) => item.id === value);
}

export function matchesFilter(order: Pick<UnifiedOrder, "status" | "deposit" | "courier">, filter: OrderFilter) {
  if (filter === "all") return true;
  if (filter === "deposit") return order.deposit !== null;
  // Customers to call: not received, not cancelled or returned, no deposit, the shipping company not told yet.
  if (filter === "to-call") return (order.status === "submitted" || order.status === "confirmed") && order.deposit === null && !order.courier?.notifiedAt;
  if (filter === "to-ship") return order.status === "confirmed" && !order.courier?.handedAt;
  // Packed and ready for the shipping company, not picked up yet.
  if (filter === "packed") return (order.status === "submitted" || order.status === "confirmed") && Boolean(order.courier?.packedAt) && !order.courier?.handedAt;
  // The shipping company was told but hasn't picked the order up yet.
  if (filter === "courier-notified") return (order.status === "submitted" || order.status === "confirmed") && Boolean(order.courier?.notifiedAt) && !order.courier?.handedAt;
  if (filter === "with-courier") return order.status === "confirmed" && Boolean(order.courier?.handedAt);
  return order.status === filter;
}

/**
 * What the courier collects from the customer, shipping included: the total, less any deposit.
 * When the shipping is not set yet, the governorate's rate is used (`shippingGuessed`); unknown → `amount` null.
 */
export function courierCollection(order: Pick<UnifiedOrder, "total" | "value" | "shippingCost" | "governorate" | "deposit"> & { returns?: PieceReturn[] }) {
  const fee = order.shippingCost === null ? governorateShippingFee(order.governorate) : null;
  // Pieces she gave back come off (value already leaves them out).
  const total = order.total !== null ? order.total - returnedAmount(order.returns) : fee !== null ? order.value + fee : null;
  return {
    amount: total === null ? null : Math.max(0, Math.round((total - (order.deposit?.amount ?? 0)) * 100) / 100),
    shippingGuessed: order.shippingCost === null && fee !== null,
    shippingFee: order.shippingCost ?? fee,
  };
}

const egp = (value: number) => `${new Intl.NumberFormat("en-US").format(value)} ج.م`;

/** What the customer wrote, without the shipping notes the site adds by itself. */
export function customerNote(notes: string) {
  return notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !SHIPPING_SYSTEM_NOTES.includes(line) && !line.startsWith("منطقة غير مخدومة بالشحن العادي"))
    .join(" — ");
}

/** The text the shipping company asks for, ready to paste. Inspection is always allowed. */
export function courierText(order: UnifiedOrder) {
  const pieces = order.products.reduce((sum, product) => sum + product.quantity, 0);
  const collection = courierCollection(order);
  const phones = [order.phone, order.alternatePhone].filter(Boolean).join(" / ");
  const note = customerNote(order.notes);
  // Only "clothes" and how many pieces: no product names, no order number.
  return [
    `الاسم: ${order.customerName || "—"}`,
    `رقم التليفون: ${phones || "—"}`,
    `المحافظة: ${order.governorate || "—"}`,
    `المنطقة: ${order.area || "—"}`,
    `العنوان: ${order.address.replace(/\s*\n\s*/g, " ") || "—"}`,
    `التحصيل (شامل الشحن): ${collection.amount === null ? "—" : egp(collection.amount)}`,
    `المحتوى: ملابس — ${pieces === 1 ? "قطعة واحدة" : pieces === 2 ? "قطعتين" : `${pieces} ${pieces <= 10 ? "قطع" : "قطعة"}`}`,
    "متاح المعاينة: نعم",
    ...(note ? [`ملاحظات العميل: ${note}`] : []),
  ].join("\n");
}

export function filterCounts(orders: UnifiedOrder[]) {
  return Object.fromEntries(ORDER_FILTERS.map((filter) => [filter.id, orders.filter((order) => matchesFilter(order, filter.id)).length])) as Record<OrderFilter, number>;
}

const nameOf = (modelId: string, fallback: string) => findProduct(modelId)?.name ?? fallback;

export function mergeAllOrders(live: { order: AnalyticsOrder; details: OrderDetails | null }[], old: OldOrder[]): UnifiedOrder[] {
  const oldById = new Map(old.map((order) => [order.orderId, order]));
  const rows: UnifiedOrder[] = [];

  for (const { order, details } of live) {
    const copy = oldById.get(order.orderId);
    const customer = details ?? (copy ? { customerName: copy.customerName, phone: copy.phone, alternatePhone: copy.alternatePhone, governorate: copy.governorate, area: copy.area, address: copy.address, notes: copy.notes } : null);
    // The Telegram copy adds names, sizes and prices only when it lists the very same pieces.
    const lines = (list: { modelId: string; quantity: number }[]) => JSON.stringify(list.map((product) => [product.modelId, product.quantity]).sort());
    const copyMatches = copy !== undefined && lines(copy.products) === lines(order.products);
    const products: UnifiedProduct[] = details
      ? details.products.map((product) => ({ modelId: product.modelId, name: product.name, quantity: product.quantity, size: product.fit, unitPrice: product.unitPrice }))
      : copy && copyMatches
        ? copy.products.map((product) => ({ modelId: product.modelId, name: product.name, quantity: product.quantity, size: product.size, unitPrice: product.unitPrice }))
        : order.products.map((product) => ({ modelId: product.modelId, name: nameOf(product.modelId, product.modelId), quantity: product.quantity, size: product.fit ?? "", unitPrice: null }));
    rows.push({
      orderId: order.orderId,
      source: "site",
      createdAt: order.createdAt,
      status: order.status,
      deposit: order.deposit ?? null,
      courier: order.courier ?? null,
      cancelReason: order.cancelReason ?? null,
      archived: false,
      hasCustomer: customer !== null,
      customerName: customer?.customerName ?? "",
      phone: customer?.phone ?? "",
      alternatePhone: customer?.alternatePhone ?? "",
      governorate: customer?.governorate || order.governorate,
      area: customer?.area ?? "",
      address: customer?.address ?? "",
      notes: customer?.notes ?? "",
      offerName: order.offerName,
      offerPrice: details ? details.offerPrice : copy && copyMatches ? copy.offerPrice : 0,
      editable: details !== null || (copy !== undefined && copyMatches),
      products,
      shippingCost: order.shippingCost,
      total: order.total,
      value: Math.max(0, (order.confirmedValue ?? order.total ?? order.subtotal) - returnedAmount(order.returns)),
      origin: [order.source, order.campaign].filter(Boolean).join(" · "),
      trafficSource: order.source ?? "",
      campaign: order.campaign ?? "",
      returns: order.returns ?? [],
      shipment: order.shipment ?? null,
    });
  }

  const siteIds = new Set(live.map(({ order }) => order.orderId));
  for (const order of old) {
    if (siteIds.has(order.orderId)) continue;
    rows.push({
      orderId: order.orderId,
      source: "telegram",
      createdAt: order.createdAt,
      status: order.status,
      deposit: order.deposit ?? null,
      courier: order.courier ?? null,
      cancelReason: order.cancelReason ?? null,
      archived: order.archived,
      hasCustomer: Boolean(order.customerName || order.phone),
      customerName: order.customerName,
      phone: order.phone,
      alternatePhone: order.alternatePhone,
      governorate: order.governorate,
      area: order.area,
      address: order.address,
      notes: order.notes,
      offerName: order.offerName,
      offerPrice: order.offerPrice,
      editable: true,
      products: order.products.map((product) => ({ modelId: product.modelId, name: product.name, quantity: product.quantity, size: product.size, unitPrice: product.unitPrice })),
      shippingCost: order.shippingCost,
      total: order.total,
      value: Math.max(0, (order.total ?? order.offerPrice + order.itemsTotal + (order.shippingCost ?? 0)) - returnedAmount(order.returns)),
      origin: order.source,
      trafficSource: order.source ?? "",
      campaign: "",
      returns: order.returns ?? [],
      shipment: order.shipment ?? null,
    });
  }

  return rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The row as it looks right after an edit was saved (shown at once, before the list is reloaded). */
export function withEdit(order: UnifiedOrder, edit: OrderEdit): UnifiedOrder {
  const totals = editTotals(edit);
  return {
    ...order,
    customerName: edit.customerName,
    phone: edit.phone,
    alternatePhone: edit.alternatePhone,
    governorate: edit.governorate || order.governorate,
    area: edit.area,
    address: edit.address,
    notes: edit.notes,
    offerName: edit.offerName || order.offerName,
    offerPrice: edit.offerPrice,
    products: editRecordProducts(edit).map((product) => ({ modelId: product.modelId, name: product.name, quantity: product.quantity, size: product.fit, unitPrice: product.unitPrice })),
    shippingCost: edit.shippingCost,
    total: totals.total,
    value: Math.max(0, (totals.total ?? totals.subtotal) - returnedAmount(order.returns)),
    hasCustomer: true,
  };
}

/** Margin filter (هامش الربح = sale − factory cost of the pieces): `min` included, `max` not; null = no limit. */
export type MarginRange = { min: number | null; max: number | null };

export const MARGIN_PRESETS: { id: string; label: string; range: MarginRange }[] = [
  { id: "", label: "كل هوامش الربح", range: { min: null, max: null } },
  { id: "loss", label: "خسارة (أقل من صفر)", range: { min: null, max: 0 } },
  { id: "lt100", label: "هامش أقل من 100", range: { min: null, max: 100 } },
  { id: "lt200", label: "هامش أقل من 200", range: { min: null, max: 200 } },
  { id: "200-300", label: "هامش من 200 لـ 300", range: { min: 200, max: 300 } },
  { id: "gte200", label: "هامش 200 وأكتر", range: { min: 200, max: null } },
  { id: "gte300", label: "هامش 300 وأكتر", range: { min: 300, max: null } },
  { id: "custom", label: "هامش بأرقام من عندي…", range: { min: null, max: null } },
];

export const NET_PROFIT_PRESETS: { id: string; label: string; range: MarginRange }[] = [
  { id: "", label: "كل صافي المكسب", range: { min: null, max: null } },
  { id: "loss", label: "صافي خسارة (أقل من صفر)", range: { min: null, max: 0 } },
  { id: "lt50", label: "صافي أقل من 50", range: { min: null, max: 50 } },
  { id: "lt100", label: "صافي أقل من 100", range: { min: null, max: 100 } },
  { id: "100-200", label: "صافي من 100 لـ 200", range: { min: 100, max: 200 } },
  { id: "gte100", label: "صافي 100 وأكتر", range: { min: 100, max: null } },
  { id: "gte200", label: "صافي 200 وأكتر", range: { min: 200, max: null } },
  { id: "custom", label: "صافي بأرقام من عندي…", range: { min: null, max: null } },
];

function inRange(order: UnifiedOrder, range: MarginRange, value: (money: NonNullable<UnifiedOrder["money"]>) => number) {
  if (range.min === null && range.max === null) return true;
  const amount = order.status === "cancelled" || order.status === "returned" || !order.money ? null : value(order.money);
  if (amount === null) return false;
  return (range.min === null || amount >= range.min) && (range.max === null || amount < range.max);
}

/** Orders without a margin (cancelled, returned) are left out as soon as a limit is set. */
export function matchesMargin(order: UnifiedOrder, range: MarginRange) {
  return inRange(order, range, (money) => money.margin);
}

/** Net profit (margin − share of the month's expenses); same rules as the margin filter. */
export function matchesNetProfit(order: UnifiedOrder, range: MarginRange) {
  return inRange(order, range, (money) => money.netProfit);
}

/** Search over order number, customer, phone, place, address and products. */
export function matchesSearch(order: UnifiedOrder, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 6 && [order.phone, order.alternatePhone].some((phone) => phone.replace(/\D/g, "").includes(digits.slice(-10)))) return true;
  const haystack = [order.orderId, order.customerName, order.phone, order.alternatePhone, order.governorate, order.area, order.address, order.notes, order.offerName, ...order.products.map((product) => `${product.name} ${product.modelId}`)]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Governorate and area are typed by customers, so the same place comes in several spellings ("مدينة نصر",
 * "مدينه نصر ", "مدينة  نصر"). The key ignores spaces, hamza forms, ة/ه and ى/ي so they count as one place.
 */
export function placeKey(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/^(محافظه|محافظة)\s+/, "")
    .replace(/\s+/g, " ");
}

export type PlaceOption = { key: string; label: string; count: number };

/** Places with how many orders each, most orders first; the label is the most used spelling. */
function placeOptions(values: string[]): PlaceOption[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const value of values) {
    const key = placeKey(value);
    if (!key) continue;
    const group = groups.get(key) ?? { count: 0, spellings: new Map() };
    group.count += 1;
    const spelling = value.trim().replace(/\s+/g, " ");
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => ({
    key,
    label: [...group.spellings].toSorted((a, b) => b[1] - a[1])[0][0],
    count: group.count,
  })).toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar"));
}

export const governorateOptions = (orders: Pick<UnifiedOrder, "governorate">[]) => placeOptions(orders.map((order) => order.governorate));

/**
 * Areas inside one governorate (by its key), or every area when no governorate is chosen — then each label
 * also names the governorate it is in most often ("مدينة نصر · القاهرة").
 */
export function areaOptions(orders: Pick<UnifiedOrder, "governorate" | "area">[], governorate: string): PlaceOption[] {
  const inScope = governorate ? orders.filter((order) => placeKey(order.governorate) === governorate) : orders;
  const options = placeOptions(inScope.map((order) => order.area));
  if (governorate) return options;
  return options.map((option) => {
    const where = governorateOptions(inScope.filter((order) => placeKey(order.area) === option.key))[0];
    return where ? { ...option, label: `${option.label} · ${where.label}` } : option;
  });
}

/** "" = any. "none" for the area = orders of that governorate without an area. */
export function matchesPlace(order: Pick<UnifiedOrder, "governorate" | "area">, governorate: string, area: string) {
  if (governorate && placeKey(order.governorate) !== governorate) return false;
  if (area === "none") return !placeKey(order.area);
  if (area && placeKey(order.area) !== area) return false;
  return true;
}

// ── "كل الأوردرات" filters: several at once, each one can be turned around ("مش …") ──────────────

/** Statuses: any of the ticked ones (none ticked = all). */
export const STATUS_CHOICES: { id: OrderStatus; label: string }[] = [
  { id: "submitted", label: "مستني تأكيد" },
  { id: "confirmed", label: "مؤكد" },
  { id: "delivered", label: "تم الاستلام" },
  { id: "returned", label: "مرتجع" },
  { id: "cancelled", label: "اتلغى" },
];

/** Steps an order has or not. Each one: true = must have it, false = must not, missing = either. */
export const ORDER_FACTS = [
  { id: "deposit", yes: "دفع ديبوزيت", no: "من غير ديبوزيت" },
  { id: "packed", yes: "اتجهز للشحن", no: "لسه ما اتجهزش" },
  { id: "notified", yes: "اتبلغت شركة الشحن", no: "لسه ما اتبلغتش شركة الشحن" },
  { id: "handed", yes: "راح لشركة الشحن", no: "لسه مراحش لشركة الشحن" },
  { id: "returns", yes: "فيه قطع رجعت", no: "مفيش قطع رجعت" },
  { id: "return-open", yes: "قطع راجعة لسه موصلتش المخزن", no: "مفيش قطع راجعة مستنياها" },
] as const;
export type OrderFact = (typeof ORDER_FACTS)[number]["id"];
export type FactChoice = Partial<Record<OrderFact, boolean>>;

type FactOrder = Pick<UnifiedOrder, "deposit" | "courier"> & { returns?: PieceReturn[] };

export function hasFact(order: FactOrder, fact: OrderFact) {
  if (fact === "deposit") return order.deposit !== null;
  if (fact === "returns") return Boolean(order.returns?.length);
  if (fact === "return-open") return Boolean(order.returns?.some((item) => item.state !== "in_stock"));
  if (fact === "packed") return Boolean(order.courier?.packedAt);
  if (fact === "notified") return Boolean(order.courier?.notifiedAt);
  return Boolean(order.courier?.handedAt);
}

/** Ticked statuses (any of them) and every chosen step (has / has not) together. */
export function matchesChoice(order: FactOrder & Pick<UnifiedOrder, "status">, statuses: readonly OrderStatus[], facts: FactChoice) {
  if (statuses.length > 0 && !statuses.includes(order.status)) return false;
  return (Object.entries(facts) as [OrderFact, boolean | undefined][]).every(([fact, wanted]) => wanted === undefined || hasFact(order, fact) === wanted);
}

/** Ready-made combinations (the old one-click filters), set into the choices above. */
export const ORDER_SHORTCUTS: { id: string; label: string; statuses: OrderStatus[]; facts: FactChoice }[] = [
  { id: "to-call", label: "مستني تأكيد العميل (لسه ما اتبلغش الشحن ومن غير ديبوزيت)", statuses: ["submitted", "confirmed"], facts: { deposit: false, notified: false } },
  { id: "to-ship", label: "مؤكد ولسه مراحش للشحن", statuses: ["confirmed"], facts: { handed: false } },
  { id: "confirmed-not-notified", label: "مؤكد ولسه ما اتبلغتش شركة الشحن", statuses: ["confirmed"], facts: { notified: false } },
  { id: "packed", label: "متجهز للشحن ولسه مراحش", statuses: ["submitted", "confirmed"], facts: { packed: true, handed: false } },
  { id: "courier-notified", label: "اتبلغت شركة الشحن ولسه مجتش", statuses: ["submitted", "confirmed"], facts: { notified: true, handed: false } },
  { id: "with-courier", label: "مع شركة الشحن", statuses: ["confirmed"], facts: { handed: true } },
];

/** "YYYY-MM-DDTHH:mm" in Cairo time — the same shape a datetime-local field gives, so the two compare as text. */
export function cairoStamp(iso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Placed between two moments (Cairo, "YYYY-MM-DDTHH:mm" or just "YYYY-MM-DD"; either may be "").
 * A day alone means the whole day: from its first minute, to its last.
 */
export function matchesTime(order: Pick<UnifiedOrder, "createdAt">, from: string, to: string) {
  if (!from && !to) return true;
  const stamp = cairoStamp(order.createdAt);
  const start = from.length === 10 ? `${from}T00:00` : from;
  const end = to.length === 10 ? `${to}T23:59` : to;
  return (!start || stamp >= start) && (!end || stamp <= end);
}

/**
 * Placed at this time of day (Cairo), on any day: from hour fromHour up to the end of hour toHour (0–23).
 * "" = open on that side. 22 → 2 wraps past midnight.
 */
export function matchesHours(order: Pick<UnifiedOrder, "createdAt">, fromHour: string, toHour: string) {
  if (fromHour === "" && toHour === "") return true;
  const hour = Number(cairoStamp(order.createdAt).slice(11, 13));
  const from = fromHour === "" ? 0 : Number(fromHour);
  const to = toHour === "" ? 23 : Number(toHour);
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/** Which offer the order has: "winter", "christmas", "none" (or "" = any). */
export function offerKindOf(order: Pick<UnifiedOrder, "offerName">) {
  if (order.offerName.includes("الكريسماس")) return "christmas";
  if (order.offerName.includes("عرض الشتاء")) return "winter";
  return "none";
}

/** Distinct non-empty values with how many times each appears, most first. */
export function countValues(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
