import test from "node:test";
import assert from "node:assert/strict";

import { buildPiecesReport } from "../lib/piece-analytics.ts";
import { buildStock } from "../lib/inventory.ts";

const A = "bm-robe-003";
const B = "bm-robe-004";
function site(orderId, day, status, lines) {
  return { orderId, createdAt: `${day}T10:00:00.000Z`, day, subtotal: 0, shippingCost: null, total: null, governorate: "", offerName: "", products: lines.map(([modelId, quantity]) => ({ modelId, category: "robes", quantity })), firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: null, confirmedValue: null, soldAt: `${day}T12:00:00.000Z` };
}
const sale = (id, date, lines, kind = "sale") => ({ id, kind, date, buyer: "", lines: lines.map(([productId, quantity]) => ({ productId, name: productId, quantity, unitPrice: kind === "sale" ? 250 : 0, unitCost: 100 })), extraCost: 0, notes: "", createdAt: `${date}T13:00:00.000Z`, updatedAt: `${date}T13:00:00.000Z` });
const move = (id, productId, kind, quantity, at) => ({ id, productId, kind, quantity, at, note: "" });

test("pieces: out / in / left, best seller first, months and categories", () => {
  const live = [
    site("BM-AAAAAAAAAAAAAAAAAAA1", "2026-10-05", "delivered", [[A, 3], [B, 1]]),
    site("BM-AAAAAAAAAAAAAAAAAAA2", "2026-11-02", "confirmed", [[A, 2]]),
    site("BM-AAAAAAAAAAAAAAAAAAA3", "2026-11-03", "returned", [[B, 2]]),
    site("BM-AAAAAAAAAAAAAAAAAAA4", "2026-11-04", "submitted", [[B, 1]]),
    site("BM-AAAAAAAAAAAAAAAAAAA5", "2026-11-04", "cancelled", [[A, 5]]),
  ];
  const direct = [sale("d1", "2026-11-05", [[B, 1]]), sale("p1", "2026-11-06", [[A, 1]], "personal")];
  const moves = [move("m1", A, "count", 20, "2026-10-01T09:00:00.000Z"), move("m2", A, "count", 18, "2026-10-20T09:00:00.000Z"), move("m3", A, "arrival", 5, "2026-11-01T09:00:00.000Z")];
  const stock = buildStock({ productIds: [A, B], moves, live, old: [], direct });
  const report = buildPiecesReport({ live, old: [], direct, moves, stock });
  const { totals } = report;
  assert.deepEqual([totals.sold, totals.soldOnline, totals.soldDirect, totals.personal, totals.out, totals.delivered, totals.returned, totals.waiting], [7, 6, 1, 1, 8, 4, 2, 1]);
  assert.equal(totals.cameIn, 25, "first count 20 + arrival 5 (the second count is a correction)");
  assert.equal(totals.left, 20, "A: 18 + 5 − 2 − 1 = 20 (October order is before the second count)");
  assert.deepEqual(report.products.map((row) => [row.productId, row.sold, row.orders]), [[A, 5, 2], [B, 2, 1]]);
  assert.equal(report.products[0].share, 5 / 7);
  assert.deepEqual(report.months, [{ month: "2026-10", sold: 4 }, { month: "2026-11", sold: 3 }]);
  assert.deepEqual(report.categories.map((row) => [row.category, row.sold]), [["robes", 7]]);

  const november = buildPiecesReport({ live, old: [], direct, moves, stock, from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual([november.totals.sold, november.totals.cameIn, november.totals.left], [3, 5, 20], "left is now, not limited by the dates");
  const december = buildPiecesReport({ live, old: [], direct, moves, stock, from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(december.still, [{ productId: A, name: "روب فرو بطبعة نمر", stock: 20 }], "in stock, nothing sold");
});
