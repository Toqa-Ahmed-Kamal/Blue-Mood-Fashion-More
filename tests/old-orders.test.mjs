import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateQuantities,
  extractTelegramMessages,
  findDuplicates,
  oldOrderToDetails,
  oldOrderValue,
  parseTelegramDate,
  parseTelegramExport,
  phoneKey,
  sanitizeOldOrder,
} from "../lib/old-orders.ts";
import { buildXlsx, crc32 } from "../lib/xlsx.ts";

// Same structure as a Telegram Desktop "Export chat history → HTML" file (made-up customers).
function message(id, title, lines) {
  return `
     <div class="message default clearfix" id="message${id}">
      <div class="pull_left userpic_wrap">
       <div class="userpic userpic5" style="width: 42px; height: 42px">
        <div class="initials" style="line-height: 42px">
B
        </div>
       </div>
      </div>
      <div class="body">
       <div class="pull_right date details" title="${title}">
16:22
       </div>
       <div class="from_name">
Blue Mood Orders
       </div>
       <div class="text">
${lines.join("<br>")}
       </div>
      </div>
     </div>`;
}

const offerMessage = message(1, "08.11.2026 16:22:47 UTC+02:00", [
  "🛍️ طلب جديد — Blue Mood",
  "رقم الطلب: BM-3B04C16A3134A6EF455B",
  "الوقت: ٠٨‏/١١‏/٢٠٢٦، ٤:٢٢ م",
  "",
  "👤 أم تجربة",
  "📞 <a href=\"tel:01100000001\">01100000001</a>",
  "📞 بديل: <a href=\"tel:01100000002\">01100000002</a>",
  "📍 الإسكندرية — العجمي",
  "🏠 أم تجربة",
  "<a href=\"tel:01100000001\">01100000001</a>",
  "اسكندريه - شارع التجربة &quot;البيطاش&quot; ",
  "الدور ال3 اخر شقه على الشمال",
  "",
  "العرض: عرض الشتاء: ٣ بيجامات + بلانكيت",
  "1. بيجاما فليس زرقاء بطبعة ورود (bm-winter-pajama-012) — One Size – مقاس واحد يناسب لحد 85–90 كيلو",
  "2. بيجاما فرو وردي بفيونكة نبيتي (bm-winter-pajama-008) — One Size – مقاس واحد يناسب لحد 70 كيلو",
  "3. بلانكيت هودي بقلوب وودان أرنب (bm-winter-blanket-002) — بلانكيت شتوي قابل للارتداء",
  "4. روب سماوي منقط بنفسجي × 2 (bm-robe-004) — روب — 500 ج.م",
  "   🔗 <a href=\"https://blue-mood-fashion-more.vercel.app/images/robe/1000508110.png\">https://blue-mood-fashion-more.vercel.app/images/robe/1000508110.png</a>",
  "",
  "سعر العرض: 1100 ج.م",
  "القطع المنفردة: 500 ج.م",
  "الشحن: 90 ج.م",
  "الإجمالي: 1690 ج.م",
  "",
  "📝 من الساعه 12 لحد الساعة 5 ",
  "قبل الميعاد هبقي غير موجودة",
  "سعر الشحن مبدئي وقابل للتعديل. الإجمالي تقديري.",
  "",
  "📊 مصدر الطلب",
  "آخر زيارة: Paid Ads",
  "  source=facebook | medium=paid_social | campaign=winter_2026",
  "  fbclid: موجود",
  "  صفحة الدخول: /",
  "أول زيارة: WhatsApp",
  "  source=whatsapp | medium=messaging",
]);

const singleMessage = message(2, "09.11.2026 00:16:44 UTC+02:00", [
  "🛍️ طلب جديد — Blue Mood",
  "رقم الطلب: BM-BE2895F044BB9A2B9D61",
  "الوقت: ٠٩‏/١١‏/٢٠٢٦، ١٢:١٦ ص",
  "",
  "👤 تجربة تانية",
  "📞 201100000009",
  "📍 كفر الشيخ — سخا",
  "🏠 شارع الكنيسه",
  "",
  "العرض: بدون عرض — قطع منفردة",
  "1. بيجاما بطبعة دب (bm-winter-pajama-001) — One Size – مقاس واحد يناسب لحد 70 كيلو — 275 ج.م",
  "2. عباية قطيفة كحلي بتطريز ذهبي وحزام (bm-abaya-011) — عباية — 350 ج.م",
  "",
  "القطع المنفردة: 625 ج.م",
  "الشحن: غير مؤكد",
  "الإجمالي: غير مؤكد",
  "",
  "📝 تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ.",
]);

