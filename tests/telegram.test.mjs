import test from "node:test";
import assert from "node:assert/strict";

import {
  TelegramError,
  buildTelegramOrderMessage,
  isValidTelegramBotToken,
  sendTelegramMessage,
} from "../lib/telegram.ts";
import { createStableOrderId } from "../lib/order-record.ts";

const mockToken = "123456789:mock-token-for-unit-test-only";

const baseFields = {
  orderId: "BM-TEST-ORDER-001",
  createdAt: "2026-10-31T10:20:00.000Z",
  customerName: "اسم تجريبي",
  phone: "01000000000",
  alternatePhone: "",
  governorate: "القاهرة",
  area: "المطرية",
  address: "عنوان اختبار غير حقيقي",
  offerName: "٤ بيجامات شتوية",
  products: [
    {
      modelId: "bm-winter-pajama-001",
      name: "بيجاما بطبعة دب",
      category: "winter-pajamas",
      fit: "One Size – مقاس واحد يناسب لحد 85–90 كيلو",
      quantity: 1,
      unitPrice: null,
    },
  ],
  offerPrice: 1100,
  itemsTotal: 0,
  subtotal: 1100,
  shippingCost: 30,
  total: 1130,
  notes: "سعر الشحن مبدئي وقابل للتعديل.",
};

test("the Telegram message carries everything needed to fulfil the order", () => {
  const message = buildTelegramOrderMessage({ ...baseFields, alternatePhone: "01100000000" });

  for (const value of [
    baseFields.orderId,
    baseFields.customerName,
    baseFields.phone,
    "01100000000",
    baseFields.governorate,
    baseFields.area,
    baseFields.address,
    baseFields.offerName,
    "bm-winter-pajama-001",
    "1130 ج.م",
    baseFields.notes,
  ]) {
    assert.ok(message.includes(value), `missing ${value}`);
  }
});

test("unknown shipping is shown as unconfirmed instead of zero", () => {
  const message = buildTelegramOrderMessage({ ...baseFields, shippingCost: null, total: null });

  assert.match(message, /الشحن: غير مؤكد/);
  assert.match(message, /الإجمالي: غير مؤكد/);
});

test("very long messages are trimmed to Telegram's limit", () => {
  const message = buildTelegramOrderMessage({ ...baseFields, notes: "ن".repeat(5000) });

  assert.ok(message.length <= 4096);
});

test("a retry with the same submission ID keeps the same order number", () => {
  const submissionId = "12345678-1234-4234-8234-123456789abc";

  assert.equal(createStableOrderId(submissionId), createStableOrderId(submissionId));
  assert.notEqual(createStableOrderId(submissionId), createStableOrderId("22345678-1234-4234-8234-123456789abc"));
  assert.match(createStableOrderId(submissionId), /^BM-[A-F\d]{20}$/);
});

test("bot token shape is validated before use", () => {
  assert.equal(isValidTelegramBotToken(mockToken), true);
  assert.equal(isValidTelegramBotToken("not-a-token"), false);
  assert.equal(isValidTelegramBotToken(""), false);
});

test("sending posts to the bot sendMessage endpoint and accepts ok:true", async () => {
  let requestUrl;
  let requestOptions;

  await sendTelegramMessage(mockToken, "-1001234567890", "hello", async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  });

  assert.equal(requestUrl, `https://api.telegram.org/bot${mockToken}/sendMessage`);
  assert.equal(requestOptions.method, "POST");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    chat_id: "-1001234567890",
    text: "hello",
    link_preview_options: { is_disabled: true },
  });
});

test("HTTP 200 without ok:true is not treated as delivered", async () => {
  await assert.rejects(
    sendTelegramMessage(mockToken, "1", "hello", async () => new Response(JSON.stringify({}), { status: 200 })),
    (error) => error instanceof TelegramError && error.code === "REJECTED",
  );
});

const failureCases = [
  [401, "TOKEN_REJECTED"],
  [404, "TOKEN_REJECTED"],
  [400, "CHAT_REJECTED"],
  [403, "CHAT_REJECTED"],
  [429, "RATE_LIMITED"],
  [500, "REJECTED"],
];

for (const [status, code] of failureCases) {
  test(`Telegram HTTP ${status} is classified as ${code}`, async () => {
    await assert.rejects(
      sendTelegramMessage(mockToken, "1", "hello", async () => new Response(
        JSON.stringify({ ok: false, error_code: status, description: "mock" }),
        { status },
      )),
      (error) => error instanceof TelegramError && error.code === code && error.httpStatus === status,
    );
  });
}

test("a Telegram timeout is classified for safe retry messaging", async () => {
  await assert.rejects(
    sendTelegramMessage(mockToken, "1", "hello", async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }),
    (error) => error instanceof TelegramError && error.code === "TIMEOUT",
  );
});

test("non-JSON Telegram replies are not treated as delivered", async () => {
  await assert.rejects(
    sendTelegramMessage(mockToken, "1", "hello", async () => new Response("<html>bad gateway</html>", { status: 502 })),
    (error) => error instanceof TelegramError && error.code === "NON_JSON_RESPONSE",
  );
});
