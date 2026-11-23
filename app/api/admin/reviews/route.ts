import { revalidateTag } from "next/cache";

import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { imagePath, imageTypeOf, newImageId } from "@/lib/custom-products";
import { RedisUnavailableError } from "@/lib/redis";
import { MAX_REVIEWS, newReview, sortReviews } from "@/lib/reviews";
import { REVIEWS_TAG, loadReviews, saveReview, saveReviews } from "@/lib/reviews-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BODY_LENGTH = 1_000_000;
const failed = (scope: string, error: unknown) => {
  console.error(`[admin] reviews ${scope} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
};
const withImage = <T extends { imageId: string }>(review: T) => ({ ...review, image: imagePath(review.imageId) });

/** Every review (hidden ones too), in the store's order. */
export async function GET(request: Request) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return denied;
  try {
    return json(200, { success: true, reviews: sortReviews(await loadReviews()).map(withImage) });
  } catch (error) {
    return failed("read", error);
  }
}

/** Adds a review. Body: { image: base64 JPEG/PNG/WebP (resized in the browser), width, height, caption?, name? }. */
export async function POST(request: Request) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return json(413, { success: false, error: { code: "TOO_LARGE", message: "الصورة كبيرة. جربي صورة تانية." } });
    body = JSON.parse(text);
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const type = imageTypeOf(body.image as string);
  if (!type) return json(400, { success: false, error: { code: "INVALID_IMAGE", message: "ارفعي صورة JPG أو PNG أو WebP." } });
  try {
    const reviews = await loadReviews();
    if (reviews.length >= MAX_REVIEWS) return json(400, { success: false, error: { code: "TOO_MANY", message: `أقصى عدد ${MAX_REVIEWS} ريفيو. امسحي القديم الأول.` } });
    // New reviews go first.
    const first = Math.min(0, ...reviews.map((review) => review.position));
    const review = newReview({ imageId: newImageId(), width: body.width, height: body.height, caption: body.caption, name: body.name, position: first - 1 });
    if (!review) return json(400, { success: false, error: { code: "INVALID_REVIEW" } });
    if (!(await saveReview(review, { type, data: body.image as string }))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    revalidateTag(REVIEWS_TAG, { expire: 0 });
    return json(200, { success: true, review: withImage(review) });
  } catch (error) {
    return failed("add", error);
  }
}

/** New order. Body: { order: [reviewId, …] } (first shown first). */
export async function PUT(request: Request) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let order: unknown;
  try {
    order = ((await request.json()) as Record<string, unknown>).order;
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  if (!Array.isArray(order)) return json(400, { success: false, error: { code: "INVALID_ORDER" } });
  try {
    const reviews = await loadReviews();
    const rank = new Map(order.filter((id): id is string => typeof id === "string").map((id, index) => [id, index]));
    const next = reviews.map((review) => ({ ...review, position: rank.get(review.id) ?? reviews.length + review.position }));
    await saveReviews(next);
    revalidateTag(REVIEWS_TAG, { expire: 0 });
    return json(200, { success: true, reviews: sortReviews(next).map(withImage) });
  } catch (error) {
    return failed("order", error);
  }
}
