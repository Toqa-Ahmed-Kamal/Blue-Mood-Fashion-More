// Financial Management (الإدارة المالية): product factory costs, expenses and the profit report.
// Pure (no I/O) and tested; storage is lib/finance-store.ts.
//
// Rules (agreed with the store owner)
// - Sales = what confirmed orders brought in: the collected amount when it was entered, else the
//   order total (shipping paid by the customer included). The store's own courier cost is an expense.
// - Products cost = pieces in confirmed orders × the factory cost saved when the order was confirmed.
//   An order confirmed before its cost was known uses today's factory cost and is marked estimated.
// - Cancelled and returned orders are neither sales nor products cost. Return shipping is entered as
//   its own expense, so nothing is deducted twice.
// - Each order counts once: an imported Telegram order that is also a site order is the site order.
// - Net profit = sales − products cost − expenses, all in EGP, for the chosen dates.
import { confirmedValueOf, isSaleStatus, type AnalyticsOrder, type CostSnapshot, type OrderStatus } from "./analytics-report.ts";
import { oldOrderValue, type OldOrder } from "./old-orders.ts";
import { catalog, landingPromotion } from "./site-data.ts";

/** Factory of every product that has none saved yet (all products at launch come from it). */
export const DEFAULT_FACTORY = "مصنع القاهرة";

export const EXPENSE_CATEGORIES = [
  { id: "stock-purchase", label: "شراء بضاعة من المصنع (منتجات)" },
  { id: "factory-shipping", label: "شحن من المصنع" },
  { id: "order-shipping", label: "شحن الأوردرات للعميلات (شركة الشحن)" },
  { id: "returns-shipping", label: "شحن المرتجعات" },
  { id: "ads", label: "إعلانات" },
  { id: "packaging", label: "تغليف" },
  { id: "photography", label: "تصوير" },
  { id: "other", label: "مصروفات أخرى" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];

/**
 * Paying the factory for stock is recorded and shown on its own but NOT deducted from net profit:
 * the factory cost of every piece sold is already deducted (products cost), so deducting the stock
 * purchase too would count the same goods twice.
 */
export const NOT_DEDUCTED_CATEGORIES: readonly ExpenseCategory[] = ["stock-purchase"];

export type ProductCost = {
  productId: string;
  factory: string;
  /** Factory price of one piece in EGP; null when not entered yet. */
  cost: number | null;
  updatedAt: string;
};

export type Expense = {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  /** YYYY-MM-DD (Cairo). */
  date: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_AMOUNT = 10_000_000;
const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");
const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= MAX_AMOUNT ? Math.round(number * 100) / 100 : undefined;
};

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return EXPENSE_CATEGORIES.some((category) => category.id === value);
}

export function isCatalogProductId(value: unknown): value is string {
  return typeof value === "string" && catalog.some((product) => product.id === value);
}

/** Checks a factory name + cost from the admin. null when invalid. */
export function sanitizeProductCost(productId: string, raw: unknown, now = new Date()): ProductCost | null {
  if (!isCatalogProductId(productId) || typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const cost = money(value.cost);
  if (cost === undefined) return null;
  return { productId, factory: text(value.factory, 120), cost, updatedAt: now.toISOString() };
}

/** Checks an expense from the admin. null when invalid (name, category, amount > 0 and date are required). */
export function sanitizeExpense(raw: unknown, id: string, now = new Date(), createdAt?: string): Expense | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const name = text(value.name, 120);
  const amount = money(value.amount);
  if (!name || !isExpenseCategory(value.category) || !amount || !isDay(value.date)) return null;
  return {
    id,
    name,
    category: value.category,
    amount,
    date: value.date,
    notes: typeof value.notes === "string" ? value.notes.replace(/\r\n?/g, "\n").trim().slice(0, 500) : "",
    createdAt: createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Unit costs of an order's lines right now (null where no cost is entered). */
export function snapshotCosts(productIds: string[], costs: Record<string, ProductCost | undefined>, now = new Date()): CostSnapshot {
  return { unitCosts: productIds.map((id) => costs[id]?.cost ?? null), at: now.toISOString() };
}

const cairoDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso));

