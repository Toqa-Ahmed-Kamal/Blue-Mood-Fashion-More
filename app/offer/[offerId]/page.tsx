import { notFound } from "next/navigation";

import { OfferBuilder } from "@/components/offer-builder";
import { landingPromotion } from "@/lib/site-data";

type OfferPageProps = {
  params: Promise<{ offerId: string }>;
};

export default async function OfferPage({ params }: OfferPageProps) {
  const { offerId } = await params;
  const offer = landingPromotion.options.find((item) => item.id === offerId);

  if (!offer) notFound();

  return <OfferBuilder initialOfferId={offer.id} />;
}
