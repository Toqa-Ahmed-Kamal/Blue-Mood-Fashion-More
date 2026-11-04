import type { CatalogCategory } from "./site-data.ts";

export type OfferModelCategory = "winter-pajamas" | "wearable-blankets";

export type BundleEntry = {
  modelId: string;
  name: string;
  category: OfferModelCategory;
  image: string;
};

export const pajamaFitLabel = "One Size – مقاس واحد يناسب لحد 85–90 كيلو";

/** Short size note for product cards, or null when the category has no size claim. */
export function fitNoteFor(category: CatalogCategory) {
  return category === "winter-pajamas" ? "One Size · لحد 85–90 كيلو" : null;
}

export function categoryDetailLabel(category: CatalogCategory) {
  switch (category) {
    case "winter-pajamas": return pajamaFitLabel;
    case "wearable-blankets": return "بلانكيت شتوي قابل للارتداء";
    case "abayas": return "عباية";
    case "robes": return "روب";
  }
}

export function normalizePhoneDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\D/g, "");
}

export type OfferRequirements = {
  pajamaCount: number;
  wearableBlanketCount: number;
};

export type BundleCounts = {
  pajamas: number;
  wearableBlankets: number;
};

export function countBundleEntries(bundle: BundleEntry[]): BundleCounts {
  return bundle.reduce(
    (counts, entry) => {
      if (entry.category === "winter-pajamas") counts.pajamas += 1;
      else counts.wearableBlankets += 1;
      return counts;
    },
    { pajamas: 0, wearableBlankets: 0 },
  );
}

export function addUniqueModel(
  bundle: BundleEntry[],
  entry: BundleEntry,
  requirements: OfferRequirements,
) {
  if (bundle.some((item) => item.modelId === entry.modelId)) {
    return { bundle, added: false, reason: "duplicate" as const };
  }

  const counts = countBundleEntries(bundle);
  const categoryCount = entry.category === "winter-pajamas" ? counts.pajamas : counts.wearableBlankets;
  const categoryLimit = entry.category === "winter-pajamas"
    ? requirements.pajamaCount
    : requirements.wearableBlanketCount;

  if (categoryCount >= categoryLimit) {
    return { bundle, added: false, reason: "category-full" as const };
  }

  return { bundle: [...bundle, entry], added: true, reason: null };
}

export function removeBundleModel(bundle: BundleEntry[], modelId: string) {
  return bundle.filter((entry) => entry.modelId !== modelId);
}

export function isBundleComplete(bundle: BundleEntry[], requirements: OfferRequirements) {
  const counts = countBundleEntries(bundle);
  return new Set(bundle.map((entry) => entry.modelId)).size === bundle.length &&
    counts.pajamas === requirements.pajamaCount &&
    counts.wearableBlankets === requirements.wearableBlanketCount;
}

export const blueMoodWhatsAppNumber = "201022590557";

export type WhatsAppOrderMessage = {
  reference: string;
  createdAt: string;
  customer: {
    name: string;
    phone: string;
    alternatePhone: string;
    governorate: string;
    area: string;
    address: string;
    notes: string;
  };
  offer: { label: string; price: number; items: { name: string; category: CatalogCategory }[] } | null;
  items: { name: string; quantity: number; unitPrice: number }[];
  subtotal: number;
  shipping: number | null;
  total: number | null;
};

export function calculateOrderTotals(subtotal: number, shipping: number | null) {
  return {
    subtotal,
    shipping,
    total: shipping === null ? null : subtotal + shipping,
  };
}

export function createOrderReference(createdAt: Date, uuid: string) {
  const datePart = createdAt.toISOString().slice(0, 10).replaceAll("-", "");
  const uniquePart = uuid.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `BM-${datePart}-${uniquePart}`;
}

export function buildWhatsAppOrderText(order: WhatsAppOrderMessage) {
  const offerLines = order.offer
    ? [
        `عرض الشتاء: ${order.offer.label} — ${order.offer.price} جنيه`,
        ...order.offer.items.map((item) => `• ${item.name}\n  ${categoryDetailLabel(item.category)}`),
        "",
      ]
    : [];
  const singleLines = order.items.length > 0
    ? [
        "قطع منفردة:",
        ...order.items.map((item) => `• ${item.name} × ${item.quantity} — ${item.unitPrice * item.quantity} جنيه`),
        "",
      ]
    : [];

  return [
    "طلب جديد إلى Blue Mood",
    `مرجع الطلب: ${order.reference}`,
    `التاريخ: ${new Date(order.createdAt).toLocaleString("ar-EG")}`,
    "",
    "بيانات العميل:",
    `الاسم: ${order.customer.name}`,
    `رقم الموبايل: ${order.customer.phone}`,
    `رقم بديل: ${order.customer.alternatePhone || "غير متوفر"}`,
    `المحافظة: ${order.customer.governorate}`,
    `المنطقة: ${order.customer.area}`,
    `العنوان: ${order.customer.address}`,
    `ملاحظات: ${order.customer.notes || "لا توجد"}`,
    "",
    ...offerLines,
    ...singleLines,
    `المجموع قبل الشحن: ${order.subtotal} جنيه`,
    order.shipping === null
      ? "الشحن: غير مؤكد — تكلفة الشحن تحتاج إلى تأكيد لاحقًا."
      : `الشحن التقديري (الأسعار الحالية مبدئية وقابلة للتعديل): ${order.shipping} جنيه`,
    order.total === null
      ? `الإجمالي النهائي غير متاح حتى تأكيد الشحن (المجموع قبل الشحن: ${order.subtotal} جنيه).`
      : `الإجمالي التقديري (وفق سعر الشحن المبدئي): ${order.total} جنيه`,
  ].join("\n");
}

export function createWhatsAppUrl(message: string) {
  return `https://wa.me/${blueMoodWhatsAppNumber}?text=${encodeURIComponent(message)}`;
}
