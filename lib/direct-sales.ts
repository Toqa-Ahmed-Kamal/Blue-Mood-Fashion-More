// Direct sales (بيع مباشر): pieces the owner sells to friends and family outside social media and the site.
// Pure (no I/O) and tested; storage is lib/finance-store.ts (finance:direct).
//
// Rules
// - Sale = pieces × the price agreed with the buyer. Products cost = pieces × factory cost, saved with the
//   sale (taken from the product's factory cost when it is not typed in), so a later factory price change
//   does not change it.
// - Extra cost = what the owner paid for this sale (delivery, packaging…). Profit = sale − products cost − extra cost.
// - The month's expenses (ads, courier…) are carried by online orders only; a direct sale carries none.
import { findProduct } from "./site-data.ts";

export type DirectSaleLine = {
  /** Store product, or "" for something not in the store (then `name` is what was sold). */
  productId: string;
  name: string;
  quantity: number;
  /** Price of one piece agreed with the buyer (EGP). */
  unitPrice: number;
  /** Factory cost of one piece (EGP); null when unknown. */
  unitCost: number | null;
};

export type DirectSale = {
  id: string;
  /** YYYY-MM-DD (Cairo). */
  date: string;
  /** Who it was for (optional, short: "صاحبتي", "خالتي"…). */
  buyer: string;
  lines: DirectSaleLine[];
  /** What the owner paid for this sale (delivery, packaging…). */
  extraCost: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type DirectSaleMoney = { pieces: number; sales: number; productsCost: number; extraCost: number; profit: number; missingCostLines: number };

const MAX_AMOUNT = 10_000_000;
const MAX_LINES = 30;
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");
const round = (value: number) => Math.round(value * 100) / 100;
/** null = empty; undefined = not a valid amount. */
const amount = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= MAX_AMOUNT ? round(number) : undefined;
};

/**
 * Checks a direct sale from the admin. `costs` fills a missing factory cost of a store product.
 * Returns the sale, or an Arabic message saying what to fix.
 */
export function sanitizeDirectSale(
  raw: unknown,
  id: string,
  costs: Record<string, { cost: number | null } | undefined>,
  now = new Date(),
  createdAt?: string,
): { sale: DirectSale } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "البيانات مش مفهومة." };
  const value = raw as Record<string, unknown>;
  if (!isDay(value.date)) return { error: "اختاري التاريخ." };
  const rawLines = Array.isArray(value.lines) ? value.lines : [];
  if (rawLines.length === 0) return { error: "ضيفي قطعة واحدة على الأقل." };
  if (rawLines.length > MAX_LINES) return { error: `أقصى عدد ${MAX_LINES} سطر في البيعة الواحدة.` };
  const lines: DirectSaleLine[] = [];
  for (const [index, item] of rawLines.entries()) {
    const line = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const label = `سطر ${index + 1}`;
    const productId = typeof line.productId === "string" ? line.productId : "";
    const product = productId ? findProduct(productId) : undefined;
    if (productId && !product) return { error: `${label}: المنتج مش موجود في الموقع.` };
    const name = product ? product.name : text(line.name, 120);
    if (name.length < 2) return { error: `${label}: اختاري المنتج أو اكتبي اسم الحاجة.` };
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return { error: `${label}: العدد لازم يبقى رقم صحيح من ١ لـ ٥٠٠.` };
    const unitPrice = amount(line.unitPrice);
    if (unitPrice === null || unitPrice === undefined) return { error: `${label}: اكتبي سعر القطعة اللي بعتي بيه.` };
    const typedCost = amount(line.unitCost);
    if (typedCost === undefined) return { error: `${label}: سعر المصنع لازم يبقى رقم موجب أو فاضي.` };
    const unitCost = typedCost ?? (product ? costs[product.id]?.cost ?? null : null);
    lines.push({ productId: product ? product.id : "", name, quantity, unitPrice, unitCost });
  }
  const extraCost = amount(value.extraCost);
  if (extraCost === undefined) return { error: "المصاريف لازم تبقى رقم موجب أو فاضية." };
  return {
    sale: {
      id,
      date: value.date,
      buyer: text(value.buyer, 80),
      lines,
      extraCost: extraCost ?? 0,
      notes: typeof value.notes === "string" ? value.notes.replace(/\r\n?/g, "\n").trim().slice(0, 500) : "",
      createdAt: createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
}

/** What one direct sale brought: sale, factory cost, extra cost and the profit. */
export function directSaleMoney(sale: DirectSale): DirectSaleMoney {
  let pieces = 0;
  let sales = 0;
  let productsCost = 0;
  let missingCostLines = 0;
  for (const line of sale.lines) {
    pieces += line.quantity;
    sales += line.unitPrice * line.quantity;
    if (line.unitCost === null) missingCostLines += 1;
    else productsCost += line.unitCost * line.quantity;
  }
  return { pieces, sales: round(sales), productsCost: round(productsCost), extraCost: round(sale.extraCost), profit: round(sales - productsCost - sale.extraCost), missingCostLines };
}
