import { createHash } from "node:crypto";

import type { CatalogCategory } from "@/lib/site-data";

export type GoogleAppsScriptProduct = {
  modelId: string;
  name: string;
  category: CatalogCategory;
  fit: string;
  quantity: number;
  /** null for pieces included in the offer price. */
  unitPrice: number | null;
};

export type GoogleAppsScriptOrder = {
  secret: string;
  orderId: string;
  createdAt: string;
  customerName: string;
  phone: string;
  alternatePhone: string;
  governorate: string;
  area: string;
  address: string;
  offerName: string;
  products: GoogleAppsScriptProduct[];
  /** 0 when the order has no offer. */
  offerPrice: number;
  itemsTotal: number;
  subtotal: number;
  shippingCost: number | null;
  total: number | null;
  notes: string;
};

export type GoogleAppsScriptOrderFields = Omit<GoogleAppsScriptOrder, "secret">;

export type GoogleAppsScriptFailureCode =
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "NON_JSON_RESPONSE"
  | "SCRIPT_HANDLER_MISSING"
  | "AUTH_ACCESS_REJECTED"
  | "AUTH_SECRET_REJECTED"
  | "HTTP_ERROR"
  | "SCRIPT_REJECTED"
  | "UNCONFIRMED_RESPONSE"
  | "ORDER_ID_MISMATCH"
  | "RESPONSE_READ_FAILED";

export class GoogleAppsScriptError extends Error {
  readonly code: GoogleAppsScriptFailureCode;
  readonly httpStatus?: number;

  constructor(
    code: GoogleAppsScriptFailureCode,
    httpStatus?: number,
  ) {
    super(code);
    this.name = "GoogleAppsScriptError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function createStableOrderId(submissionId: string) {
  return `BM-${createHash("sha256").update(submissionId).digest("hex").slice(0, 20).toUpperCase()}`;
}

export function createGoogleAppsScriptPayload(
  fields: GoogleAppsScriptOrderFields,
  secret: string,
): GoogleAppsScriptOrder {
  return { ...fields, secret };
}

function getResponseBody(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasExplicitSuccess(body: Record<string, unknown>) {
  const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  return body.success === true || body.ok === true || status === "success" || status === "ok";
}

function indicatesAuthFailure(body: Record<string, unknown> | null) {
  if (!body) return false;
  const nestedError = getResponseBody(body.error);
  const details = [body.code, body.errorCode, body.error, body.message, nestedError?.code, nestedError?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return /secret|unauthori[sz]ed|forbidden|invalid\s+(key|token|secret)|credential|permission|access denied|مفتاح|سر|صلاحية/.test(details);
}

function validateSuccessBody(body: Record<string, unknown> | null, expectedOrderId: string) {
  if (!body || !hasExplicitSuccess(body)) return "UNCONFIRMED_RESPONSE" as const;
  const returnedOrderId = body.orderId;
  return typeof returnedOrderId === "string" && returnedOrderId !== expectedOrderId
    ? "ORDER_ID_MISMATCH" as const
    : null;
}

export async function postOrderToGoogleAppsScript(
  scriptUrl: string,
  payload: GoogleAppsScriptOrder,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(scriptUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new GoogleAppsScriptError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_FAILURE");
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new GoogleAppsScriptError("RESPONSE_READ_FAILED", response.status);
  }

  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    const safeResponseHint = responseText.toLowerCase();
    if (
      response.status === 401 ||
      response.status === 403 ||
      /accounts\.google\.com|sign in|authentication required/.test(safeResponseHint)
    ) {
      throw new GoogleAppsScriptError("AUTH_ACCESS_REJECTED", response.status);
    }
    if (/script function not found\s*:?\s*doPost/i.test(responseText)) {
      throw new GoogleAppsScriptError("SCRIPT_HANDLER_MISSING", response.status);
    }
    throw new GoogleAppsScriptError("NON_JSON_RESPONSE", response.status);
  }

  const parsedBody = getResponseBody(responseBody);
  if (response.status === 401 || response.status === 403) {
    throw new GoogleAppsScriptError("AUTH_ACCESS_REJECTED", response.status);
  }
  if (indicatesAuthFailure(parsedBody)) {
    throw new GoogleAppsScriptError("AUTH_SECRET_REJECTED", response.status);
  }
  if (!response.ok) {
    throw new GoogleAppsScriptError("HTTP_ERROR", response.status);
  }

  if (parsedBody && (parsedBody.success === false || parsedBody.ok === false || parsedBody.status === "error")) {
    throw new GoogleAppsScriptError("SCRIPT_REJECTED", response.status);
  }

  const validationError = validateSuccessBody(parsedBody, payload.orderId);
  if (validationError) {
    throw new GoogleAppsScriptError(validationError, response.status);
  }
}

