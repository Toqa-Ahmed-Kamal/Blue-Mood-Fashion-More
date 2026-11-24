"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Undo2, X } from "lucide-react";

import type { UnifiedOrder } from "@/lib/all-orders";
import { formatEGP } from "@/lib/format";
import { RETURN_STATES, isReturnState, returnStateLabel, returnedAmount, returnedByModel, returnedPieces, type PieceReturn, type ReturnState } from "@/lib/order-returns";

const cairoTime = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");
const piecesText = (count: number) => (count === 1 ? "قطعة" : count === 2 ? "قطعتين" : `${count} قطع`);

/** Ordered pieces per product (an order can list the same product on two lines). */
function orderedPieces(order: Pick<UnifiedOrder, "products">) {
  const map = new Map<string, { name: string; quantity: number; unitPrice: number | null }>();
  for (const line of order.products) {
    const before = map.get(line.modelId);
    map.set(line.modelId, { name: before?.name ?? line.name, quantity: (before?.quantity ?? 0) + line.quantity, unitPrice: before?.unitPrice ?? line.unitPrice });
  }
  return map;
}

/** On the order card: what she ordered, what she kept, and every piece she gave back with where it is now. */
export function ReturnsBox({ order }: { order: UnifiedOrder }) {
  if (order.returns.length === 0) return null;
  const ordered = order.products.reduce((sum, line) => sum + line.quantity, 0);
  const back = returnedPieces(order.returns);
  const names = orderedPieces(order);
  return (
    <section className="order-returns" aria-label="قطع رجعت">
      <h4><Undo2 size={15} aria-hidden="true" /> مرتجع جزئي</h4>
      <p className="order-returns-story">طلبت {piecesText(ordered)} · خدت {piecesText(Math.max(0, ordered - back))} · رجّعت {piecesText(back)}</p>
      <ul>
        {order.returns.map((item) => (
          <li key={item.id} className={`state-${item.state}`}>
            <strong>{names.get(item.modelId)?.name ?? item.modelId}</strong>
            <span>× {item.quantity}</span>
            <span className={`order-return-state ${item.state}`} title={`من ${cairoTime(item.stateAt)}`}>{returnStateLabel(item.state, true)}</span>
            <span className="price">− {formatEGP(item.amount)}</span>
            <small className="admin-muted">اتسجل {cairoTime(item.at)}{item.note && ` · ${item.note}`}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Draft = { key: number; id: string; modelId: string; quantity: string; amount: string; state: ReturnState; note: string; auto: boolean };

/**
 * "قطع رجعت": she received the order and gave some pieces back. The order keeps all its pieces; these are
 * marked as returned (not counted), with what comes off the order and where each piece is now.
 */
export function ReturnsDialog({ order, onClose, onSaved }: { order: UnifiedOrder; onClose: () => void; onSaved: (returns: PieceReturn[]) => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pieces = orderedPieces(order);
  const choices = [...pieces.entries()];
  // Keys for new rows start after the rows the dialog opens with.
  const nextKey = useRef(order.returns.length + 1);
  const autoAmount = (modelId: string, quantity: string) => {
    const price = pieces.get(modelId)?.unitPrice;
    const count = Number(quantity);
    return price === null || price === undefined || !Number.isInteger(count) ? "" : String(price * count);
  };
  const blank = (key: number): Draft => {
    const modelId = choices.length === 1 ? choices[0][0] : "";
    return { key, id: "", modelId, quantity: "1", amount: autoAmount(modelId, "1"), state: "with_customer", note: "", auto: true };
  };
  const [rows, setRows] = useState<Draft[]>(() => order.returns.length
    ? order.returns.map((item, index) => ({ key: index, id: item.id, modelId: item.modelId, quantity: String(item.quantity), amount: String(item.amount), state: item.state, note: item.note, auto: false }))
    : [blank(0)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const setRow = (key: number, change: Partial<Draft>) => { setError(""); setRows((current) => current.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...change };
    if (next.auto && ("modelId" in change || "quantity" in change)) next.amount = autoAmount(next.modelId, next.quantity);
    return next;
  })); };

  const list = rows.map((row) => ({ id: row.id || undefined, modelId: row.modelId, quantity: Number(row.quantity), amount: row.amount.trim() === "" ? 0 : Number(row.amount), state: row.state, note: row.note }));
  const back = returnedByModel(list.map((item) => ({ ...item, quantity: Number.isInteger(item.quantity) ? item.quantity : 0 })) as PieceReturn[]);
  const ordered = order.products.reduce((sum, line) => sum + line.quantity, 0);
  const backCount = [...back.values()].reduce((sum, count) => sum + count, 0);
  const amount = returnedAmount(list.map((item) => ({ ...item, amount: Number.isFinite(item.amount) ? item.amount : 0 })) as PieceReturn[]);
  const before = Math.max(0, order.value + returnedAmount(order.returns));
  const tooMany = [...back.entries()].find(([modelId, count]) => count > (pieces.get(modelId)?.quantity ?? 0));

  async function save() {
    if (list.some((item) => !item.modelId)) return setError("اختاري القطعة اللي رجعت.");
    if (list.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) return setError("عدد القطع لازم يبقى ١ أو أكتر.");
    if (tooMany) return setError(`${pieces.get(tooMany[0])?.name ?? "القطعة"}: اللي رجع أكتر من اللي في الأوردر.`);
    if (list.some((item) => !Number.isFinite(item.amount) || item.amount < 0)) return setError("المبلغ اللي هيتخصم لازم يبقى رقم صفر أو أكتر.");
    setSaving(true);
    setError("");
    try {
      const url = order.source === "site" ? `/api/admin/orders/${order.orderId}` : `/api/admin/old-orders/${order.orderId}`;
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returns: list }) });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ.");
        return;
      }
      onSaved((result.order?.returns ?? []) as PieceReturn[]);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="admin-dialog order-returns-dialog" dir="rtl" aria-labelledby="order-returns-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="order-returns-title">قطع رجعت <span dir="ltr" className="mono">{order.orderId}</span></h2>
            <p className="admin-muted">القطع دي هتفضل مكتوبة في الأوردر (علشان تبقى عارفة طلبت إيه من الأول)، بس مش هتتحسب في البيع ولا المكسب، وترجع المخزن لما تختاري &quot;وصلتنا ورجعت المخزن&quot;.</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-dialog-body">
          <section className="admin-detail">
            <h3>الأوردر من الأول</h3>
            <ul className="order-returns-ordered">
              {choices.map(([modelId, piece]) => {
                const count = back.get(modelId) ?? 0;
                return (
                  <li key={modelId}>
                    <strong>{piece.name}</strong> × {piece.quantity}
                    {count > 0 && <span className={`order-return-mark${count > piece.quantity ? " bad" : ""}`}>رجع {count}{count < piece.quantity ? ` · خدت ${piece.quantity - count}` : ""}</span>}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="admin-detail">
            <h3>اللي رجع</h3>
            {rows.length === 0 && <p className="admin-muted small">مفيش قطع راجعة. لو اتسجلت بالغلط واتمسحت كلها، دوسي حفظ.</p>}
            <div className="order-returns-rows">
              {rows.map((row, index) => (
                <div className="order-returns-row" key={row.key}>
                  <label className="admin-field product">
                    <span>القطعة {index + 1}</span>
                    <select value={row.modelId} onChange={(event) => setRow(row.key, { modelId: event.target.value })}>
                      <option value="">اختاري القطعة…</option>
                      {choices.map(([modelId, piece]) => <option key={modelId} value={modelId}>{piece.name}</option>)}
                    </select>
                  </label>
                  <label className="admin-field qty">
                    <span>العدد</span>
                    <input type="number" inputMode="numeric" min={1} max={pieces.get(row.modelId)?.quantity ?? 20} value={row.quantity} onChange={(event) => setRow(row.key, { quantity: event.target.value })} />
                  </label>
                  <label className="admin-field price">
                    <span>هيتخصم (ج.م)</span>
                    <input type="number" inputMode="decimal" min={0} value={row.amount} placeholder={pieces.get(row.modelId)?.unitPrice === null ? "قطعة من العرض" : "0"} onChange={(event) => setRow(row.key, { amount: event.target.value, auto: false })} />
                  </label>
                  <label className="admin-field state">
                    <span>القطعة فين دلوقتي؟</span>
                    <select value={row.state} onChange={(event) => { if (isReturnState(event.target.value)) setRow(row.key, { state: event.target.value }); }}>
                      {RETURN_STATES.map((state) => <option key={state.id} value={state.id}>{state.label}</option>)}
                    </select>
                  </label>
                  <label className="admin-field note">
                    <span>ملاحظة (اختياري)</span>
                    <input value={row.note} maxLength={200} placeholder="مثلاً: المقاس صغير" onChange={(event) => setRow(row.key, { note: event.target.value })} />
                  </label>
                  <button type="button" className="admin-icon-btn danger" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} aria-label={`امسحي القطعة ${index + 1} من المرتجع`}><Trash2 size={16} /></button>
                  {row.modelId && pieces.get(row.modelId)?.unitPrice === null && row.amount.trim() === "" && (
                    <p className="admin-flag warn wide">القطعة دي من العرض ومالهاش سعر لوحدها: اكتبي المبلغ اللي اتخصم من العميلة (أو صفر لو دفعت العرض كامل).</p>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="admin-chip" onClick={() => setRows((current) => [...current, blank(nextKey.current++)])}><Plus size={14} /> قطعة كمان رجعت</button>
            <dl className="admin-totals">
              <div><dt>طلبت</dt><dd>{piecesText(ordered)}</dd></div>
              <div><dt>رجّعت</dt><dd>{piecesText(backCount)}</dd></div>
              <div><dt>قيمة الأوردر قبل المرتجع</dt><dd>{formatEGP(before)}</dd></div>
              <div><dt>هيتخصم</dt><dd>− {formatEGP(amount)}</dd></div>
              <div className="grand"><dt>قيمة الأوردر بعد المرتجع</dt><dd>{formatEGP(Math.max(0, before - amount))}</dd></div>
            </dl>
          </section>
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={saving} onClick={() => void save()}>{saving ? "جاري الحفظ…" : "حفظ المرتجع"}</button>
        </footer>
      </div>
    </dialog>
  );
}
