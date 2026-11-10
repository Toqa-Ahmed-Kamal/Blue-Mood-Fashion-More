import { after } from "next/server";

import { sanitizeAttribution } from "@/lib/attribution";
import { saveOrder, toAnalyticsOrder, type OrderVisitIds } from "@/lib/analytics-store";
import { orderDetailsOf, sealOrderDetails } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";
import { resolveCart, type CartError } from "@/lib/cart";
import {
  calculateOrderTotals,
  categoryDetailLabel,
  normalizePhoneDigits,
  productLink,
} from "@/lib/order-flow";
import { createStableOrderId, type OrderRecord, type OrderRecordProduct } from "@/lib/order-record";
import {
  findShippingRate,
  isShippingGovernorate,
  isValidShippingArea,
} from "@/lib/shipping-rates";
import {
  TelegramError,
  buildTelegramOrderMessage,
  isValidTelegramBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";

export const runtime = "nodejs";

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const MAX_BODY_LENGTH = 20_000;

/** Anonymous visit IDs from the browser (optional); anything malformed is ignored. */
function readVisitIds(value: unknown): OrderVisitIds {
  const ids = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const uuid = (id: unknown) => (typeof id === "string" && UUID_PATTERN.test(id) ? id.toLowerCase() : null);
  return { sessionId: uuid(ids.sessionId), visitorId: uuid(ids.visitorId) };
}

/** Shown to customers whenever the order could not be saved; the page then offers WhatsApp directly. */
const ORDER_NOT_SAVED_MESSAGE = "معرفناش نسجل الطلب دلوقتي. ابعتيه لنا على واتساب مباشرة من الزرار اللي تحت، أو جربي تاني بعد شوية.";

type CustomerInput = {
  name: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  notes: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ success: false, error: { code, message } }, { status });
}

function readCustomer(value: unknown): CustomerInput | null {
  if (!isRecord(value)) return null;
  const requiredFields = ["name", "phone", "governorate", "area", "address"] as const;
  if (requiredFields.some((field) => typeof value[field] !== "string")) return null;

  const optionalString = (field: "alternatePhone" | "notes") => {
    const fieldValue = value[field];
    return typeof fieldValue === "string" ? fieldValue.trim() : "";
  };

  return {
    name: (value.name as string).trim(),
    phone: (value.phone as string).trim(),
    alternatePhone: optionalString("alternatePhone"),
    governorate: (value.governorate as string).trim(),
    area: (value.area as string).trim(),
    address: (value.address as string).trim(),
    notes: optionalString("notes"),
  };
}

function validateCustomer(customer: CustomerInput) {
  const phone = normalizePhoneDigits(customer.phone);
  const alternatePhone = normalizePhoneDigits(customer.alternatePhone);

  if (customer.name.length < 2 || customer.name.length > 120) {
    return { message: "راجعي الاسم بالكامل ثم أعيدي المحاولة." };
  }
  if (phone.length < 8 || phone.length > 15) {
    return { message: "راجعي رقم الموبايل؛ يجب أن يحتوي على ٨ إلى ١٥ رقمًا." };
  }
  if (customer.alternatePhone && (alternatePhone.length < 8 || alternatePhone.length > 15)) {
    return { message: "راجعي الرقم البديل أو اتركيه فارغًا لأنه اختياري." };
  }
  if (customer.address.length < 5 || customer.address.length > 500) {
    return { message: "اكتبي العنوان بالتفصيل قبل تأكيد الطلب." };
  }
  if (customer.notes.length > 500) {
    return { message: "اختصري الملاحظات إلى ٥٠٠ حرف أو أقل." };
  }
  if (!isShippingGovernorate(customer.governorate)) {
    return { message: "اختاري محافظة متاحة من القائمة." };
  }
  if (!isValidShippingArea(customer.governorate, customer.area)) {
    return { message: "راجعي المنطقة أو المدينة ثم أعيدي المحاولة." };
  }

  return { customer: { ...customer, phone, alternatePhone } };
}

const cartErrorMessages: Record<CartError, string> = {
  EMPTY: "السلة فاضية. أضيفي العرض أو قطعة واحدة على الأقل.",
  INVALID_CART: "تعذر قراءة محتوى السلة. حدّثي الصفحة وحاولي مرة أخرى.",
  INVALID_OFFER: "العرض المختار غير متاح.",
  INVALID_BUNDLE: "القطع المختارة لا تطابق العرض. راجعي عدد الموديلات وحاولي مرة أخرى.",
  INVALID_ITEM: "إحدى القطع في السلة لم تعد متاحة. راجعي السلة وحاولي مرة أخرى.",
};

function getTelegramConfig() {
  const botToken = process.env.BLUE_MOOD_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.BLUE_MOOD_TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId || !isValidTelegramBotToken(botToken)) return null;
  if (!/^-?\d+$/.test(chatId) && !/^@\w{5,}$/.test(chatId)) return null;
  return { botToken, chatId };
}

