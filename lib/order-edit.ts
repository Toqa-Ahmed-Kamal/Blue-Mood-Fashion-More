// Editing an order from the admin (the customer swapped a piece, changed quantity, address…). Pure, tested.
//
// The same edit applies to a site order (its stats record + encrypted details) and to an imported
// Telegram order. Products are chosen from the catalog (by ID), so names, sizes and categories stay
// right; totals are recalculated from the pieces, the offer price and the shipping.
import type { AnalyticsOrder } from "./analytics-report.ts";
import type { OldOrder, OldOrderProduct } from "./old-orders.ts";
import { categoryDetailLabel } from "./order-flow.ts";
import type { OrderRecordProduct } from "./order-record.ts";
import type { OrderDetails } from "./order-vault.ts";
import { findProduct } from "./site-data.ts";

export const MAX_EDIT_LINES = 40;

export type OrderEditLine = { modelId: string; quantity: number; unitPrice: number | null };

export type OrderEdit = {
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
  offerName: string;
  /** Price of the winter offer in this order (0 when there is none). */
  offerPrice: number;
  shippingCost: number | null;
  lines: OrderEditLine[];
};

const text = (value: unknown, limit: number) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim().slice(0, limit) : "");
const money = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? Math.round(number * 100) / 100 : undefined;
};

/** Checks an edit from the admin. Returns an Arabic error message, or the clean edit. */
export function sanitizeOrderEdit(raw: unknown): { edit: OrderEdit } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "بيانات التعديل ناقصة." };
  const value = raw as Record<string, unknown>;
  const customerName = text(value.customerName, 120);
  if (customerName.length < 2) return { error: "اكتبي اسم العميلة." };
  const phone = text(value.phone, 40);
  if (phone.replace(/\D/g, "").length < 8) return { error: "راجعي رقم الموبايل." };
  const rawLines = Array.isArray(value.lines) ? value.lines : [];
  if (rawLines.length === 0) return { error: "الأوردر لازم يبقى فيه منتج واحد على الأقل." };
  if (rawLines.length > MAX_EDIT_LINES) return { error: "عدد المنتجات كبير." };
  const lines: OrderEditLine[] = [];
  for (const item of rawLines) {
    const line = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const modelId = typeof line.modelId === "string" ? line.modelId : "";
    if (!findProduct(modelId)) return { error: "اختاري المنتج من القائمة." };
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return { error: "الكمية لازم تبقى رقم صحيح من ١ لـ ٢٠." };
    const unitPrice = money(line.unitPrice);
    if (unitPrice === undefined) return { error: "سعر القطعة لازم يبقى رقم موجب أو فاضي (ضمن العرض)." };
    lines.push({ modelId, quantity, unitPrice });
  }
  const offerPrice = money(value.offerPrice);
  const shippingCost = money(value.shippingCost);
  if (offerPrice === undefined || shippingCost === undefined) return { error: "راجعي سعر العرض والشحن." };
  return {
    edit: {
      customerName,
      phone,
      alternatePhone: text(value.alternatePhone, 40),
      governorate: text(value.governorate, 60),
      area: text(value.area, 120),
      address: text(value.address, 600),
      notes: text(value.notes, 600),
      offerName: text(value.offerName, 160),
      offerPrice: offerPrice ?? 0,
      shippingCost,
      lines,
    },
  };
}

export function editTotals(edit: Pick<OrderEdit, "offerPrice" | "shippingCost" | "lines">) {
  const itemsTotal = edit.lines.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0);
  const subtotal = edit.offerPrice + itemsTotal;
  return { itemsTotal, subtotal, total: edit.shippingCost === null ? null : subtotal + edit.shippingCost };
}

/** Product rows as an order record keeps them (name, category and size note from the catalog). */
export function editRecordProducts(edit: OrderEdit): OrderRecordProduct[] {
  return edit.lines.map((line) => {
    const product = findProduct(line.modelId)!;
    return {
      modelId: product.id,
      name: product.name,
      category: product.category,
      fit: categoryDetailLabel(product.category, product.maxWeightKg),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      link: null,
    };
  });
}

const sameLines = (a: { modelId: string; quantity: number }[], b: { modelId: string; quantity: number }[]) =>
  JSON.stringify(a.map((line) => [line.modelId, line.quantity])) === JSON.stringify(b.map((line) => [line.modelId, line.quantity]));

/** The edited site order (stats record) and its new customer details. Status, deposit and source stay as they were. */
export function applyEditToSiteOrder(order: AnalyticsOrder, details: OrderDetails | null, edit: OrderEdit, now = new Date()) {
  const products = editRecordProducts(edit);
  const totals = editTotals(edit);
  const linesChanged = !sameLines(order.products, products);
  const totalChanged = totals.total !== order.total || totals.subtotal !== order.subtotal;
  const { costSnapshot, ...rest } = order;
  const updated: AnalyticsOrder & { editedAt: string } = {
    ...rest,
    // The saved factory cost only matches the old pieces; it is taken again by the caller when needed.
    ...(linesChanged ? {} : costSnapshot ? { costSnapshot } : {}),
    governorate: edit.governorate || order.governorate,
    offerName: edit.offerName || order.offerName,
    products: products.map((product) => ({ modelId: product.modelId, category: product.category, quantity: product.quantity, fit: product.fit })),
    subtotal: totals.subtotal,
    shippingCost: edit.shippingCost,
    total: totals.total,
    // A collected amount entered for the old total no longer applies once the total changes.
    confirmedValue: totalChanged ? null : order.confirmedValue,
    editedAt: now.toISOString(),
  };
  const newDetails: OrderDetails = {
    ...(details ?? {}),
    orderId: order.orderId,
    createdAt: order.createdAt,
    customerName: edit.customerName,
    phone: edit.phone,
    alternatePhone: edit.alternatePhone,
    governorate: edit.governorate || order.governorate,
    area: edit.area,
    address: edit.address,
    offerName: edit.offerName || order.offerName,
    products,
    offerPrice: edit.offerPrice,
    itemsTotal: totals.itemsTotal,
    subtotal: totals.subtotal,
    shippingCost: edit.shippingCost,
    total: totals.total,
    notes: edit.notes,
  };
  return { order: updated, details: newDetails, linesChanged };
}

/** The edited Telegram order (status, deposit, archive and import info stay as they were). */
export function applyEditToOldOrder(order: OldOrder, edit: OrderEdit, now = new Date()): OldOrder {
  const products = editRecordProducts(edit);
  const totals = editTotals(edit);
  const lines: OldOrderProduct[] = products.map((product, index) => {
    const before = order.products[index];
    return {
      modelId: product.modelId,
      name: product.name,
      size: product.category === "winter-pajamas" ? product.fit : "",
      // A color typed in earlier stays only when the same piece is still on that line.
      color: before && before.modelId === product.modelId ? before.color : "",
      quantity: product.quantity,
      unitPrice: product.unitPrice,
    };
  });
  return {
    ...order,
    customerName: edit.customerName,
    phone: edit.phone,
    alternatePhone: edit.alternatePhone,
    governorate: edit.governorate,
    area: edit.area,
    address: edit.address,
    notes: edit.notes,
    offerName: edit.offerName || order.offerName,
    products: lines,
    offerPrice: edit.offerPrice,
    itemsTotal: totals.itemsTotal,
    shippingCost: edit.shippingCost,
    total: totals.total,
    updatedAt: now.toISOString(),
  };
}
