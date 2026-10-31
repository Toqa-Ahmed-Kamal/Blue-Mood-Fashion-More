"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronRight, Plus, ShieldCheck, Trash2 } from "lucide-react";

import {
  landingPromotion,
  winterLooks,
  type LandingPromotionOptionId,
  type WinterLook,
} from "@/lib/site-data";
import {
  addUniqueModel,
  buildWhatsAppOrderText,
  calculateOrderTotals,
  countBundleEntries,
  createOrderReference,
  createWhatsAppUrl,
  isBundleComplete,
  normalizePhoneDigits,
  pajamaFitLabel,
  removeBundleModel,
  type BundleEntry,
} from "@/lib/order-flow";
import { findShippingRate, shippingAreasFor, shippingGovernorates } from "@/lib/shipping-rates";

type CustomerDetails = {
  name: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
};

type OrderStep = "offer" | "selection" | "customer" | "review" | "prepared";

const emptyCustomer: CustomerDetails = {
  name: "",
  phone: "",
  alternatePhone: "",
  governorate: "",
  area: "",
  address: "",
  notes: "",
};

const steps: { id: Exclude<OrderStep, "prepared">; label: string }[] = [
  { id: "offer", label: "اختيار العرض" },
  { id: "selection", label: "اختيار القطع" },
  { id: "customer", label: "بيانات العميل" },
  { id: "review", label: "مراجعة الطلب" },
];

