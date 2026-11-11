import test from "node:test";
import assert from "node:assert/strict";

import { parseDepositAmount } from "../lib/analytics-report.ts";
import { resolveCart, addCartItem, emptyCart } from "../lib/cart.ts";
import { categoryUrl, orderMessage, retargetWhatsApp, unavailableMessage, whatsappChatUrl, whatsappNumber } from "../lib/customer-whatsapp.ts";
import { OFFER_PIECE_PRICE, pricingRows } from "../lib/finance.ts";
import { classifyChannel, touchFromVisit } from "../lib/attribution.ts";
import { trafficSourceOf } from "../lib/traffic-source.ts";
import { isSoldOut, setSoldOut } from "../lib/site-data.ts";

test("WhatsApp numbers: Egyptian mobiles in any common form; anything else refused", () => {
  assert.equal(whatsappNumber("01012345678"), "201012345678");
  assert.equal(whatsappNumber("+20 101 234 5678"), "201012345678");
  assert.equal(whatsappNumber("00201012345678"), "201012345678");
  assert.equal(whatsappNumber("201012345678"), "201012345678");
  assert.equal(whatsappNumber("٠١٠١٢٣٤٥٦٧٨"), "201012345678", "Arabic digits");
  assert.equal(whatsappNumber("0225551234"), null, "landline");
  assert.equal(whatsappNumber("123"), null);
  assert.equal(whatsappChatUrl("123", "x"), null);
  // No wa.me: its extra redirect page can hang. Direct chat links instead.
  assert.match(whatsappChatUrl("01112345678", "أهلاً"), /^https:\/\/api\.whatsapp\.com\/send\?phone=201112345678&text=%D8%A3/);
  assert.match(whatsappChatUrl("01112345678", "أهلاً", "web"), /^https:\/\/web\.whatsapp\.com\/send\?phone=201112345678&text=/);
  assert.match(whatsappChatUrl("01112345678", "أهلاً", "app"), /^whatsapp:\/\/send\?phone=201112345678&text=/);
  const universal = whatsappChatUrl("01112345678", "سطر\nتاني & رابط https://x.test/?a=1#b");
  assert.equal(retargetWhatsApp(universal, "web"), universal.replace("https://api.whatsapp.com/send?", "https://web.whatsapp.com/send?"), "same phone and message, other target");
  assert.equal(decodeURIComponent(retargetWhatsApp(universal, "app").split("text=")[1]), "سطر\nتاني & رابط https://x.test/?a=1#b", "message kept intact");
  assert.equal(retargetWhatsApp("https://example.com/x", "web"), "https://example.com/x", "only WhatsApp chat links are changed");
});

test("'not available' message links to the same category with its own UTM (not the ads one)", () => {
  const text = unavailableMessage({ name: "منى أحمد", orderId: "BM-AAAA", productName: "بيجاما بطبعة دب", productId: "bm-winter-pajama-001", origin: "https://blue-mood-fashion-more.vercel.app" });
  assert.ok(text.startsWith("أهلاً منى 🌸"));
  assert.ok(text.includes("طلبك رقم BM-AAAA"));
  assert.ok(text.includes("للأسف بيجاما بطبعة دب مش متوفر حالياً"));
  assert.ok(text.includes("بيجامات المتاحة"));
  const url = text.split("\n").find((line) => line.startsWith("https://"));
  assert.equal(url, "https://blue-mood-fashion-more.vercel.app/?utm_source=whatsapp&utm_medium=customer_service&utm_campaign=order_update&utm_content=pajamas#pajamas");
  assert.ok(categoryUrl("https://x.test/", "abayas").endsWith("#abayas"));
  assert.ok(orderMessage({ name: "", orderId: "BM-1" }).startsWith("أهلاً 🌸"));
  // The visit is attributed to WhatsApp (organic), never to the paid campaign.
  const touch = touchFromVisit(url, "", "2026-11-11T10:00:00Z");
  assert.equal(touch.utmCampaign, "order_update");
  assert.equal(trafficSourceOf(touch), "WhatsApp");
  assert.notEqual(classifyChannel(touch), "Paid Ads");
});

