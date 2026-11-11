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

  const { products, soldOut } = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products} soldOut={soldOut}>
      <OfferBuilder initialOfferId={offer.id} />
    </CatalogSync>
  );
}
