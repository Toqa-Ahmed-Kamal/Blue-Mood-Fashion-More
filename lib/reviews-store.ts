// Storage for customer reviews (server only). One Redis hash (reviews) — field = review id, value = JSON;
// the photo is kept with the product photos (productimg:<id>) so /api/product-images serves it.
import { keyPrefix, redisPipeline } from "./redis.ts";
import { parseReviewHash, publicReviews, type PublicReview, type Review } from "./reviews.ts";

export const REVIEWS_TAG = "reviews";
const REVIEWS = () => `${keyPrefix()}reviews`;
const IMAGE = (imageId: string) => `${keyPrefix()}productimg:${imageId}`;

export async function loadReviews(): Promise<Review[]> {
  const [flat] = await redisPipeline([["HGETALL", REVIEWS()]], "write", 5000);
  return parseReviewHash(flat);
}

export async function loadReview(id: string): Promise<Review | null> {
  const [raw] = await redisPipeline([["HGET", REVIEWS(), id]], "write");
  return parseReviewHash(typeof raw === "string" ? [id, raw] : null)[0] ?? null;
}

/** Saves a review (and its photo when given), then reads it back before reporting success. */
export async function saveReview(review: Review, image?: { type: string; data: string }) {
  const value = JSON.stringify(review);
  const commands: (string | number)[][] = [];
  if (image) commands.push(["SET", IMAGE(review.imageId), JSON.stringify(image)]);
  commands.push(["HSET", REVIEWS(), review.id, value], ["HGET", REVIEWS(), review.id]);
  const results = await redisPipeline(commands, "write", 8000);
  return results.at(-1) === value;
}

/** Saves several reviews at once (new order). */
export async function saveReviews(reviews: Review[]) {
  if (reviews.length === 0) return true;
  const flat = reviews.flatMap((review) => [review.id, JSON.stringify(review)]);
  await redisPipeline([["HSET", REVIEWS(), ...flat]], "write", 5000);
  return true;
}

export async function deleteReview(review: Review) {
  const [removed] = await redisPipeline([["HDEL", REVIEWS(), review.id], ["DEL", IMAGE(review.imageId)]], "write");
  return Number(removed) === 1;
}

/** Visible reviews for the store page: cached, refreshed every minute and right after a dashboard change. */
export async function loadReviewsForPage(): Promise<PublicReview[]> {
  const url = process.env.KV_REST_API_URL?.trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return [];
  try {
    const response = await fetch(`${url}/hgetall/${encodeURIComponent(REVIEWS())}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 60, tags: [REVIEWS_TAG] },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    return publicReviews(parseReviewHash(((await response.json()) as { result?: unknown }).result ?? null));
  } catch {
    return [];
  }
}
