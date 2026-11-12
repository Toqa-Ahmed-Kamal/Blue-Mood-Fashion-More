import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AnalyticsDashboard } from "@/components/admin/analytics-dashboard";
import { CatalogSync } from "@/components/catalog-sync";
import { loadCustomProducts, loadPrices, loadSoldOut } from "@/lib/custom-products-store";
import { ADMIN_COOKIE, isValidAdminSessionToken } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Analytics | Blue Mood Admin",
  robots: { index: false, follow: false },
};

export default async function AdminAnalyticsPage() {
  // Checked here too, not only in proxy.ts.
  if (!isValidAdminSessionToken((await cookies()).get(ADMIN_COOKIE)?.value)) redirect("/admin/login");
  // Fresh read: the admin must see a product right after adding it.
  const [products, soldOut, prices] = await Promise.all([loadCustomProducts().catch(() => []), loadSoldOut().catch(() => []), loadPrices().catch(() => ({}))]);
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices}>
      <AnalyticsDashboard />
    </CatalogSync>
  );
}
