"use client";

import type { ReactNode } from "react";

import { setBigSize, setCustomProducts, setOfferLimited, setPriceOverrides, setProductEdits, setProductStats, setSoldOut, setWasPrices, type CatalogProduct, type ProductEdit, type StoreStat } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, soldOut, prices = {}, wasPrices = {}, stats = {}, bigSize = [], edits = {}, offerLimited = [], children }: {
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
  return children;
}
