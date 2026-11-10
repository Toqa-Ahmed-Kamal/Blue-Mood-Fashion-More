import { after } from "next/server";

import { clientIp, hashIp, recordEvents } from "@/lib/analytics-store";
import { sanitizeBatchId, sanitizeJourneyEvents } from "@/lib/journey";
import { RedisUnavailableError } from "@/lib/redis";

export const runtime = "nodejs";

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|meta-externalagent|whatsapp|telegram|preview|headless|lighthouse|pingdom|monitor/i;
const MAX_BODY_LENGTH = 4_000;

// Always 204, like /api/track/visit: tracking never reports back and never blocks the store.
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** Pages, product views, cart adds / removals and checkout steps for the customer-journey dashboard. */
export async function POST(request: Request) {
  if (BOT_PATTERN.test(request.headers.get("user-agent") ?? "")) return done();

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_LENGTH) return done();
    body = JSON.parse(text);
  } catch {
    return done();
  }
  if (typeof body !== "object" || body === null) return done();
  const { sessionId, visitorId, batchId, events: rawEvents } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId) || typeof visitorId !== "string" || !UUID_PATTERN.test(visitorId)) {
    return done();
  }
  const events = sanitizeJourneyEvents(rawEvents);
  if (events.length === 0) return done();

  const ipHash = hashIp(clientIp(request));
  after(async () => {
    try {
      await recordEvents({ sessionId: sessionId.toLowerCase(), visitorId: visitorId.toLowerCase(), events, ipHash, batchId: sanitizeBatchId(batchId) });
    } catch (error) {
      console.error("[analytics] journey events not recorded", { reason: error instanceof RedisUnavailableError ? error.message : "UNEXPECTED" });
    }
  });
  return done();
}
