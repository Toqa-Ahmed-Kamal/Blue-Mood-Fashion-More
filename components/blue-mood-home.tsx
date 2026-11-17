"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Camera, Eye, HeartHandshake, MessageCircle, RotateCcw, ShoppingBag, Truck } from "lucide-react";

import { ProductCard, QuickView } from "@/components/product-card";
import { OfferCountdown } from "@/components/promo";
import { AnnouncementBar, CartBar, SiteFooter, SiteHeader } from "@/components/store-chrome";
import { formatEGP } from "@/lib/format";
import {
  categoryInfo,
  categoryOrder,
  findProduct,
  isBigSize,
  landingPromotion,
  offerCategories,
  productsIn,
  startingPriceOf,
  visibleCatalog,
  type CatalogCategory,
  type CatalogProduct,
} from "@/lib/site-data";

const heroImages = ["bm-robe-002", "bm-abaya-012", "bm-winter-pajama-005"]
  .map(findProduct)
  .filter((product): product is CatalogProduct => product !== undefined);

/** Answers only what the store really does (inspection, return to the courier, real photos, WhatsApp follow-up). */
const FAQ = [
  { q: "أطلب إزاي؟", a: "اختاري القطع أو عرض الشتاء، اكتبي اسمك وموبايلك وعنوانك، وبعدين أكدي الطلب برسالة واتساب بضغطة واحدة." },
  { q: "أدفع إزاي؟", a: "بتدفعي للمندوب وقت الاستلام، بعد ما تعايني القطع بنفسك." },
  { q: "الشحن بكام وبيوصل لفين؟", a: "بنشحن لكل محافظات مصر. سعر الشحن بيتحسب حسب محافظتك وبيظهرلك في صفحة الطلب قبل ما تأكدي." },
  { q: "الطلب بيوصل امتى؟", a: "بعد ما تأكدي على واتساب بنقولك ميعاد التوصيل، وبنتابع معاكي لحد ما الأوردر يوصلك." },
  { q: "ينفع أعاين قبل ما أستلم؟", a: "أيوه، المعاينة متاحة: المندوب عندك، افتحي وشوفي القطع قبل ما تستلمي." },
  { q: "لو قطعة طلعت مش مناسبة؟", a: "بترجعيها مع المندوب وقت الاستلام على طول." },
  { q: "الصور حقيقية؟", a: "بنصورلك القطع على الطبيعة قبل ما نبعتها، علشان تبقي شايفة بالظبط اللي جايلك." },
  { q: "المقاسات إزاي؟", a: "البيجامات One Size، ومكتوب على كل بيجاما لحد كام كيلو بتلبس. لو محتارة ابعتيلنا على واتساب ونساعدك." },
  { q: `عرض الشتاء إيه؟`, a: `٤ قطع بـ ${landingPromotion.price} جنيه: ${landingPromotion.options.map((option) => option.label).join("، أو ")}. وانتي اللي بتختاري الموديلات.` },
];

const categoryCovers: Record<CatalogCategory, string> = {
  abayas: "bm-abaya-010",
  robes: "bm-robe-001",
  "winter-pajamas": "bm-winter-pajama-008",
  "wearable-blankets": "bm-winter-blanket-003",
  onesies: "bm-onesie-001",
};

