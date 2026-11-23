"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Heart, Quote, X } from "lucide-react";

import type { PublicReview } from "@/lib/reviews";

/**
 * "آراء عميلاتنا": the reviews the owner uploads, as photo cards drifting across the page in two rows (opposite
 * directions). Hovering or touching pauses them; tapping opens the photo full size, with next / previous and
 * swipe. With reduced motion the rows stand still and scroll by hand. Hidden when there are no reviews.
 */
export function ReviewsSection({ reviews }: { reviews: PublicReview[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // Old browsers: show it straight away.
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (reviews.length === 0) return null;

  // Two rows once there are enough photos; each row repeated so the loop never shows a gap.
  const rows = reviews.length >= 6 ? [reviews.filter((_, index) => index % 2 === 0), reviews.filter((_, index) => index % 2 === 1)] : [reviews];
  const indexOf = (id: string) => reviews.findIndex((review) => review.id === id);

  return (
    <section ref={sectionRef} className={`reviews-section${visible ? " in-view" : ""}`} id="reviews" aria-labelledby="reviews-title">
      <div className="reviews-glow" aria-hidden="true" />
      <div className="container reviews-head">
        <span className="reviews-kicker"><Heart size={14} fill="currentColor" aria-hidden="true" /> من عميلاتنا</span>
        <h2 id="reviews-title">آراء عميلاتنا</h2>
        <p>رسايلهم وصورهم بعد ما الأوردر وصلهم. دوسي على أي صورة تشوفيها كبيرة.</p>
      </div>
      <div className="reviews-rows">
        {rows.map((row, rowIndex) => {
          // At least ~10 cards per half so wide screens stay full, then the half twice for a seamless loop.
          const repeat = Math.max(1, Math.ceil(10 / row.length));
          const half = Array.from({ length: repeat }, () => row).flat();
          const loop = [...half, ...half];
          return (
            <div key={rowIndex} className={`reviews-track-wrap${rowIndex === 1 ? " reverse" : ""}`}>
              <ul className="reviews-track" style={{ "--reviews-duration": `${Math.max(30, half.length * 6)}s` } as CSSProperties}>
                {loop.map((review, index) => (
                  <li key={`${review.id}-${index}`} className="review-card" aria-hidden={index >= row.length ? true : undefined} style={{ "--tilt": `${((index % 5) - 2) * 1.2}deg` } as CSSProperties}>
                    <button type="button" onClick={() => setOpen(indexOf(review.id))} tabIndex={index < row.length ? 0 : -1} aria-label={`افتحي ريفيو${review.name ? ` ${review.name}` : ""}`}>
                      <span className="review-photo" style={{ aspectRatio: `${review.width} / ${review.height}` }}>
                        <Image src={review.image} alt={review.caption || "ريفيو من عميلة"} fill sizes="(max-width: 700px) 62vw, 260px" />
                      </span>
                      {(review.caption || review.name) && (
                        <span className="review-caption">
                          {review.caption && <span><Quote size={13} aria-hidden="true" /> {review.caption}</span>}
                          {review.name && <strong>— {review.name}</strong>}
                        </span>
                      )}
                      <span className="review-heart" aria-hidden="true"><Heart size={14} fill="currentColor" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {open !== null && <ReviewViewer reviews={reviews} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ReviewViewer({ reviews, index, onIndex, onClose }: { reviews: PublicReview[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const review = reviews[index];
  const count = reviews.length;
  // In RTL "next" is to the left.
  const go = useCallback((by: number) => onIndex((index + by + count) % count), [count, index, onIndex]);
  const startX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") go(1);
      if (event.key === "ArrowRight") go(-1);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);

  return (
    <div className="review-viewer" role="dialog" aria-modal="true" aria-label="ريفيو" onClick={onClose}>
      <div
        className="review-viewer-card"
        key={review.id}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => { startX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const start = startX.current;
          const end = event.changedTouches[0]?.clientX;
          startX.current = null;
          if (start === null || end === undefined || Math.abs(end - start) < 40) return;
          go(end > start ? 1 : -1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- full-size review photo, any aspect ratio */}
        <img src={review.image} alt={review.caption || "ريفيو من عميلة"} />
        {(review.caption || review.name) && (
          <p className="review-viewer-caption">{review.caption}{review.name && <strong> — {review.name}</strong>}</p>
        )}
        <span className="review-viewer-count">{index + 1} / {count}</span>
      </div>
      <button ref={closeRef} type="button" className="review-viewer-close" onClick={onClose} aria-label="قفل"><X size={22} /></button>
      {count > 1 && (
        <>
          <button type="button" className="review-viewer-nav prev" onClick={(event) => { event.stopPropagation(); go(-1); }} aria-label="اللي قبله"><ChevronRight size={26} /></button>
          <button type="button" className="review-viewer-nav next" onClick={(event) => { event.stopPropagation(); go(1); }} aria-label="اللي بعده"><ChevronLeft size={26} /></button>
        </>
      )}
    </div>
  );
}
