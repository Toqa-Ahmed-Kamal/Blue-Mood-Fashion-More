// Server-only storage for Financial Management (same Upstash Redis, no TTL — kept until deleted).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   finance:costs      HASH  productId → JSON ProductCost (factory name + factory price per piece)
//   finance:expenses   HASH  expenseId → JSON Expense
//   finance:factories  SET   factory names added by the admin (DEFAULT_FACTORY is always there)
// No customer data is stored here.
import { DEFAULT_FACTORY, type Expense, type ProductCost } from "./finance.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

const COSTS = () => `${keyPrefix()}finance:costs`;
const EXPENSES = () => `${keyPrefix()}finance:expenses`;
const FACTORIES = () => `${keyPrefix()}finance:factories`;

/** Factory names: the default, every one added by the admin, and any already used on a product. */
export async function loadFactories(costs: Record<string, ProductCost> = {}) {
  const [members] = await redisPipeline([["SMEMBERS", FACTORIES()]], "read");
  const names = new Set([DEFAULT_FACTORY, ...(Array.isArray(members) ? members.map(String) : []), ...Object.values(costs).map((cost) => cost.factory).filter(Boolean)]);
  return [...names].toSorted((a, b) => (a === DEFAULT_FACTORY ? -1 : b === DEFAULT_FACTORY ? 1 : a.localeCompare(b, "ar")));
}

export async function addFactory(name: string) {
  const [, present] = await redisPipeline([["SADD", FACTORIES(), name], ["SISMEMBER", FACTORIES(), name]], "write");
  return Number(present) === 1;
}

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
