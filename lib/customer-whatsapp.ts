// WhatsApp messages from the admin to a customer about her order (pure, tested).
//
// Links back to the store carry their own UTM tags (utm_source=whatsapp, utm_medium=customer_service,
// utm_campaign=order_update) so visits from these messages are never mixed with the ads campaign.
import { fitNoteFor } from "./order-flow.ts";
import { categoryInfo, findProduct, type CatalogCategory } from "./site-data.ts";

export const ORDER_UPDATE_UTM = { utm_source: "whatsapp", utm_medium: "customer_service", utm_campaign: "order_update" } as const;

/** Egyptian mobile in international form for wa.me (01xxxxxxxxx → 201xxxxxxxxx); null when it is not a mobile number. */
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "").replace(/^00/, "");
  if (/^01[0125]\d{8}$/.test(digits)) return `2${digits}`;
  if (/^201[0125]\d{8}$/.test(digits)) return digits;
  if (/^1[0125]\d{8}$/.test(digits)) return `20${digits}`;
  return null;
}

/**
 * Where a chat opens. "web" = WhatsApp Web in the browser (computer), "app" = the installed WhatsApp
 * app (phone or desktop app), "universal" = WhatsApp's own page that hands over to either.
 * wa.me links go through an extra redirect page that can hang, so they are not used.
 */
export type WhatsAppTarget = "web" | "app" | "universal";

export function whatsappChatUrl(phone: string, text: string, target: WhatsAppTarget = "universal") {
  const number = whatsappNumber(phone);
  if (!number) return null;
  const query = `phone=${number}&text=${encodeURIComponent(text)}`;
  if (target === "web") return `https://web.whatsapp.com/send?${query}`;
  if (target === "app") return `whatsapp://send?${query}`;
  return `https://api.whatsapp.com/send?${query}`;
}

/** The same chat link pointed at another target (links are built once, opened where the admin chose). */
export function retargetWhatsApp(url: string, target: WhatsAppTarget) {
  const query = url.split("?")[1] ?? "";
  if (!/(^|&)phone=\d+/.test(query)) return url;
  if (target === "web") return `https://web.whatsapp.com/send?${query}`;
  if (target === "app") return `whatsapp://send?${query}`;
  return `https://api.whatsapp.com/send?${query}`;
}

/** The store section of a category, tagged as an order-update visit. */
export function categoryUrl(origin: string, category: CatalogCategory) {
  const anchor = categoryInfo[category].anchor;
  const query = new URLSearchParams({ ...ORDER_UPDATE_UTM, utm_content: anchor });
  return `${origin.replace(/\/+$/, "")}/?${query}#${anchor}`;
}

const greeting = (name: string, orderId: string) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return `أهلاً${first ? ` ${first}` : ""} 🌸\nمعاكي Blue Mood بخصوص طلبك رقم ${orderId}.`;
};

/** Opening message for anything about the order (missing details, a change…). */
export function orderMessage(input: { name: string; orderId: string }) {
  return `${greeting(input.name, input.orderId)}\n`;
}

/** "This piece is not available — choose another from the same section" with the section link. */
export function unavailableMessage(input: { name: string; orderId: string; productName: string; productId: string; origin: string; category?: CatalogCategory | null }) {
  const category = input.category ?? findProduct(input.productId)?.category ?? null;
  const lines = [greeting(input.name, input.orderId), "", `للأسف ${input.productName} مش متوفر حالياً 💔`];
  if (category) {
    lines.push(`ممكن تختاري بداله من ${categoryInfo[category].label} المتاحة من هنا:`, categoryUrl(input.origin, category));
  }
  lines.push("", "ابعتيلنا اسم الموديل اللي يعجبك وهنعدّل الطلب فوراً 🤍");
  return lines.join("\n");
}

/** InstaPay number customers transfer the delivery fee to (booking confirmation). */
export const INSTAPAY_NUMBER = "01223155437";

/** Order + delivery confirmation: delivery fee, delivery time, and the InstaPay transfer that confirms the booking. */
export function confirmationMessage(input: { name: string; orderId: string; shippingCost: number | null }) {
  const first = input.name.trim().split(/\s+/)[0] ?? "";
  const fee = input.shippingCost === null ? "هنأكده معاكي حسب منطقتك" : `${input.shippingCost} ج`;
  return [
    `أهلاً بيكي${first ? ` ${first}` : ""} 🌸`,
    `طلبتي أوردر من Blue Mood (رقم ${input.orderId})`,
    `وبنوضحلك سعر التوصيل ${fee}`,
    "أوردرك هيوصل خلال يومين",
    `لتأكيد طلبك هستأذنك تحويل تمن التوصيل على رقم ${INSTAPAY_NUMBER} إنستا باي لتأكيد جدية الحجز، وابعتيلنا سكرين بالتحويل`,
    "وفي حالة إلغاء الطلب بنرجّع لحضرتك تمن التوصيل 🤍",
  ].join("\n");
}

/** Asks the customer's weight, to make sure a piece (or the order) fits her. */
export function weightMessage(input: { name: string; orderId: string; productName?: string; productId?: string }) {
  const product = input.productId ? findProduct(input.productId) : undefined;
  const fit = product ? fitNoteFor(product.category, product.maxWeightKg) : null;
  const about = input.productName
    ? `حابين نتأكد إن ${input.productName} هتبقى مظبوطة عليكي${fit ? ` (${fit})` : ""}.`
    : "حابين نتأكد من المقاس قبل ما نجهّز الأوردر.";
  return [greeting(input.name, input.orderId), "", about, "ممكن تقوليلنا وزنك كام؟ 🤍"].join("\n");
}
