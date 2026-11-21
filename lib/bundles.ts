// Bundles (عروض): several products at one price, made from the admin or the team account (pure, tested).
//   fixed — the set is sold as it is (e.g. a robe + a pajama for 450).
//   pick  — the customer picks `pickCount` different pieces from the bundle's products.
// A bundle made by the team account waits for the owner's approval ("pending") before customers see it.
// In an order, a bundle's pieces become ordinary priced lines whose prices add up to the bundle price,
// so the dashboards, finance and Telegram need nothing special.
import { findProduct, isOnStore, isSoldOut, priceOf, type CatalogProduct } from "./site-data.ts";

export type BundleKind = "fixed" | "pick";
export type BundleStatus = "pending" | "live";
export type BundleAuthor = "owner" | "team";

export type Bundle = {
  id: string;
  name: string;
  /** Price of the whole bundle in EGP. */
  price: number;
  kind: BundleKind;
  /** fixed: the pieces of the set; pick: the pieces the customer can pick from. */
  productIds: string[];
  /** pick: how many pieces the customer picks; fixed: the number of pieces. */
  pickCount: number;
  status: BundleStatus;
  addedBy: BundleAuthor;
  createdAt: string;
  updatedAt: string;
};

export const BUNDLE_ID_PATTERN = /^bnd-[a-z\d]{8,30}$/;
export const MAX_BUNDLE_PRODUCTS = 40;
export const MAX_BUNDLE_PICK = 10;

export function newBundleId(now = Date.now(), random = Math.random()) {
  return `bnd-${now.toString(36)}${Math.floor(random * 36 ** 5).toString(36).padStart(5, "0")}`;
}

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

export type BundleInput = { name: string; price: number; kind: BundleKind; productIds: string[]; pickCount: number };

/** Checks a bundle from the form. Products must exist; an error message (Arabic) or the clean input. */
export function sanitizeBundleInput(raw: unknown): { input: BundleInput } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "بيانات العرض ناقصة." };
  const value = raw as Record<string, unknown>;
  const name = text(value.name, 80);
  if (name.length < 3) return { error: "اكتبي اسم العرض (٣ حروف على الأقل)." };
  const price = Number(value.price);
  if (!Number.isFinite(price) || price <= 0 || price > 100_000) return { error: "سعر العرض لازم يبقى رقم أكبر من صفر." };
  const kind: BundleKind | null = value.kind === "fixed" || value.kind === "pick" ? value.kind : null;
  if (!kind) return { error: "اختاري نوع العرض." };
  const ids = Array.isArray(value.productIds) ? [...new Set(value.productIds.filter((id): id is string => typeof id === "string"))] : [];
  if (ids.length > MAX_BUNDLE_PRODUCTS) return { error: `أقصى عدد ${MAX_BUNDLE_PRODUCTS} منتج في العرض.` };
  if (ids.some((id) => !findProduct(id))) return { error: "في منتج في العرض مش موجود." };
  if (kind === "fixed") {
    if (ids.length < 2) return { error: "الطقم الثابت محتاج منتجين على الأقل." };
    return { input: { name, price: Math.round(price), kind, productIds: ids, pickCount: ids.length } };
  }
  const pickCount = Number(value.pickCount);
  if (!Number.isInteger(pickCount) || pickCount < 1 || pickCount > MAX_BUNDLE_PICK) return { error: `عدد القطع اللي العميلة تختارها من 1 لـ ${MAX_BUNDLE_PICK}.` };
  if (ids.length <= pickCount) return { error: "اختاري منتجات أكتر من عدد القطع اللي العميلة هتختارها." };
  return { input: { name, price: Math.round(price), kind, productIds: ids, pickCount } };
}

/** A stored bundle as read back (null when malformed). */
export function parseBundle(raw: unknown): Bundle | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !BUNDLE_ID_PATTERN.test(value.id)) return null;
  if (typeof value.name !== "string" || typeof value.price !== "number" || !(value.price > 0)) return null;
  if (value.kind !== "fixed" && value.kind !== "pick") return null;
  if (!Array.isArray(value.productIds) || !value.productIds.every((id) => typeof id === "string")) return null;
  const pickCount = typeof value.pickCount === "number" && Number.isInteger(value.pickCount) && value.pickCount > 0 ? value.pickCount : value.productIds.length;
  return {
    id: value.id,
    name: value.name,
    price: value.price,
    kind: value.kind,
    productIds: value.productIds as string[],
    pickCount,
    status: value.status === "live" ? "live" : "pending",
    addedBy: value.addedBy === "owner" ? "owner" : "team",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

const orderable = (product: CatalogProduct | undefined): product is CatalogProduct => product !== undefined && isOnStore(product) && !isSoldOut(product.id);

/** The pieces a customer can get now (hidden / sold-out products left out). */
export function bundleChoices(bundle: Bundle) {
  return bundle.productIds.map(findProduct).filter(orderable);
}

/** Customers see a bundle only while it is live and can still be ordered. */
export function isBundleAvailable(bundle: Bundle) {
  if (bundle.status !== "live") return false;
  const choices = bundleChoices(bundle);
  return bundle.kind === "fixed" ? choices.length === bundle.productIds.length : choices.length >= bundle.pickCount;
}

/** Sum of the pieces' single prices (for "بدل كذا"); null when a piece has no single price. */
export function bundleSinglesTotal(products: CatalogProduct[]) {
  let total = 0;
  for (const product of products) {
    const price = priceOf(product);
    if (price === null) return null;
    total += price;
  }
  return total;
}

/**
 * Splits the bundle price over its pieces (in proportion to their single prices, or evenly when a piece has
 * none), in whole pounds that add up exactly to the bundle price.
 */
export function splitBundlePrice(price: number, products: CatalogProduct[]): number[] {
  if (products.length === 0) return [];
  const weights = products.map((product) => priceOf(product));
  const even = weights.some((weight) => weight === null || weight <= 0);
  const total = even ? products.length : weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
  const shares = products.map((_, index) => Math.floor((price * (even ? 1 : (weights[index] as number))) / total));
  shares[shares.length - 1] += price - shares.reduce((sum, share) => sum + share, 0);
  return shares;
}

// ── The bundles this server / page knows (set from Redis on the server, from the page props in the browser) ──
const bundles: Bundle[] = [];

export function setBundles(list: readonly Bundle[]) {
  bundles.splice(0, bundles.length, ...list);
}

export function findBundle(id: string) {
  return bundles.find((bundle) => bundle.id === id);
}

/** Live bundles customers can order now, newest first. */
export function availableBundles() {
  // slice().sort, not toSorted: this runs in customers' browsers, older phones included.
  return bundles.filter(isBundleAvailable).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
