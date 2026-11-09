import test from "node:test";
import assert from "node:assert/strict";

import { classifyChannel, formatAttributionLines, sanitizeAttribution, touchFromVisit } from "../lib/attribution.ts";
import { buildTelegramOrderMessage } from "../lib/telegram.ts";

const SITE = "https://bluemood.example";
const AT = "2026-11-09T10:00:00.000Z";
const visit = (query, referrer = "") => touchFromVisit(`${SITE}/${query}`, referrer, AT);

test("UTM parameters, click IDs, landing page and external referrer are captured", () => {
  const touch = visit("?utm_source=facebook&utm_medium=paid&utm_campaign=winter&utm_content=reel1&utm_term=pajama&fbclid=abc", "https://l.facebook.com/l.php?u=secret");
  assert.equal(touch.utmSource, "facebook");
  assert.equal(touch.utmMedium, "paid");
  assert.equal(touch.utmCampaign, "winter");
  assert.equal(touch.utmContent, "reel1");
  assert.equal(touch.utmTerm, "pajama");
  assert.equal(touch.fbclid, "abc");
  assert.equal(touch.landingPage, "/");
  assert.equal(touch.referrer, "https://l.facebook.com/l.php", "referrer query string is dropped");
  assert.equal(touch.channel, "Paid Ads");
});

test("internal referrers are ignored", () => {
  assert.equal(visit("checkout", `${SITE}/`).referrer, "");
  assert.equal(visit("checkout", `${SITE}/`).channel, "Direct");
});

const cases = [
  ["?utm_source=facebook&utm_medium=cpc", "", "Paid Ads"],
  ["?utm_source=ig&utm_medium=paid_social", "", "Paid Ads"],
  ["?utm_source=google&utm_medium=cpc", "", "Paid Ads"],
  ["?gclid=xyz", "https://www.google.com/", "Paid Ads"],
  ["?fbclid=abc", "https://l.facebook.com/", "Organic Social"],
  ["", "https://www.instagram.com/", "Organic Social"],
  ["?utm_source=tiktok&utm_medium=social", "", "Organic Social"],
  ["?utm_source=whatsapp", "", "WhatsApp"],
  ["", "https://wa.me/", "WhatsApp"],
  ["", "https://www.google.com.eg/", "Google"],
  ["?utm_source=google&utm_medium=organic", "", "Google"],
  ["", "https://someblog.com/post", "Referral"],
  ["?utm_source=newsletter-x", "", "Referral"],
  ["?utm_source=mystery&utm_medium=weird", "", "Referral"],
  ["", "", "Direct"],
];

for (const [query, referrer, expected] of cases) {
  test(`"${query || "(no params)"}" from "${referrer || "(none)"}" → ${expected}`, () => {
    assert.equal(visit(query, referrer).channel, expected);
  });
}

test("unknown sources are never classified as Paid", () => {
  assert.notEqual(classifyChannel({ utmSource: "partner", utmMedium: "", utmCampaign: "", utmContent: "", utmTerm: "", fbclid: "", gclid: "", landingPage: "/", referrer: "", at: AT }), "Paid Ads");
});

test("the server recomputes the channel and cleans untrusted input", () => {
  const attribution = sanitizeAttribution({
    firstTouch: { channel: "Paid Ads", utmSource: "friend\n\nINJECTED", landingPage: "javascript:alert(1)", referrer: "ftp://x", at: "not-a-date", extra: "dropped" },
    lastTouch: "garbage",
  });
  assert.equal(attribution.firstTouch.channel, "Referral", "client-claimed channel is not trusted");
  assert.equal(attribution.firstTouch.utmSource.includes("\n"), false);
  assert.equal(attribution.firstTouch.landingPage, "");
  assert.equal(attribution.firstTouch.referrer, "");
  assert.equal(attribution.firstTouch.at, "");
  assert.equal("extra" in attribution.firstTouch, false);
  assert.equal(attribution.lastTouch, null);
  assert.equal(sanitizeAttribution(null), null);
  assert.equal(sanitizeAttribution({}), null);
});

test("attribution is appended to the Telegram order message", () => {
  const lastTouch = visit("?utm_source=facebook&utm_medium=paid&utm_campaign=winter&fbclid=abc");
  const firstTouch = visit("", "https://www.google.com/");
  const message = buildTelegramOrderMessage({
    orderId: "BM-TEST", createdAt: AT, customerName: "اسم", phone: "01000000000", alternatePhone: "",
    governorate: "القاهرة", area: "المطرية", address: "عنوان", offerName: "بدون عرض", products: [],
    offerPrice: 0, itemsTotal: 0, subtotal: 0, shippingCost: null, total: null, notes: "",
    attribution: { firstTouch, lastTouch },
  });
  assert.match(message, /📊 مصدر الطلب/);
  assert.match(message, /آخر زيارة: Paid Ads/);
  assert.match(message, /campaign=winter/);
  assert.match(message, /fbclid: موجود/);
  assert.equal(message.includes("abc"), false, "raw click ID is not printed");
  assert.match(message, /أول زيارة: Google/);
});

test("orders without attribution say the source is unknown", () => {
  assert.deepEqual(formatAttributionLines(null), ["📊 مصدر الطلب: غير معروف"]);
});
