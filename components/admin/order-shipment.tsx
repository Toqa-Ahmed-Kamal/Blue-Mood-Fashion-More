"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, RefreshCw, Trash2, Truck, X } from "lucide-react";

import type { UnifiedOrder } from "@/lib/all-orders";
import { formatEGP } from "@/lib/format";
import { CHARGE_KINDS, SHIP_STAGES, chargeLabel, companyTotals, isChargeKind, knownCompanies, sameCompany, shipmentMoney, stageLabel, type ChargeKind, type CourierCompany, type Shipment, type ShipStage } from "@/lib/shipment";

const cairoTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");
const companyName = (company: string) => company || "من غير شركة";
/** Below zero the store owes the company (a returned order's charges): said in words, not with a minus sign. */
const owedText = (amount: number) => (amount < -0.005 ? `عليكي ${formatEGP(-amount)}` : formatEGP(amount));
/**
 * What is left: positive = still to come in; below zero = either the store owes the company (nothing owed to it,
 * a returned order's charges) or more came in than expected.
 */
const leftText = (value: { owed: number | null; remaining: number | null }) => {
  const left = value.remaining ?? 0;
  if (left >= -0.005) return formatEGP(left);
  return (value.owed ?? 0) < 0 ? `عليكي ${formatEGP(-left)}` : `اتحصّل زيادة ${formatEGP(-left)}`;
};
const urlOf = (order: Pick<UnifiedOrder, "source" | "orderId">) => (order.source === "site" ? `/api/admin/orders/${order.orderId}` : `/api/admin/old-orders/${order.orderId}`);

async function saveShipment(order: Pick<UnifiedOrder, "source" | "orderId">, shipment: object | null) {
  const response = await fetch(urlOf(order), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shipment }) });
  if (response.status === 401) return { unauthorized: true as const };
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) return { error: (result?.error?.message as string | undefined) ?? "مقدرناش نحفظ." };
  return { shipment: (result.order?.shipment ?? null) as Shipment | null };
}

