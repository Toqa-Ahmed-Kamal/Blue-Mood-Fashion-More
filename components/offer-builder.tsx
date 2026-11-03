"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, Expand, X } from "lucide-react";

import { QuickView } from "@/components/product-card";
import { SiteHeader } from "@/components/store-chrome";
import { setCartOffer } from "@/lib/cart";
import { updateCart, useCart } from "@/lib/cart-store";
import { formatEGP } from "@/lib/format";
import {
  findOffer,
  findProduct,
  landingPromotion,
  productsIn,
  type CatalogProduct,
  type LandingPromotionOptionId,
} from "@/lib/site-data";

type OfferCategory = "winter-pajamas" | "wearable-blankets";

const tabLabels: Record<OfferCategory, string> = {
  "winter-pajamas": "بيجامات",
  "wearable-blankets": "بلانكيت",
};

function limitFor(offerId: LandingPromotionOptionId, category: OfferCategory) {
  const offer = findOffer(offerId)!;
  return category === "winter-pajamas" ? offer.pajamaCount : offer.wearableBlanketCount;
}

/** Keeps as many of the current picks as the newly chosen offer allows. */
function fitSelectionToOffer(ids: string[], offerId: LandingPromotionOptionId) {
  const used: Record<OfferCategory, number> = { "winter-pajamas": 0, "wearable-blankets": 0 };
  return ids.filter((id) => {
    const product = findProduct(id);
    if (!product || (product.category !== "winter-pajamas" && product.category !== "wearable-blankets")) return false;
    if (used[product.category] >= limitFor(offerId, product.category)) return false;
    used[product.category] += 1;
    return true;
  });
}

