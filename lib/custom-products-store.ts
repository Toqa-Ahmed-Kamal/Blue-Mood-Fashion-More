// Server-only storage for admin-added products and their photos (same Upstash Redis, no TTL).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   catalog:custom         HASH  productId → JSON CatalogProduct
//   productimg:{imageId}   STR   JSON { type, data (base64) } — the product photo, served by /api/product-images
//   catalog:soldout        SET   product IDs marked "نفدت الكمية" (built-in or added)
//   catalog:prices         HASH  productId → selling price changed from the admin (built-in products)
//   catalog:wasprices      HASH  productId → price before the discount ("بدل كذا"), any product
import { parseCustomProduct } from "./custom-products.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { setCustomProducts, setPriceOverrides, setSoldOut, setWasPrices, type CatalogProduct } from "./site-data.ts";

export const CUSTOM_PRODUCTS_TAG = "custom-products";
const PRODUCTS = () => `${keyPrefix()}catalog:custom`;
const IMAGE = (imageId: string) => `${keyPrefix()}productimg:${imageId}`;
const SOLD_OUT = () => `${keyPrefix()}catalog:soldout`;
const PRICES = () => `${keyPrefix()}catalog:prices`;
const WAS_PRICES = () => `${keyPrefix()}catalog:wasprices`;

/** HGETALL result → { productId: price } (bad entries skipped). */
function parsePrices(flat: unknown): Record<string, number> {
  const list = Array.isArray(flat) ? flat : [];
  const prices: Record<string, number> = {};
  for (let index = 0; index + 1 < list.length; index += 2) {
    const price = Number(list[index + 1]);
    if (Number.isFinite(price) && price > 0) prices[String(list[index])] = price;
  }
  return prices;
}

export async function loadPrices(): Promise<Record<string, number>> {
  const [flat] = await redisPipeline([["HGETALL", PRICES()]], "read", 5000);
  return parsePrices(flat);
}

export async function loadWasPrices(): Promise<Record<string, number>> {
  const [flat] = await redisPipeline([["HGETALL", WAS_PRICES()]], "read", 5000);
  return parsePrices(flat);
}

/** Saves the price before the discount (null = no discount shown), then reads it back. */
export async function setProductWasPrice(productId: string, price: number | null) {
  const [, stored] = await redisPipeline([price === null ? ["HDEL", WAS_PRICES(), productId] : ["HSET", WAS_PRICES(), productId, String(price)], ["HGET", WAS_PRICES(), productId]], "write");
  cached = null;
  return stored === null || stored === undefined ? null : Number(stored);
}

/** Saves a built-in product's new selling price (null = back to the original price), then reads it back. */
export async function setProductPrice(productId: string, price: number | null) {
  const [, stored] = await redisPipeline([price === null ? ["HDEL", PRICES(), productId] : ["HSET", PRICES(), productId, String(price)], ["HGET", PRICES(), productId]], "write");
  cached = null;
  return stored === null || stored === undefined ? null : Number(stored);
}
const CACHE_MS = 30_000;

function parseList(flat: unknown): CatalogProduct[] {
  const list = Array.isArray(flat) ? flat : [];
  const products: CatalogProduct[] = [];
  for (let index = 1; index < list.length; index += 2) {
    try {
      const product = parseCustomProduct(JSON.parse(String(list[index])));
      if (product) products.push(product);
    } catch {
      // Skip a corrupt entry.
    }
  }
  return products.toSorted((a, b) => a.id.localeCompare(b.id));
}

/** Fresh read (admin, writes). */
export async function loadCustomProducts(): Promise<CatalogProduct[]> {
  const [flat] = await redisPipeline([["HGETALL", PRODUCTS()]], "read", 5000);
  return parseList(flat);
}

export async function loadSoldOut(): Promise<string[]> {
  const [members] = await redisPipeline([["SMEMBERS", SOLD_OUT()]], "read", 5000);
  return Array.isArray(members) ? members.map(String).toSorted() : [];
}

/** Marks / unmarks a product as sold out, then reads the flag back. */
export async function setProductSoldOut(productId: string, soldOut: boolean) {
  const [, member] = await redisPipeline([[soldOut ? "SADD" : "SREM", SOLD_OUT(), productId], ["SISMEMBER", SOLD_OUT(), productId]], "write");
  cached = null;
  return Number(member) === 1;
}

let cached: { at: number; products: CatalogProduct[] } | null = null;

/**
 * Makes sure this server instance's catalog includes the admin-added products (orders, tracking,
 * dashboards). Cached for 30 s per instance; a Redis problem keeps the last known list.
 */
export async function ensureCustomProducts(force = false) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.products;
  try {
    const [products, soldOut, prices, wasPrices] = await Promise.all([loadCustomProducts(), loadSoldOut(), loadPrices(), loadWasPrices()]);
    cached = { at: Date.now(), products };
    setCustomProducts(products);
    setSoldOut(soldOut);
    setPriceOverrides(prices);
    setWasPrices(wasPrices);
    return products;
  } catch {
    return cached?.products ?? [];
  }
}

/**
 * For store pages: read through Next's data cache (tag "custom-products", refreshed every minute and
 * immediately when the admin changes a product), so a page view costs no Redis command.
 */
export async function loadCustomProductsForPage(): Promise<{ products: CatalogProduct[]; soldOut: string[]; prices: Record<string, number>; wasPrices: Record<string, number> }> {
  const url = process.env.KV_REST_API_URL?.trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return { products: [], soldOut: [], prices: {}, wasPrices: {} };
  const read = async (command: string) => {
    try {
      const response = await fetch(`${url}/${command}`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 60, tags: [CUSTOM_PRODUCTS_TAG] },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return null;
      return ((await response.json()) as { result?: unknown }).result ?? null;
    } catch {
      return null;
    }
  };
  const [products, soldOut, prices, wasPrices] = await Promise.all([
    read(`hgetall/${encodeURIComponent(PRODUCTS())}`),
    read(`smembers/${encodeURIComponent(SOLD_OUT())}`),
    read(`hgetall/${encodeURIComponent(PRICES())}`),
    read(`hgetall/${encodeURIComponent(WAS_PRICES())}`),
  ]);
  return { products: parseList(products), soldOut: Array.isArray(soldOut) ? soldOut.map(String) : [], prices: parsePrices(prices), wasPrices: parsePrices(wasPrices) };
}

/** Saves a product (and its photo when given), then reads it back before reporting success. */
export async function saveCustomProduct(product: CatalogProduct, image?: { id: string; type: string; data: string }) {
  const commands: (string | number)[][] = [];
  if (image) commands.push(["SET", IMAGE(image.id), JSON.stringify({ type: image.type, data: image.data })]);
  commands.push(["HSET", PRODUCTS(), product.id, JSON.stringify(product)], ["HGET", PRODUCTS(), product.id]);
  const results = await redisPipeline(commands, "write", 8000);
  const stored = results.at(-1);
  cached = null;
  return typeof stored === "string" ? parseCustomProduct(JSON.parse(stored)) : null;
}

export async function loadCustomProduct(id: string) {
  const [raw] = await redisPipeline([["HGET", PRODUCTS(), id]], "write");
  return typeof raw === "string" ? parseCustomProduct(JSON.parse(raw)) : null;
}

export async function loadProductImage(imageId: string): Promise<{ type: string; data: Buffer } | null> {
  const [raw] = await redisPipeline([["GET", IMAGE(imageId)]], "read", 5000);
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as { type: string; data: string };
    return { type: value.type, data: Buffer.from(value.data, "base64") };
  } catch {
    return null;
  }
}