export function BlueMoodHome() {
  const [quickView, setQuickView] = useState<CatalogProduct | null>(null);
  const bigSizeItems = visibleCatalog.filter((product) => isBigSize(product.id));

  return (
    <div className="store" dir="rtl">
      <AnnouncementBar />
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <Image src="/images/blue-mood-logo-badge.png" alt="شعار Blue Mood" width={168} height={168} className="hero-badge" preload />
              <span className="eyebrow">كولكشن شتا ٢٠٢٦</span>
              <h1>دفا الشتا<br /><span className="hl">بلمسة رقيقة</span></h1>
              <p>بلانكيت، بيجامات، أرواب فرو وعبايات قطيفة. اختاري اللي يعجبك واطلبي في دقيقة، والتأكيد على واتساب.</p>
              <div className="hero-actions">
                <Link href="/#offer" className="btn btn-pink btn-lg">عرض الشتاء بـ {landingPromotion.price} <ArrowLeft size={18} /></Link>
                <Link href="/#blankets" className="btn btn-outline btn-lg">تسوقي الكولكشن</Link>
              </div>
              <ul className="hero-perks">
                <li><Truck size={17} /> شحن لكل محافظات مصر</li>
                <li><MessageCircle size={17} /> تأكيد سريع على واتساب</li>
              </ul>
            </div>
            <div className="hero-arches" aria-hidden="true">
              {heroImages.map((product, index) => (
                <div className={`arch arch-${index + 1}`} key={product.id}>
                  <Image src={product.image} alt="" fill preload={index === 1} sizes="(max-width: 900px) 33vw, 18vw" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="container categories" aria-labelledby="categories-title">
          <h2 id="categories-title" className="sr-only">الأقسام</h2>
          {categoryOrder.map((category) => {
            const cover = findProduct(categoryCovers[category]);
            const from = startingPriceOf(category);
            return (
              <Link href={`/#${categoryInfo[category].anchor}`} className="category-card" key={category}>
                <span className="category-arch">
                  {cover && <Image src={cover.image} alt="" fill sizes="(max-width: 700px) 45vw, 22vw" />}
                </span>
                <strong>{categoryInfo[category].label}</strong>
                {from !== null && <small>من {formatEGP(from)}</small>}
              </Link>
            );
          })}
        </section>

        <section className="container trust" aria-labelledby="trust-title">
          <h2 id="trust-title">ليه تطلبي من <bdi>Blue Mood</bdi>؟</h2>
          <ul>
            <li><Eye size={24} aria-hidden="true" /><strong>متاح المعاينة</strong><span>المندوب عندك: افتحي وشوفي القطع بنفسك قبل ما تستلمي.</span></li>
            <li><RotateCcw size={24} aria-hidden="true" /><strong>مش مناسبة؟ رجّعيها</strong><span>لو فيه قطعة مش مناسبة، بترجعيها مع المندوب على طول.</span></li>
            <li><Camera size={24} aria-hidden="true" /><strong>صور على الطبيعة</strong><span>بنصورلك القطع الحقيقية قبل ما نبعتها، علشان تبقي مطمنة.</span></li>
            <li><HeartHandshake size={24} aria-hidden="true" /><strong>بنتابع معاكي</strong><span>على واتساب من التأكيد لحد ما الأوردر يوصلك.</span></li>
          </ul>
        </section>

        <section className="offer-section" id="offer" aria-labelledby="offer-title">
          <div className="container">
            <div className="offer-head">
              <OfferCountdown />
              <h2 id="offer-title">عرض الشتاء</h2>
              <p>٤ قطع بـ <strong>{formatEGP(landingPromotion.price)}</strong>. اختاري الباقة واختاري الموديلات بنفسك.</p>
            </div>

            <Link href={`/offer/${landingPromotion.options[0].id}`} className="offer-poster" aria-label="ابدئي عرض الشتاء">
              <Image
                src="/images/شتوية دافئة بلمسة وردية.png"
                alt="عرض واحد يكفي تكملي جهازك أو تجددي دولابك: ٤ بيجامات شتوي، أو ٣ بيجامات شتوي + بلانكيت واحدة. العرض لمدة ٣ أيام فقط."
                width={1672}
                height={941}
                sizes="(max-width: 1240px) 100vw, 1180px"
              />
            </Link>

            <div className="offer-options">
              {landingPromotion.options.map((option) => (
                <Link href={`/offer/${option.id}`} className="offer-option" key={option.id}>
                  <span className="offer-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="offer-option-price">{formatEGP(landingPromotion.price)}</span>
                  <span className="btn btn-pink">اختاري القطع <ArrowLeft size={16} /></span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {bigSizeItems.length > 0 && (
          <section className="container catalog-section big-size-section" id="big-size" aria-labelledby="big-size-title">
            <header className="section-head">
              <span className="section-ornament" aria-hidden="true">✦</span>
              <h2 id="big-size-title">بيج سايز</h2>
              <p>مقاسات كبيرة مريحة · {bigSizeItems.length} موديل</p>
            </header>
            <div className="product-grid">
              {bigSizeItems.map((product) => <ProductCard key={`big-${product.id}`} product={product} onQuickView={setQuickView} />)}
            </div>
          </section>
        )}

        {categoryOrder.map((category) => {
          const items = productsIn(category);
          const info = categoryInfo[category];
          return (
            <section className="container catalog-section" id={info.anchor} key={category} aria-labelledby={`${info.anchor}-title`}>
              <header className="section-head">
                <span className="section-ornament" aria-hidden="true">✦</span>
                <h2 id={`${info.anchor}-title`}>{info.label}</h2>
                <p>{info.tagline} · {items.length} موديل</p>
                {offerCategories.includes(category) && (
                  <Link href={`/offer/${category === "wearable-blankets" ? landingPromotion.options[1].id : landingPromotion.options[0].id}`} className="section-offer-link">
                    كوّني عرض الـ {landingPromotion.price} <ArrowLeft size={15} />
                  </Link>
                )}
              </header>
              <div className="product-grid">
                {items.map((product) => <ProductCard key={product.id} product={product} onQuickView={setQuickView} />)}
              </div>
              {category === "wearable-blankets" && <p className="coming-soon">موديلات بلانكيت جديدة نازلة قريب ♡</p>}
            </section>
          );
        })}

        <section className="how-it-works" aria-labelledby="how-title">
          <div className="container">
            <h2 id="how-title">الطلب في ٣ خطوات</h2>
            <ol>
              <li><ShoppingBag size={24} /><strong>اختاري</strong><span>العرض أو أي قطعة لوحدها، وكله بيتجمع في سلة واحدة.</span></li>
              <li><Truck size={24} /><strong>اكتبي عنوانك</strong><span>الاسم والموبايل والعنوان، وسعر الشحن بيظهر لك على طول.</span></li>
              <li><MessageCircle size={24} /><strong>أكدي على واتساب</strong><span>الطلب بيتسجل عندنا، وبعدها بتبعتي رسالة التأكيد بضغطة.</span></li>
            </ol>
          </div>
        </section>

        <section className="container faq" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title">أسئلة شائعة</h2>
          <div className="faq-list">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
      <CartBar />
      <QuickView product={quickView} onClose={() => setQuickView(null)} />
    </div>
  );
}
