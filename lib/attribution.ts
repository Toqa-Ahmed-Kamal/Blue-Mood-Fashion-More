// Marketing attribution: pure helpers shared by the browser (capture) and the server (validation + Telegram).
// No imports, so the Node test runner can load this file directly.

export const CHANNELS = ["Paid Ads", "Organic Social", "WhatsApp", "Google", "Direct", "Referral"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Touch = {
  channel: Channel;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  fbclid: string;
  gclid: string;
  /** Path of the first page of that visit, without query string. */
  landingPage: string;
  /** External referrer (origin + path, no query string), or "" for direct/internal. */
  referrer: string;
  /** ISO timestamp of the visit. */
  at: string;
};

export type OrderAttribution = { firstTouch: Touch | null; lastTouch: Touch | null };

type TouchFields = Omit<Touch, "channel">;

const FIELD_LIMITS: Record<keyof TouchFields, number> = {
  utmSource: 120,
  utmMedium: 120,
  utmCampaign: 200,
  utmContent: 200,
  utmTerm: 200,
  fbclid: 300,
  gclid: 300,
  landingPage: 300,
  referrer: 300,
  at: 40,
};

const PAID_TOKENS = new Set(["cpc", "ppc", "cpm", "cpv", "cpa", "paid", "paidsocial", "ads", "ad", "sponsored", "display", "retargeting", "remarketing"]);
const SOCIAL_SOURCES = new Set([
  "facebook", "fb", "instagram", "ig", "tiktok", "tt", "snapchat", "twitter", "x", "youtube", "yt",
  "linkedin", "pinterest", "telegram", "threads", "messenger", "social",
]);
const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "tiktok.com", "snapchat.com", "twitter.com", "x.com", "t.co",
  "youtube.com", "youtu.be", "linkedin.com", "lnkd.in", "pinterest.com", "t.me", "telegram.org", "threads.net", "messenger.com",
];
const WHATSAPP_HOSTS = ["whatsapp.com", "wa.me", "l.wl.co"];

function clean(value: unknown, limit: number) {
  if (typeof value !== "string") return "";
  // Drop control characters so the value can't break the Telegram message layout.
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}

function tokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, domains: string[]) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isGoogleHost(host: string) {
  return /(^|\.)google\.[a-z.]+$/.test(host);
}

/**
 * Paid only with explicit evidence (a paid utm_medium/utm_source or a Google Ads click ID).
 * fbclid alone is NOT paid: Facebook adds it to ordinary organic link clicks too.
 */
export function classifyChannel(touch: TouchFields): Channel {
  const source = touch.utmSource.toLowerCase();
  const medium = touch.utmMedium.toLowerCase();
  const sourceTokens = tokens(source);
  const mediumTokens = tokens(medium);
  const host = hostOf(touch.referrer);

  if (touch.gclid || [...sourceTokens, ...mediumTokens].some((token) => PAID_TOKENS.has(token)) || medium.replace(/[^a-z]/g, "") === "paidsocial") {
    return "Paid Ads";
  }
  if (sourceTokens.includes("whatsapp") || sourceTokens.includes("wa") || mediumTokens.includes("whatsapp") || hostMatches(host, WHATSAPP_HOSTS)) {
    return "WhatsApp";
  }
  if (sourceTokens.includes("google") || (!source && isGoogleHost(host))) return "Google";
  if (
    SOCIAL_SOURCES.has(source)
    // Single-letter names like "x" only count as the whole value, not inside e.g. "newsletter-x".
    || sourceTokens.some((token) => token.length > 1 && SOCIAL_SOURCES.has(token))
    || mediumTokens.includes("social")
    || touch.fbclid
    || (!source && hostMatches(host, SOCIAL_HOSTS))
  ) {
    return "Organic Social";
  }
  if (source || host) return "Referral";
  return "Direct";
}

/** True when a visit carries its own marketing signal (campaign tags, click ID, or an external referrer). */
export function hasMarketingSignal(touch: TouchFields) {
  return Boolean(touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.fbclid || touch.gclid || touch.referrer);
}

