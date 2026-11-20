import type { Metadata } from "next";
import { connection } from "next/server";

import { CatalogSync } from "@/components/catalog-sync";
import { Checkout } from "@/components/checkout";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";

export const metadata: Metadata = {
  title: "إتمام الطلب | Blue Mood",
};

export default async function CheckoutPage() {
  // Rendered per visit (never an old copy of the page), so a bundle or product changed a moment ago is
  // known; the catalog data itself stays cached and is refreshed by the admin's changes (tag).
  await connection();
  const { products, soldOut, prices, wasPrices, stats, bigSize, edits, offerLimited, offerExcluded, bundles } = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices} wasPrices={wasPrices} stats={stats} bigSize={bigSize} edits={edits} offerLimited={offerLimited} offerExcluded={offerExcluded} bundles={bundles}>
      <Checkout />
    </CatalogSync>
  );
}
