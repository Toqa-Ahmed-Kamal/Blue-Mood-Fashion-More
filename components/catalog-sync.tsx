"use client";

import type { ReactNode } from "react";

import { setCustomProducts, setSoldOut, type CatalogProduct } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, soldOut, children }: { products: CatalogProduct[]; soldOut: string[]; children: ReactNode }) {
  setCustomProducts(products);
  setSoldOut(soldOut);
  return children;
}
