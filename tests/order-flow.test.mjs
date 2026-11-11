import test from "node:test";
import assert from "node:assert/strict";

import {
  addUniqueModel,
  buildWhatsAppOrderText,
  calculateOrderTotals,
  createOrderReference,
  createWhatsAppUrl,
  isBundleComplete,
  normalizePhoneDigits,
  pajamaFitLabel,
  removeBundleModel,
} from "../lib/order-flow.ts";
import { findShippingRate, shippingRates } from "../lib/shipping-rates.ts";
import { catalog } from "../lib/site-data.ts";

const fourPajamas = { pajamaCount: 4, wearableBlanketCount: 0 };
const mixedOffer = { pajamaCount: 3, wearableBlanketCount: 1 };

function model(modelId, category = "winter-pajamas") {
  return {
    modelId,
    name: category === "winter-pajamas" ? "بيجاما بطبعة دب" : "بلانكيت شتوي بغطاء للرأس",
    category,
    image: category === "winter-pajamas"
      ? "/images/pink-gray-bear-print-pajama-set.jpg"
      : "/images/black-hooded-wearable-blanket.jpg",
  };
}

test("the same fixed model id cannot be added twice", () => {
  const first = addUniqueModel([], model("bm-winter-pajama-001"), fourPajamas);
  const second = addUniqueModel(first.bundle, model("bm-winter-pajama-001"), fourPajamas);

  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(second.reason, "duplicate");
  assert.equal(second.bundle.length, 1);
});

test("removing a model makes its fixed id selectable again", () => {
  const added = addUniqueModel([], model("bm-winter-pajama-002"), fourPajamas);
  const removed = removeBundleModel(added.bundle, "bm-winter-pajama-002");
  const reselected = addUniqueModel(removed, model("bm-winter-pajama-002"), fourPajamas);

  assert.equal(removed.length, 0);
  assert.equal(reselected.added, true);
});

test("offer completion requires four unique pajamas or three unique pajamas and one blanket", () => {
  const four = ["001", "002", "003", "004"].reduce(
    (bundle, id) => addUniqueModel(bundle, model(`pajama-${id}`), fourPajamas).bundle,
    [],
  );
  const mixed = [
    model("pajama-001"),
    model("pajama-002"),
    model("pajama-003"),
    model("blanket-001", "wearable-blankets"),
  ].reduce((bundle, entry) => addUniqueModel(bundle, entry, mixedOffer).bundle, []);

  assert.equal(isBundleComplete(four, fourPajamas), true);
  assert.equal(isBundleComplete(mixed, mixedOffer), true);
  assert.equal(addUniqueModel(mixed, model("blanket-001", "wearable-blankets"), mixedOffer).added, false);
  assert.equal(isBundleComplete(four.slice(0, 3), fourPajamas), false);
});

test("pajamas use the single One Size label and carry no per-item size or weight fields", () => {
  const pajama = model("bm-winter-pajama-003");
  assert.equal(pajamaFitLabel, "One Size – مقاس واحد يناسب لحد 85–90 كيلو");
  assert.equal("size" in pajama, false);
  assert.equal("weightGuide" in pajama, false);
});

test("customer phone validation accepts Arabic, Persian, and Western numerals consistently", () => {
  assert.equal(normalizePhoneDigits("٠١٠-٢٢٥٩٠٥٥٧"), "01022590557");
  assert.equal(normalizePhoneDigits("۰۱۰-۲۲۵۹۰۵۵۷"), "01022590557");
  assert.equal(normalizePhoneDigits("010-22590557"), "01022590557");
});

test("catalog products keep unique internal ids and names", () => {
  const ids = catalog.map((product) => product.id);
  assert.equal(new Set(ids).size, catalog.length);
  assert.equal(new Set(catalog.map((product) => product.name)).size, catalog.length);
  assert.equal(catalog.every((product) => product.image.startsWith("/images/")), true);
});