/** Builds a touch from the page URL and document.referrer. Internal referrers count as none. */
export function touchFromVisit(pageUrl: string, documentReferrer: string, at: string): Touch {
  const url = new URL(pageUrl);
  const params = url.searchParams;
  let referrer = "";
  try {
    const ref = new URL(documentReferrer);
    if (ref.host && ref.host !== url.host) referrer = `${ref.origin}${ref.pathname}`;
  } catch {
    // Empty or opaque referrer: direct.
  }
  const fields: TouchFields = {
    utmSource: clean(params.get("utm_source"), FIELD_LIMITS.utmSource),
    utmMedium: clean(params.get("utm_medium"), FIELD_LIMITS.utmMedium),
    utmCampaign: clean(params.get("utm_campaign"), FIELD_LIMITS.utmCampaign),
    utmContent: clean(params.get("utm_content"), FIELD_LIMITS.utmContent),
    utmTerm: clean(params.get("utm_term"), FIELD_LIMITS.utmTerm),
    fbclid: clean(params.get("fbclid"), FIELD_LIMITS.fbclid),
    gclid: clean(params.get("gclid"), FIELD_LIMITS.gclid),
    landingPage: clean(url.pathname, FIELD_LIMITS.landingPage),
    referrer: clean(referrer, FIELD_LIMITS.referrer),
    at,
  };
  return { channel: classifyChannel(fields), ...fields };
}

/** Server side: never trusts the browser. Re-cleans every field and recomputes the channel. */
export function sanitizeTouch(value: unknown): Touch | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const fields = Object.fromEntries(
    (Object.keys(FIELD_LIMITS) as (keyof TouchFields)[]).map((key) => [key, clean(raw[key], FIELD_LIMITS[key])]),
  ) as TouchFields;
  if (fields.at && Number.isNaN(Date.parse(fields.at))) fields.at = "";
  if (fields.landingPage && !fields.landingPage.startsWith("/")) fields.landingPage = "";
  if (fields.referrer && !/^https?:\/\//i.test(fields.referrer)) fields.referrer = "";
  return { channel: classifyChannel(fields), ...fields };
}

export function sanitizeAttribution(value: unknown): OrderAttribution | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const firstTouch = sanitizeTouch(raw.firstTouch);
  const lastTouch = sanitizeTouch(raw.lastTouch);
  return firstTouch || lastTouch ? { firstTouch, lastTouch } : null;
}

function describeTouch(label: string, touch: Touch) {
  const tags = [
    touch.utmSource && `source=${touch.utmSource}`,
    touch.utmMedium && `medium=${touch.utmMedium}`,
    touch.utmCampaign && `campaign=${touch.utmCampaign}`,
    touch.utmContent && `content=${touch.utmContent}`,
    touch.utmTerm && `term=${touch.utmTerm}`,
  ].filter(Boolean);
  return [
    `${label}: ${touch.channel}`,
    ...(tags.length ? [`  ${tags.join(" | ")}`] : []),
    ...(touch.fbclid ? ["  fbclid: موجود"] : []),
    ...(touch.gclid ? ["  gclid: موجود"] : []),
    ...(touch.landingPage ? [`  صفحة الدخول: ${touch.landingPage}`] : []),
    ...(touch.referrer ? [`  جاي من: ${touch.referrer}`] : []),
    ...(touch.at ? [`  التاريخ: ${touch.at.slice(0, 10)}`] : []),
  ];
}

/** Lines appended to the Telegram order message. */
export function formatAttributionLines(attribution: OrderAttribution | null | undefined): string[] {
  if (!attribution || (!attribution.firstTouch && !attribution.lastTouch)) return ["📊 مصدر الطلب: غير معروف"];
  return [
    "📊 مصدر الطلب",
    ...(attribution.lastTouch ? describeTouch("آخر زيارة", attribution.lastTouch) : []),
    ...(attribution.firstTouch ? describeTouch("أول زيارة", attribution.firstTouch) : []),
  ];
}
