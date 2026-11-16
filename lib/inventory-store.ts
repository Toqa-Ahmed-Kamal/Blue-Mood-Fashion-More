// Server-only storage for the inventory (same Upstash Redis, no TTL — kept until deleted).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   inventory:moves   HASH  moveId → JSON StockMove (counts, arrivals, adjustments). No customer data.
//   inventory:target  STR   JSON StockTarget ("عندي كذا قطعة" and when it was set)
import type { StockMove, StockTarget } from "./inventory.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

const MOVES = () => `${keyPrefix()}inventory:moves`;
const TARGET = () => `${keyPrefix()}inventory:target`;
/** HASH productId → pieces sold before the system (typed in by the owner; shown to customers only). */
const SOLD_BEFORE = () => `${keyPrefix()}catalog:soldbefore`;

export async function loadSoldBefore(): Promise<Record<string, number>> {
  const [flat] = await redisPipeline([["HGETALL", SOLD_BEFORE()]], "read", 5000);
  const list = Array.isArray(flat) ? flat : [];
  const result: Record<string, number> = {};
  for (let index = 0; index + 1 < list.length; index += 2) {
    const count = Number(list[index + 1]);
    if (Number.isInteger(count) && count > 0) result[String(list[index])] = count;
  }
  return result;
}

/** Saves the number (0 / null = remove it), then reads it back. */
export async function saveSoldBefore(productId: string, count: number | null) {
  const [, stored] = await redisPipeline([count ? ["HSET", SOLD_BEFORE(), productId, String(count)] : ["HDEL", SOLD_BEFORE(), productId], ["HGET", SOLD_BEFORE(), productId]], "write");
  return stored === null || stored === undefined ? 0 : Number(stored);
}

export async function loadStockTarget(): Promise<StockTarget | null> {
  const [raw] = await redisPipeline([["GET", TARGET()]], "read", 5000);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as StockTarget;
  } catch {
    return null;
  }
}

/** Saves the total (null = remove it), then reads it back. */
export async function saveStockTarget(target: StockTarget | null) {
  const [, stored] = await redisPipeline([target ? ["SET", TARGET(), JSON.stringify(target)] : ["DEL", TARGET()], ["GET", TARGET()]], "write");
  return typeof stored === "string" ? (JSON.parse(stored) as StockTarget) : null;
}

export async function loadStockMoves(): Promise<StockMove[]> {
  const [flat] = await redisPipeline([["HGETALL", MOVES()]], "read", 5000);
  const list = Array.isArray(flat) ? flat : [];
  const moves: StockMove[] = [];
  for (let index = 1; index < list.length; index += 2) {
    try {
      moves.push(JSON.parse(String(list[index])) as StockMove);
    } catch {
      // Skip a corrupt entry instead of failing the whole page.
    }
  }
  return moves.toSorted((a, b) => b.at.localeCompare(a.at));
}

/** Saves a move and reads it back before reporting success. */
export async function saveStockMove(move: StockMove) {
  const [, stored] = await redisPipeline([["HSET", MOVES(), move.id, JSON.stringify(move)], ["HGET", MOVES(), move.id]], "write");
  return typeof stored === "string" ? (JSON.parse(stored) as StockMove) : null;
}

export async function deleteStockMove(id: string) {
  const [removed] = await redisPipeline([["HDEL", MOVES(), id]], "write");
  return Number(removed) === 1;
}