export function OfferBuilder({ initialOfferId }: { initialOfferId: LandingPromotionOptionId }) {
  const [step, setStep] = useState<OrderStep>("offer");
  const [activeOfferId, setActiveOfferId] = useState<LandingPromotionOptionId>(initialOfferId);
  const [bundle, setBundle] = useState<BundleEntry[]>([]);
  const [customer, setCustomer] = useState<CustomerDetails>(emptyCustomer);
  const [flowError, setFlowError] = useState("");
  const [preparedReference, setPreparedReference] = useState("");
  const preparingRef = useRef(false);

  const activeOffer = landingPromotion.options.find((offer) => offer.id === activeOfferId)!;
  const requirements = {
    pajamaCount: activeOffer.pajamaCount,
    wearableBlanketCount: activeOffer.wearableBlanketCount,
  };
  const counts = useMemo(() => countBundleEntries(bundle), [bundle]);
  const isComplete = isBundleComplete(bundle, requirements);
  const neededCount = activeOffer.pajamaCount + activeOffer.wearableBlanketCount;
  const shippingAreas = shippingAreasFor(customer.governorate);
  const shippingRate = findShippingRate(customer.governorate, customer.area);
  const shippingFee = shippingRate?.fee ?? null;
  const orderTotals = calculateOrderTotals(landingPromotion.price, shippingFee);
  const total = orderTotals.total;
  const currentStepIndex = steps.findIndex((item) => item.id === step);
  const primaryPhoneDigits = normalizePhoneDigits(customer.phone);
  const alternatePhoneDigits = normalizePhoneDigits(customer.alternatePhone);
  const customerIsValid = customer.name.trim().length >= 2 &&
    primaryPhoneDigits.length >= 8 && primaryPhoneDigits.length <= 15 &&
    (!customer.alternatePhone || (alternatePhoneDigits.length >= 8 && alternatePhoneDigits.length <= 15)) &&
    customer.governorate === "القاهرة" &&
    shippingAreas.includes(customer.area) &&
    customer.address.trim().length >= 5;

  function chooseOffer(offerId: LandingPromotionOptionId) {
    setActiveOfferId(offerId);
    setBundle([]);
    setFlowError("");
  }

  function addModel(look: WinterLook) {
    const entry: BundleEntry = {
      modelId: look.id,
      name: look.name,
      category: look.category,
      image: look.image,
    };
    const result = addUniqueModel(bundle, entry, requirements);
    if (!result.added) {
      setFlowError("هذا الموديل مضاف بالفعل أو اكتمل عدد فئته في العرض.");
      return;
    }
    setBundle(result.bundle);
    setFlowError("");
  }

  function removeModel(modelId: string) {
    setBundle((current) => removeBundleModel(current, modelId));
    setFlowError("");
  }

  function updateCustomer(field: keyof CustomerDetails, value: string) {
    setCustomer((current) => ({ ...current, [field]: value }));
    setFlowError("");
  }

  function continueToReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isComplete) {
      setFlowError("اختيار القطع غير مكتمل. عودي للخطوة السابقة وأكملي الباندل أولًا.");
      return;
    }
    const validationMessage = getCustomerValidationMessage();
    if (validationMessage) {
      setFlowError(validationMessage);
      return;
    }
    setStep("review");
  }

  function getCustomerValidationMessage() {
    if (customer.name.trim().length < 2) return "اكتبي الاسم بالكامل للمتابعة.";
    if (primaryPhoneDigits.length < 8 || primaryPhoneDigits.length > 15) return "راجعي رقم الموبايل؛ أدخلي من ٨ إلى ١٥ رقمًا.";
    if (customer.alternatePhone && (alternatePhoneDigits.length < 8 || alternatePhoneDigits.length > 15)) return "راجعي الرقم البديل أو اتركيه فارغًا لأنه اختياري.";
    if (customer.governorate !== "القاهرة") return "اختاري المحافظة للمتابعة.";
    if (!shippingAreas.includes(customer.area)) return "اختاري المنطقة من القائمة للمتابعة.";
    if (customer.address.trim().length < 5) return "اكتبي العنوان بالتفصيل للمتابعة.";
    return "";
  }

  function prepareWhatsAppOrder() {
    if (preparingRef.current) return;
    const validationMessage = getCustomerValidationMessage();
    if (!isComplete || validationMessage) {
      setFlowError(validationMessage || "اختيار القطع غير مكتمل. عودي للخطوة السابقة وأكملي الباندل أولًا.");
      return;
    }

    preparingRef.current = true;
    const createdAt = new Date();
    const reference = createOrderReference(createdAt, crypto.randomUUID());
    const text = buildWhatsAppOrderText({
      reference,
      createdAt: createdAt.toISOString(),
      customer,
      offerLabel: activeOffer.label,
      items: bundle,
      offerPrice: landingPromotion.price,
      shipping: orderTotals.shipping,
      total: orderTotals.total,
    });
    const target = window.open(createWhatsAppUrl(text), "_blank");

    if (!target) {
      setFlowError("تعذر فتح واتساب. اسمحي بالنوافذ المنبثقة لهذا الموقع ثم أعيدي المحاولة.");
      preparingRef.current = false;
      return;
    }

    target.opener = null;
    setPreparedReference(reference);
    setFlowError("");
    setStep("prepared");
  }

  return (
    <div className="storefront offer-flow-shell" dir="rtl">
      <main className="offer-flow page-width">
        <div className="offer-flow-topbar">
          <Link href="/#offers" className="offer-flow-back"><ChevronRight size={17} /> العودة للعروض</Link>
          <Link href="/" className="offer-flow-brand" aria-label="Blue Mood، الرئيسية">
            <Image src="/images/blue-mood-logo.png" alt="Blue Mood Fashion & More" width={60} height={60} />
          </Link>
          <span>Blue Mood · Fashion & More</span>
        </div>

        <section className="offer-flow-panel" aria-labelledby="offer-flow-title">
          <header className="offer-flow-heading">
            <span className="eyebrow">عرض الشتاء · {landingPromotion.price.toLocaleString("en-EG")} EGP</span>
            <h1 id="offer-flow-title">تجربة اختيار دافئة ومتكاملة</h1>
            <p>اختاري العرض والقطع، ثم راجعي تفاصيل رسالتك قبل فتح واتساب.</p>
          </header>

          {step !== "prepared" && (
            <ol className="offer-stepper" aria-label="خطوات إتمام الطلب">
              {steps.map((item, index) => {
                const complete = index < currentStepIndex;
                return (
                  <li className={step === item.id ? "offer-step active" : complete ? "offer-step complete" : "offer-step"} key={item.id} aria-current={step === item.id ? "step" : undefined}>
                    <span>{complete ? <Check size={14} /> : (index + 1).toLocaleString("ar-EG")}</span>
                    <strong>{item.label}</strong>
                  </li>
                );
              })}
            </ol>
          )}

          {step === "offer" && (
            <div className="offer-step-content">
              <div className="offer-selection-heading">
                <div><span className="offer-kicker">01 · ابدئي من هنا</span><h2>اختاري باقة الشتاء</h2></div>
                <span className="offer-fixed-price">{landingPromotion.price.toLocaleString("en-EG")} <small>EGP</small></span>
              </div>
              <div className="offer-choice-grid">
                {landingPromotion.options.map((offer, index) => (
                  <button type="button" className={activeOfferId === offer.id ? "offer-choice-card selected" : "offer-choice-card"} aria-pressed={activeOfferId === offer.id} onClick={() => chooseOffer(offer.id)} key={offer.id}>
                    <span className="offer-choice-number">{(index + 1).toLocaleString("ar-EG")}</span>
                    <span className="offer-choice-copy"><strong>{offer.label}</strong><small>{offer.wearableBlanketCount > 0 ? "تشمل بلانكيت شتويًا قابلًا للارتداء" : "أربع موديلات مختلفة من البيجامات الشتوية"}</small></span>
                    <span className="offer-choice-check"><Check size={15} /></span>
                  </button>
                ))}
              </div>
              <div className="offer-flow-actions">
                <span>سعر الباقة ثابت: <strong>{landingPromotion.price.toLocaleString("en-EG")} EGP</strong></span>
                <button type="button" className="builder-primary-action" onClick={() => setStep("selection")}>اختيار القطع <ArrowLeft size={16} /></button>
              </div>
            </div>
          )}

          {step === "selection" && (
            <div className="offer-step-content">
              <div className="offer-selection-heading">
                <div><span className="offer-kicker">02 · قطع من الكتالوج </span><h2>{activeOffer.label}</h2></div>
                <button type="button" className="builder-text-action" onClick={() => setStep("offer")}>تغيير العرض</button>
              </div>
              <BundleStrip bundle={bundle} targetCount={neededCount} onRemove={removeModel} />
              <div className="selection-progress" aria-live="polite">
                <div><span>موديلات بيجامات فريدة</span><strong>{counts.pajamas.toLocaleString("ar-EG")} <small>/ {activeOffer.pajamaCount.toLocaleString("ar-EG")}</small></strong></div>
                {activeOffer.wearableBlanketCount > 0 && <div><span>موديل بلانكيت قابل للارتداء</span><strong>{counts.wearableBlankets.toLocaleString("ar-EG")} <small>/ {activeOffer.wearableBlanketCount.toLocaleString("ar-EG")}</small></strong></div>}
                <div className={isComplete ? "selection-progress-status complete" : "selection-progress-status"}>{isComplete ? "اكتمل العدد المطلوب" : `متبقي ${(neededCount - bundle.length).toLocaleString("ar-EG")} قطعة`}</div>
              </div>
              {flowError && <p className="order-error" role="alert">{flowError}</p>}
              <div className="builder-products">
                {winterLooks.filter((look) => activeOffer.wearableBlanketCount > 0 || look.category === "winter-pajamas").map((look) => {
                  const isBlanket = look.category === "wearable-blankets";
                  const alreadyAdded = bundle.some((entry) => entry.modelId === look.id);
                  const typeCount = isBlanket ? counts.wearableBlankets : counts.pajamas;
                  const typeLimit = isBlanket ? activeOffer.wearableBlanketCount : activeOffer.pajamaCount;
                  return (
                    <OfferProductCard
                      key={look.id}
                      look={look}
                      selected={alreadyAdded}
                      full={typeCount >= typeLimit}
                      onAdd={() => addModel(look)}
                    />
                  );
                })}
              </div>
              <div className="offer-flow-actions">
                <span>المتبقي {(neededCount - bundle.length).toLocaleString("ar-EG")} من {neededCount.toLocaleString("ar-EG")} قطع · موديلات بلا تكرار</span>
                <button type="button" className="builder-primary-action" disabled={!isComplete} onClick={() => setStep("customer")}>متابعة لبيانات العميل <ArrowLeft size={16} /></button>
              </div>
            </div>
          )}

          {step === "customer" && (
            <form className="customer-form" onSubmit={continueToReview} onInvalidCapture={() => setFlowError("أكملي كل الحقول المطلوبة والمحددة بعلامة النجمة للمتابعة.")}>
              <div className="offer-selection-heading"><div><span className="offer-kicker">03 · بيانات التواصل</span><h2>إلى أين نرسل طلبكِ؟</h2></div></div>
              <p className="customer-form-intro">اكتبي بيانات التواصل وعنوان الوصول بدقة.</p>
              <div className="customer-fields">
                <label><span>الاسم بالكامل <b>*</b></span><input required minLength={2} maxLength={120} autoComplete="name" value={customer.name} onChange={(event) => updateCustomer("name", event.target.value)} /></label>
                <label><span>رقم الموبايل <b>*</b></span><input required type="tel" autoComplete="tel" inputMode="tel" minLength={8} maxLength={30} value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} /></label>
                <label><span>رقم بديل <small>اختياري</small></span><input type="tel" autoComplete="tel-national" inputMode="tel" maxLength={30} value={customer.alternatePhone} onChange={(event) => updateCustomer("alternatePhone", event.target.value)} /></label>
                <label><span>المحافظة <b>*</b></span><select required value={customer.governorate} onChange={(event) => { setCustomer((current) => ({ ...current, governorate: event.target.value, area: "" })); setFlowError(""); }}><option value="">اختاري المحافظة</option>{shippingGovernorates.map((governorate) => <option key={governorate} value={governorate}>{governorate}</option>)}</select></label>
                <label><span>المنطقة أو المدينة <b>*</b></span><select required disabled={!customer.governorate} value={customer.area} onChange={(event) => updateCustomer("area", event.target.value)}><option value="">{customer.governorate ? "اختاري المنطقة" : "اختاري المحافظة أولًا"}</option>{shippingAreas.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
                <label className="address-field"><span>العنوان بالتفصيل <b>*</b></span><textarea required minLength={5} maxLength={500} rows={3} autoComplete="street-address" value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} /></label>
                <label className="address-field"><span>ملاحظات إضافية <small>اختياري</small></span><textarea maxLength={500} rows={2} value={customer.notes} onChange={(event) => updateCustomer("notes", event.target.value)} /></label>
              </div>
              <ShippingStatus governorate={customer.governorate} area={customer.area} />
              <p className="draft-warning">أسعار الشحن الحالية مبدئية وقابلة للتعديل؛ سيظهر سعر المنطقة المختارة كتقدير حتى تأكيده.</p>
              {flowError && <p className="order-error" role="alert">{flowError}</p>}
              <div className="offer-flow-actions">
                <button type="button" className="builder-secondary-action" onClick={() => setStep("selection")}>العودة للقطع</button>
                <button type="submit" className="builder-primary-action">مراجعة الإجمالي <ArrowLeft size={16} /></button>
              </div>
            </form>
          )}

          {step === "review" && (
            <section className="order-review" aria-labelledby="order-review-title">
              <div className="offer-selection-heading"><div><span className="offer-kicker">04 · قبل الانتقال إلى واتساب</span><h2 id="order-review-title">مراجعة الطلب</h2></div><button type="button" className="builder-text-action" onClick={() => setStep("customer")}>تعديل البيانات</button></div>
              <BundleStrip bundle={bundle} targetCount={neededCount} onRemove={removeModel} compact />
              <div className="review-block"><h3>العرض والقطع</h3><p className="review-offer-name">{activeOffer.label}</p><ul>{bundle.map((entry) => <li key={entry.modelId}><span>{entry.name} · {entry.category === "winter-pajamas" ? pajamaFitLabel : "بلانكيت شتوي قابل للارتداء"}</span><strong>× ١</strong></li>)}</ul></div>
              <div className="review-block customer-review"><h3>بيانات العميل</h3><dl>
                <div><dt>الاسم</dt><dd>{customer.name}</dd></div><div><dt>رقم الموبايل</dt><dd dir="ltr">{customer.phone}</dd></div>
                {customer.alternatePhone && <div><dt>رقم بديل</dt><dd dir="ltr">{customer.alternatePhone}</dd></div>}
                <div><dt>المحافظة</dt><dd>{customer.governorate}</dd></div><div><dt>المنطقة</dt><dd>{customer.area}</dd></div><div><dt>العنوان</dt><dd>{customer.address}</dd></div>
                {customer.notes && <div><dt>ملاحظات</dt><dd>{customer.notes}</dd></div>}
              </dl></div>
              <div className="review-totals"><div><span>سعر العرض</span><strong>{landingPromotion.price.toLocaleString("en-EG")} جنيه</strong></div><div><span>الشحن {shippingFee !== null ? "· مبدئي" : ""}</span><strong>{shippingFee === null ? "غير مؤكد" : `${shippingFee.toLocaleString("en-EG")} جنيه`}</strong></div><div className="review-total"><span>الإجمالي {total !== null ? "· تقديري قابل للتعديل" : ""}</span><strong>{total === null ? "غير متاح حتى تأكيد الشحن" : `${total.toLocaleString("en-EG")} جنيه`}</strong></div></div>
              {shippingFee === null && <p className="draft-warning">لا يوجد سعر محدد لهذه المنطقة. يمكنكِ تجهيز رسالة واتساب، وسيُذكر فيها أن تكلفة الشحن والإجمالي النهائي يحتاجان إلى تأكيد لاحقًا.</p>}
              <p className="shipping-estimate-note">أسعار الشحن المدرجة مبدئية وقابلة للتعديل؛ الإجمالي المعروض تقديري.</p>
              {flowError && <p className="order-error" role="alert">{flowError}</p>}
              <div className="order-trust-note"><ShieldCheck size={17} /><span>سيُفتح واتساب برسالة مجهزة؛ يجب الضغط على «إرسال» داخل واتساب. فتحه لا يعني وصول الطلب.</span></div>
              <div className="offer-flow-actions">
                <button type="button" className="builder-secondary-action" onClick={() => setStep("customer")}>العودة للتعديل</button>
                <button type="button" className="builder-primary-action confirm-order-button" disabled={!isComplete || !customerIsValid} onClick={prepareWhatsAppOrder}>تأكيد الطلب عبر واتساب</button>
              </div>
            </section>
          )}

          {step === "prepared" && (
            <section className="order-success whatsapp-prepared" aria-labelledby="order-prepared-title">
              <span className="order-success-icon"><Check size={27} /></span>
              <span className="offer-kicker">تم فتح واتساب</span>
              <h2 id="order-prepared-title">تم تجهيز طلبك للإرسال عبر واتساب</h2>
              <p>راجعي الرسالة المجهزة ثم اضغطي «إرسال» داخل واتساب. لم يُستلم الطلب أو يُسجّل لدى المتجر بمجرد فتح الرابط.</p>
              <div className="success-order-number"><span>مرجع الرسالة</span><strong dir="ltr">{preparedReference}</strong></div>
              <Link href="/" className="builder-primary-action review-return">العودة للمتجر</Link>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

function BundleStrip({ bundle, targetCount, onRemove, compact = false }: { bundle: BundleEntry[]; targetCount: number; onRemove: (modelId: string) => void; compact?: boolean }) {
  return (
    <section className={compact ? "bundle-strip compact" : "bundle-strip"} aria-label="الباندل المختار">
      <div className="bundle-strip-heading"><div><span>باندلكِ</span><small>موديلات فريدة بلا تكرار</small></div><strong>{bundle.length.toLocaleString("ar-EG")} <small>/ {targetCount.toLocaleString("ar-EG")} قطع</small></strong></div>
      <div className="bundle-strip-items">
        {Array.from({ length: targetCount }, (_, index) => {
          const entry = bundle[index];
          if (!entry) return <div className="bundle-empty-slot" key={`empty-${index}`}><span>{(index + 1).toLocaleString("ar-EG")}</span><small>اختاري قطعة</small></div>;
          return (
            <article className="bundle-item" key={entry.modelId}>
              <div className="bundle-item-image"><Image src={entry.image} alt={entry.name} fill sizes="68px" /></div>
              <div className="bundle-item-copy"><strong>{entry.name}</strong><small>{entry.category === "winter-pajamas" ? pajamaFitLabel : "بلانكيت شتوي قابل للارتداء"}</small></div>
              <button type="button" className="bundle-remove" onClick={() => onRemove(entry.modelId)} aria-label={`حذف ${entry.name} من الباندل`} title="حذف القطعة"><Trash2 size={15} /></button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OfferProductCard({ look, selected, full, onAdd }: {
  look: WinterLook;
  selected: boolean;
  full: boolean;
  onAdd: () => void;
}) {
  const isBlanket = look.category === "wearable-blankets";

  return (
    <article className={selected ? "builder-product selected" : "builder-product"}>
      <div className="builder-product-image"><Image src={look.image} alt={look.imageAlt} fill sizes="(max-width: 600px) 44vw, (max-width: 900px) 30vw, 24vw" /></div>
      <div className="builder-product-info">
        <span className="builder-product-type">{isBlanket ? "بلانكيت شتوي · يُرتدى كقطعة ملابس" : "بيجاما شتوية"}</span>
        <h3>{look.name}</h3>
        {!isBlanket ? (
          <p className="pajama-fit-label">{pajamaFitLabel}</p>
        ) : (
          <p className="blanket-no-size">قطعة ملابس شتوية قابلة للارتداء · لا تتوفر مقاسات موثقة</p>
        )}
        <button type="button" className={selected ? "product-add-button added" : "product-add-button"} onClick={onAdd} disabled={selected || full}>
          {selected ? <><Check size={15} /> تمت الإضافة</> : full ? "اكتمل العدد" : <><Plus size={16} /> أضيفي للباندل</>}
        </button>
      </div>
    </article>
  );
}

function ShippingStatus({ governorate, area }: { governorate: string; area: string }) {
  if (!governorate || !area) {
    return <p className="shipping-config-note">اختاري القاهرة ثم المنطقة لعرض تعرفة الشحن الأولية.</p>;
  }
  const rate = findShippingRate(governorate, area);
  if (!rate || rate.fee === null) return <p className="shipping-config-note">لا توجد تعرفة لهذه المنطقة بعد. يمكن المتابعة، لكن تكلفة الشحن ستحتاج إلى تأكيد.</p>;
  return <p className="shipping-rate-confirmed draft-rate">الشحن إلى {area}: {rate.fee.toLocaleString("en-EG")} جنيه · سعر مبدئي قابل للتعديل</p>;
}