export function OfferBuilder({ initialOfferId }: { initialOfferId: LandingPromotionOptionId }) {
  const router = useRouter();
  const cart = useCart();
  const [offerId, setOfferId] = useState<LandingPromotionOptionId>(initialOfferId);
  // null until the customer touches the selection, so an offer already in the cart is shown for editing.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [tab, setTab] = useState<OfferCategory>("winter-pajamas");
  const [notice, setNotice] = useState("");
  const [quickView, setQuickView] = useState<CatalogProduct | null>(null);

  const offer = findOffer(offerId)!;
  const savedIds = cart.offer?.offerId === offerId ? cart.offer.productIds : [];
  const selectedIds = draft ?? savedIds;
  const selected = selectedIds.map(findProduct).filter((product): product is CatalogProduct => product !== undefined);
  const neededTotal = offer.pajamaCount + offer.wearableBlanketCount;
  const countOf = (category: OfferCategory) => selected.filter((product) => product.category === category).length;
  const isComplete = countOf("winter-pajamas") === offer.pajamaCount && countOf("wearable-blankets") === offer.wearableBlanketCount;
  const tabs: OfferCategory[] = offer.wearableBlanketCount > 0 ? ["winter-pajamas", "wearable-blankets"] : ["winter-pajamas"];
  const activeTab = tabs.includes(tab) ? tab : "winter-pajamas";
  const replacesOtherOffer = cart.offer !== null && cart.offer.offerId !== offerId;

  function chooseOffer(nextId: LandingPromotionOptionId) {
    if (nextId === offerId) return;
    setDraft(fitSelectionToOffer(selectedIds, nextId));
    setOfferId(nextId);
    setNotice("");
    router.replace(`/offer/${nextId}`, { scroll: false });
  }

  function toggle(product: CatalogProduct) {
    if (product.category !== "winter-pajamas" && product.category !== "wearable-blankets") return;
    if (selectedIds.includes(product.id)) {
      setDraft(selectedIds.filter((id) => id !== product.id));
      setNotice("");
      return;
    }
    const limit = limitFor(offerId, product.category);
    if (countOf(product.category) >= limit) {
      setNotice(`اخترتي ${limit} ${tabLabels[product.category]} خلاص. شيلي واحدة الأول عشان تبدليها.`);
      return;
    }
    const next = [...selectedIds, product.id];
    setDraft(next);
    setNotice("");

    // Jump to the next category that still needs a pick.
    const nextCounts = (category: OfferCategory) => next.map(findProduct).filter((item) => item?.category === category).length;
    if (product.category === "winter-pajamas" && nextCounts("winter-pajamas") === offer.pajamaCount && offer.wearableBlanketCount > nextCounts("wearable-blankets")) {
      setTab("wearable-blankets");
    }
  }

  function confirm() {
    if (!isComplete) return;
    updateCart((current) => setCartOffer(current, { offerId, productIds: selectedIds }));
    router.push("/checkout");
  }

  const visibleProducts = productsIn(activeTab);
  const tabFull = countOf(activeTab) >= limitFor(offerId, activeTab);

  return (
    <div className="store builder-page" dir="rtl">
      <SiteHeader />

      <main className="container builder">
        <Link href="/#offer" className="back-link"><ChevronRight size={18} /> رجوع للمتجر</Link>

        <header className="builder-head">
          <span className="eyebrow">عرض الشتاء · {formatEGP(landingPromotion.price)}</span>
          <h1>كوّني عرضك</h1>
          <p>اختاري الباقة، وبعدين دوسي على القطع اللي عاجباكي. كل موديل مرة واحدة بس.</p>
        </header>

        <div className="segmented" role="radiogroup" aria-label="نوع الباقة">
          {landingPromotion.options.map((option) => (
            <button
              type="button"
              role="radio"
              aria-checked={option.id === offerId}
              className={option.id === offerId ? "active" : ""}
              onClick={() => chooseOffer(option.id)}
              key={option.id}
            >
              <strong>{option.label}</strong>
              <small>{formatEGP(landingPromotion.price)}</small>
            </button>
          ))}
        </div>

        {tabs.length > 1 && (
          <div className="tabs" role="tablist" aria-label="نوع القطع">
            {tabs.map((category) => (
              <button
                type="button"
                role="tab"
                aria-selected={category === activeTab}
                className={category === activeTab ? "active" : ""}
                onClick={() => setTab(category)}
                key={category}
              >
                {tabLabels[category]}
                <span className={countOf(category) === limitFor(offerId, category) ? "tab-count done" : "tab-count"}>
                  {countOf(category)}/{limitFor(offerId, category)}
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="builder-notice" role="status" aria-live="polite">{notice}</p>

        <div className="pick-grid">
          {visibleProducts.map((product) => {
            const isSelected = selectedIds.includes(product.id);
            const order = selectedIds.indexOf(product.id) + 1;
            return (
              <div className={`pick-card${isSelected ? " selected" : ""}${!isSelected && tabFull ? " muted" : ""}`} key={product.id}>
                <button type="button" className="pick-toggle" aria-pressed={isSelected} onClick={() => toggle(product)}>
                  <span className="pick-media">
                    <Image src={product.image} alt={product.imageAlt} fill sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw" />
                    <span className="pick-check" aria-hidden="true">{isSelected ? order : <Check size={16} />}</span>
                  </span>
                  <span className="pick-name">{product.name}</span>
                  <span className="pick-state">{isSelected ? "مختارة · دوسي للإلغاء" : tabFull ? "العدد كمل" : "دوسي للاختيار"}</span>
                </button>
                <button type="button" className="pick-zoom" onClick={() => setQuickView(product)} aria-label={`عرض صورة ${product.name} بالكامل`}>
                  <Expand size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </main>

      <div className="builder-tray" role="region" aria-label="القطع المختارة">
        <div className="container tray-inner">
          <div className="tray-slots">
            {Array.from({ length: neededTotal }, (_, index) => {
              const product = selected[index];
              return product ? (
                <button type="button" className="tray-slot filled" key={product.id} onClick={() => toggle(product)} aria-label={`شيلي ${product.name}`}>
                  <Image src={product.image} alt="" fill sizes="56px" />
                  <span className="tray-remove"><X size={12} /></span>
                </button>
              ) : (
                <span className="tray-slot" key={`empty-${index}`}>{index + 1}</span>
              );
            })}
          </div>
          <div className="tray-cta">
            <span className="tray-progress">
              {isComplete ? "العرض كامل ✓" : `فاضل ${neededTotal - selected.length} من ${neededTotal}`}
              {replacesOtherOffer && isComplete && <small>هيحل محل العرض اللي في السلة</small>}
            </span>
            <button type="button" className="btn btn-primary" disabled={!isComplete} onClick={confirm}>
              كمّلي الطلب <ArrowLeft size={18} />
            </button>
          </div>
        </div>
      </div>

      <QuickView
        product={quickView}
        onClose={() => setQuickView(null)}
        action={quickView && (
          <button type="button" className="btn btn-dark btn-block" onClick={() => { toggle(quickView); setQuickView(null); }}>
            {selectedIds.includes(quickView.id) ? "شيليها من العرض" : "اختاريها في العرض"}
          </button>
        )}
      />
    </div>
  );
}
