"use client";

import type { ReactNode } from "react";

import { setBigSize, setCustomProducts, setPriceOverrides, setProductStats, setSoldOut, setWasPrices, type CatalogProduct, type StoreStat } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, soldOut, prices = {}, wasPrices = {}, stats = {}, bigSize = [], children }: {
  products: CatalogProduct[];
  soldOut: string[];
  prices?: Record<string, number>;
  wasPrices?: Record<string, number>;
  /** Sold / left / best seller per product (store pages). */
  stats?: Record<string, StoreStat>;
  /** Products in the "بيج سايز" section. */
  bigSize?: string[];
  children: ReactNode;
}) {
  setCustomProducts(products);
  setSoldOut(soldOut);
  setPriceOverrides(prices);
  setWasPrices(wasPrices);
  setProductStats(stats);
  setBigSize(bigSize);
  return children;
}
