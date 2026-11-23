export type CatalogCategory = "abayas" | "robes" | "winter-pajamas" | "wearable-blankets" | "onesies" | "casual";

export type CatalogProduct = {
  /** Stable internal identifier used in orders; never shown to customers. */
  id: string;
  name: string;
  category: CatalogCategory;
  image: string;
  imageAlt: string;
  /** Overrides the category price for this one product. */
  price?: number;
  /** Price before the discount ("بدل كذا") shown struck through; the admin can change or remove it. */
  wasPrice?: number;
  /** Hidden products stay orderable by ID for old orders but are not shown in the store. */
  hidden?: boolean;
  /** Pajamas only: overrides the default One Size weight note (85–90 kg). */
  maxWeightKg?: number;
  /**
   * Real number of times this piece was sold before. Shown on the card as
   * "اتطلبت +N مرة" — only put real numbers here (fake counts are misleading ads).
   */
  soldCount?: number;
  /** Added from the team account ("ادمن اكونت"). */
  addedBy?: "team";
  /** Team product waiting for the owner's approval (kept hidden until then). */
  pending?: true;
  /** The owner approved it at least once (it may be in orders: never deleted, only hidden). */
  approved?: true;
  /** Removed by the team account after it was approved: hidden, kept for past orders. */
  removed?: true;
};

/**
 * Single-piece prices in EGP — edit here.
 * A product's own `price` wins over its category price; null means offer-only.
 */
export const categoryPrices: Record<CatalogCategory, number | null> = {
  abayas: 350,
  robes: 250,
  "winter-pajamas": 300,
  "wearable-blankets": 295,
  onesies: 270,
  // No category price: every casual piece has its own price.
  casual: null,
};

/** Categories that can also be picked inside the winter offer. */
export const offerCategories: CatalogCategory[] = ["winter-pajamas", "wearable-blankets"];

export const categoryInfo: Record<CatalogCategory, { label: string; singular: string; anchor: string; tagline: string }> = {
  abayas: { label: "عبايات", singular: "عباية", anchor: "abayas", tagline: "قطيفة بتطريز راقي لكل يوم" },
  robes: { label: "أرواب", singular: "روب", anchor: "robes", tagline: "فرو ناعم ودافي بغطاء رأس" },
  "winter-pajamas": { label: "بيجامات", singular: "بيجاما", anchor: "pajamas", tagline: "فليس وفرو ناعم · لوحدها أو ضمن عرض الشتاء" },
  "wearable-blankets": { label: "بلانكيت", singular: "بلانكيت", anchor: "blankets", tagline: "بلانكيت يُلبس · لوحده أو ضمن عرض الشتاء" },
  onesies: { label: "سالوبيت", singular: "سالوبيت", anchor: "onesies", tagline: "فرو ناعم بكابشون وسوستة · قطعة واحدة دافية" },
  casual: { label: "كاجوال", singular: "كاجوال", anchor: "casual", tagline: "لبس كاجوال مريح لكل يوم" },
};

/** Categories sold One Size with a "لحد كام كيلو" note (pajamas and onesies). */
export const weightFitCategories: CatalogCategory[] = ["winter-pajamas", "onesies"];
export const hasWeightFit = (category: CatalogCategory | undefined) => category !== undefined && weightFitCategories.includes(category);

