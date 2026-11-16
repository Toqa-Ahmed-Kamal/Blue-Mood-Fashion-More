"use client";

import { useSyncExternalStore } from "react";
import { Flame, Package, Timer } from "lucide-react";

import { isSoldOut, landingPromotion, statOf, type CatalogProduct } from "@/lib/site-data";

const OFFER_END = Date.parse(landingPromotion.endsAt);

function subscribeToSeconds(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}
const nowInSeconds = () => Math.floor(Date.now() / 1000);
// The server has no clock to count with: render nothing there and start on the client.
const noTimeOnServer = () => null;

/** Seconds left until the offer ends; null on the server and once the offer is over. */
function useOfferSecondsLeft() {
  const now = useSyncExternalStore(subscribeToSeconds, nowInSeconds, noTimeOnServer);
  if (now === null || !Number.isFinite(OFFER_END)) return null;
  const left = Math.floor(OFFER_END / 1000) - now;
  return left > 0 ? left : null;
}

const pad = (value: number) => String(value).padStart(2, "0");

function splitTime(total: number) {
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Live countdown to the real offer end date. Hidden once the offer has ended. */
export function OfferCountdown({ variant = "chip" }: { variant?: "chip" | "bar" }) {
  const left = useOfferSecondsLeft();
  if (left === null) return null;
  const { days, hours, minutes, seconds } = splitTime(left);
  const units = [
    ...(days > 0 ? [{ value: String(days), label: "يوم" }] : []),
    { value: pad(hours), label: "ساعة" },
    { value: pad(minutes), label: "دقيقة" },
    { value: pad(seconds), label: "ثانية" },
  ];
  const spoken = `العرض بيخلص بعد ${days > 0 ? `${days} يوم و` : ""}${hours} ساعة و${minutes} دقيقة`;

  return (
    <span className={`countdown countdown-${variant}`} role="timer" aria-label={spoken}>
      <span className="countdown-title"><Timer size={variant === "bar" ? 14 : 16} aria-hidden="true" /> {variant === "bar" ? "باقي" : "العرض بيخلص خلال"}</span>
      <span className="countdown-units" dir="rtl" aria-hidden="true">
        {units.map((unit) => (
          <span className="countdown-unit" key={unit.label}>
            <b key={unit.value}>{unit.value}</b>
            <small>{unit.label}</small>
          </span>
        ))}
      </span>
    </span>
  );
}

/** True while the offer countdown is running (client only). */
export function useOfferIsRunning() {
  return useOfferSecondsLeft() !== null;
}

/**
 * Animated nudge on each product. Shows the real sold count when one is set in
 * site-data; otherwise a call to order before the real offer deadline (hidden after it).
 */
/** Real numbers from the inventory: pieces sold so far and pieces left. */
export function StockNumbers({ product }: { product: CatalogProduct }) {
  const stat = statOf(product.id);
  if (!stat || isSoldOut(product.id)) return null;
  const left = stat.left !== null && stat.left > 0 ? stat.left : null;
  if (!stat.sold && left === null) return null;
  return (
    <span className="stock-numbers">
      {stat.sold > 0 && <span>اتباع منها {stat.sold.toLocaleString("ar-EG")} قطعة</span>}
      {left !== null && <span className={left <= 3 ? "few" : undefined}><Package size={13} aria-hidden="true" /> {left <= 3 ? `باقي ${left.toLocaleString("ar-EG")} بس!` : `باقي منها ${left.toLocaleString("ar-EG")} قطعة`}</span>}
    </span>
  );
}

export function SocialProof({ product }: { product: CatalogProduct }) {
  // Real counts first: the inventory's sold pieces, else a count written on the product.
  const offerRunning = useOfferIsRunning();
  const stat = statOf(product.id);
  if (stat && !isSoldOut(product.id) && (stat.sold > 0 || (stat.left ?? 0) > 0)) return <StockNumbers product={product} />;
  const sold = product.soldCount && product.soldCount > 0 ? product.soldCount : null;
  // Without a real count, the nudge only points at the deadline — so it goes away with it.
  if (!sold && !offerRunning) return null;
  return (
    <span className="social-proof">
      <Flame size={14} className="social-proof-icon" aria-hidden="true" />
      <span>{sold ? `اتطلبت +${sold.toLocaleString("ar-EG")} مرة قبل كده` : "العرض قرب يخلص · اطلبيها دلوقتي"}</span>
    </span>
  );
}