test("sold out: cannot be added or ordered; back to normal when available again", () => {
  try {
    setSoldOut(["bm-robe-003"]);
    assert.equal(isSoldOut("bm-robe-003"), true);
    assert.deepEqual(addCartItem(emptyCart, "bm-robe-003"), emptyCart, "add does nothing");
    assert.ok("error" in resolveCart({ offer: null, items: [{ productId: "bm-robe-003", quantity: 1 }] }), "order refused");
    assert.ok("error" in resolveCart({ offer: { offerId: "four-pajamas", productIds: ["bm-winter-pajama-001", "bm-winter-pajama-002", "bm-winter-pajama-003", "bm-robe-003"] }, items: [] }));
    setSoldOut(["bm-winter-pajama-001"]);
    assert.ok("error" in resolveCart({ offer: { offerId: "four-pajamas", productIds: ["bm-winter-pajama-001", "bm-winter-pajama-002", "bm-winter-pajama-003", "bm-winter-pajama-004"] }, items: [] }), "a sold-out pajama cannot be in the offer");
    setSoldOut([]);
    assert.equal(resolveCart({ offer: null, items: [{ productId: "bm-robe-003", quantity: 1 }] }).cart.subtotal, 250);
  } finally {
    setSoldOut([]);
  }
});

test("deposit amounts: positive EGP or empty to remove", () => {
  assert.equal(parseDepositAmount(100), 100);
  assert.equal(parseDepositAmount("150.5"), 150.5);
  assert.equal(parseDepositAmount(""), null);
  assert.equal(parseDepositAmount(null), null);
  assert.equal(parseDepositAmount(-5), undefined);
  assert.equal(parseDepositAmount("abc"), undefined);
});

test("pricing calculator: expense share per piece, full cost, current profit and suggested price", () => {
  const products = [
    { productId: "a", name: "عباية", cost: 200, salePrice: 350 },
    { productId: "b", name: "بيجاما في العرض بس", cost: 150, salePrice: null },
    { productId: "c", name: "بدون سعر مصنع", cost: null, salePrice: 250 },
  ];
  const rows = pricingRows(products, { expenses: 1000, pieces: 20, profitPercent: 30 });
  assert.equal(rows.length, 2, "products without a factory price are left out");
  assert.deepEqual(rows[0], { productId: "a", name: "عباية", cost: 200, expenseShare: 50, fullCost: 250, currentPrice: 350, inOfferOnly: false, currentProfit: 100, currentProfitPercent: 40, suggestedPrice: 325 });
  assert.equal(rows[1].currentPrice, OFFER_PIECE_PRICE);
  assert.equal(rows[1].inOfferOnly, true);
  assert.equal(rows[1].suggestedPrice, 260, "(150 + 50) × 1.3 = 260");
  assert.equal(pricingRows(products, { expenses: 1000, pieces: 0, profitPercent: 30 })[0].expenseShare, 0, "no pieces → no share (no division by zero)");
});

test("order confirmation message: delivery fee, two days, InstaPay transfer to confirm, refund if cancelled", async () => {
  const { confirmationMessage, weightMessage, INSTAPAY_NUMBER } = await import("../lib/customer-whatsapp.ts");
  const text = confirmationMessage({ name: "منى أحمد", orderId: "BM-AAAA", shippingCost: 80 });
  assert.equal(text, [
    "أهلاً بيكي منى 🌸",
    "طلبتي أوردر من Blue Mood (رقم BM-AAAA)",
    "وبنوضحلك سعر التوصيل 80 ج",
    "أوردرك هيوصل خلال يومين",
    "لتأكيد طلبك هستأذنك تحويل تمن التوصيل على رقم 01223155437 إنستا باي لتأكيد جدية الحجز، وابعتيلنا سكرين بالتحويل",
    "وفي حالة إلغاء الطلب بنرجّع لحضرتك تمن التوصيل 🤍",
  ].join("\n"));
  assert.equal(INSTAPAY_NUMBER, "01223155437");
  assert.ok(confirmationMessage({ name: "", orderId: "BM-B", shippingCost: null }).includes("سعر التوصيل هنأكده معاكي حسب منطقتك"), "no invented fee");

  const weight = weightMessage({ name: "منى", orderId: "BM-AAAA", productName: "بيجاما بطبعة دب", productId: "bm-winter-pajama-001" });
  assert.ok(weight.includes("بيجاما بطبعة دب هتبقى مظبوطة عليكي (One Size · لحد 70 كيلو)"));
  assert.ok(weight.endsWith("ممكن تقوليلنا وزنك كام؟ 🤍"));
  assert.ok(weightMessage({ name: "منى", orderId: "BM-AAAA" }).includes("حابين نتأكد من المقاس"));
});