test("shipping fee comes from the governorate price table", async () => {
  const { governorateShippingFee } = await import("../lib/shipping-rates.ts");
  const expected = {
    "القاهرة": 80, "الجيزة": 80,
    "الإسكندرية": 90,
    "القليوبية": 100, "الشرقية": 100, "الدقهلية": 100, "الغربية": 100, "المنوفية": 100, "البحيرة": 100, "كفر الشيخ": 100, "دمياط": 100,
    "بورسعيد": 100, "الإسماعيلية": 100, "السويس": 100,
    "الفيوم": 110, "المنيا": 110, "أسيوط": 110,
    "سوهاج": 120, "قنا": 120, "الأقصر": 120, "أسوان": 120,
    "مطروح": 100,
  };
  for (const [governorate, fee] of Object.entries(expected)) {
    assert.equal(findShippingRate(governorate, "أي مدينة").fee, fee, governorate);
    assert.equal(governorateShippingFee(governorate), fee, governorate);
  }
  // Not priced yet: the order still goes through and shipping is confirmed later.
  for (const governorate of ["بني سويف", "البحر الأحمر", "الوادي الجديد", "شمال سيناء", "جنوب سيناء"]) {
    assert.equal(governorateShippingFee(governorate), null, governorate);
  }
  assert.deepEqual(calculateOrderTotals(1100, findShippingRate("القاهرة", "المطرية").fee), { subtotal: 1100, shipping: 80, total: 1180 });
  assert.deepEqual(calculateOrderTotals(1100, findShippingRate("أسوان", "إدفو").fee), { subtotal: 1100, shipping: 120, total: 1220 });
  assert.deepEqual(calculateOrderTotals(1100, findShippingRate("مطروح", "مرسى مطروح").fee), { subtotal: 1100, shipping: 100, total: 1200 });
  assert.equal(findShippingRate("محافظة وهمية", "x"), undefined);
  assert.equal(shippingRates.every((rate) => rate.fee === null || [80, 90, 100, 110, 120].includes(rate.fee)), true);
});

test("WhatsApp text names pajama styles without technical ids or false size selections", () => {
  const reference = createOrderReference(new Date("2026-10-31T10:20:00.000Z"), "12345678-1234-1234-1234-123456789abc");
  const message = buildWhatsAppOrderText({
    reference,
    createdAt: "2026-10-31T10:20:00.000Z",
    customer: {
      name: "اسم اختبار",
      phone: "01000000000",
      alternatePhone: "",
      governorate: "القاهرة",
      area: "المطرية",
      address: "عنوان اختبار",
      notes: "ملاحظة اختبار",
    },
    offer: { label: "٤ بيجامات شتوية", price: 1100, items: [{ name: "بيجاما بطبعة دب", category: "winter-pajamas" }] },
    items: [],
    subtotal: 1100,
    shipping: 30,
    total: 1130,
  });
  const url = new URL(createWhatsAppUrl(message));

  assert.equal(reference, "BM-20261031-12345678");
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, "/201022590557");
  assert.equal(url.searchParams.get("text"), message);
  assert.match(message, /بيجاما بطبعة دب/);
  assert.match(message, /One Size – مقاس واحد يناسب لحد 85–90 كيلو/);
  assert.doesNotMatch(message, /bm-winter-pajama-001|1000505866|كود الموديل|الوزن الإرشادي/);
  assert.match(message, /عرض الشتاء: ٤ بيجامات شتوية — 1100 جنيه/);
  assert.match(message, /الشحن التقديري \(الأسعار الحالية مبدئية وقابلة للتعديل\): 30 جنيه/);
  assert.match(message, /الإجمالي التقديري \(وفق سعر الشحن المبدئي\): 1130 جنيه/);
});

