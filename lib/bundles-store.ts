// Server-only storage for bundles (عروض).
//   catalog:bundles   HASH  bundleId → JSON Bundle
import { parseBundle, type Bundle } from "./bundles.ts";
import { keyPrefix, redisPipeline } from "./redis.ts";

export const BUNDLES = () => `${keyPrefix()}catalog:bundles`;

/** HGETALL result → bundles (bad entries skipped), newest first. */
export function parseBundles(flat: unknown): Bundle[] {
  const list = Array.isArray(flat) ? flat : [];
  const bundles: Bundle[] = [];
  for (let index = 1; index < list.length; index += 2) {
    try {
      const bundle = parseBundle(JSON.parse(String(list[index])));
      if (bundle) bundles.push(bundle);
    } catch {
      // Skip a corrupt entry.
    }
  }
  return bundles.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadBundles(): Promise<Bundle[]> {
  const [flat] = await redisPipeline([["HGETALL", BUNDLES()]], "read", 5000);
  return parseBundles(flat);
}

export async function loadBundle(id: string): Promise<Bundle | null> {
  const [raw] = await redisPipeline([["HGET", BUNDLES(), id]], "write");
  try {
    return typeof raw === "string" ? parseBundle(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Saves a bundle, then reads it back. */
export async function saveBundle(bundle: Bundle) {
  const [, stored] = await redisPipeline([["HSET", BUNDLES(), bundle.id, JSON.stringify(bundle)], ["HGET", BUNDLES(), bundle.id]], "write");
  return typeof stored === "string" ? parseBundle(JSON.parse(stored)) : null;
}

export async function deleteBundle(id: string) {
  const [removed] = await redisPipeline([["HDEL", BUNDLES(), id]], "write");
  return Number(removed) === 1;
}
