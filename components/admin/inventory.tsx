"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleSlash, ClipboardCheck, PackageCheck, PackagePlus, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";

import { LOW_STOCK, STOCK_MOVE_KINDS, type StockMove, type StockMoveKind, type StockRow } from "@/lib/inventory";
import { categoryInfo, categoryOrder, type CatalogCategory } from "@/lib/site-data";

type ProductStock = StockRow & { name: string; category: CatalogCategory; image: string; hidden: boolean; soldOut: boolean };
type Data = { products: ProductStock[]; moves: StockMove[]; vaultConfigured: boolean };
type Action = { product: ProductStock; kind: StockMoveKind } | null;

const KIND_LABEL = Object.fromEntries(STOCK_MOVE_KINDS.map((kind) => [kind.id, kind.label])) as Record<StockMoveKind, string>;
const cairoTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });
const FILTERS = [
  { id: "all", label: "الكل" },
  { id: "alert", label: "خلص / قرب يخلص" },
  { id: "untracked", label: "لسه متسجلش" },
] as const;

function useApi() {
  const router = useRouter();
  return useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (response.status === 401) {
      router.replace("/admin/login");
      throw new Error("انتهت الجلسة.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "حصلت مشكلة. جربي تاني.");
    return result;
  }, [router]);
}

export function InventoryTab() {
  const api = useApi();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [category, setCategory] = useState<CatalogCategory | "">("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<Action>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api("/api/admin/inventory"));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل المخزون.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Loading the stock when the tab opens is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggleSoldOut(product: ProductStock) {
    if (!product.soldOut && !window.confirm(`${product.name}: يظهر للعميلات "نفدت الكمية" ومحدش يقدر يطلبه لحد ما ترجّعيه متاح؟`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/products/${product.productId}/stock`, { method: "PUT", body: JSON.stringify({ soldOut: !product.soldOut }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy(false);
    }
  }

  async function undo(move: StockMove) {
    const product = data?.products.find((item) => item.productId === move.productId);
    if (!window.confirm(`حذف الحركة "${KIND_LABEL[move.kind]} ${move.quantity}" لـ ${product?.name ?? move.productId}؟ المخزون هيتحسب من غيرها.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/inventory/${move.id}`, { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحذف.");
    } finally {
      setBusy(false);
    }
  }

  const products = data?.products ?? [];
  const tracked = products.filter((product) => product.tracked);
  const out = tracked.filter((product) => product.state === "out");
  const low = tracked.filter((product) => product.state === "low");
  const totalPieces = tracked.reduce((sum, product) => sum + Math.max(0, product.stock), 0);
  const search = query.trim().toLowerCase();
  const shown = products.filter((product) =>
    (!category || product.category === category)
    && (!search || product.name.toLowerCase().includes(search) || product.productId.includes(search))
    && (filter === "all" ? (!product.hidden || product.tracked) : filter === "alert" ? product.state === "out" || product.state === "low" : !product.tracked));
  const byId = new Map(products.map((product) => [product.productId, product]));

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>المخزون · Inventory</h2>
          <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {data && !data.vaultConfigured && <p className="admin-note">أوردرات تيليجرام القديمة مش محسوبة لأن ORDER_DATA_KEY مش متضاف.</p>}
        {!data && !error && <p className="admin-muted">جاري التحميل…</p>}
        {data && (
          <>
            <section className="admin-cards">
              <div className="admin-card"><span>قطع في المخزون</span><strong>{totalPieces}</strong><small>{tracked.length} منتج متسجل</small></div>
              <div className={`admin-card${out.length ? " bad" : ""}`}><span>خلص</span><strong>{out.length}</strong><small>منتج</small></div>
              <div className="admin-card"><span>قرب يخلص</span><strong>{low.length}</strong><small>{LOW_STOCK} قطع أو أقل متاحين</small></div>
            </section>
            {(out.length > 0 || low.length > 0) && (
              <div className="admin-qty-sources-box inventory-alerts" role="status">
                {out.map((product) => (
                  <div key={product.productId}>
                    <span className="admin-flag warn">خلص</span> {product.name}{product.reserved > 0 && ` — وفيه ${product.reserved} قطعة في أوردرات مستنية`}
                    {!product.soldOut && <button type="button" className="admin-link small" disabled={busy} onClick={() => void toggleSoldOut(product)}>اعمليه &quot;نفذ&quot; على الموقع</button>}
                    {product.soldOut && <span className="admin-muted"> · ظاهر &quot;نفدت الكمية&quot;</span>}
                  </div>
                ))}
                {low.map((product) => <div key={product.productId}><span className="admin-flag info">قرب يخلص</span> {product.name} — متاح {product.available}</div>)}
              </div>
            )}
            <div className="admin-filters">
              <div className="admin-presets small" role="group" aria-label="عرض">
                {FILTERS.map((item) => <button key={item.id} type="button" className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}
              </div>
              <select value={category} onChange={(event) => setCategory(event.target.value as CatalogCategory | "")} aria-label="القسم">
                <option value="">كل الأقسام</option>
                {categoryOrder.map((item) => <option key={item} value={item}>{categoryInfo[item].label}</option>)}
              </select>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="دوري على منتج" aria-label="بحث" />
            </div>
            {shown.length === 0 ? <p className="admin-muted empty">مفيش منتجات هنا.</p> : (
              <div className="admin-table-wrap">
                <table className="admin-table inventory-table">
                  <thead><tr><th>المنتج</th><th>في المخزون</th><th>محجوز (مستني تأكيد)</th><th>متاح</th><th>اتباع من آخر جرد</th><th>آخر جرد</th><th>إجراء</th></tr></thead>
                  <tbody>
                    {shown.map((product) => (
                      <tr key={product.productId} className={product.state === "out" ? "stock-out" : product.state === "low" ? "stock-low" : ""}>
                        <td>
                          <span className="admin-product">
                            {/* eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail */}
                            <img src={product.image} alt="" width={40} height={40} loading="lazy" />
                            <span>{product.name}<small className="admin-muted">{categoryInfo[product.category].label}{product.hidden ? " · مخفي" : ""}{product.soldOut ? " · نفدت على الموقع" : ""}</small></span>
                          </span>
                        </td>
                        <td>{product.tracked ? <strong className={product.stock <= 0 ? "admin-negative" : ""}>{product.stock}</strong> : <span className="admin-muted">لسه متسجلش</span>}</td>
                        <td>{product.reserved || "—"}</td>
                        <td>{product.tracked ? <span className={product.available < 0 ? "admin-negative" : ""}>{product.available}</span> : "—"}</td>
                        <td>{product.tracked ? `${product.soldOrders + product.soldDirect}${product.soldDirect ? ` (${product.soldDirect} بيع مباشر)` : ""}` : "—"}</td>
                        <td dir="ltr">{product.tracked ? (product.counted && product.startAt ? `${product.start} · ${cairoTime(product.startAt)}` : "—") : "—"}</td>
                        <td className="actions">
                          <button type="button" disabled={busy} onClick={() => setAction({ product, kind: "arrival" })}><PackagePlus size={14} /> وصلت بضاعة</button>
                          <button type="button" disabled={busy} onClick={() => setAction({ product, kind: "count" })}><ClipboardCheck size={14} /> جرد</button>
                          {product.tracked && <button type="button" disabled={busy} onClick={() => setAction({ product, kind: "adjust" })} aria-label="تعديل" title="تالف، هدية، أو تصحيح"><SlidersHorizontal size={14} /></button>}
                          <button type="button" disabled={busy} className={`admin-stock${product.soldOut ? " out" : ""}`} onClick={() => void toggleSoldOut(product)} aria-pressed={product.soldOut} title={product.soldOut ? "دوسي علشان يرجع متاح على الموقع" : "دوسي علشان يظهر نفدت الكمية على الموقع"}>
                            {product.soldOut ? <><CircleSlash size={13} /> نفذ</> : <><PackageCheck size={13} /> متاح</>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="admin-muted small">
              ابدئي بـ &quot;جرد&quot; لكل منتج: اكتبي العدد اللي عندك فعلاً. بعد كده المخزون بيقل لوحده لما تأكدي أوردر (موقع أو تيليجرام) أو تسجلي بيع مباشر، ولو الأوردر اتلغى أو رجع القطع بترجع لوحدها.
              &quot;وصلت بضاعة&quot; بتزود العدد. &quot;محجوز&quot; = قطع في أوردرات لسه مستنية تأكيد، و&quot;متاح&quot; = المخزون − المحجوز.
              تنبيه &quot;قرب يخلص&quot; لما المتاح يبقى {LOW_STOCK} أو أقل. المخزون مش بيقفل المنتج على الموقع لوحده؛ انتي اللي بتقرري تعمليه &quot;نفذ&quot;.
            </p>
          </>
        )}
      </section>

      {data && (
        <section className="admin-panel">
          <div className="admin-panel-head"><h2>سجل الحركة</h2></div>
          {data.moves.length === 0 ? <p className="admin-muted empty">لسه مفيش حركة. ابدئي بجرد المنتجات.</p> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>الوقت</th><th>المنتج</th><th>الحركة</th><th>العدد</th><th>ملاحظة</th><th>إجراء</th></tr></thead>
                <tbody>
                  {data.moves.map((move) => (
                    <tr key={move.id}>
                      <td dir="ltr">{cairoTime(move.at)}</td>
                      <td>{byId.get(move.productId)?.name ?? move.productId}</td>
                      <td>{KIND_LABEL[move.kind]}</td>
                      <td dir="ltr">{move.kind === "count" ? `= ${move.quantity}` : move.quantity > 0 ? `+${move.quantity}` : `${move.quantity}`}</td>
                      <td className="wrap">{move.note || "—"}</td>
                      <td className="actions"><button type="button" className="danger" disabled={busy} onClick={() => void undo(move)} aria-label="حذف الحركة" title="اتسجلت غلط؟ احذفيها"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="admin-muted small">البيع مش بيظهر هنا كحركة؛ بيتحسب من الأوردرات المؤكدة والبيع المباشر. لو سجلتي حاجة غلط احذفيها والمخزون يتحسب من غيرها.</p>
        </section>
      )}

      {action && <MoveDialog action={action} onClose={() => setAction(null)} onSaved={async () => { setAction(null); await load(); }} />}
    </>
  );
}

function MoveDialog({ action, onClose, onSaved }: { action: NonNullable<Action>; onClose: () => void; onSaved: () => Promise<void> }) {
  const api = useApi();
  const { product, kind } = action;
  const [quantity, setQuantity] = useState(kind === "count" && product.tracked ? String(product.stock) : "");
  const [sign, setSign] = useState<1 | -1>(-1);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function save() {
    const number = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(number) || number < 0 || (kind !== "count" && number === 0)) {
      setError(kind === "count" ? "اكتبي العدد اللي عندك (صفر أو أكتر)." : "اكتبي عدد القطع.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api("/api/admin/inventory", { method: "POST", body: JSON.stringify({ productId: product.productId, kind, quantity: kind === "adjust" ? sign * number : number, note }) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setSaving(false);
    }
  }

  const title = kind === "arrival" ? "وصلت بضاعة" : kind === "count" ? "جرد" : "تعديل المخزون";
  const preview = (() => {
    const number = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(number)) return null;
    if (kind === "count") return number;
    return (product.tracked ? product.stock : 0) + (kind === "adjust" ? sign * number : number);
  })();

  return (
    <dialog ref={dialogRef} className="admin-dialog inventory-move" dir="rtl" aria-labelledby="move-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="admin-dialog-inner" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header className="admin-dialog-head">
          <div>
            <h2 id="move-title">{title}</h2>
            <p className="admin-muted">{product.name} · في المخزون دلوقتي: {product.tracked ? product.stock : "لسه متسجلش"}</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>
        <div className="admin-dialog-body inventory-move-body">
        {kind === "adjust" && (
          <div className="admin-presets small" role="group" aria-label="زيادة أو نقص">
            <button type="button" className={sign === -1 ? "active" : ""} onClick={() => setSign(-1)}>نقص (تالف، هدية…)</button>
            <button type="button" className={sign === 1 ? "active" : ""} onClick={() => setSign(1)}>زيادة</button>
          </div>
        )}
        <label className="admin-field">
          <span>{kind === "count" ? "العدد اللي عندك فعلاً" : kind === "arrival" ? "عدد القطع اللي وصلت" : "عدد القطع"}</span>
          <input type="number" min={0} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus />
        </label>
        <label className="admin-field"><span>ملاحظة (اختياري)</span><input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={kind === "arrival" ? "مثلاً: من مصنع القاهرة" : ""} /></label>
        {preview !== null && <p className="admin-muted">المخزون هيبقى: <strong>{preview}</strong></p>}
        {kind === "count" && <p className="admin-muted small">الجرد بيبدأ العد من جديد: الأوردرات اللي اتأكدت قبله مش هتتخصم تاني.</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="admin-fin-form-actions">
          <button type="submit" className="admin-primary" disabled={saving}>{saving ? "جاري الحفظ…" : "حفظ"}</button>
          <button type="button" className="admin-chip" onClick={onClose}>إلغاء</button>
        </div>
        </div>
      </form>
    </dialog>
  );
}
