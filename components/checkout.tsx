"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, Minus, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { addCartItem, emptyCart, MAX_ITEM_QUANTITY, resolveCart, setCartItemQuantity, setCartOffer, type ResolvedCart } from "@/lib/cart";
import { updateCart, useCart } from "@/lib/cart-store";
import { formatEGP } from "@/lib/format";
import { trackAddToCart, trackInitiateCheckout, trackPurchase } from "@/lib/meta-pixel";
import {
  buildWhatsAppOrderText,
  calculateOrderTotals,
  createWhatsAppUrl,
  normalizePhoneDigits,
} from "@/lib/order-flow";
import { findShippingRate, isValidShippingArea, shippingAreasFor, shippingGovernorates } from "@/lib/shipping-rates";
import { landingPromotion, priceOf, visibleCatalog } from "@/lib/site-data";
import { SiteHeader } from "@/components/store-chrome";

type CustomerDetails = {
  name: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
};

type FieldErrors = Partial<Record<keyof CustomerDetails, string>>;

type OrderApiResponse = {
  success?: boolean;
  order?: { orderId: string; createdAt: string; subtotal: number; shippingCost: number | null; total: number | null };
  error?: { message?: string };
};

type PlacedOrder = { orderId: string; whatsAppUrl: string | null; total: number | null };

const emptyCustomer: CustomerDetails = {
  name: "",
  phone: "",
  alternatePhone: "",
  governorate: "",
  area: "",
  address: "",
  notes: "",
};

const upsellProducts = visibleCatalog.filter((product) => priceOf(product) !== null);

function validate(customer: CustomerDetails): FieldErrors {
  const errors: FieldErrors = {};
  const phone = normalizePhoneDigits(customer.phone);
  const alternate = normalizePhoneDigits(customer.alternatePhone);
  if (customer.name.trim().length < 2) errors.name = "اكتبي الاسم بالكامل.";
  if (phone.length < 8 || phone.length > 15) errors.phone = "رقم الموبايل لازم يكون من ٨ لـ ١٥ رقم.";
  if (customer.alternatePhone.trim() && (alternate.length < 8 || alternate.length > 15)) errors.alternatePhone = "راجعي الرقم البديل أو سيبيه فاضي.";
  if (!customer.governorate) errors.governorate = "اختاري المحافظة.";
  if (customer.governorate && !isValidShippingArea(customer.governorate, customer.area)) {
    errors.area = shippingAreasFor(customer.governorate).length > 0 ? "اختاري المنطقة." : "اكتبي المدينة أو المنطقة.";
  }
  if (customer.address.trim().length < 5) errors.address = "اكتبي العنوان بالتفصيل (الشارع، رقم العمارة، الدور).";
  return errors;
}

