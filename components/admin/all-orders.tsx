"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Check, CheckCircle2, Copy, Package, PackageCheck, Pencil, RefreshCw, RotateCcw, Send, Truck, Undo2, X, XCircle } from "lucide-react";

import { OrderEditDialog } from "@/components/admin/order-edit-dialog";
import { WhatsAppLink, WhatsAppMenu } from "@/components/admin/whatsapp-link";
import { MARGIN_PRESETS, NET_PROFIT_PRESETS, ORDER_FACTS, ORDER_SHORTCUTS, STATUS_CHOICES, areaOptions, countValues, courierCollection, courierText, governorateOptions, matchesChoice, matchesDates, matchesMargin, matchesNetProfit, matchesPlace, matchesReason, matchesSearch, offerKindOf, withEdit, type FactChoice, type MarginRange, type OrderFact, type ReasonFilter, type UnifiedOrder } from "@/lib/all-orders";
import { CANCEL_REASONS, isCancelReason, type CancelReason, type CourierStep, type OrderStatus } from "@/lib/analytics-report";
import { confirmationMessage, orderMessage, unavailableMessage, weightMessage, whatsappChatUrl } from "@/lib/customer-whatsapp";
import { formatEGP } from "@/lib/format";
import { productImage } from "@/lib/quantity-summary";
import { findProduct, offerPieceCount, hasWeightFit } from "@/lib/site-data";

const STATUS_LABELS: Record<OrderStatus, string> = { submitted: "مستني تأكيد", confirmed: "بيع مؤكد", delivered: "تم الاستلام", cancelled: "اتلغى", returned: "مرتجع" };
const PAGE_SIZE = 30;
const cairoTime = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");

/** Cairo day (YYYY-MM-DD) a number of days ago. */
const cairoDay = (daysAgo = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() - daysAgo * 86_400_000));
const DATE_PRESETS = [
  { id: "", label: "كل الأيام", range: () => ({ from: "", to: "" }) },
  { id: "today", label: "النهارده", range: () => ({ from: cairoDay(), to: cairoDay() }) },
  { id: "yesterday", label: "امبارح", range: () => ({ from: cairoDay(1), to: cairoDay(1) }) },
  { id: "7", label: "آخر ٧ أيام", range: () => ({ from: cairoDay(6), to: cairoDay() }) },
  { id: "30", label: "آخر ٣٠ يوم", range: () => ({ from: cairoDay(29), to: cairoDay() }) },
  { id: "month", label: "الشهر ده", range: () => ({ from: `${cairoDay().slice(0, 8)}01`, to: cairoDay() }) },
] as const;
const OFFER_KINDS = [
  { id: "", label: "كل العروض" },
  { id: "winter", label: "عرض الشتاء" },
  { id: "christmas", label: "عرض الكريسماس" },
  { id: "none", label: "من غير عرض (قطع منفردة)" },
] as const;

