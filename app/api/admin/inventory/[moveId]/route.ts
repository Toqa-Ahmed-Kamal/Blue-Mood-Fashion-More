import { isAdminRequest, isSameOrigin, unauthorized } from "@/lib/admin-auth";
import { deleteStockMove } from "@/lib/inventory-store";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

type Context = { params: Promise<{ moveId: string }> };

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const ID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** Removes a move recorded by mistake (the stock is worked out again without it). */
export async function DELETE(request: Request, context: Context) {
  if (!isAdminRequest(request)) return unauthorized();
  if (!isSameOrigin(request)) return json(403, { success: false, error: { code: "FORBIDDEN" } });
  const { moveId } = await context.params;
  if (!ID_PATTERN.test(moveId)) return json(400, { success: false, error: { code: "INVALID_ID" } });
  try {
    return (await deleteStockMove(moveId)) ? json(200, { success: true }) : json(404, { success: false, error: { code: "NOT_FOUND", message: "الحركة دي مش موجودة." } });
  } catch (error) {
    console.error("[admin] stock move delete failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مقدرناش نحذف دلوقتي. جربي تاني." } });
  }
}
