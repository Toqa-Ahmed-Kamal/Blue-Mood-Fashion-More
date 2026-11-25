import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { loadCourierCompanies, saveCourierCompany } from "@/lib/couriers-store";
import { RedisUnavailableError } from "@/lib/redis";
import { sameCompany, sanitizeCourierCompany } from "@/lib/shipment";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function storageError(error: unknown, action: string) {
  console.error(`[admin] courier company ${action} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نوصل للبيانات دلوقتي. جربي تاني." } });
}

/** The shipping companies table. */
export async function GET(request: Request) {
  const denied = await accessDenied(request, ["orders"]);
  if (denied) return denied;
  try {
    return json(200, { success: true, companies: await loadCourierCompanies() });
  } catch (error) {
    return storageError(error, "load");
  }
}

/** Adds a company. Body: { name, phone?, note?, self? }. */
export async function POST(request: Request) {
  const denied = await accessDenied(request, ["orders"]);
  if (denied) return denied;
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: { code: "INVALID_JSON" } });
  }
  const company = sanitizeCourierCompany(body, crypto.randomUUID(), new Date());
  if ("error" in company) return json(400, { success: false, error: { code: "INVALID_COMPANY", message: company.error } });
  try {
    const existing = await loadCourierCompanies();
    if (existing.some((item) => sameCompany(item.name, company.name))) return json(409, { success: false, error: { code: "DUPLICATE", message: "الشركة دي موجودة في الجدول." } });
    const saved = await saveCourierCompany(company);
    return saved ? json(200, { success: true, company: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    return storageError(error, "add");
  }
}
