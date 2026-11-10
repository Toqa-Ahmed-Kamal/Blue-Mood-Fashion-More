"use client";

import type { ReactNode } from "react";

import { setCustomProducts, type CatalogProduct } from "@/lib/site-data";

/**
 * Adds the products created in the admin to the catalog before the page renders (server render
 * and browser alike), so every component that reads the catalog sees them. Renders its children.
 */
export function CatalogSync({ products, children }: { products: CatalogProduct[]; children: ReactNode }) {
  setCustomProducts(products);
  return children;
}
