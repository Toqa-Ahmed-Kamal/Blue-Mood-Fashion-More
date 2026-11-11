"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Calculator, CircleSlash, ImageOff, ImagePlus, PackageCheck, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { EXPENSE_CATEGORIES, OFFER_PIECE_PRICE, pricingRows, type Expense, type ExpenseCategory, type FinanceReport } from "@/lib/finance";
import { formatEGP } from "@/lib/format";
import { categoryInfo, categoryOrder, categoryPrices, type CatalogCategory } from "@/lib/site-data";

type ProductRow = {
  productId: string;
  name: string;
  category: CatalogCategory;
  image: string;
  hidden: boolean;
  salePrice: number | null;
  factory: string;
  cost: number | null;
  costUpdatedAt: string | null;
  /** Added from the admin (editable here); built-in products live in the code. */
  custom: boolean;
  /** Shown to customers as "نفدت الكمية" and cannot be ordered. */
  soldOut: boolean;
  imageAlt: string;
  /** The product's own price (null = the category price / offer only). */
  price: number | null;
  maxWeightKg: number | null;
};
type Data = { report: FinanceReport; products: ProductRow[]; expenses: Expense[]; factories: string[]; vaultConfigured: boolean; unreadableOldOrders: number };

const cairoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);
const today = () => cairoDay(new Date());
const daysAgo = (days: number) => cairoDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
const PRESETS = [
  { id: "all", label: "الكل", range: () => ({ from: "", to: "" }) },
  { id: "month", label: "الشهر ده", range: () => ({ from: `${today().slice(0, 8)}01`, to: today() }) },
  { id: "30", label: "آخر ٣٠ يوم", range: () => ({ from: daysAgo(29), to: today() }) },
] as const;
const CATEGORY_LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category.id, category.label])) as Record<ExpenseCategory, string>;
const money = (value: number) => formatEGP(Math.round(value * 100) / 100);

function useFinanceApi() {
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

export function FinanceTab() {
  const api = useFinanceApi();
  const [preset, setPreset] = useState<string>("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
      setData(await api(`/api/admin/finance?${query}`));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل الماليات.");
    } finally {
      setLoading(false);
    }
  }, [api, range.from, range.to]);

  useEffect(() => {
    // Loading the report when the tab opens or the dates change is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const report = data?.report;
  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>الإدارة المالية · Financial Management</h2>
          <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
        </div>
        <div className="admin-filters">
          <div className="admin-presets small" role="group" aria-label="الفترة">
            {PRESETS.map((item) => (
              <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => { setPreset(item.id); setRange(item.range()); }}>{item.label}</button>
            ))}
          </div>
          <label>من <input type="date" value={range.from} max={range.to || undefined} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, from: event.target.value })); }} /></label>
          <label>لحد <input type="date" value={range.to} min={range.from || undefined} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, to: event.target.value })); }} /></label>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {data && !data.vaultConfigured && <p className="admin-note">الأوردرات القديمة مش محسوبة لأن ORDER_DATA_KEY مش متضاف.</p>}
        {!data && !error && <p className="admin-muted">جاري الحساب…</p>}
        {report && (
          <>
            <section className="admin-cards">
              <div className="admin-card"><span>Total Sales · المبيعات</span><strong>{money(report.totals.sales)}</strong><small>{report.counts.confirmedOrders} أوردر مؤكد (شامل شحن العميلة)</small></div>
              <div className="admin-card"><span>Total Products Cost · تكلفة المنتجات</span><strong>{money(report.totals.productsCost)}</strong><small>بسعر المصنع وقت التأكيد</small></div>
              <div className="admin-card"><span>Total Expenses · المصروفات</span><strong>{money(report.totals.expenses)}</strong><small>{report.counts.expenses} مصروف</small></div>
              <div className={`admin-card${report.totals.netProfit >= 0 ? " good" : " bad"}`}><span>Net Profit · صافي المكسب</span><strong>{money(report.totals.netProfit)}</strong><small>المبيعات − التكلفة − المصروفات</small></div>
            </section>
            {(report.counts.estimatedOrders > 0 || report.counts.missingCostOrders > 0 || report.counts.returnedOrders > 0) && (
              <div className="admin-qty-sources-box">
                {report.counts.estimatedOrders > 0 && <div><span className="admin-flag warn">تكلفة تقديرية</span> {report.counts.estimatedOrders} أوردر اتأكد قبل ما سعر المصنع يتسجل، فتكلفته محسوبة بسعر المصنع الحالي.</div>}
                {report.counts.missingCostOrders > 0 && <div><span className="admin-flag warn">تكلفة ناقصة</span> {report.counts.missingCostOrders} أوردر فيه منتج مالوش سعر مصنع لسه؛ القطع دي مش محسوبة في التكلفة. ضيفي سعرها من جدول المنتجات تحت.</div>}
                {report.counts.returnedOrders > 0 && <div><span className="admin-flag info">مرتجع</span> {report.counts.returnedOrders} أوردر مرتجع ({money(report.returnedValue)}) مش محسوب في المبيعات ولا التكلفة. شحن المرتجع يتسجل مصروف &quot;شحن المرتجعات&quot;.</div>}
              </div>
            )}
            {report.totals.stockPurchases > 0 && (
              <p className="admin-fin-stock">
                شراء بضاعة من المصنع في الفترة: <strong>{money(report.totals.stockPurchases)}</strong> — متسجلة للمتابعة ومش مخصومة من صافي المكسب، لأن سعر المصنع لكل قطعة اتباعت مخصوم في &quot;تكلفة المنتجات&quot; (علشان نفس البضاعة ما تتخصمش مرتين).
              </p>
            )}
            <div className="admin-fin-categories">
              {report.expensesByCategory.filter((row) => row.amount > 0).map((row) => <span key={row.category}>{row.label}: <strong>{money(row.amount)}</strong></span>)}
            </div>
          </>
        )}
      </section>

      {data && (
        <>
          <ProductsPricing products={data.products} factories={data.factories} onSaved={load} />
          {report && <PricingCalculator key={`${report.range.from}|${report.range.to}|${report.totals.expenses}`} products={data.products} report={report} />}
          <Expenses expenses={data.expenses} range={range} onChanged={load} />
          {report && <OrdersProfit report={report} />}
        </>
      )}
    </>
  );
}

