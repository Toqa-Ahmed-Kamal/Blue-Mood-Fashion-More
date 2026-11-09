import type { Metadata } from "next";

import { AdminLoginForm } from "@/components/admin/admin-login-form";

export const metadata: Metadata = {
  title: "دخول الإدارة | Blue Mood",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="admin-login" dir="rtl">
      <AdminLoginForm />
    </main>
  );
}
