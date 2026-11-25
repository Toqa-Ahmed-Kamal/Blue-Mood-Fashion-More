import { isSameOrigin } from "@/lib/admin-auth";
import { accessDenied } from "@/lib/admin-users";
import { deleteCourierCompany, loadCourierCompanies, saveCourierCompany } from "@/lib/couriers-store";
import { RedisUnavailableError } from "@/lib/redis";
import { sameCompany, sanitizeCourierCompany } from "@/lib/shipment";

export const runtime = "nodejs";

type Context = { params: Promise<{ companyId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const NOT_FOUND = { success: false, error: { code: "NOT_FOUND", message: "الشركة مش موجودة." } };

async function guard(request: Request, context: Context) {
  const denied = await accessDenied(request, ["orders"]);
  if (denied) return { response: denied };
  if (!isSameOrigin(request)) return { response: json(403, { success: false, error: { code: "FORBIDDEN" } }) };
  const { companyId } = await context.params;
  if (!ID_PATTERN.test(companyId)) return { response: json(400, { success: false, error: { code: "INVALID_ID" } }) };
  return { companyId };
}

function storageError(error: unknown, action: string) {
  console.error(`[admin] courier company ${action} failed`, { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
  return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحفظ دلوقتي. جربي تاني." } });
}

/** Edits a company (full copy: name, phone, note, own scooter). Orders keep the name they were saved with. */
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
    const all = await loadCourierCompanies();
    const current = all.find((item) => item.id === checked.companyId);
    if (!current) return json(404, NOT_FOUND);
    const company = sanitizeCourierCompany(body, current.id, new Date(), current.createdAt);
    if ("error" in company) return json(400, { success: false, error: { code: "INVALID_COMPANY", message: company.error } });
    if (all.some((item) => item.id !== current.id && sameCompany(item.name, company.name))) return json(409, { success: false, error: { code: "DUPLICATE", message: "فيه شركة تانية بنفس الاسم." } });
    const saved = await saveCourierCompany(company);
    return saved ? json(200, { success: true, company: saved }) : json(502, { success: false, error: { code: "NOT_PERSISTED", message: "الحفظ ما اتأكدش. جربي تاني." } });
  } catch (error) {
    return storageError(error, "update");
  }
}

export async function DELETE(request: Request, context: Context) {
  const checked = await guard(request, context);
  if ("response" in checked) return checked.response;
  try {
    return (await deleteCourierCompany(checked.companyId)) ? json(200, { success: true }) : json(404, NOT_FOUND);
  } catch (error) {
    return storageError(error, "delete");
  }
}
