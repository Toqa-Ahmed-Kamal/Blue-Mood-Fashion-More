// Old Orders: orders imported from a Telegram chat export (pure, shared by browser and server).
//
// The store's Telegram chat holds every order message the site ever sent (lib/telegram.ts). The
// admin uploads the chat export (HTML); the browser reads the order messages with
// `parseTelegramExport`, shows a preview, and sends the chosen orders to the server, which checks
// them again with `sanitizeOldOrder` and stores them encrypted. Nothing is guessed: a field the
// message does not contain stays empty.
import { ORDER_STATUSES, type OrderStatus } from "./analytics-report.ts";
import { categoryDetailLabel } from "./order-flow.ts";
import type { OrderDetails } from "./order-vault.ts";
import { findProduct, type CatalogCategory } from "./site-data.ts";

export const OLD_ORDER_ID_PATTERN = /^BM-[A-F\d]{20}$/;
export const MAX_OLD_ORDERS_PER_REQUEST = 50;
export const MAX_OLD_ORDER_PRODUCTS = 40;

export type OldOrderProduct = {
  /** Catalog ID from the message ("" when the line had none). */
  modelId: string;
  name: string;
  /** Size text from the message (e.g. pajama One Size weight note); "" when the message has none. */
  size: string;
  /** Not part of the order messages: empty unless typed in by the admin. */
  color: string;
  quantity: number;
  /** null for pieces included in the offer price. */
  unitPrice: number | null;
};

export type OldOrder = {
  orderId: string;
  createdAt: string;
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
  offerName: string;
  products: OldOrderProduct[];
  offerPrice: number;
  itemsTotal: number;
  shippingCost: number | null;
  total: number | null;
  /** One-line summary of the "📊 مصدر الطلب" block, when the message had one. */
  source: string;
  status: OrderStatus;
  statusAt: string | null;
  archived: boolean;
  importedAt: string;
  updatedAt: string;
};

export type ParsedOldOrder = { order: OldOrder; warnings: string[] };

