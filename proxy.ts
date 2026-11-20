import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, isValidAdminSessionToken } from "@/lib/admin-auth";
import { isWellFormedTeamToken, TEAM_COOKIE } from "@/lib/team-auth";

const PUBLIC_PATHS = new Set(["/admin/login", "/api/admin/login", "/team/login", "/api/team/login", "/api/team/logout"]);

/**
 * First layer of protection for the admin (/admin) and the team account (/team). Every page and API also
 * verifies the session itself, so a matcher mistake can never expose data on its own.
 * The team area also accepts the owner's admin session; the admin area never accepts a team session.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isTeamArea = pathname === "/team" || pathname.startsWith("/team/") || pathname.startsWith("/api/team/");
  const isPublic = PUBLIC_PATHS.has(pathname);
  const isAdmin = isValidAdminSessionToken(request.cookies.get(ADMIN_COOKIE)?.value);
  const isSignedIn = isAdmin || (isTeamArea && isWellFormedTeamToken(request.cookies.get(TEAM_COOKIE)?.value));

  let response: NextResponse;
  if (isPublic || isSignedIn) {
    response = NextResponse.next();
  } else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ success: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  } else {
    response = NextResponse.redirect(new URL(isTeamArea ? "/team/login" : "/admin/login", request.url));
  }

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*", "/team", "/team/:path*", "/api/team/:path*"],
};
