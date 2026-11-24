// Pieces the customer gave back from a received order (مرتجع جزئي). Pure, tested.
//
// The order keeps every piece it was placed with (that is its history: ordered 1, 2 and 3). Each return
// says which piece came back, how many, how much comes off the order, and where the piece is now:
//   - with_customer: she still has it and will send it back;
//   - with_courier:  the shipping company has it, on its way back to us;
//   - in_stock:      it reached us and is back in the stock.
// A returned piece is never a sale (sales, factory cost, profit, pieces sold, the factory summary all leave it
// out). The stock gets it back only once it is "in_stock", from the time it was marked so.

export const RETURN_STATES = [
  { id: "with_customer", label: "لسه عند العميلة (هترجعها)", short: "عند العميلة" },
  { id: "with_courier", label: "لسه عند شركة الشحن", short: "عند شركة الشحن" },
  { id: "in_stock", label: "وصلتنا ورجعت المخزن", short: "رجعت المخزن" },
] as const;
export type ReturnState = (typeof RETURN_STATES)[number]["id"];

export type PieceReturn = {
  id: string;
  modelId: string;
  quantity: number;
  /** What comes off the order for these pieces (EGP, ≥ 0). */
  amount: number;
  state: ReturnState;
  /** When the return was first recorded. */
  at: string;
  /** When it reached its current state (for in_stock: when it came back to the stock). */
  stateAt: string;
  note: string;
};

export const MAX_RETURNS = 40;
const ID_PATTERN = /^r[\da-z]{4,24}$/;

export function isReturnState(value: unknown): value is ReturnState {
  return RETURN_STATES.some((state) => state.id === value);
}

export function returnStateLabel(state: ReturnState, short = false) {
  const found = RETURN_STATES.find((item) => item.id === state)!;
  return short ? found.short : found.label;
}

const newId = () => `r${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/**
 * Checks the full list of returns sent by the admin against the order's pieces. Existing returns (same id)
 * keep their first time; the state time moves only when the state changes. Returns the clean list or an Arabic message.
 */
export function sanitizeReturns(
  raw: unknown,
  products: { modelId: string; quantity: number }[],
  current: PieceReturn[] | undefined,
  now = new Date(),
  makeId: () => string = newId,
): { returns: PieceReturn[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "بيانات المرتجع مش مفهومة." };
  if (raw.length > MAX_RETURNS) return { error: "عدد المرتجعات كبير." };
  const ordered = orderedByModel(products);
  const previous = new Map((current ?? []).map((item) => [item.id, item]));
  const used = new Map<string, number>();
  const returns: PieceReturn[] = [];
  const stamp = now.toISOString();
  for (const item of raw) {
    const value = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const modelId = typeof value.modelId === "string" ? value.modelId : "";
    if (!ordered.has(modelId)) return { error: "اختاري القطعة اللي رجعت من قطع الأوردر." };
    const quantity = Number(value.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return { error: "عدد القطع اللي رجعت لازم يبقى ١ أو أكتر." };
    const total = (used.get(modelId) ?? 0) + quantity;
    if (total > ordered.get(modelId)!) return { error: "عدد القطع اللي رجعت أكتر من اللي في الأوردر." };
    used.set(modelId, total);
    const amount = value.amount === "" || value.amount === null || value.amount === undefined ? 0 : Number(value.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return { error: "المبلغ اللي هيتخصم لازم يبقى رقم صفر أو أكتر." };
    if (!isReturnState(value.state)) return { error: "اختاري القطعة فين دلوقتي." };
    const note = typeof value.note === "string" ? value.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const id = typeof value.id === "string" && ID_PATTERN.test(value.id) ? value.id : "";
    const before = id ? previous.get(id) : undefined;
    returns.push({
      id: before ? before.id : makeId(),
      modelId,
      quantity,
      amount: Math.round(amount * 100) / 100,
      state: value.state,
      at: before?.at ?? stamp,
      stateAt: before && before.state === value.state ? before.stateAt : stamp,
      note,
    });
  }
  return { returns };
}

function orderedByModel(products: { modelId: string; quantity: number }[]) {
  const map = new Map<string, number>();
  for (const line of products) if (line.modelId) map.set(line.modelId, (map.get(line.modelId) ?? 0) + line.quantity);
  return map;
}

/** Pieces that came back, per product. */
export function returnedByModel(returns: PieceReturn[] | undefined) {
  const map = new Map<string, number>();
  for (const item of returns ?? []) map.set(item.modelId, (map.get(item.modelId) ?? 0) + item.quantity);
  return map;
}

/**
 * The order's lines with the returned pieces taken out (same lines, same order, so per-line data such as the
 * saved factory costs still lines up). A line can end at 0.
 */
export function keptLines<T extends { modelId: string; quantity: number }>(products: T[], returns: PieceReturn[] | undefined): T[] {
  if (!returns?.length) return products;
  const left = returnedByModel(returns);
  return products.map((line) => {
    const back = Math.min(line.quantity, left.get(line.modelId) ?? 0);
    if (back === 0) return line;
    left.set(line.modelId, (left.get(line.modelId) ?? 0) - back);
    return { ...line, quantity: line.quantity - back };
  });
}

/** Total that comes off the order for the returned pieces. */
export function returnedAmount(returns: PieceReturn[] | undefined) {
  return Math.round((returns ?? []).reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
}

export function returnedPieces(returns: PieceReturn[] | undefined) {
  return (returns ?? []).reduce((sum, item) => sum + item.quantity, 0);
}

/** Returned pieces that are back in the stock, with the time they came back. */
export function backInStock(returns: PieceReturn[] | undefined) {
  return (returns ?? []).filter((item) => item.state === "in_stock").map((item) => ({ productId: item.modelId, quantity: item.quantity, at: item.stateAt }));
}