/** On the order card: the company, where the order is, what it kept and what it paid over. */
export function ShipmentBox({ order }: { order: UnifiedOrder }) {
  if (!order.shipment) return null;
  const value = shipmentMoney(order);
  const { shipment } = order;
  return (
    <section className="order-shipment" aria-label="شركة الشحن">
      <h4><Truck size={15} aria-hidden="true" /> {companyName(shipment.company)}{shipment.self && <small className="admin-muted">(وصّلناه بنفسنا)</small>} <span className={`ship-stage ${value.stage}`}>{stageLabel(value.stage)}</span>{shipment.tracking && <small className="mono" dir="ltr">#{shipment.tracking}</small>}</h4>
      {shipment.charges.length > 0 && (
        <ul>
          {shipment.charges.map((charge) => <li key={charge.id}><span>{chargeLabel(charge.kind)}{charge.note && <small className="admin-muted"> · {charge.note}</small>}</span><span className="price">− {formatEGP(charge.amount)}</span></li>)}
        </ul>
      )}
      <ShipmentMoneyLine value={value} collectedAt={shipment.collectedAt} />
    </section>
  );
}

function ShipmentMoneyLine({ value, collectedAt }: { value: ReturnType<typeof shipmentMoney>; collectedAt: string | null }) {
  if (value.owed === null) {
    if (value.stage === "with-courier") return <p className="order-shipment-money">{value.self ? "هيتحصّل لما يتسلم" : "هتحوّلك لما يتسلم"}: <strong>{formatEGP(value.expected)}</strong></p>;
    return null;
  }
  const done = value.remaining !== null && Math.abs(value.remaining) < 0.01;
  if (value.self && value.owed === 0) return <p className="order-shipment-money">مفيش تحصيل؛ المصاريف اتخصمت من المكسب.</p>;
  if (value.owed < 0 && !value.collected) return <p className="order-shipment-money open">مفيش تحصيل، وعليكي ليها <strong>{formatEGP(-value.owed)}</strong> (بتتخصم من تحويل جاي).</p>;
  return (
    <p className={`order-shipment-money${done ? " done" : " open"}`}>
      {value.owed < 0 ? "عليكي ليها" : value.self ? "المفروض يتحصّل" : "المفروض تحوّلك"} <strong>{formatEGP(Math.abs(value.owed))}</strong>
      {" · "}حصّلتي <strong>{formatEGP(value.collected ?? 0)}</strong>{value.collected !== null && <small className="admin-muted"> ({cairoTime(collectedAt)})</small>}
      {" · "}{done ? <strong className="admin-positive">خلصت ✓</strong> : <>{(value.remaining ?? 0) < -0.005 && value.owed >= 0 ? "" : "فاضل "}<strong>{leftText(value)}</strong></>}
    </p>
  );
}

type ChargeDraft = { key: number; id: string; kind: ChargeKind; amount: string; note: string };

/** The companies saved in the "شركات الشحن" table (null while loading). */
function useCourierCompanies() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CourierCompany[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/couriers", { cache: "no-store" });
      if (response.status === 401) return router.replace("/admin/login");
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "مقدرناش نحمل الشركات.");
      setCompanies(result.companies as CourierCompany[]);
      setError("");
    } catch (caught) {
      setCompanies((current) => current ?? []);
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل الشركات.");
    }
  }, [router]);
  useEffect(() => {
    // Loading the list when the screen opens is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  return { companies, error, reload: load, setCompanies };
}

/** "شركة الشحن": company, tracking number, extra money it kept and what it paid over for this order. */
export function ShipmentDialog({ order, companies, onClose, onSaved }: { order: UnifiedOrder; companies: string[]; onClose: () => void; onSaved: (shipment: Shipment | null) => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = order.shipment;
  const saved = useCourierCompanies().companies;
  const [company, setCompany] = useState(current?.company ?? "");
  const [tracking, setTracking] = useState(current?.tracking ?? "");
  const [charges, setCharges] = useState<ChargeDraft[]>(() => (current?.charges ?? []).map((charge, index) => ({ key: index, id: charge.id, kind: charge.kind, amount: String(charge.amount), note: charge.note })));
  const nextKey = useRef((current?.charges.length ?? 0) + 1);
  const [self, setSelf] = useState(current?.self === true);
  const [collected, setCollected] = useState(current?.collected === null || current?.collected === undefined ? "" : String(current.collected));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Picking a saved company (a chip, or typing its exact name) also sets "delivered by us" from the table.
  const pick = (name: string) => {
    setError("");
    setCompany(name);
    const match = saved?.find((item) => sameCompany(item.name, name));
    if (match) setSelf(match.self);
  };
  // Names used on orders before but not in the table yet.
  const others = companies.filter((name) => !saved?.some((item) => sameCompany(item.name, name))).slice(0, 6);

  const list = charges.map((row) => ({ id: row.id || undefined, kind: row.kind, amount: Number(row.amount), note: row.note }));
  const draft: Shipment = { company: company.trim(), tracking: tracking.trim(), charges: list.map((item, index) => ({ id: item.id ?? `new${index}`, kind: item.kind, amount: Number.isFinite(item.amount) ? item.amount : 0, note: item.note, at: "" })), collected: collected.trim() === "" || !Number.isFinite(Number(collected)) ? null : Number(collected), collectedAt: null, self };
  const value = shipmentMoney({ ...order, shipment: draft });
  const setCharge = (key: number, change: Partial<ChargeDraft>) => { setError(""); setCharges((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row))); };

  async function save() {
    if (list.some((item) => !Number.isFinite(item.amount) || item.amount <= 0)) return setError("مبلغ كل خصم لازم يبقى رقم أكبر من صفر.");
    if (collected.trim() !== "" && (!Number.isFinite(Number(collected)) || Number(collected) < 0)) return setError("المبلغ اللي حصّلتيه لازم يبقى رقم صفر أو أكتر.");
    setSaving(true);
    setError("");
    try {
      const result = await saveShipment(order, { company: company.trim(), tracking: tracking.trim(), charges: list, collected: collected.trim() === "" ? null : Number(collected), self });
      if ("unauthorized" in result) return router.replace("/admin/login");
      if ("error" in result) return setError(result.error ?? "مقدرناش نحفظ.");
      onSaved(result.shipment);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="admin-dialog order-shipment-dialog" dir="rtl" aria-labelledby="order-shipment-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="order-shipment-title">شركة الشحن <span dir="ltr" className="mono">{order.orderId}</span></h2>
            <p className="admin-muted">الخصومات (زيادة وزن، شحن مرتجع…) بتتخصم من مكسب الأوردر. شحن المرتجع اللي بتكتبيه هنا متكتبيهوش تاني في المصروفات.</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-dialog-body">
          <section className="admin-detail">
            <div className="order-shipment-companies" role="group" aria-label="اختاري الشركة">
              {saved === null && <span className="admin-muted small">جاري تحميل الشركات…</span>}
              {saved?.map((item) => {
                const active = sameCompany(item.name, company);
                return (
                  <button key={item.id} type="button" className={`order-shipment-company${active ? " active" : ""}`} aria-pressed={active} onClick={() => pick(item.name)}>
                    <Truck size={15} aria-hidden="true" />
                    <strong>{item.name}</strong>
                    {item.self && <small>بتاعنا</small>}
                    {item.phone && <small dir="ltr">{item.phone}</small>}
                  </button>
                );
              })}
              {saved?.length === 0 && <span className="admin-muted small">لسه مفيش شركات في الجدول. ضيفيها من تاب &quot;شركات الشحن&quot;، أو اكتبي الاسم تحت.</span>}
            </div>
            <div className="order-shipment-head">
              <label className="admin-field">
                <span>الشركة {saved && saved.length > 0 ? "(أو اكتبي اسم تاني)" : ""}</span>
                <input list="shipment-companies" value={company} maxLength={60} placeholder="مثلاً: بوسطة" onChange={(event) => pick(event.target.value)} />
                <datalist id="shipment-companies">{[...(saved ?? []).map((item) => item.name), ...others].map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <label className="admin-field">
                <span>رقم البوليصة (اختياري)</span>
                <input dir="ltr" value={tracking} maxLength={60} onChange={(event) => setTracking(event.target.value)} />
              </label>
            </div>
            <label className="order-shipment-self">
              <input type="checkbox" checked={self} onChange={(event) => { setError(""); setSelf(event.target.checked); }} />
              <span><strong>وصّلناه بنفسنا</strong> (اسكوتر / مندوب خاص): الفلوس كلها بتتحصّل لكي، والشحن بيروح للاسكوتر، وأي مصاريف زيادة (زي مشوار الاسترجاع) بتتخصم من المكسب.</span>
            </label>
            {others.length > 0 && (
              <div className="order-shipment-picks">
                <span className="admin-muted small">استخدمتيها قبل كده:</span>
                {others.map((name) => <button key={name} type="button" className={`admin-chip${name === company.trim() ? " active" : ""}`} aria-pressed={name === company.trim()} onClick={() => pick(name)}>{name}</button>)}
              </div>
            )}
            <p className="admin-muted small">حالة الأوردر دلوقتي: <strong>{stageLabel(value.stage)}</strong> (بتتغير من زراير الأوردر: راح لشركة الشحن / تم الاستلام / مرتجع).</p>
          </section>

          <section className="admin-detail">
            <h3>{self ? "مصاريف زيادة (استرجاع، توصيل أغلى…)" : "فلوس زيادة خدتها الشركة"}</h3>
            {charges.length === 0 && <p className="admin-muted small">مفيش خصومات.</p>}
            <div className="order-shipment-rows">
              {charges.map((row, index) => (
                <div className="order-shipment-row" key={row.key}>
                  <label className="admin-field">
                    <span>النوع</span>
                    <select value={row.kind} onChange={(event) => { if (isChargeKind(event.target.value)) setCharge(row.key, { kind: event.target.value }); }}>
                      {CHARGE_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                    </select>
                  </label>
                  <label className="admin-field">
                    <span>المبلغ (ج.م)</span>
                    <input type="number" inputMode="decimal" min={0} value={row.amount} onChange={(event) => setCharge(row.key, { amount: event.target.value })} />
                  </label>
                  <label className="admin-field">
                    <span>ملاحظة (اختياري)</span>
                    <input value={row.note} maxLength={200} onChange={(event) => setCharge(row.key, { note: event.target.value })} />
                  </label>
                  <button type="button" className="admin-icon-btn danger" onClick={() => setCharges((rows) => rows.filter((item) => item.key !== row.key))} aria-label={`امسحي الخصم ${index + 1}`}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="order-shipment-picks">
              {CHARGE_KINDS.map((kind) => <button key={kind.id} type="button" className="admin-chip" onClick={() => { setError(""); setCharges((rows) => [...rows, { key: nextKey.current++, id: "", kind: kind.id, amount: "", note: "" }]); }}><Plus size={14} /> {kind.label}</button>)}
            </div>
          </section>

          <section className="admin-detail">
            <h3>{self ? "التحصيل من العميلة" : "التحصيل من الشركة"}</h3>
            <dl className="admin-totals">
              <div><dt>بيتحصّل من العميلة</dt><dd>{formatEGP(value.collection)}</dd></div>
              {!self && <div><dt>شحنها</dt><dd>− {formatEGP(value.fee)}</dd></div>}
              {!self && value.charges > 0 && <div><dt>الخصومات</dt><dd>− {formatEGP(value.charges)}</dd></div>}
              <div className="grand"><dt>{value.owed === null ? (self ? "هيتحصّل لما يتسلم" : "هتحوّلك لما يتسلم") : value.owed < 0 ? "عليكي ليها" : self ? "المفروض يتحصّل" : "المفروض تحوّلك"}</dt><dd>{formatEGP(value.owed === null ? value.expected : Math.abs(value.owed))}</dd></div>
            </dl>
            <div className="order-shipment-collect">
              <label className="admin-field">
                <span>{self ? "حصّلتي كام من العميلة؟" : "حصّلتي منها كام للأوردر ده؟"}</span>
                <input type="number" inputMode="decimal" min={0} value={collected} placeholder="لسه محصّلتش" onChange={(event) => { setError(""); setCollected(event.target.value); }} />
              </label>
              {value.owed !== null && value.owed > 0 && <button type="button" className="admin-chip" onClick={() => setCollected(String(value.owed))}><Check size={14} /> حصّلت المبلغ كله ({formatEGP(value.owed)})</button>}
            </div>
            {value.remaining !== null && <p className="admin-muted">{value.remaining < -0.005 && value.owed !== null && value.owed >= 0 ? "" : "فاضل: "}<strong>{leftText(value)}</strong></p>}
            {self && value.charges > 0 && <p className="admin-muted small">المصاريف دي ({formatEGP(value.charges)}) بتتخصم من مكسب الأوردر، ولو أكتر منه الأوردر بيبان خسران.</p>}
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

type CompanyDraft = { id: string; name: string; phone: string; note: string; self: boolean };
const EMPTY_DRAFT: CompanyDraft = { id: "", name: "", phone: "", note: "", self: false };

/** The companies table: add, edit, delete. These are the ones offered when an order is given to a company. */
function CompaniesTable({ orders, used }: { orders: UnifiedOrder[]; used: string[] }) {
  const router = useRouter();
  const { companies, error: loadError, setCompanies } = useCourierCompanies();
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) if (order.shipment?.company) map.set(order.shipment.company, (map.get(order.shipment.company) ?? 0) + 1);
    return map;
  }, [orders]);
  const countOf = (name: string) => [...counts.entries()].reduce((sum, [key, count]) => sum + (sameCompany(key, name) ? count : 0), 0);
  const missing = used.filter((name) => companies !== null && !companies.some((item) => sameCompany(item.name, name)));

  async function send(url: string, method: string, body?: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (response.status === 401) {
        router.replace("/admin/login");
        return null;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ. جربي تاني.");
        return null;
      }
      return result as { company?: CourierCompany };
    } catch {
      setError("مفيش اتصال. جربي تاني.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(input: CompanyDraft) {
    const body = { name: input.name, phone: input.phone, note: input.note, self: input.self };
    const result = input.id ? await send(`/api/admin/couriers/${input.id}`, "PATCH", body) : await send("/api/admin/couriers", "POST", body);
    const company = result?.company;
    if (!company) return;
    setCompanies((current) => (input.id ? (current ?? []).map((item) => (item.id === company.id ? company : item)) : [...(current ?? []), company]));
    setDraft(null);
  }

  async function remove(item: CourierCompany) {
    const count = countOf(item.name);
    if (!window.confirm(`تمسحي "${item.name}" من الجدول؟${count ? ` الـ ${count} أوردر اللي معاها هيفضلوا زي ما هم.` : ""}`)) return;
    if (await send(`/api/admin/couriers/${item.id}`, "DELETE")) setCompanies((current) => (current ?? []).filter((entry) => entry.id !== item.id));
  }

  const form = draft && (
    <tr className="couriers-company-form">
      <td><input aria-label="اسم الشركة" value={draft.name} maxLength={60} placeholder="مثلاً: بوسطة" autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></td>
      <td><input aria-label="التليفون" dir="ltr" inputMode="tel" value={draft.phone} maxLength={30} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></td>
      <td><label className="couriers-self"><input type="checkbox" checked={draft.self} onChange={(event) => setDraft({ ...draft, self: event.target.checked })} /> بتاعنا</label></td>
      <td><input aria-label="ملاحظات" value={draft.note} maxLength={200} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></td>
      <td>{draft.id ? countOf(companies?.find((item) => item.id === draft.id)?.name ?? "") || "—" : "—"}</td>
      <td className="couriers-actions">
        <button type="button" className="admin-chip active" disabled={busy || draft.name.trim().length < 2} onClick={() => void save(draft)}><Check size={14} /> حفظ</button>
        <button type="button" className="admin-chip" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>إلغاء</button>
      </td>
    </tr>
  );

  return (
    <section className="couriers-companies" aria-labelledby="couriers-companies-title">
      <div className="couriers-companies-head">
        <h3 id="couriers-companies-title">جدول الشركات</h3>
        {!draft && <button type="button" className="admin-chip" onClick={() => { setError(""); setDraft(EMPTY_DRAFT); }}><Plus size={14} /> ضيفي شركة</button>}
      </div>
      <p className="admin-muted small">الشركات اللي هنا بتطلعلك تختاري منها لما تدوسي &quot;شركة الشحن&quot; على أي أوردر. علّمي &quot;بتاعنا&quot; على الاسكوتر أو المندوب الخاص، فلما تختاريه الأوردر يتحسب &quot;وصّلناه بنفسنا&quot;.</p>
      {(error || loadError) && <p className="admin-error" role="alert">{error || loadError}</p>}
      {companies === null ? <p className="admin-muted">جاري تحميل الشركات…</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table couriers-companies-table">
            <thead><tr><th>الشركة</th><th>التليفون</th><th>توصيل بتاعنا</th><th>ملاحظات</th><th>أوردرات</th><th /></tr></thead>
            <tbody>
              {companies.map((item) => (draft?.id === item.id ? <Fragment key={item.id}>{form}</Fragment> : (
                <tr key={item.id}>
                  <td><strong>{item.name}</strong></td>
                  <td dir="ltr">{item.phone || "—"}</td>
                  <td>{item.self ? "✓" : "—"}</td>
                  <td>{item.note || "—"}</td>
                  <td>{countOf(item.name) || "—"}</td>
                  <td className="couriers-actions">
                    <button type="button" className="admin-chip" disabled={busy || draft !== null} onClick={() => { setError(""); setDraft({ id: item.id, name: item.name, phone: item.phone, note: item.note, self: item.self }); }}>تعديل</button>
                    <button type="button" className="admin-icon-btn danger" disabled={busy || draft !== null} onClick={() => void remove(item)} aria-label={`امسحي ${item.name}`}><Trash2 size={16} /></button>
                  </td>
                </tr>
              )))}
              {draft && !draft.id && form}
              {companies.length === 0 && !draft && <tr><td colSpan={6} className="admin-muted">لسه مفيش شركات. دوسي &quot;ضيفي شركة&quot;.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {draft?.id && <p className="admin-muted small">لو غيرتي الاسم، الأوردرات القديمة هتفضل بالاسم القديم.</p>}
      {missing.length > 0 && !draft && (
        <div className="order-shipment-picks">
          <span className="admin-muted small">مستخدمة في أوردرات ومش في الجدول:</span>
          {missing.map((name) => <button key={name} type="button" className="admin-chip" disabled={busy} onClick={() => void save({ ...EMPTY_DRAFT, name })}><Plus size={14} /> {name}</button>)}
        </div>
      )}
    </section>
  );
}

/** "شركات الشحن": per company, orders by stage, what it kept, owes, paid and what is left; the orders still open. */
export function CouriersTab() {
  const router = useRouter();
  const [orders, setOrders] = useState<UnifiedOrder[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [editing, setEditing] = useState<UnifiedOrder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/all-orders", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "حصلت مشكلة. جربي تاني.");
      setOrders(result.orders);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل الأوردرات.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Loading the orders when the tab opens is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totals = useMemo(() => companyTotals(orders ?? []), [orders]);
  const companies = useMemo(() => knownCompanies(orders ?? []), [orders]);
  const all = useMemo(() => totals.reduce((sum, row) => ({ owed: sum.owed + row.owed, collected: sum.collected + row.collected, remaining: sum.remaining + row.remaining, charges: sum.charges + row.charges, onTheWay: sum.onTheWay + row.onTheWay }), { owed: 0, collected: 0, remaining: 0, charges: 0, onTheWay: 0 }), [totals]);
  const selected = company ?? totals[0]?.company ?? null;
  // With the shipping company but no company chosen for them yet.
  const unnamed = useMemo(() => (orders ?? []).filter((order) => !order.archived && !order.shipment?.company && shipmentMoney(order).stage === "with-courier").length, [orders]);
  const rows = useMemo(() => (orders ?? [])
    .filter((order) => selected !== null && order.shipment !== null && order.shipment.company === selected)
    .map((order) => ({ order, value: shipmentMoney(order) }))
    .toSorted((a, b) => Number(Math.abs(b.value.remaining ?? 0) >= 0.01) - Number(Math.abs(a.value.remaining ?? 0) >= 0.01) || b.order.createdAt.localeCompare(a.order.createdAt)), [orders, selected]);

  async function settle(order: UnifiedOrder, owed: number) {
    setBusyId(order.orderId);
    try {
      const shipment = order.shipment ?? { company: "", tracking: "", charges: [], collected: null, collectedAt: null };
      const result = await saveShipment(order, { company: shipment.company, tracking: shipment.tracking, charges: shipment.charges, collected: owed, self: shipment.self === true });
      if ("unauthorized" in result) return router.replace("/admin/login");
      if ("error" in result) return setError(result.error ?? "مقدرناش نحفظ.");
      setOrders((current) => current?.map((item) => (item.orderId === order.orderId ? { ...item, shipment: result.shipment } : item)) ?? null);
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="admin-panel couriers-tab" dir="rtl">
      <header className="admin-panel-head">
        <div>
          <h2>شركات الشحن</h2>
          <p className="admin-muted">كل شركة: الأوردرات اللي معاها، اللي خصمته (زيادة وزن ومرتجعات)، والمفروض تحوّلك كام، حصّلتي كام وفاضل كام. الشركة والخصومات والتحصيل بيتحطوا من زرار &quot;شركة الشحن&quot; على كل أوردر.</p>
        </div>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} /></button>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <CompaniesTable orders={orders ?? []} used={companies} />
      {!orders && !error && <p className="admin-muted">جاري التحميل…</p>}
      {unnamed > 0 && <p className="admin-flag warn">{unnamed} أوردر مع شركة الشحن ومش متحدد أنهي شركة: حدديها من زرار &quot;شركة الشحن&quot; في &quot;كل الأوردرات&quot;.</p>}
      {orders && totals.length === 0 && <p className="admin-muted">لسه مفيش أوردرات متسجل ليها شركة شحن. افتحي &quot;كل الأوردرات&quot; ودوسي &quot;شركة الشحن&quot; على أي أوردر.</p>}
      {totals.length > 0 && (
        <>
          <div className="admin-cards couriers-cards">
            <div className="admin-card"><span>المفروض يتحوّل</span><strong>{owedText(all.owed)}</strong><small>أوردرات اتسلمت أو رجعت</small></div>
            <div className="admin-card good"><span>حصّلتي</span><strong>{formatEGP(all.collected)}</strong></div>
            <div className={`admin-card${all.remaining > 0.01 ? " bad" : ""}`}><span>فاضل</span><strong>{leftText(all)}</strong>{all.remaining < -0.005 && <small>هتتخصم من تحويل جاي</small>}</div>
            <div className="admin-card"><span>لسه مع الشركات</span><strong>{formatEGP(all.onTheWay)}</strong><small>هيتحوّل لما يتسلموا</small></div>
            <div className="admin-card"><span>خصومات الشركات</span><strong>{formatEGP(all.charges)}</strong><small>اتخصمت من المكسب</small></div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table couriers-table">
              <thead>
                <tr><th>الشركة</th><th>أوردرات</th>{SHIP_STAGES.filter((stage) => stage.id !== "cancelled").map((stage) => <th key={stage.id}>{stage.label}</th>)}<th>خصومات</th><th>المفروض يتحوّل</th><th>حصّلتي</th><th>فاضل</th></tr>
              </thead>
              <tbody>
                {totals.map((row) => (
                  <tr key={row.company} className={row.company === selected ? "active" : undefined} onClick={() => setCompany(row.company)}>
                    <td><button type="button" className="link" onClick={() => setCompany(row.company)}>{companyName(row.company)}</button></td>
                    <td>{row.orders}</td>
                    {SHIP_STAGES.filter((stage) => stage.id !== "cancelled").map((stage) => <td key={stage.id}>{row.stages[stage.id as ShipStage] || "—"}</td>)}
                    <td>{row.charges ? `− ${formatEGP(row.charges)}` : "—"}</td>
                    <td>{owedText(row.owed)}</td>
                    <td>{formatEGP(row.collected)}</td>
                    <td><strong className={Math.abs(row.remaining) > 0.01 ? "admin-negative" : "admin-positive"}>{Math.abs(row.remaining) > 0.01 ? leftText(row) : "✓"}</strong>{row.openOrders > 0 && <small className="admin-muted"> ({row.openOrders} أوردر)</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected !== null && (
            <div className="couriers-orders">
              <h3>أوردرات {companyName(selected)}</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>الأوردر</th><th>العميلة</th><th>الحالة</th><th>بتحصّله</th><th>خصومات</th><th>المفروض يتحوّل</th><th>حصّلتي</th><th>فاضل</th><th /></tr></thead>
                  <tbody>
                    {rows.map(({ order, value }) => (
                      <tr key={order.orderId}>
                        <td className="mono" dir="ltr">{order.orderId}{order.shipment?.tracking && <small className="admin-muted"> #{order.shipment.tracking}</small>}</td>
                        <td>{order.customerName || "—"}</td>
                        <td><span className={`ship-stage ${value.stage}`}>{stageLabel(value.stage)}</span></td>
                        <td>{value.stage === "returned" || value.stage === "cancelled" ? "—" : formatEGP(value.collection)}</td>
                        <td>{value.charges ? `− ${formatEGP(value.charges)}` : "—"}</td>
                        <td>{value.owed === null ? <small className="admin-muted">{value.stage === "with-courier" ? `هيبقى ${formatEGP(value.expected)}` : "—"}</small> : owedText(value.owed)}</td>
                        <td>{value.collected === null ? "—" : formatEGP(value.collected)}</td>
                        <td>{value.remaining === null ? "—" : Math.abs(value.remaining) < 0.01 ? <span className="admin-positive">✓</span> : <strong className="admin-negative">{leftText(value)}</strong>}</td>
                        <td className="couriers-actions">
                          {value.owed !== null && value.owed > 0 && Math.abs(value.remaining ?? 0) >= 0.01 && <button type="button" className="admin-chip" disabled={busyId === order.orderId} onClick={() => void settle(order, value.owed!)}><Check size={14} /> حصّلت</button>}
                          <button type="button" className="admin-chip" onClick={() => setEditing(order)}>تعديل</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {editing && (
        <ShipmentDialog
          order={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={(shipment) => {
            setOrders((current) => current?.map((item) => (item.orderId === editing.orderId ? { ...item, shipment } : item)) ?? null);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
