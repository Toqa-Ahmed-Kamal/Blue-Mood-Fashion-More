import { BlueMoodHome } from "@/components/blue-mood-home";
import { CatalogSync } from "@/components/catalog-sync";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";
import { loadReviewsForPage } from "@/lib/reviews-store";

// Products added from the admin: cached, refreshed every minute and right after an admin change.
export const revalidate = 60;

export default async function Home() {
  const [{ products, soldOut, prices, wasPrices, stats, bigSize, edits, offerLimited, offerExcluded, bundles }, reviews] = await Promise.all([loadCustomProductsForPage(), loadReviewsForPage()]);
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices} wasPrices={wasPrices} stats={stats} bigSize={bigSize} edits={edits} offerLimited={offerLimited} offerExcluded={offerExcluded} bundles={bundles}>
      <BlueMoodHome reviews={reviews} />
    </CatalogSync>
  );
}
