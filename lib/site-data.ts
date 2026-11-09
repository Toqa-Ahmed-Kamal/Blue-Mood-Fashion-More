export type CatalogCategory = "abayas" | "robes" | "winter-pajamas" | "wearable-blankets";

export type CatalogProduct = {
  /** Stable internal identifier used in orders; never shown to customers. */
  id: string;
  name: string;
  category: CatalogCategory;
  image: string;
  imageAlt: string;
  /** Overrides the category price for this one product. */
  price?: number;
  /** Hidden products stay orderable by ID for old orders but are not shown in the store. */
  hidden?: boolean;
  /** Pajamas only: overrides the default One Size weight note (85–90 kg). */
  maxWeightKg?: number;
};

/**
 * Single-piece prices in EGP — edit here.
 * A product's own `price` wins over its category price; null means offer-only.
 */
export const categoryPrices: Record<CatalogCategory, number | null> = {
  abayas: 350,
  robes: 250,
  "winter-pajamas": 275,
  "wearable-blankets": 250,
};

/** Categories that can also be picked inside the winter offer. */
export const offerCategories: CatalogCategory[] = ["winter-pajamas", "wearable-blankets"];

export const categoryInfo: Record<CatalogCategory, { label: string; singular: string; anchor: string; tagline: string }> = {
  abayas: { label: "عبايات", singular: "عباية", anchor: "abayas", tagline: "قطيفة بتطريز راقي لكل يوم" },
  robes: { label: "أرواب", singular: "روب", anchor: "robes", tagline: "فرو ناعم ودافي بغطاء رأس" },
  "winter-pajamas": { label: "بيجامات", singular: "بيجاما", anchor: "pajamas", tagline: "فليس وفرو ناعم · لوحدها أو ضمن عرض الشتاء" },
  "wearable-blankets": { label: "بلانكيت", singular: "بلانكيت", anchor: "blankets", tagline: "بلانكيت يُلبس · لوحده أو ضمن عرض الشتاء" },
};

export const categoryOrder: CatalogCategory[] = ["abayas", "robes", "winter-pajamas", "wearable-blankets"];

