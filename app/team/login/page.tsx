import type { Metadata } from "next";

import { AdminLoginForm } from "@/components/admin/admin-login-form";

export const metadata: Metadata = {
  title: "دخول ادمن اكونت | Blue Mood",
  robots: { index: false, follow: false },
};

export default function TeamLoginPage() {
  return (
    <main className="admin-login" dir="rtl">
      <AdminLoginForm team />
    </main>
  );
}
