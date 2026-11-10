// Generates ORDER_DATA_KEY: the key that encrypts customer details (name, phone, address)
// before orders are stored for the admin dashboard.
// Usage: npm run admin:order-key
//
// Keep it secret and never change it casually: orders saved with an old key can no longer be
// opened in the dashboard after the key changes (Telegram still has every order).
import { randomBytes } from "node:crypto";

console.log("\nAdd this Environment Variable in Vercel (Production):\n");
console.log(`ORDER_DATA_KEY=${randomBytes(32).toString("base64url")}`);
console.log("\nKeep it secret. Changing it makes already-saved customer details unreadable in the dashboard.");
