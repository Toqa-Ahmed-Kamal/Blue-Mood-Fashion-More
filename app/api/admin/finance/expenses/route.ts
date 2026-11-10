import { randomUUID } from "node:crypto";

import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { sanitizeExpense } from "@/lib/finance";
import { saveExpense } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Adds an expense. Body: { name, category, amount, date, notes }. */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const expense = sanitizeExpense(body, randomUUID());
  if (!expense) return json(400, { success: false, error: { code: "INVALID_EXPENSE", message: "اكتبي اسم المصروف والتصنيف ومبلغ أكبر من صفر والتاريخ." } });
  try {
    const saved = await saveExpense(expense);
    if (!saved) return json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
    return json(200, { success: true, expense: saved });
  } catch (error) {
    console.error("[admin] expense save failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
  }
}
