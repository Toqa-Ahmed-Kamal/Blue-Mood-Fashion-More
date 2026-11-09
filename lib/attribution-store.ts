// Browser-only storage for marketing attribution; imported by client components.
import { hasMarketingSignal, sanitizeAttribution, touchFromVisit, type OrderAttribution, type Touch } from "@/lib/attribution";

/** First/last touch survive refreshes and return visits for this long. */
const ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "blue-mood-attribution-v1";
/** Per tab: the last URL already captured, so a refresh of the same campaign link isn't a new touch. */
const SESSION_KEY = "blue-mood-attribution-session";

function isFresh(at: string | undefined, now: number) {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) && now - time < ATTRIBUTION_TTL_MS;
}

/** Stored attribution, re-validated and with expired touches dropped. Never throws. */
export function readAttribution(): OrderAttribution | null {
  try {
    const stored = sanitizeAttribution(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
    if (!stored) return null;
    const now = Date.now();
    const firstTouch = stored.firstTouch && isFresh(stored.firstTouch.at, now) ? stored.firstTouch : null;
    const lastTouch = stored.lastTouch && isFresh(stored.lastTouch.at, now) ? stored.lastTouch : null;
    return firstTouch || lastTouch ? { firstTouch, lastTouch } : null;
  } catch {
    return null;
  }
}

/**
 * Records the current visit. Last touch is "last non-direct": a later direct visit keeps the
 * campaign that brought the customer, while any new tagged link or external referrer replaces it.
 */
export function captureAttribution() {
  try {
    const href = window.location.href;
    if (window.sessionStorage.getItem(SESSION_KEY) === href) return;

    const touch = touchFromVisit(href, document.referrer, new Date().toISOString());
    const isNewSession = window.sessionStorage.getItem(SESSION_KEY) === null;
    const stored = readAttribution();
    // Within a tab session only campaign tags count: browsers replay the original referrer on reload,
    // which would otherwise look like a new referral visit.
    const signal = isNewSession
      ? hasMarketingSignal(touch)
      : Boolean(touch.utmSource || touch.utmMedium || touch.utmCampaign || touch.fbclid || touch.gclid);

    if (signal || (isNewSession && !stored)) {
      const next: OrderAttribution = {
        firstTouch: stored?.firstTouch ?? touch,
        lastTouch: signal || !stored?.lastTouch ? touch : stored.lastTouch,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    window.sessionStorage.setItem(SESSION_KEY, href);

    // One dashboard visit per browsing session; a new campaign link mid-session starts a new one.
    if (isNewSession || signal) reportVisit(touch, signal && !isNewSession);
  } catch {
    // Storage blocked (private mode etc.): attribution is best-effort and must never break the store.
  }
}

const VISITOR_KEY = "blue-mood-visitor-v1";
const VISIT_SESSION_KEY = "blue-mood-visit-session-v1";

/** Random, anonymous ID kept in this browser; used only to count unique visitors. */
function storedId(storage: Storage, storageKey: string, rotate = false) {
  let id = rotate ? null : storage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(storageKey, id);
  }
  return id;
}

function reportVisit(touch: Touch, newSession: boolean) {
  try {
    const body = JSON.stringify({
      sessionId: storedId(window.sessionStorage, VISIT_SESSION_KEY, newSession),
      visitorId: storedId(window.localStorage, VISITOR_KEY),
      touch,
    });
    void fetch("/api/track/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Counting is best-effort.
  }
}
