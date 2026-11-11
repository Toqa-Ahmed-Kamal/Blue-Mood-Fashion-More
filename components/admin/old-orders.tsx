"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, BadgeCheck, CheckCircle2, Download, FileUp, Pencil, Plus, RotateCcw, Trash2, Undo2, X, XCircle } from "lucide-react";

import { WhatsAppLink } from "@/components/admin/whatsapp-link";
import type { OrderStatus } from "@/lib/analytics-report";
import { orderMessage, unavailableMessage, whatsappChatUrl } from "@/lib/customer-whatsapp";
import { formatEGP } from "@/lib/format";
import {
  aggregateQuantities,
  findDuplicates,
  oldOrderPieces,
  oldOrderValue,
  parseTelegramExport,
  phoneKey,
  type DuplicateInfo,
  type OldOrder,
  type OldOrderProduct,
  type ParsedOldOrder,
} from "@/lib/old-orders";
import { productImage } from "@/lib/quantity-summary";
import { categoryInfo, findProduct } from "@/lib/site-data";
import { buildXlsx, type XlsxCell } from "@/lib/xlsx";

const STATUS_LABELS: Record<OrderStatus, string> = { submitted: "مستني تأكيد", confirmed: "بيع مؤكد", cancelled: "اتلغى", returned: "مرتجع" };
const IMPORT_BATCH = 50;
const CHECK_BATCH = 500;
const PAGE_SIZE = 50;

const cairoTime = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");
const cairoDay = (iso: string) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(iso)) : "");

type LiveState = "details" | "no_details";
type PreviewRow = ParsedOldOrder & { selected: boolean };
type ApiError = { error?: { message?: string } } | null;

/** fetch + JSON with the admin's usual handling of an expired session. */
function useAdminApi() {
  const router = useRouter();
  return useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (response.status === 401) {
      router.replace("/admin/login");
      throw new Error("انتهت الجلسة.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error((result as ApiError)?.error?.message ?? "حصلت مشكلة. جربي تاني.");
    return result;
  }, [router]);
}

