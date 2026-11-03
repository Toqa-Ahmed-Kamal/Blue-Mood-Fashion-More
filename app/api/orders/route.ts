import { resolveCart, type CartError } from "@/lib/cart";
import {
  calculateOrderTotals,
  categoryDetailLabel,
  normalizePhoneDigits,
} from "@/lib/order-flow";
import {
  findShippingRate,
  shippingAreasFor,
  shippingGovernorates,
} from "@/lib/shipping-rates";
import {
  GoogleAppsScriptError,
  createStableOrderId,
  createGoogleAppsScriptPayload,
  postOrderToGoogleAppsScript,
  type GoogleAppsScriptProduct,
} from "@/lib/google-apps-script";
import {
  TelegramError,
  buildSheetFailureAlert,
  buildTelegramOrderMessage,
  isValidTelegramBotToken,
  sendTelegramMessage,
} from "@/lib/telegram";

export const runtime = "nodejs";

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const MAX_BODY_LENGTH = 20_000;

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

function getAppsScriptFailure(error: unknown) {
  if (!(error instanceof GoogleAppsScriptError)) {
    return {
      code: "GOOGLE_SCRIPT_NETWORK_FAILURE",
      httpStatus: undefined,
      message: "تعذر الاتصال بخدمة تسجيل الطلبات. تحققي من الإنترنت وإعدادات الخدمة ثم أعيدي المحاولة بنفس الطلب.",
    };
  }

  switch (error.code) {
    case "AUTH_ACCESS_REJECTED":
      return {
        code: "GOOGLE_SCRIPT_ACCESS_REJECTED",
        httpStatus: error.httpStatus,
        message: "رفض Google الوصول إلى Web App. راجعي إعداد Who has access في النشر، ثم انشري إصدارًا جديدًا من Apps Script.",
      };
    case "AUTH_SECRET_REJECTED":
      return {
        code: "GOOGLE_SCRIPT_SECRET_REJECTED",
        httpStatus: error.httpStatus,
        message: "رفض Apps Script قيمة السر. قارني قيمة BLUE_MOOD_GOOGLE_SCRIPT_SECRET مع SECRET_KEY حرفيًا، دون مشاركة أي منهما.",
      };
    case "TIMEOUT":
      return {
        code: "GOOGLE_SCRIPT_TIMEOUT",
        httpStatus: error.httpStatus,
        message: "انتهت مهلة انتظار Google Apps Script؛ لم يصلنا تأكيد الحفظ. أعيدي المحاولة بنفس الطلب حتى لا يتغير رقم الطلب.",
      };
    case "NETWORK_FAILURE":
      return {
        code: "GOOGLE_SCRIPT_NETWORK_FAILURE",
        httpStatus: error.httpStatus,
        message: "تعذر الوصول إلى Google Apps Script. تحققي من الاتصال وإعداد رابط Web App ثم أعيدي المحاولة.",
      };
    case "NON_JSON_RESPONSE":
      return {
        code: "GOOGLE_SCRIPT_NON_JSON_RESPONSE",
        httpStatus: error.httpStatus,
        message: "وصل رد من Apps Script بصيغة غير متوقعة؛ لم نعتبر الطلب محفوظًا. يجب أن يعيد doPost JSON يؤكد النجاح.",
      };
    case "SCRIPT_HANDLER_MISSING":
      return {
        code: "GOOGLE_SCRIPT_HANDLER_MISSING",
        httpStatus: error.httpStatus,
        message: "رابط النشر لا يصل إلى دالة doPost في Apps Script. راجعي اسم الدالة وإصدار Web App المنشور.",
      };
    case "UNCONFIRMED_RESPONSE":
      return {
        code: "GOOGLE_SCRIPT_UNCONFIRMED_RESPONSE",
        httpStatus: error.httpStatus,
        message: "لم يتضمن رد Apps Script تأكيدًا واضحًا للحفظ. لم نفتح واتساب؛ يلزم أن يعيد السكربت success:true أو status:success.",
      };
    case "ORDER_ID_MISMATCH":
      return {
        code: "GOOGLE_SCRIPT_ORDER_ID_MISMATCH",
        httpStatus: error.httpStatus,
        message: "أعاد Apps Script رقم طلب مختلفًا؛ لم نعتبر التسجيل مؤكدًا. راجعي رد doPost قبل إعادة المحاولة.",
      };
    case "SCRIPT_REJECTED":
      return {
        code: "GOOGLE_SCRIPT_REJECTED",
        httpStatus: error.httpStatus,
        message: "رفض Apps Script تسجيل الطلب. راجعي إعدادات السكربت والحقول المطلوبة ثم أعيدي المحاولة بنفس الطلب.",
      };
    case "HTTP_ERROR":
      return {
        code: "GOOGLE_SCRIPT_HTTP_ERROR",
        httpStatus: error.httpStatus,
        message: `أعادت خدمة Google Apps Script حالة HTTP ${error.httpStatus ?? "غير معروفة"}؛ لم نؤكد الحفظ.`,
      };
    case "RESPONSE_READ_FAILED":
      return {
        code: "GOOGLE_SCRIPT_RESPONSE_READ_FAILED",
        httpStatus: error.httpStatus,
        message: "تعذر قراءة تأكيد Google Apps Script؛ حالة الحفظ غير مؤكدة. أعيدي المحاولة بنفس الطلب.",
      };
  }
}

