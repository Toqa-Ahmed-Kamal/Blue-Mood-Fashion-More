// Reads a Telegram chat export (HTML) straight from disk and prints the pieces per product and size,
// counted once per order ID — to cross-check the dashboard's factory summary. Runs only on this
// computer; prints no customer data and stores nothing.
//
//   npm run orders:check-export                    (reads app/messages.html)
//   npm run orders:check-export -- path/to/export.html [more.html …]
//
// The export holds customer names, phones and addresses: it is git-ignored and must never be
// committed (the repository is public). Import it through the admin "الأوردرات القديمة" tab.
import { existsSync, readFileSync } from "node:fs";

import { factorySize, parseTelegramExport } from "../lib/old-orders.ts";
import { NO_SIZE } from "../lib/quantity-summary.ts";
import { findProduct } from "../lib/site-data.ts";

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["app/messages.html"];
const orders = new Map();
let warnings = 0;
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  for (const { order, warnings: list } of parseTelegramExport(readFileSync(file, "utf8"))) {
    if (orders.has(order.orderId)) continue; // the same order in two files counts once
    orders.set(order.orderId, order);
    warnings += list.length;
  }
}

const products = new Map();
for (const order of orders.values()) {
  for (const line of order.products) {
    const product = findProduct(line.modelId);
    const key = product?.id ?? `name:${line.name}`;
    const row = products.get(key) ?? { id: product?.id ?? "(not in catalog)", name: product?.name ?? line.name, photo: product?.image ?? line.image ?? "MISSING", pieces: 0, orders: new Set(), sizes: new Map() };
    const size = [factorySize(line.modelId, line.size), line.color].filter(Boolean).join(" · ") || NO_SIZE;
    row.pieces += line.quantity;
    row.orders.add(order.orderId);
    row.sizes.set(size, (row.sizes.get(size) ?? 0) + line.quantity);
    products.set(key, row);
  }
}

const rows = [...products.values()].sort((a, b) => b.pieces - a.pieces);
console.log(`Files: ${files.join(", ")}`);
console.log(`Orders: ${orders.size} (each order ID once) · parsing warnings: ${warnings}`);
console.log(`Note: these are all orders in the file, before any status (cancelled orders are excluded only in the dashboard).\n`);
for (const row of rows) {
  const sizes = [...row.sizes].map(([size, count]) => `${size}: ${count}`).join(" | ");
  console.log(`${String(row.pieces).padStart(4)}  ${row.name}  [${row.id}]  · ${row.orders.size} orders · ${sizes}${row.photo === "MISSING" ? " · NO PHOTO" : ""}`);
}
console.log(`\nTotal pieces: ${rows.reduce((sum, row) => sum + row.pieces, 0)} across ${rows.length} products`);
