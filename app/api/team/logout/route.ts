import { cookies } from "next/headers";

import { isSameOrigin } from "@/lib/admin-auth";
import { TEAM_COOKIE, teamCookieOptions } from "@/lib/team-auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ success: false }, { status: 403 });
  (await cookies()).set(TEAM_COOKIE, "", { ...teamCookieOptions, maxAge: 0 });
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
