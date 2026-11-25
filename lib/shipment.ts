// Shipping company of an order (pure, tested): which company took it, the extra money the company kept
// (overweight, return shipping…), and what it actually paid over for the order.
//
// Rules (agreed with the store owner)
// - The company collects the order from the customer (shipping included, less any deposit and any piece she gave
//   back) and keeps the shipping fee. What it owes the store for a received order = that collection − the shipping
//   fee − the extra charges on the order. A returned order brings nothing in, so it only owes the store −charges.
// - Extra charges are a real cost: they come off the order's net profit (and the period's), returned order or not.
//   Return shipping entered here must not also be entered as a "شحن المرتجعات" expense.
// - "Collected" is what the company actually transferred for the order; remaining = owed − collected.
import type { Courier, Deposit, OrderStatus } from "./analytics-report.ts";
import { returnedAmount, type PieceReturn } from "./order-returns.ts";
import { governorateShippingFee } from "./shipping-rates.ts";

export const CHARGE_KINDS = [
  { id: "weight", label: "زيادة وزن" },
  { id: "return", label: "شحن مرتجع" },
  { id: "other", label: "مصاريف تانية" },
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number]["id"];

export type ShipmentCharge = { id: string; kind: ChargeKind; amount: number; note: string; at: string };

export type Shipment = {
  /** Company name as she writes it ("بوسطة", "J&T"…); "" when not chosen yet. */
  company: string;
  /** Waybill / tracking number; "" when none. */
  tracking: string;
  charges: ShipmentCharge[];
  /** What the company transferred for this order; null = nothing collected yet. */
  collected: number | null;
  collectedAt: string | null;
};

export function isChargeKind(value: unknown): value is ChargeKind {
  return CHARGE_KINDS.some((kind) => kind.id === value);
}

export const chargeLabel = (kind: ChargeKind) => CHARGE_KINDS.find((item) => item.id === kind)?.label ?? kind;

const round = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 ? round(amount) : undefined;
};

/**
 * The shipping box from the admin (the whole box each time). Existing charges keep their first time; the collected
 * time moves only when the amount changes. `{ shipment: undefined }` when everything was emptied.
 */
export function sanitizeShipment(raw: unknown, current: Shipment | undefined, now = new Date(), makeId: () => string = () => `c${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`): { shipment: Shipment | undefined } | { error: string } {
  if (raw === null) return { shipment: undefined };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "بيانات الشحن مش مظبوطة." };
  const input = raw as Record<string, unknown>;
  const company = text(input.company, 60);
  const tracking = text(input.tracking, 60);
  const list = input.charges === undefined ? [] : input.charges;
  if (!Array.isArray(list) || list.length > 20) return { error: "الخصومات مش مظبوطة." };
  const before = new Map((current?.charges ?? []).map((charge) => [charge.id, charge]));
  const charges: ShipmentCharge[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return { error: "الخصومات مش مظبوطة." };
    const row = item as Record<string, unknown>;
    if (!isChargeKind(row.kind)) return { error: "اختاري نوع الخصم." };
    const amount = money(row.amount);
    if (amount === undefined || amount === null || amount <= 0) return { error: "مبلغ الخصم لازم يبقى رقم أكبر من صفر." };
    const old = typeof row.id === "string" ? before.get(row.id) : undefined;
    charges.push({ id: old?.id ?? makeId(), kind: row.kind, amount, note: text(row.note, 200), at: old?.at ?? now.toISOString() });
  }
  const collected = money(input.collected);
  if (collected === undefined) return { error: "المبلغ اللي حصّلتيه لازم يبقى رقم صفر أو أكتر." };
  const collectedAt = collected === null ? null : current?.collected === collected && current.collectedAt ? current.collectedAt : now.toISOString();
  if (!company && !tracking && charges.length === 0 && collected === null) return { shipment: undefined };
  return { shipment: { company, tracking, charges, collected, collectedAt } };
}

export const chargesTotal = (shipment: Shipment | null | undefined) => round((shipment?.charges ?? []).reduce((sum, charge) => sum + charge.amount, 0));

export type ShipStage = "not-handed" | "with-courier" | "delivered" | "returned" | "cancelled";
export const SHIP_STAGES: { id: ShipStage; label: string }[] = [
  { id: "not-handed", label: "لسه مراحش للشركة" },
  { id: "with-courier", label: "مع شركة الشحن" },
  { id: "delivered", label: "اتسلم للعميلة" },
  { id: "returned", label: "رجع مرتجع" },
  { id: "cancelled", label: "اتلغى" },
];
export const stageLabel = (stage: ShipStage) => SHIP_STAGES.find((item) => item.id === stage)?.label ?? stage;

