/**
 * Editable preliminary Cairo delivery table, ordered approximately from Matariya.
 * Fees are estimates and remain changeable. Use null when the fee is not set.
 * Use area: "*" for one fee across a governorate instead of area-specific fees.
 */
export type ShippingRate = {
  governorate: string;
  area: string;
  fee: number | null;
};

export const shippingGovernorates = ["القاهرة"] as const;

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
];

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
