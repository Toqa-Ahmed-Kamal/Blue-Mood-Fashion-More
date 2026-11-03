import test from "node:test";
import assert from "node:assert/strict";

import {
  GoogleAppsScriptError,
  createGoogleAppsScriptPayload,
  createStableOrderId,
  postOrderToGoogleAppsScript,
} from "../lib/google-apps-script.ts";

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
      fit: "One Size – مقاس واحد",
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

test("a retry with the same submission ID keeps the same server order ID", () => {
  const submissionId = "12345678-1234-4234-8234-123456789abc";

  assert.equal(createStableOrderId(submissionId), createStableOrderId(submissionId));
  assert.notEqual(createStableOrderId(submissionId), createStableOrderId("22345678-1234-4234-8234-123456789abc"));
  assert.match(createStableOrderId(submissionId), /^BM-[A-F\d]{20}$/);
});

test("Apps Script payload uses the expected field names and preserves the secret server-side", () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  assert.deepEqual(payload, {
    secret: "mock-secret-for-unit-test",
    ...baseFields,
  });
  assert.equal("customer" in payload, false);
  assert.equal("items" in payload, false);
});

test("an order without a configured shipping fee keeps both shipping and total unknown", () => {
  const payload = createGoogleAppsScriptPayload({
    ...baseFields,
    shippingCost: null,
    total: null,
    notes: "تكلفة الشحن غير مؤكدة؛ يجب تأكيدها قبل التنفيذ.",
  }, "mock-secret-for-unit-test");

  assert.equal(payload.shippingCost, null);
  assert.equal(payload.total, null);
  assert.match(payload.notes, /غير مؤكدة/);
});

test("server forwarding waits for an explicit successful Apps Script response", async () => {
  let requestUrl;
  let requestOptions;
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await postOrderToGoogleAppsScript(
    "https://script.google.com/macros/s/test/exec",
    payload,
    async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ success: true, orderId: payload.orderId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  assert.equal(requestUrl, "https://script.google.com/macros/s/test/exec");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.redirect, "follow");
  assert.deepEqual(JSON.parse(requestOptions.body), payload);
});

test("an explicit Apps Script status success is accepted", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.doesNotReject(postOrderToGoogleAppsScript(
    "https://script.google.com/macros/s/test/exec",
    payload,
    async () => new Response(JSON.stringify({ status: "success", orderId: payload.orderId }), { status: 200 }),
  ));
});

test("HTTP 200 without an explicit success signal is not treated as a saved order", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response(JSON.stringify({ message: "saved?" }), { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "UNCONFIRMED_RESPONSE",
  );
});

test("authentication rejection is identified without exposing response details", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response(JSON.stringify({ success: false, message: "Invalid secret" }), { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "AUTH_SECRET_REJECTED",
  );
});

test("a Google Apps Script timeout is classified for safe retry messaging", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "TIMEOUT",
  );
});

test("non-JSON Apps Script replies are not treated as confirmed writes", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response("<html><body>Unexpected response</body></html>", { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "NON_JSON_RESPONSE",
  );
});

test("a missing doPost handler is reported as a safe specific error", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response("Script function not found: doPost", { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "SCRIPT_HANDLER_MISSING",
  );
});

test("a Google sign-in page is classified as an access or secret configuration failure", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response("<html>Sign in at accounts.google.com</html>", { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "AUTH_ACCESS_REJECTED",
  );
});

test("a mismatched order ID in the Apps Script acknowledgement is rejected", async () => {
  const payload = createGoogleAppsScriptPayload(baseFields, "mock-secret-for-unit-test");

  await assert.rejects(
    postOrderToGoogleAppsScript(
      "https://script.google.com/macros/s/test/exec",
      payload,
      async () => new Response(JSON.stringify({ success: true, orderId: "BM-WRONG" }), { status: 200 }),
    ),
    (error) => error instanceof GoogleAppsScriptError && error.code === "ORDER_ID_MISMATCH",
  );
});
