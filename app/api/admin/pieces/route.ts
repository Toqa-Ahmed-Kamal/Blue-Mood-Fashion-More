import { isAdminRequest, unauthorized } from "@/lib/admin-auth";
import { buildPiecesReport } from "@/lib/piece-analytics";
import { RedisUnavailableError } from "@/lib/redis";
import { computeStock, writeStoreStock } from "@/lib/stock-sync";

export const runtime = "nodejs";

const json = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Pieces analysis (?from=YYYY-MM-DD&to=YYYY-MM-DD). Products and counts only — no customer data. */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  const params = new URL(request.url).searchParams;
  try {
    const stock = await computeStock();
    const { rows, moves, vault, input } = stock;
    await writeStoreStock(stock).catch(() => undefined);
    const report = buildPiecesReport({ live: input.live, old: input.old, direct: input.direct, moves, stock: rows, from: params.get("from"), to: params.get("to") });
    return json(200, { success: true, report, vaultConfigured: vault });
  } catch (error) {
    console.error("[admin] pieces report failed", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    return json(502, { success: false, error: { code: "STORAGE_UNAVAILABLE", message: "مش قادرين نحسب القطع دلوقتي. جربي تاني." } });
  }
}
