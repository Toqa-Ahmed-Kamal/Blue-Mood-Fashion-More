/**
 * Editable preliminary delivery table. Fees are estimates and remain changeable.
 * Use null when the fee is not set yet — the customer is told it will be confirmed.
 * One fee per governorate (area: "*"); the customer types her own city/area.
 * A governorate can still get per-area rows (area: "<name>") that override "*".
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
  // ── القاهرة والجيزة ──
  { governorate: "القاهرة", area: "*", fee: 80 },
  { governorate: "الجيزة", area: "*", fee: 80 },
  // ── الإسكندرية ──
  { governorate: "الإسكندرية", area: "*", fee: 90 },
  // ── وجه بحري والدلتا والقناة ──
  { governorate: "القليوبية", area: "*", fee: 100 },
  { governorate: "الشرقية", area: "*", fee: 100 },
  { governorate: "الدقهلية", area: "*", fee: 100 },
  { governorate: "الغربية", area: "*", fee: 100 },
  { governorate: "المنوفية", area: "*", fee: 100 },
  { governorate: "البحيرة", area: "*", fee: 100 },
  { governorate: "كفر الشيخ", area: "*", fee: 100 },
  { governorate: "دمياط", area: "*", fee: 100 },
  { governorate: "بورسعيد", area: "*", fee: 100 },
  { governorate: "الإسماعيلية", area: "*", fee: 100 },
  { governorate: "السويس", area: "*", fee: 100 },
  // ── شمال الصعيد ──
  { governorate: "الفيوم", area: "*", fee: 110 },
  { governorate: "المنيا", area: "*", fee: 110 },
  { governorate: "أسيوط", area: "*", fee: 110 },
  // ── جنوب الصعيد ──
  { governorate: "سوهاج", area: "*", fee: 120 },
  { governorate: "قنا", area: "*", fee: 120 },
  { governorate: "الأقصر", area: "*", fee: 120 },
  { governorate: "أسوان", area: "*", fee: 120 },
  // ── مطروح ──
  { governorate: "مطروح", area: "*", fee: 100 },
  // ── لسه مفيش سعر — الشحن بيتأكد مع العميلة ──
  { governorate: "بني سويف", area: "*", fee: null },
  { governorate: "البحر الأحمر", area: "*", fee: null },
  { governorate: "الوادي الجديد", area: "*", fee: null },
  { governorate: "شمال سيناء", area: "*", fee: null },
  { governorate: "جنوب سيناء", area: "*", fee: null },
];

/**
 * Areas the regular shipping does not serve. The customer types her own city/area, so they are
 * recognised by name (spelling variants included) and their fee is left for customer service to
 * confirm. `governorates` empty = recognised in any governorate (a customer may pick the wrong
 * one); `home` = governorates whose customers are told about it before typing.
 */
export const UNSERVED_AREA_NOTE = "منطقة غير مخدومة بالشحن العادي: سعر الشحن غير محدد وهيتأكد من خدمة العملاء.";
export const unservedAreas: { name: string; governorates: string[]; keywords: string[]; home?: string[] }[] = [
  { name: "محافظة سيناء", governorates: ["شمال سيناء", "جنوب سيناء"], keywords: ["*"] },
  { name: "محافظة الوادي الجديد", governorates: ["الوادي الجديد"], keywords: ["*"] },
  { name: "العين السخنة", governorates: [], keywords: ["العين السخنه", "عين السخنه", "السخنه"], home: ["السويس"] },
  { name: "المتايف العالي", governorates: [], keywords: ["المتايف"] },
  { name: "حلايب وشلاتين", governorates: [], keywords: ["حلايب", "شلاتين"], home: ["البحر الأحمر"] },
  { name: "السلوم", governorates: [], keywords: ["السلوم"], home: ["مطروح"] },
  { name: "صحراء محافظة القاهرة", governorates: ["القاهرة"], keywords: ["صحراء", "صحرا"] },
  { name: "مدينة هليوبوليس الجديدة", governorates: [], keywords: ["هليوبوليس الجديده", "هليوبوليس الجديد", "نيو هليوبوليس", "new heliopolis"], home: ["القاهرة"] },
  { name: "مرسى علم", governorates: [], keywords: ["مرسي علم"], home: ["البحر الأحمر"] },
  { name: "العاصمة الإدارية", governorates: [], keywords: ["العاصمه الاداريه", "العاصمه الجديده", "new capital"], home: ["القاهرة"] },
  // "الواحات" only: "الواحة" alone is also a served district of Nasr City.
  { name: "الواحات", governorates: [], keywords: ["الواحات"], home: ["الجيزة", "الوادي الجديد"] },
];

/** Arabic spelling variants (أ/إ/آ, ة/ه, ى/ي, diacritics, tatweel) folded so typed names still match. */
export function foldArabic(value: string) {
  return normalizeRateLabel(value)
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

/** Name of the unserved area the customer's governorate / typed area falls in, or null. */
export function unservedAreaFor(governorate: string, area: string) {
  const governorateKey = foldArabic(governorate);
  const areaKey = foldArabic(area);
  for (const entry of unservedAreas) {
    const inGovernorate = entry.governorates.length === 0 || entry.governorates.some((name) => foldArabic(name) === governorateKey);
    if (!inGovernorate) continue;
    if (entry.keywords.includes("*")) return entry.name;
    if (areaKey && entry.keywords.some((keyword) => areaKey.includes(foldArabic(keyword)))) return entry.name;
  }
  return null;
}

/** Unserved areas to mention once a governorate is chosen. */
export function unservedAreasIn(governorate: string) {
  const key = foldArabic(governorate);
  return unservedAreas
    .filter((entry) => [...entry.governorates, ...(entry.home ?? [])].some((name) => foldArabic(name) === key))
    .map((entry) => entry.name);
}

/** The governorate-wide fee (its "*" row), or null when it still has to be confirmed. */
export function governorateShippingFee(governorate: string) {
  return findShippingRate(governorate, "*")?.fee ?? null;
}

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

export function findShippingRate(governorate: string, area: string): (ShippingRate & { unserved?: string }) | undefined {
  const governorateKey = normalizeRateLabel(governorate);
  const areaKey = normalizeRateLabel(area);
  if (!governorateKey || !areaKey) return undefined;
  if (!isShippingGovernorate(governorate.trim())) return undefined;

  // An unserved area never gets a price: customer service confirms it.
  const unserved = unservedAreaFor(governorate, area === "*" ? "" : area);
  if (unserved) return { governorate, area, fee: null, unserved };

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
