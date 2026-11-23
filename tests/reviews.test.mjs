import test from "node:test";
import assert from "node:assert/strict";

import { newReview, newReviewId, parseReview, parseReviewHash, publicReviews, sanitizeReviewEdit, sortReviews } from "../lib/reviews.ts";

const NOW = new Date("2026-11-23T10:00:00.000Z");

test("a new review: valid photo id, cleaned text, sizes kept in range", () => {
  const review = newReview({ imageId: "img-abc12345", width: 1080, height: 2400, caption: "  البيجامة   تجنن  ", name: "منى", position: -1 }, NOW, "rv-abc12345");
  assert.deepEqual(review, { id: "rv-abc12345", imageId: "img-abc12345", width: 1080, height: 2400, caption: "البيجامة تجنن", name: "منى", hidden: false, position: -1, createdAt: NOW.toISOString() });
  assert.equal(newReview({ imageId: "../etc", width: 1, height: 1, position: 0 }, NOW), null);
  assert.equal(newReview({ imageId: "img-abc12345", width: 9, height: "x", position: 0 }, NOW, "rv-abc12345").width, 800, "bad size → default");
  assert.match(newReviewId(), /^rv-[a-z\d]{8,40}$/);
});

test("stored reviews: bad records are dropped; the store gets visible ones in order with the photo URL", () => {
  const a = newReview({ imageId: "img-aaaaaaaa", width: 800, height: 1000, position: 2 }, NOW, "rv-aaaaaaaa");
  const b = { ...newReview({ imageId: "img-bbbbbbbb", width: 800, height: 1000, position: 1 }, NOW, "rv-bbbbbbbb"), caption: "حلوة" };
  const hidden = { ...newReview({ imageId: "img-cccccccc", width: 800, height: 1000, position: 0 }, NOW, "rv-cccccccc"), hidden: true };
  const flat = ["rv-aaaaaaaa", JSON.stringify(a), "rv-bbbbbbbb", JSON.stringify(b), "rv-cccccccc", JSON.stringify(hidden), "rv-bad00000", "{", "rv-x", JSON.stringify({ ...a, id: "nope" })];
  const reviews = parseReviewHash(flat);
  assert.equal(reviews.length, 3);
  assert.deepEqual(sortReviews(reviews).map((review) => review.id), ["rv-cccccccc", "rv-bbbbbbbb", "rv-aaaaaaaa"]);
  assert.deepEqual(publicReviews(reviews), [
    { id: "rv-bbbbbbbb", image: "/api/product-images/img-bbbbbbbb", width: 800, height: 1000, caption: "حلوة", name: "" },
    { id: "rv-aaaaaaaa", image: "/api/product-images/img-aaaaaaaa", width: 800, height: 1000, caption: "", name: "" },
  ]);
  assert.equal(parseReview(JSON.stringify({ ...a, imageId: "img-../../x" })), null);
  assert.deepEqual(parseReviewHash(null), []);
});

test("edits: only caption, name, hidden and position; text is cleaned and cut", () => {
  assert.deepEqual(sanitizeReviewEdit({ caption: "x".repeat(300), name: " هالة ", hidden: true, imageId: "img-evil0000", id: "rv-other000" }), { caption: "x".repeat(160), name: "هالة", hidden: true });
  assert.deepEqual(sanitizeReviewEdit({ hidden: "yes" }), {});
  assert.deepEqual(sanitizeReviewEdit(null), {});
});
