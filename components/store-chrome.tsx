"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Menu, ShoppingBag, X } from "lucide-react";

import { cartPieceCount, resolveCart } from "@/lib/cart";
import { useCart } from "@/lib/cart-store";
import { formatEGP } from "@/lib/format";
import { categoryInfo, categoryOrder, landingPromotion } from "@/lib/site-data";

const navLinks = [
  ...categoryOrder.map((category) => ({ href: `/#${categoryInfo[category].anchor}`, label: categoryInfo[category].label })),
  { href: "/#offer", label: "العرض" },
];

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} dir="ltr">
      <span className="wordmark-name"><span className="wordmark-script">Blue</span> <span className="wordmark-serif">Mood</span></span>
      <span className="wordmark-tag">FASHION &amp; MORE</span>
    </span>
  );
}

export function AnnouncementBar() {
  return (
    <Link href="/#offer" className="announcement">
      <span>❄ عرض الشتاء: ٤ قطع بـ {formatEGP(landingPromotion.price)} · لمدة {landingPromotion.durationDays} أيام بس</span>
      <ArrowLeft size={14} aria-hidden="true" />
    </Link>
  );
}

export function SiteHeader() {
  const cart = useCart();
  const count = cartPieceCount(cart);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-row container">
        <button
          type="button"
          className="icon-btn menu-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <Link href="/" className="brand" aria-label="Blue Mood — الرئيسية" onClick={() => setMenuOpen(false)}>
          <Image src="/images/blue-mood-logo-badge.png" alt="" width={64} height={64} className="brand-badge" preload />
          <BrandWordmark />
        </Link>

        <nav className="main-nav" aria-label="الأقسام">
          {navLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>

        <Link href="/checkout" className="cart-btn" aria-label={`السلة، ${count} قطعة`}>
          <ShoppingBag size={21} />
          {count > 0 && <span className="cart-count">{count}</span>}
        </Link>
      </div>

      {menuOpen && (
        <nav className="mobile-nav container" aria-label="الأقسام">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label} <ArrowLeft size={16} aria-hidden="true" />
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

/** Floating checkout shortcut shown whenever the cart has something in it. */
export function CartBar() {
  const cart = useCart();
  const count = cartPieceCount(cart);
  const resolved = resolveCart(cart);
  if (count === 0 || "error" in resolved) return null;

  return (
    <div className="cart-bar" role="region" aria-label="ملخص السلة">
      <div className="container cart-bar-inner">
        <div className="cart-bar-info">
          <span>{count} قطعة في السلة</span>
          <strong>{formatEGP(resolved.cart.subtotal)}</strong>
        </div>
        <Link href="/checkout" className="btn btn-primary">إتمام الطلب <ArrowLeft size={18} /></Link>
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="footer-brand">
            <Image src="/images/blue-mood-logo-badge.png" alt="شعار Blue Mood" width={96} height={96} />
            <BrandWordmark className="wordmark-light" />
          </div>
          <p>عبايات، أرواب، بيجامات وبلانكيت — شحن داخل القاهرة والطلب بيتأكد على واتساب.</p>
        </div>
        <nav aria-label="روابط الأقسام">
          {navLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
      </div>
      <div className="container footer-bottom">© {new Date().getFullYear()} Blue Mood · Fashion & More</div>
    </footer>
  );
}