/** `showMoney`: the profit filters (the API leaves out each order's profit for users without "الفلوس"). */
export function AllOrdersTab({ showMoney = true }: { showMoney?: boolean }) {
  const router = useRouter();
  const [orders, setOrders] = useState<UnifiedOrder[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Status: any of the ticked ones. Steps: each "has" / "has not" / either. All filters work together.
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [facts, setFacts] = useState<FactChoice>({});
  const [reason, setReason] = useState<ReasonFilter>("");
  const [source, setSource] = useState<"" | "site" | "telegram">("");
  const [query, setQuery] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [trafficSource, setTrafficSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [offerKind, setOfferKind] = useState("");
  // Place filter: governorate key, then an area ("" = any).
  const [governorate, setGovernorate] = useState("");
  const [area, setArea] = useState("");
  // هامش الربح filter: a preset, or "custom" with the owner's own numbers.
  const [marginPreset, setMarginPreset] = useState("");
  const [marginMin, setMarginMin] = useState("");
  const [marginMax, setMarginMax] = useState("");
  // صافي المكسب filter: the same, on the net profit.
  const [netPreset, setNetPreset] = useState("");
  const [netMin, setNetMin] = useState("");
  const [netMax, setNetMax] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const resetPage = () => setLimit(PAGE_SIZE);

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

  const marginRange = useMemo<MarginRange>(() => {
    if (marginPreset !== "custom") return MARGIN_PRESETS.find((preset) => preset.id === marginPreset)?.range ?? { min: null, max: null };
    const number = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text));
    return { min: number(marginMin), max: number(marginMax) };
  }, [marginPreset, marginMin, marginMax]);
  const netRange = useMemo<MarginRange>(() => {
    if (netPreset !== "custom") return NET_PROFIT_PRESETS.find((preset) => preset.id === netPreset)?.range ?? { min: null, max: null };
    const number = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text));
    return { min: number(netMin), max: number(netMax) };
  }, [netPreset, netMin, netMax]);
  // Lists to choose from: counted over the orders shown by source and archive, before the other filters.
  const base = useMemo(() => (orders ?? []).filter((order) => (!source || order.source === source) && (showArchived || !order.archived)), [orders, source, showArchived]);
  const governorates = useMemo(() => governorateOptions(base), [base]);
  // Areas work alone too: without a governorate every area is listed (with its governorate).
  const areas = useMemo(() => areaOptions(base, governorate), [base, governorate]);
  const areaMissing = base.filter((order) => matchesPlace(order, governorate, "none")).length;
  const trafficSources = useMemo(() => countValues(base.map((order) => order.trafficSource)), [base]);
  const campaigns = useMemo(() => countValues(base.map((order) => order.campaign)), [base]);
  // Every filter except status and steps (those show their own counts on the chips).
  const scoped = useMemo(() => base.filter((order) =>
    matchesPlace(order, governorate, area)
    && matchesDates(order, dateFrom, dateTo)
    && (!trafficSource || order.trafficSource === trafficSource)
    && (!campaign || order.campaign === campaign)
    && (!offerKind || offerKindOf(order) === offerKind)
    && matchesSearch(order, query)
    && matchesMargin(order, marginRange)
    && matchesNetProfit(order, netRange)), [base, governorate, area, dateFrom, dateTo, trafficSource, campaign, offerKind, query, marginRange, netRange]);
  const netActive = netRange.min !== null || netRange.max !== null;
  const marginActive = marginRange.min !== null || marginRange.max !== null || netActive;
  const cancelledOnly = statuses.length > 0 && statuses.every((status) => status === "cancelled");
  const rows = scoped.filter((order) => matchesChoice(order, statuses, facts) && (!cancelledOnly || matchesReason(order, reason)));
  const shown = rows.slice(0, limit);
  const editing = editingId ? orders?.find((order) => order.orderId === editingId) ?? null : null;
  const statusCount = (status: OrderStatus) => scoped.filter((order) => order.status === status && matchesChoice(order, [], facts)).length;
  const factCount = (fact: OrderFact, wanted: boolean) => scoped.filter((order) => matchesChoice(order, statuses, { ...facts, [fact]: wanted })).length;
  const activeCount = statuses.length + Object.values(facts).filter((value) => value !== undefined).length
    + [query.trim(), dateFrom || dateTo, trafficSource, campaign, offerKind, governorate, area, source, marginPreset, netPreset, cancelledOnly ? reason : ""].filter(Boolean).length;

  function toggleStatus(status: OrderStatus) {
    setStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
    resetPage();
  }
  /** Either → has → has not → either. */
  function cycleFact(fact: OrderFact) {
    setFacts((current) => {
      const next = { ...current };
      if (current[fact] === undefined) next[fact] = true;
      else if (current[fact] === true) next[fact] = false;
      else delete next[fact];
      return next;
    });
    resetPage();
  }
  function applyShortcut(id: string) {
    const shortcut = ORDER_SHORTCUTS.find((item) => item.id === id);
    if (!shortcut) return;
    setStatuses(shortcut.statuses);
    setFacts(shortcut.facts);
    resetPage();
  }
  function chooseDates(id: string) {
    const preset = DATE_PRESETS.find((item) => item.id === id) ?? DATE_PRESETS[0];
    const range = preset.range();
    setDatePreset(preset.id);
    setDateFrom(range.from);
    setDateTo(range.to);
    resetPage();
  }
  function clearAll() {
    setStatuses([]); setFacts({}); setReason(""); setSource(""); setQuery("");
    setDatePreset(""); setDateFrom(""); setDateTo(""); setTrafficSource(""); setCampaign(""); setOfferKind("");
    setGovernorate(""); setArea(""); setMarginPreset(""); setMarginMin(""); setMarginMax(""); setNetPreset(""); setNetMin(""); setNetMax("");
    resetPage();
  }

  /** Sends a status or deposit change to the right API (site order or imported Telegram order), then updates the row. */
  async function change(order: UnifiedOrder, body: { status?: OrderStatus; deposit?: number | null; courier?: { step: CourierStep; done: boolean }; cancelReason?: CancelReason | null }) {
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
      const saved = result.order as { status?: OrderStatus; deposit?: UnifiedOrder["deposit"]; courier?: UnifiedOrder["courier"]; cancelReason?: CancelReason | null };
      // A new status changes the order's profit and its month's expense share: fetch the numbers again.
      if (body.status) void load();
      setOrders((current) => current?.map((item) => item.orderId === order.orderId
        ? {
          ...item,
          ...(saved.status ? { status: saved.status } : body.status ? { status: body.status } : {}),
          ...("deposit" in body ? { deposit: saved.deposit ?? null } : {}),
          ...("courier" in body ? { courier: saved.courier ?? null } : {}),
          ...("cancelReason" in body ? { cancelReason: saved.cancelReason ?? null } : {}),
        }
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

  function removeDeposit(order: UnifiedOrder) {
    if (!order.deposit) return;
    if (!window.confirm(`تشيلي الديبوزيت (${formatEGP(order.deposit.amount)}) من ${order.orderId}؟`)) return;
    void change(order, { deposit: null });
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>كل الأوردرات {orders && `(${base.length})`}</h2>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>

      <div className="orders-filterbar">
        <input type="search" className="admin-search orders-search" placeholder="بحث: رقم الطلب، الاسم، الموبايل، العنوان، المنتج" value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} aria-label="بحث" />

        <div className="orders-filter-row">
          <span className="orders-filter-title">الحالة <small>اختاري واحدة أو أكتر</small></span>
          <div className="orders-chips" role="group" aria-label="الحالة">
            {STATUS_CHOICES.map((item) => (
              <button key={item.id} type="button" className={`orders-chip status-${item.id}${statuses.includes(item.id) ? " on" : ""}`} aria-pressed={statuses.includes(item.id)} onClick={() => toggleStatus(item.id)}>
                {statuses.includes(item.id) && <Check size={14} aria-hidden="true" />}
                <span className="orders-chip-label">{item.label}</span>
                <span className="orders-chip-count">{statusCount(item.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="orders-filter-row">
          <span className="orders-filter-title">الشحن والدفع <small>دوسة: حصل · دوستين: لسه ما حصلش · تالت دوسة: تتشال</small></span>
          <div className="orders-chips" role="group" aria-label="الشحن والدفع">
            {ORDER_FACTS.map((item) => {
              const state = facts[item.id];
              return (
                <button key={item.id} type="button" className={`orders-chip fact${state === true ? " on" : state === false ? " off" : ""}`} aria-pressed={state !== undefined} onClick={() => cycleFact(item.id)}>
                  {state === true && <Check size={14} aria-hidden="true" />}
                  {state === false && <X size={14} aria-hidden="true" />}
                  <span className="orders-chip-label">{state === false ? item.no : item.yes}</span>
                  <span className="orders-chip-count">{factCount(item.id, state !== false)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="orders-filter-grid">
          <label className="orders-field"><span>اختصارات جاهزة</span>
            <select value="" onChange={(event) => applyShortcut(event.target.value)} aria-label="اختصارات جاهزة">
              <option value="">اختاري…</option>
              {ORDER_SHORTCUTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="orders-field"><span>التاريخ</span>
            <select value={datePreset} onChange={(event) => (event.target.value === "custom" ? setDatePreset("custom") : chooseDates(event.target.value))} aria-label="التاريخ">
              {DATE_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              <option value="custom">من يوم لحد يوم…</option>
            </select>
          </label>
          {datePreset === "custom" && (
            <div className="orders-field orders-pair">
              <label><span>من</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); resetPage(); }} /></label>
              <label><span>لحد</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); resetPage(); }} /></label>
            </div>
          )}
          <label className="orders-field"><span>المحافظة</span>
            <select value={governorate} onChange={(event) => { setGovernorate(event.target.value); setArea(""); resetPage(); }} aria-label="المحافظة">
              <option value="">كل المحافظات</option>
              {governorates.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
            </select>
          </label>
          <label className="orders-field"><span>المنطقة</span>
            <select value={area} onChange={(event) => { setArea(event.target.value); resetPage(); }} aria-label="المنطقة">
              <option value="">كل المناطق</option>
              {areas.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.count})</option>)}
              {areaMissing > 0 && <option value="none">من غير منطقة ({areaMissing})</option>}
            </select>
          </label>
          <label className="orders-field"><span>العرض</span>
            <select value={offerKind} onChange={(event) => { setOfferKind(event.target.value); resetPage(); }} aria-label="العرض">
              {OFFER_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="orders-field"><span>مصدر الزيارة</span>
            <select value={trafficSource} onChange={(event) => { setTrafficSource(event.target.value); resetPage(); }} aria-label="مصدر الزيارة">
              <option value="">كل المصادر</option>
              {trafficSources.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
            </select>
          </label>
          <label className="orders-field"><span>الحملة</span>
            <select value={campaign} onChange={(event) => { setCampaign(event.target.value); resetPage(); }} aria-label="الحملة">
              <option value="">كل الحملات</option>
              {campaigns.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
            </select>
          </label>
          <label className="orders-field"><span>جاي منين</span>
            <select value={source} onChange={(event) => { setSource(event.target.value as typeof source); resetPage(); }} aria-label="المصدر">
              <option value="">الموقع وتيليجرام</option>
              <option value="site">أوردرات الموقع بس</option>
              <option value="telegram">تيليجرام القديمة بس</option>
            </select>
          </label>
          {cancelledOnly && (
            <label className="orders-field"><span>سبب الإلغاء</span>
              <select value={reason} onChange={(event) => { setReason(event.target.value as ReasonFilter); resetPage(); }} aria-label="سبب الإلغاء">
                <option value="">كل الأسباب</option>
                {CANCEL_REASONS.map((item) => <option key={item.id} value={item.id}>{item.label} ({scoped.filter((order) => order.status === "cancelled" && matchesReason(order, item.id)).length})</option>)}
                <option value="none">من غير سبب ({scoped.filter((order) => order.status === "cancelled" && matchesReason(order, "none")).length})</option>
              </select>
            </label>
          )}
          {showMoney && (
            <label className="orders-field"><span>هامش الربح</span>
              <select value={marginPreset} onChange={(event) => { setMarginPreset(event.target.value); resetPage(); }} aria-label="هامش الربح">
                {MARGIN_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
          )}
          {showMoney && marginPreset === "custom" && (
            <div className="orders-field orders-pair">
              <label><span>هامش من</span><input type="number" inputMode="numeric" value={marginMin} onChange={(event) => { setMarginMin(event.target.value); resetPage(); }} placeholder="أي رقم" /></label>
              <label><span>لأقل من</span><input type="number" inputMode="numeric" value={marginMax} onChange={(event) => { setMarginMax(event.target.value); resetPage(); }} placeholder="أي رقم" /></label>
            </div>
          )}
          {showMoney && (
            <label className="orders-field"><span>صافي المكسب</span>
              <select value={netPreset} onChange={(event) => { setNetPreset(event.target.value); resetPage(); }} aria-label="صافي المكسب">
                {NET_PROFIT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
          )}
          {showMoney && netPreset === "custom" && (
            <div className="orders-field orders-pair">
              <label><span>صافي من</span><input type="number" inputMode="numeric" value={netMin} onChange={(event) => { setNetMin(event.target.value); resetPage(); }} placeholder="أي رقم" /></label>
              <label><span>لأقل من</span><input type="number" inputMode="numeric" value={netMax} onChange={(event) => { setNetMax(event.target.value); resetPage(); }} placeholder="أي رقم" /></label>
            </div>
          )}
        </div>

        <div className="orders-filter-foot">
          <strong role="status">{orders ? `${rows.length} أوردر` : "…"}</strong>
          {activeCount > 0 && <span className="admin-muted">{activeCount} فلتر شغال</span>}
          <label className="admin-check"><input type="checkbox" checked={showArchived} onChange={(event) => { setShowArchived(event.target.checked); resetPage(); }} /> اعرضي المؤرشف</label>
          {activeCount > 0 && <button type="button" className="admin-chip" onClick={clearAll}><X size={14} /> امسحي كل الفلاتر</button>}
        </div>
      </div>
      {orders && marginActive && (
        <p className="admin-muted small" role="status">
          {rows.length} أوردر · إجمالي هامش الربح {formatEGP(rows.reduce((sum, order) => sum + (order.money?.margin ?? 0), 0))} · إجمالي صافي المكسب {formatEGP(Math.round(rows.reduce((sum, order) => sum + (order.money?.netProfit ?? 0), 0)))} · الأوردرات الملغية والمرتجعة مش بتظهر مع الفلتر ده (مالهاش مكسب).
        </p>
      )}

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!orders && !error && <p className="admin-muted">جاري التحميل…</p>}
      {orders && rows.length === 0 && <p className="admin-muted empty">مفيش أوردرات بالاختيار ده.</p>}

      <div className="admin-orders">
        {shown.map((order) => <UnifiedOrderCard key={order.orderId} order={order} busy={busyId === order.orderId} onStatus={(status) => void change(order, { status })} onDeposit={() => askDeposit(order)} onRemoveDeposit={() => removeDeposit(order)} onEdit={() => setEditingId(order.orderId)} onCourier={(step, done) => void change(order, { courier: { step, done } })} onCancelReason={(cancelReason) => void change(order, { cancelReason })} />)}
      </div>
      {rows.length > shown.length && (
        <button type="button" className="admin-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>اعرضي {Math.min(PAGE_SIZE, rows.length - shown.length)} أوردر كمان ({rows.length - shown.length} باقيين)</button>
      )}
      {editing && (
        <OrderEditDialog
          order={editing}
          onClose={() => setEditingId(null)}
          onSaved={(_saved, edit) => {
            setEditingId(null);
            // Shown at once; the reload then brings the stored copy (and keeps every total in step).
            setOrders((current) => current?.map((item) => (item.orderId === editing.orderId ? withEdit(item, edit) : item)) ?? null);
            void load();
          }}
        />
      )}
      <p className="admin-muted small">أوردرات الموقع والأوردرات القديمة من تيليجرام في مكان واحد، وكل أوردر مرة واحدة. أي تغيير هنا (الحالة أو الديبوزيت أو تعديل المنتجات) بيتحفظ في نفس الأوردر وبيظهر في باقي الأقسام والحسابات.</p>
    </section>
  );
}

/** Copies text; falls back to a hidden textarea where the clipboard API is not allowed. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

function CourierCopyButton({ order }: { order: UnifiedOrder }) {
  const [state, setState] = useState<"" | "done" | "failed">("");
  const collection = courierCollection(order);
  async function copy() {
    setState((await copyText(courierText(order))) ? "done" : "failed");
    window.setTimeout(() => setState(""), 2500);
  }
  const note = collection.amount === null
    ? "الشحن لسه متحددش ومحافظتها مالهاش سعر شحن — التحصيل هيتنسخ فاضي، اكتبيه بإيدك."
    : collection.shippingGuessed ? `الشحن لسه متحددش؛ التحصيل محسوب بشحن ${order.governorate} (${formatEGP(collection.shippingFee ?? 0)}).` : "";
  return (
    <button type="button" className={`courier-copy${state === "done" ? " good" : ""}`} onClick={() => void copy()} disabled={!order.hasCustomer} title={note || "ينسخ الاسم والتليفون والعنوان والتحصيل والمحتوى ومتاح المعاينة"}>
      {state === "done" ? <><Check size={15} /> اتنسخت</> : state === "failed" ? "مقدرناش ننسخ" : <><Copy size={15} /> بيانات لشركة الشحن</>}
      {note && state === "" && <span className="courier-copy-warn" aria-hidden="true">!</span>}
    </button>
  );
}

function UnifiedOrderCard({ order, busy, onStatus, onDeposit, onRemoveDeposit, onEdit, onCourier, onCancelReason }: { order: UnifiedOrder; busy: boolean; onStatus: (status: OrderStatus) => void; onDeposit: () => void; onRemoveDeposit: () => void; onEdit: () => void; onCourier: (step: CourierStep, done: boolean) => void; onCancelReason: (reason: CancelReason | null) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const chat = (text: string) => (order.phone ? whatsappChatUrl(order.phone, text) : null);
  const remaining = order.deposit && order.total !== null ? Math.max(0, order.total - order.deposit.amount) : null;
  const packed = Boolean(order.courier?.packedAt);
  const notified = Boolean(order.courier?.notifiedAt);
  const handed = Boolean(order.courier?.handedAt);
  const shippingOpen = order.status === "submitted" || order.status === "confirmed";
  return (
    <article className={`admin-order status-${order.status}`}>
      <header className="admin-order-head">
        <div>
          <strong dir="ltr" className="mono">{order.orderId}</strong>
          <span className="admin-muted" dir="ltr">{cairoTime(order.createdAt)}</span>
          <span className={`status ${order.status}`}>{STATUS_LABELS[order.status]}</span>
          {order.deposit && <span className="admin-deposit"><BadgeCheck size={14} aria-hidden="true" /> ديبوزيت {formatEGP(order.deposit.amount)}</span>}
          {handed ? <span className="admin-courier handed" title={cairoTime(order.courier?.handedAt ?? "")}><Truck size={14} aria-hidden="true" /> راح لشركة الشحن</span>
            : <>
              {packed && <span className="admin-courier packed" title={cairoTime(order.courier?.packedAt ?? "")}><Package size={14} aria-hidden="true" /> اتجهز للشحن</span>}
              {notified && <span className="admin-courier" title={cairoTime(order.courier?.notifiedAt ?? "")}><Send size={14} aria-hidden="true" /> اتبلغت شركة الشحن</span>}
            </>}
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
                  {order.phone && hasWeightFit(catalog?.category) && (
                    <WhatsAppLink compact text="وزنها؟" href={chat(weightMessage({ name: order.customerName, orderId: order.orderId, productName: product.name, productId: product.modelId }))} label={`اسألي عن وزنها علشان ${product.name}`} />
                  )}
                </li>
              );
            })}
          </ul>
          {order.offerPrice > 0 && (() => {
            const slots = offerPieceCount(order.offerName);
            const inOffer = order.products.filter((product) => product.unitPrice === null).reduce((sum, product) => sum + product.quantity, 0);
            return inOffer < slots && order.products.some((product) => product.unitPrice !== null) ? (
              <p className="admin-flag warn">العرض {slots} قطع وفيه {inOffer} بس ضمن العرض، والباقي محسوب بسعره. لو دول بدل قطع من العرض: &quot;تعديل الأوردر&quot; وامسحي سعرهم.</p>
            ) : null;
          })()}
          <dl className="admin-totals">
            <div><dt>الشحن</dt><dd>{order.shippingCost === null ? "لسه هيتأكد" : formatEGP(order.shippingCost)}</dd></div>
            <div className="grand"><dt>الإجمالي</dt><dd>{order.total === null ? `${formatEGP(order.value)} + الشحن` : formatEGP(order.total)}</dd></div>
            {order.deposit && <div><dt>ديبوزيت مدفوع</dt><dd>− {formatEGP(order.deposit.amount)}</dd></div>}
            {remaining !== null && <div className="grand"><dt>الباقي عند الاستلام</dt><dd>{formatEGP(remaining)}</dd></div>}
          </dl>
          <OrderMoneyBox order={order} />
        </section>
      </div>

      <footer className="admin-order-actions actions">
        <button type="button" disabled={busy || !order.editable} onClick={onEdit} title={order.editable ? "تبديل أو إضافة أو شيل منتجات، وتعديل البيانات والشحن" : "تفاصيل الأوردر مش متسجلة علشان يتعدل"}><Pencil size={15} /> تعديل الأوردر</button>
        <button type="button" disabled={busy} onClick={onDeposit} className={order.deposit ? "deposit-on" : undefined}><BadgeCheck size={15} /> {order.deposit ? "تعديل الديبوزيت" : "تأكيد بديبوزيت"}</button>
        {order.deposit && <button type="button" disabled={busy} className="danger" onClick={onRemoveDeposit} title="لو اتحط بالغلط"><XCircle size={15} /> شيل الديبوزيت</button>}
        {order.status !== "confirmed" && order.status !== "delivered" && <button type="button" disabled={busy} onClick={() => onStatus("confirmed")} title="بيع مؤكد"><CheckCircle2 size={16} /> تأكيد</button>}
        {order.status === "confirmed" && <button type="button" disabled={busy} className="good" onClick={() => onStatus("delivered")} title="العميلة استلمت"><PackageCheck size={16} /> تم الاستلام</button>}
        {(order.status === "confirmed" || order.status === "delivered") && <button type="button" disabled={busy} className="danger" onClick={() => onStatus("returned")} title="الأوردر رجع"><Undo2 size={16} /> مرتجع</button>}
        {order.status !== "cancelled" && order.status !== "returned" && order.status !== "delivered" && <button type="button" disabled={busy} className="danger" onClick={() => onStatus("cancelled")} title="إلغاء"><XCircle size={16} /> إلغاء</button>}
        {order.status === "cancelled" && (
          <select className={`admin-cancel-reason${order.cancelReason ? "" : " empty"}`} disabled={busy} value={order.cancelReason ?? ""} onChange={(event) => onCancelReason(isCancelReason(event.target.value) ? event.target.value : null)} aria-label="سبب الإلغاء">
            <option value="">اختاري سبب الإلغاء…</option>
            {CANCEL_REASONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        )}
        {order.status !== "submitted" && <button type="button" disabled={busy} onClick={() => onStatus("submitted")} title="رجوع لمستني تأكيد" aria-label="رجوع لمستني تأكيد"><RotateCcw size={15} /></button>}
        <span className="admin-order-actions-break" aria-hidden="true" />
        <CourierCopyButton order={order} />
        {shippingOpen && (
          <>
            <button type="button" disabled={busy} className={packed ? "courier-on packed" : undefined} aria-pressed={packed} onClick={() => onCourier("packed", !packed)} title={packed ? `اتجهز ${cairoTime(order.courier?.packedAt ?? "")} — دوسي علشان تلغي` : "الأوردر اتجهز واتغلف لشركة الشحن"}>
              <Package size={15} /> {packed ? "اتجهز للشحن ✓" : "اتجهز للشحن"}
            </button>
            <button type="button" disabled={busy} className={notified ? "courier-on" : undefined} aria-pressed={notified} onClick={() => onCourier("notified", !notified)} title={notified ? `اتبلغت ${cairoTime(order.courier?.notifiedAt ?? "")} — دوسي علشان تلغي` : "بعتي البيانات لشركة الشحن"}>
              <Send size={15} /> {notified ? "اتبلغت شركة الشحن ✓" : "بلّغت شركة الشحن"}
            </button>
            <button type="button" disabled={busy} className={handed ? "courier-on" : undefined} aria-pressed={handed} onClick={() => onCourier("handed", !handed)} title={handed ? `راح ${cairoTime(order.courier?.handedAt ?? "")} — دوسي علشان تلغي` : "المندوب استلم الأوردر"}>
              <Truck size={15} /> {handed ? "راح لشركة الشحن ✓" : "راح لشركة الشحن"}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

/** "مكسب الأوردر": what the order brings after the factory cost and its share of the month's expenses. */
function OrderMoneyBox({ order }: { order: UnifiedOrder }) {
  if (order.status === "returned") return <p className="admin-order-money-note">مرتجع: مالوش مكسب (شحن المرتجع بيتسجل كمصروف).</p>;
  if (order.status === "cancelled") return null;
  const money = order.money;
  if (!money) return null;
  const cost = money.costState === "missing" ? <span className="admin-flag warn">ناقص سعر مصنع {money.missingLines} منتج</span> : money.costState === "estimated" ? <span className="admin-flag warn">بسعر المصنع الحالي</span> : null;
  return (
    <section className={`admin-order-money${money.expected ? " expected" : ""}`} aria-label="مكسب الأوردر">
      <h4>{money.expected ? "مكسب الأوردر لو اتأكد (متوقع)" : "مكسب الأوردر"}</h4>
      <dl>
        <div><dt>البيع (من غير الشحن)</dt><dd>{formatEGP(money.sales)}</dd></div>
        <div><dt>تكلفة المنتجات {cost}</dt><dd>− {formatEGP(money.productsCost)}</dd></div>
        <div className="sub"><dt>هامش الربح</dt><dd className={money.margin < 0 ? "admin-negative" : undefined}>{formatEGP(money.margin)}</dd></div>
        <div><dt>نصيبه من مصروفات الشهر <small>({formatEGP(money.perPiece)} للقطعة)</small></dt><dd>− {formatEGP(money.expenseShare)}</dd></div>
        <div className="grand"><dt>مكسبك الصافي</dt><dd className={money.netProfit < 0 ? "admin-negative" : "admin-positive"}>{formatEGP(money.netProfit)}</dd></div>
      </dl>
    </section>
  );
}
