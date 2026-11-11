// Server-only storage for admin-added products and their photos (same Upstash Redis, no TTL).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   catalog:custom         HASH  productId → JSON CatalogProduct
//   productimg:{imageId}   STR   JSON { type, data (base64) } — the product photo, served by /api/product-images
//   catalog:soldout        SET   product IDs marked "نفدت الكمية" (built-in or added)
import { parseCustomProduct } from "./custom-products.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { setCustomProducts, setSoldOut, type CatalogProduct } from "./site-data.ts";

export const CUSTOM_PRODUCTS_TAG = "custom-products";
const PRODUCTS = () => `${keyPrefix()}catalog:custom`;
const IMAGE = (imageId: string) => `${keyPrefix()}productimg:${imageId}`;
const SOLD_OUT = () => `${keyPrefix()}catalog:soldout`;
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
    const [products, soldOut] = await Promise.all([loadCustomProducts(), loadSoldOut()]);
    cached = { at: Date.now(), products };
    setCustomProducts(products);
    setSoldOut(soldOut);
    return products;
  } catch {
    return cached?.products ?? [];
  }
}

/**
 * For store pages: read through Next's data cache (tag "custom-products", refreshed every minute and
 * immediately when the admin changes a product), so a page view costs no Redis command.
 */
export async function loadCustomProductsForPage(): Promise<{ products: CatalogProduct[]; soldOut: string[] }> {
  const url = process.env.KV_REST_API_URL?.trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return { products: [], soldOut: [] };
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
  const [products, soldOut] = await Promise.all([read(`hgetall/${encodeURIComponent(PRODUCTS())}`), read(`smembers/${encodeURIComponent(SOLD_OUT())}`)]);
  return { products: parseList(products), soldOut: Array.isArray(soldOut) ? soldOut.map(String) : [] };
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
