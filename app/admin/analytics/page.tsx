import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AnalyticsDashboard } from "@/components/admin/analytics-dashboard";
import { CatalogSync } from "@/components/catalog-sync";
import { loadAutoSoldOut, loadBigSize, loadCustomProducts, loadPrices, loadProductEdits, loadSoldOut, loadWasPrices } from "@/lib/custom-products-store";
import { ADMIN_COOKIE } from "@/lib/admin-auth";
import { USER_COOKIE, accessFromTokens } from "@/lib/admin-users";

export const metadata: Metadata = {
  title: "Analytics | Blue Mood Admin",
  robots: { index: false, follow: false },
};

export default async function AdminAnalyticsPage() {
  // Checked here too, not only in proxy.ts.
  const jar = await cookies();
  const access = await accessFromTokens(jar.get(ADMIN_COOKIE)?.value, jar.get(USER_COOKIE)?.value).catch(() => null);
  if (!access) redirect("/admin/login");
  // Fresh read: the admin must see a product right after adding it.
  const [products, manualOut, autoOut, bigSize, prices, wasPrices, edits] = await Promise.all([
    loadCustomProducts().catch(() => []),
    loadSoldOut().catch(() => []),
    loadAutoSoldOut().catch(() => []),
    loadBigSize().catch(() => []),
    loadPrices().catch(() => ({})),
    loadWasPrices().catch(() => ({})),
    loadProductEdits().catch(() => ({})),
  ]);
  const soldOut = [...new Set([...manualOut, ...autoOut])];
  return (
    <CatalogSync products={products} soldOut={soldOut} prices={prices} wasPrices={wasPrices} bigSize={bigSize} edits={edits}>
      <AnalyticsDashboard access={{ owner: access.owner, name: access.name, permissions: access.permissions }} />
    </CatalogSync>
  );
}