test("WhatsApp text stays sendable when no shipping fee exists and does not invent a total", () => {
  const message = buildWhatsAppOrderText({
    reference: "BM-20261031-ABCDEFGH",
    createdAt: "2026-10-31T10:20:00.000Z",
    customer: {
      name: "اسم اختبار",
      phone: "01000000000",
      alternatePhone: "",
      governorate: "القاهرة",
      area: "منطقة أخرى بالقاهرة (السعر غير محدد)",
      address: "عنوان اختبار",
      notes: "",
    },
    offer: { label: "٤ بيجامات شتوية", price: 1100, items: [{ name: "بيجاما بطبعة دب", category: "winter-pajamas" }] },
    items: [],
    subtotal: 1100,
    shipping: null,
    total: null,
  });

  assert.match(message, /المنطقة: منطقة أخرى بالقاهرة/);
  assert.match(message, /تكلفة الشحن تحتاج إلى تأكيد لاحقًا/);
  assert.match(message, /الإجمالي النهائي غير متاح حتى تأكيد الشحن/);
  assert.doesNotMatch(message, /الإجمالي التقديري: 1100 جنيه/);
});

test("WhatsApp text lists single pieces with quantity and line totals next to the offer", () => {
  const message = buildWhatsAppOrderText({
    reference: "BM-TEST",
    createdAt: "2026-10-31T10:20:00.000Z",
    customer: {
      name: "اسم اختبار",
      phone: "01000000000",
      alternatePhone: "",
      governorate: "القاهرة",
      area: "المطرية",
      address: "عنوان اختبار",
      notes: "",
    },
    offer: null,
    items: [{ name: "عباية قطيفة كحلي بتطريز ورد كريمي", quantity: 2, unitPrice: 350 }],
    subtotal: 700,
    shipping: 30,
    total: 730,
  });

  assert.doesNotMatch(message, /عرض الشتاء/);
  assert.match(message, /قطع منفردة:/);
  assert.match(message, /عباية قطيفة كحلي بتطريز ورد كريمي × 2 — 700 جنيه/);
  assert.match(message, /المجموع قبل الشحن: 700 جنيه/);
  assert.match(message, /730 جنيه/);
});

test("shipping covers every governorate with a free-text city", async () => {
  const { isShippingGovernorate, isValidShippingArea, shippingGovernorates } = await import("../lib/shipping-rates.ts");

  assert.equal(shippingGovernorates.length, 27);
  assert.equal(new Set(shippingGovernorates).size, 27);
  for (const governorate of shippingGovernorates) {
    assert.ok(findShippingRate(governorate, "أي مدينة"), governorate);
  }

  assert.equal(isShippingGovernorate("الإسكندرية"), true);
  assert.equal(isShippingGovernorate("محافظة وهمية"), false);
  assert.equal(isValidShippingArea("القاهرة", "المطرية"), true);
  assert.equal(isValidShippingArea("الدقهلية", "المنصورة"), true);
  assert.equal(isValidShippingArea("الدقهلية", " "), false);
});

test("pajamas with their own weight limit show it; others keep the default note", async () => {
  const { fitNoteFor: note, categoryDetailLabel: detail } = await import("../lib/order-flow.ts");
  const { catalog } = await import("../lib/site-data.ts");
  const seventy = catalog.filter((product) => product.maxWeightKg === 70).map((product) => product.id).sort();
  assert.deepEqual(seventy, ["bm-winter-pajama-001", "bm-winter-pajama-003", "bm-winter-pajama-007", "bm-winter-pajama-008", "bm-winter-pajama-010"]);
  assert.equal(note("winter-pajamas", 70), "One Size · لحد 70 كيلو");
  assert.equal(note("winter-pajamas"), "One Size · لحد 85–90 كيلو");
  assert.equal(detail("winter-pajamas", 70), "One Size – مقاس واحد يناسب لحد 70 كيلو");
  assert.equal(detail("winter-pajamas"), "One Size – مقاس واحد يناسب لحد 85–90 كيلو");
  assert.equal(note("abayas", 70), null);
});

