// Customer reviews shown on the store (screenshots the owner uploads from the dashboard). Pure and tested;
// storage is lib/reviews-store.ts.
//
// - Each review is one photo (a chat screenshot or a customer's own photo), with an optional short caption
//   and the customer's first name. The owner can hide a review without deleting it and set the order.
// - The photo is stored like an added product's photo and served from /api/product-images/<id>.
import { IMAGE_ID_PATTERN, imagePath } from "./custom-products.ts";

export const MAX_REVIEWS = 60;
export const REVIEW_ID_PATTERN = /^rv-[a-z\d]{8,40}$/;

export type Review = {
  id: string;
  imageId: string;
  /** Photo size in pixels (for the layout before it loads). */
  width: number;
  height: number;
  caption: string;
  name: string;
  hidden: boolean;
  /** Lower first. */
  position: number;
  createdAt: string;
};

/** What the store page gets: visible reviews only, in order, with the photo URL. */
export type PublicReview = { id: string; image: string; width: number; height: number; caption: string; name: string };

export function newReviewId(now = Date.now(), random = Math.random()) {
  return `rv-${now.toString(36)}${Math.floor(random * 36 ** 6).toString(36).padStart(6, "0")}`;
}

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");
const side = (value: unknown) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 50 && number <= 5000 ? number : null;
};

/** The owner's editable fields: caption, name, hidden, position. */
export function sanitizeReviewEdit(value: unknown): Partial<Pick<Review, "caption" | "name" | "hidden" | "position">> {
  if (typeof value !== "object" || value === null) return {};
  const item = value as Record<string, unknown>;
  const edit: Partial<Pick<Review, "caption" | "name" | "hidden" | "position">> = {};
  if (item.caption !== undefined) edit.caption = text(item.caption, 160);
  if (item.name !== undefined) edit.name = text(item.name, 40);
  if (typeof item.hidden === "boolean") edit.hidden = item.hidden;
  if (item.position !== undefined && Number.isFinite(Number(item.position))) edit.position = Math.round(Number(item.position));
  return edit;
}

/** A stored review, or null when it is not valid. */
export function parseReview(raw: unknown): Review | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !REVIEW_ID_PATTERN.test(item.id)) return null;
  if (typeof item.imageId !== "string" || !IMAGE_ID_PATTERN.test(item.imageId)) return null;
  return {
    id: item.id,
    imageId: item.imageId,
    width: side(item.width) ?? 800,
    height: side(item.height) ?? 1000,
    caption: text(item.caption, 160),
    name: text(item.name, 40),
    hidden: item.hidden === true,
    position: Number.isFinite(Number(item.position)) ? Math.round(Number(item.position)) : 0,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
  };
}

/** A new review from the owner's upload (the photo itself is checked separately). */
export function newReview(input: { imageId: string; width: unknown; height: unknown; caption?: unknown; name?: unknown; position: number }, now = new Date(), id = newReviewId(now.getTime())): Review | null {
  if (!IMAGE_ID_PATTERN.test(input.imageId)) return null;
  return {
    id,
    imageId: input.imageId,
    width: side(input.width) ?? 800,
    height: side(input.height) ?? 1000,
    caption: text(input.caption, 160),
    name: text(input.name, 40),
    hidden: false,
    position: input.position,
    createdAt: now.toISOString(),
  };
}

export const sortReviews = (reviews: Review[]) => reviews.toSorted((a, b) => a.position - b.position || b.createdAt.localeCompare(a.createdAt));

/** Visible reviews for the store, in the owner's order. */
export function publicReviews(reviews: Review[]): PublicReview[] {
  return sortReviews(reviews)
    .filter((review) => !review.hidden)
    .map((review) => ({ id: review.id, image: imagePath(review.imageId), width: review.width, height: review.height, caption: review.caption, name: review.name }));
}

/** Parses an HGETALL result (flat [field, value, …]) into reviews, skipping bad records. */
export function parseReviewHash(flat: unknown): Review[] {
  if (!Array.isArray(flat)) return [];
  const reviews: Review[] = [];
  for (let index = 1; index < flat.length; index += 2) {
    const review = parseReview(flat[index]);
    if (review) reviews.push(review);
  }
  return reviews;
}
