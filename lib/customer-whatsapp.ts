// WhatsApp messages from the admin to a customer about her order (pure, tested).
//
// Links back to the store carry their own UTM tags (utm_source=whatsapp, utm_medium=customer_service,
// utm_campaign=order_update) so visits from these messages are never mixed with the ads campaign.
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

export function whatsappChatUrl(phone: string, text: string) {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
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
