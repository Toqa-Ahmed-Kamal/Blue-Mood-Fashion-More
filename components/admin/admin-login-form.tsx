"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

/** Sign-in card. `team` = the team account ("ادمن اكونت"), which only reaches /team. */
export function AdminLoginForm({ team = false }: { team?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  // Empty = the owner's password; filled = a dashboard user the owner added.
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(team ? "/api/team/login" : "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(team ? { password } : { password, username: username.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مش قادرين ندخل دلوقتي.");
        return;
      }
      setPassword("");
      router.replace(team ? "/team" : "/admin/analytics");
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
      <h1>{team ? "Blue Mood · ادمن اكونت" : "لوحة Blue Mood"}</h1>
      <p>{team ? "لإضافة المنتجات والعروض." : "الصفحة دي خاصة بإدارة المتجر."}</p>
      {!team && (
        <label>
          <span>اسم الدخول <small>(سيبيه فاضي لو إنتِ صاحبة المتجر)</small></span>
          <input type="text" autoComplete="username" autoCapitalize="none" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
      )}
      <label>
        <span>الباسورد</span>
        <input type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={team} required />
      </label>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>{busy ? "جاري الدخول…" : "دخول"}</button>
    </form>
  );
}
