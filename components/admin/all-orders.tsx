"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, PackageCheck, RefreshCw, RotateCcw, Undo2, XCircle } from "lucide-react";

import { WhatsAppLink, WhatsAppMenu } from "@/components/admin/whatsapp-link";
import { ORDER_FILTERS, filterCounts, matchesFilter, matchesSearch, type OrderFilter, type UnifiedOrder } from "@/lib/all-orders";
import type { OrderStatus } from "@/lib/analytics-report";
import { confirmationMessage, orderMessage, unavailableMessage, weightMessage, whatsappChatUrl } from "@/lib/customer-whatsapp";
import { formatEGP } from "@/lib/format";
import { productImage } from "@/lib/quantity-summary";
import { findProduct } from "@/lib/site-data";

const STATUS_LABELS: Record<OrderStatus, string> = { submitted: "مستني تأكيد", confirmed: "بيع مؤكد", delivered: "تم الاستلام", cancelled: "اتلغى", returned: "مرتجع" };
const PAGE_SIZE = 30;
const cairoTime = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");

export function AllOrdersTab() {
  const router = useRouter();
  const [orders, setOrders] = useState<UnifiedOrder[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [source, setSource] = useState<"" | "site" | "telegram">("");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/all-orders", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نجيب الأوردرات.");
        return;
      }
      setError("");
      setOrders(result.orders);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Loading the orders when the section opens is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const scoped = useMemo(() => (orders ?? []).filter((order) => (!source || order.source === source) && (showArchived || !order.archived) && matchesSearch(order, query)), [orders, source, showArchived, query]);
  const counts = useMemo(() => filterCounts(scoped), [scoped]);
  const rows = scoped.filter((order) => matchesFilter(order, filter));
  const shown = rows.slice(0, limit);

  /** Sends a status or deposit change to the right API (site order or imported Telegram order), then updates the row. */
  async function change(order: UnifiedOrder, body: { status?: OrderStatus; deposit?: number | null }) {
    setBusyId(order.orderId);
    setError("");
    try {
      const url = order.source === "site" ? `/api/admin/orders/${order.orderId}` : `/api/admin/old-orders/${order.orderId}`;
      const payload = order.source === "site" && body.status ? { status: body.status, confirmedValue: null } : body;
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ.");
        return;
      }
      const saved = result.order as { status?: OrderStatus; deposit?: UnifiedOrder["deposit"] };
      setOrders((current) => current?.map((item) => item.orderId === order.orderId
        ? { ...item, ...(saved.status ? { status: saved.status } : body.status ? { status: body.status } : {}), ...("deposit" in body ? { deposit: saved.deposit ?? null } : {}) }
        : item) ?? null);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setBusyId("");
    }
  }

  function askDeposit(order: UnifiedOrder) {
    const answer = window.prompt(`مبلغ الديبوزيت لتأكيد حجز ${order.orderId} (ج.م) — سيبيها فاضية لإلغاء الديبوزيت:`, order.deposit ? String(order.deposit.amount) : "");
    if (answer === null) return;
    const digits = answer.replace(/[^\d.]/g, "");
    void change(order, { deposit: digits ? Number(digits) : null });
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>كل الأوردرات {orders && `(${scoped.length})`}</h2>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>

      <div className="admin-order-filters" role="group" aria-label="فلتر الحالة">
        {ORDER_FILTERS.map((item) => (
          <button key={item.id} type="button" className={`admin-filter-chip filter-${item.id}${filter === item.id ? " active" : ""}`} aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setLimit(PAGE_SIZE); }}>
            {item.label} <span>{counts[item.id] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="admin-filters">
        <input type="search" className="admin-search" placeholder="بحث: رقم الطلب، الاسم، الموبايل، العنوان، المنتج" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} aria-label="بحث" />
        <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="المصدر">
          <option value="">أوردرات الموقع وتيليجرام</option>
          <option value="site">أوردرات الموقع بس</option>
          <option value="telegram">أوردرات تيليجرام القديمة بس</option>
        </select>
        <label className="admin-check"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> اعرضي المؤرشف</label>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!orders && !error && <p className="admin-muted">جاري التحميل…</p>}
      {orders && rows.length === 0 && <p className="admin-muted empty">مفيش أوردرات بالاختيار ده.</p>}

      <div className="admin-orders">
        {shown.map((order) => <UnifiedOrderCard key={order.orderId} order={order} busy={busyId === order.orderId} onStatus={(status) => void change(order, { status })} onDeposit={() => askDeposit(order)} />)}
      </div>
      {rows.length > shown.length && (
        <button type="button" className="admin-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>اعرضي {Math.min(PAGE_SIZE, rows.length - shown.length)} أوردر كمان ({rows.length - shown.length} باقيين)</button>
      )}
      <p className="admin-muted small">أوردرات الموقع والأوردرات القديمة من تيليجرام في مكان واحد، وكل أوردر مرة واحدة. أي تغيير هنا (الحالة أو الديبوزيت) بيتحفظ في نفس الأوردر وبيظهر في باقي الأقسام والحسابات.</p>
    </section>
  );
}

