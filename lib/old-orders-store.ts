// Server-only storage for Old Orders (orders imported from the Telegram chat export).
//
// Key (prefix bm:{prod|preview|dev}:v1:)
//   oldorders   HASH  orderId → OldOrder, AES-256-GCM encrypted with ORDER_DATA_KEY (AAD "old:<orderId>"). No TTL:
//                     the admin keeps, archives or deletes them.
// Personal data is never stored in plain text: without ORDER_DATA_KEY nothing is imported.
import { backfillOrderDetails } from "./analytics-store.ts";
import { oldOrderToDetails, type OldOrder } from "./old-orders.ts";
import { openRecord, sealOrderDetails, sealRecord } from "./order-vault.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

const HASH = () => `${keyPrefix()}oldorders`;
const aad = (orderId: string) => `old:${orderId}`;

export class VaultNotConfiguredError extends Error {
  constructor() {
    super("ORDER_DATA_KEY_MISSING");
    this.name = "VaultNotConfiguredError";
  }
}

function seal(order: OldOrder) {
  const sealed = sealRecord(aad(order.orderId), order);
  if (!sealed) throw new VaultNotConfiguredError();
  return sealed;
}

function open(orderId: string, sealed: unknown) {
  if (typeof sealed !== "string") return null;
  const order = openRecord<OldOrder>(aad(orderId), sealed);
  return order && order.orderId === orderId ? order : null;
}

/** Every saved old order (decrypted). `unreadable` counts entries the current key cannot open. */
export async function loadOldOrders(): Promise<{ orders: OldOrder[]; unreadable: number }> {
  const [flat] = await redisPipeline([["HGETALL", HASH()]], "read", 8000);
  const orders: OldOrder[] = [];
  let unreadable = 0;
  const list = Array.isArray(flat) ? flat : [];
  for (let index = 0; index + 1 < list.length; index += 2) {
    const order = open(String(list[index]), list[index + 1]);
    if (order) orders.push(order);
    else unreadable += 1;
  }
  return { orders: orders.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)), unreadable };
}

export async function loadOldOrder(orderId: string) {
  const [sealed] = await redisPipeline([["HGET", HASH(), orderId]], "read");
  return open(orderId, sealed);
}

/**
 * Saves new orders only: an order ID that is already saved is skipped (HSETNX), so importing the
 * same export twice never duplicates anything. Dashboard orders with the same ID that have no
 * customer details get them filled in from the message.
 */
export async function importOldOrders(orders: OldOrder[]) {
  if (orders.length === 0) return { imported: [] as string[], duplicates: [] as string[], backfilled: [] as string[] };
  const sealed = orders.map(seal);
  const results = await redisPipeline(orders.map((order, index) => ["HSETNX", HASH(), order.orderId, sealed[index]]), "write", 8000);
  const imported = orders.filter((_, index) => Number(results[index]) === 1).map((order) => order.orderId);
  const duplicates = orders.filter((_, index) => Number(results[index]) !== 1).map((order) => order.orderId);

  const details = orders.flatMap((order) => {
    const view = oldOrderToDetails(order);
    const sealedDetails = view ? sealOrderDetails(view) : null;
    return sealedDetails ? [{ orderId: order.orderId, sealed: sealedDetails }] : [];
  });
  const backfilled = await backfillOrderDetails(details);
  return { imported, duplicates, backfilled };
}

/** Replaces a saved order (edit, status, archive). null when it does not exist. */
export async function updateOldOrder(order: OldOrder) {
  const [exists] = await redisPipeline([["HEXISTS", HASH(), order.orderId]], "write");
  if (Number(exists) !== 1) return null;
  await redisPipeline([["HSET", HASH(), order.orderId, seal(order)]], "write");
  return order;
}

export async function deleteOldOrder(orderId: string) {
  const [removed] = await redisPipeline([["HDEL", HASH(), orderId]], "write");
  return Number(removed) === 1;
}
