import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { sanitizeExpense } from "@/lib/finance";
import { deleteExpense, loadExpense, saveExpense } from "@/lib/finance-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

type Context = { params: Promise<{ expenseId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const NOT_FOUND = { success: false, error: { code: "NOT_FOUND", message: "المصروف مش موجود." } };

async function guard(request: Request, context: Context) {
  if (!isAdminRequest(request)) return { response: unauthorized() };
  if (!isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  const { expenseId } = await context.params;
  if (!ID_PATTERN.test(expenseId)) return { response: json(400, { success: false, error: { code: "INVALID_ID" } }) };
  return { expenseId };
}

function storageError(error: unknown, action: string) {
  console.error(`[admin] expense ${action} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
}

/** Edits an expense (full copy: name, category, amount, date, notes). */
export async function PATCH(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  try {
    const current = await loadExpense(checked.expenseId);
    if (!current) return json(404, NOT_FOUND);
    const expense = sanitizeExpense(body, current.id, new Date(), current.createdAt);
    if (!expense) return json(400, { success: false, error: { code: "INVALID_EXPENSE", message: "اكتبي اسم المصروف والتصنيف ومبلغ أكبر من صفر والتاريخ." } });
    const saved = await saveExpense(expense);
    return saved ? json(200, { success: true, expense: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    return storageError(error, "update");
  }
}

export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    return (await deleteExpense(checked.expenseId)) ? json(200, { success: true }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "delete");
  }
}
