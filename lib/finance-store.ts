// Server-only storage for Financial Management (same Upstash Redis, no TTL — kept until deleted).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   finance:costs      HASH  productId → JSON ProductCost (factory name + factory price per piece)
//   finance:expenses   HASH  expenseId → JSON Expense
// No customer data is stored here.
import type { Expense, ProductCost } from "./finance.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

const COSTS = () => `${keyPrefix()}finance:costs`;
const EXPENSES = () => `${keyPrefix()}finance:expenses`;

function parseHash<T>(flat: unknown): T[] {
  const list = Array.isArray(flat) ? flat : [];
  const values: T[] = [];
  for (let index = 1; index < list.length; index += 2) {
    try {
      values.push(JSON.parse(String(list[index])) as T);
    } catch {
      // Skip a corrupt entry instead of failing the whole page.
    }
  }
  return values;
}

export async function loadProductCosts(): Promise<Record<string, ProductCost>> {
  const [flat] = await redisPipeline([["HGETALL", COSTS()]], "read", 5000);
  return Object.fromEntries(parseHash<ProductCost>(flat).map((cost) => [cost.productId, cost]));
}

/** Costs of the given products only (used when an order is confirmed). Write token: called inside writes. */
export async function productCostsFor(productIds: string[]): Promise<Record<string, ProductCost>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const [values] = await redisPipeline([["HMGET", COSTS(), ...ids]], "write");
  const result: Record<string, ProductCost> = {};
  ids.forEach((id, index) => {
    const raw = (values as (string | null)[] | null)?.[index];
    if (typeof raw !== "string") return;
    try {
      result[id] = JSON.parse(raw) as ProductCost;
    } catch {
      // ignore
    }
  });
  return result;
}

/** Saves a product's factory name and cost, and reads it back before reporting success. */
export async function saveProductCost(cost: ProductCost) {
  const [, stored] = await redisPipeline([["HSET", COSTS(), cost.productId, JSON.stringify(cost)], ["HGET", COSTS(), cost.productId]], "write");
  return typeof stored === "string" ? (JSON.parse(stored) as ProductCost) : null;
}

export async function loadExpenses(): Promise<Expense[]> {
  const [flat] = await redisPipeline([["HGETALL", EXPENSES()]], "read", 5000);
  return parseHash<Expense>(flat).toSorted((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function loadExpense(id: string) {
  const [raw] = await redisPipeline([["HGET", EXPENSES(), id]], "write");
  return typeof raw === "string" ? (JSON.parse(raw) as Expense) : null;
}

/** Adds or replaces an expense, and reads it back before reporting success. */
export async function saveExpense(expense: Expense) {
  const [, stored] = await redisPipeline([["HSET", EXPENSES(), expense.id, JSON.stringify(expense)], ["HGET", EXPENSES(), expense.id]], "write");
  return typeof stored === "string" ? (JSON.parse(stored) as Expense) : null;
}

export async function deleteExpense(id: string) {
  const [removed] = await redisPipeline([["HDEL", EXPENSES(), id]], "write");
  return Number(removed) === 1;
}
