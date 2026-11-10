import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { MAX_REPORT_DAYS, cairoDay, daysBetween, loadReport } from "@/lib/analytics-store";
import { RedisUnavailableError, isRedisConfigured } from "@/lib/redis";
import { ensureCustomProducts } from "@/lib/custom-products-store";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Read-only: uses the Upstash read-only token. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const params = new URL(request.url).searchParams;
  const today = cairoDay(new Date());
  const to = params.get("to") || today;
  const from = params.get("from") || cairoDay(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
  const days = daysBetween(from, to);
  if (!days) return json(400, { success: false, error: { code: "INVALID_RANGE", message: `اختاري فترة صحيحة لحد ${MAX_REPORT_DAYS} يوم.` } });

  if (!isRedisConfigured("read")) return json(503, { success: false, error: { code: "STORAGE_NOT_CONFIGURED", message: "مفاتيح Upstash مش موجودة على السيرفر." } });

  try {
    await ensureCustomProducts();
    return json(200, { success: true, report: await loadReport(days) });
  } catch (error) {
    console.error("[admin] analytics read failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نقرا البيانات دلوقتي. جربي تاني بعد شوية." } });
  }
}
