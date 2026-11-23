import { revalidateTag } from "next/cache";

import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { imagePath } from "@/lib/custom-products";
import { RedisUnavailableError } from "@/lib/redis";
import { REVIEW_ID_PATTERN, sanitizeReviewEdit } from "@/lib/reviews";
import { REVIEWS_TAG, deleteReview, loadReview, saveReview } from "@/lib/reviews-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ reviewId: string }> };
const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (scope: string, error: unknown) => {
  console.error(`[admin] review ${scope} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
};

async function guard(request: Request, context: Context) {
  const denied = await accessDenied(request, ["products"]);
  if (denied) return { response: denied };
  if (!isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  const { reviewId } = await context.params;
  if (!REVIEW_ID_PATTERN.test(reviewId)) return { response: json(404, { success: false, error: { code: "NOT_FOUND", message: "الريفيو مش موجود." } }) };
  return { reviewId };
}

/** Edits a review. Body: any of { caption, name, hidden }. */
export async function PATCH(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  try {
    const review = await loadReview(checked.reviewId);
    if (!review) return json(404, { success: false, error: { code: "NOT_FOUND", message: "الريفيو مش موجود." } });
    const next = { ...review, ...sanitizeReviewEdit(body) };
    if (!(await saveReview(next))) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    revalidateTag(REVIEWS_TAG, { expire: 0 });
    return json(200, { success: true, review: { ...next, image: imagePath(next.imageId) } });
  } catch (error) {
    return failed("edit", error);
  }
}

/** Deletes a review and its photo. */
export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    const review = await loadReview(checked.reviewId);
    if (!review) return json(200, { success: true });
    await deleteReview(review);
    revalidateTag(REVIEWS_TAG, { expire: 0 });
    return json(200, { success: true });
  } catch (error) {
    return failed("delete", error);
  }
}
