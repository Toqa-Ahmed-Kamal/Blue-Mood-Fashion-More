"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gift, ImagePlus, LogOut, Pencil, Plus, RefreshCw, Search, Shirt, Trash2, X } from "lucide-react";

import { formatEGP } from "@/lib/format";
import { photoToBase64 } from "@/lib/photo-resize";
import { categoryInfo, categoryOrder, categoryPrices, hasWeightFit, type CatalogCategory } from "@/lib/site-data";

type Status = "pending" | "live" | "hidden";
type ProductView = { id: string; name: string; category: CatalogCategory; image: string; imageAlt: string; price: number | null; ownPrice: number | null; maxWeightKg: number | null; status: Status };
type BundleView = { id: string; name: string; price: number; kind: "fixed" | "pick"; productIds: string[]; pickCount: number; status: "pending" | "live"; addedBy: "owner" | "team" };
type Data = { role: "owner" | "team"; products: ProductView[]; bundles: BundleView[]; catalog: ProductView[] };

const STATUS_LABEL: Record<Status | "live", string> = { pending: "مستني الموافقة", live: "على الموقع", hidden: "مش ظاهر" };

function useTeamApi() {
  const router = useRouter();
  return useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
    if (response.status === 401) {
      router.replace("/team/login");
      throw new Error("سجّل دخول تاني.");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "حصلت مشكلة. جرب تاني.");
    return result;
  }, [router]);
}