type ShipOrder = {
  status: OrderStatus;
  courier: Courier | null;
  total: number | null;
  value: number;
  shippingCost: number | null;
  governorate: string;
  deposit: Deposit | null;
  returns?: PieceReturn[];
  shipment: Shipment | null;
};

export function shipStage(order: Pick<ShipOrder, "status" | "courier">): ShipStage {
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "returned") return "returned";
  if (order.status === "delivered") return "delivered";
  return order.courier?.handedAt ? "with-courier" : "not-handed";
}

/**
 * Money with the shipping company for one order:
 * - `collection`: what it collects from the customer (shipping included, less deposit and returned pieces);
 * - `fee`: the shipping it keeps; `charges`: the extra it kept;
 * - `owed`: what it should pay over (null while the order is not finished, i.e. not received and not returned);
 * - `expected`: what it will pay over once received (for orders still on the way);
 * - `remaining`: owed − collected (null while not finished).
 */
export function shipmentMoney(order: ShipOrder) {
  const stage = shipStage(order);
  const guessed = order.shippingCost === null ? governorateShippingFee(order.governorate) : null;
  const fee = order.shippingCost ?? guessed ?? 0;
  const total = order.total !== null ? order.total - returnedAmount(order.returns) : order.value + fee;
  const collection = Math.max(0, round(total - (order.deposit?.amount ?? 0)));
  const charges = chargesTotal(order.shipment);
  const expected = round(collection - fee - charges);
  const owed = stage === "delivered" ? expected : stage === "returned" || (stage === "cancelled" && charges > 0) ? round(-charges) : null;
  const collected = order.shipment?.collected ?? null;
  return { stage, collection, fee, charges, expected, owed, collected, remaining: owed === null ? null : round(owed - (collected ?? 0)) };
}

export type CompanyTotals = {
  company: string;
  orders: number;
  /** Orders per stage. */
  stages: Record<ShipStage, number>;
  /** Still with the company: what it will pay over once they are received. */
  onTheWay: number;
  charges: number;
  /** Finished orders (received or returned): what it owes, what came in, what is left. */
  owed: number;
  collected: number;
  remaining: number;
  /** Finished orders still not (fully) paid. */
  openOrders: number;
};

export const NO_COMPANY = "";

/**
 * Totals per company, over the orders that have a shipping box (older orders, settled before this existed, stay out).
 * A box without a company name counts under "".
 */
export function companyTotals(orders: ShipOrder[]): CompanyTotals[] {
  const map = new Map<string, CompanyTotals>();
  for (const order of orders) {
    if (!order.shipment) continue;
    const company = order.shipment.company;
    const value = shipmentMoney(order);
    if (!map.has(company)) map.set(company, { company, orders: 0, stages: { "not-handed": 0, "with-courier": 0, delivered: 0, returned: 0, cancelled: 0 }, onTheWay: 0, charges: 0, owed: 0, collected: 0, remaining: 0, openOrders: 0 });
    const row = map.get(company)!;
    row.orders += 1;
    row.stages[value.stage] += 1;
    row.charges += value.charges;
    if (value.stage === "with-courier") row.onTheWay += value.expected;
    if (value.owed !== null) {
      row.owed += value.owed;
      row.collected += value.collected ?? 0;
      row.remaining += value.remaining ?? 0;
      if (Math.abs(value.remaining ?? 0) >= 0.01) row.openOrders += 1;
    } else if (value.collected !== null) row.collected += value.collected;
  }
  return [...map.values()]
    .map((row) => ({ ...row, onTheWay: round(row.onTheWay), charges: round(row.charges), owed: round(row.owed), collected: round(row.collected), remaining: round(row.remaining) }))
    .toSorted((a, b) => (a.company === NO_COMPANY ? 1 : b.company === NO_COMPANY ? -1 : b.orders - a.orders || a.company.localeCompare(b.company, "ar")));
}

/** Company names used before (for the picker), most used first. */
export function knownCompanies(orders: { shipment: Shipment | null }[]) {
  const counts = new Map<string, number>();
  for (const order of orders) if (order.shipment?.company) counts.set(order.shipment.company, (counts.get(order.shipment.company) ?? 0) + 1);
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1]).map(([name]) => name);
}
