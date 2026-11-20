import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { TeamPanel } from "@/components/team/team-panel";
import { ADMIN_COOKIE, isValidAdminSessionToken } from "@/lib/admin-auth";
import { TEAM_COOKIE, teamRoleFromCookies } from "@/lib/team-auth";

export const metadata: Metadata = {
  title: "ادمن اكونت | Blue Mood",
  robots: { index: false, follow: false },
};

/** The team account's page (the owner can open it too, to make bundles). */
export default async function TeamPage() {
  const jar = await cookies();
  const role = await teamRoleFromCookies(jar.get(ADMIN_COOKIE)?.value, jar.get(TEAM_COOKIE)?.value, (token) => isValidAdminSessionToken(token));
  if (!role) redirect("/team/login");
  return <TeamPanel />;
}