export type CostState = "exact" | "estimated" | "missing";

export type FinanceOrderRow = {
  orderId: string;
  source: "site" | "telegram";
  day: string;
  status: OrderStatus;
  pieces: number;
  /** Sale value (0 for returned orders, which are not sales). */
  sales: number;
  productsCost: number;
  profit: number;
  /** exact = every line has its confirmation cost; estimated = at least one line uses today's cost; missing = at least one line has no cost at all. */
  costState: CostState;
  /** Lines without any cost (not added to products cost). */
  missingLines: number;
};

export type FinanceReport = {
  range: { from: string | null; to: string | null };
  /** expenses = deducted expenses only; stockPurchases = factory stock payments (recorded, not deducted). */
  totals: { sales: number; productsCost: number; expenses: number; stockPurchases: number; netProfit: number };
  counts: { confirmedOrders: number; returnedOrders: number; estimatedOrders: number; missingCostOrders: number; expenses: number };
  /** Value of returned orders (information only, not deducted anywhere). */
  returnedValue: number;
  expensesByCategory: { category: ExpenseCategory; label: string; amount: number }[];
  orders: FinanceOrderRow[];
};

type OrderLine = { productId: string; quantity: number };
type Normalized = { orderId: string; source: "site" | "telegram"; day: string; status: OrderStatus; value: number; lines: OrderLine[]; snapshot?: CostSnapshot };

const round = (value: number) => Math.round(value * 100) / 100;

export function buildFinanceReport(input: {
  live: AnalyticsOrder[];
  old: OldOrder[];
  costs: Record<string, ProductCost | undefined>;
  expenses: Expense[];
  from?: string | null;
  to?: string | null;
}): FinanceReport {
  const from = isDay(input.from) ? input.from : null;
  const to = isDay(input.to) ? input.to : null;
  const inRange = (day: string) => (!from || day >= from) && (!to || day <= to);

  const siteIds = new Set(input.live.map((order) => order.orderId));
  const seenOld = new Set<string>();
  const orders: Normalized[] = [
    ...input.live.map((order) => ({
      orderId: order.orderId,
      source: "site" as const,
      day: order.day,
      status: order.status,
      value: confirmedValueOf(order),
      lines: order.products.map((product) => ({ productId: product.modelId, quantity: product.quantity })),
      snapshot: order.costSnapshot,
    })),
    ...input.old.flatMap((order) => {
      if (siteIds.has(order.orderId) || seenOld.has(order.orderId)) return [];
      seenOld.add(order.orderId);
      return [{
        orderId: order.orderId,
        source: "telegram" as const,
        day: cairoDay(order.createdAt),
        status: order.status,
        value: oldOrderValue(order),
        lines: order.products.map((product) => ({ productId: product.modelId, quantity: product.quantity })),
        snapshot: order.costSnapshot,
      }];
    }),
  ];

  const rows: FinanceOrderRow[] = [];
  let sales = 0;
  let productsCost = 0;
  let returnedValue = 0;
  for (const order of orders) {
    if (!inRange(order.day) || (!isSaleStatus(order.status) && order.status !== "returned")) continue;
    const pieces = order.lines.reduce((sum, line) => sum + line.quantity, 0);
    if (order.status === "returned") {
      returnedValue += order.value;
      rows.push({ orderId: order.orderId, source: order.source, day: order.day, status: order.status, pieces, sales: 0, productsCost: 0, profit: 0, costState: "exact", missingLines: 0 });
      continue;
    }
    let cost = 0;
    let estimated = false;
    let missingLines = 0;
    order.lines.forEach((line, index) => {
      const saved = order.snapshot?.unitCosts[index];
      if (typeof saved === "number") {
        cost += saved * line.quantity;
        return;
      }
      const today = input.costs[line.productId]?.cost;
      if (typeof today === "number") {
        cost += today * line.quantity;
        estimated = true;
      } else {
        missingLines += 1;
      }
    });
    cost = round(cost);
    sales += order.value;
    productsCost += cost;
    rows.push({
      orderId: order.orderId,
      source: order.source,
      day: order.day,
      status: order.status,
      pieces,
      sales: order.value,
      productsCost: cost,
      profit: round(order.value - cost),
      costState: missingLines > 0 ? "missing" : estimated ? "estimated" : "exact",
      missingLines,
    });
  }

  const expenses = input.expenses.filter((expense) => inRange(expense.date));
  const deducted = expenses.filter((expense) => !NOT_DEDUCTED_CATEGORIES.includes(expense.category));
  const expensesTotal = round(deducted.reduce((sum, expense) => sum + expense.amount, 0));
  const stockPurchases = round(expenses.filter((expense) => NOT_DEDUCTED_CATEGORIES.includes(expense.category)).reduce((sum, expense) => sum + expense.amount, 0));
  const confirmed = rows.filter((row) => isSaleStatus(row.status));
  return {
    range: { from, to },
    totals: { sales: round(sales), productsCost: round(productsCost), expenses: expensesTotal, stockPurchases, netProfit: round(sales - productsCost - expensesTotal) },
    counts: {
      confirmedOrders: confirmed.length,
      returnedOrders: rows.length - confirmed.length,
      estimatedOrders: confirmed.filter((row) => row.costState === "estimated").length,
      missingCostOrders: confirmed.filter((row) => row.costState === "missing").length,
      expenses: expenses.length,
    },
    returnedValue: round(returnedValue),
    expensesByCategory: EXPENSE_CATEGORIES.map((category) => ({
      category: category.id,
      label: category.label,
      amount: round(expenses.filter((expense) => expense.category === category.id).reduce((sum, expense) => sum + expense.amount, 0)),
    })),
    orders: rows.toSorted((a, b) => b.day.localeCompare(a.day) || a.orderId.localeCompare(b.orderId)),
  };
}