/** The team account's page: add / edit / remove its own products and bundles. Nothing else is shown here. */
export function TeamPanel() {
  const api = useTeamApi();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [productDialog, setProductDialog] = useState<{ product: ProductView | null } | null>(null);
  const [bundleDialog, setBundleDialog] = useState<{ bundle: BundleView | null } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api("/api/team/data");
      setData({ role: result.role, products: result.products, bundles: result.bundles, catalog: result.catalog });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نجيب البيانات.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Loading the page's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(url: string, question: string, key: string) {
    if (!window.confirm(question)) return;
    setBusy(key);
    setError("");
    try {
      await api(url, { method: "DELETE" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نمسح.");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch(data?.role === "owner" ? "/api/admin/logout" : "/api/team/logout", { method: "POST" }).catch(() => undefined);
    router.replace(data?.role === "owner" ? "/admin/login" : "/team/login");
  }

  const names = useMemo(() => new Map((data?.catalog ?? []).map((product) => [product.id, product])), [data]);
  const team = data?.role === "team";

  return (
    <div className="team-shell" dir="rtl">
      <header className="team-top">
        <div>
          <strong>Blue Mood · {team ? "ادمن اكونت" : "إضافة منتجات وعروض"}</strong>
          <small>{team ? "أي حاجة تضيفها أو تعدلها بتستنى موافقة صاحبة المحل قبل ما تظهر على الموقع." : "إنتي داخلة بحسابك: اللي بتضيفيه هنا بيظهر على الموقع على طول."}</small>
        </div>
        <div className="team-top-actions">
          <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
          <button type="button" className="admin-chip" onClick={() => void logout()}><LogOut size={15} /> خروج</button>
        </div>
      </header>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!data && !error && <p className="admin-muted">جاري التحميل…</p>}

      {data && (
        <>
          {team && (
            <section className="team-section" aria-labelledby="team-products-title">
              <div className="team-section-head">
                <h2 id="team-products-title"><Shirt size={18} aria-hidden="true" /> منتجاتي</h2>
                <button type="button" className="admin-primary" onClick={() => setProductDialog({ product: null })}><Plus size={15} /> إضافة منتج</button>
              </div>
              {data.products.length === 0 ? <p className="admin-muted">لسه مفيش منتجات. دوس &quot;إضافة منتج&quot;.</p> : (
                <ul className="team-list">
                  {data.products.map((product) => (
                    <li key={product.id} className="team-item">
                      {/* eslint-disable-next-line @next/next/no-img-element -- product photo from the store's own API */}
                      <img src={product.image} alt="" />
                      <div className="team-item-body">
                        <strong>{product.name}</strong>
                        <small>{categoryInfo[product.category].singular} · {product.price === null ? "ضمن العرض بس" : formatEGP(product.price)}{product.maxWeightKg ? ` · لحد ${product.maxWeightKg} كيلو` : ""}</small>
                        <span className={`team-status ${product.status}`}>{STATUS_LABEL[product.status]}</span>
                      </div>
                      <div className="team-item-actions">
                        <button type="button" onClick={() => setProductDialog({ product })}><Pencil size={14} /> تعديل</button>
                        <button type="button" className="danger" disabled={busy === product.id} onClick={() => void remove(`/api/team/products/${product.id}`, `تمسح "${product.name}"؟`, product.id)}><Trash2 size={14} /> مسح</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="team-section" aria-labelledby="team-bundles-title">
            <div className="team-section-head">
              <h2 id="team-bundles-title"><Gift size={18} aria-hidden="true" /> {team ? "عروضي" : "العروض"}</h2>
              <button type="button" className="admin-primary" onClick={() => setBundleDialog({ bundle: null })}><Plus size={15} /> عرض جديد</button>
            </div>
            {data.bundles.length === 0 ? <p className="admin-muted">لسه مفيش عروض. العرض = كذا منتج بسعر واحد.</p> : (
              <ul className="team-list">
                {data.bundles.map((bundle) => (
                  <li key={bundle.id} className="team-item">
                    <div className="team-bundle-thumbs">
                      {bundle.productIds.slice(0, 4).map((id) => {
                        const piece = names.get(id);
                        // eslint-disable-next-line @next/next/no-img-element -- product photo from the store
                        return piece ? <img key={id} src={piece.image} alt="" /> : <span key={id} />;
                      })}
                    </div>
                    <div className="team-item-body">
                      <strong>{bundle.name}</strong>
                      <small>{formatEGP(bundle.price)} · {bundle.kind === "fixed" ? `طقم ثابت ${bundle.productIds.length} قطع` : `العميلة تختار ${bundle.pickCount} من ${bundle.productIds.length}`}</small>
                      <span className={`team-status ${bundle.status}`}>{STATUS_LABEL[bundle.status]}</span>
                    </div>
                    <div className="team-item-actions">
                      <button type="button" onClick={() => setBundleDialog({ bundle })}><Pencil size={14} /> تعديل</button>
                      <button type="button" className="danger" disabled={busy === bundle.id} onClick={() => void remove(`/api/team/bundles/${bundle.id}`, `تمسح عرض "${bundle.name}"؟`, bundle.id)}><Trash2 size={14} /> مسح</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {productDialog && <TeamProductDialog product={productDialog.product} onClose={() => setProductDialog(null)} onSaved={async () => { setProductDialog(null); await load(); }} team={team} />}
      {bundleDialog && data && <BundleDialog bundle={bundleDialog.bundle} catalog={data.catalog} onClose={() => setBundleDialog(null)} onSaved={async () => { setBundleDialog(null); await load(); }} team={team} />}
    </div>
  );
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return ref;
}

function TeamProductDialog({ product, onClose, onSaved, team }: { product: ProductView | null; onClose: () => void; onSaved: () => Promise<void>; team: boolean }) {
  const api = useTeamApi();
  const ref = useModal();
  const editing = product !== null;
  const [form, setForm] = useState({
    name: product?.name ?? "",
    category: product?.category ?? ("winter-pajamas" as CatalogCategory),
    price: product?.ownPrice != null ? String(product.ownPrice) : "",
    imageAlt: product?.imageAlt ?? "",
    maxWeightKg: product?.maxWeightKg != null ? String(product.maxWeightKg) : "",
  });
  const [photo, setPhoto] = useState<{ base64: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [field]: value }));
  const categoryPrice = categoryPrices[form.category];

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const base64 = await photoToBase64(file);
      setPhoto({ base64, preview: `data:image/jpeg;base64,${base64}` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نقرا الصورة.");
    }
  }

  async function save() {
    if (!editing && !photo) return setError("ارفع صورة المنتج.");
    setBusy(true);
    setError("");
    try {
      const body = {
        name: form.name,
        category: form.category,
        price: form.price.trim() === "" ? null : Number(form.price),
        imageAlt: form.imageAlt,
        maxWeightKg: hasWeightFit(form.category) && form.maxWeightKg.trim() ? Number(form.maxWeightKg) : null,
        ...(photo ? { image: photo.base64 } : {}),
      };
      await api(editing ? `/api/team/products/${product.id}` : "/api/team/products", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="admin-dialog" dir="rtl" aria-labelledby="team-product-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="team-product-title" className="admin-dialog-plain-title">{editing ? `تعديل ${product.name}` : "إضافة منتج"}</h2>
            {team && <p className="admin-muted">هيستنى موافقة صاحبة المحل قبل ما يظهر على الموقع{editing ? " (ولحد الموافقة مش هيظهر)" : ""}.</p>}
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>
        <div className="admin-product-form">
          <label className="admin-photo-pick">
            {photo || product?.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen photo
              <img src={photo?.preview ?? product?.image} alt="" />
            ) : (
              <span><ImagePlus size={26} aria-hidden="true" /> ارفع صورة المنتج</span>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} aria-label="صورة المنتج" />
            {(photo || product?.image) && <small>دوس لتغيير الصورة</small>}
          </label>
          <div className="admin-edit-grid">
            <label className="admin-field wide"><span>اسم المنتج</span><input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="مثلاً: بيجاما قطيفة كحلي بطبعة نجوم" /></label>
            <label className="admin-field"><span>القسم</span>
              <select value={form.category} disabled={editing} onChange={(event) => set("category", event.target.value as CatalogCategory)}>
                {categoryOrder.map((category) => <option key={category} value={category}>{categoryInfo[category].singular}</option>)}
              </select>
            </label>
            <label className="admin-field"><span>السعر (ج.م)</span>
              <input type="number" min={1} inputMode="numeric" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder={categoryPrice ? `فاضي = ${categoryPrice}` : ""} />
            </label>
            {hasWeightFit(form.category) && (
              <label className="admin-field"><span>المقاس: One Size لحد كام كيلو</span>
                <input type="number" min={30} max={200} inputMode="numeric" value={form.maxWeightKg} onChange={(event) => set("maxWeightKg", event.target.value)} placeholder="فاضي = 85–90" />
              </label>
            )}
            <label className="admin-field wide"><span>الوصف</span><textarea rows={3} value={form.imageAlt} onChange={(event) => set("imageAlt", event.target.value)} placeholder="مثلاً: بيجاما قطيفة ناعمة، بلوزة بكم طويل وبنطلون واسع" /></label>
          </div>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={busy} onClick={() => void save()}>{busy ? "جاري الحفظ…" : team ? "حفظ وإرسال للموافقة" : "حفظ"}</button>
        </footer>
      </div>
    </dialog>
  );
}

function BundleDialog({ bundle, catalog, onClose, onSaved, team }: { bundle: BundleView | null; catalog: ProductView[]; onClose: () => void; onSaved: () => Promise<void>; team: boolean }) {
  const api = useTeamApi();
  const ref = useModal();
  const editing = bundle !== null;
  const [name, setName] = useState(bundle?.name ?? "");
  const [price, setPrice] = useState(bundle ? String(bundle.price) : "");
  const [kind, setKind] = useState<"fixed" | "pick">(bundle?.kind ?? "fixed");
  const [pickCount, setPickCount] = useState(bundle?.kind === "pick" ? String(bundle.pickCount) : "2");
  const [picked, setPicked] = useState<string[]>(bundle?.productIds ?? []);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byId = new Map(catalog.map((product) => [product.id, product]));
  const words = query.trim().toLowerCase();
  const shown = catalog.filter((product) => (category === "all" || product.category === category) && (!words || product.name.toLowerCase().includes(words)));
  const singles = picked.reduce<number | null>((sum, id) => {
    const value = byId.get(id)?.price;
    return sum === null || value == null ? null : sum + value;
  }, 0);

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const body = { name, price: Number(price), kind, productIds: picked, pickCount: kind === "pick" ? Number(pickCount) : picked.length };
      await api(editing ? `/api/team/bundles/${bundle.id}` : "/api/team/bundles", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ العرض.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="admin-dialog team-bundle-dialog" dir="rtl" aria-labelledby="team-bundle-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="team-bundle-title" className="admin-dialog-plain-title">{editing ? `تعديل ${bundle.name}` : "عرض جديد"}</h2>
            <p className="admin-muted">كذا منتج بسعر واحد.{team ? " هيستنى موافقة صاحبة المحل قبل ما يظهر." : ""}</p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        <div className="admin-edit-grid">
          <label className="admin-field wide"><span>اسم العرض</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً: طقم الشتا · روب + بيجاما" /></label>
          <label className="admin-field"><span>سعر العرض (ج.م)</span><input type="number" min={1} inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <div className="admin-field"><span>نوع العرض</span>
            <div className="team-kind" role="radiogroup" aria-label="نوع العرض">
              <button type="button" role="radio" aria-checked={kind === "fixed"} className={kind === "fixed" ? "on" : ""} onClick={() => setKind("fixed")}>طقم ثابت</button>
              <button type="button" role="radio" aria-checked={kind === "pick"} className={kind === "pick" ? "on" : ""} onClick={() => setKind("pick")}>العميلة تختار</button>
            </div>
          </div>
          {kind === "pick" && (
            <label className="admin-field"><span>العميلة تختار كام قطعة؟</span><input type="number" min={1} max={10} inputMode="numeric" value={pickCount} onChange={(event) => setPickCount(event.target.value)} /></label>
          )}
        </div>
        <p className="admin-muted small">
          {kind === "fixed" ? "اختار المنتجات اللي في الطقم. العميلة بتشتريه زي ما هو." : `اختار المنتجات اللي العميلة تختار منها (لازم أكتر من ${pickCount || "؟"}).`}
          {" "}مختار: {picked.length}{kind === "fixed" && singles !== null && picked.length > 0 ? ` · لو اتباعوا لوحدهم: ${formatEGP(singles)}` : ""}
        </p>

        <div className="team-pick-tools">
          <label className="team-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="دوّر باسم المنتج" /></label>
          <select value={category} onChange={(event) => setCategory(event.target.value as CatalogCategory | "all")} aria-label="القسم">
            <option value="all">كل الأقسام</option>
            {categoryOrder.map((item) => <option key={item} value={item}>{categoryInfo[item].label}</option>)}
          </select>
        </div>
        <div className="team-pick-grid">
          {shown.map((product) => {
            const on = picked.includes(product.id);
            return (
              <button type="button" key={product.id} className={`team-pick${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(product.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- product photo from the store */}
                <img src={product.image} alt="" />
                <span>{product.name}</span>
                <small>{product.price === null ? "ضمن العرض" : formatEGP(product.price)}{product.status === "pending" ? " · مستني الموافقة" : ""}</small>
                {on && <b aria-hidden="true">✓</b>}
              </button>
            );
          })}
        </div>

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <button type="button" onClick={onClose}>إلغاء</button>
          <button type="button" className="admin-primary" disabled={busy} onClick={() => void save()}>{busy ? "جاري الحفظ…" : team ? "حفظ وإرسال للموافقة" : "حفظ"}</button>
        </footer>
      </div>
    </dialog>
  );
}
