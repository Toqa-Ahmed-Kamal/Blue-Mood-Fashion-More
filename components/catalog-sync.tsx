"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { setBundles, type Bundle } from "@/lib/bundles";

import { landingPromotion, setBigSize, setCustomProducts, setOfferLimited, setPriceOverrides, setProductEdits, setProductStats, setSoldOut, setWasPrices, type CatalogProduct, type ProductEdit, type StoreStat } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, soldOut, prices = {}, wasPrices = {}, stats = {}, bigSize = [], edits = {}, offerLimited = [], bundles = [], children }: {
  products: CatalogProduct[];
  soldOut: string[];
  prices?: Record<string, number>;
  wasPrices?: Record<string, number>;
  /** Sold / left / best seller per product (store pages). */
  stats?: Record<string, StoreStat>;
  /** Products in the "بيج سايز" section. */
  bigSize?: string[];
  /** Built-in products' name / description / size / hidden changed from the admin. */
  edits?: Record<string, ProductEdit>;
  /** Pajamas of the "one per offer" group (IDs only). */
  offerLimited?: string[];
  /** Live bundles (عروض). */
  bundles?: Bundle[];
  children: ReactNode;
}) {
  setProductEdits(edits);
  setCustomProducts(products);
  setSoldOut(soldOut);
  setPriceOverrides(prices);
  setWasPrices(wasPrices);
  setProductStats(stats);
  setBigSize(bigSize);
  setOfferLimited(offerLimited);
  setBundles(bundles);
  usePriceRiseRefresh();
  return children;
}

/**
 * When the offer countdown ends while the page is open, prices go up (lib/site-data): the page is refreshed
 * in place (no reload, so a half-filled checkout form is kept) and every price is worked out again.
 */
function usePriceRiseRefresh() {
  const router = useRouter();
  useEffect(() => {
    const left = Date.parse(landingPromotion.endsAt) - Date.now();
    if (!(left > 0) || left > 2 ** 31 - 1) return;
    const id = window.setTimeout(() => router.refresh(), left + 1000);
    return () => window.clearTimeout(id);
  }, [router]);
}
