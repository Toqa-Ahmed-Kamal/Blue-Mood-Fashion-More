import type { Metadata } from "next";

import { CatalogSync } from "@/components/catalog-sync";
import { Checkout } from "@/components/checkout";
import { loadCustomProductsForPage } from "@/lib/custom-products-store";

export const metadata: Metadata = {
  title: "إتمام الطلب | Blue Mood",
};

export const revalidate = 60;

export default async function CheckoutPage() {
  const products = await loadCustomProductsForPage();
  return (
    <CatalogSync products={products}>
      <Checkout />
    </CatalogSync>
  );
}
