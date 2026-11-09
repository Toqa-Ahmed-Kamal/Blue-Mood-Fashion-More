import { createHash } from "node:crypto";

import type { OrderAttribution } from "@/lib/attribution";
import type { CatalogCategory } from "@/lib/site-data";

export type OrderRecordProduct = {
  modelId: string;
  name: string;
  category: CatalogCategory;
  fit: string;
  quantity: number;
  /** null for pieces included in the offer price. */
  unitPrice: number | null;
};

/** The saved copy of an order, as sent to the store's Telegram chat. */
export type OrderRecord = {
  orderId: string;
  createdAt: string;
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  offerName: string;
  products: OrderRecordProduct[];
  /** 0 when the order has no offer. */
  offerPrice: number;
  itemsTotal: number;
  subtotal: number;
  shippingCost: number | null;
  total: number | null;
  notes: string;
  /** Where the customer came from (first/last touch); null when the browser sent none. */
  attribution?: OrderAttribution | null;
};

/** Same submission UUID → same order number, so a retried request is recognisable. */
export function createStableOrderId(submissionId: string) {
  return `BM-${createHash("sha256").update(submissionId).digest("hex").slice(0, 20).toUpperCase()}`;
}
