import { cookies } from "next/headers";

import { ADMIN_COOKIE, adminCookieOptions, isSameOrigin } from "@/lib/admin-auth";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ success: false }, { status: 403 });
  (await cookies()).set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
