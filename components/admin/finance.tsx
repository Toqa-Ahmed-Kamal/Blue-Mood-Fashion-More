"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ImageOff, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type FinanceReport } from "@/lib/finance";
import { formatEGP } from "@/lib/format";
import type { CatalogCategory } from "@/lib/site-data";

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
};
type Data = { report: FinanceReport; products: ProductRow[]; expenses: Expense[]; vaultConfigured: boolean; unreadableOldOrders: number };

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
            <div className="admin-fin-categories">
              {report.expensesByCategory.filter((row) => row.amount > 0).map((row) => <span key={row.category}>{row.label}: <strong>{money(row.amount)}</strong></span>)}
            </div>
          </>
        )}
      </section>

      {data && (
        <>
          <ProductsPricing products={data.products} onSaved={load} />
          <Expenses expenses={data.expenses} range={range} onChanged={load} />
          {report && <OrdersProfit report={report} />}
        </>
      )}
    </>
  );
}

// ── Products & Pricing ────────────────────────────────────────────────────

function ProductsPricing({ products, onSaved }: { products: ProductRow[]; onSaved: () => Promise<void> }) {
  const api = useFinanceApi();
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { factory: string; cost: string }>>({});
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
      setDrafts((current) => {
        const next = { ...current };
        delete next[product.productId];
        return next;
      });
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
      </div>
      <div className="admin-filters">
        <input type="search" className="admin-search" placeholder="بحث باسم المنتج أو الكود" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="بحث" />
        <label className="admin-check"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> اعرضي المنتجات المخفية من الموقع</label>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table admin-fin-products">
          <thead><tr><th>المنتج</th><th>الكود</th><th>المصنع</th><th>سعر المصنع للقطعة</th><th>سعر البيع للقطعة</th><th>هامش القطعة</th><th /></tr></thead>
          <tbody>
            {rows.map((product) => {
              const draft = drafts[product.productId];
              const factory = draft?.factory ?? product.factory;
              const costText = draft?.cost ?? (product.cost === null ? "" : String(product.cost));
              const cost = costText.trim() === "" ? null : Number(costText);
              const margin = product.salePrice !== null && cost !== null && Number.isFinite(cost) ? product.salePrice - cost : null;
              const edit = (change: Partial<{ factory: string; cost: string }>) =>
                setDrafts((current) => ({ ...current, [product.productId]: { factory, cost: costText, ...change } }));
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
                  <td><input className="admin-inline-input" value={factory} placeholder="اسم المصنع" onChange={(event) => edit({ factory: event.target.value })} aria-label={`مصنع ${product.name}`} /></td>
                  <td><input className="admin-inline-input narrow" type="number" min={0} inputMode="decimal" value={costText} placeholder="—" onChange={(event) => edit({ cost: event.target.value })} aria-label={`سعر المصنع ${product.name}`} /></td>
                  <td>{product.salePrice === null ? <span className="admin-muted">ضمن العرض بس</span> : money(product.salePrice)}</td>
                  <td>{margin === null ? "—" : <span className={margin < 0 ? "admin-negative" : ""}>{money(margin)}</span>}</td>
                  <td className="actions">
                    {draft && <button type="button" disabled={busy === product.productId} onClick={() => void save(product)}><Save size={14} /> حفظ</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="admin-muted small">المنتجات هي نفسها منتجات كتالوج الموقع ومربوطة بالكود. سعر البيع هو السعر الحالي على الموقع (بيتعدل من بيانات المنتج)؛ قطع البيجامات والبلانكيت جوه العرض بتتباع بسعر العرض. سعر المصنع بيتحفظ مع كل أوردر وقت تأكيده، فتغييره بعد كده مش بيغيّر أرباح الأوردرات المؤكدة قبل كده.</p>
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
