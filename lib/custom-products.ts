// Products added from the admin (pure, tested). They become regular catalog products: shown in the
// store, orderable, counted in the factory summary and the financials. Storage: custom-products-store.
import { categoryInfo, isBuiltInProduct, type CatalogCategory, type CatalogProduct } from "./site-data.ts";

export const MAX_IMAGE_BASE64_LENGTH = 900_000;
export const IMAGE_ID_PATTERN = /^img-[a-z\d]{8,40}$/;
export const CUSTOM_PRODUCT_ID_PATTERN = /^bm-(abaya|robe|winter-pajama|winter-blanket)-n[a-z\d]{6,24}$/;

const ID_PREFIX: Record<CatalogCategory, string> = {
  abayas: "bm-abaya",
  robes: "bm-robe",
  "winter-pajamas": "bm-winter-pajama",
  "wearable-blankets": "bm-winter-blanket",
};

/** A new product code in the same style as the catalog ("bm-robe-n…"); never reused. */
export function newProductId(category: CatalogCategory, now = Date.now(), random = Math.random()) {
  return `${ID_PREFIX[category]}-n${now.toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export function newImageId(now = Date.now(), random = Math.random()) {
  return `img-${now.toString(36)}${Math.floor(random * 36 ** 6).toString(36).padStart(6, "0")}`;
}

export const imagePath = (imageId: string) => `/api/product-images/${imageId}`;

export function isCategory(value: unknown): value is CatalogCategory {
  return typeof value === "string" && value in categoryInfo;
}

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

export type ProductInput = {
  name: string;
  category: CatalogCategory;
  /** Single-piece price; null = sold only inside the winter offer (pajamas / blankets). */
  price: number | null;
  imageAlt: string;
  /** Pajamas only: weight limit of the One Size. */
  maxWeightKg: number | null;
  hidden: boolean;
};

/** Checks the product fields from the admin form. Returns an error message (Arabic) or the clean input. */
export function sanitizeProductInput(raw: unknown): { input: ProductInput } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "بيانات المنتج ناقصة." };
  const value = raw as Record<string, unknown>;
  const name = text(value.name, 120);
  if (name.length < 3) return { error: "اكتبي اسم المنتج (٣ حروف على الأقل)." };
  if (!isCategory(value.category)) return { error: "اختاري القسم." };
  const category = value.category;
  let price: number | null = null;
  if (value.price !== null && value.price !== undefined && value.price !== "") {
    const number = Number(value.price);
    if (!Number.isFinite(number) || number <= 0 || number > 100_000) return { error: "سعر البيع لازم يبقى رقم أكبر من صفر." };
    price = Math.round(number);
  }
  const offerOnlyAllowed = category === "winter-pajamas" || category === "wearable-blankets";
  if (price === null && !offerOnlyAllowed) return { error: "العبايات والأرواب لازم يبقى ليها سعر بيع." };
  let maxWeightKg: number | null = null;
  if (category === "winter-pajamas" && value.maxWeightKg !== null && value.maxWeightKg !== undefined && value.maxWeightKg !== "") {
    const number = Number(value.maxWeightKg);
    if (!Number.isInteger(number) || number < 30 || number > 200) return { error: "حد الوزن لازم يبقى رقم صحيح بالكيلو (مثلاً 70)." };
    maxWeightKg = number;
  }
  return {
    input: {
      name,
      category,
      price,
      imageAlt: text(value.imageAlt, 200) || name,
      maxWeightKg,
      hidden: value.hidden === true,
    },
  };
}

/** The catalog entry for an admin-added product. */
export function toCatalogProduct(id: string, input: ProductInput, image: string): CatalogProduct {
  return {
    id,
    name: input.name,
    category: input.category,
    image,
    imageAlt: input.imageAlt,
    ...(input.price !== null ? { price: input.price } : {}),
    ...(input.hidden ? { hidden: true } : {}),
    ...(input.maxWeightKg !== null ? { maxWeightKg: input.maxWeightKg } : {}),
  };
}

/** A stored product as read back: only well-formed admin-added products are accepted. */
export function parseCustomProduct(raw: unknown): CatalogProduct | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !CUSTOM_PRODUCT_ID_PATTERN.test(value.id) || isBuiltInProduct(value.id)) return null;
  if (typeof value.name !== "string" || !isCategory(value.category) || typeof value.image !== "string" || !value.image.startsWith("/api/product-images/")) return null;
  return {
    id: value.id,
    name: value.name,
    category: value.category,
    image: value.image,
    imageAlt: typeof value.imageAlt === "string" ? value.imageAlt : value.name,
    ...(typeof value.price === "number" ? { price: value.price } : {}),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(typeof value.maxWeightKg === "number" ? { maxWeightKg: value.maxWeightKg } : {}),
  };
}

/** Accepts a base64 JPEG / PNG / WebP (checked by its first bytes); returns its content type or null. */
export function imageTypeOf(base64: string) {
  if (typeof base64 !== "string" || base64.length < 100 || base64.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/]+=*$/.test(base64)) return null;
  const head = Buffer.from(base64.slice(0, 32), "base64");
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
