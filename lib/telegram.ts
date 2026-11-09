import { formatAttributionLines } from "./attribution.ts";
import type { OrderRecord } from "@/lib/order-record";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4096;

export type TelegramFailureCode =
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "NON_JSON_RESPONSE"
  | "TOKEN_REJECTED"
  | "CHAT_REJECTED"
  | "RATE_LIMITED"
  | "REJECTED";

export class TelegramError extends Error {
  readonly code: TelegramFailureCode;
  readonly httpStatus?: number;

  constructor(code: TelegramFailureCode, httpStatus?: number) {
    super(code);
    this.name = "TelegramError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isValidTelegramBotToken(token: string) {
  return /^\d+:[\w-]{20,}$/.test(token);
}

function formatPrice(value: number | null) {
  return value === null ? "غير مؤكد" : `${value} ج.م`;
}

function formatCairoTime(isoDate: string) {
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      timeZone: "Africa/Cairo",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(isoDate));
  } catch {
    return isoDate;
  }
}

function fitToTelegramLimit(text: string) {
  return text.length <= TELEGRAM_MESSAGE_LIMIT ? text : `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 1)}…`;
}

export function buildTelegramOrderMessage(order: OrderRecord) {
  const lines = [
    "🛍️ طلب جديد — Blue Mood",
    `رقم الطلب: ${order.orderId}`,
    `الوقت: ${formatCairoTime(order.createdAt)}`,
    "",
    `👤 ${order.customerName}`,
    `📞 ${order.phone}`,
    ...(order.alternatePhone ? [`📞 بديل: ${order.alternatePhone}`] : []),
    `📍 ${order.governorate} — ${order.area}`,
    `🏠 ${order.address}`,
    "",
    `العرض: ${order.offerName}`,
    ...order.products.map((product, index) => {
      const quantity = product.quantity > 1 ? ` × ${product.quantity}` : "";
      const price = product.unitPrice === null ? "" : ` — ${formatPrice(product.unitPrice * product.quantity)}`;
      const link = product.link ? `\n   🔗 ${product.link}` : "";
      return `${index + 1}. ${product.name}${quantity} (${product.modelId}) — ${product.fit}${price}${link}`;
    }),
    "",
    ...(order.offerPrice > 0 ? [`سعر العرض: ${formatPrice(order.offerPrice)}`] : []),
    ...(order.itemsTotal > 0 ? [`القطع المنفردة: ${formatPrice(order.itemsTotal)}`] : []),
    `الشحن: ${formatPrice(order.shippingCost)}`,
    `الإجمالي: ${formatPrice(order.total)}`,
    ...(order.notes ? ["", `📝 ${order.notes}`] : []),
    "",
    ...formatAttributionLines(order.attribution),
  ];

  return fitToTelegramLimit(lines.join("\n"));
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(`${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: fitToTelegramLimit(text),
        link_preview_options: { is_disabled: true },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new TelegramError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_FAILURE");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TelegramError("NON_JSON_RESPONSE", response.status);
  }

  const isConfirmed = typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  if (response.ok && isConfirmed) return;

  // Telegram returns 401 for a bad token and 404 when the token path is malformed.
  if (response.status === 401 || response.status === 404) throw new TelegramError("TOKEN_REJECTED", response.status);
  // 400 "chat not found" or 403 "bot was blocked / kicked" both mean the chat ID needs attention.
  if (response.status === 400 || response.status === 403) throw new TelegramError("CHAT_REJECTED", response.status);
  if (response.status === 429) throw new TelegramError("RATE_LIMITED", response.status);
  throw new TelegramError("REJECTED", response.status);
}
