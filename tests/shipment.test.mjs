import test from "node:test";
import assert from "node:assert/strict";
import { setPriceClock } from "../lib/site-data.ts";

setPriceClock(() => Date.parse("2026-11-20T12:00:00+02:00"));

import { mergeAllOrders } from "../lib/all-orders.ts";
import { buildFinanceReport, orderFinance } from "../lib/finance.ts";
import { chargesTotal, companyTotals, knownCompanies, sameCompany, sanitizeCourierCompany, sanitizeShipment, shipStage, shipmentMoney } from "../lib/shipment.ts";

const ABAYA = "bm-abaya-002";
const products = [{ modelId: ABAYA, category: "abayas", quantity: 2, fit: "" }];
function site(orderId, status, extra = {}) {
  return { orderId, createdAt: "2026-11-10T10:00:00.000Z", day: "2026-11-10", subtotal: 700, shippingCost: 80, total: 780, governorate: "القاهرة", offerName: "بدون عرض — قطع منفردة", products, firstTouch: null, lastTouch: null, source: "Direct", sourceType: "Direct", campaign: "", adContent: "", landingPage: "/", status, statusAt: "2026-11-10T12:00:00.000Z", confirmedValue: null, soldAt: "2026-11-10T12:00:00.000Z", ...extra };
}
const NOW = new Date("2026-11-20T10:00:00.000Z");
let next = 0;
const makeId = () => `ctest${++next}`;
const box = (extra = {}) => ({ company: "بوسطة", tracking: "", charges: [], collected: null, collectedAt: null, ...extra });
const charge = (kind, amount) => ({ id: `c-${kind}-${amount}`, kind, amount, note: "", at: "2026-11-12T10:00:00.000Z" });
const row = (order) => mergeAllOrders([{ order, details: null }], [])[0];

test("sanitize: company, charges and the collected amount; empty box removed", () => {
  const ok = sanitizeShipment({ company: "  بوسطة ", tracking: " 123 ", charges: [{ kind: "weight", amount: 25, note: "٣ كيلو" }], collected: 600 }, undefined, NOW, makeId);
  assert.deepEqual(ok.shipment, { company: "بوسطة", tracking: "123", charges: [{ id: "ctest1", kind: "weight", amount: 25, note: "٣ كيلو", at: NOW.toISOString() }], collected: 600, collectedAt: NOW.toISOString() });
  assert.ok("error" in sanitizeShipment({ charges: [{ kind: "tip", amount: 5 }] }, undefined, NOW, makeId), "unknown kind");
  assert.ok("error" in sanitizeShipment({ charges: [{ kind: "weight", amount: 0 }] }, undefined, NOW, makeId), "zero charge");
  assert.ok("error" in sanitizeShipment({ collected: -1 }, undefined, NOW, makeId));
  assert.deepEqual(sanitizeShipment({ company: "", charges: [], collected: null }, undefined, NOW, makeId), { shipment: undefined });
  assert.deepEqual(sanitizeShipment(null, undefined, NOW, makeId), { shipment: undefined });
  // An existing charge keeps its id and time; the collected time stays while the amount does.
  const before = ok.shipment;
  const later = new Date("2026-11-22T10:00:00.000Z");
  const same = sanitizeShipment({ company: "بوسطة", charges: [{ id: "ctest1", kind: "weight", amount: 30 }], collected: 600 }, before, later, makeId).shipment;
  assert.equal(same.charges[0].at, NOW.toISOString());
  assert.equal(same.charges[0].amount, 30);
  assert.equal(same.collectedAt, NOW.toISOString());
  assert.equal(sanitizeShipment({ company: "بوسطة", collected: 650 }, before, later, makeId).shipment.collectedAt, later.toISOString());
});

test("stage follows the order: not handed, with the company, received, returned", () => {
  assert.equal(shipStage({ status: "confirmed", courier: null }), "not-handed");
  assert.equal(shipStage({ status: "confirmed", courier: { handedAt: "x" } }), "with-courier");
  assert.equal(shipStage({ status: "delivered", courier: null }), "delivered");
  assert.equal(shipStage({ status: "returned", courier: { handedAt: "x" } }), "returned");
});

test("money: received order owes collection − shipping − charges; returned owes −charges", () => {
  const delivered = row(site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { shipment: box({ charges: [charge("weight", 20)], collected: 600 }) }));
  const value = shipmentMoney(delivered);
  assert.equal(value.collection, 780);
  assert.equal(value.fee, 80);
  assert.equal(value.owed, 680);
  assert.equal(value.remaining, 80);
  // Deposit paid to the store: the company collects less.
  assert.equal(shipmentMoney({ ...delivered, deposit: { amount: 100, at: "" } }).owed, 580);
  // Still on the way: nothing owed yet, the expected amount shown.
  const onWay = shipmentMoney({ ...delivered, status: "confirmed", courier: { handedAt: "x" } });
  assert.equal(onWay.owed, null);
  assert.equal(onWay.expected, 680);
  const returned = shipmentMoney(row(site("BM-AAAAAAAAAAAAAAAAAAA2", "returned", { shipment: box({ charges: [charge("return", 60)] }) })));
  assert.equal(returned.owed, -60);
  assert.equal(returned.remaining, -60);
});