// ── Telegram export (HTML) ────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** "08.11.2026 16:22:47 UTC+02:00" → ISO timestamp, or null. */
export function parseTelegramDate(title: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?: UTC([+-]\d{2}):?(\d{2}))?/.exec(title.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute, second, offsetHour = "+00", offsetMinute = "00"] = match;
  const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${offsetHour}:${offsetMinute}`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Every message of a Telegram Desktop HTML export as plain text with its send time. */
export function extractTelegramMessages(html: string): { date: string | null; text: string }[] {
  const messages: { date: string | null; text: string }[] = [];
  for (const block of html.split(/<div class="message /).slice(1)) {
    const textMatch = /<div class="text">([\s\S]*?)<\/div>/.exec(block);
    if (!textMatch) continue;
    const dateMatch = /class="pull_right date details" title="([^"]+)"/.exec(block);
    const text = decodeEntities(textMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .trim();
    messages.push({ date: dateMatch ? parseTelegramDate(dateMatch[1]) : null, text });
  }
  return messages;
}

const SHIPPING_SYSTEM_NOTES = [
  "تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ.",
  "سعر الشحن مبدئي وقابل للتعديل. الإجمالي تقديري.",
];

/** "1,100 ج.م" → 1100; "غير مؤكد" → null. */
function money(text: string) {
  const match = /([\d,.]+)\s*ج\.م/.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

const ITEM_PATTERN = /^\d+\.\s+(.+?)(?:\s+×\s+(\d+))?\s+\(([a-z\d-]+)\)\s+—\s+(.+?)(?:\s+—\s+([\d,.]+)\s*ج\.م)?$/;
const SIZE_PATTERN = /size|مقاس/i;

function parseItem(line: string, warnings: string[]): OldOrderProduct {
  const match = ITEM_PATTERN.exec(line);
  if (!match) {
    warnings.push(`سطر منتج مش واضح: "${line.slice(0, 80)}"`);
    return { modelId: "", name: line.replace(/^\d+\.\s+/, "").trim(), size: "", color: "", quantity: 1, unitPrice: null };
  }
  const [, name, rawQuantity, modelId, fit, rawPrice] = match;
  const quantity = rawQuantity ? Number(rawQuantity) : 1;
  const lineTotal = rawPrice ? Number(rawPrice.replace(/,/g, "")) : null;
  if (!findProduct(modelId)) warnings.push(`المنتج ${modelId} مش موجود في الكتالوج الحالي`);
  return {
    modelId,
    name: name.trim(),
    // Abaya / robe / blanket lines carry the category name, not a size.
    size: SIZE_PATTERN.test(fit) ? fit.trim() : "",
    color: "",
    quantity,
    unitPrice: lineTotal === null ? null : Math.round((lineTotal / quantity) * 100) / 100,
  };
}

/** Reads one order message (as built by lib/telegram.ts). null when the message is not an order. */
export function parseTelegramOrderText(text: string, sentAt: string | null, now = new Date()): ParsedOldOrder | null {
  const idMatch = /رقم الطلب:\s*(BM-[A-F\d]{20})/.exec(text);
  if (!idMatch) return null;
  const warnings: string[] = [];
  const order: OldOrder = {
    orderId: idMatch[1],
    createdAt: sentAt ?? "",
    customerName: "",
    phone: "",
    alternatePhone: "",
    governorate: "",
    area: "",
    address: "",
    notes: "",
    offerName: "",
    products: [],
    offerPrice: 0,
    itemsTotal: 0,
    shippingCost: null,
    total: null,
    source: "",
    status: "submitted",
    statusAt: null,
    archived: false,
    importedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  let block: "address" | "notes" | "source" | null = null;
  const address: string[] = [];
  const notes: string[] = [];
  const source: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("📊")) {
      block = "source";
      continue;
    }
    if (block === "source") {
      if (line) source.push(line);
      continue;
    }
    if (!line) {
      block = null;
      continue;
    }
    if (line.startsWith("👤")) order.customerName = line.replace(/^👤\s*/, "");
    else if (/^📞\s*بديل:/.test(line)) order.alternatePhone = line.replace(/^📞\s*بديل:\s*/, "");
    else if (line.startsWith("📞")) order.phone = line.replace(/^📞\s*/, "");
    else if (line.startsWith("📍")) {
      const place = line.replace(/^📍\s*/, "");
      const split = place.indexOf(" — ");
      order.governorate = split < 0 ? place : place.slice(0, split).trim();
      order.area = split < 0 ? "" : place.slice(split + 3).trim();
    } else if (line.startsWith("🏠")) {
      block = "address";
      address.push(line.replace(/^🏠\s*/, ""));
    } else if (line.startsWith("📝")) {
      block = "notes";
      notes.push(line.replace(/^📝\s*/, ""));
    } else if (line.startsWith("العرض:")) order.offerName = line.replace(/^العرض:\s*/, "");
    else if (/^\d+\.\s/.test(line)) {
      block = null;
      order.products.push(parseItem(line, warnings));
    } else if (line.startsWith("🔗")) continue;
    else if (line.startsWith("سعر العرض:")) order.offerPrice = money(line) ?? 0;
    else if (line.startsWith("القطع المنفردة:")) order.itemsTotal = money(line) ?? 0;
    else if (line.startsWith("الشحن:")) order.shippingCost = money(line);
    else if (line.startsWith("الإجمالي:")) order.total = money(line);
    else if (block === "address") address.push(line);
    else if (block === "notes") notes.push(line);
  }

  order.address = address.join("\n").trim();
  order.notes = notes.filter((line) => !SHIPPING_SYSTEM_NOTES.includes(line)).join("\n").trim();
  order.source = summarizeSource(source);
  if (!order.createdAt) warnings.push("وقت الرسالة مش موجود");
  if (!order.customerName) warnings.push("اسم العميلة مش موجود في الرسالة");
  if (!order.phone) warnings.push("رقم الموبايل مش موجود في الرسالة");
  if (order.products.length === 0) warnings.push("مفيش منتجات في الرسالة");
  if (text.endsWith("…")) warnings.push("الرسالة متقطوعة (أطول من حد تيليجرام)");
  return { order, warnings };
}

/** "آخر زيارة: Paid Ads" + "source=facebook | medium=paid_social | campaign=winter_2026" + "fbclid: موجود" → one line. */
function summarizeSource(lines: string[]) {
  if (lines.length === 0) return "";
  const last = lines.findIndex((line) => line.startsWith("آخر زيارة:"));
  const start = last >= 0 ? last : 0;
  const end = lines.findIndex((line, index) => index > start && /^(أول|آخر) زيارة:/.test(line));
  const touch = lines.slice(start, end < 0 ? undefined : end);
  const parts = [touch[0]?.replace(/^(آخر|أول) زيارة:\s*/, "").replace(/^مصدر الطلب:\s*/, "")];
  for (const line of touch.slice(1)) {
    if (line.includes("=")) parts.push(line);
    else if (line.startsWith("fbclid")) parts.push("fbclid");
  }
  return parts.filter(Boolean).join(" · ").slice(0, 300);
}

/** Every order message in an export (non-order messages are skipped; repeats keep the first copy). */
export function parseTelegramExport(html: string, now = new Date()): ParsedOldOrder[] {
  const seen = new Set<string>();
  const orders: ParsedOldOrder[] = [];
  for (const message of extractTelegramMessages(html)) {
    const parsed = parseTelegramOrderText(message.text, message.date, now);
    if (!parsed || seen.has(parsed.order.orderId)) continue;
    seen.add(parsed.order.orderId);
    orders.push(parsed);
  }
  return orders;
}

// ── Validation (server) ───────────────────────────────────────────────────

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, limit) : "");
const amount = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? Math.round(number * 100) / 100 : null;
};
const isoDate = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

/** Checks an order coming from the browser. Returns null when it cannot be stored. */
export function sanitizeOldOrder(raw: unknown, now = new Date()): OldOrder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const orderId = text(value.orderId, 30);
  if (!OLD_ORDER_ID_PATTERN.test(orderId)) return null;
  const createdAt = isoDate(value.createdAt);
  if (!createdAt) return null;
  const products = (Array.isArray(value.products) ? value.products : []).slice(0, MAX_OLD_ORDER_PRODUCTS).flatMap((item): OldOrderProduct[] => {
    if (typeof item !== "object" || item === null) return [];
    const product = item as Record<string, unknown>;
    const name = text(product.name, 160);
    const quantity = Number(product.quantity);
    if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return [];
    const modelId = text(product.modelId, 60);
    return [{
      modelId: /^[a-z\d-]*$/.test(modelId) ? modelId : "",
      name,
      size: text(product.size, 120),
      color: text(product.color, 60),
      quantity,
      unitPrice: amount(product.unitPrice),
    }];
  });
  return {
    orderId,
    createdAt,
    customerName: text(value.customerName, 120),
    phone: text(value.phone, 40),
    alternatePhone: text(value.alternatePhone, 40),
    governorate: text(value.governorate, 60),
    area: text(value.area, 120),
    address: text(value.address, 600),
    notes: text(value.notes, 600),
    offerName: text(value.offerName, 160),
    products,
    offerPrice: amount(value.offerPrice) ?? 0,
    itemsTotal: amount(value.itemsTotal) ?? 0,
    shippingCost: amount(value.shippingCost),
    total: amount(value.total),
    source: text(value.source, 300),
    status: (ORDER_STATUSES as readonly unknown[]).includes(value.status) ? (value.status as OrderStatus) : "submitted",
    statusAt: isoDate(value.statusAt),
    archived: value.archived === true,
    importedAt: isoDate(value.importedAt) ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// ── Duplicates, totals and factory quantities ─────────────────────────────

/** Last 10 digits, so "01012345678", "+201012345678" and "201012345678" match. */
export function phoneKey(phone: string) {
  const digits = phone.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : "";
}

const nameKey = (name: string) => name.replace(/[\s.\-_/]+/g, " ").trim().toLowerCase();

export type DuplicateInfo = {
  /** Same order ID is already saved in Old Orders (it will not be imported twice). */
  alreadySaved: boolean;
  /** Other orders (saved or in the same file) with the same phone number. */
  samePhone: string[];
  /** Other orders with the same customer name but a different phone. */
  sameName: string[];
};

export function findDuplicates(candidates: OldOrder[], saved: OldOrder[]): Record<string, DuplicateInfo> {
  const savedIds = new Set(saved.map((order) => order.orderId));
  const pool = [...saved, ...candidates.filter((order) => !savedIds.has(order.orderId))];
  const result: Record<string, DuplicateInfo> = {};
  for (const order of candidates) {
    const phones = [phoneKey(order.phone), phoneKey(order.alternatePhone)].filter(Boolean);
    const name = nameKey(order.customerName);
    const samePhone: string[] = [];
    const sameName: string[] = [];
    for (const other of pool) {
      if (other.orderId === order.orderId) continue;
      const otherPhones = [phoneKey(other.phone), phoneKey(other.alternatePhone)].filter(Boolean);
      if (phones.some((phone) => otherPhones.includes(phone))) samePhone.push(other.orderId);
      else if (name && name === nameKey(other.customerName)) sameName.push(other.orderId);
    }
    result[order.orderId] = { alreadySaved: savedIds.has(order.orderId), samePhone, sameName };
  }
  return result;
}

export function oldOrderPieces(order: OldOrder) {
  return order.products.reduce((sum, product) => sum + product.quantity, 0);
}

/** Total of the order: the message total, else offer + single pieces (+ shipping when known). */
export function oldOrderValue(order: OldOrder) {
  return order.total ?? order.offerPrice + order.itemsTotal + (order.shippingCost ?? 0);
}

export type QuantityRow = {
  modelId: string;
  name: string;
  category: CatalogCategory | "";
  size: string;
  color: string;
  quantity: number;
  /** Number of different orders that include it. */
  orders: number;
};

/** Pieces to make / order from the factory, grouped by product, size and color. */
export function aggregateQuantities(orders: OldOrder[]): QuantityRow[] {
  const rows = new Map<string, QuantityRow & { ids: Set<string> }>();
  for (const order of orders) {
    for (const product of order.products) {
      const id = product.modelId || product.name;
      const groupKey = `${id}|${product.size}|${product.color}`;
      let row = rows.get(groupKey);
      if (!row) {
        const catalogProduct = product.modelId ? findProduct(product.modelId) : undefined;
        row = {
          modelId: product.modelId,
          name: catalogProduct?.name ?? product.name,
          category: catalogProduct?.category ?? "",
          size: product.size,
          color: product.color,
          quantity: 0,
          orders: 0,
          ids: new Set(),
        };
        rows.set(groupKey, row);
      }
      row.quantity += product.quantity;
      row.ids.add(order.orderId);
    }
  }
  return [...rows.values()]
    .map(({ ids, ...row }) => ({ ...row, orders: ids.size }))
    .toSorted((a, b) => a.category.localeCompare(b.category) || b.quantity - a.quantity || a.name.localeCompare(b.name));
}

/**
 * The same order in the shape of a live order's encrypted details, used to fill in the customer
 * details of a dashboard order saved before they were stored. null when a product is not in the
 * catalog (its category would have to be guessed).
 */
export function oldOrderToDetails(order: OldOrder): OrderDetails | null {
  const products: OrderDetails["products"] = [];
  for (const product of order.products) {
    const catalogProduct = findProduct(product.modelId);
    if (!catalogProduct) return null;
    products.push({
      modelId: product.modelId,
      name: product.name,
      category: catalogProduct.category,
      fit: product.size || (catalogProduct.category === "winter-pajamas" ? "" : categoryDetailLabel(catalogProduct.category)),
      quantity: product.quantity,
      unitPrice: product.unitPrice,
      link: null,
    });
  }
  return {
    orderId: order.orderId,
    createdAt: order.createdAt,
    customerName: order.customerName,
    phone: order.phone,
    alternatePhone: order.alternatePhone,
    governorate: order.governorate,
    area: order.area,
    address: order.address,
    offerName: order.offerName,
    products,
    offerPrice: order.offerPrice,
    itemsTotal: order.itemsTotal,
    subtotal: order.offerPrice + order.itemsTotal,
    shippingCost: order.shippingCost,
    total: order.total,
    notes: order.notes,
    importedFrom: "telegram",
  };
}
