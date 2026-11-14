// "كل الأوردرات": site orders and imported Telegram orders in one list (pure, tested).
//
// Each order appears once. A site order is taken from the site (its status, deposit and totals);
// when its customer details were never stored, the matching Telegram message fills them in.
import type { AnalyticsOrder, Courier, Deposit, OrderStatus } from "./analytics-report.ts";
import type { OrderMoney } from "./finance.ts";
import { SHIPPING_SYSTEM_NOTES, type OldOrder } from "./old-orders.ts";
import { editRecordProducts, editTotals, type OrderEdit } from "./order-edit.ts";
import type { OrderDetails } from "./order-vault.ts";
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
  /** Cost, margin, share of expenses and net profit (added by the API; none for cancelled/returned). */
  money?: OrderMoney | null;
};

export const ORDER_FILTERS = [
  { id: "all", label: "الكل" },
  { id: "submitted", label: "مستني تأكيد" },
  { id: "confirmed", label: "مؤكد" },
  { id: "deposit", label: "دفع ديبوزيت" },
  { id: "to-ship", label: "مؤكد ولسه مراحش للشحن" },
  { id: "with-courier", label: "مع شركة الشحن" },
  { id: "delivered", label: "تم الاستلام" },
  { id: "returned", label: "مرتجع" },
  { id: "cancelled", label: "اتلغى" },
] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number]["id"];

export function matchesFilter(order: UnifiedOrder, filter: OrderFilter) {
  if (filter === "all") return true;
  if (filter === "deposit") return order.deposit !== null;
  if (filter === "to-ship") return order.status === "confirmed" && !order.courier?.handedAt;
  if (filter === "with-courier") return order.status === "confirmed" && Boolean(order.courier?.handedAt);
  return order.status === filter;
}

/**
 * What the courier collects from the customer, shipping included: the total, less any deposit.
 * When the shipping is not set yet, the governorate's rate is used (`shippingGuessed`); unknown → `amount` null.
 */
export function courierCollection(order: Pick<UnifiedOrder, "total" | "value" | "shippingCost" | "governorate" | "deposit">) {
  const fee = order.shippingCost === null ? governorateShippingFee(order.governorate) : null;
  const total = order.total ?? (fee !== null ? order.value + fee : null);
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
      value: order.confirmedValue ?? order.total ?? order.subtotal,
      origin: [order.source, order.campaign].filter(Boolean).join(" · "),
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
      value: order.total ?? order.offerPrice + order.itemsTotal + (order.shippingCost ?? 0),
      origin: order.source,
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
    value: totals.total ?? totals.subtotal,
    hasCustomer: true,
  };
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
