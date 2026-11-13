"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { formatEGP } from "@/lib/format";
import { editTotals, type OrderEdit } from "@/lib/order-edit";
import { productImage } from "@/lib/quantity-summary";
import { governorateShippingFee, shippingGovernorates } from "@/lib/shipping-rates";
import { catalog, categoryInfo, categoryOrder, findProduct, isSoldOut, offerCategories, offerPieceCount, priceOf } from "@/lib/site-data";

/** What the edit window needs from any order (site order or imported Telegram order). */
export type EditableOrder = {
  orderId: string;
  source: "site" | "telegram";
  createdAt: string;
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
  offerName: string;
  offerPrice: number;
  shippingCost: number | null;
  products: { modelId: string; name: string; quantity: number; unitPrice: number | null }[];
};

type DraftLine = { key: number; modelId: string; quantity: string; price: string; was: string };

const cairoTime = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }) : "—");
const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));

/**
 * "تعديل الأوردر": swap, add or remove pieces (picked from the store's products), change quantities,
 * prices, customer details and shipping. Status and deposit are not touched. Saves through the order's own API.
 */
export function OrderEditDialog({ order, onClose, onSaved }: { order: EditableOrder; onClose: () => void; onSaved: (saved: unknown, edit: OrderEdit) => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextKey = useRef(order.products.length);
  const [customer, setCustomer] = useState({
    customerName: order.customerName,
    phone: order.phone,
    alternatePhone: order.alternatePhone,
    governorate: order.governorate,
    area: order.area,
    address: order.address,
    notes: order.notes,
    offerName: order.offerName,
  });
  const [lines, setLines] = useState<DraftLine[]>(() => order.products.map((product, index) => ({
    key: index,
    modelId: findProduct(product.modelId) ? product.modelId : "",
    quantity: String(product.quantity),
    price: product.unitPrice === null ? "" : String(product.unitPrice),
    was: findProduct(product.modelId) ? "" : product.name,
  })));
  const [offerPrice, setOfferPrice] = useState(String(order.offerPrice || ""));
  const [shipping, setShipping] = useState(order.shippingCost === null ? "" : String(order.shippingCost));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const setField = (field: keyof typeof customer, value: string) => setCustomer((current) => ({ ...current, [field]: value }));
  const setLine = (key: number, change: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const hasOffer = Number(offerPrice) > 0;
  const offerSlots = hasOffer ? offerPieceCount(customer.offerName) : 0;
  const offerPieces = (except?: number) => lines
    .filter((line) => line.key !== except && line.modelId !== "" && line.price.trim() === "")
    .reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const piecesInOffer = offerPieces();

  function chooseProduct(line: DraftLine, modelId: string) {
    const product = findProduct(modelId);
    // A piece that was part of the offer stays in the offer. A new pajama / blanket fills a free place
    // in the offer (a swapped piece is not charged again); anything else takes the store price.
    const wasInOffer = line.modelId !== "" && line.price === "";
    const fillsOffer = line.modelId === "" && !!product && hasOffer && offerCategories.includes(product.category)
      && offerPieces(line.key) + (Number(line.quantity) || 1) <= offerSlots;
    const inOffer = wasInOffer || fillsOffer;
    const price = !product || inOffer ? (fillsOffer ? "" : line.price) : String(priceOf(product) ?? "");
    setLine(line.key, { modelId, price, was: "" });
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey.current++, modelId: "", quantity: "1", price: "", was: "" }]);
  }

  const parsedLines = lines.map((line) => ({ modelId: line.modelId, quantity: Number(line.quantity), unitPrice: toNumber(line.price) }));
  const numbersOk = parsedLines.every((line) => line.unitPrice === null || (Number.isFinite(line.unitPrice) && line.unitPrice >= 0));
  const totals = numbersOk
    ? editTotals({ offerPrice: Number(offerPrice) || 0, shippingCost: toNumber(shipping), lines: parsedLines.map((line) => ({ ...line, quantity: Number.isFinite(line.quantity) ? line.quantity : 0 })) })
    : null;
  const governorateFee = governorateShippingFee(customer.governorate);

  async function save() {
    if (lines.length === 0) return setError("الأوردر لازم يبقى فيه منتج واحد على الأقل.");
    if (lines.some((line) => !line.modelId)) return setError("اختاري كل منتج من قائمة منتجات الموقع.");
    if (parsedLines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20)) return setError("الكمية لازم تبقى رقم صحيح من ١ لـ ٢٠.");
    if (!numbersOk) return setError("راجعي أسعار القطع.");
    const edit: OrderEdit = { ...customer, offerPrice: Number(offerPrice) || 0, shippingCost: toNumber(shipping), lines: parsedLines };
    setSaving(true);
    setError("");
    try {
      const url = order.source === "site" ? `/api/admin/orders/${order.orderId}` : `/api/admin/old-orders/${order.orderId}`;
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edit }) });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ التعديل.");
        return;
      }
      onSaved(result.order, edit);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setSaving(false);
    }
  }

  const input = (field: keyof typeof customer, label: string, ltr = false) => (
    <label className="admin-field">
      <span>{label}</span>
      <input value={customer[field]} dir={ltr ? "ltr" : undefined} onChange={(event) => setField(field, event.target.value)} list={field === "governorate" ? "order-edit-governorates" : undefined} />
    </label>
  );

  return (
    <dialog ref={dialogRef} className="admin-dialog order-edit-dialog" dir="rtl" aria-labelledby="order-edit-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="order-edit-title">تعديل الأوردر <span dir="ltr" className="mono">{order.orderId}</span></h2>
            <p className="admin-muted">{order.source === "site" ? "أوردر الموقع" : "أوردر تيليجرام"} · {cairoTime(order.createdAt)} · الحالة والديبوزيت مش هيتغيروا</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-dialog-body">
          <section className="admin-detail">
            <h3>المنتجات</h3>
            <div className="order-edit-lines">
              {lines.map((line, index) => {
                const product = findProduct(line.modelId);
                const image = product ? productImage(product.id) : null;
                const quantity = Number(line.quantity);
                const unit = toNumber(line.price);
                return (
                  <div className="order-edit-line" key={line.key}>
                    <span className="admin-order-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail */}
                      {image ? <img src={image} alt="" width={48} height={48} /> : <span className="missing">؟</span>}
                    </span>
                    <label className="admin-field product">
                      <span>منتج {index + 1}{line.was && <small className="admin-warn"> · كان مكتوب: {line.was}</small>}</span>
                      <select value={line.modelId} onChange={(event) => chooseProduct(line, event.target.value)} aria-label={`منتج ${index + 1}`}>
                        <option value="">— اختاري من منتجات الموقع —</option>
                        {categoryOrder.map((category) => (
                          <optgroup key={category} label={categoryInfo[category].label}>
                            {catalog.filter((item) => item.category === category && (!item.hidden || item.id === line.modelId)).map((item) => {
                              const price = priceOf(item);
                              return <option key={item.id} value={item.id}>{item.name} — {price === null ? "ضمن العروض" : formatEGP(price)}{isSoldOut(item.id) ? " (نفذ)" : ""}</option>;
                            })}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label className="admin-field qty">
                      <span>الكمية</span>
                      <input type="number" min={1} max={20} inputMode="numeric" value={line.quantity} onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                    </label>
                    <label className="admin-field price">
                      <span>سعر القطعة</span>
                      <input type="number" min={0} inputMode="decimal" value={line.price} placeholder="ضمن العرض" onChange={(event) => setLine(line.key, { price: event.target.value })} />
                    </label>
                    <span className="order-edit-line-total">{unit === null ? "ضمن العرض" : Number.isFinite(unit * quantity) ? formatEGP(unit * quantity) : "—"}</span>
                    <button type="button" className="admin-icon-btn danger" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} aria-label={`شيلي منتج ${index + 1}`} title="شيلي المنتج"><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
            <button type="button" className="admin-chip order-edit-add" onClick={addLine}><Plus size={14} /> إضافة منتج من الموقع</button>
            <div className="admin-edit-grid">
              {input("offerName", "العرض")}
              <label className="admin-field">
                <span>سعر العرض</span>
                <input type="number" min={0} inputMode="decimal" value={offerPrice} placeholder="0" onChange={(event) => setOfferPrice(event.target.value)} />
              </label>
              <label className="admin-field">
                <span>الشحن</span>
                <input type="number" min={0} inputMode="decimal" value={shipping} placeholder="لسه هيتأكد" onChange={(event) => setShipping(event.target.value)} />
                {governorateFee !== null && String(governorateFee) !== shipping && (
                  <button type="button" className="admin-link small" onClick={() => setShipping(String(governorateFee))}>شحن {customer.governorate}: {formatEGP(governorateFee)} — استخدميه</button>
                )}
              </label>
            </div>
            {hasOffer && piecesInOffer !== offerSlots && (
              <p className="admin-flag warn" role="status">
                العرض {offerSlots} قطع، وفيه {piecesInOffer} بس &quot;ضمن العرض&quot;.
                {piecesInOffer < offerSlots ? " لو القطع التانية بدل قطع من العرض، امسحي سعرها علشان تدخل في العرض ومتتحسبش مرتين." : " شيلي قطعة أو حطيلها سعر."}
              </p>
            )}
            {totals && (
              <dl className="admin-totals">
                {totals.itemsTotal > 0 && <div><dt>القطع المنفردة</dt><dd>{formatEGP(totals.itemsTotal)}</dd></div>}
                <div><dt>المنتجات</dt><dd>{formatEGP(totals.subtotal)}</dd></div>
                <div><dt>الشحن</dt><dd>{toNumber(shipping) === null ? "لسه هيتأكد" : formatEGP(Number(shipping))}</dd></div>
                <div className="grand"><dt>الإجمالي الجديد</dt><dd>{totals.total === null ? `${formatEGP(totals.subtotal)} + الشحن` : formatEGP(totals.total)}</dd></div>
              </dl>
            )}
          </section>

          <section className="admin-detail">
            <h3>بيانات العميلة</h3>
            <div className="admin-edit-grid">
              {input("customerName", "الاسم")}
              {input("phone", "الموبايل", true)}
              {input("alternatePhone", "رقم تاني", true)}
              {input("governorate", "المحافظة")}
              {input("area", "المنطقة / المدينة")}
              <label className="admin-field wide">
                <span>العنوان بالكامل</span>
                <textarea rows={2} value={customer.address} onChange={(event) => setField("address", event.target.value)} />
              </label>
              <label className="admin-field wide">
                <span>ملاحظات</span>
                <textarea rows={2} value={customer.notes} onChange={(event) => setField("notes", event.target.value)} />
              </label>
            </div>
            <datalist id="order-edit-governorates">{shippingGovernorates.map((name) => <option key={name} value={name} />)}</datalist>
          </section>
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={saving} onClick={() => void save()}>{saving ? "جاري الحفظ…" : "حفظ التعديل"}</button>
        </footer>
      </div>
    </dialog>
  );
}