function UnifiedOrderCard({ order, busy, onStatus, onDeposit }: { order: UnifiedOrder; busy: boolean; onStatus: (status: OrderStatus) => void; onDeposit: () => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const chat = (text: string) => (order.phone ? whatsappChatUrl(order.phone, text) : null);
  const remaining = order.deposit && order.total !== null ? Math.max(0, order.total - order.deposit.amount) : null;
  return (
    <article className={`admin-order status-${order.status}`}>
      <header className="admin-order-head">
        <div>
          <strong dir="ltr" className="mono">{order.orderId}</strong>
          <span className="admin-muted" dir="ltr">{cairoTime(order.createdAt)}</span>
          <span className={`status ${order.status}`}>{STATUS_LABELS[order.status]}</span>
          {order.deposit && <span className="admin-deposit"><BadgeCheck size={14} aria-hidden="true" /> ديبوزيت {formatEGP(order.deposit.amount)}</span>}
          {order.archived && <small className="admin-muted">مؤرشف</small>}
        </div>
        <div className="admin-order-source">
          <span className={`admin-source-badge ${order.source}`}>{order.source === "site" ? "الموقع" : "تيليجرام"}</span>
          {order.origin && <small> · {order.origin}</small>}
        </div>
      </header>

      <div className="admin-order-body">
        <section className="admin-order-customer" aria-label="بيانات العميلة">
          {order.hasCustomer ? (
            <dl className="admin-dl">
              <div><dt>الاسم</dt><dd>{order.customerName || "—"}</dd></div>
              <div><dt>الموبايل</dt><dd dir="ltr">{order.phone ? <a href={`tel:${order.phone}`}>{order.phone}</a> : "—"}{order.alternatePhone && <> · <a href={`tel:${order.alternatePhone}`}>{order.alternatePhone}</a></>}</dd></div>
              <div><dt>المحافظة / المنطقة</dt><dd>{[order.governorate, order.area].filter(Boolean).join(" — ") || "—"}</dd></div>
              <div className="wide"><dt>العنوان</dt><dd>{order.address || "—"}</dd></div>
              {order.notes && <div className="wide"><dt>ملاحظات</dt><dd className="pre">{order.notes}</dd></div>}
              <div className="wide">
                <WhatsAppMenu options={[
                  { label: "✅ تأكيد الطلب والتوصيل (إنستا باي)", href: chat(confirmationMessage({ name: order.customerName, orderId: order.orderId, shippingCost: order.shippingCost })) },
                  { label: "⚖️ سؤال عن الوزن", href: chat(weightMessage({ name: order.customerName, orderId: order.orderId })) },
                  { label: "💬 رسالة عادية", href: chat(orderMessage({ name: order.customerName, orderId: order.orderId })) },
                ]} />
              </div>
            </dl>
          ) : (
            <p className="admin-muted small">بيانات العميلة مش متسجلة للأوردر ده. ارفعي ملف تيليجرام في &quot;الأوردرات القديمة&quot; علشان تتكمل. المحافظة: {order.governorate || "—"}</p>
          )}
        </section>

        <section className="admin-order-items" aria-label="المنتجات">
          <p className="admin-order-offer">{order.offerName}</p>
          <ul>
            {order.products.map((product, index) => {
              const image = productImage(product.modelId);
              const catalog = findProduct(product.modelId);
              return (
                <li key={`${product.modelId}-${index}`}>
                  {image ? (
                    <a href={image} target="_blank" rel="noreferrer" className="admin-order-thumb" aria-label={`صورة ${product.name}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail */}
                      <img src={image} alt="" width={56} height={56} loading="lazy" />
                    </a>
                  ) : <span className="admin-order-thumb missing" title="الصورة مش متاحة">مفيش صورة</span>}
                  <div>
                    <strong>{product.name}</strong>
                    {product.size && <small>{product.size}</small>}
                  </div>
                  <span className="qty">× {product.quantity}</span>
                  <span className="price">{product.unitPrice === null ? "ضمن العرض" : formatEGP(product.unitPrice * product.quantity)}</span>
                  {order.phone && (
                    <WhatsAppLink compact href={chat(unavailableMessage({ name: order.customerName, orderId: order.orderId, productName: product.name, productId: product.modelId, origin, category: catalog?.category }))} label={`${product.name} مش متوفر — ابعتي بدائل`} />
                  )}
                  {order.phone && catalog?.category === "winter-pajamas" && (
                    <WhatsAppLink compact text="وزنها؟" href={chat(weightMessage({ name: order.customerName, orderId: order.orderId, productName: product.name, productId: product.modelId }))} label={`اسألي عن وزنها علشان ${product.name}`} />
                  )}
                </li>
              );
            })}
          </ul>
          <dl className="admin-totals">
            <div><dt>الشحن</dt><dd>{order.shippingCost === null ? "لسه هيتأكد" : formatEGP(order.shippingCost)}</dd></div>
            <div className="grand"><dt>الإجمالي</dt><dd>{order.total === null ? `${formatEGP(order.value)} + الشحن` : formatEGP(order.total)}</dd></div>
            {order.deposit && <div><dt>ديبوزيت مدفوع</dt><dd>− {formatEGP(order.deposit.amount)}</dd></div>}
            {remaining !== null && <div className="grand"><dt>الباقي عند الاستلام</dt><dd>{formatEGP(remaining)}</dd></div>}
          </dl>
        </section>
      </div>

      <footer className="admin-order-actions actions">
        <button type="button" disabled={busy} onClick={onDeposit} className={order.deposit ? "deposit-on" : undefined}><BadgeCheck size={15} /> {order.deposit ? "تعديل الديبوزيت" : "تأكيد بديبوزيت"}</button>
        {order.status !== "confirmed" && order.status !== "delivered" && <button type="button" disabled={busy} onClick={() => onStatus("confirmed")} title="بيع مؤكد"><CheckCircle2 size={16} /> تأكيد</button>}
        {order.status === "confirmed" && <button type="button" disabled={busy} className="good" onClick={() => onStatus("delivered")} title="العميلة استلمت"><PackageCheck size={16} /> تم الاستلام</button>}
        {(order.status === "confirmed" || order.status === "delivered") && <button type="button" disabled={busy} className="danger" onClick={() => onStatus("returned")} title="الأوردر رجع"><Undo2 size={16} /> مرتجع</button>}
        {order.status !== "cancelled" && order.status !== "returned" && order.status !== "delivered" && <button type="button" disabled={busy} className="danger" onClick={() => onStatus("cancelled")} title="إلغاء"><XCircle size={16} /> إلغاء</button>}
        {order.status !== "submitted" && <button type="button" disabled={busy} onClick={() => onStatus("submitted")} title="رجوع لمستني تأكيد" aria-label="رجوع لمستني تأكيد"><RotateCcw size={15} /></button>}
      </footer>
    </article>
  );
}
