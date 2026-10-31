export type Category = {
  label: string;
  description: string;
  image: string;
  slug: string;
};

export type Offer = {
  id: string;
  title: string;
  subtitle: string;
  price: number;
  description: string;
  cta: string;
  accent: string;
};

export type Product = {
  slug: string;
  name: string;
  category: string;
  price: number;
  originalPrice?: number;
  badge?: string;
  image: string;
  gallery: string[];
  colors: string[];
  sizes: string[];
  description: string;
  stock?: number | null;
  featured?: boolean;
};

export const announcementItems = [
  "عروض الموسم",
  "شحن لجميع المحافظات",
  "اكتشفي أحدث الموديلات",
];

export const navItems = [
  "الرئيسية",
  "المنتجات",
  "العروض",
  "البلانكيت",
  "اتصل بنا",
];

export const categories: Category[] = [
  {
    label: "بيجامات شتوي حريمي",
    description: "راحة ودفء بأقمشة ناعمة",
    image:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
    slug: "winter-pajamas",
  },
  {
    label: "ملابس حريمي",
    description: "إطلالات أنيقة لكل يوم",
    image:
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
    slug: "women-fashion",
  },
  {
    label: "روب شتوي",
    description: "استرخاء فخم في المنزل",
    image:
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    slug: "robes",
  },
  {
    label: "بلانكيت وبطاطين",
    description: "دفء بألوان مميزة",
    image:
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
    slug: "blankets",
  },
  {
    label: "ملابس أطفال",
    description: "راحة ومرح لكل أفراد العائلة",
    image:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=900&q=80",
    slug: "kids",
  },
  {
    label: "العروض والباقات",
    description: "تخفيضات موسمية مختارة",
    image:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
    slug: "offers",
  },
];

export const offers: Offer[] = [
  {
    id: "bundle-1",
    title: "عرض واحد يكفي",
    subtitle: "تكملي جهازك أو جددي دولابك",
    price: 1100,
    description: "أربعة بيجامات شتوية بسعر 1100 ج.م فقط لمدة 3 أيام.",
    cta: "اشتري العرض",
    accent: "#d9b99b",
  },
  {
    id: "bundle-2",
    title: "باقة الدفء",
    subtitle: "3 بيجامات + بطانية",
    price: 1100,
    description: "اختر مجموعة مريحة للمنزل والليل بلمسة عصرية.",
    cta: "اعرف التفاصيل",
    accent: "#8ba8bf",
  },
  {
    id: "bundle-3",
    title: "اكتملي العائلة",
    subtitle: "ملابس أطفال + بطانيات",
    price: 890,
    description: "عروض مناسبة للمنزل والرحلات الشتوية المنزلية.",
    cta: "شاهد الباقة",
    accent: "#b58a90",
  },
];

export const products: Product[] = [
  {
    slug: "pyjama-moss",
    name: "بيجاما موس",
    category: "winter-pajamas",
    price: 390,
    originalPrice: 520,
    badge: "جديد",
    image:
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#d7c7b3", "#8aa9be", "#3a4868"],
    sizes: ["S", "M", "L", "XL"],
    description: "قماش ناعم وخفيف مع لمسة دافئة مناسبة للشتاء المنزلي.",
    stock: 15,
    featured: true,
  },
  {
    slug: "soft-robe-rose",
    name: "روب روز كاكي",
    category: "robes",
    price: 540,
    originalPrice: 690,
    badge: "عرض خاص",
    image:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#d6b7a5", "#7e5d53", "#d1d7dc"],
    sizes: ["S", "M", "L", "XL"],
    description: "روب شتوي فاخر مع خياطة أنيقة وراحة لا تضاهى طوال اليوم.",
    stock: 8,
  },
  {
    slug: "mauve-blanket",
    name: "بطانية ميوفي",
    category: "blankets",
    price: 620,
    originalPrice: 780,
    badge: "الأكثر مبيعاً",
    image:
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#b38bb7", "#7b3d45", "#d0b18c"],
    sizes: ["مقاس مزدوج", "مقاس أسرة"],
    description: "بطانية مريحة بالألياف الناعمة مع ألوان شتوية أنثوية متوازنة.",
    stock: null,
  },
  {
    slug: "winter-set-navy",
    name: "طقم شتوي نافي",
    category: "winter-pajamas",
    price: 470,
    originalPrice: 610,
    badge: "جديد",
    image:
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#2f405d", "#d8c9bb", "#7f5f5f"],
    sizes: ["S", "M", "L"],
    description: "طقم فاخر لليالي الدافئة مع تفاصيل ناعمة وملمس عطرية.",
    stock: 12,
  },
  {
    slug: "kids-cozy-set",
    name: "طقم أطفال كوزي",
    category: "kids",
    price: 320,
    originalPrice: 420,
    badge: "مميز",
    image:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#8db3b9", "#d9b8ad", "#5a698c"],
    sizes: ["2-3Y", "4-5Y", "6-7Y"],
    description: "مزيج مريح وملابس يومية مريحة لأطفالك خلال فصل الشتاء.",
    stock: 20,
  },
  {
    slug: "linen-day-dress",
    name: "فستان لينر داي",
    category: "women-fashion",
    price: 460,
    originalPrice: 560,
    badge: "حصري",
    image:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#d7c2b5", "#7788a9", "#706a66"],
    sizes: ["S", "M", "L"],
    description: "إطلالة أنيقة وعملية تناسب اليوم المنزلي والسهرات الرقيقة.",
    stock: 9,
  },
  {
    slug: "camel-throw",
    name: "بطانية كاميل",
    category: "blankets",
    price: 580,
    originalPrice: 680,
    badge: "شتوية",
    image:
      "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#c9a77f", "#8b6d5f", "#b6af9b"],
    sizes: ["مقاس صغير", "مقاس كبير"],
    description: "بطانية ناعمة ومستديرة بألوان هادئة لجو دافئ ومنزلي.",
    stock: null,
  },
  {
    slug: "rose-knit-robe",
    name: "روب كنيت روز",
    category: "robes",
    price: 510,
    originalPrice: 650,
    badge: "مقترح",
    image:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
    gallery: [
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80",
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80",
    ],
    colors: ["#d9a8a0", "#b18d83", "#e7dfd8"],
    sizes: ["S", "M", "L"],
    description: "روب مطرز بنقش ناعم يضيف نضارة وأناقة لوضعية الاسترخاء.",
    stock: 11,
  },
];