const chatter = message(3, "09.11.2026 01:00:00 UTC+02:00", ["تم الشحن 👍"]);
const EXPORT = `<html><body><div class="history">${offerMessage}${singleMessage}${chatter}${offerMessage}</div></body></html>`;

test("Telegram dates become exact ISO times", () => {
  assert.equal(parseTelegramDate("08.11.2026 16:22:47 UTC+02:00"), "2026-11-08T14:22:47.000Z");
  assert.equal(parseTelegramDate("nonsense"), null);
});

test("every message is read with line breaks, links and entities as plain text", () => {
  const messages = extractTelegramMessages(EXPORT);
  assert.equal(messages.length, 4);
  assert.equal(messages[2].text, "تم الشحن 👍");
  assert.ok(messages[0].text.includes("📞 01100000001"), "phone link → its text");
  assert.ok(messages[0].text.includes("\"البيطاش\""), "&quot; decoded");
});

test("order messages are parsed completely; chatter and repeated messages are skipped", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  const orders = parseTelegramExport(EXPORT, now);
  assert.equal(orders.length, 2, "1 chatter message skipped, 1 repeat of the same order skipped");
  const [{ order: offer, warnings }, { order: single }] = orders;
  assert.deepEqual(warnings, []);

  assert.equal(offer.orderId, "BM-3B04C16A3134A6EF455B");
  assert.equal(offer.createdAt, "2026-11-08T14:22:47.000Z");
  assert.equal(offer.customerName, "أم تجربة");
  assert.equal(offer.phone, "01100000001");
  assert.equal(offer.alternatePhone, "01100000002");
  assert.equal(offer.governorate, "الإسكندرية");
  assert.equal(offer.area, "العجمي");
  assert.equal(offer.address, "أم تجربة\n01100000001\nاسكندريه - شارع التجربة \"البيطاش\"\nالدور ال3 اخر شقه على الشمال", "multi-line address kept");
  assert.equal(offer.notes, "من الساعه 12 لحد الساعة 5\nقبل الميعاد هبقي غير موجودة", "store's own shipping note removed");
  assert.equal(offer.offerName, "عرض الشتاء: ٣ بيجامات + بلانكيت");
  assert.equal(offer.offerPrice, 1100);
  assert.equal(offer.itemsTotal, 500);
  assert.equal(offer.shippingCost, 90);
  assert.equal(offer.total, 1690);
  assert.equal(offer.source, "Paid Ads · source=facebook | medium=paid_social | campaign=winter_2026 · fbclid");
  assert.equal(offer.status, "submitted");
  assert.equal(offer.archived, false);
  assert.deepEqual(offer.products, [
    { modelId: "bm-winter-pajama-012", name: "بيجاما فليس زرقاء بطبعة ورود", size: "One Size – مقاس واحد يناسب لحد 85–90 كيلو", color: "", quantity: 1, unitPrice: null },
    { modelId: "bm-winter-pajama-008", name: "بيجاما فرو وردي بفيونكة نبيتي", size: "One Size – مقاس واحد يناسب لحد 70 كيلو", color: "", quantity: 1, unitPrice: null },
    { modelId: "bm-winter-blanket-002", name: "بلانكيت هودي بقلوب وودان أرنب", size: "", color: "", quantity: 1, unitPrice: null },
    { modelId: "bm-robe-004", name: "روب سماوي منقط بنفسجي", size: "", color: "", quantity: 2, unitPrice: 250, image: "/images/robe/1000508110.png" },
  ]);

  assert.equal(single.phone, "201100000009");
  assert.equal(single.alternatePhone, "");
  assert.equal(single.shippingCost, null);
  assert.equal(single.total, null);
  assert.equal(single.notes, "", "only the store's note → empty");
  assert.equal(single.source, "");
  assert.equal(single.products[0].unitPrice, 275);
  assert.equal(single.products[1].unitPrice, 350);
  assert.equal(oldOrderValue(single), 625, "no shipping known → offer + pieces only");
});

