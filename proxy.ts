import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, isValidAdminSessionToken } from "@/lib/admin-auth";

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/api/admin/login"]);

/**
 * First layer of admin protection. Every admin page and API also verifies the session itself,
 * so a matcher mistake can never expose data on its own.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ADMIN_PATHS.has(pathname);
  const isSignedIn = isValidAdminSessionToken(request.cookies.get(ADMIN_COOKIE)?.value);

  let response: NextResponse;
  if (isPublic || isSignedIn) {
    response = NextResponse.next();
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  } else {
    response = NextResponse.redirect(new URL("/admin/login", request.url));
  }

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
