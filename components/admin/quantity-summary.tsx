"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, ImageOff, RefreshCw } from "lucide-react";

import type { OrderStatus } from "@/lib/analytics-report";
import type { ProductSummary, QuantitySummary } from "@/lib/quantity-summary";
import { categoryInfo } from "@/lib/site-data";
import { buildXlsx, type XlsxCell, type XlsxImage } from "@/lib/xlsx";

const REFRESH_MS = 60_000;
const VIEWS = [
  { id: "active", label: "مستني تأكيد + مؤكد", statuses: ["submitted", "confirmed"] },
  { id: "confirmed", label: "المؤكد بس", statuses: ["confirmed"] },
  { id: "submitted", label: "المستني تأكيد بس", statuses: ["submitted"] },
] as const satisfies readonly { id: string; label: string; statuses: OrderStatus[] }[];
type ViewId = (typeof VIEWS)[number]["id"];

const integer = new Intl.NumberFormat("en-US");
const cairoTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });
const sum = (counts: Record<OrderStatus, number>, statuses: readonly OrderStatus[]) => statuses.reduce((total, status) => total + counts[status], 0);

type Response = { summary: QuantitySummary; generatedAt: string; unreadableOldOrders: number; vaultConfigured: boolean };

export function QuantitySummaryTab() {
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewId>("active");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/quantities?archived=${includeArchived ? "include" : "exclude"}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحسب الكميات.");
        return;
      }
      setError("");
      setData(result);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setLoading(false);
    }
  }, [includeArchived, router]);

  useEffect(() => {
    // Loading when the tab opens, and again every minute so new orders and status changes show up.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const statuses: readonly OrderStatus[] = VIEWS.find((item) => item.id === view)!.statuses;
  const words = query.trim().toLowerCase();
  const products = (data?.summary.products ?? [])
    .filter((product) => sum(product.pieces, statuses) > 0)
    .filter((product) => !words || `${product.name} ${product.productId}`.toLowerCase().includes(words))
    .toSorted((a, b) => sum(b.pieces, statuses) - sum(a.pieces, statuses));
  const totals = data?.summary.totals;

  async function exportExcel() {
    if (!data) return;
    setExporting(true);
    try {
      const label = VIEWS.find((item) => item.id === view)!.label;
      const pictures = await Promise.all(products.map((product) => (product.image ? jpegThumbnail(product.image) : Promise.resolve(null))));
      const images: XlsxImage[] = [];
      const rows: XlsxCell[][] = [["الصورة", "كود المنتج", "المنتج", "القسم", `إجمالي القطع (${label})`, "مستني تأكيد", "مؤكد", "عدد الأوردرات", "توزيع المقاسات"]];
      products.forEach((product, index) => {
        const picture = pictures[index];
        if (picture) images.push({ row: index + 1, col: 0, data: picture, width: 72, height: 72 });
        rows.push([
          picture ? "" : "الصورة مش متاحة",
          product.productId,
          product.name,
          product.category ? categoryInfo[product.category].singular : "",
          sum(product.pieces, statuses),
          statuses.includes("submitted") ? product.pieces.submitted : null,
          statuses.includes("confirmed") ? product.pieces.confirmed : null,
          sum(product.orders, statuses),
          sizesOf(product, statuses).map((size) => `${size.size}: ${size.count}`).join("\n"),
        ]);
      });
      rows.push(["", "", "الإجمالي", "", products.reduce((total, product) => total + sum(product.pieces, statuses), 0), null, null, null, ""]);
      const rowHeights = Object.fromEntries(products.map((_, index) => [index + 1, 60]));
      const bySize: XlsxCell[][] = [["كود المنتج", "المنتج", "المقاس", `القطع (${label})`, "مستني تأكيد", "مؤكد"]];
      for (const product of products) {
        for (const size of product.sizes) {
          const count = sum(size.pieces, statuses);
          if (count > 0) bySize.push([product.productId, product.name, size.size, count, statuses.includes("submitted") ? size.pieces.submitted : null, statuses.includes("confirmed") ? size.pieces.confirmed : null]);
        }
      }
      const file = buildXlsx([
        { name: "حصر المصنع", rtl: true, rows, images, rowHeights, columnWidths: [12, 24, 40, 12, 18, 13, 10, 14, 34] },
        { name: "حسب المقاس", rtl: true, rows: bySize, columnWidths: [24, 40, 30, 16, 13, 10] },
      ]);
      const url = URL.createObjectURL(new Blob([file.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `blue-mood-factory-${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date())}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>حصر كميات المصنع · Product Quantity Summary</h2>
        <div className="admin-import-actions">
          <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
          <button type="button" className="admin-primary" disabled={!data || products.length === 0 || exporting} onClick={() => void exportExcel()}>
            <Download size={15} /> {exporting ? "جاري التجهيز…" : "Export Excel"}
          </button>
        </div>
      </div>

      <div className="admin-filters">
        <div className="admin-presets small" role="group" aria-label="الحالات المحسوبة">
          {VIEWS.map((item) => <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>{item.label}</button>)}
        </div>
        <input type="search" className="admin-search" placeholder="بحث باسم المنتج أو الكود" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="بحث" />
        <label className="admin-check"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> احسبي الأوردرات القديمة المؤرشفة</label>
      </div>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {data && !data.vaultConfigured && <p className="admin-note">الأوردرات القديمة مش محسوبة لأن ORDER_DATA_KEY مش متضاف. أوردرات الموقع محسوبة عادي.</p>}
      {data && data.unreadableOldOrders > 0 && <p className="admin-note">فيه {data.unreadableOldOrders} أوردر قديم مش قادرين نقراه بالمفتاح الحالي ومش محسوب.</p>}
      {!data && !error && <p className="admin-muted">جاري الحساب…</p>}

      {data && totals && (
        <>
          <section className="admin-cards">
            <div className="admin-card"><span>القطع المطلوبة</span><strong>{integer.format(sum(totals.pieces, statuses))}</strong><small>{VIEWS.find((item) => item.id === view)!.label}</small></div>
            <div className="admin-card"><span>عدد الأوردرات</span><strong>{integer.format(sum(totals.orders, statuses))}</strong><small>{integer.format(totals.orders.submitted)} مستني · {integer.format(totals.orders.confirmed)} مؤكد</small></div>
            <div className="admin-card"><span>عدد المنتجات</span><strong>{integer.format(products.length)}</strong><small>منتج مختلف مطلوب</small></div>
            <div className="admin-card"><span>الملغي (مش محسوب)</span><strong>{integer.format(totals.pieces.cancelled)}</strong><small>قطعة في {integer.format(totals.orders.cancelled)} أوردر</small></div>
          </section>

          <SourcesBox summary={data.summary} statuses={statuses} includeArchived={includeArchived} />

          {products.length === 0 ? <p className="admin-muted empty">مفيش قطع مطلوبة بالاختيار ده.</p> : (
            <div className="admin-qty-grid">
              {products.map((product) => <ProductCard key={product.productId || product.name} product={product} statuses={statuses} />)}
            </div>
          )}

          <p className="admin-muted small">
            المنتجات بتتربط بكود المنتج (مش بالاسم)، فمفيش منتجين مختلفين بيتجمعوا مع بعض. الملغي مش بيدخل في الإجمالي. البيجامات One Size بحد الوزن اللي في بيانات المنتج؛ العبايات والأرواب والبلانكيت مالهاش مقاسات. آخر تحديث {cairoTime(data.generatedAt)}، وبيتحدث لوحده كل دقيقة.
          </p>
        </>
      )}
    </section>
  );
}

/** Where the numbers come from, and which imported orders are not added (and why). */
function SourcesBox({ summary, statuses, includeArchived }: { summary: QuantitySummary; statuses: readonly OrderStatus[]; includeArchived: boolean }) {
  const { sources, totals } = summary;
  return (
    <div className="admin-qty-sources-box">
      <div>
        <strong>{integer.format(sources.siteOrders)}</strong> أوردر من الموقع · <strong>{integer.format(sum(totals.bySource.site, statuses))}</strong> قطعة
      </div>
      <div>
        <strong>{integer.format(sources.oldCounted)}</strong> من {integer.format(sources.oldOrders)} أوردر قديم (تيليجرام) محسوبين · <strong>{integer.format(sum(totals.bySource.telegram, statuses))}</strong> قطعة
      </div>
      {sources.inBoth > 0 && (
        <details>
          <summary>{integer.format(sources.inBoth)} أوردر قديم هو نفسه أوردر من الموقع، فاتحسب مرة واحدة من الموقع بحالته في تبويب الأوردرات</summary>
          <p dir="ltr" className="mono">{sources.inBothIds.join(" · ")}</p>
        </details>
      )}
      {sources.archivedSkipped > 0 && !includeArchived && (
        <details>
          <summary>{integer.format(sources.archivedSkipped)} أوردر قديم مؤرشف مش محسوب (علّمي &quot;احسبي الأوردرات القديمة المؤرشفة&quot; علشان يدخلوا)</summary>
          <p dir="ltr" className="mono">{sources.archivedIds.join(" · ")}</p>
        </details>
      )}
      {sources.oldOrders === 0 && <div className="admin-muted">مفيش أوردرات قديمة متحفظة. استوردي ملف تيليجرام من تبويب &quot;الأوردرات القديمة&quot;.</div>}
    </div>
  );
}

function sizesOf(product: ProductSummary, statuses: readonly OrderStatus[]) {
  return product.sizes.map((size) => ({ size: size.size, count: sum(size.pieces, statuses) })).filter((size) => size.count > 0);
}

function ProductCard({ product, statuses }: { product: ProductSummary; statuses: readonly OrderStatus[] }) {
  const sizes = sizesOf(product, statuses);
  return (
    <article className="admin-qty-card">
      {product.image ? (
        <a href={product.image} target="_blank" rel="noreferrer" className="admin-qty-photo" aria-label={`صورة ${product.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of the real product photo */}
          <img src={product.image} alt={product.name} loading="lazy" />
        </a>
      ) : (
        <span className="admin-qty-photo missing"><ImageOff size={20} aria-hidden="true" /> الصورة مش متاحة</span>
      )}
      <div className="admin-qty-body">
        <strong className="admin-qty-name">{product.name}</strong>
        <small className="admin-muted" dir="ltr">{product.productId}{product.category && ` · ${categoryInfo[product.category].singular}`}</small>
        <div className="admin-qty-total"><strong>{integer.format(sum(product.pieces, statuses))}</strong> قطعة</div>
        <small className="admin-muted">
          في {integer.format(sum(product.orders, statuses))} أوردر
          {statuses.length > 1 && ` · ${product.pieces.submitted} مستني · ${product.pieces.confirmed} مؤكد`}
          {product.pieces.cancelled > 0 && ` · ${product.pieces.cancelled} ملغي`}
        </small>
        <small className="admin-qty-sources">من الموقع {integer.format(sum(product.bySource.site, statuses))} · من تيليجرام {integer.format(sum(product.bySource.telegram, statuses))}</small>
        <ul className="admin-qty-sizes" aria-label="حسب المقاس">
          {sizes.map((size) => <li key={size.size}><span>{size.size}</span><strong>{size.count}</strong></li>)}
        </ul>
      </div>
    </article>
  );
}

/** The product photo as a small square JPEG for Excel; null if it cannot be loaded. */
async function jpegThumbnail(src: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const size = 144;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // Cover crop, centered.
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