export const catalog: CatalogProduct[] = [
  // ── عبايات ──
  { id: "bm-abaya-001", name: "عباية قطيفة سوداء بتطريز ورد أبيض", category: "abayas", image: "/images/abayas/1000507623.jpg", imageAlt: "عباية سوداء طويلة بتطريز ورود بيضاء وبيج على الصدر وشريط مطرز في المنتصف" },
  { id: "bm-abaya-002", name: "عباية قطيفة بترولي بتطريز هندسي", category: "abayas", image: "/images/abayas/1000507624.jpg", imageAlt: "عباية زرقاء بترولي بتطريز هندسي على الصدر وشريطين مطرزين بطول العباية" },
  { id: "bm-abaya-003", name: "عباية قطيفة زرقاء ملكي بتطريز أبيض", category: "abayas", image: "/images/abayas/1000507625.jpg", imageAlt: "عباية زرقاء ملكي بتطريز أبيض وبيج على الرقبة وشريطين مطرزين على الجانبين" },
  { id: "bm-abaya-004", name: "عباية قطيفة زرقاء بتطريز ورد على الذيل", category: "abayas", image: "/images/abayas/1000507626.jpg", imageAlt: "عباية زرقاء ملكي بصدرية مطرزة وتطريز نباتي على الطرف السفلي" },
  { id: "bm-abaya-005", name: "عباية قطيفة خضراء غامقة بتطريز بيج", category: "abayas", image: "/images/abayas/1000507627.jpg", imageAlt: "عباية خضراء غامقة بتطريز أبيض وبيج على الصدر وشريط مطرز في المنتصف" },
  { id: "bm-abaya-006", name: "عباية بمبي بتطريز بني", category: "abayas", image: "/images/abayas/1000507628.jpg", imageAlt: "عباية وردي بتطريز بني وأبيض على الصدر وشريط مطرز بطول العباية" },
  { id: "bm-abaya-007", name: "عباية قطيفة بني بتطريز دوائر", category: "abayas", image: "/images/abayas/1000507629.jpg", imageAlt: "عباية بني غامق بتطريز دوائر بيضاء وبيج على الرقبة والذيل" },
  { id: "bm-abaya-008", name: "عباية قطيفة زيتي بتطريز ذهبي", category: "abayas", image: "/images/abayas/1000507630.jpg", imageAlt: "عباية قطيفة خضراء زيتي بتطريز كريمي ذهبي على الصدر والأكمام" },
  { id: "bm-abaya-009", name: "عباية قطيفة بترولي بتطريز دوائر", category: "abayas", image: "/images/abayas/1000507811.jpg", imageAlt: "عباية بترولي واسعة بتطريز دوائر وزخارف بيج وأبيض", hidden: true },
  { id: "bm-abaya-010", name: "عباية قطيفة بمبي بتطريز رمادي", category: "abayas", image: "/images/abayas/1000507814.jpg", imageAlt: "عباية قطيفة وردي فاتح بأكمام منفوخة وتطريز رمادي على الصدر" },
  { id: "bm-abaya-011", name: "عباية قطيفة كحلي بتطريز ذهبي وحزام", category: "abayas", image: "/images/abayas/1000507817.jpg", imageAlt: "عباية قطيفة كحلي بتطريز ذهبي على الصدر والأطراف وحزام مضفور بشراشيب" },
  { id: "bm-abaya-012", name: "عباية قطيفة كحلي بتطريز ورد كريمي", category: "abayas", image: "/images/abayas/1000507820.jpg", imageAlt: "عباية قطيفة كحلي بتطريز ورود كريمي على الصدر والأكمام" },
  { id: "bm-abaya-013", name: "عباية قطيفة سوداء بتطريز ذهبي", category: "abayas", image: "/images/abayas/1000507822.jpg", imageAlt: "عباية قطيفة سوداء بتطريز ذهبي على الصدر والأكمام وزخارف على الجانبين" },
  { id: "bm-abaya-014", name: "عباية قطيفة خضراء زمردي بتطريز ذهبي", category: "abayas", image: "/images/abayas/1000507824.jpg", imageAlt: "عباية قطيفة خضراء غامقة بتطريز ذهبي على الصدر والأكمام", hidden: true },
  { id: "bm-abaya-015", name: "عباية قطيفة سوداء بتطريز ذهبي وفضي", category: "abayas", image: "/images/abayas/1000507828.jpg", imageAlt: "عباية قطيفة سوداء واسعة بتطريز ذهبي وفضي كثيف على الصدر والأكمام" },
  { id: "bm-abaya-016", name: "عباية قطيفة بتطريز هندسي (بترولي / بني)", category: "abayas", image: "/images/abayas/1000507829.jpg", imageAlt: "عباية قطيفة بتطريز هندسي أبيض بلونين بترولي وبني", hidden: true },

  // ── أرواب ──
  { id: "bm-robe-001", name: "روب فرو مورد فوشيا بغطاء رأس", category: "robes", image: "/images/robe/floral-fuchsia-robe.jpg", imageAlt: "روب فرو طويل بغطاء رأس بطبعة ورود وردية ونبيتي كبيرة وحزام" },
  { id: "bm-robe-002", name: "روب فرو سماوي بورد أبيض", category: "robes", image: "/images/robe/floral-sky-robe.jpg", imageAlt: "روب فرو طويل أزرق سماوي بغطاء رأس مطبوع عليه زهور بيضاء كبيرة" },
  { id: "bm-robe-003", name: "روب فرو بطبعة نمر", category: "robes", image: "/images/robe/1000508109.png", imageAlt: "روب فرو طويل بطبعة جلد النمر بغطاء رأس وحزام مربوط وجيوب أمامية" },
  { id: "bm-robe-004", name: "روب سماوي منقط بنفسجي", category: "robes", image: "/images/robe/1000508110.png", imageAlt: "روب طويل أزرق بغطاء رأس مطبوع عليه بقع بنفسجية مع حزام وجيبين" },
  { id: "bm-robe-005", name: "روب فرو تركواز بطبعة دباديب", category: "robes", image: "/images/robe/1000508107.jpg", imageAlt: "روب فرو طويل تركواز بغطاء رأس وحزام مطبوع عليه دباديب", hidden: true },

  // ── بيجامات ──
  { id: "bm-winter-pajama-001", name: "بيجاما بطبعة دب", category: "winter-pajamas", image: "/images/bejama/pink-gray-bear-print-pajama-set.jpg", imageAlt: "تيشيرت وردي عليه رسمة دب رمادي وبنطلون رمادي بطبعة دببة بيضاء", maxWeightKg: 70 },
  { id: "bm-winter-pajama-002", name: "بيجاما بطبعة بقرة", category: "winter-pajamas", image: "/images/bejama/brown-cow-print-pajamas.jpg", imageAlt: "تيشيرت بني بجيب مطبوع وبنطلون أبيض بطبعة بقرة" },
  { id: "bm-winter-pajama-003", name: "بيجاما كريمي بطبعة دب", category: "winter-pajamas", image: "/images/bejama/cream-bear-print-pajamas.jpg", imageAlt: "بيجاما كريمية عليها رسمة دبدوب وبالونات وبنطلون مقلم بورود صغيرة", maxWeightKg: 70 },
  { id: "bm-winter-pajama-004", name: "بيجاما رمادي بطبعة قطط وفيونكات", category: "winter-pajamas", image: "/images/bejama/gray-bow-print-pajama-set.jpg", imageAlt: "تيشيرت رمادي عليه قطتين سوداوين وبنطلون واسع مطبوع عليه فيونكات سوداء" },
  { id: "bm-winter-pajama-005", name: "بيجاما وردية بطبعة فيونكات", category: "winter-pajamas", image: "/images/bejama/pink-bow-print-pajama-set.jpg", imageAlt: "بيجاما فليس وردية، تيشيرت بجيب عليه فيونكة وبنطلون مطبوع عليه فيونكات فوشيا" },
  { id: "bm-winter-pajama-006", name: "بيجاما زرقاء بطبعة كوالا", category: "winter-pajamas", image: "/images/bejama/blue-koala-print-pajama-set.jpg", imageAlt: "بيجاما زرقاء رمادية، التيشيرت عليه رسمة كوالا والبنطلون مطبوع عليه وجوه كوالا" },
  { id: "bm-winter-pajama-007", name: "بيجاما رمادي فيونكات بفيونكة على الصدر", category: "winter-pajamas", image: "/images/bejama/1000508030.jpg", imageAlt: "بيجاما رمادية مطبوع عليها فيونكات سوداء صغيرة برقبة V وفيونكة سوداء على الصدر", maxWeightKg: 70 },
  { id: "bm-winter-pajama-008", name: "بيجاما فرو وردي بفيونكة نبيتي", category: "winter-pajamas", image: "/images/bejama/1000507687.jpg", imageAlt: "بلوفر فرو وردي بكابشون وفيونكة نبيتي كبيرة وبنطلون نبيتي باستك عند الكاحل", maxWeightKg: 70 },
  { id: "bm-winter-pajama-009", name: "بيجاما فرو أبيض بفيونكة زرقاء", category: "winter-pajamas", image: "/images/bejama/1000507702.jpg", imageAlt: "بلوفر فرو أبيض بفيونكة زرقاء كبيرة وبنطلون قطيفة مضلع أزرق", hidden: true },
  { id: "bm-winter-pajama-010", name: "بيجاما مضلعة سمايل", category: "winter-pajamas", image: "/images/bejama/1000508032.jpg", imageAlt: "بيجاما مضلعة باللون الأخضر النعناعي، التيشيرت عليه وجه ضاحك مطرز", maxWeightKg: 70 },
  { id: "bm-winter-pajama-011", name: "طقم بيتي مضلع كاميل بسوستة", category: "winter-pajamas", image: "/images/bejama/1000507695.jpg", imageAlt: "طقم قطيفة مضلع بلون الكاميل، بلوزة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-012", name: "بيجاما فليس زرقاء بطبعة ورود", category: "winter-pajamas", image: "/images/bejama/1000508651.jpg", imageAlt: "بيجاما فليس زرقاء، التيشيرت بجيب والبنطلون مطبوع عليه ورود صغيرة" },
  { id: "bm-winter-pajama-013", name: "بيجاما فليس موف بطبعة ورود", category: "winter-pajamas", image: "/images/bejama/1000508653.jpg", imageAlt: "بيجاما فليس موف، التيشيرت بجيب والبنطلون الواسع مطبوع عليه ورود" },
  { id: "bm-winter-pajama-014", name: "بيجاما قطيفة حمراء بحواف بيضاء", category: "winter-pajamas", image: "/images/abayas/1000507835.jpg", imageAlt: "بيجاما قطيفة حمراء بقميص بزراير وحواف بيضاء", hidden: true },
  { id: "bm-winter-pajama-015", name: "بيجاما فرو كريمي بفيونكة وردي", category: "winter-pajamas", image: "/images/bejama/1000507690.jpg", imageAlt: "عبوة بيجاما عليها بلوفر فرو كريمي بفيونكة وردية وبنطلون فرو وردي", hidden: true },
  { id: "bm-winter-pajama-016", name: "طقم فرو بكابشون", category: "winter-pajamas", image: "/images/bejama/1000508037.jpg", imageAlt: "عبوة طقم فرو بكابشون وبنطلون من نفس الخامة", hidden: true },
  { id: "bm-winter-pajama-017", name: "بيجاما بيضاء بطبعة قطط وقلوب", category: "winter-pajamas", image: "/images/bejama/1000508040.jpg", imageAlt: "عبوة بيجاما بيضاء برقبة دانتيل مطبوع عليها قطط وقلوب", hidden: true },
  { id: "bm-winter-pajama-018", name: "بيجاما بنفسجي ببنطلون مطبوع ورق شجر", category: "winter-pajamas", image: "/images/abayas/1000507713.jpg", imageAlt: "عبوة بيجاما بنفسجي ببنطلون مطبوع ورق شجر", hidden: true },

  // ── بلانكيت ──
  { id: "bm-winter-blanket-001", name: "بلانكيت أسود بغطاء للرأس", category: "wearable-blankets", image: "/images/bejama/black-hooded-blanket-cropped.jpg", imageAlt: "بلانكيت فرو أسود واسع بغطاء للرأس يُلبس فوق الملابس", price: 350 },
  { id: "bm-winter-blanket-002", name: "بلانكيت هودي بقلوب وودان أرنب", category: "wearable-blankets", image: "/images/bejama/1000507693.jpg", imageAlt: "هودي بطانية واسع من الفرو مطبوع عليه قلوب بيضاء وبكابشون بودان أرنب" },
];

