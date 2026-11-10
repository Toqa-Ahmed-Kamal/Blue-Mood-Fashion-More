// Server-only: encrypts an order's customer details before they are stored in Redis.
//
// AES-256-GCM with ORDER_DATA_KEY (32 random bytes, base64url — `npm run admin:order-key`).
// The order ID is bound as additional authenticated data, so a sealed blob cannot be
// moved onto another order. Without the key nothing personal is stored (fails closed).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { OrderRecord } from "./order-record.ts";

const VERSION = "v1";

/** Everything the store needs to fulfil and review an order (attribution is stored separately). */
export type OrderDetails = Omit<OrderRecord, "attribution">;

function vaultKey() {
  const raw = process.env.ORDER_DATA_KEY?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64url");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function isOrderVaultConfigured() {
  return vaultKey() !== null;
}

export function orderDetailsOf(order: OrderRecord): OrderDetails {
  const details: OrderDetails & { attribution?: unknown } = { ...order };
  delete details.attribution;
  return details;
}

/** Encrypted `v1.<iv>.<tag>.<ciphertext>`, or null when ORDER_DATA_KEY is missing or invalid. */
export function sealOrderDetails(details: OrderDetails): string | null {
  const key = vaultKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(details.orderId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypts a sealed blob for `orderId`. Returns null for a wrong key, tampering or another order's blob. */
export function openOrderDetails(orderId: string, sealed: string): OrderDetails | null {
  const key = vaultKey();
  if (!key) return null;
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(orderId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    const details = JSON.parse(plain) as OrderDetails;
    return details.orderId === orderId ? details : null;
  } catch {
    return null;
  }
}