export const benefits = [
  "خامات مريحة",
  "موديلات متنوعة",
  "اختيارات تناسب العائلة",
  "سهولة الطلب عبر واتساب",
];

export const testimonials = [
  {
    name: "سارة م.",
    quote: "الألوان والراحة فاقت توقعاتي، والخدمة ممتازة وسريعة جدًا.",
  },
  {
    name: "نورا ع.",
    quote: "البيجامات شتوية مريحة جدًا، والبطانيات تضيف دفئًا رائعًا في المنزل.",
  },
  {
    name: "مها س.",
    quote: "أحببت الجودة والأناقة، خاصة في الروب الشتوي والملابس العائلية.",
  },
];

// Verified, image-led content used by the landing page. Keep this separate from
// the legacy product detail data until those details can be confirmed.
export type WinterLook = {
  /** Stable internal identifier for offer selection; never shown to customers. */
  id: string;
  slug: string;
  name: string;
  category: "winter-pajamas" | "wearable-blankets";
  image: string;
  imageAlt: string;
};

export const landingCategories = [
  { slug: "all", label: "كل القطع" },
  { slug: "winter-pajamas", label: "بيجامات شتوية" },
  { slug: "wearable-blankets", label: "بلانكيت شتوي قابل للارتداء" },
] as const;

export const winterLooks: WinterLook[] = [
  {
    id: "bm-winter-blanket-001",
    slug: "black-hooded-wearable-blanket",
    name: "بلانكيت شتوي بغطاء للرأس",
    category: "wearable-blankets",
    image: "/images/black-hooded-wearable-blanket.jpg",
    imageAlt: "عارضة ترتدي بلانكيت شتوياً أسود بغطاء للرأس",
  },
  {
    id: "bm-winter-pajama-001",
    slug: "pink-gray-bear-print-pajama-set",
    name: "بيجاما بطبعة دب",
    category: "winter-pajamas",
    image: "/images/pink-gray-bear-print-pajama-set.jpg",
    imageAlt: "بيجاما بطبعة دب، بلوزة وردية وبنطال رمادي",
  },
  {
    id: "bm-winter-pajama-002",
    slug: "brown-cow-print-pajamas",
    name: "بيجاما بطبعة بقرة",
    category: "winter-pajamas",
    image: "/images/brown-cow-print-pajamas.jpg",
    imageAlt: "بيجاما بلوزتها بنية وبنطالها بطبعة بقرة",
  },
  {
    id: "bm-winter-pajama-003",
    slug: "cream-bear-print-pajamas",
    name: "بيجاما بطبعة دب باللون الكريمي",
    category: "winter-pajamas",
    image: "/images/cream-bear-print-pajamas.jpg",
    imageAlt: "عارضة ترتدي بيجاما كريمية بطبعة دب",
  },
  {
    id: "bm-winter-pajama-004",
    slug: "gray-bow-print-pajama-set",
    name: "بيجاما رمادية بطبعة فيونكات",
    category: "winter-pajamas",
    image: "/images/gray-bow-print-pajama-set.jpg",
    imageAlt: "بيجاما رمادية بطبعة فيونكات صغيرة",
  },
  {
    id: "bm-winter-pajama-005",
    slug: "pink-bow-print-pajama-set",
    name: "بيجاما وردية بطبعة فيونكات",
    category: "winter-pajamas",
    image: "/images/pink-bow-print-pajama-set.jpg",
    imageAlt: "عارضتان ترتديان بيجاما وردية بطبعة فيونكات",
  },
  {
    id: "bm-winter-pajama-006",
    slug: "blue-koala-print-pajama-set",
    name: "بيجاما زرقاء بطبعة كوالا",
    category: "winter-pajamas",
    image: "/images/blue-koala-print-pajama-set.jpg",
    imageAlt: "بيجاما زرقاء بطبعة كوالا",
  },
];

export const landingPromotion = {
  price: 1100,
  currency: "EGP",
  durationDays: 3,
  options: [
    {
      id: "four-pajamas",
      label: "اختاري ٤ قطع بيجامات شتوية",
      pajamaCount: 4,
      wearableBlanketCount: 0,
    },
    {
      id: "three-pajamas-and-blanket",
      label: "اختاري ٣ قطع بيجامات شتوية + قطعة بلانكيت شتوية قابلة للارتداء",
      pajamaCount: 3,
      wearableBlanketCount: 1,
    },
  ] as const,
};

export type LandingPromotionOptionId = (typeof landingPromotion.options)[number]["id"];
