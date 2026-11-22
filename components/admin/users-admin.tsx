"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Pencil, Power, RefreshCw, Trash2, UserPlus } from "lucide-react";

type Permission = { id: string; label: string; note: string };
type User = { id: string; username: string; name: string; permissions: string[]; active: boolean; createdAt: string; updatedAt: string; lastLoginAt?: string };

const cairoTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });

function useUsersApi() {
  const router = useRouter();
  return useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (response.status === 401) {
      router.replace("/admin/login");
      throw new Error("انتهت الجلسة.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "حصلت مشكلة. جربي تاني.");
    return result;
  }, [router]);
}

const EMPTY = { name: "", username: "", password: "", permissions: [] as string[] };

/** Owner only: people who can sign in to the dashboard, and the sections each one sees. */
export function UsersAdminTab() {
  const api = useUsersApi();
  const [users, setUsers] = useState<User[] | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  // The user being edited: their sections and name (password and on/off have their own buttons).
  const [editing, setEditing] = useState<{ id: string; name: string; permissions: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api("/api/admin/users");
      setUsers(result.users);
      setPermissions(result.permissions);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نجيب المستخدمين.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Loading the list when the section opens is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await work();
      setNote(done);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy("");
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act("create", async () => {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm(EMPTY);
    }, `اتعمل الحساب. ابعتي للشخص لينك الدخول واسم الدخول (${form.username.trim().toLowerCase()}) والباسورد.`);
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const labelOf = (id: string) => permissions.find((item) => item.id === id)?.label ?? id;
  const loginLink = typeof window === "undefined" ? "/admin/login" : `${window.location.origin}/admin/login`;

  return (
    <section className="admin-panel users-admin" id="users">
      <div className="admin-panel-head">
        <h2>المستخدمين والصلاحيات</h2>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>
      <p className="admin-muted small">
        اعملي حساب لكل شخص بيشتغل معاكي واختاري الأقسام اللي يشوفها. بيدخل من نفس لينك لوحة التحكم <code dir="ltr">{loginLink}</code> باسم الدخول والباسورد،
        ومش هيظهرله غير الأقسام اللي معلّمة. إنتِ بس اللي بتشوفي القسم ده وتقدري تعملي حسابات.
      </p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {note && <p className="admin-note" role="status">{note}</p>}

      <form className="users-form" onSubmit={create}>
        <h3><UserPlus size={17} aria-hidden="true" /> مستخدم جديد</h3>
        <div className="users-form-fields">
          <label className="admin-field"><span>الاسم</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="مثلًا: منى (خدمة العملاء)" maxLength={40} /></label>
          <label className="admin-field"><span>اسم الدخول (إنجليزي)</span><input dir="ltr" autoComplete="off" autoCapitalize="none" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="mona" required minLength={3} maxLength={32} /></label>
          <label className="admin-field"><span>الباسورد</span><input dir="ltr" type="text" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="٨ حروف أو أرقام على الأقل" required minLength={8} /></label>
        </div>
        <PermissionPicker permissions={permissions} value={form.permissions} onChange={(next) => setForm({ ...form, permissions: next })} toggle={toggle} />
        <button type="submit" className="admin-primary" disabled={busy === "create" || !form.username || form.password.length < 8}>{busy === "create" ? "جاري الحفظ…" : "اعملي الحساب"}</button>
      </form>

      <h3 className="team-admin-sub">الحسابات ({users?.length ?? 0})</h3>
      {users === null ? <p className="admin-muted">جاري التحميل…</p> : users.length === 0 ? <p className="admin-muted">لسه مفيش حسابات.</p> : (
        <ul className="users-list">
          {users.map((user) => (
            <li key={user.id} className={`users-item${user.active ? "" : " off"}`}>
              <div className="users-item-head">
                <div>
                  <strong>{user.name}</strong> <code dir="ltr">{user.username}</code>
                  {!user.active && <span className="admin-flag warn">مقفول</span>}
                  <small className="admin-muted">{user.lastLoginAt ? `آخر دخول ${cairoTime(user.lastLoginAt)}` : "لسه ما دخلش"}</small>
                </div>
                <div className="users-item-actions">
                  <button type="button" className="admin-chip" disabled={Boolean(busy)} onClick={() => setEditing(editing?.id === user.id ? null : { id: user.id, name: user.name, permissions: user.permissions })}><Pencil size={14} /> الأقسام</button>
                  <button type="button" className="admin-chip" disabled={Boolean(busy)} onClick={() => {
                    const password = window.prompt(`باسورد جديد لـ ${user.name} (٨ حروف أو أرقام على الأقل). هيخرج من الحساب ويدخل بالجديد:`);
                    if (password) void act(`pw-${user.id}`, () => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password }) }), `اتغير الباسورد بتاع ${user.name}.`);
                  }}><KeyRound size={14} /> باسورد جديد</button>
                  <button type="button" className="admin-chip" disabled={Boolean(busy)} onClick={() => {
                    if (user.active && !window.confirm(`تقفلي حساب ${user.name}؟ هيخرج فورًا ومش هيقدر يدخل لحد ما تفتحيه.`)) return;
                    void act(`on-${user.id}`, () => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) }), user.active ? `اتقفل حساب ${user.name}.` : `اتفتح حساب ${user.name}.`);
                  }}><Power size={14} /> {user.active ? "قفل" : "فتح"}</button>
                  <button type="button" className="admin-chip danger" disabled={Boolean(busy)} onClick={() => {
                    if (window.confirm(`تمسحي حساب ${user.name} خالص؟`)) void act(`del-${user.id}`, () => api(`/api/admin/users/${user.id}`, { method: "DELETE" }), `اتمسح حساب ${user.name}.`);
                  }}><Trash2 size={14} /> مسح</button>
                </div>
              </div>
              {editing?.id === user.id ? (
                <form className="users-edit" onSubmit={(event) => {
                  event.preventDefault();
                  void act(`edit-${user.id}`, async () => {
                    await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name, permissions: editing.permissions }) });
                    setEditing(null);
                  }, `اتحفظت أقسام ${editing.name}. بتتطبق عليه على طول.`);
                }}>
                  <label className="admin-field"><span>الاسم</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} maxLength={40} /></label>
                  <PermissionPicker permissions={permissions} value={editing.permissions} onChange={(next) => setEditing({ ...editing, permissions: next })} toggle={toggle} />
                  <div className="users-edit-actions">
                    <button type="submit" className="admin-primary" disabled={busy === `edit-${user.id}`}>حفظ</button>
                    <button type="button" className="admin-chip" onClick={() => setEditing(null)}>إلغاء</button>
                  </div>
                </form>
              ) : (
                <div className="users-perms">
                  {user.permissions.length === 0 ? <small className="admin-muted">مفيش أقسام — مش هيشوف حاجة.</small> : user.permissions.map((id) => <span key={id} className="users-perm">{labelOf(id)}</span>)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PermissionPicker({ permissions, value, onChange, toggle }: { permissions: Permission[]; value: string[]; onChange: (next: string[]) => void; toggle: (list: string[], id: string) => string[] }) {
  return (
    <fieldset className="users-perm-picker">
      <legend>يشوف إيه؟</legend>
      {permissions.map((permission) => (
        <label key={permission.id} className="users-perm-option">
          <input type="checkbox" checked={value.includes(permission.id)} onChange={() => onChange(toggle(value, permission.id))} />
          <span><strong>{permission.label}</strong><small>{permission.note}</small></span>
        </label>
      ))}
    </fieldset>
  );
}