test("totals per company; orders without a box stay out", () => {
  const rows = [
    row(site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { shipment: box({ collected: 700 }) })),
    row(site("BM-AAAAAAAAAAAAAAAAAAA2", "delivered", { shipment: box() })),
    row(site("BM-AAAAAAAAAAAAAAAAAAA3", "returned", { shipment: box({ charges: [charge("return", 50)] }) })),
    row(site("BM-AAAAAAAAAAAAAAAAAAA4", "confirmed", { courier: { handedAt: "x" }, shipment: box({ company: "J&T" }) })),
    row(site("BM-AAAAAAAAAAAAAAAAAAA5", "delivered")),
  ];
  const [bosta, jt] = companyTotals(rows);
  assert.equal(bosta.company, "بوسطة");
  assert.equal(bosta.orders, 3);
  assert.equal(bosta.stages.delivered, 2);
  assert.equal(bosta.stages.returned, 1);
  assert.equal(bosta.owed, 700 + 700 - 50);
  assert.equal(bosta.collected, 700);
  assert.equal(bosta.remaining, 650);
  assert.equal(bosta.openOrders, 2);
  assert.equal(bosta.charges, 50);
  assert.equal(jt.company, "J&T");
  assert.equal(jt.onTheWay, 700);
  assert.equal(jt.owed, 0);
  assert.deepEqual(knownCompanies(rows), ["بوسطة", "J&T"]);
  assert.equal(chargesTotal(null), 0);
});

test("finance: the company's charges come off the order's and the period's net profit, returned orders too", () => {
  const costs = { [ABAYA]: { productId: ABAYA, cost: 200, factory: "", updatedAt: "" } };
  const base = buildFinanceReport({ live: [site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered")], old: [], costs, expenses: [] });
  const live = [
    site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { shipment: box({ charges: [charge("weight", 25)] }) }),
    site("BM-AAAAAAAAAAAAAAAAAAA2", "returned", { shipment: box({ charges: [charge("return", 60)] }) }),
  ];
  const after = buildFinanceReport({ live, old: [], costs, expenses: [] });
  assert.equal(base.totals.netProfit, 300);
  assert.equal(after.totals.courierCharges, 85);
  assert.equal(after.totals.netProfit, 300 - 85);
  assert.equal(after.totals.sales, base.totals.sales, "sales unchanged");
  const delivered = after.orders.find((item) => item.orderId === "BM-AAAAAAAAAAAAAAAAAAA1");
  assert.equal(delivered.courierCharges, 25);
  assert.equal(delivered.netProfit, 275);
  assert.equal(after.orders.find((item) => item.orderId === "BM-AAAAAAAAAAAAAAAAAAA2").netProfit, -60);
  const money = orderFinance({ live, old: [], costs, expenses: [] })["BM-AAAAAAAAAAAAAAAAAAA1"];
  assert.equal(money.courierCharges, 25);
  assert.equal(money.netProfit, 275);
});

test("delivered by us (scooter): the whole collection is ours; a pickup for the pieces she did not take is a loss", () => {
  // Shipping 80 paid upfront (as a deposit) and paid to the scooter; she took pieces for 550 and paid them; the
  // scooter went back for the pieces she did not keep: 174.
  const order = site("BM-AAAAAAAAAAAAAAAAAAA1", "delivered", { subtotal: 550, total: 630, deposit: { amount: 80, at: "" }, shipment: box({ company: "اسكوتر", self: true, charges: [charge("return", 174)], collected: 550 }) });
  const value = shipmentMoney(row(order));
  assert.equal(value.collection, 550);
  assert.equal(value.owed, 550, "nobody keeps the shipping or the charges out of it");
  assert.equal(value.remaining, 0, "nothing left, nothing owed");
  const costs = { [ABAYA]: { productId: ABAYA, cost: 200, factory: "", updatedAt: "" } };
  const money = orderFinance({ live: [order], old: [], costs, expenses: [] })[order.orderId];
  assert.equal(money.sales, 550, "the shipping paid the scooter: not a sale");
  assert.equal(money.netProfit, 550 - 400 - 174, "more than the profit: a loss");
  assert.ok(sanitizeShipment({ company: "اسكوتر", self: true }, undefined, NOW, makeId).shipment.self);
  assert.equal(sanitizeShipment({ company: "بوسطة" }, undefined, NOW, makeId).shipment.self, undefined);
});

test("companies table: a name is needed, the phone is digits, same name ignores spaces and case", () => {
  const made = sanitizeCourierCompany({ name: "  اسكوتر   المحل ", phone: "010 1234 5678", note: " بالليل ", self: true }, "id1", NOW);
  assert.deepEqual(made, { id: "id1", name: "اسكوتر المحل", phone: "010 1234 5678", note: "بالليل", self: true, createdAt: NOW.toISOString() });
  assert.ok("error" in sanitizeCourierCompany({ name: " ب " }, "id2", NOW));
  assert.ok("error" in sanitizeCourierCompany({ name: "بوسطة", phone: "abc" }, "id2", NOW));
  assert.equal(sanitizeCourierCompany({ name: "بوسطة", self: "yes" }, "id2", NOW).self, false);
  assert.equal(sanitizeCourierCompany({ name: "بوسطة" }, "id2", NOW, "2026-01-01T00:00:00.000Z").createdAt, "2026-01-01T00:00:00.000Z");
  assert.ok(sameCompany(" J&T  Express", "j&t express"));
  assert.ok(!sameCompany("بوسطة", "J&T"));
});
