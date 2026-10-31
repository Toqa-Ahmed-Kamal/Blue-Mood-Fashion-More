"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Heart, Minus, Plus, ShoppingBag, Star } from "lucide-react";

import type { Product } from "@/lib/site-data";

const currency = new Intl.NumberFormat("ar-EG", {
  style: "currency",
  currency: "EGP",
  maximumFractionDigits: 0,
});

function formatPrice(value: number) {
  return currency.format(value);
}

export function ProductDetailClient({ product }: { product: Product }) {
  const [selectedColor, setSelectedColor] = useState(product.colors[0]);
  const [selectedSize, setSelectedSize] = useState(product.sizes[0]);
  const [quantity, setQuantity] = useState(1);
  const [selectedImage, setSelectedImage] = useState(product.gallery[0]);

  return (
    <main className="bg-[#f7f1ea] text-[#18263f]" dir="rtl">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-[#d9c7b7] bg-white px-4 py-2 text-sm font-medium text-[#1e2f4f] shadow-sm">
          <ArrowLeft size={16} /> العودة للمتجر
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-[2rem] border border-[#e7d7c5] bg-white p-3 shadow-[0_18px_40px_rgba(19,35,63,0.06)]">
              <div className="relative h-[500px] overflow-hidden rounded-[1.5rem]">
                <Image src={selectedImage} alt={product.name} fill className="object-cover" priority />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {product.gallery.map((image) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setSelectedImage(image)}
                  className={`overflow-hidden rounded-[1.2rem] border p-1 ${selectedImage === image ? "border-[#213d63]" : "border-[#e7d7c5]"}`}
                >
                  <div className="relative h-24 overflow-hidden rounded-[0.9rem]">
                    <Image src={image} alt={product.name} fill className="object-cover" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-[#e7d7c5] bg-[#fffdfb] p-6 shadow-[0_18px_40px_rgba(19,35,63,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <div className="rounded-full bg-[#f3ece5] px-3 py-1 text-xs font-medium text-[#38516d]">
                {product.badge ?? "منتج مميز"}
              </div>
              <button type="button" className="rounded-full border border-[#d9c7b7] bg-white p-2.5 text-[#1b2e4d]">
                <Heart size={16} />
              </button>
            </div>

            <h1 className="mt-6 font-[family-name:var(--font-display)] text-4xl text-[#13233f]">{product.name}</h1>

            <div className="mt-4 flex items-center gap-2 text-[#d6a76d]">
              {Array.from({ length: 5 }).map((_, index) => (
                <Star key={`${product.slug}-${index}`} size={16} fill="currentColor" />
              ))}
              <span className="mr-2 text-sm text-[#58657b]">4.9 من 5</span>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <span className="text-3xl font-bold text-[#13233f]">{formatPrice(product.price)}</span>
              {product.originalPrice && (
                <span className="text-lg text-[#7d7f87] line-through">{formatPrice(product.originalPrice)}</span>
              )}
            </div>

            <p className="mt-5 text-base leading-8 text-[#4c5d73]">{product.description}</p>

            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-2 text-sm font-medium text-[#526277]">الألوان</div>
                <div className="flex flex-wrap gap-3">
                  {product.colors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`h-10 w-10 rounded-full border-2 ${selectedColor === color ? "border-[#1d2f57]" : "border-white"}`}
                      style={{ backgroundColor: color }}
                      aria-label={`اختر اللون ${color}`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-[#526277]">المقاس</div>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                      className={`rounded-full border px-3 py-2 text-sm font-medium ${selectedSize === size ? "border-[#13233f] bg-[#13233f] text-white" : "border-[#d9c7b7] bg-white text-[#213150]"}`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-[#526277]">الكمية</div>
                <div className="flex w-fit items-center gap-3 rounded-full border border-[#d9c7b7] bg-white p-1.5">
                  <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="rounded-full bg-[#f3ece5] p-2 text-[#13233f]">
                    <Minus size={14} />
                  </button>
                  <span className="min-w-8 text-center text-lg font-bold text-[#13233f]">{quantity}</span>
                  <button type="button" onClick={() => setQuantity((value) => value + 1)} className="rounded-full bg-[#f3ece5] p-2 text-[#13233f]">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#13233f] px-5 py-3 text-sm font-medium text-white shadow-lg shadow-[#13233f]/20">
                <ShoppingBag size={18} /> أضف للعربة
              </button>
              <a
                href="https://wa.me/966500000000?text=مرحباً%20أرغب%20في%20طلب%20%20product%20name"
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[#d9c7b7] bg-white px-5 py-3 text-sm font-medium text-[#1f3352]"
              >
                اطلب عبر واتساب
              </a>
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-[#e8d9ca] bg-[#f9f4ef] p-4 text-sm text-[#47607a]">
              {product.stock !== null && product.stock !== undefined ? (
                <div className="font-medium text-[#1f395a]">الكمية المتاحة: {product.stock} قطعة</div>
              ) : (
                <div>التوفر الحالي يتم تحديثه عند الطلب، يمكنك طلب المنتج مباشرة عبر واتساب.</div>
              )}
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-[#e8d9ca] bg-[#fffaf5] p-4 text-sm text-[#4b5e78]">
              <div className="mb-2 font-bold text-[#13233f]">ملخص الطلب</div>
              <div className="flex items-center justify-between">
                <span>المنتج</span>
                <span>{product.name}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>المقاس</span>
                <span>{selectedSize}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>اللون</span>
                <span>{selectedColor}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>الكمية</span>
                <span>{quantity}</span>
              </div>
              <div className="mt-4 border-t border-[#e4d4c4] pt-3 text-lg font-bold text-[#13233f]">
                الإجمالي: {formatPrice(product.price * quantity)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