test("productLink builds an absolute photo link and the WhatsApp text includes it", async () => {
  const { productLink } = await import("../lib/order-flow.ts");
  assert.equal(productLink("https://shop.example", "/images/bejama/1000508030.jpg"), "https://shop.example/images/bejama/1000508030.jpg");
  assert.equal(productLink("https://shop.example", "/images/صورة 1.png"), "https://shop.example/images/%D8%B5%D9%88%D8%B1%D8%A9%201.png");
  assert.equal(productLink("not a url", "/x.jpg"), null);

  const message = buildWhatsAppOrderText({
    reference: "BM-20261109-ABCDEFGH",
    createdAt: "2026-11-09T10:20:00.000Z",
    customer: { name: "اسم", phone: "01000000000", alternatePhone: "", governorate: "القاهرة", area: "المطرية", address: "عنوان", notes: "" },
    offer: { label: "٤ بيجامات شتوية", price: 1100, items: [{ name: "بيجاما بطبعة دب", category: "winter-pajamas", link: "https://shop.example/images/a.jpg" }] },
    items: [{ name: "عباية", quantity: 1, unitPrice: 350, link: "https://shop.example/images/b.jpg" }],
    subtotal: 1450,
    shipping: 30,
    total: 1480,
  });
  assert.match(message, /بيجاما بطبعة دب[\s\S]*?🔗 https:\/\/shop\.example\/images\/a\.jpg/);
  assert.match(message, /عباية × 1 — 350 جنيه\n  🔗 https:\/\/shop\.example\/images\/b\.jpg/);
});

test("unserved areas: no price, customer service confirms it; served neighbours keep their price", async () => {
  const { findShippingRate: rate, unservedAreaFor, governorateShippingFee } = await import("../lib/shipping-rates.ts");
  assert.equal(governorateShippingFee("مطروح"), 100);
  const unserved = [
    ["مطروح", "السلوم", "السلوم"],
    ["السويس", "العين السخنة", "العين السخنة"],
    ["السويس", "عين السخنه", "العين السخنة"],
    ["البحر الأحمر", "مرسى علم", "مرسى علم"],
    ["البحر الأحمر", "حلايب", "حلايب وشلاتين"],
    ["القاهرة", "العاصمة الإدارية الجديدة", "العاصمة الإدارية"],
    ["القاهرة", "العاصمه الاداريه", "العاصمة الإدارية"],
    ["القاهرة", "مدينة هليوبوليس الجديدة", "مدينة هليوبوليس الجديدة"],
    ["القاهرة", "طريق السويس الصحراوي - صحراء", "صحراء محافظة القاهرة"],
    ["الجيزة", "الواحات البحرية", "الواحات"],
    ["شمال سيناء", "العريش", "محافظة سيناء"],
    ["جنوب سيناء", "شرم الشيخ", "محافظة سيناء"],
    ["الوادي الجديد", "الخارجة", "محافظة الوادي الجديد"],
    ["أسوان", "المتايف العالى", "المتايف العالي"],
  ];
  for (const [governorate, area, name] of unserved) {
    const found = rate(governorate, area);
    assert.equal(found?.fee, null, `${governorate} / ${area} has no price`);
    assert.equal(found?.unserved, name, `${area} → ${name}`);
  }
  // Served places that only look similar keep their normal price.
  assert.equal(rate("القاهرة", "الواحة - مدينة نصر").fee, 80, "الواحة in Nasr City is served");
  assert.equal(rate("القاهرة", "مصر الجديدة").fee, 80, "Heliopolis (old) is served");
  assert.equal(rate("مطروح", "مرسى مطروح").fee, 100);
  assert.equal(rate("السويس", "الأربعين").fee, 100);
  assert.equal(unservedAreaFor("الجيزة", "فيصل"), null);
  assert.equal(rate("مطروح", "*").fee, 100, "before an area is typed the governorate price shows");
  assert.equal(rate("شمال سيناء", "*").fee, null);
});
