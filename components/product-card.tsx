"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Check, Expand, Minus, Plus, X } from "lucide-react";

import { addCartItem, setCartItemQuantity, MAX_ITEM_QUANTITY } from "@/lib/cart";
import { updateCart, useCart } from "@/lib/cart-store";
import { formatEGP } from "@/lib/format";
import { trackAddToCart } from "@/lib/meta-pixel";
import { fitNoteFor } from "@/lib/order-flow";
import { categoryInfo, landingPromotion, offerCategories, priceOf, type CatalogProduct } from "@/lib/site-data";

function offerLinkFor(product: CatalogProduct) {
  return product.category === "wearable-blankets"
    ? `/offer/${landingPromotion.options[1].id}`
    : `/offer/${landingPromotion.options[0].id}`;
}

/** Add-to-cart stepper for singly sold pieces, or a link into the offer builder. */
export function ProductAction({ product }: { product: CatalogProduct }) {
  const cart = useCart();
  const price = priceOf(product);

  if (price === null) {
    return (
      <Link href={offerLinkFor(product)} className="btn btn-outline btn-block">
        اختاريها في العرض <ArrowLeft size={16} />
      </Link>
    );
  }

  const quantity = cart.items.find((item) => item.productId === product.id)?.quantity ?? 0;
  const add = () => {
    updateCart((current) => addCartItem(current, product.id));
    trackAddToCart(product);
  };
  if (quantity === 0) {
    return (
      <button type="button" className="btn btn-dark btn-block" onClick={add}>
        <Plus size={17} /> أضيفي للسلة
      </button>
    );
  }

  return (
    <div className="stepper" role="group" aria-label={`كمية ${product.name}`}>
      <button type="button" onClick={add} disabled={quantity >= MAX_ITEM_QUANTITY} aria-label="زيادة">
        <Plus size={16} />
      </button>
      <span aria-live="polite"><Check size={14} /> {quantity} في السلة</span>
      <button type="button" onClick={() => updateCart((current) => setCartItemQuantity(current, product.id, quantity - 1))} aria-label="تقليل">
        <Minus size={16} />
      </button>
    </div>
  );
}

export function FitNote({ product }: { product: CatalogProduct }) {
  const note = fitNoteFor(product.category, product.maxWeightKg);
  return note ? <span className="fit-note">{note}</span> : null;
}

export function PriceTag({ product }: { product: CatalogProduct }) {
  const price = priceOf(product);
  return price === null
    ? <span className="price-tag offer-only">ضمن عرض الـ {landingPromotion.price}</span>
    : <span className="price-tag">{formatEGP(price)}</span>;
}

/** Pieces that also fit the winter offer point to it. */
export function OfferHint({ product }: { product: CatalogProduct }) {
  if (!offerCategories.includes(product.category) || priceOf(product) === null) return null;
  return (
    <Link href={offerLinkFor(product)} className="offer-hint">
      أو ضمن عرض ٤ قطع بـ {landingPromotion.price}
    </Link>
  );
}

export function ProductCard({ product, onQuickView }: { product: CatalogProduct; onQuickView: (product: CatalogProduct) => void }) {
  return (
    <article className="product-card">
      <button type="button" className="product-media" onClick={() => onQuickView(product)} aria-label={`عرض صورة ${product.name} بالكامل`}>
        <Image src={product.image} alt={product.imageAlt} fill sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw" />
        <span className="media-zoom" aria-hidden="true"><Expand size={16} /></span>
      </button>
      <div className="product-body">
        <span className="product-kicker">{categoryInfo[product.category].singular}</span>
        <h3>{product.name}</h3>
        <FitNote product={product} />
        <PriceTag product={product} />
        <ProductAction product={product} />
        <OfferHint product={product} />
      </div>
    </article>
  );
}

export function QuickView({ product, onClose, action }: {
  product: CatalogProduct | null;
  onClose: () => void;
  /** Overrides the default cart action (used by the offer builder). */
  action?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (product && !dialog.open) dialog.showModal();
    if (!product && dialog.open) dialog.close();
  }, [product]);

  return (
    <dialog
      ref={dialogRef}
      className="quick-view"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      aria-label={product?.name}
    >
      {product && (
        <div className="quick-view-inner">
          <button type="button" className="icon-btn quick-view-close" onClick={onClose} aria-label="إغلاق"><X size={22} /></button>
          <div className="quick-view-media">
            <Image src={product.image} alt={product.imageAlt} fill sizes="(max-width: 800px) 100vw, 55vw" />
          </div>
          <div className="quick-view-body">
            <span className="product-kicker">{categoryInfo[product.category].singular}</span>
            <h2>{product.name}</h2>
            <FitNote product={product} />
            <PriceTag product={product} />
            <p>{product.imageAlt}.</p>
            {action ?? <><ProductAction product={product} /><OfferHint product={product} /></>}
          </div>
        </div>
      )}
    </dialog>
  );
}
