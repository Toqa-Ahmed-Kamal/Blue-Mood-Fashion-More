import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { MAX_DETAILS_PER_REQUEST, loadOrdersDetails } from "@/lib/analytics-store";
import { isOrderVaultConfigured } from "@/lib/order-vault";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ORDER_ID_PATTERN = /^BM-[A-F\d]{20}$/;

/** Customer details + items for the orders shown in the list: GET /api/admin/orders?ids=BM-…,BM-… (read-only token). */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > MAX_DETAILS_PER_REQUEST || ids.some((id) => !ORDER_ID_PATTERN.test(id))) {
    return json(400, { success: false, error: { code: "INVALID_IDS" } });
  }

  try {
    return json(200, { success: true, details: await loadOrdersDetails(ids), vaultConfigured: isOrderVaultConfigured() });
  } catch (error) {
    console.error("[admin] orders details read failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نقرا تفاصيل الأوردرات دلوقتي. جربي تاني." } });
  }
}
