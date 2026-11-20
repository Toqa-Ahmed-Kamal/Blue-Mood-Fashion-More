import { notFound } from "next/navigation";

import { CatalogSync } from "@/components/catalog-sync";
import { OfferBuilder } from "@/components/offer-builder";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";
import { landingPromotion } from "@/lib/site-data";

type OfferPageProps = {
  params: Promise<{ offerId: string }>;
};

export default async function OfferPage({ params }: OfferPageProps) {
  const { offerId } = await params;
  const offer = landingPromotion.options.find((item) => item.id === offerId);

  if (!offer) notFound();

  const { products, soldOut, prices, wasPrices, stats, bigSize, edits, offerLimited, offerExcluded, bundles } = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices} wasPrices={wasPrices} stats={stats} bigSize={bigSize} edits={edits} offerLimited={offerLimited} offerExcluded={offerExcluded} bundles={bundles}>
      <OfferBuilder initialOfferId={offer.id} />
    </CatalogSync>
  );
}
