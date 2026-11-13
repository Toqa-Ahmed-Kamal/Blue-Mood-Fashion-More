// Server-only storage for the inventory (same Upstash Redis, no TTL — kept until deleted).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   inventory:moves   HASH  moveId → JSON StockMove (counts, arrivals, adjustments). No customer data.
import type { StockMove } from "./inventory.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

const MOVES = () => `${keyPrefix()}inventory:moves`;

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