// ── Pricing calculator ──────────────────────────────────────────────────────

/** Price of one piece inside the winter offer (offer price ÷ pieces in the offer). */
export const OFFER_PIECE_PRICE = Math.round(landingPromotion.price / (landingPromotion.options[0].pajamaCount + landingPromotion.options[0].wearableBlanketCount));

export type PricingInput = {
  /** Expenses to spread over the pieces (EGP). */
  expenses: number;
  /** Pieces the expenses are spread over (sold, or expected to sell, in the same period). */
  pieces: number;
  /** Wanted profit, % added on top of the full cost of a piece. */
  profitPercent: number;
};

export type PricingRow = {
  productId: string;
  name: string;
  cost: number;
  /** Share of the expenses carried by one piece. */
  expenseShare: number;
  fullCost: number;
  /** Current price of one piece (the offer's per-piece price for offer-only products). */
  currentPrice: number;
  inOfferOnly: boolean;
  currentProfit: number;
  /** Current profit as % of the full cost. */
  currentProfitPercent: number;
  /** Price that gives the wanted profit, rounded up to 5 EGP. */
  suggestedPrice: number;
};

const roundUpTo5 = (value: number) => Math.ceil(value / 5) * 5;

/** For every product with a factory cost: what one piece really costs with its share of the expenses, and the price for the wanted profit. */
export function pricingRows(products: { productId: string; name: string; cost: number | null; salePrice: number | null }[], input: PricingInput): PricingRow[] {
  const share = input.pieces > 0 && input.expenses > 0 ? input.expenses / input.pieces : 0;
  const percent = Number.isFinite(input.profitPercent) ? Math.max(0, input.profitPercent) : 0;
  return products.flatMap((product) => {
    if (product.cost === null) return [];
    const fullCost = round(product.cost + share);
    const currentPrice = product.salePrice ?? OFFER_PIECE_PRICE;
    const currentProfit = round(currentPrice - fullCost);
    return [{
      productId: product.productId,
      name: product.name,
      cost: product.cost,
      expenseShare: round(share),
      fullCost,
      currentPrice,
      inOfferOnly: product.salePrice === null,
      currentProfit,
      currentProfitPercent: fullCost > 0 ? Math.round((currentProfit / fullCost) * 1000) / 10 : 0,
      suggestedPrice: roundUpTo5(fullCost * (1 + percent / 100)),
    }];
  });
}
