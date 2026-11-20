"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, ChevronRight, ShoppingBag } from "lucide-react";

import { FitNote } from "@/components/product-card";
import { SiteHeader } from "@/components/store-chrome";
import { availableBundles, bundleChoices, bundleSinglesTotal, findBundle, type Bundle } from "@/lib/bundles";
import { setCartBundle } from "@/lib/cart";
import { updateCart, useCart } from "@/lib/cart-store";
import { formatEGP } from "@/lib/format";

/** "عروض خاصة" on the home page: live bundles only; hidden while there are none. */
export function BundlesSection() {
  const bundles = availableBundles();
  if (bundles.length === 0) return null;
  return (
    <section className="container catalog-section bundles-section" id="bundles" aria-labelledby="bundles-title">
      <header className="section-head">
        <span className="section-ornament" aria-hidden="true">✦</span>
        <h2 id="bundles-title">عروض خاصة</h2>
        <p>قطع مختارة مع بعض بسعر أوفر</p>
      </header>
      <div className="bundle-grid">
        {bundles.map((bundle) => <BundleCard bundle={bundle} key={bundle.id} />)}
      </div>
    </section>
  );
}

function BundleCard({ bundle }: { bundle: Bundle }) {
  const router = useRouter();
  const cart = useCart();
  const choices = bundleChoices(bundle);
  const shown = choices.slice(0, 4);
  const singles = bundle.kind === "fixed" ? bundleSinglesTotal(choices) : null;
  const inCart = (cart.bundles ?? []).some((entry) => entry.bundleId === bundle.id);

  function addFixed() {
    updateCart((current) => setCartBundle(current, { bundleId: bundle.id, productIds: choices.map((product) => product.id) }));
    router.push("/checkout");
  }

  return (
    <article className="bundle-card">
      <div className={`bundle-thumbs n${shown.length}`}>
        {shown.map((product) => (
          <span className="bundle-thumb" key={product.id}><Image src={product.image} alt={product.imageAlt} fill sizes="(max-width: 640px) 25vw, 160px" /></span>
        ))}
      </div>
      <div className="bundle-body">
        <h3>{bundle.name}</h3>
        <p className="bundle-desc">
          {bundle.kind === "fixed"
            ? choices.map((product) => product.name).join(" + ")
            : `اختاري ${bundle.pickCount} ${bundle.pickCount === 1 ? "قطعة" : "قطع"} من ${choices.length} موديل`}
        </p>
        <p className="bundle-price">
          <strong>{formatEGP(bundle.price)}</strong>
          {singles !== null && singles > bundle.price && <s>{formatEGP(singles)}</s>}
        </p>
        {bundle.kind === "fixed" ? (
          <button type="button" className="btn btn-primary" onClick={addFixed}>{inCart ? <><Check size={16} /> في السلة · كمّلي</> : <><ShoppingBag size={16} /> أضيفي العرض للسلة</>}</button>
        ) : (
          <Link href={`/bundle/${bundle.id}`} className="btn btn-pink">{inCart ? "عدّلي اختيارك" : "اختاري القطع"} <ArrowLeft size={16} /></Link>
        )}
      </div>
    </article>
  );
}

/** /bundle/[id]: the customer picks the pieces of a "pick" bundle. */
export function BundleBuilder({ bundleId }: { bundleId: string }) {
  const router = useRouter();
  const cart = useCart();
  const bundle = findBundle(bundleId);
  const saved = (cart.bundles ?? []).find((entry) => entry.bundleId === bundleId)?.productIds ?? [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");

  if (!bundle || bundle.kind !== "pick") {
    return (
      <div className="store builder-page" dir="rtl">
        <SiteHeader />
        <main className="container builder">
          <Link href="/#bundles" className="back-link"><ChevronRight size={18} /> رجوع للمتجر</Link>
          <p className="builder-notice">العرض ده مش متاح دلوقتي.</p>
        </main>
      </div>
    );
  }

  const choices = bundleChoices(bundle);
  const allowed = new Set(choices.map((product) => product.id));
  const selectedIds = (draft ?? saved).filter((id) => allowed.has(id));
  const isComplete = selectedIds.length === bundle.pickCount;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      setDraft(selectedIds.filter((other) => other !== id));
      setNotice("");
      return;
    }
    if (selectedIds.length >= bundle!.pickCount) {
      setNotice(`اخترتي ${bundle!.pickCount} خلاص. شيلي واحدة الأول عشان تبدليها.`);
      return;
    }
    setDraft([...selectedIds, id]);
    setNotice("");
  }

  function confirm() {
    if (!isComplete) return;
    updateCart((current) => setCartBundle(current, { bundleId: bundle!.id, productIds: selectedIds }));
    router.push("/checkout");
  }

  return (
    <div className="store builder-page" dir="rtl">
      <SiteHeader />
      <main className="container builder">
        <Link href="/#bundles" className="back-link"><ChevronRight size={18} /> رجوع للمتجر</Link>
        <header className="builder-head">
          <span className="eyebrow">عرض خاص · {formatEGP(bundle.price)}</span>
          <h1>{bundle.name}</h1>
          <p>اختاري {bundle.pickCount} {bundle.pickCount === 1 ? "قطعة" : "قطع"}. كل موديل مرة واحدة بس.</p>
        </header>
        <p className="builder-notice" role="status" aria-live="polite">{notice}</p>
        <div className="pick-grid">
          {choices.map((product) => {
            const isSelected = selectedIds.includes(product.id);
            const full = !isSelected && selectedIds.length >= bundle.pickCount;
            return (
              <div className={`pick-card${isSelected ? " selected" : ""}${full ? " muted" : ""}`} key={product.id}>
                <button type="button" className="pick-toggle" aria-pressed={isSelected} onClick={() => toggle(product.id)}>
                  <span className="pick-media">
                    <Image src={product.image} alt={product.imageAlt} fill sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw" />
                    <span className="pick-check" aria-hidden="true">{isSelected ? selectedIds.indexOf(product.id) + 1 : <Check size={16} />}</span>
                  </span>
                  <span className="pick-name">{product.name}</span>
                  <FitNote product={product} />
                  <span className="pick-state">{isSelected ? "مختارة · دوسي للإلغاء" : full ? "العدد كمل" : "دوسي للاختيار"}</span>
                </button>
              </div>
            );
          })}
        </div>
      </main>
      <div className="builder-tray">
        <div className="container tray-inner">
          <div className="tray-cta">
            <span className="tray-progress">{isComplete ? "العرض كامل ✓" : `فاضل ${bundle.pickCount - selectedIds.length} من ${bundle.pickCount}`}</span>
            <button type="button" className="btn btn-primary" disabled={!isComplete} onClick={confirm}>كمّلي الطلب <ArrowLeft size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
