import { loadBundles } from "@/lib/bundles-store";
import { ensureCustomProducts } from "@/lib/custom-products-store";
import { catalog, priceOf, visibleCatalog, type CatalogProduct } from "@/lib/site-data";
import { json, requireTeam, storageError } from "@/lib/team-api";

export const runtime = "nodejs";

/** What the team page shows: its own products and bundles, and the store's products to build bundles from. */
const productView = (product: CatalogProduct) => ({
  id: product.id,
  name: product.name,
  category: product.category,
  image: product.image,
  imageAlt: product.imageAlt,
  price: priceOf(product),
  ownPrice: product.price ?? null,
  maxWeightKg: product.maxWeightKg ?? null,
  status: product.pending ? "pending" : product.hidden ? "hidden" : "live",
});

export async function GET(request: Request) {
  const auth = await requireTeam(request);
  if ("response" in auth) return auth.response;
  try {
    await ensureCustomProducts(true);
    const bundles = await loadBundles();
    const own = catalog.filter((product) => product.addedBy === "team" && !product.removed);
    // Store products (public anyway) plus the team's own ones waiting for approval, to build bundles from.
    const pickable = [...visibleCatalog, ...own.filter((product) => product.hidden)];
    return json(200, {
      success: true,
      role: auth.role,
      products: own.map(productView),
      bundles: auth.role === "owner" ? bundles : bundles.filter((bundle) => bundle.addedBy === "team"),
      catalog: pickable.map(productView),
    });
  } catch (error) {
    return storageError("data", error);
  }
}
