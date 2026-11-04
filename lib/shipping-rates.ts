/**
 * Editable preliminary delivery table. Fees are estimates and remain changeable.
 * Use null when the fee is not set yet — the customer is told it will be confirmed.
 * Cairo has per-area fees (ordered approximately from Matariya); every other
 * governorate has one row with area: "*" and the customer types her own city.
 */
export type ShippingRate = {
  governorate: string;
  area: string;
  fee: number | null;
};

export const shippingGovernorates = [
  "القاهرة",
  "الجيزة",
  "الإسكندرية",
  "القليوبية",
  "الشرقية",
  "الدقهلية",
  "الغربية",
  "المنوفية",
  "البحيرة",
  "كفر الشيخ",
  "دمياط",
  "بورسعيد",
  "الإسماعيلية",
  "السويس",
  "الفيوم",
  "بني سويف",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
  "مطروح",
  "شمال سيناء",
  "جنوب سيناء",
] as const;

export const shippingRates: ShippingRate[] = [
  { governorate: "القاهرة", area: "المطرية", fee: 30 },
  { governorate: "القاهرة", area: "عين شمس", fee: 35 },
  { governorate: "القاهرة", area: "المرج", fee: 40 },
  { governorate: "القاهرة", area: "الزيتون", fee: 40 },
  { governorate: "القاهرة", area: "حدائق القبة", fee: 45 },
  { governorate: "القاهرة", area: "الأميرية", fee: 45 },
  { governorate: "القاهرة", area: "مصر الجديدة", fee: 50 },
  { governorate: "القاهرة", area: "مدينة نصر", fee: 55 },
  { governorate: "القاهرة", area: "العباسية", fee: 60 },
  { governorate: "القاهرة", area: "شبرا", fee: 60 },
  { governorate: "القاهرة", area: "وسط البلد", fee: 65 },
  { governorate: "القاهرة", area: "المعادي", fee: 75 },
  { governorate: "القاهرة", area: "القاهرة الجديدة والتجمع", fee: 80 },
  { governorate: "القاهرة", area: "حلوان", fee: 85 },
  { governorate: "القاهرة", area: "منطقة أخرى بالقاهرة (السعر غير محدد)", fee: null },

  // One fee per governorate — replace null with the price when it is known.
  { governorate: "الجيزة", area: "*", fee: null },
  { governorate: "الإسكندرية", area: "*", fee: null },
  { governorate: "القليوبية", area: "*", fee: null },
  { governorate: "الشرقية", area: "*", fee: null },
  { governorate: "الدقهلية", area: "*", fee: null },
  { governorate: "الغربية", area: "*", fee: null },
  { governorate: "المنوفية", area: "*", fee: null },
  { governorate: "البحيرة", area: "*", fee: null },
  { governorate: "كفر الشيخ", area: "*", fee: null },
  { governorate: "دمياط", area: "*", fee: null },
  { governorate: "بورسعيد", area: "*", fee: null },
  { governorate: "الإسماعيلية", area: "*", fee: null },
  { governorate: "السويس", area: "*", fee: null },
  { governorate: "الفيوم", area: "*", fee: null },
  { governorate: "بني سويف", area: "*", fee: null },
  { governorate: "المنيا", area: "*", fee: null },
  { governorate: "أسيوط", area: "*", fee: null },
  { governorate: "سوهاج", area: "*", fee: null },
  { governorate: "قنا", area: "*", fee: null },
  { governorate: "الأقصر", area: "*", fee: null },
  { governorate: "أسوان", area: "*", fee: null },
  { governorate: "البحر الأحمر", area: "*", fee: null },
  { governorate: "الوادي الجديد", area: "*", fee: null },
  { governorate: "مطروح", area: "*", fee: null },
  { governorate: "شمال سيناء", area: "*", fee: null },
  { governorate: "جنوب سيناء", area: "*", fee: null },
];

export function isShippingGovernorate(value: string) {
  return (shippingGovernorates as readonly string[]).includes(value);
}

/**
 * Checks the area for a governorate: one of the listed areas when the
 * governorate has them, otherwise a free-text city/district name.
 */
export function isValidShippingArea(governorate: string, area: string) {
  const areas = shippingAreasFor(governorate);
  if (areas.length > 0) return areas.includes(area);
  const trimmed = area.trim();
  return trimmed.length >= 2 && trimmed.length <= 120;
}

export function normalizeRateLabel(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-EG");
}

export function shippingAreasFor(governorate: string) {
  const key = normalizeRateLabel(governorate);
  return shippingRates
    .filter((rate) => normalizeRateLabel(rate.governorate) === key && rate.area !== "*")
    .map((rate) => rate.area);
}

export function findShippingRate(governorate: string, area: string) {
  const governorateKey = normalizeRateLabel(governorate);
  const areaKey = normalizeRateLabel(area);
  if (!governorateKey || !areaKey) return undefined;

  const matchingGovernorate = shippingRates.filter(
    (rate) => normalizeRateLabel(rate.governorate) === governorateKey,
  );

  const matchedRate = matchingGovernorate.find((rate) => normalizeRateLabel(rate.area) === areaKey)
    ?? matchingGovernorate.find((rate) => rate.area.trim() === "*");

  if (!matchedRate || matchedRate.fee === null) return matchedRate;
  return Number.isFinite(matchedRate.fee) && matchedRate.fee >= 0
    ? matchedRate
    : { ...matchedRate, fee: null };
}