test("unknown lines are flagged for review instead of guessed", () => {
  const html = message(9, "01.11.2026 10:00:00 UTC+02:00", [
    "رقم الطلب: BM-00000000000000000009",
    "1. قطعة بشكل قديم",
    "2. قطعة مش في الكتالوج (bm-unknown-1) — عباية — 300 ج.م",
  ]);
  const [{ order, warnings }] = parseTelegramExport(html);
  assert.equal(order.products[0].name, "قطعة بشكل قديم");
  assert.equal(order.products[0].modelId, "");
  assert.equal(order.customerName, "");
  assert.ok(warnings.some((warning) => warning.includes("سطر منتج")));
  assert.ok(warnings.some((warning) => warning.includes("bm-unknown-1")));
  assert.ok(warnings.some((warning) => warning.includes("اسم العميلة")));
  assert.equal(oldOrderToDetails(order), null, "a product outside the catalog is never mapped onto a guessed category");
});

test("duplicates: same order ID is already saved; same phone (any format) or same name is flagged", () => {
  const [{ order: offer }, { order: single }] = parseTelegramExport(EXPORT);
  const samePhoneOtherOrder = { ...single, orderId: "BM-00000000000000000001", phone: "+20 110 000 0009" };
  const result = findDuplicates([offer, samePhoneOtherOrder], [single]);
  assert.equal(result[offer.orderId].alreadySaved, false);
  assert.deepEqual(result[samePhoneOtherOrder.orderId].samePhone, [single.orderId]);
  assert.deepEqual(findDuplicates([single], [single])[single.orderId].alreadySaved, true);
  assert.equal(phoneKey("٠١١٠٠٠٠٠٠٠١"), "1100000001", "Arabic digits");
  assert.equal(phoneKey("12"), "");
  const sameName = findDuplicates([{ ...offer, orderId: "BM-00000000000000000002", phone: "", alternatePhone: "" }], [offer]);
  assert.deepEqual(sameName["BM-00000000000000000002"].sameName, [offer.orderId]);
});

test("server validation keeps only well-formed orders and fields", () => {
  const [{ order }] = parseTelegramExport(EXPORT);
  assert.deepEqual(sanitizeOldOrder({ ...order, updatedAt: "x" }, new Date(order.updatedAt)), order);
  assert.equal(sanitizeOldOrder({ ...order, orderId: "BM-1" }), null);
  assert.equal(sanitizeOldOrder({ ...order, createdAt: "yesterday" }), null);
  const cleaned = sanitizeOldOrder({ ...order, status: "hacked", total: -5, products: [{ name: "x", quantity: 0 }, { name: "ok", quantity: 2, modelId: "<script>" }] });
  assert.equal(cleaned.status, "submitted");
  assert.equal(cleaned.total, null);
  assert.deepEqual(cleaned.products, [{ modelId: "", name: "ok", size: "", color: "", quantity: 2, unitPrice: null }]);
});

test("factory quantities group by product, size and color, and count orders", () => {
  const [{ order: offer }, { order: single }] = parseTelegramExport(EXPORT);
  const extra = { ...single, orderId: "BM-00000000000000000003", products: [{ ...single.products[0], quantity: 3 }, { ...single.products[1], color: "كحلي" }] };
  const rows = aggregateQuantities([offer, single, extra]);
  const bear = rows.find((row) => row.modelId === "bm-winter-pajama-001");
  assert.equal(bear.quantity, 4);
  assert.equal(bear.orders, 2);
  const abayas = rows.filter((row) => row.modelId === "bm-abaya-011");
  assert.equal(abayas.length, 2, "a color typed in by the admin is its own line");
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 5 + 2 + 4);
});

test("xlsx export is a valid ZIP with the sheets, RTL view and escaped text", () => {
  const data = buildXlsx([
    { name: "الكميات", rtl: true, rows: [["المنتج", "الكمية"], ["روب <فرو> & \"كحلي\"", 3], ["", null]] },
    { name: "الأوردرات", rows: [["a"]] },
  ]);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, "local header");
  const end = data.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory");
  assert.equal(view.getUint16(end + 10, true), 7, "7 parts");

  // Walk the local entries and check each CRC.
  const files = {};
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const name = new TextDecoder().decode(data.subarray(offset + 30, offset + 30 + nameLength));
    const body = data.subarray(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(crc32(body), view.getUint32(offset + 14, true), `crc ${name}`);
    files[name] = new TextDecoder().decode(body);
    offset += 30 + nameLength + size;
  }
  assert.ok(files["xl/workbook.xml"].includes('name="الكميات"'));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes('rightToLeft="1"'));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes("روب &lt;فرو&gt; &amp; &quot;كحلي&quot;"));
  assert.ok(files["xl/worksheets/sheet1.xml"].includes('<c r="B2"><v>3</v></c>'));
  assert.equal(files["xl/worksheets/sheet2.xml"].includes("rightToLeft"), false);
});