function getTelegramFailure(error: unknown) {
  const code = error instanceof TelegramError ? error.code : "NETWORK_FAILURE";
  return {
    code: `TELEGRAM_${code}`,
    httpStatus: error instanceof TelegramError ? error.httpStatus : undefined,
    message: code === "TIMEOUT"
      ? "انتهت مهلة انتظار تيليجرام ولم يصلنا تأكيد الحفظ. أعيدي المحاولة بنفس الطلب حتى لا يتغير رقم الطلب."
      : "تعذر تسجيل الطلب. أعيدي المحاولة بنفس الطلب بعد قليل.",
  };
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
  if (!shippingGovernorates.includes(customer.governorate as (typeof shippingGovernorates)[number])) {
    return { message: "اختاري محافظة متاحة من القائمة." };
  }
  if (!shippingAreasFor(customer.governorate).includes(customer.area)) {
    return { message: "اختاري المنطقة من القائمة المتاحة." };
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

function getGoogleScriptConfig() {
  const scriptUrl = process.env.BLUE_MOOD_GOOGLE_SCRIPT_URL;
  const secret = process.env.BLUE_MOOD_GOOGLE_SCRIPT_SECRET;
  if (!scriptUrl || !secret) return null;

  try {
    const parsedUrl = new URL(scriptUrl);
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "script.google.com") return null;
    return { scriptUrl: parsedUrl.toString(), secret };
  } catch {
    return null;
  }
}

function getTelegramConfig() {
  const botToken = process.env.BLUE_MOOD_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.BLUE_MOOD_TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId || !isValidTelegramBotToken(botToken)) return null;
  if (!/^-?\d+$/.test(chatId) && !/^@\w{5,}$/.test(chatId)) return null;
  return { botToken, chatId };
}

export async function POST(request: Request) {
  const googleConfig = getGoogleScriptConfig();
  const telegramConfig = getTelegramConfig();
  if (!googleConfig && !telegramConfig) {
    return errorResponse(
      503,
      "ORDER_SERVICE_NOT_CONFIGURED",
      "خدمة تسجيل الطلبات غير مكتملة الإعداد. أضيفي إعدادات Apps Script أو تيليجرام إلى .env.local ثم أعيدي تشغيل المشروع.",
    );
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
  // when an ambiguous request is retried. Apps Script should deduplicate by ID.
  const orderId = createStableOrderId(body.submissionId);
  const createdAt = new Date().toISOString();
  const productRows: GoogleAppsScriptProduct[] = [
    ...(cart.offer?.products ?? []).map((product) => ({
      modelId: product.id,
      name: product.name,
      category: product.category,
      fit: categoryDetailLabel(product.category),
      quantity: 1,
      unitPrice: null,
    })),
    ...cart.items.map((line) => ({
      modelId: line.product.id,
      name: line.product.name,
      category: line.product.category,
      fit: categoryDetailLabel(line.product.category),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  ];
  const shippingNote = shippingCost === null
    ? "تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ."
    : "سعر الشحن مبدئي وقابل للتعديل. الإجمالي تقديري.";
  const notes = [customer.notes, shippingNote].filter(Boolean).join("\n");

  const orderFields = {
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
  };

  // The sheet and Telegram are independent records: the order counts as saved
  // when either one confirms, so a single outage never blocks the WhatsApp step.
  const [googleResult, telegramResult] = await Promise.allSettled([
    googleConfig
      ? postOrderToGoogleAppsScript(googleConfig.scriptUrl, createGoogleAppsScriptPayload(orderFields, googleConfig.secret))
      : null,
    telegramConfig
      ? sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, buildTelegramOrderMessage(orderFields))
      : null,
  ]);

  const googleFailure = googleConfig && googleResult.status === "rejected"
    ? getAppsScriptFailure(googleResult.reason)
    : null;
  const telegramFailure = telegramConfig && telegramResult.status === "rejected"
    ? getTelegramFailure(telegramResult.reason)
    : null;
  const savedToGoogle = googleConfig !== null && googleFailure === null;
  const savedToTelegram = telegramConfig !== null && telegramFailure === null;

  for (const failure of [googleFailure, telegramFailure]) {
    if (failure) {
      console.error("[orders] order channel failed", {
        orderId,
        code: failure.code,
        httpStatus: failure.httpStatus,
      });
    }
  }

  if (!savedToGoogle && !savedToTelegram) {
    const failure = googleFailure ?? telegramFailure;
    return errorResponse(
      502,
      failure?.code ?? "ORDER_NOT_SAVED",
      failure?.message ?? "تعذر تسجيل الطلب. أعيدي المحاولة بنفس الطلب.",
    );
  }

  if (googleFailure && savedToTelegram && telegramConfig) {
    await sendTelegramMessage(
      telegramConfig.botToken,
      telegramConfig.chatId,
      buildSheetFailureAlert(orderId, googleFailure.code),
    ).catch(() => {
      console.error("[orders] sheet failure alert was not delivered", { orderId });
    });
  }

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
