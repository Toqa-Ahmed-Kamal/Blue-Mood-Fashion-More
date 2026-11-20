"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Pause, RefreshCw, Trash2, X } from "lucide-react";

import { formatEGP } from "@/lib/format";
import { categoryInfo, type CatalogCategory } from "@/lib/site-data";

type PendingProduct = { id: string; name: string; category: CatalogCategory; image: string; imageAlt: string; price: number | null; maxWeightKg: number | null; edited: boolean };
type Piece = { id: string; name: string; image: string | null; price: number | null; available: boolean };
type BundleRow = { id: string; name: string; price: number; kind: "fixed" | "pick"; pickCount: number; status: "pending" | "live"; addedBy: "owner" | "team"; pieces: Piece[]; orderableNow: boolean };

function useAdminApi() {
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

/** Owner: the team account ("ادمن اكونت"), what it sent for approval, and all bundles. */
export function TeamAdminTab({ onPendingChange }: { onPendingChange?: (count: number) => void }) {
  const api = useAdminApi();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [products, setProducts] = useState<PendingProduct[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [team, approvals] = await Promise.all([api("/api/admin/team"), api("/api/admin/approvals")]);
      setEnabled(team.enabled);
      setProducts(approvals.products);
      setBundles(approvals.bundles);
      onPendingChange?.(approvals.products.length + approvals.bundles.filter((bundle: BundleRow) => bundle.status === "pending").length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نجيب البيانات.");
    } finally {
      setLoading(false);
    }
  }, [api, onPendingChange]);

  useEffect(() => {
    // Loading the section's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(key: string, run: () => Promise<unknown>, done = "") {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await run();
      if (done) setNote(done);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "حصلت مشكلة.");
    } finally {
      setBusy("");
    }
  }

  const decide = (type: "product" | "bundle", id: string, action: "approve" | "reject" | "stop") => act(`${type}-${id}`, () => api("/api/admin/approvals", { method: "POST", body: JSON.stringify({ type, id, action }) }));
  const link = typeof window === "undefined" ? "/team" : `${window.location.origin}/team`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="admin-panel team-admin" aria-labelledby="team-admin-title">
      <div className="admin-panel-head">
        <h2 id="team-admin-title">الفريق والعروض</h2>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {note && <p className="admin-ok" role="status">{note}</p>}

      <div className="team-card">
        <h3><KeyRound size={17} aria-hidden="true" /> ادمن اكونت</h3>
        <p className="admin-muted small">حساب تاني يدخل من لينك لوحده. يقدر يضيف منتجات (صورة، اسم، وصف، سعر، مقاس) ويعمل عروض، ويعدّل ويمسح اللي هو ضافه بس. مش بيشوف الأوردرات ولا الفلوس ولا العميلات، وكل اللي بيضيفه بيستناكي توافقي عليه هنا قبل ما يظهر على الموقع.</p>
        <p>الحالة: <strong>{enabled === null ? "…" : enabled ? "شغال" : "مقفول"}</strong></p>
        <div className="team-link">
          <code dir="ltr">{link}</code>
          <button type="button" className="admin-chip" onClick={() => void copyLink()}>{copied ? <><Check size={14} /> اتنسخ</> : <><Copy size={14} /> نسخ اللينك</>}</button>
          <a className="admin-chip" href="/team" target="_blank" rel="noreferrer"><ExternalLink size={14} /> افتحيه (اعملي عروض)</a>
        </div>
        <form className="team-password" onSubmit={(event) => { event.preventDefault(); void act("password", async () => { await api("/api/admin/team", { method: "PUT", body: JSON.stringify({ password }) }); setPassword(""); }, "اتحفظ الباسورد. ابعتي اللينك والباسورد للشخص ده."); }}>
          <label className="admin-field"><span>{enabled ? "غيّري الباسورد" : "حطي باسورد للحساب علشان يشتغل"}</span>
            <input type="text" dir="ltr" autoComplete="off" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="٨ حروف أو أرقام على الأقل" />
          </label>
          <button type="submit" className="admin-primary" disabled={busy === "password" || password.length < 8}>حفظ الباسورد</button>
          {enabled && <button type="button" className="admin-chip danger" disabled={busy === "off"} onClick={() => { if (window.confirm("تقفلي ادمن اكونت؟ هيتقفل عنده فورًا.")) void act("off", () => api("/api/admin/team", { method: "DELETE" }), "الحساب اتقفل."); }}>قفل الحساب</button>}
        </form>
        <p className="admin-muted small">تغيير الباسورد بيطلّعه من الحساب فورًا، ولازم يدخل بالباسورد الجديد.</p>
      </div>

      <h3 className="team-admin-sub">منتجات مستنية موافقتك ({products.length})</h3>
      {products.length === 0 ? <p className="admin-muted">مفيش حاجة مستنياكي.</p> : (
        <ul className="team-list">
          {products.map((product) => (
            <li key={product.id} className="team-item">
              {/* eslint-disable-next-line @next/next/no-img-element -- product photo from the store's own API */}
              <img src={product.image} alt="" />
              <div className="team-item-body">
                <strong>{product.name}{product.edited && <small> · تعديل على منتج موجود</small>}</strong>
                <small>{categoryInfo[product.category].singular} · {product.price === null ? "ضمن العرض بس" : formatEGP(product.price)}{product.maxWeightKg ? ` · لحد ${product.maxWeightKg} كيلو` : ""}</small>
                <small>{product.imageAlt}</small>
              </div>
              <div className="team-item-actions">
                <button type="button" className="ok" disabled={busy === `product-${product.id}`} onClick={() => void decide("product", product.id, "approve")}><Check size={14} /> موافقة</button>
                <button type="button" className="danger" disabled={busy === `product-${product.id}`} onClick={() => { if (window.confirm(product.edited ? "ترفضي التعديل؟ المنتج هيفضل مخفي لحد ما تعدليه." : `ترفضي "${product.name}"؟ هيتمسح.`)) void decide("product", product.id, "reject"); }}><X size={14} /> رفض</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="admin-muted small">بعد الموافقة، المنتج بيظهر في المنتجات والأسعار وتقدري تحطي سعر المصنع بتاعه من هناك.</p>

      <h3 className="team-admin-sub">العروض ({bundles.length})</h3>
      {bundles.length === 0 ? <p className="admin-muted">لسه مفيش عروض. اعملي واحد من &quot;افتحيه (اعملي عروض)&quot;.</p> : (
        <ul className="team-list">
          {bundles.map((bundle) => (
            <li key={bundle.id} className="team-item">
              <div className="team-bundle-thumbs">
                {/* eslint-disable-next-line @next/next/no-img-element -- product photos from the store */}
                {bundle.pieces.slice(0, 4).map((piece) => (piece.image ? <img key={piece.id} src={piece.image} alt="" /> : <span key={piece.id} />))}
              </div>
              <div className="team-item-body">
                <strong>{bundle.name}</strong>
                <small>{formatEGP(bundle.price)} · {bundle.kind === "fixed" ? `طقم ثابت: ${bundle.pieces.map((piece) => piece.name).join(" + ")}` : `العميلة تختار ${bundle.pickCount} من ${bundle.pieces.length}`}</small>
                <span className={`team-status ${bundle.status}`}>{bundle.status === "live" ? (bundle.orderableNow ? "على الموقع" : "على الموقع بس مش ظاهر (منتج فيه خلص أو مخفي)") : "مستني موافقتك"}{bundle.addedBy === "team" ? " · من الفريق" : ""}</span>
              </div>
              <div className="team-item-actions">
                {bundle.status === "pending"
                  ? <button type="button" className="ok" disabled={busy === `bundle-${bundle.id}`} onClick={() => void decide("bundle", bundle.id, "approve")}><Check size={14} /> موافقة</button>
                  : <button type="button" disabled={busy === `bundle-${bundle.id}`} onClick={() => void decide("bundle", bundle.id, "stop")}><Pause size={14} /> إيقاف</button>}
                <button type="button" className="danger" disabled={busy === `bundle-${bundle.id}`} onClick={() => { if (window.confirm(`تمسحي عرض "${bundle.name}"؟`)) void decide("bundle", bundle.id, "reject"); }}><Trash2 size={14} /> مسح</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
