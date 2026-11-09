"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مش قادرين ندخل دلوقتي.");
        return;
      }
      setPassword("");
      router.replace("/admin/analytics");
      router.refresh();
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-login-card" onSubmit={submit}>
      <span className="admin-login-icon"><LockKeyhole size={22} /></span>
      <h1>لوحة Blue Mood</h1>
      <p>الصفحة دي خاصة بإدارة المتجر.</p>
      <label>
        <span>الباسورد</span>
        <input type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
      </label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>{busy ? "جاري الدخول…" : "دخول"}</button>
    </form>
  );
}