export async function POST(request: Request) {
  const telegramConfig = getTelegramConfig();
  if (!telegramConfig) {
    // Visible in the hosting logs: the deployment is missing the Telegram environment variables.
    console.error("[orders] BLUE_MOOD_TELEGRAM_BOT_TOKEN / BLUE_MOOD_TELEGRAM_CHAT_ID are missing or invalid");
    return errorResponse(503, "ORDER_SERVICE_NOT_CONFIGURED", ORDER_NOT_SAVED_MESSAGE);
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "تعذر قراءة بيانات الطلب. أعيدي المحاولة.");
  }

  if (bodyText.length > MAX_BODY_LENGTH) {
    return errorResponse(413, "REQUEST_TOO_LARGE", "بيانات الطلب أكبر من المسموح به.");
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return errorResponse(400, "INVALID_JSON", "تعذر قراءة بيانات الطلب. أعيدي المحاولة.");
  }

  if (!isRecord(body) || typeof body.submissionId !== "string" || !UUID_PATTERN.test(body.submissionId)) {
    return errorResponse(400, "INVALID_SUBMISSION_ID", "تعذر إنشاء مرجع آمن للطلب. أعيدي المحاولة.");
  }

  const cartResult = resolveCart(body.cart);
  if ("error" in cartResult) return errorResponse(400, cartResult.error, cartErrorMessages[cartResult.error]);
  const cart = cartResult.cart;

  const customerInput = readCustomer(body.customer);
  if (!customerInput) return errorResponse(400, "INVALID_CUSTOMER", "راجعي بيانات العميل المطلوبة.");
  const validation = validateCustomer(customerInput);
  if (!validation.customer) return errorResponse(400, "INVALID_CUSTOMER", validation.message ?? "راجعي بيانات العميل.");
  const customer = validation.customer;

  const rate = findShippingRate(customer.governorate, customer.area);
  if (!rate) return errorResponse(400, "INVALID_SHIPPING_AREA", "اختاري منطقة متاحة من القائمة.");
  const shippingCost = rate.fee;
  const totals = calculateOrderTotals(cart.subtotal, shippingCost);

  // A stable client submission UUID lets the server derive the same order ID
  // when an ambiguous request is retried, so duplicates are easy to spot.
  const orderId = createStableOrderId(body.submissionId);
  const createdAt = new Date().toISOString();
  const origin = new URL(request.url).origin;
  const productRows: OrderRecordProduct[] = [
    ...(cart.offer?.products ?? []).map((product) => ({
      modelId: product.id,
      name: product.name,
      category: product.category,
      fit: categoryDetailLabel(product.category, product.maxWeightKg),
      quantity: 1,
      unitPrice: null,
      link: productLink(origin, product.image),
    })),
    ...cart.items.map((line) => ({
      modelId: line.product.id,
      name: line.product.name,
      category: line.product.category,
      fit: categoryDetailLabel(line.product.category, line.product.maxWeightKg),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      link: productLink(origin, line.product.image),
    })),
  ];
  const shippingNote = shippingCost === null
    ? "تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ."
    : "سعر الشحن مبدئي وقابل للتعديل. الإجمالي تقديري.";
  const notes = [customer.notes, shippingNote].filter(Boolean).join("\n");

  const order: OrderRecord = {
    orderId,
    createdAt,
    customerName: customer.name,
    phone: customer.phone,
    alternatePhone: customer.alternatePhone,
    governorate: customer.governorate,
    area: customer.area,
    address: customer.address,
    offerName: cart.offer ? `عرض الشتاء: ${cart.offer.option.label}` : "بدون عرض — قطع منفردة",
    products: productRows,
    offerPrice: cart.offerTotal,
    itemsTotal: cart.itemsTotal,
    subtotal: cart.subtotal,
    shippingCost,
    total: totals.total,
    notes,
    // Optional and best-effort: a missing or malformed value never blocks the order.
    attribution: sanitizeAttribution(body.attribution),
  };

  try {
    await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, buildTelegramOrderMessage(order));
  } catch (error) {
    console.error("[orders] Telegram request failed", {
      orderId,
      code: error instanceof TelegramError ? error.code : "NETWORK_FAILURE",
      httpStatus: error instanceof TelegramError ? error.httpStatus : undefined,
    });
    return errorResponse(502, "ORDER_NOT_SAVED", ORDER_NOT_SAVED_MESSAGE);
  }

  // Dashboard copy, saved only after Telegram accepted the order and after the customer got her answer.
  // Best-effort: a Redis problem is logged and never affects the order.
  // Customer details are stored only encrypted; without ORDER_DATA_KEY they are not stored at all.
  const visit = readVisitIds(body.visit);
  after(async () => {
    try {
      const sealedDetails = sealOrderDetails(orderDetailsOf(order));
      if (!sealedDetails) console.warn("[analytics] ORDER_DATA_KEY missing or invalid: customer details not stored for the dashboard", { orderId });
      await saveOrder(toAnalyticsOrder(order, order.attribution ?? null), { sealedDetails, visit });
    } catch (error) {
      console.error("[analytics] order not saved to dashboard storage", {
        orderId,
        reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED",
      });
    }
  });

  return Response.json({
    success: true,
    order: {
      orderId,
      createdAt,
      subtotal: cart.subtotal,
      shippingCost,
      total: totals.total,
    },
  });
}
