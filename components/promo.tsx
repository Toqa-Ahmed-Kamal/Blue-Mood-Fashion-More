"use client";

import { useSyncExternalStore } from "react";
import { Flame, Timer } from "lucide-react";

import { landingPromotion, type CatalogProduct } from "@/lib/site-data";

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
export function SocialProof({ product }: { product: CatalogProduct }) {
  const sold = product.soldCount && product.soldCount > 0 ? product.soldCount : null;
  const offerRunning = useOfferIsRunning();
  // Without a real count, the nudge only points at the deadline — so it goes away with it.
  if (!sold && !offerRunning) return null;
  return (
    <span className="social-proof">
      <Flame size={14} className="social-proof-icon" aria-hidden="true" />
      <span>{sold ? `اتطلبت +${sold.toLocaleString("ar-EG")} مرة قبل كده` : "العرض قرب يخلص · اطلبيها دلوقتي"}</span>
    </span>
  );
}
