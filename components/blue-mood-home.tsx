"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, Menu, Search, X } from "lucide-react";
import {
  landingCategories,
  landingPromotion,
  navItems,
  winterLooks,
} from "@/lib/site-data";

const navigation = [
  { label: navItems[0], href: "#home" },
  { label: navItems[1], href: "#collections" },
  { label: navItems[2], href: "#offers" },
  { label: navItems[3], href: "#collections" },
  { label: navItems[4], href: "#contact" },
];

export function BlueMoodHome() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortBy, setSortBy] = useState("display");

  const filteredLooks = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    const matching = winterLooks.filter((look) => {
      const matchesCategory = selectedCategory === "all" || look.category === selectedCategory;
      const matchesSearch = `${look.name} ${look.imageAlt}`.toLocaleLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    return sortBy === "alphabetical"
      ? [...matching].sort((a, b) => a.name.localeCompare(b.name, "ar"))
      : matching;
  }, [searchTerm, selectedCategory, sortBy]);

  return (
    <div className="storefront" dir="rtl">
      <header className="site-header">
        <div className="header-inner">
          <button
            type="button"
            className="icon-button menu-toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <Link href="#home" className="brand" aria-label="Blue Mood — الرئيسية">
            <Image
              src="/images/blue-mood-logo.png"
              alt="شعار Blue Mood Fashion & More"
              width={84}
              height={84}
              priority
              className="brand-logo"
            />
          </Link>

          <nav className="desktop-nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <a
                href={item.href}
                key={item.label}
                onClick={() => setSelectedCategory(item.label === navItems[3] ? "wearable-blankets" : "all")}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <label className="header-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="ابحثي في القطع"
              aria-label="ابحثي في القطع"
            />
          </label>
        </div>

        {mobileMenuOpen && (
          <nav className="mobile-nav" aria-label="التنقل على الهاتف">
            {navigation.map((item) => (
              <a
                href={item.href}
                key={item.label}
                onClick={() => {
                  setSelectedCategory(item.label === navItems[3] ? "wearable-blankets" : "all");
                  setMobileMenuOpen(false);
                }}
              >
                {item.label}
              </a>
            ))}
            <label className="mobile-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ابحثي في القطع"
                aria-label="ابحثي في القطع"
              />
            </label>
          </nav>
        )}
      </header>

      <main>
        <section className="hero-section page-width" id="home">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-dot" /> Blue Mood · Fashion & More</span>
            <h1>شتاءٌ دافئ،<br /><em>بلمستكِ الخاصة</em></h1>
            <p>اكتشفي قطع الشتاء من Blue Mood — بيجامات مريحة وبلانكيت شتوي قابل للارتداء.</p>
            <a className="primary-link" href="#collections">تصفحي القطع <ArrowLeft size={17} /></a>
            <a className="text-link" href="#offers">شاهدي العرض <ArrowDown size={15} /></a>
          </div>
          <div className="hero-gallery" aria-label="صور من مجموعة ملابس الشتاء">
            <div className="hero-image hero-image-main">
              <Image src="/images/pink-bow-print-pajama-set.jpg" alt="بيجاما وردية بطبعة فيونكات" fill priority sizes="(max-width: 760px) 65vw, 34vw" />
            </div>
            <div className="hero-image hero-image-top">
              <Image src="/images/black-hooded-wearable-blanket.jpg" alt="بلانكيت شتوي أسود بغطاء للرأس، يُرتدى كقطعة ملابس" fill sizes="(max-width: 760px) 36vw, 20vw" />
            </div>
            <div className="hero-image hero-image-bottom">
              <Image src="/images/blue-koala-print-pajama-set.jpg" alt="بيجاما زرقاء بطبعة كوالا" fill sizes="(max-width: 760px) 36vw, 20vw" />
            </div>
            <span className="gallery-caption">تفاصيل صغيرة، ودفء يرافقكِ</span>
          </div>
        </section>

        <section className="offer-section page-width" id="offers">
          <div className="section-heading">
            <span className="eyebrow">لفترة محدودة</span>
            <h2>عرض الشتاء</h2>
            <p>اختاري إحدى طريقتي العرض، بالسعر والمدة الموضحين.</p>
          </div>
          <div className="offer-art-frame">
            <Image
              src="/images/شتوية دافئة بلمسة وردية.png"
              alt="عرض Blue Mood: أربعة بيجامات شتوية، أو ثلاثة بيجامات شتوية مع بلانكيت شتوي قابل للارتداء. العرض لمدة ثلاثة أيام."
              width={1242}
              height={1242}
              sizes="(max-width: 760px) 100vw, 900px"
              className="offer-art"
            />
          </div>
          <div className="offer-details">
            {landingPromotion.options.map((option, index) => (
              <Link href={`/offer/${option.id}`} className="offer-option" key={option.id}>
                <span className="offer-option-index">{(index + 1).toLocaleString("ar-EG")}</span>
                <p>{option.label}</p>
                <span className="offer-select">اختاري هذا العرض <ArrowLeft size={15} /></span>
              </Link>
            ))}
            <div className="offer-terms">
              <div className="offer-price-label">سعر العرض</div>
              <div className="offer-price">{landingPromotion.price.toLocaleString("en-EG")} <span>{landingPromotion.currency}</span></div>
              <div className="offer-duration">لمدة {landingPromotion.durationDays.toLocaleString("ar-EG")} أيام فقط</div>
            </div>
          </div>
        </section>

        <section className="collection-section page-width" id="collections">
          <div className="collection-intro">
            <div className="section-heading">
              <span className="eyebrow">من صور المجموعة</span>
              <h2>اختاري إطلالتكِ الشتوية</h2>
              <p>صور القطع المتاحة في المشروع، بتفاصيلها الظاهرة.</p>
            </div>
            <label className="collection-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ابحثي عن قطعة"
                aria-label="ابحثي عن قطعة"
              />
            </label>
          </div>

          <div className="collection-toolbar">
            <div className="category-filters" aria-label="تصفية حسب الفئة">
              {landingCategories.map((category) => (
                <button
                  type="button"
                  key={category.slug}
                  className={selectedCategory === category.slug ? "filter-chip active" : "filter-chip"}
                  onClick={() => setSelectedCategory(category.slug)}
                  aria-pressed={selectedCategory === category.slug}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <label className="sort-control">
              <span>الترتيب</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="ترتيب القطع">
                <option value="display">ترتيب العرض</option>
                <option value="alphabetical">الاسم أبجدياً</option>
              </select>
            </label>
          </div>

          {filteredLooks.length > 0 ? (
            <div className="look-grid">
              {filteredLooks.map((look) => (
                <article className="look-card" key={look.slug} id={look.slug}>
                  <div className="look-image">
                    <Image src={look.image} alt={look.imageAlt} fill sizes="(max-width: 600px) 90vw, (max-width: 1000px) 45vw, 30vw" />
                  </div>
                  <div className="look-caption">
                    <span>{look.category === "wearable-blankets" ? "ملابس شتوية" : "بيجامات شتوية"}</span>
                    <h3>{look.name}</h3>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">لم نعثر على قطعة بهذا الاسم.</p>
          )}
        </section>
      </main>

      <footer className="site-footer" id="contact">
        <div className="footer-inner page-width">
          <Image src="/images/blue-mood-logo.png" alt="Blue Mood Fashion & More" width={72} height={72} className="footer-logo" />
          <p>ملابس شتوية من Blue Mood</p>
          <a href="#home">العودة إلى الأعلى ↑</a>
        </div>
      </footer>

    </div>
  );
}
