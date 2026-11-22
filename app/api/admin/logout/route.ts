import { cookies } from "next/headers";

import { ADMIN_COOKIE, adminCookieOptions, isSameOrigin } from "@/lib/admin-auth";
import { USER_COOKIE, userCookieOptions } from "@/lib/admin-users";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ success: false }, { status: 403 });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  jar.set(USER_COOKIE, "", { ...userCookieOptions, maxAge: 0 });
  return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