export function OldOrdersTab() {
  const api = useAdminApi();
  const [orders, setOrders] = useState<OldOrder[] | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [error, setError] = useState("");

  /** Reloads the saved orders from the server; returns them (null on failure). */
  const load = useCallback(async (): Promise<OldOrder[] | null> => {
    try {
      const result = await api("/api/admin/old-orders");
      setOrders(result.orders);
      setUnreadable(result.unreadable);
      setError("");
      return result.orders as OldOrder[];
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل الأوردرات القديمة.");
      return null;
    }
  }, [api]);

  useEffect(() => {
    // Loading the saved orders when the tab opens is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function replace(order: OldOrder) {
    setOrders((current) => current?.map((item) => (item.orderId === order.orderId ? order : item)) ?? null);
  }

  return (
    <>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {unreadable > 0 && <p className="admin-note">فيه {unreadable} أوردر متخزن مش قادرين نفكه بالمفتاح الحالي (ORDER_DATA_KEY اتغير).</p>}
      <ImportPanel saved={orders ?? []} ready={orders !== null} onImported={load} />
      {orders === null ? (!error && <p className="admin-muted">جاري التحميل…</p>) : (
        <SavedOrders orders={orders} onUpdated={replace} onDeleted={(id) => setOrders((current) => current?.filter((item) => item.orderId !== id) ?? null)} />
      )}
    </>
  );
}

// ── Import ────────────────────────────────────────────────────────────────

function ImportPanel({ saved, ready, onImported }: { saved: OldOrder[]; ready: boolean; onImported: () => Promise<OldOrder[] | null> }) {
  const api = useAdminApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const duplicates = useMemo(() => findDuplicates(rows.map((row) => row.order), saved), [rows, saved]);
  const selected = rows.filter((row) => row.selected && !duplicates[row.order.orderId]?.alreadySaved);
  const unsaved = rows.filter((row) => !duplicates[row.order.orderId]?.alreadySaved).length;

  // A preview lives only in this page: warn before it is closed or reloaded with orders not saved yet.
  useEffect(() => {
    if (unsaved === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  async function readFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError("");
    setMessage("");
    const found = new Map<string, ParsedOldOrder>();
    for (const file of [...list]) {
      const parsed = parseTelegramExport(await file.text());
      for (const item of parsed) if (!found.has(item.order.orderId)) found.set(item.order.orderId, item);
    }
    if (found.size === 0) {
      setRows([]);
      setError("مفيش رسايل أوردرات في الملف ده. اتأكدي إنه Export لشات الأوردرات من Telegram Desktop بصيغة HTML (messages.html).");
      return;
    }
    const savedIds = new Set(saved.map((order) => order.orderId));
    const parsed = [...found.values()].toSorted((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
    setRows(parsed.map((item) => ({ ...item, selected: !savedIds.has(item.order.orderId) })));
    setFiles([...list].map((file) => file.name));
    if (inputRef.current) inputRef.current.value = "";

    // Which of them are also orders in the dashboard (their customer details can be filled in).
    const ids = parsed.map((item) => item.order.orderId);
    const states: Record<string, LiveState> = {};
    try {
      for (let start = 0; start < ids.length; start += CHECK_BATCH) {
        const result = await api("/api/admin/old-orders/check", { method: "POST", body: JSON.stringify({ ids: ids.slice(start, start + CHECK_BATCH) }) });
        Object.assign(states, result.live);
      }
      setLive(states);
    } catch {
      setLive({});
    }
  }

  async function importSelected() {
    if (selected.length === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    const totals = { imported: 0, duplicates: 0, backfilled: 0 };
    const ids = selected.map((row) => row.order.orderId);
    try {
      for (let start = 0; start < selected.length; start += IMPORT_BATCH) {
        const batch = selected.slice(start, start + IMPORT_BATCH).map((row) => row.order);
        const result = await api("/api/admin/old-orders", { method: "POST", body: JSON.stringify({ orders: batch }) });
        totals.imported += result.imported.length;
        totals.duplicates += result.duplicates.length;
        totals.backfilled += result.backfilled.length;
      }
      // Confirm from the database itself (a fresh read), not only from the save response.
      const reloaded = await onImported();
      const savedNow = new Set((reloaded ?? []).map((order) => order.orderId));
      const missing = ids.filter((id) => !savedNow.has(id));
      if (!reloaded || missing.length > 0) {
        setError(`الحفظ ما اتأكدش: ${reloaded ? missing.length : ids.length} أوردر مش ظاهرين في قاعدة البيانات بعد الحفظ. المعاينة لسه موجودة، جربي تاني.`);
        return;
      }
      setRows([]);
      setFiles([]);
      setMessage(
        `✓ اتحفظ واتأكد من قاعدة البيانات: ${totals.imported} أوردر جديد.`
        + (totals.duplicates ? ` ${totals.duplicates} كانوا متسجلين قبل كده ومتكرروش.` : "")
        + (totals.backfilled ? ` واتكملت بيانات العميلة لـ ${totals.backfilled} أوردر في تبويب الأوردرات.` : "")
        + ` إجمالي الأوردرات القديمة المحفوظة دلوقتي: ${savedNow.size}، وبقوا محسوبين في حصر كميات المصنع.`,
      );
    } catch (caught) {
      setError(`${caught instanceof Error ? caught.message : "مقدرناش نحفظ."} (اللي اتحفظ قبل المشكلة مش هيتكرر لو جربتي تاني.)`);
    } finally {
      setBusy(false);
    }
  }

  const setRow = (orderId: string, change: (row: PreviewRow) => PreviewRow) =>
    setRows((current) => current.map((row) => (row.order.orderId === orderId ? change(row) : row)));
  const editingRow = rows.find((row) => row.order.orderId === editing);

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>استيراد أوردرات من تيليجرام</h2>
      </div>
      <div className="admin-import">
        <label className={`admin-upload${!ready ? " disabled" : ""}`}>
          <FileUp size={18} />
          <span>اختاري ملف الـ Export (messages.html)</span>
          <input ref={inputRef} type="file" accept=".html,.htm,text/html" multiple disabled={!ready || busy} onChange={(event) => void readFiles(event.target.files)} />
        </label>
        <p className="admin-muted small">
          من Telegram Desktop: افتحي شات الأوردرات ← ⋮ ← Export chat history ← Format: HTML. الملف بيتقري على جهازك، وبيتبعت للسيرفر بس الأوردرات اللي تختاريها، وبتتحفظ متشفرة. مفيش أي رسالة بتتبعت لتيليجرام أو للعميلات.
        </p>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}

      {rows.length > 0 && (
        <>
          {unsaved > 0 && (
            <div className="admin-unsaved" role="status">
              <span>⚠️ دي <strong>معاينة بس</strong>: الـ {unsaved} أوردر الجداد <strong>لسه ما اتحفظوش</strong> ومش داخلين في حصر الكميات. دوسي الزرار علشان يتحفظوا.</span>
              <button type="button" className="admin-primary" disabled={busy || selected.length === 0} onClick={() => void importSelected()}>
                {busy ? "جاري الحفظ…" : `احفظي ${selected.length} أوردر في قاعدة البيانات`}
              </button>
            </div>
          )}
          <div className="admin-import-summary">
            <span>{files.join("، ")}: <strong>{rows.length}</strong> أوردر</span>
            <span>جديد: <strong>{rows.filter((row) => !duplicates[row.order.orderId]?.alreadySaved).length}</strong></span>
            <span>متسجل قبل كده: <strong>{rows.filter((row) => duplicates[row.order.orderId]?.alreadySaved).length}</strong></span>
            <span>محتاج مراجعة: <strong>{rows.filter((row) => row.warnings.length > 0).length}</strong></span>
          </div>
          <div className="admin-filters">
            <button type="button" className="admin-chip" onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: !duplicates[row.order.orderId]?.alreadySaved })))}>تحديد كل الجديد</button>
            <button type="button" className="admin-chip" onClick={() => setRows((current) => current.map((row) => ({ ...row, selected: false })))}>إلغاء التحديد</button>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>استيراد</th><th>رقم الطلب</th><th>التاريخ</th><th>العميلة</th><th>الموبايل</th><th>المكان</th><th>القطع</th><th>الإجمالي</th><th>تنبيهات</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const info = duplicates[row.order.orderId];
                  return (
                    <tr key={row.order.orderId} className={info?.alreadySaved ? "dim" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`استيراد ${row.order.orderId}`}
                          checked={row.selected && !info?.alreadySaved}
                          disabled={info?.alreadySaved}
                          onChange={(event) => setRow(row.order.orderId, (current) => ({ ...current, selected: event.target.checked }))}
                        />
                      </td>
                      <td dir="ltr" className="mono">{row.order.orderId}</td>
                      <td dir="ltr">{cairoTime(row.order.createdAt)}</td>
                      <td>{row.order.customerName || "—"}</td>
                      <td dir="ltr">{row.order.phone || "—"}</td>
                      <td>{[row.order.governorate, row.order.area].filter(Boolean).join(" — ") || "—"}</td>
                      <td>{oldOrderPieces(row.order)}</td>
                      <td>{row.order.total === null ? `${formatEGP(oldOrderValue(row.order))} + الشحن` : formatEGP(row.order.total)}</td>
                      <td className="wrap"><Flags info={info} warnings={row.warnings} live={live[row.order.orderId]} /></td>
                      <td className="actions">
                        {!info?.alreadySaved && <button type="button" onClick={() => setEditing(row.order.orderId)}><Pencil size={14} /> تعديل</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-import-actions">
            <button type="button" className="admin-primary" disabled={busy || selected.length === 0} onClick={() => void importSelected()}>
              {busy ? "جاري الحفظ…" : `احفظي ${selected.length} أوردر في قاعدة البيانات`}
            </button>
            <button type="button" className="admin-chip" disabled={busy} onClick={() => { setRows([]); setFiles([]); }}>إلغاء</button>
          </div>
        </>
      )}

      {editingRow && (
        <OldOrderEditor
          order={editingRow.order}
          title="تعديل قبل الاستيراد"
          onClose={() => setEditing(null)}
          onSave={async (edited) => {
            setRow(edited.orderId, (row) => ({ ...row, order: edited, selected: true }));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function Flags({ info, warnings, live }: { info?: DuplicateInfo; warnings: string[]; live?: LiveState }) {
  const flags: { text: string; tone: "warn" | "info" | "ok" }[] = [];
  if (info?.alreadySaved) flags.push({ text: "متسجل قبل كده · مش هيتكرر", tone: "info" });
  if (info?.samePhone.length) flags.push({ text: `نفس رقم الموبايل مع ${info.samePhone.join("، ")}`, tone: "warn" });
  if (info?.sameName.length) flags.push({ text: `نفس اسم العميلة مع ${info.sameName.join("، ")}`, tone: "warn" });
  if (live === "no_details") flags.push({ text: "موجود في أوردرات الموقع من غير بيانات العميلة · هتتكمل منه", tone: "ok" });
  if (live === "details") flags.push({ text: "موجود في أوردرات الموقع", tone: "info" });
  for (const warning of warnings) flags.push({ text: warning, tone: "warn" });
  if (flags.length === 0) return <span className="admin-muted">—</span>;
  return (
    <span className="admin-flags">
      {flags.map((flag) => <span key={flag.text} className={`admin-flag ${flag.tone}`}>{flag.text}</span>)}
    </span>
  );
}

// ── Saved orders ──────────────────────────────────────────────────────────

function SavedOrders({ orders, onUpdated, onDeleted }: { orders: OldOrder[]; onUpdated: (order: OldOrder) => void; onDeleted: (id: string) => void }) {
  const api = useAdminApi();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [archived, setArchived] = useState<"active" | "archived" | "all">("active");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const governorates = useMemo(() => [...new Set(orders.map((order) => order.governorate).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar")), [orders]);
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const digits = phoneKey(query);
    return orders.filter((order) => {
      if (status && order.status !== status) return false;
      if (governorate && order.governorate !== governorate) return false;
      if (archived === "active" && order.archived) return false;
      if (archived === "archived" && !order.archived) return false;
      const day = cairoDay(order.createdAt);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (words.length === 0) return true;
      if (digits && (phoneKey(order.phone) === digits || phoneKey(order.alternatePhone) === digits)) return true;
      const haystack = [order.orderId, order.customerName, order.phone, order.alternatePhone, order.governorate, order.area, order.address, order.notes, order.offerName, ...order.products.map((product) => `${product.name} ${product.modelId} ${product.color}`)]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [orders, query, status, governorate, archived, from, to]);
  const shown = rows.slice(0, limit);

  async function patch(order: OldOrder, body: object) {
    setBusyId(order.orderId);
    setError("");
    try {
      const result = await api(`/api/admin/old-orders/${order.orderId}`, { method: "PATCH", body: JSON.stringify(body) });
      onUpdated(result.order);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function remove(order: OldOrder) {
    if (!window.confirm(`حذف الأوردر ${order.orderId} نهائيًا من الأوردرات القديمة؟ (الأرشفة بتخفيه من غير ما تمسحه.)`)) return;
    setBusyId(order.orderId);
    setError("");
    try {
      await api(`/api/admin/old-orders/${order.orderId}`, { method: "DELETE" });
      onDeleted(order.orderId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحذف.");
    } finally {
      setBusyId("");
    }
  }

  const editingOrder = orders.find((order) => order.orderId === editing);

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-head">
          <h2>الأوردرات القديمة المحفوظة ({rows.length}{rows.length !== orders.length ? ` من ${orders.length}` : ""})</h2>
        </div>
        <div className="admin-filters">
          <input type="search" className="admin-search" placeholder="بحث: رقم الطلب، الاسم، الموبايل، العنوان، المنتج" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} aria-label="بحث" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="الحالة">
            <option value="">كل الحالات</option>
            {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
          </select>
          <select value={governorate} onChange={(event) => setGovernorate(event.target.value)} aria-label="المحافظة">
            <option value="">كل المحافظات</option>
            {governorates.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={archived} onChange={(event) => setArchived(event.target.value as typeof archived)} aria-label="الأرشيف">
            <option value="active">من غير المؤرشف</option>
            <option value="archived">المؤرشف بس</option>
            <option value="all">الكل</option>
          </select>
          <label>من <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>لحد <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {orders.length === 0 ? <p className="admin-muted empty">مفيش أوردرات قديمة متحفظة لسه. ارفعي ملف تيليجرام من فوق.</p> : rows.length === 0 ? (
          <p className="admin-muted empty">مفيش أوردرات بالفلاتر دي.</p>
        ) : (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table orders">
                <thead>
                  <tr><th>رقم الطلب / التاريخ</th><th>العميلة</th><th>الموبايل</th><th>المكان</th><th>المنتجات</th><th>الإجمالي</th><th>الحالة</th><th>إجراء</th></tr>
                </thead>
                <tbody>
                  {shown.map((order) => {
                    const busy = busyId === order.orderId;
                    return (
                      <tr key={order.orderId} className={order.archived ? "dim" : ""}>
                        <td className="mono">
                          <button type="button" className="admin-link" dir="ltr" onClick={() => setEditing(order.orderId)}>{order.orderId}</button>
                          <br />
                          <small dir="ltr">{cairoTime(order.createdAt)}</small>
                        </td>
                        <td>{order.customerName || "—"}</td>
                        <td dir="ltr">{order.phone ? <a href={`tel:${order.phone}`}>{order.phone}</a> : "—"}</td>
                        <td>{[order.governorate, order.area].filter(Boolean).join(" — ") || "—"}</td>
                        <td className="wrap">
                          <span className="admin-muted">{order.offerName}</span>
                          <br />
                          <ul className="admin-mini-products">
                            {order.products.map((product, index) => (
                              <li key={`${product.modelId}-${index}`}>
                                <ProductThumb modelId={product.modelId} image={product.image} name={product.name} />
                                <span>{product.name}{product.quantity > 1 ? ` × ${product.quantity}` : ""}</span>
                                <WhatsAppLink
                                  compact
                                  href={whatsappChatUrl(order.phone, unavailableMessage({ name: order.customerName, orderId: order.orderId, productName: product.name, productId: product.modelId, origin: window.location.origin }))}
                                  label={`${product.name} مش متوفر — ابعتي بدائل`}
                                />
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>{order.total === null ? `${formatEGP(oldOrderValue(order))} + الشحن` : formatEGP(order.total)}</td>
                        <td>
                          <span className={`status ${order.status}`}>{STATUS_LABELS[order.status]}</span>
                          {order.archived && <small> · مؤرشف</small>}
                          {order.deposit && <span className="admin-deposit"><BadgeCheck size={13} aria-hidden="true" /> ديبوزيت {formatEGP(order.deposit.amount)}</span>}
                        </td>
                        <td className="actions wrap-actions">
                          <button type="button" disabled={busy} onClick={() => setEditing(order.orderId)}><Pencil size={14} /> تعديل</button>
                          <WhatsAppLink href={whatsappChatUrl(order.phone, orderMessage({ name: order.customerName, orderId: order.orderId }))} label="واتساب" />
                          <button type="button" disabled={busy} className={order.deposit ? "deposit-on" : undefined} onClick={() => {
                            const answer = window.prompt(`مبلغ الديبوزيت لتأكيد حجز ${order.orderId} (ج.م) — سيبيها فاضية لإلغاء الديبوزيت:`, order.deposit ? String(order.deposit.amount) : "");
                            if (answer === null) return;
                            const digits = answer.replace(/[^\d.]/g, "");
                            void patch(order, { deposit: digits ? Number(digits) : null });
                          }}><BadgeCheck size={14} /> {order.deposit ? "الديبوزيت" : "ديبوزيت"}</button>
                          {order.status !== "confirmed" && <button type="button" disabled={busy} onClick={() => void patch(order, { status: "confirmed" })}><CheckCircle2 size={14} /> تأكيد</button>}
                          {order.status !== "cancelled" && order.status !== "returned" && <button type="button" disabled={busy} className="danger" onClick={() => void patch(order, { status: "cancelled" })}><XCircle size={14} /> إلغاء</button>}
                          {order.status === "confirmed" && <button type="button" disabled={busy} className="danger" onClick={() => void patch(order, { status: "returned" })}><Undo2 size={14} /> مرتجع</button>}
                          {order.status !== "submitted" && <button type="button" disabled={busy} onClick={() => void patch(order, { status: "submitted" })} aria-label="رجوع لمستني تأكيد" title="رجوع لمستني تأكيد"><RotateCcw size={14} /></button>}
                          <button type="button" disabled={busy} onClick={() => void patch(order, { archived: !order.archived })}>
                            {order.archived ? <><ArchiveRestore size={14} /> استرجاع</> : <><Archive size={14} /> أرشفة</>}
                          </button>
                          <button type="button" disabled={busy} className="danger" onClick={() => void remove(order)} aria-label="حذف" title="حذف"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > shown.length && (
              <button type="button" className="admin-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                اعرضي {Math.min(PAGE_SIZE, rows.length - shown.length)} كمان ({rows.length - shown.length} باقيين)
              </button>
            )}
          </>
        )}
      </section>

      <QuantitiesPanel orders={rows} />

      {editingOrder && (
        <OldOrderEditor
          order={editingOrder}
          title="تعديل الأوردر"
          onClose={() => setEditing(null)}
          onSave={async (edited) => {
            if (await patch(editingOrder, { order: edited })) setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** The product's real photo (catalog, else the store photo linked in the message), or a clear "no photo" mark. */
function ProductThumb({ modelId, image, name }: { modelId: string; image?: string; name: string }) {
  const src = productImage(modelId, image);
  if (!src) return <span className="admin-thumb missing" title="الصورة مش متاحة">مفيش صورة</span>;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="admin-thumb" aria-label={`صورة ${name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail */}
      <img src={src} alt="" width={36} height={36} loading="lazy" />
    </a>
  );
}

// ── Factory quantities + Excel ────────────────────────────────────────────

function QuantitiesPanel({ orders }: { orders: OldOrder[] }) {
  const [includeCancelled, setIncludeCancelled] = useState(false);
  // Returned pieces came back, like cancelled ones they are not pieces to make.
  const counted = orders.filter((order) => includeCancelled || (order.status !== "cancelled" && order.status !== "returned"));
  const rows = aggregateQuantities(counted);
  const pieces = rows.reduce((sum, row) => sum + row.quantity, 0);

  function download(name: string, sheets: Parameters<typeof buildXlsx>[0]) {
    const data = buildXlsx(sheets);
    const url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const quantitySheet = () => ({
    name: "الكميات",
    rtl: true,
    columnWidths: [22, 40, 12, 44, 14, 10, 14],
    rows: [
      ["كود المنتج", "المنتج", "القسم", "المقاس", "اللون", "الكمية", "عدد الأوردرات"],
      ...rows.map((row): XlsxCell[] => [row.modelId, row.name, row.category ? categoryInfo[row.category].singular : "", row.size, row.color, row.quantity, row.orders]),
      ["", "الإجمالي", "", "", "", pieces, counted.length],
    ],
  });

  function exportFactory() {
    download(`blue-mood-quantities-${today}.xlsx`, [quantitySheet()]);
  }

  function exportWithOrders() {
    const lines: XlsxCell[][] = [[
      "رقم الطلب", "التاريخ", "الحالة", "مؤرشف", "العميلة", "الموبايل", "رقم تاني", "المحافظة", "المنطقة", "العنوان", "العرض",
      "كود المنتج", "المنتج", "المقاس", "اللون", "الكمية", "سعر القطعة", "سعر العرض", "القطع المنفردة", "الشحن", "الإجمالي", "ملاحظات",
    ]];
    for (const order of counted) {
      order.products.forEach((product, index) => {
        const first = index === 0;
        lines.push([
          order.orderId, cairoTime(order.createdAt), STATUS_LABELS[order.status], order.archived ? "نعم" : "",
          first ? order.customerName : "", first ? order.phone : "", first ? order.alternatePhone : "", order.governorate, order.area,
          first ? order.address : "", order.offerName, product.modelId, product.name, product.size, product.color, product.quantity,
          product.unitPrice, first ? order.offerPrice || null : null, first ? order.itemsTotal || null : null,
          first ? order.shippingCost : null, first ? order.total : null, first ? order.notes : "",
        ]);
      });
    }
    download(`blue-mood-old-orders-${today}.xlsx`, [quantitySheet(), { name: "الأوردرات", rtl: true, rows: lines }]);
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>الكميات المطلوبة من المصنع</h2>
        <div className="admin-import-actions">
          <button type="button" className="admin-primary" disabled={rows.length === 0} onClick={exportFactory}><Download size={15} /> Excel للمصنع</button>
          <button type="button" className="admin-chip" disabled={rows.length === 0} onClick={exportWithOrders}><Download size={15} /> Excel بالأوردرات كاملة</button>
        </div>
      </div>
      <label className="admin-check">
        <input type="checkbox" checked={includeCancelled} onChange={(event) => setIncludeCancelled(event.target.checked)} /> احسبي الأوردرات الملغية والمرتجعة كمان
      </label>
      {rows.length === 0 ? <p className="admin-muted empty">مفيش قطع في الأوردرات اللي ظاهرة.</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table products">
            <thead><tr><th>المنتج</th><th>القسم</th><th>المقاس</th><th>اللون</th><th>الكمية</th><th>عدد الأوردرات</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const image = row.modelId ? findProduct(row.modelId)?.image : undefined;
                return (
                  <tr key={`${row.modelId || row.name}|${row.size}|${row.color}`}>
                    <td>
                      <span className="admin-product">
                        {/* eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail */}
                        {image && <img src={image} alt="" width={34} height={34} loading="lazy" />}
                        <span>{row.name}</span>
                      </span>
                    </td>
                    <td>{row.category ? categoryInfo[row.category].singular : "—"}</td>
                    <td className="wrap">{row.size || "—"}</td>
                    <td>{row.color || "—"}</td>
                    <td><strong>{row.quantity}</strong></td>
                    <td>{row.orders}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>الإجمالي</td><td /><td /><td /><td><strong>{pieces}</strong></td><td>{counted.length} أوردر</td></tr></tfoot>
          </table>
        </div>
      )}
      <p className="admin-muted small">
        الحساب على الأوردرات الظاهرة في القائمة فوق (حسب البحث والفلاتر). كل موديل في الكتالوج لون واحد، فاسم المنتج بيحدد اللون؛ عمود &quot;اللون&quot; بيتملي بس لو كتبتيه في تعديل الأوردر. ملف &quot;Excel للمصنع&quot; مفيهوش أي بيانات عميلات.
      </p>
    </section>
  );
}

// ── Editor (preview and saved orders) ─────────────────────────────────────

const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

function OldOrderEditor({ order, title, onSave, onClose }: { order: OldOrder; title: string; onSave: (order: OldOrder) => Promise<void>; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<OldOrder>(order);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const set = <K extends keyof OldOrder>(field: K, value: OldOrder[K]) => setDraft((current) => ({ ...current, [field]: value }));
  const setProduct = (index: number, change: Partial<OldOrderProduct>) =>
    setDraft((current) => ({ ...current, products: current.products.map((product, position) => (position === index ? { ...product, ...change } : product)) }));

  async function save() {
    const numbers = [draft.offerPrice, draft.itemsTotal, draft.shippingCost, draft.total, ...draft.products.map((product) => product.unitPrice)];
    if (numbers.some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
      setError("راجعي الأسعار: لازم تبقى أرقام موجبة أو فاضية.");
      return;
    }
    if (draft.products.some((product) => !product.name.trim() || !Number.isInteger(product.quantity) || product.quantity < 1)) {
      setError("كل منتج لازم يبقى له اسم وكمية صحيحة (١ أو أكتر).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const text = (field: "customerName" | "phone" | "alternatePhone" | "governorate" | "area" | "offerName", label: string, ltr = false) => (
    <label className="admin-field">
      <span>{label}</span>
      <input value={draft[field]} dir={ltr ? "ltr" : undefined} onChange={(event) => set(field, event.target.value)} />
    </label>
  );
  const amount = (field: "offerPrice" | "itemsTotal" | "shippingCost" | "total", label: string, nullable: boolean) => (
    <label className="admin-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        value={draft[field] ?? ""}
        placeholder={nullable ? "مش معروف" : "0"}
        onChange={(event) => set(field, (nullable ? optionalNumber(event.target.value) : Number(event.target.value || 0)) as never)}
      />
    </label>
  );

  return (
    <dialog ref={dialogRef} className="admin-dialog" dir="rtl" aria-labelledby="old-order-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="old-order-title" dir="ltr">{order.orderId}</h2>
            <p className="admin-muted">{title} · {cairoTime(order.createdAt)}{order.source && <> · {order.source}</>}</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-dialog-body">
          <section className="admin-detail">
            <h3>بيانات العميلة</h3>
            <div className="admin-edit-grid">
              {text("customerName", "الاسم")}
              {text("phone", "الموبايل", true)}
              {text("alternatePhone", "رقم تاني", true)}
              {text("governorate", "المحافظة")}
              {text("area", "المنطقة / المدينة")}
              <label className="admin-field">
                <span>الحالة</span>
                <select value={draft.status} onChange={(event) => set("status", event.target.value as OrderStatus)}>
                  {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
                </select>
              </label>
              <label className="admin-field wide">
                <span>العنوان بالكامل</span>
                <textarea rows={3} value={draft.address} onChange={(event) => set("address", event.target.value)} />
              </label>
              <label className="admin-field wide">
                <span>ملاحظات</span>
                <textarea rows={2} value={draft.notes} onChange={(event) => set("notes", event.target.value)} />
              </label>
            </div>
          </section>

          <section className="admin-detail">
            <h3>المنتجات</h3>
            <div className="admin-edit-grid">{text("offerName", "العرض")}</div>
            <div className="admin-table-wrap">
              <table className="admin-table compact admin-edit-table">
                <thead><tr><th>المنتج</th><th>المقاس</th><th>اللون</th><th>الكمية</th><th>سعر القطعة</th><th /></tr></thead>
                <tbody>
                  {draft.products.map((product, index) => (
                    <tr key={index}>
                      <td className="admin-edit-product">
                        <ProductThumb modelId={product.modelId} image={product.image} name={product.name} />
                        <input value={product.name} onChange={(event) => setProduct(index, { name: event.target.value })} aria-label="اسم المنتج" />
                        {product.modelId && <small dir="ltr" className="mono">{product.modelId}</small>}
                      </td>
                      <td><input value={product.size} onChange={(event) => setProduct(index, { size: event.target.value })} aria-label="المقاس" /></td>
                      <td><input value={product.color} onChange={(event) => setProduct(index, { color: event.target.value })} aria-label="اللون" placeholder="—" /></td>
                      <td><input type="number" min={1} max={100} value={product.quantity} onChange={(event) => setProduct(index, { quantity: Math.trunc(Number(event.target.value)) })} aria-label="الكمية" className="narrow" /></td>
                      <td><input type="number" min={0} value={product.unitPrice ?? ""} placeholder="ضمن العرض" onChange={(event) => setProduct(index, { unitPrice: optionalNumber(event.target.value) })} aria-label="سعر القطعة" className="narrow" /></td>
                      <td className="actions"><button type="button" className="danger" onClick={() => set("products", draft.products.filter((_, position) => position !== index))} aria-label="شيلي المنتج"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="admin-chip" onClick={() => set("products", [...draft.products, { modelId: "", name: "", size: "", color: "", quantity: 1, unitPrice: null }])}><Plus size={14} /> منتج</button>
            <div className="admin-edit-grid">
              {amount("offerPrice", "سعر العرض", false)}
              {amount("itemsTotal", "القطع المنفردة", false)}
              {amount("shippingCost", "الشحن", true)}
              {amount("total", "الإجمالي", true)}
            </div>
          </section>
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={saving} onClick={() => void save()}>{saving ? "جاري الحفظ…" : "حفظ"}</button>
        </footer>
      </div>
    </dialog>
  );
}