// ── Products & Pricing ────────────────────────────────────────────────────

function ProductsPricing({ products, factories, onSaved }: { products: ProductRow[]; factories: string[]; onSaved: () => Promise<void> }) {
  const api = useFinanceApi();
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; product: ProductRow } | null>(null);

  /** Adds a factory to the list (asked by name), then reloads; returns the name or null. */
  async function newFactory() {
    const name = window.prompt("اسم المصنع الجديد:")?.replace(/\s+/g, " ").trim();
    if (!name) return null;
    try {
      await api("/api/admin/finance/factories", { method: "POST", body: JSON.stringify({ name }) });
      await onSaved();
      return name;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نضيف المصنع.");
      return null;
    }
  }
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { factory: string; cost: string }>>({});
  // A saved factory price is locked; "تعديل" opens it again (e.g. the factory changed its price).
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const relock = (productId: string) => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setUnlocked((current) => {
      const next = new Set(current);
      next.delete(productId);
      return next;
    });
  };

  async function toggleSoldOut(product: ProductRow) {
    if (!product.soldOut && !window.confirm(`${product.name}: يظهر للعميلات "نفدت الكمية" ومحدش يقدر يطلبه لحد ما ترجّعيه متاح؟`)) return;
    setBusy(product.productId);
    setError("");
    try {
      await api(`/api/admin/products/${product.productId}/stock`, { method: "PUT", body: JSON.stringify({ soldOut: !product.soldOut }) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy("");
    }
  }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const words = query.trim().toLowerCase();
  const rows = products.filter((product) => (showHidden || !product.hidden || product.cost !== null) && (!words || `${product.name} ${product.productId}`.toLowerCase().includes(words)));
  const priced = products.filter((product) => product.cost !== null).length;

  async function save(product: ProductRow) {
    const draft = drafts[product.productId];
    if (!draft) return;
    const cost = draft.cost.trim() === "" ? null : Number(draft.cost);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError("سعر المصنع لازم يبقى رقم موجب أو فاضي.");
      return;
    }
    setBusy(product.productId);
    setError("");
    try {
      await api(`/api/admin/finance/costs/${product.productId}`, { method: "PUT", body: JSON.stringify({ factory: draft.factory, cost }) });
      relock(product.productId);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>المنتجات والأسعار · Products &amp; Pricing ({priced} من {products.length} ليهم سعر مصنع)</h2>
        <button type="button" className="admin-primary" onClick={() => setDialog({ mode: "add" })}><Plus size={15} /> إضافة منتج</button>
      </div>
      <div className="admin-filters">
        <input type="search" className="admin-search" placeholder="بحث باسم المنتج أو الكود" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="بحث" />
        <label className="admin-check"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> اعرضي المنتجات المخفية من الموقع</label>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table admin-fin-products">
          <thead><tr><th>المنتج</th><th>الكود</th><th>المصنع</th><th>سعر المصنع للقطعة</th><th>سعر البيع للقطعة</th><th>هامش القطعة</th><th>المخزون</th><th /></tr></thead>
          <tbody>
            {rows.map((product) => {
              const draft = drafts[product.productId];
              const factory = draft?.factory ?? product.factory;
              const costText = draft?.cost ?? (product.cost === null ? "" : String(product.cost));
              const cost = costText.trim() === "" ? null : Number(costText);
              const margin = product.salePrice !== null && cost !== null && Number.isFinite(cost) ? product.salePrice - cost : null;
              const edit = (change: Partial<{ factory: string; cost: string }>) =>
                setDrafts((current) => ({ ...current, [product.productId]: { factory, cost: costText, ...change } }));
              const locked = product.cost !== null && !unlocked.has(product.productId) && !draft;
              return (
                <tr key={product.productId} className={product.hidden ? "dim" : ""}>
                  <td>
                    <span className="admin-product">
                      {product.image
                        // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of the real product photo
                        ? <img src={product.image} alt="" width={34} height={34} loading="lazy" />
                        : <span className="admin-thumb missing"><ImageOff size={14} /></span>}
                      <span>{product.name}{product.hidden && <small> · مخفي من الموقع</small>}</span>
                    </span>
                  </td>
                  <td dir="ltr" className="mono">{product.productId}</td>
                  <td>
                    {locked ? <span className="admin-locked">{factory}</span> : (
                    <select
                      className="admin-inline-input"
                      value={factory}
                      onChange={async (event) => {
                        if (event.target.value !== "__new") return edit({ factory: event.target.value });
                        const name = await newFactory();
                        if (name) edit({ factory: name });
                      }}
                      aria-label={`مصنع ${product.name}`}
                    >
                      {[...new Set([...factories, factory])].map((name) => <option key={name} value={name}>{name}</option>)}
                      <option value="__new">＋ مصنع جديد…</option>
                    </select>
                    )}
                  </td>
                  <td>
                    {locked
                      ? <span className="admin-locked strong">{money(product.cost ?? 0)}</span>
                      : <input className="admin-inline-input narrow" type="number" min={0} inputMode="decimal" value={costText} placeholder="—" onChange={(event) => edit({ cost: event.target.value })} aria-label={`سعر المصنع ${product.name}`} />}
                  </td>
                  <td>{product.salePrice === null ? <span className="admin-muted">ضمن العرض بس</span> : money(product.salePrice)}</td>
                  <td>{margin === null ? "—" : <span className={margin < 0 ? "admin-negative" : ""}>{money(margin)}</span>}</td>
                  <td>
                    <button type="button" className={`admin-stock${product.soldOut ? " out" : ""}`} disabled={busy === product.productId} onClick={() => void toggleSoldOut(product)} aria-pressed={product.soldOut} title={product.soldOut ? "دوسي علشان يرجع متاح" : "دوسي لو الكمية خلصت"}>
                      {product.soldOut ? <><CircleSlash size={13} aria-hidden="true" /> نفدت الكمية</> : <><PackageCheck size={13} aria-hidden="true" /> متاح</>}
                    </button>
                  </td>
                  <td className="actions">
                    {locked && <button type="button" onClick={() => setUnlocked((current) => new Set(current).add(product.productId))}><Pencil size={14} /> تعديل السعر</button>}
                    {!locked && draft && <button type="button" disabled={busy === product.productId} onClick={() => void save(product)}><Save size={14} /> حفظ</button>}
                    {!locked && product.cost !== null && <button type="button" onClick={() => relock(product.productId)} aria-label="إلغاء التعديل"><X size={14} /></button>}
                    {product.custom && <button type="button" onClick={() => setDialog({ mode: "edit", product })}><Pencil size={14} /> تعديل المنتج</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog && (
        <ProductDialog
          product={dialog.mode === "edit" ? dialog.product : null}
          factories={factories}
          onNewFactory={newFactory}
          onClose={() => setDialog(null)}
          onSaved={async () => { setDialog(null); await onSaved(); }}
        />
      )}
      <p className="admin-muted small">المنتجات هي نفسها منتجات كتالوج الموقع ومربوطة بالكود. المنتج اللي بتضيفيه من هنا بيظهر على الموقع للبيع خلال ثواني، وبيتعدل من زرار &quot;تعديل المنتج&quot;؛ منتجات الموقع الأساسية بتتعدل من الكود. المصنع الافتراضي لكل المنتجات &quot;مصنع القاهرة&quot;. سعر البيع هو السعر الحالي على الموقع (بيتعدل من بيانات المنتج)؛ قطع البيجامات والبلانكيت جوه العرض بتتباع بسعر العرض. سعر المصنع بيتحفظ مع كل أوردر وقت تأكيده، فتغييره بعد كده مش بيغيّر أرباح الأوردرات المؤكدة قبل كده.</p>
    </section>
  );
}

// ── Expenses ──────────────────────────────────────────────────────────────

type ExpenseForm = { name: string; category: ExpenseCategory; amount: string; date: string; notes: string };
const emptyForm = (): ExpenseForm => ({ name: "", category: "ads", amount: "", date: today(), notes: "" });

function Expenses({ expenses, range, onChanged }: { expenses: Expense[]; range: { from: string; to: string }; onChanged: () => Promise<void> }) {
  const api = useFinanceApi();
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const shown = expenses.filter((expense) => (!range.from || expense.date >= range.from) && (!range.to || expense.date <= range.to) && (!category || expense.category === category));
  const total = shown.reduce((sum, expense) => sum + expense.amount, 0);

  async function submit() {
    const amount = Number(form.amount);
    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0 || !form.date) {
      setError("اكتبي اسم المصروف ومبلغ أكبر من صفر والتاريخ.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify({ ...form, amount });
      if (editingId) await api(`/api/admin/finance/expenses/${editingId}`, { method: "PATCH", body });
      else await api("/api/admin/finance/expenses", { method: "POST", body });
      setForm(emptyForm());
      setEditingId(null);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(expense: Expense) {
    if (!window.confirm(`حذف المصروف "${expense.name}" (${money(expense.amount)})؟`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/finance/expenses/${expense.id}`, { method: "DELETE" });
      if (editingId === expense.id) {
        setEditingId(null);
        setForm(emptyForm());
      }
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحذف.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>المصروفات · Expenses</h2>
      </div>
      <div className="admin-fin-form">
        <label className="admin-field"><span>اسم المصروف</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="admin-field"><span>التصنيف</span>
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseCategory })}>
            {EXPENSE_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="admin-field"><span>المبلغ (ج.م)</span><input type="number" min={0} inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
        <label className="admin-field"><span>التاريخ</span><input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
        <label className="admin-field wide"><span>ملاحظات</span><input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <div className="admin-fin-form-actions">
          <button type="button" className="admin-primary" disabled={busy} onClick={() => void submit()}>{editingId ? <><Save size={15} /> حفظ التعديل</> : <><Plus size={15} /> إضافة مصروف</>}</button>
          {editingId && <button type="button" className="admin-chip" onClick={() => { setEditingId(null); setForm(emptyForm()); }}><X size={14} /> إلغاء التعديل</button>}
        </div>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-filters">
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="التصنيف">
          <option value="">كل التصنيفات</option>
          {EXPENSE_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span className="admin-muted">{shown.length} مصروف في الفترة · الإجمالي <strong>{money(total)}</strong></span>
      </div>
      {shown.length === 0 ? <p className="admin-muted empty">مفيش مصروفات في الفترة دي.</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>التاريخ</th><th>المصروف</th><th>التصنيف</th><th>المبلغ</th><th>ملاحظات</th><th>إجراء</th></tr></thead>
            <tbody>
              {shown.map((expense) => (
                <tr key={expense.id}>
                  <td dir="ltr">{expense.date}</td>
                  <td>{expense.name}</td>
                  <td>{CATEGORY_LABEL[expense.category] ?? expense.category}</td>
                  <td>{money(expense.amount)}</td>
                  <td className="wrap">{expense.notes || "—"}</td>
                  <td className="actions">
                    <button type="button" disabled={busy} onClick={() => { setEditingId(expense.id); setForm({ name: expense.name, category: expense.category, amount: String(expense.amount), date: expense.date, notes: expense.notes }); }}><Pencil size={14} /> تعديل</button>
                    <button type="button" disabled={busy} className="danger" onClick={() => void remove(expense)} aria-label="حذف"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-muted small">سجلي تكلفة شركة الشحن للأوردرات في &quot;شحن الأوردرات للعميلات&quot;، وشحن المرتجعات في &quot;شحن المرتجعات&quot;. الشحن اللي العميلة دفعته داخل في المبيعات، فمش بيتحسب مصروف لوحده.</p>
    </section>
  );
}

// ── Profit per order ──────────────────────────────────────────────────────

function OrdersProfit({ report }: { report: FinanceReport }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>الأوردرات المحسوبة ({report.orders.length})</h2>
      </div>
      {report.orders.length === 0 ? <p className="admin-muted empty">مفيش أوردرات مؤكدة أو مرتجعة في الفترة دي.</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>المصدر</th><th>الحالة</th><th>القطع</th><th>المبيعات</th><th>تكلفة المنتجات</th><th>المكسب قبل المصروفات</th></tr></thead>
            <tbody>
              {report.orders.map((row) => (
                <tr key={row.orderId} className={row.status === "returned" ? "dim" : ""}>
                  <td dir="ltr" className="mono">{row.orderId}</td>
                  <td dir="ltr">{row.day}</td>
                  <td>{row.source === "site" ? "الموقع" : "تيليجرام"}</td>
                  <td><span className={`status ${row.status}`}>{row.status === "returned" ? "مرتجع · مش محسوب" : "بيع مؤكد"}</span></td>
                  <td>{row.pieces}</td>
                  <td>{row.status === "returned" ? "—" : money(row.sales)}</td>
                  <td>
                    {row.status === "returned" ? "—" : money(row.productsCost)}
                    {row.costState === "estimated" && <span className="admin-flag warn">تقديرية</span>}
                    {row.costState === "missing" && <span className="admin-flag warn">ناقصة {row.missingLines} منتج</span>}
                  </td>
                  <td>{row.status === "returned" ? "—" : <span className={row.profit < 0 ? "admin-negative" : ""}>{money(row.profit)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-muted small">التاريخ هو يوم الأوردر. الأوردر اللي موجود في الموقع وفي تيليجرام بيتحسب مرة واحدة من الموقع. &quot;تقديرية&quot; = اتأكد قبل تسجيل سعر المصنع، فمحسوب بالسعر الحالي.</p>
    </section>
  );
}

// ── Add / edit a product (shown on the site for sale) ─────────────────────

type ProductForm = { name: string; category: CatalogCategory; price: string; imageAlt: string; maxWeightKg: string; hidden: boolean; factory: string; cost: string };

const MAX_IMAGE_SIDE = 1200;
const MAX_IMAGE_BASE64 = 850_000;

/** Resizes the chosen photo in the browser to a JPEG small enough to store (≤ ~600 KB). */
async function photoToBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[MAX_IMAGE_SIDE, 0.85], [1000, 0.8], [800, 0.75], [700, 0.7]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) break;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    if (base64.length <= MAX_IMAGE_BASE64) return base64;
  }
  throw new Error("الصورة كبيرة جدًا حتى بعد تصغيرها. جربي صورة تانية.");
}

function ProductDialog({ product, factories, onNewFactory, onClose, onSaved }: {
  product: ProductRow | null;
  factories: string[];
  onNewFactory: () => Promise<string | null>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const api = useFinanceApi();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editing = product !== null;
  const [form, setForm] = useState<ProductForm>(() => ({
    name: product?.name ?? "",
    category: product?.category ?? "abayas",
    price: product?.price != null ? String(product.price) : "",
    imageAlt: product?.imageAlt ?? "",
    maxWeightKg: product?.maxWeightKg != null ? String(product.maxWeightKg) : "",
    hidden: product?.hidden ?? false,
    factory: product?.factory ?? factories[0] ?? "",
    cost: product?.cost != null ? String(product.cost) : "",
  }));
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const set = <K extends keyof ProductForm>(field: K, value: ProductForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const offerOnly = form.category === "winter-pajamas" || form.category === "wearable-blankets";
  const categoryPrice = categoryPrices[form.category];

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const base64 = await photoToBase64(file);
      setPhoto({ base64, preview: `data:image/jpeg;base64,${base64}` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نقرا الصورة.");
    }
  }

  async function save() {
    if (!editing && !photo) {
      setError("ارفعي صورة المنتج.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name,
        category: form.category,
        price: form.price.trim() === "" ? null : Number(form.price),
        imageAlt: form.imageAlt,
        maxWeightKg: form.category === "winter-pajamas" && form.maxWeightKg.trim() ? Number(form.maxWeightKg) : null,
        hidden: form.hidden,
        ...(photo ? { image: photo.base64 } : {}),
        ...(!editing ? { factory: form.factory, cost: form.cost.trim() === "" ? null : Number(form.cost) } : {}),
      };
      if (editing) await api(`/api/admin/products/${product.productId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ المنتج.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="admin-dialog" dir="rtl" aria-labelledby="product-dialog-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="product-dialog-title" className="admin-dialog-plain-title">{editing ? `تعديل ${product.name}` : "إضافة منتج جديد للموقع"}</h2>
            <p className="admin-muted">{editing ? <span dir="ltr">{product.productId}</span> : "المنتج هيظهر على الموقع للبيع (إلا لو علّمتي إخفاء)، وبكود ثابت بيتربط بيه في الأوردرات والحسابات."}</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-product-form">
          <label className="admin-photo-pick">
            {photo || product?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen photo
              <img src={photo?.preview ?? product?.image} alt="" />
            ) : (
              <span><ImagePlus size={26} aria-hidden="true" /> ارفعي صورة المنتج</span>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} aria-label="صورة المنتج" />
            {(photo || product?.image) && <small>دوسي لتغيير الصورة</small>}
          </label>

          <div className="admin-edit-grid">
            <label className="admin-field wide"><span>اسم المنتج</span><input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="مثلاً: عباية قطيفة كحلي بتطريز ذهبي" /></label>
            <label className="admin-field"><span>القسم</span>
              <select value={form.category} disabled={editing} onChange={(event) => set("category", event.target.value as CatalogCategory)}>
                {categoryOrder.map((category) => <option key={category} value={category}>{categoryInfo[category].singular}</option>)}
              </select>
            </label>
            <label className="admin-field"><span>سعر البيع للقطعة (ج.م)</span>
              <input type="number" min={1} inputMode="numeric" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder={offerOnly ? (categoryPrice ? `فاضي = ${categoryPrice}` : "فاضي = ضمن العرض بس") : (categoryPrice ? String(categoryPrice) : "")} />
            </label>
            {form.category === "winter-pajamas" && (
              <label className="admin-field"><span>المقاس: One Size لحد كام كيلو</span>
                <input type="number" min={30} max={200} inputMode="numeric" value={form.maxWeightKg} onChange={(event) => set("maxWeightKg", event.target.value)} placeholder="فاضي = 85–90" />
              </label>
            )}
            <label className="admin-field wide"><span>وصف الصورة (للي مش شايفة الصورة وللبحث)</span><input value={form.imageAlt} onChange={(event) => set("imageAlt", event.target.value)} placeholder="مثلاً: عباية كحلي طويلة بتطريز ذهبي على الصدر" /></label>
            {!editing && (
              <>
                <label className="admin-field"><span>المصنع</span>
                  <select value={form.factory} onChange={async (event) => {
                    if (event.target.value !== "__new") return set("factory", event.target.value);
                    const name = await onNewFactory();
                    if (name) set("factory", name);
                  }}>
                    {[...new Set([...factories, form.factory].filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}
                    <option value="__new">＋ مصنع جديد…</option>
                  </select>
                </label>
                <label className="admin-field"><span>سعر المصنع للقطعة (ج.م)</span><input type="number" min={0} inputMode="decimal" value={form.cost} onChange={(event) => set("cost", event.target.value)} placeholder="اختياري" /></label>
              </>
            )}
            <label className="admin-check wide"><input type="checkbox" checked={form.hidden} onChange={(event) => set("hidden", event.target.checked)} /> إخفاء من الموقع (يتحفظ بس مايظهرش للعميلات)</label>
          </div>
          {editing && <p className="admin-muted small">المصنع وسعر المصنع بيتعدلوا من جدول المنتجات. القسم ثابت لأن كود المنتج مربوط بيه.</p>}
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={busy} onClick={() => void save()}>{busy ? "جاري الحفظ…" : editing ? "حفظ التعديل" : "إضافة المنتج للموقع"}</button>
        </footer>
      </div>
    </dialog>
  );
}

// ── Pricing calculator ────────────────────────────────────────────────────

function PricingCalculator({ products, report }: { products: ProductRow[]; report: FinanceReport }) {
  const soldPieces = report.orders.filter((row) => row.status === "confirmed").reduce((sum, row) => sum + row.pieces, 0);
  const [expenses, setExpenses] = useState(String(report.totals.expenses || ""));
  const [pieces, setPieces] = useState(String(soldPieces || ""));
  const [percent, setPercent] = useState("30");
  const [onlyMine, setOnlyMine] = useState(false);
  const input = { expenses: Number(expenses) || 0, pieces: Math.max(0, Math.round(Number(pieces) || 0)), profitPercent: Number(percent) || 0 };
  const rows = pricingRows(products.filter((product) => !product.hidden || product.cost !== null), input).filter((row) => !onlyMine || row.currentProfitPercent < input.profitPercent);
  const missing = products.filter((product) => !product.hidden && product.cost === null).length;
  const share = input.pieces > 0 ? input.expenses / input.pieces : 0;

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2><Calculator size={18} aria-hidden="true" /> حاسبة التسعير والهامش</h2>
      </div>
      <div className="admin-calc-inputs">
        <label className="admin-field"><span>المصروفات اللي هتتوزع (ج.م)</span><input type="number" min={0} value={expenses} onChange={(event) => setExpenses(event.target.value)} /></label>
        <label className="admin-field"><span>على كام قطعة؟</span><input type="number" min={0} value={pieces} onChange={(event) => setPieces(event.target.value)} /></label>
        <label className="admin-field"><span>هامش الربح اللي عايزاه (%)</span><input type="number" min={0} value={percent} onChange={(event) => setPercent(event.target.value)} /></label>
        <div className="admin-calc-share">
          <span>كل قطعة بتشيل من المصروفات</span>
          <strong>{money(share)}</strong>
        </div>
      </div>
      <p className="admin-muted small">
        المصروفات والقطع متعبّية تلقائيًا من الفترة المختارة فوق ({money(report.totals.expenses)} مصروفات مخصومة، {soldPieces} قطعة اتباعت في أوردرات مؤكدة) — غيّريهم براحتك، مثلاً حطي مصروفات الشهر وعدد القطع اللي متوقعة تبيعيها.
        الهامش محسوب على التكلفة الكاملة للقطعة (سعر المصنع + نصيبها من المصروفات)، والسعر المقترح مقرّب لأقرب ٥ ج.م لفوق.
      </p>
      <label className="admin-check"><input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} /> اعرضي بس المنتجات اللي هامشها الحالي أقل من {input.profitPercent}%</label>
      {rows.length === 0 ? <p className="admin-muted empty">{missing > 0 ? "سجّلي سعر المصنع للمنتجات في الجدول اللي فوق علشان الحاسبة تشتغل." : "مفيش منتجات بالاختيار ده."}</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>المنتج</th><th>سعر المصنع</th><th>نصيبها من المصروفات</th><th>التكلفة الكاملة</th><th>السعر الحالي</th><th>المكسب الحالي في القطعة</th><th>السعر المقترح ({input.profitPercent}%)</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId}>
                  <td>{row.name}</td>
                  <td>{money(row.cost)}</td>
                  <td>{money(row.expenseShare)}</td>
                  <td><strong>{money(row.fullCost)}</strong></td>
                  <td>{money(row.currentPrice)}{row.inOfferOnly && <small className="admin-muted"> (في العرض)</small>}</td>
                  <td><span className={row.currentProfit < 0 ? "admin-negative" : row.currentProfitPercent < input.profitPercent ? "admin-warn" : "admin-positive"}>{money(row.currentProfit)} · {row.currentProfitPercent}%</span></td>
                  <td><strong className="admin-suggested">{money(row.suggestedPrice)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {missing > 0 && rows.length > 0 && <p className="admin-muted small">{missing} منتج مالوش سعر مصنع لسه ومش ظاهر في الحاسبة.</p>}
      <p className="admin-muted small">قطع العرض بتتحسب بسعر القطعة جوه العرض ({money(OFFER_PIECE_PRICE)} = سعر العرض ÷ عدد قطعه). الحاسبة للتخطيط بس ومش بتغيّر أسعار الموقع.</p>
    </section>
  );
}
