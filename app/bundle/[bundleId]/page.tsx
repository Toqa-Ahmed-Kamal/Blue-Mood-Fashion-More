import { CatalogSync } from "@/components/catalog-sync";
import { BundleBuilder } from "@/components/bundles";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";

type BundlePageProps = {
  params: Promise<{ bundleId: string }>;
};

export default async function BundlePage({ params }: BundlePageProps) {
  const { bundleId } = await params;
  const { products, soldOut, prices, wasPrices, stats, bigSize, edits, offerLimited, christmasLimited, offerExcluded, bundles } = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices} wasPrices={wasPrices} stats={stats} bigSize={bigSize} edits={edits} offerLimited={offerLimited} christmasLimited={christmasLimited} offerExcluded={offerExcluded} bundles={bundles}>
      <BundleBuilder bundleId={bundleId} />
    </CatalogSync>
  );
}