export const visibleCatalog = catalog.filter((product) => !product.hidden);

export function findProduct(id: string) {
  return catalog.find((product) => product.id === id);
}

export function priceOf(product: CatalogProduct) {
  return product.price ?? categoryPrices[product.category];
}

/** Lowest single-piece price among the visible products of a category. */
export function startingPriceOf(category: CatalogCategory) {
  const prices = productsIn(category).map(priceOf).filter((price): price is number => price !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function productsIn(category: CatalogCategory) {
  return visibleCatalog.filter((product) => product.category === category);
}

export const landingPromotion = {
  price: 1100,
  currency: "EGP",
  durationDays: 3,
  options: [
    {
      id: "four-pajamas",
      label: "٤ بيجامات شتوية",
      description: "اختاري ٤ موديلات مختلفة من البيجامات",
      pajamaCount: 4,
      wearableBlanketCount: 0,
    },
    {
      id: "three-pajamas-and-blanket",
      label: "٣ بيجامات + بلانكيت",
      description: "٣ بيجامات شتوية + بلانكيت يُلبس",
      pajamaCount: 3,
      wearableBlanketCount: 1,
    },
  ] as const,
};

export type LandingPromotionOptionId = (typeof landingPromotion.options)[number]["id"];

export function findOffer(id: string) {
  return landingPromotion.options.find((option) => option.id === id);
}
