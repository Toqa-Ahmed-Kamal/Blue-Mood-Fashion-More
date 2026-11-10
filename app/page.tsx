import { BlueMoodHome } from "@/components/blue-mood-home";
import { CatalogSync } from "@/components/catalog-sync";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";

// Products added from the admin: cached, refreshed every minute and right after an admin change.
export const revalidate = 60;

export default async function Home() {
  const products = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products}>
      <BlueMoodHome />
    </CatalogSync>
  );
}
