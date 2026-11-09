// Maps an attribution touch to the dashboard's traffic sources. Pure: shared by server code and tests.
import type { Touch } from "./attribution.ts";

export const TRAFFIC_SOURCES = [
  "Facebook Ads",
  "Instagram Ads",
  "Other Paid",
  "Facebook Organic",
  "Instagram Organic",
  "Other Social",
  "WhatsApp",
  "Google",
  "Referral",
  "Direct",
  "Unknown",
] as const;
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];

/** Direct and Unknown are deliberately separate from Organic. */
export const SOURCE_TYPES = ["Paid", "Organic", "Direct", "Unknown"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const SOURCE_TYPE: Record<TrafficSource, SourceType> = {
  "Facebook Ads": "Paid",
  "Instagram Ads": "Paid",
  "Other Paid": "Paid",
  "Facebook Organic": "Organic",
  "Instagram Organic": "Organic",
  "Other Social": "Organic",
  WhatsApp: "Organic",
  Google: "Organic",
  Referral: "Organic",
  Direct: "Direct",
  Unknown: "Unknown",
};

const INSTAGRAM_SOURCES = new Set(["ig", "instagram"]);
const FACEBOOK_SOURCES = new Set(["fb", "facebook", "meta", "msg", "messenger", "an"]);

function tokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function host(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function platformOf(touch: Touch): "instagram" | "facebook" | null {
  const sourceTokens = tokens(touch.utmSource);
  const referrerHost = host(touch.referrer);
  if (sourceTokens.some((token) => INSTAGRAM_SOURCES.has(token)) || /(^|\.)instagram\.com$/.test(referrerHost)) return "instagram";
  if (
    sourceTokens.some((token) => FACEBOOK_SOURCES.has(token))
    || /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(referrerHost)
    // fbclid without any other hint: Facebook is the most likely origin (Instagram links normally carry an instagram referrer).
    || (touch.fbclid && !touch.utmSource && !referrerHost)
  ) {
    return "facebook";
  }
  return null;
}

export function trafficSourceOf(touch: Touch | null | undefined): TrafficSource {
  if (!touch) return "Unknown";
  switch (touch.channel) {
    case "Paid Ads": {
      const platform = platformOf(touch);
      return platform === "instagram" ? "Instagram Ads" : platform === "facebook" ? "Facebook Ads" : "Other Paid";
    }
    case "Organic Social": {
      const platform = platformOf(touch);
      return platform === "instagram" ? "Instagram Organic" : platform === "facebook" ? "Facebook Organic" : "Other Social";
    }
    case "WhatsApp":
    case "Google":
    case "Referral":
    case "Direct":
      return touch.channel;
    default:
      return "Unknown";
  }
}

export function sourceTypeOf(source: TrafficSource): SourceType {
  return SOURCE_TYPE[source] ?? "Unknown";
}

export function isTrafficSource(value: unknown): value is TrafficSource {
  return typeof value === "string" && (TRAFFIC_SOURCES as readonly string[]).includes(value);
}
