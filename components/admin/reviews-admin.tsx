"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, RefreshCw, Trash2 } from "lucide-react";

import { reviewPhotoToUpload } from "@/lib/photo-resize";

type Review = { id: string; image: string; width: number; height: number; caption: string; name: string; hidden: boolean; position: number; createdAt: string };

function useReviewsApi() {
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

/** Customer reviews on the store: upload screenshots, write a caption, hide, reorder, delete. */
export function ReviewsAdminTab() {
  const api = useReviewsApi();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReviews((await api("/api/admin/reviews")).reviews);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نجيب الريفيوهات.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Loading the list when the section opens is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function upload(files: FileList | null) {
    const list = [...(files ?? [])].filter((file) => file.type.startsWith("image/"));
    if (list.length === 0) return;
    setError("");
    setNote("");
    setUploading({ done: 0, total: list.length });
    let failed = 0;
    let lastError = "";
    // One by one, oldest selected first, so the first photo chosen ends up on top.
    for (const [index, file] of list.toReversed().entries()) {
      try {
        const photo = await reviewPhotoToUpload(file);
        await api("/api/admin/reviews", { method: "POST", body: JSON.stringify({ image: photo.base64, width: photo.width, height: photo.height }) });
      } catch (caught) {
        failed += 1;
        lastError = caught instanceof Error ? caught.message : "";
      }
      setUploading({ done: index + 1, total: list.length });
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    if (failed) setError(`${failed} صورة ما اترفعتش. ${lastError}`);
    else setNote(list.length === 1 ? "اترفع الريفيو وظهر على الموقع." : `اترفعوا ${list.length} ريفيوهات وظهروا على الموقع.`);
    await load();
  }

  async function act(key: string, work: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await work();
      if (done) setNote(done);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحفظ.");
    } finally {
      setBusy("");
    }
  }

  function move(index: number, by: number) {
    if (!reviews) return;
    const next = [...reviews];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setReviews(next);
    void act(`move-${item.id}`, () => api("/api/admin/reviews", { method: "PUT", body: JSON.stringify({ order: next.map((review) => review.id) }) }));
  }

  const shown = reviews?.filter((review) => !review.hidden).length ?? 0;
  return (
    <section className="admin-panel reviews-admin" id="reviews">
      <div className="admin-panel-head">
        <h2>ريفيوهات العملاء</h2>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>
      <p className="admin-muted small">
        ارفعي سكرينات رسايل العميلات أو صورهم بالبيجامات. بتظهر في قسم &quot;آراء عميلاتنا&quot; في الصفحة الرئيسية بعد ثواني.
        تقدري تكتبي جملة قصيرة واسم العميلة (اختياري)، وتخفي أو ترتبي أو تمسحي أي ريفيو. خبّي رقم الموبايل أو أي بيانات شخصية من السكرين قبل ما ترفعيه.
      </p>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {note && <p className="admin-note" role="status">{note}</p>}

      <label className={`reviews-upload${uploading ? " busy" : ""}`}>
        <input ref={fileInput} type="file" accept="image/*" multiple disabled={Boolean(uploading)} onChange={(event) => void upload(event.target.files)} />
        <ImagePlus size={26} aria-hidden="true" />
        <strong>{uploading ? `جاري الرفع… ${uploading.done} من ${uploading.total}` : "ارفعي صور الريفيوهات"}</strong>
        <small>تقدري تختاري كذا صورة مرة واحدة</small>
      </label>

      <h3 className="team-admin-sub">الريفيوهات ({reviews?.length ?? 0}) · ظاهر على الموقع {shown}</h3>
      {reviews === null ? <p className="admin-muted">جاري التحميل…</p> : reviews.length === 0 ? <p className="admin-muted">لسه مفيش ريفيوهات. القسم مش بيظهر للعميلات لحد ما ترفعي أول ريفيو.</p> : (
        <ul className="reviews-admin-grid">
          {reviews.map((review, index) => (
            <li key={review.id} className={review.hidden ? "hidden-review" : undefined}>
              <a href={review.image} target="_blank" rel="noreferrer" className="reviews-admin-photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- review photo from the store's own API */}
                <img src={review.image} alt={review.caption || "ريفيو"} loading="lazy" />
                {review.hidden && <span className="reviews-admin-flag">مخفي</span>}
              </a>
              <ReviewFields review={review} busy={busy === `edit-${review.id}`} onSave={(fields) => void act(`edit-${review.id}`, () => api(`/api/admin/reviews/${review.id}`, { method: "PATCH", body: JSON.stringify(fields) }), "اتحفظ.")} />
              <div className="reviews-admin-actions">
                <button type="button" className="admin-chip" disabled={index === 0 || Boolean(busy)} onClick={() => move(index, -1)} aria-label="قبل"><ArrowUp size={14} /></button>
                <button type="button" className="admin-chip" disabled={index === reviews.length - 1 || Boolean(busy)} onClick={() => move(index, 1)} aria-label="بعد"><ArrowDown size={14} /></button>
                <button type="button" className="admin-chip" disabled={Boolean(busy)} onClick={() => void act(`hide-${review.id}`, () => api(`/api/admin/reviews/${review.id}`, { method: "PATCH", body: JSON.stringify({ hidden: !review.hidden }) }), review.hidden ? "الريفيو ظاهر تاني." : "الريفيو اتخفى من الموقع.")}>
                  {review.hidden ? <><Eye size={14} /> إظهار</> : <><EyeOff size={14} /> إخفاء</>}
                </button>
                <button type="button" className="admin-chip danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm("تمسحي الريفيو ده خالص؟")) void act(`del-${review.id}`, () => api(`/api/admin/reviews/${review.id}`, { method: "DELETE" }), "اتمسح الريفيو."); }}><Trash2 size={14} /> مسح</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewFields({ review, busy, onSave }: { review: Review; busy: boolean; onSave: (fields: { caption: string; name: string }) => void }) {
  const [caption, setCaption] = useState(review.caption);
  const [name, setName] = useState(review.name);
  const changed = caption !== review.caption || name !== review.name;
  return (
    <form className="reviews-admin-fields" onSubmit={(event) => { event.preventDefault(); onSave({ caption, name }); }}>
      <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="جملة قصيرة (اختياري)" maxLength={160} aria-label="جملة الريفيو" />
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم العميلة (اختياري)" maxLength={40} aria-label="اسم العميلة" />
      {changed && <button type="submit" className="admin-primary" disabled={busy}>حفظ</button>}
    </form>
  );
}
