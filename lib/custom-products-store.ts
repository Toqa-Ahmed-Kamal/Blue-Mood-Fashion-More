// Server-only storage for admin-added products and their photos (same Upstash Redis, no TTL).
//
// Keys (prefix bm:{prod|preview|dev}:v1:)
//   catalog:custom         HASH  productId → JSON CatalogProduct
//   productimg:{imageId}   STR   JSON { type, data (base64) } — the product photo, served by /api/product-images
import { parseCustomProduct } from "./custom-products.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";
import { setCustomProducts, type CatalogProduct } from "./site-data.ts";

export const CUSTOM_PRODUCTS_TAG = "custom-products";
const PRODUCTS = () => `${keyPrefix()}catalog:custom`;
const IMAGE = (imageId: string) => `${keyPrefix()}productimg:${imageId}`;
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

let cached: { at: number; products: CatalogProduct[] } | null = null;

/**
 * Makes sure this server instance's catalog includes the admin-added products (orders, tracking,
 * dashboards). Cached for 30 s per instance; a Redis problem keeps the last known list.
 */
export async function ensureCustomProducts(force = false) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.products;
  try {
    const products = await loadCustomProducts();
    cached = { at: Date.now(), products };
    setCustomProducts(products);
    return products;
  } catch {
    return cached?.products ?? [];
  }
}

/**
 * For store pages: read through Next's data cache (tag "custom-products", refreshed every minute and
 * immediately when the admin changes a product), so a page view costs no Redis command.
 */
export async function loadCustomProductsForPage(): Promise<CatalogProduct[]> {
  const url = process.env.KV_REST_API_URL?.trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return [];
  try {
    const response = await fetch(`${url}/hgetall/${encodeURIComponent(PRODUCTS())}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 60, tags: [CUSTOM_PRODUCTS_TAG] },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { result?: unknown };
    return parseList(body.result);
  } catch {
    return [];
  }
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
