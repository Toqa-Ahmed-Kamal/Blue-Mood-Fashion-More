"use client";

import type { ReactNode } from "react";

import { setCustomProducts, setPriceOverrides, setSoldOut, setWasPrices, type CatalogProduct } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, soldOut, prices = {}, wasPrices = {}, children }: {
  products: CatalogProduct[];
  soldOut: string[];
  prices?: Record<string, number>;
  wasPrices?: Record<string, number>;
  children: ReactNode;
}) {
  setCustomProducts(products);
  setSoldOut(soldOut);
  setPriceOverrides(prices);
  setWasPrices(wasPrices);
  return children;
}