export function Checkout() {
  const cart = useCart();
  const [customer, setCustomer] = useState<CustomerDetails>(emptyCustomer);
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  // Direct WhatsApp link offered when the order could not be saved, so the sale is not lost.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const attemptRef = useRef<{ submissionId: string; fingerprint: string } | null>(null);
  const checkoutTrackedRef = useRef(false);
  const cartKey = JSON.stringify(cart);

  // Meta Pixel InitiateCheckout: once per checkout visit, as soon as the saved cart has loaded.
  useEffect(() => {
    if (checkoutTrackedRef.current) return;
    const current = resolveCart(JSON.parse(cartKey));
    if ("error" in current) return;
    checkoutTrackedRef.current = true;
    trackInitiateCheckout(current.cart, cartKey);
  }, [cartKey]);

  if (placed) return <OrderPlaced order={placed} />;

  const resolved = resolveCart(cart);
  const errors = validate(customer);
  const shippingFee = findShippingRate(customer.governorate, customer.area)?.fee ?? null;

  function update(field: keyof CustomerDetails, value: string) {
    setCustomer((current) => ({ ...current, [field]: value, ...(field === "governorate" ? { area: "" } : {}) }));
    setSubmitError("");
    setFallbackUrl(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || "error" in resolved) return;
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      const firstInvalid = event.currentTarget.querySelector<HTMLElement>("[aria-invalid='true']");
      firstInvalid?.focus();
      return;
    }

    const snapshot = { ...customer };
    const requestBody = { cart, customer: snapshot };
    const fingerprint = JSON.stringify(requestBody);
    // Reuse the submission ID on retries of the same order so the server keeps the same order number.
    if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint) {
      attemptRef.current = { submissionId: crypto.randomUUID(), fingerprint };
    }

    const cartSnapshot = resolved.cart;
    const whatsAppUrlFor = (order: { reference: string; createdAt: string; subtotal: number; shipping: number | null; total: number | null }) => {
      try {
        return createWhatsAppUrl(buildWhatsAppOrderText({
          ...order,
          customer: snapshot,
          offer: cartSnapshot.offer && {
            label: cartSnapshot.offer.option.label,
            price: cartSnapshot.offer.price,
            items: cartSnapshot.offer.products.map((product) => ({ name: product.name, category: product.category })),
          },
          items: cartSnapshot.items.map((line) => ({ name: line.product.name, quantity: line.quantity, unitPrice: line.unitPrice })),
        }));
      } catch {
        return null;
      }
    };
    const offerDirectWhatsApp = () => {
      const totalsNow = calculateOrderTotals(cartSnapshot.subtotal, shippingFee);
      setFallbackUrl(whatsAppUrlFor({
        reference: "لم يُسجل على الموقع",
        createdAt: new Date().toISOString(),
        subtotal: totalsNow.subtotal,
        shipping: totalsNow.shipping,
        total: totalsNow.total,
      }));
    };

    setIsSubmitting(true);
    setSubmitError("");
    setFallbackUrl(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, submissionId: attemptRef.current.submissionId }),
      });
      const result = await response.json().catch(() => null) as OrderApiResponse | null;
      if (!response.ok || result?.success !== true || !result.order) {
        setSubmitError(result?.error?.message || "معرفناش نسجل الطلب دلوقتي. ابعتيه لنا على واتساب مباشرة، أو جربي تاني.");
        if (response.status >= 500 || !result) offerDirectWhatsApp();
        return;
      }

      const order = result.order;
      const whatsAppUrl = whatsAppUrlFor({
        reference: order.orderId,
        createdAt: order.createdAt,
        subtotal: order.subtotal,
        shipping: order.shippingCost,
        total: order.total,
      });

      // The server only answers success after the order was saved, so Purchase is never sent for a failed order.
      trackPurchase(cartSnapshot, order);
      attemptRef.current = null;
      updateCart(() => emptyCart);
      setPlaced({ orderId: order.orderId, whatsAppUrl, total: order.total });
      window.scrollTo({ top: 0 });
    } catch {
      setSubmitError("مفيش اتصال بالإنترنت أو السيرفر مش بيرد. جربي تاني، أو ابعتي الطلب على واتساب مباشرة.");
      offerDirectWhatsApp();
    } finally {
      setIsSubmitting(false);
    }
  }

  if ("error" in resolved) {
    return (
      <div className="store" dir="rtl">
        <SiteHeader />
        <main className="container empty-cart">
          <h1>السلة فاضية</h1>
          <p>ابدئي بعرض الشتاء أو اختاري عباية أو روب.</p>
          <div className="hero-actions">
            <Link href="/#offer" className="btn btn-primary btn-lg">عرض الشتاء <ArrowLeft size={18} /></Link>
            <Link href="/#abayas" className="btn btn-outline btn-lg">العبايات والأرواب</Link>
          </div>
        </main>
      </div>
    );
  }

  const totals = calculateOrderTotals(resolved.cart.subtotal, shippingFee);
  const areaOptions = shippingAreasFor(customer.governorate);
  const fieldError = (field: keyof CustomerDetails) => showErrors ? errors[field] : undefined;
  const missingUpsells = upsellProducts.filter((product) => !cart.items.some((item) => item.productId === product.id));

  return (
    <div className="store" dir="rtl">
      <SiteHeader />
      <main className="container checkout">
        <Link href="/" className="back-link"><ChevronRight size={18} /> كمّلي تسوق</Link>
        <h1 className="checkout-title">إتمام الطلب</h1>

        <div className="checkout-grid">
          <div className="checkout-main">
            <CartLines cart={resolved.cart} disabled={isSubmitting} />

            {missingUpsells.length > 0 && (
              <section className="checkout-card upsell" aria-labelledby="upsell-title">
                <h2 id="upsell-title">ضيفي معاهم</h2>
                <div className="upsell-row">
                  {missingUpsells.map((product) => (
                    <div className="upsell-item" key={product.id}>
                      <div className="upsell-media"><Image src={product.image} alt={product.imageAlt} fill sizes="120px" /></div>
                      <span className="upsell-name">{product.name}</span>
                      <button type="button" className="btn btn-outline btn-sm" disabled={isSubmitting} onClick={() => { updateCart((current) => addCartItem(current, product.id)); trackAddToCart(product); }}>
                        <Plus size={14} /> {formatEGP(priceOf(product)!)}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <form id="checkout-form" className="checkout-card" onSubmit={submit} noValidate>
              <h2>بيانات التوصيل</h2>
              <div className="fields">
                <Field label="الاسم بالكامل" error={fieldError("name")}>
                  <input autoComplete="name" maxLength={120} value={customer.name} onChange={(e) => update("name", e.target.value)} aria-invalid={!!fieldError("name")} />
                </Field>
                <Field label="رقم الموبايل" error={fieldError("phone")} hint="هنكلمك عليه لتأكيد الطلب">
                  <input type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={30} placeholder="01xxxxxxxxx" value={customer.phone} onChange={(e) => update("phone", e.target.value)} aria-invalid={!!fieldError("phone")} />
                </Field>
                <Field label="رقم تاني" optional error={fieldError("alternatePhone")}>
                  <input type="tel" dir="ltr" inputMode="tel" maxLength={30} value={customer.alternatePhone} onChange={(e) => update("alternatePhone", e.target.value)} aria-invalid={!!fieldError("alternatePhone")} />
                </Field>
                <Field label="المحافظة" error={fieldError("governorate")}>
                  <select value={customer.governorate} onChange={(e) => update("governorate", e.target.value)} aria-invalid={!!fieldError("governorate")}>
                    <option value="">اختاري المحافظة</option>
                    {shippingGovernorates.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}
                  </select>
                </Field>
                <Field label={areaOptions.length > 0 ? "المنطقة" : "المدينة / المنطقة"} error={fieldError("area")} wide>
                  {!customer.governorate ? (
                    <select disabled defaultValue=""><option value="">اختاري المحافظة الأول</option></select>
                  ) : areaOptions.length > 0 ? (
                    <select value={customer.area} onChange={(e) => update("area", e.target.value)} aria-invalid={!!fieldError("area")}>
                      <option value="">اختاري المنطقة</option>
                      {areaOptions.map((area) => {
                        const fee = findShippingRate(customer.governorate, area)?.fee;
                        return <option key={area} value={area}>{area}{fee != null ? ` — شحن ${fee} ج.م` : ""}</option>;
                      })}
                    </select>
                  ) : (
                    <input autoComplete="address-level2" maxLength={120} placeholder="مثلاً: المنصورة، طنطا، سموحة" value={customer.area} onChange={(e) => update("area", e.target.value)} aria-invalid={!!fieldError("area")} />
                  )}
                </Field>
                <Field label="العنوان بالتفصيل" error={fieldError("address")} wide>
                  <textarea rows={3} maxLength={500} autoComplete="street-address" placeholder="الشارع، رقم العمارة، الدور، علامة مميزة" value={customer.address} onChange={(e) => update("address", e.target.value)} aria-invalid={!!fieldError("address")} />
                </Field>
                <Field label="ملاحظات" optional wide>
                  <textarea rows={2} maxLength={500} placeholder="مثلاً: ميعاد مناسب للتوصيل" value={customer.notes} onChange={(e) => update("notes", e.target.value)} />
                </Field>
              </div>
            </form>
          </div>

          <aside className="checkout-summary" aria-label="ملخص الحساب">
            <div className="checkout-card summary-card">
              <h2>الحساب</h2>
              <dl className="totals">
                {resolved.cart.offer && <div><dt>عرض الشتاء</dt><dd>{formatEGP(resolved.cart.offerTotal)}</dd></div>}
                {resolved.cart.items.length > 0 && <div><dt>القطع المنفردة</dt><dd>{formatEGP(resolved.cart.itemsTotal)}</dd></div>}
                <div>
                  <dt>الشحن</dt>
                  <dd>{!customer.area ? "اختاري المنطقة" : shippingFee === null ? "هيتأكد معاكي" : formatEGP(shippingFee)}</dd>
                </div>
                <div className="grand-total">
                  <dt>الإجمالي</dt>
                  <dd>{formatEGP(totals.total ?? totals.subtotal)}{totals.total === null && <small> + الشحن</small>}</dd>
                </div>
              </dl>
              <p className="fine-print">أسعار الشحن مبدئية وممكن تتعدل. الدفع عند الاستلام.</p>
              {submitError && <p className="form-error" role="alert">{submitError}</p>}
              {fallbackUrl && (
                <a href={fallbackUrl} target="_blank" rel="noreferrer" className="btn btn-whatsapp btn-lg btn-block fallback-whatsapp">
                  ابعتي الطلب على واتساب مباشرة <ArrowLeft size={18} />
                </a>
              )}
              <button type="submit" form="checkout-form" className="btn btn-primary btn-lg btn-block" disabled={isSubmitting} aria-busy={isSubmitting}>
                {isSubmitting ? "بنسجل طلبك…" : <>تأكيد الطلب <ArrowLeft size={18} /></>}
              </button>
              <p className="trust-note"><ShieldCheck size={16} /> بنسجل الطلب الأول، وبعدها بيفتحلك واتساب برسالة جاهزة تبعتيها.</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Field({ label, error, hint, optional, wide, children }: {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${wide ? " wide" : ""}${error ? " has-error" : ""}`}>
      <span className="field-label">{label}{optional && <small> (اختياري)</small>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

function CartLines({ cart, disabled }: { cart: ResolvedCart; disabled: boolean }) {
  return (
    <section className="checkout-card" aria-labelledby="cart-title">
      <h2 id="cart-title">السلة</h2>

      {cart.offer && (
        <div className="cart-offer">
          <div className="cart-offer-head">
            <div>
              <strong>عرض الشتاء: {cart.offer.option.label}</strong>
              <span>{formatEGP(cart.offer.price)}</span>
            </div>
            <div className="cart-offer-actions">
              <Link href={`/offer/${cart.offer.option.id}`} className="icon-text-btn"><Pencil size={15} /> تعديل</Link>
              <button type="button" className="icon-text-btn danger" disabled={disabled} onClick={() => updateCart((current) => setCartOffer(current, null))}><Trash2 size={15} /> حذف</button>
            </div>
          </div>
          <ul className="cart-offer-items">
            {cart.offer.products.map((product) => (
              <li key={product.id}>
                <span className="thumb"><Image src={product.image} alt="" fill sizes="64px" /></span>
                <span>{product.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cart.items.length > 0 && (
        <ul className="cart-lines">
          {cart.items.map((line) => (
            <li key={line.product.id}>
              <span className="thumb thumb-lg"><Image src={line.product.image} alt="" fill sizes="80px" /></span>
              <span className="line-info">
                <strong>{line.product.name}</strong>
                <small>{formatEGP(line.unitPrice)} للقطعة</small>
              </span>
              <span className="line-qty" role="group" aria-label={`كمية ${line.product.name}`}>
                <button type="button" disabled={disabled || line.quantity >= MAX_ITEM_QUANTITY} onClick={() => { updateCart((current) => setCartItemQuantity(current, line.product.id, line.quantity + 1)); trackAddToCart(line.product); }} aria-label="زيادة"><Plus size={14} /></button>
                <span>{line.quantity}</span>
                <button type="button" disabled={disabled} onClick={() => updateCart((current) => setCartItemQuantity(current, line.product.id, line.quantity - 1))} aria-label={line.quantity === 1 ? "حذف" : "تقليل"}>
                  {line.quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                </button>
              </span>
              <strong className="line-total">{formatEGP(line.lineTotal)}</strong>
            </li>
          ))}
        </ul>
      )}

      {!cart.offer && (
        <Link href="/#offer" className="cart-offer-promo">
          ضيفي عرض الشتاء: ٤ قطع بـ {formatEGP(landingPromotion.price)} <ArrowLeft size={16} />
        </Link>
      )}
    </section>
  );
}

function OrderPlaced({ order }: { order: PlacedOrder }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(order.orderId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="store" dir="rtl">
      <SiteHeader />
      <main className="container placed">
        <span className="placed-icon"><Check size={34} strokeWidth={3} /></span>
        <h1>طلبك اتسجل!</h1>
        <p>فاضل خطوة أخيرة: افتحي واتساب ودوسي <strong>إرسال</strong> على الرسالة الجاهزة عشان نأكد معاكي.</p>

        <div className="order-number">
          <span>رقم الطلب</span>
          <strong dir="ltr">{order.orderId}</strong>
          <button type="button" className="icon-text-btn" onClick={() => void copy()}>
            {copied ? <><Check size={15} /> اتنسخ</> : <><Copy size={15} /> نسخ</>}
          </button>
        </div>

        {order.whatsAppUrl ? (
          <a href={order.whatsAppUrl} target="_blank" rel="noreferrer" className="btn btn-whatsapp btn-lg">
            افتحي واتساب وابعتي الطلب <ArrowLeft size={18} />
          </a>
        ) : (
          <p className="form-error">معرفناش نجهز رسالة واتساب. طلبك متسجل، ابعتيلنا رقم الطلب على واتساب.</p>
        )}
        <p className="fine-print">لو واتساب مفتحش، دوسي على الزرار تاني. الطلب مش هيتسجل مرتين.</p>
        <Link href="/" className="btn btn-outline">رجوع للمتجر</Link>
      </main>
    </div>
  );
}