/** Order of the sections on the store (and in the menu): blankets, pajamas, robes, abayas. */
export const categoryOrder: CatalogCategory[] = ["wearable-blankets", "winter-pajamas", "onesies", "robes", "abayas", "casual"];

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
  { id: "bm-winter-pajama-014", name: "بيجاما قطيفة حمراء بحواف بيضاء", category: "winter-pajamas", image: "/images/bejama/1000507835.jpg", imageAlt: "بيجاما قطيفة حمراء بقميص بزراير وحواف بيضاء", hidden: true },
  { id: "bm-winter-pajama-015", name: "بيجاما فرو كريمي بفيونكة وردي", category: "winter-pajamas", image: "/images/bejama/1000507690.jpg", imageAlt: "عبوة بيجاما عليها بلوفر فرو كريمي بفيونكة وردية وبنطلون فرو وردي", hidden: true },
  { id: "bm-winter-pajama-016", name: "طقم فرو بكابشون", category: "winter-pajamas", image: "/images/bejama/1000508037.jpg", imageAlt: "عبوة طقم فرو بكابشون وبنطلون من نفس الخامة", hidden: true },
  { id: "bm-winter-pajama-017", name: "بيجاما بيضاء بطبعة قطط وقلوب", category: "winter-pajamas", image: "/images/bejama/1000508040.jpg", imageAlt: "عبوة بيجاما بيضاء برقبة دانتيل مطبوع عليها قطط وقلوب", hidden: true },
  { id: "bm-winter-pajama-018", name: "بيجاما بنفسجي ببنطلون مطبوع ورق شجر", category: "winter-pajamas", image: "/images/abayas/1000507713.jpg", imageAlt: "عبوة بيجاما بنفسجي ببنطلون مطبوع ورق شجر", hidden: true },
  { id: "bm-winter-pajama-019", name: "طقم قطيفة مضلع بسوستة · سيمون", category: "winter-pajamas", image: "/images/bejama/ribbed-zip-set-salmon.jpg", imageAlt: "طقم قطيفة مضلع بلون السيمون، بلوزة واسعة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-020", name: "طقم قطيفة مضلع بسوستة · أسود", category: "winter-pajamas", image: "/images/bejama/ribbed-zip-set-black.jpg", imageAlt: "طقم قطيفة مضلع أسود، بلوزة واسعة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-021", name: "طقم قطيفة مضلع بسوستة · زيتي", category: "winter-pajamas", image: "/images/bejama/ribbed-zip-set-green.jpg", imageAlt: "طقم قطيفة مضلع أخضر زيتي غامق، بلوزة واسعة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-022", name: "بيجاما وردي بطبعة باندا", category: "winter-pajamas", image: "/images/bejama/panda-pajama-pink.jpg", imageAlt: "بيجاما وردية، التيشيرت عليه وش باندا والبنطلون مطبوع عليه باندا وقلوب" },
  { id: "bm-winter-pajama-023", name: "بيجاما رمادي بطبعة باندا", category: "winter-pajamas", image: "/images/bejama/panda-pajama-gray.jpg", imageAlt: "بيجاما رمادية، التيشيرت عليه وش باندا والبنطلون مطبوع عليه باندا وقلوب وردي" },
  { id: "bm-winter-pajama-024", name: "بيجاما بيج بقلب وفراشات", category: "winter-pajamas", image: "/images/bejama/heart-butterfly-pajama.jpg", imageAlt: "تيشيرت بيج عليه قلب وفراشات سوداء وبنطلون أسود واسع مطبوع عليه فراشات بيج" },
  { id: "bm-winter-pajama-025", name: "بيجاما موف Dream ببنطلون ألوان", category: "winter-pajamas", image: "/images/bejama/dream-pajama-purple.jpg", imageAlt: "تيشيرت موف مكتوب عليه Dream وبنطلون واسع مطبوع بدرجات الفوشيا والرمادي", hidden: true },
  { id: "bm-winter-pajama-026", name: "بيجاما حمراء بجيب وبنطلون كاروهات", category: "winter-pajamas", image: "/images/bejama/red-plaid-pocket-pajama.jpg", imageAlt: "تيشيرت أحمر بجيب كاروهات وبنطلون أبيض بكاروهات حمراء" },
  { id: "bm-winter-pajama-027", name: "بيجاما قميص مقلمة بطبعة دباديب وفيونكات", category: "winter-pajamas", image: "/images/bejama/striped-teddy-bow-pajama.jpg", imageAlt: "بيجاما قميص بزراير مقلمة بيج مطبوع عليها دباديب وفيونكات بني" },
  { id: "bm-winter-pajama-028", name: "بيجاما فرو لبني بطبعة قطة وبنطلون كاروهات", category: "winter-pajamas", image: "/images/bejama/blue-kitty-fleece-pajama.jpg", imageAlt: "بلوفر فرو لبني عليه رسمة قطة بفيونكة وبنطلون كاروهات أزرق وأبيض", hidden: true },
  { id: "bm-winter-pajama-029", name: "بيجاما نمر بحواف سوداء وزراير", category: "winter-pajamas", image: "/images/bejama/leopard-button-pajama.jpg", imageAlt: "بيجاما بطبعة نمر، بلوزة برقبة V بزراير وحواف سوداء وبنطلون نمر" },
  { id: "bm-winter-pajama-030", name: "بيجاما فرو بيج ببنطلون نمر رمادي", category: "winter-pajamas", image: "/images/bejama/beige-fleece-gray-leopard.jpg", imageAlt: "بلوفر فرو بيج بجيب نمر رمادي وبنطلون فليس بطبعة نمر رمادي وأسود" },
  { id: "bm-winter-pajama-031", name: "بيجاما فرو بني بقلب نمر", category: "winter-pajamas", image: "/images/bejama/brown-fleece-leopard-heart.jpg", imageAlt: "بلوفر فرو بني عليه قلب بطبعة نمر وبنطلون بطبعة نمر" },
  { id: "bm-winter-pajama-032", name: "بيجاما فرو أسود ببنطلون نمر", category: "winter-pajamas", image: "/images/bejama/black-fleece-leopard.jpg", imageAlt: "بلوفر فرو أسود بجيب نمر وبنطلون فليس بطبعة نمر بني" },
  { id: "bm-winter-pajama-033", name: "بيجاما وردي بطبعة أرنب ونقط", category: "winter-pajamas", image: "/images/bejama/pink-bunny-dots-pajama.jpg", imageAlt: "بيجاما وردية، التيشيرت عليه رسمة أرنب والبنطلون مطبوع عليه نقط كحلي وأرانب" },

  { id: "bm-winter-pajama-034", name: "طقم قطيفة مضلع بسوستة · أبيض", category: "winter-pajamas", image: "/images/bejama/ribbed-zip-set-white.jpg", imageAlt: "طقم قطيفة مضلع أبيض، بلوزة واسعة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-035", name: "بيجاما فرو أسود بفيونكة وبنطلون نبيتي", category: "winter-pajamas", image: "/images/bejama/black-fleece-bow-burgundy.jpg", imageAlt: "بلوفر فرو أسود بكابشون وفيونكة نبيتي على الصدر وبنطلون قطيفة نبيتي باستك عند الكاحل" },
  { id: "bm-winter-pajama-036", name: "بيجاما فرو أبيض بفيونكة وبنطلون تركواز", category: "winter-pajamas", image: "/images/bejama/white-fleece-bow-teal.jpg", imageAlt: "بلوفر فرو أبيض بكابشون وفيونكة تركواز على الصدر وبنطلون قطيفة تركواز باستك عند الكاحل" },
  { id: "bm-winter-pajama-037", name: "بيجاما قطيفة أزرق ملكي بكابشون وطبعة كريز", category: "winter-pajamas", image: "/images/bejama/royal-blue-cherry-hoodie-set.jpg", imageAlt: "طقم قطيفة أزرق ملكي بكابشون، على الصدر فيونكة بطبعة نمر وحبتين كريز ومكتوب Cherry" },

  { id: "bm-winter-pajama-038", name: "بيجاما زيتي بطبعة بطريق وجيوب مقلمة", category: "winter-pajamas", image: "/images/bejama/olive-penguin-pajama.jpg", imageAlt: "تيشيرت أخضر زيتي عليه بطريق بطاقية وجيبين مقلمين وبنطلون مقلم زجزاج زيتي وكحلي" },
  { id: "bm-winter-pajama-039", name: "بيجاما موف بطبعة بجع وبط", category: "winter-pajamas", image: "/images/bejama/purple-swan-duck-pajama.jpg", imageAlt: "تيشيرت موف عليه بجعتين وورد، والأكمام والبنطلون مربعات موف وأبيض بطبعة بط" },
  { id: "bm-winter-pajama-040", name: "بيجاما نبيتي بطبعة بجع وبط", category: "winter-pajamas", image: "/images/bejama/burgundy-swan-duck-pajama.jpg", imageAlt: "تيشيرت نبيتي عليه بجعتين وورد، والأكمام والبنطلون مربعات نبيتي وأبيض بطبعة بط" },
  { id: "bm-winter-pajama-041", name: "طقم مضلع Smile · نبيتي", category: "winter-pajamas", image: "/images/bejama/ribbed-smile-set-burgundy.jpg", imageAlt: "طقم مضلع نبيتي، بلوزة عليها وش ضاحك أصفر مطرز وكلمة Smile وبنطلون واسع" },
  { id: "bm-winter-pajama-042", name: "طقم قطيفة مضلع بسوستة · فوشيا", category: "winter-pajamas", image: "/images/bejama/ribbed-zip-set-fuchsia.jpg", imageAlt: "طقم قطيفة مضلع فوشيا، بلوزة واسعة برقبة عالية وسوستة وبنطلون واسع" },
  { id: "bm-winter-pajama-043", name: "بيجاما نبيتي بجيب كاروهات", category: "winter-pajamas", image: "/images/bejama/burgundy-plaid-pocket-pajama.jpg", imageAlt: "تيشيرت نبيتي بكم طويل وجيب كاروهات على الصدر، وبنطلون واسع كاروهات أحمر وأخضر وأبيض" },
  // Hidden: the photo shows another brand's name (London Burberry). Show it from the admin only with a photo without it.
  { id: "bm-winter-pajama-044", name: "طقم قطيفة بتيل بكابشون بطبعة دبدوب", category: "winter-pajamas", image: "/images/bejama/teal-velvet-bear-hoodie-set.jpg", imageAlt: "طقم قطيفة بتيل، هودي بكابشون عليه طبعة دبدوب كاروهات وحرف أبيض من تحت، وبنطلون واسع بجيوب", hidden: true },
  { id: "bm-winter-pajama-045", name: "بيجاما كاروهات أحمر بزراير", category: "winter-pajamas", image: "/images/bejama/red-plaid-button-pajama.jpg", imageAlt: "بيجاما كاروهات أحمر وأسود، قميص بياقة وزراير وجيب، وبنطلون كاروهات" },
  { id: "bm-winter-pajama-046", name: "بيجاما كحلي بطبعة رجل الثلج", category: "winter-pajamas", image: "/images/bejama/navy-snowman-pajama-new-year.jpg", imageAlt: "بلوزة كحلي بكم طويل مكتوب عليها HAPPY NEW YEAR ورجل ثلج بطاقية وكوفية، وبنطلون كحلي بطبعة رجل الثلج وعصيان حلوى وندف ثلج" },
  // Hidden: the photo shows another brand's character and name (Hello Kitty). Show it from the admin only with a photo without it.
  { id: "bm-winter-pajama-047", name: "بيجاما فرو لبني وبنطلون كاروهات", category: "winter-pajamas", image: "/images/bejama/blue-kitty-gingham-pajama.jpg", imageAlt: "بلوزة فرو لبني بكم طويل عليها قطة مطرزة بفيونكة، وبنطلون كاروهات لبني وأبيض", hidden: true },
  { id: "bm-winter-pajama-048", name: "طقم فرو أصفر بكابشون", category: "winter-pajamas", image: "/images/bejama/yellow-fleece-hoodie-pajama.jpg", imageAlt: "طقم فرو أصفر فاتح، هودي بكابشون وجيب كانجارو وكتابة سودا على الصدر، وبنطلون واسع" },

  // ── سالوبيت ──
  { id: "bm-onesie-001", name: "سالوبيت فرو ستيتش بكابشون", category: "onesies", image: "/images/onesies/stitch-fleece-onesie.jpg", imageAlt: "سالوبيت فرو أزرق بكابشون وسوستة كاملة مطبوع عليه رسومات ستيتش وقلوب وردي، بجيوب وأساور عند الكاحل", price: 270, maxWeightKg: 70 },

  // ── بلانكيت ──
  // Newest blankets first in their section.
  { id: "bm-winter-blanket-011", name: "بلانكيت قطيفة بكابشون · أحمر", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-red.jpg", imageAlt: "بلانكيت قطيفة أحمر نبيتي ناعم بنقشة بارزة، واسع ويُلبس بكابشون وبيغطي الجسم كله" },
  { id: "bm-winter-blanket-012", name: "بلانكيت قطيفة بكابشون · زيتي", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-olive.jpg", imageAlt: "بلانكيت قطيفة زيتي ناعم بنقشة بارزة، واسع ويُلبس بكابشون وبيغطي الجسم كله" },
  { id: "bm-winter-blanket-013", name: "بلانكيت قطيفة بكابشون · موف", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-purple.jpg", imageAlt: "بلانكيت قطيفة موف غامق ناعم بنقشة بارزة، واسع ويُلبس بكابشون وبيغطي الجسم كله" },
  { id: "bm-winter-blanket-001", name: "بلانكيت أسود بغطاء للرأس", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-black.jpg", imageAlt: "بلانكيت قطيفة أسود واسع بكابشون يُلبس فوق الملابس", price: 350 },
  { id: "bm-winter-blanket-002", name: "بلانكيت هودي بقلوب وودان أرنب", category: "wearable-blankets", image: "/images/bejama/1000507693.jpg", imageAlt: "هودي بطانية واسع من الفرو مطبوع عليه قلوب بيضاء وبكابشون بودان أرنب" },
  { id: "bm-winter-blanket-003", name: "بلانكيت أزرق بنقط موف", category: "wearable-blankets", image: "/images/blanket/image_1_without_price.jpg", imageAlt: "بلانكيت هودي فرو أزرق واسع مطبوع عليه دوائر موف كبيرة بجيب أمامي وكابشون" },
  { id: "bm-winter-blanket-004", name: "بلانكيت لبني بطبعة ستيتش وقلوب", category: "wearable-blankets", image: "/images/blanket/image_2_without_price.jpg", imageAlt: "بلانكيت هودي فرو لبني واسع مطبوع عليه رسومات ستيتش وقلوب بيضاء بجيب أمامي" },
  { id: "bm-winter-blanket-005", name: "بلانكيت بطبعة زيبرا بيج ورمادي", category: "wearable-blankets", image: "/images/blanket/image_3_without_price.jpg", imageAlt: "بلانكيت هودي فرو واسع بخطوط زيبرا بيج ورمادي بجيب أمامي وكابشون" },
  { id: "bm-winter-blanket-006", name: "بلانكيت رمادي بطبعة فيونكات", category: "wearable-blankets", image: "/images/blanket/image_4_without_price.jpg", imageAlt: "بلانكيت هودي فرو رمادي مبرقش مطبوع عليه فيونكات سوداء بجيب أمامي" },
  { id: "bm-winter-blanket-007", name: "بلانكيت بيج ببقع بني", category: "wearable-blankets", image: "/images/blanket/image_5_without_price.jpg", imageAlt: "بلانكيت هودي فرو بيج واسع مطبوع عليه بقع بني كبيرة بجيب أمامي وكابشون" },
  { id: "bm-winter-blanket-008", name: "بلانكيت قطيفة بكابشون · بني شوكولاتة", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-brown.jpg", imageAlt: "بلانكيت قطيفة واسع بلون بني شوكولاتة بكابشون يُلبس فوق الملابس" },
  { id: "bm-winter-blanket-009", name: "بلانكيت قطيفة بكابشون · رمادي", category: "wearable-blankets", image: "/images/blanket/velvet-hooded-blanket-gray.jpg", imageAlt: "بلانكيت قطيفة واسع رمادي غامق بكابشون يُلبس فوق الملابس" },
  { id: "bm-winter-blanket-010", name: "بلانكيت هودي زيبرا أسود وأبيض", category: "wearable-blankets", image: "/images/blanket/zebra-hoodie-blanket.jpg", imageAlt: "بلانكيت هودي فرو واسع بخطوط زيبرا سوداء وبيضاء بجيب أمامي كبير وكابشون" },
];

// Sections taken off the store (their products stay in the catalog for past orders, stock and finance).
export const closedCategories: readonly CatalogCategory[] = ["abayas"];

/** On the store and orderable: not hidden, and its section is open. */
export function isOnStore(product: CatalogProduct) {
  return !product.hidden && !closedCategories.includes(product.category);
}

export const visibleCatalog: CatalogProduct[] = catalog.filter(isOnStore);

// ── Products added from the admin (stored in Redis) ──
// They are inserted into the same `catalog` / `visibleCatalog` arrays every module already uses,
// so the store, cart, orders and dashboards see them without special cases.
const BUILT_IN_COUNT = catalog.length;
const builtInIds = new Set(catalog.map((product) => product.id));

export function isBuiltInProduct(id: string) {
  return builtInIds.has(id);
}

// ── Sold out (stored in Redis) ──
// A sold-out product stays on the store with a "نفدت الكمية" label but cannot be added or ordered.
// Two sources: the admin's "نفذ" switch, and the inventory (a tracked product whose stock reached 0).
const soldOutIds = new Set<string>();
const autoSoldOutIds = new Set<string>();

export function setSoldOut(ids: readonly string[], autoIds: readonly string[] = []) {
  soldOutIds.clear();
  for (const id of ids) soldOutIds.add(id);
  autoSoldOutIds.clear();
  for (const id of autoIds) autoSoldOutIds.add(id);
}

export function isSoldOut(id: string) {
  return soldOutIds.has(id) || autoSoldOutIds.has(id);
}

/** Marked "نفذ" by the admin's switch. */
export function isManualSoldOut(id: string) {
  return soldOutIds.has(id);
}

/** Out because the inventory reached 0 (comes back by itself when stock is added). */
export function isAutoSoldOut(id: string) {
  return autoSoldOutIds.has(id);
}

// ── Big Size (picked from the admin, stored in Redis): also shown together in their own store section ──
const bigSizeIds = new Set<string>();

export function setBigSize(ids: readonly string[]) {
  bigSizeIds.clear();
  for (const id of ids) bigSizeIds.add(id);
}

export function isBigSize(id: string) {
  return bigSizeIds.has(id);
}

// ── Store numbers from the inventory: sold so far, left, best seller (stored in Redis, see lib/stock-sync.ts) ──
export type StoreStat = { sold: number; left: number | null; best?: boolean };
const productStatsById = new Map<string, StoreStat>();

export function setProductStats(stats: Record<string, StoreStat>) {
  productStatsById.clear();
  for (const [id, stat] of Object.entries(stats)) productStatsById.set(id, stat);
}

export function statOf(id: string): StoreStat | undefined {
  return productStatsById.get(id);
}

/** Replaces the admin-added products (idempotent; called by the server and on each store page). */
export function setCustomProducts(products: readonly CatalogProduct[]) {
  const valid = products.filter((product) => !builtInIds.has(product.id) && product.category in categoryInfo);
  catalog.splice(BUILT_IN_COUNT, catalog.length - BUILT_IN_COUNT, ...valid);
  visibleCatalog.splice(0, visibleCatalog.length, ...catalog.filter(isOnStore));
}

// ── Edits of built-in products from the admin (stored in Redis): name, description, size, hidden ──
// The code's version is kept, so an edit can be undone and a removed edit brings the original back.
export type ProductEdit = { name?: string; imageAlt?: string; maxWeightKg?: number | null; hidden?: boolean };
const originals = catalog.slice(0, BUILT_IN_COUNT).map((product) => ({ ...product }));
const editedIds = new Set<string>();

/** The product as written in the code (built-in products only). */
export function originalProduct(id: string) {
  return originals.find((product) => product.id === id);
}

export function isEditedProduct(id: string) {
  return editedIds.has(id);
}

export function applyProductEdit(product: CatalogProduct, edit: ProductEdit | undefined): CatalogProduct {
  if (!edit) return product;
  const next: CatalogProduct = { ...product };
  if (edit.name) next.name = edit.name;
  if (edit.imageAlt) next.imageAlt = edit.imageAlt;
  if (edit.maxWeightKg === null) delete next.maxWeightKg;
  else if (typeof edit.maxWeightKg === "number") next.maxWeightKg = edit.maxWeightKg;
  if (edit.hidden === true) next.hidden = true;
  else if (edit.hidden === false) delete next.hidden;
  return next;
}

/** Replaces the saved edits (idempotent; called by the server and on each store page). */
export function setProductEdits(edits: Readonly<Record<string, ProductEdit>>) {
  editedIds.clear();
  originals.forEach((original, index) => {
    const edit = edits[original.id];
    if (edit) editedIds.add(original.id);
    catalog[index] = applyProductEdit(original, edit);
  });
  visibleCatalog.splice(0, visibleCatalog.length, ...catalog.filter(isOnStore));
}

export function findProduct(id: string) {
  return catalog.find((product) => product.id === id);
}

// ── Prices changed from the admin (stored in Redis) ──
// A built-in product's selling price can be changed without editing code. Offer-only products
// (no single-piece price) stay offer-only.
const priceOverrides = new Map<string, number>();

export function setPriceOverrides(prices: Readonly<Record<string, number>>) {
  priceOverrides.clear();
  for (const [id, price] of Object.entries(prices)) if (Number.isFinite(price) && price > 0) priceOverrides.set(id, price);
}

// ── Pajama price by size: the small ones (One Size up to 70 or 75 kg) are 285 "بدل 320";
// the rest 300 "بدل 350". The size is the product's current one (it can be changed from the admin). ──
export const SMALL_PAJAMA_KG: readonly number[] = [70, 75];
export const SMALL_PAJAMA_PRICE = 285;

export function isSmallPajama(product: CatalogProduct) {
  return product.category === "winter-pajamas" && product.maxWeightKg !== undefined && SMALL_PAJAMA_KG.includes(product.maxWeightKg);
}

/** "بدل كذا" when neither the product nor the admin sets one. */
const categoryWasPrices: Partial<Record<CatalogCategory, number>> = {
  "winter-pajamas": 350,
  "wearable-blankets": 400,
};

/** The price before the discount written in the code (product, size or category), before any admin change. */
export function baseWasPriceOf(product: CatalogProduct) {
  if (product.wasPrice !== undefined) return product.wasPrice;
  if (product.price !== undefined) return undefined;
  return isSmallPajama(product) ? 320 : categoryWasPrices[product.category];
}

// ── Prices by time (landingPromotion.priceSteps): each step holds until its `until`, then the next one starts —
// the offer's price and how much is added to every single piece. Checked on the server (orders) and in the browser. ──
export type PriceStep = { until: string | null; offer: number; pieceRise: number };

// The clock used for prices (tests pin it, so they do not depend on the time they run).
let priceClock = () => Date.now();
export function setPriceClock(clock: (() => number) | null) {
  priceClock = clock ?? (() => Date.now());
}

function stepIndexAt(now: number) {
  const steps = landingPromotion.priceSteps;
  const index = steps.findIndex((step) => step.until === null || now < Date.parse(step.until));
  return index === -1 ? steps.length - 1 : index;
}

/** The price step in force now. */
export function priceStepAt(now = priceClock()): PriceStep {
  return landingPromotion.priceSteps[stepIndexAt(now)];
}

/** True once the first deadline has passed. */
export function isPromoOver(now = priceClock()) {
  return stepIndexAt(now) > 0;
}

/** The next price change (null when there is none): when, and whether the offer / single pieces change then. */
export function nextPriceChange(now = Date.now()) {
  const steps = landingPromotion.priceSteps;
  const index = stepIndexAt(now);
  const step = steps[index];
  const next = steps[index + 1];
  if (!step.until || !next) return null;
  return { at: Date.parse(step.until), offerChanges: next.offer !== step.offer, piecesChange: next.pieceRise !== step.pieceRise };
}

/** The winter offer's price now. */
export function offerPrice(now = priceClock()) {
  return priceStepAt(now).offer;
}

/** The price written in the code (or saved with an added product), before any admin change. */
export function basePriceOf(product: CatalogProduct) {
  if (product.price !== undefined) return product.price;
  return isSmallPajama(product) ? SMALL_PAJAMA_PRICE : categoryPrices[product.category];
}

/** The price set for the product (code or admin), without the rise after the countdown — what the admin edits. */
export function listPriceOf(product: CatalogProduct) {
  const base = basePriceOf(product);
  return base === null ? null : priceOverrides.get(product.id) ?? base;
}

/** What a customer pays for one piece now (the listed price, plus the rise once the countdown is over). */
export function priceOf(product: CatalogProduct, now = priceClock()) {
  const listed = listPriceOf(product);
  return listed === null ? null : listed + priceStepAt(now).pieceRise;
}

// ── "بدل كذا": price before the discount (in the code, or set from the admin and stored in Redis) ──
// A saved 0 means the admin removed the discount written in the code.
const wasPrices = new Map<string, number>();

export function setWasPrices(prices: Readonly<Record<string, number>>) {
  wasPrices.clear();
  for (const [id, price] of Object.entries(prices)) if (Number.isFinite(price) && price >= 0) wasPrices.set(id, price);
}

/** The price before the discount, shown struck through — only while it is higher than today's price. */
export function wasPriceOf(product: CatalogProduct) {
  const price = priceOf(product);
  const was = wasPrices.get(product.id) ?? baseWasPriceOf(product);
  return price !== null && was !== undefined && was > price ? was : null;
}

/** Discount in whole percent (e.g. 20 for 250 instead of 315), or null. */
export function discountPercentOf(product: CatalogProduct) {
  const was = wasPriceOf(product);
  const price = priceOf(product);
  return was === null || price === null ? null : Math.round(((was - price) / was) * 100);
}

/** Lowest single-piece price among the visible products of a category. */
export function startingPriceOf(category: CatalogCategory) {
  const prices = productsIn(category).map(priceOf).filter((price): price is number => price !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Available pieces first, sold-out ones at the end (each group keeps the catalog order). */
export function availableFirst<T extends { id: string }>(products: T[]): T[] {
  return [...products.filter((product) => !isSoldOut(product.id)), ...products.filter((product) => isSoldOut(product.id))];
}

export function productsIn(category: CatalogCategory) {
  return availableFirst(visibleCatalog.filter((product) => product.category === category));
}

export const landingPromotion = {
  currency: "EGP",
  durationDays: 3,
  /**
   * Prices by time (Cairo): each step holds until `until`, then the next starts. The site counts down to
   * the next change (the offer timer when the offer changes, a timer on each product when pieces change).
   */
  priceSteps: [
    { until: "2026-11-20T17:00:00+02:00", offer: 1100, pieceRise: 0 },
    { until: "2026-11-21T00:00:00+02:00", offer: 1200, pieceRise: 20 },
    { until: null, offer: 1300, pieceRise: 20 },
  ] satisfies PriceStep[] as PriceStep[],
  /**
   * Every offer package. `offer` groups them: "winter" (عرض الشتاء, price from priceSteps) and "christmas"
   * (عرض الكريسماس, its own fixed `price`). Labels must not contain one another (orders are matched by label).
   */
  options: [
    {
      id: "four-pajamas",
      offer: "winter",
      label: "٤ بيجامات شتوية",
      description: "اختاري ٤ موديلات مختلفة من البيجامات",
      pajamaCount: 4,
      wearableBlanketCount: 0,
    },
    {
      id: "three-pajamas-and-blanket",
      offer: "winter",
      label: "٣ بيجامات + بلانكيت",
      description: "٣ بيجامات شتوية + بلانكيت يُلبس",
      pajamaCount: 3,
      wearableBlanketCount: 1,
    },
    {
      id: "christmas-three-pajamas",
      offer: "christmas",
      label: "٣ بيجامات كريسماس",
      description: "اختاري ٣ موديلات مختلفة من البيجامات",
      pajamaCount: 3,
      wearableBlanketCount: 0,
      price: 1000,
    },
  ] as const,
};

export type LandingPromotionOption = (typeof landingPromotion.options)[number];
export type LandingPromotionOptionId = LandingPromotionOption["id"];
export type OfferKind = LandingPromotionOption["offer"];

export const OFFER_TITLES: Record<OfferKind, string> = { winter: "عرض الشتاء", christmas: "عرض الكريسماس" };
/** Where each offer sits on the home page. */
export const OFFER_ANCHORS: Record<OfferKind, string> = { winter: "offer", christmas: "christmas" };

/** The packages of one offer (e.g. the two winter packages). */
export function offerOptions(kind: OfferKind): LandingPromotionOption[] {
  return landingPromotion.options.filter((option) => option.offer === kind);
}

/** What a package costs now: its own fixed price, else the winter offer price of the moment. */
export function optionPrice(option: LandingPromotionOption, now = priceClock()) {
  return "price" in option ? option.price : offerPrice(now);
}

/** "عرض الكريسماس: ٣ بيجامات كريسماس" — how the package is named in orders and messages. */
export function optionName(option: LandingPromotionOption) {
  return `${OFFER_TITLES[option.offer]}: ${option.label}`;
}

/** Pieces in an order's offer, from the offer name it carries (winter: 4, christmas: 3). */
export function offerPieceCount(offerName: string) {
  const option = landingPromotion.options.find((item) => offerName.includes(item.label)) ?? landingPromotion.options[0];
  return option.pajamaCount + option.wearableBlanketCount;
}

// ── Offer rule (never shown to customers): an offer can hold only one pajama whose factory price is 220.
// Once one is picked, the other ones disappear from the offer's choices. The IDs come from the factory
// prices (finance:costs) on the server; the prices themselves never reach the browser.
export const OFFER_LIMITED_COST = 220;
export const OFFER_LIMITED_MAX = 1;
const offerLimitedIds = new Set<string>();

export function setOfferLimited(ids: readonly string[]) {
  offerLimitedIds.clear();
  for (const id of ids) offerLimitedIds.add(id);
}

/** A pajama of the "one per offer" group. */
export function isOfferLimited(product: CatalogProduct | undefined) {
  return product !== undefined && product.category === "winter-pajamas" && offerLimitedIds.has(product.id);
}

/** Product IDs whose factory price is 220, from the stored factory prices. */
export function offerLimitedFromCosts(costs: readonly { productId?: unknown; cost?: unknown }[]) {
  return costs.filter((item) => typeof item.productId === "string" && item.cost === OFFER_LIMITED_COST).map((item) => item.productId as string).toSorted();
}

// ── Offer rule (never shown to customers): a piece whose factory price is 270 or more is not offered in the
// winter offer at all (sold singly only). IDs from the factory prices, like the rule above. ──
export const OFFER_EXCLUDED_MIN_COST = 270;
const offerExcludedIds = new Set<string>();

export function setOfferExcluded(ids: readonly string[]) {
  offerExcludedIds.clear();
  for (const id of ids) offerExcludedIds.add(id);
}

/** A piece that can't be picked in the winter offer. */
export function isOfferExcluded(product: CatalogProduct | undefined) {
  return product !== undefined && offerExcludedIds.has(product.id);
}

/** Product IDs whose factory price is 270 or more. */
export function offerExcludedFromCosts(costs: readonly { productId?: unknown; cost?: unknown }[]) {
  return costs.filter((item) => typeof item.productId === "string" && typeof item.cost === "number" && item.cost >= OFFER_EXCLUDED_MIN_COST).map((item) => item.productId as string).toSorted();
}

// ── Offer rule for عرض الكريسماس (never shown to customers): at most one pajama whose factory price is above
// 190; the others must be 190 or less. IDs from the factory prices, like the rules above. ──
export const CHRISTMAS_LIMITED_ABOVE_COST = 190;
const christmasLimitedIds = new Set<string>();

export function setChristmasLimited(ids: readonly string[]) {
  christmasLimitedIds.clear();
  for (const id of ids) christmasLimitedIds.add(id);
}

/** Product IDs whose factory price is above 190. */
export function christmasLimitedFromCosts(costs: readonly { productId?: unknown; cost?: unknown }[]) {
  return costs.filter((item) => typeof item.productId === "string" && typeof item.cost === "number" && item.cost > CHRISTMAS_LIMITED_ABOVE_COST).map((item) => item.productId as string).toSorted();
}

/** A pajama of the "one per offer" group of this package's offer. */
export function isLimitedIn(option: LandingPromotionOption, product: CatalogProduct | undefined) {
  if (option.offer === "christmas") return product !== undefined && product.category === "winter-pajamas" && christmasLimitedIds.has(product.id);
  return isOfferLimited(product);
}

export function findOffer(id: string) {
  return landingPromotion.options.find((option) => option.id === id);
}
