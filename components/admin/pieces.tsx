"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { GoodsTotal, PiecesReport } from "@/lib/piece-analytics";

const cairoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);
const today = () => cairoDay(new Date());
const daysAgo = (days: number) => cairoDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
const PRESETS = [
  { id: "all", label: "الكل", range: () => ({ from: "", to: "" }) },
  { id: "month", label: "الشهر ده", range: () => ({ from: `${today().slice(0, 8)}01`, to: today() }) },
  { id: "30", label: "آخر ٣٠ يوم", range: () => ({ from: daysAgo(29), to: today() }) },
] as const;
const count = new Intl.NumberFormat("en-US");
const pct = (value: number) => `${Math.round(value * 100)}%`;
const MONTH_NAMES = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const TOP = 10;

/** تحليل القطع: pieces out, in and left, and the products that sell most. */
export function PiecesTab() {
  const router = useRouter();
  const [preset, setPreset] = useState<string>("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [report, setReport] = useState<PiecesReport | null>(null);
  const [goods, setGoods] = useState<GoodsTotal | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
      const response = await fetch(`/api/admin/pieces?${query}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error?.message ?? "حصلت مشكلة. جربي تاني.");
      setReport(result.report);
      setGoods(result.goods ?? null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "مقدرناش نحمل التحليل.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, router]);

  useEffect(() => {
    // Loading the report when the tab opens or the dates change is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const totals = report?.totals;
  const sold = report?.products.filter((item) => item.sold > 0) ?? [];
  const shown = showAll ? sold : sold.slice(0, TOP);
  const top = sold[0];
  const maxMonth = Math.max(1, ...(report?.months.map((item) => item.sold) ?? [1]));

  return (
    <>
      <section className="admin-panel" id="pieces-summary">
        <div className="admin-panel-head">
          <h2>تحليل القطع</h2>
          <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
        </div>
        <div className="admin-filters">
          <div className="admin-presets small" role="group" aria-label="الفترة">
            {PRESETS.map((item) => (
              <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => { setPreset(item.id); setRange(item.range()); }}>{item.label}</button>
            ))}
          </div>
          <label>من <input type="date" value={range.from} max={range.to || undefined} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, from: event.target.value })); }} /></label>
          <label>لحد <input type="date" value={range.to} min={range.from || undefined} onChange={(event) => { setPreset("custom"); setRange((current) => ({ ...current, to: event.target.value })); }} /></label>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {!report && !error && <p className="admin-muted">جاري الحساب…</p>}
        {goods && (
          <div className="goods-total">
            <div className="goods-total-head">
              <span>إجمالي البضاعة اللي اشتريتيها</span>
              <strong>{count.format(goods.total)} <small>قطعة</small></strong>
              <small className="admin-muted">من الأول لحد دلوقتي · مش متأثر بالتواريخ</small>
            </div>
            <ul className="goods-total-parts">
              {([
                ["في المخزن دلوقتي", goods.inStock],
                ["اتسلمت للعميلات", goods.delivered],
                ["مع شركة الشحن", goods.withCourier],
                ["مؤكدة لسه متشحنتش", goods.confirmedNotShipped],
                ["بيع مباشر", goods.direct],
                ["خدتيها لنفسك", goods.personal],
                ["اتباعت قبل السيستم", goods.soldBefore],
              ] as const).map(([label, value]) => <li key={label}><span>{label}</span><strong>{count.format(value)}</strong></li>)}
            </ul>
            <small className="admin-muted">&quot;في المخزن&quot; بيحسب المنتجات اللي عملتيلها جرد بس، فالإجمالي بيبقى صح لما كل البضاعة تكون متسجلة في المخزون. القطع اللي في أوردرات مستنية تأكيد لسه في المخزن.</small>
          </div>
        )}
        {totals && (
          <>
            <section className="admin-cards pieces">
              <div className="admin-card good"><span>طلع كام قطعة</span><strong>{count.format(totals.out)} <small>قطعة</small></strong><small>{count.format(totals.sold)} اتباعت{totals.personal ? ` + ${count.format(totals.personal)} ليكي` : ""}</small></div>
              <div className="admin-card"><span>باقي عندي</span><strong>{count.format(totals.left)} <small>قطعة</small></strong><small>في المخزون دلوقتي · {totals.trackedProducts} منتج</small></div>
              <div className="admin-card"><span>جبت كام قطعة</span><strong>{count.format(totals.cameIn)} <small>قطعة</small></strong><small>بضاعة وصلت + أول جرد</small></div>
              <div className="admin-card"><span>اتسلمت للعميلات</span><strong>{count.format(totals.delivered)} <small>قطعة</small></strong><small>من {count.format(totals.soldOnline)} أونلاين</small></div>
              <div className="admin-card"><span>مستنية تأكيد</span><strong>{count.format(totals.waiting)} <small>قطعة</small></strong><small>لسه مش محسوبة مبيعات</small></div>
              <div className="admin-card"><span>رجعت</span><strong>{count.format(totals.returned)} <small>قطعة</small></strong><small>{totals.sold + totals.returned > 0 ? `${pct(totals.returned / (totals.sold + totals.returned))} من اللي اتأكد` : "—"}</small></div>
            </section>
            {top && (
              <p className="pieces-top">
                <span aria-hidden="true">🏆</span> أكتر منتج اتباع: <strong>{top.name}</strong> — {count.format(top.sold)} قطعة ({pct(top.share)} من المبيعات)
                {report.categories[0] && <> · أكتر قسم: <strong>{report.categories[0].label}</strong> ({pct(report.categories[0].share)})</>}
              </p>
            )}
            <p className="admin-muted small">&quot;باقي عندي&quot; هو المخزون دلوقتي، مش متأثر بالتواريخ، وبيحسب المنتجات اللي عملتيلها جرد بس. باقي الأرقام للفترة اللي مختاراها.</p>
          </>
        )}
      </section>

      {report && (
        <section className="admin-panel" id="pieces-top">
          <div className="admin-panel-head"><h2>أكتر المنتجات مبيعًا</h2></div>
          {sold.length === 0 ? <p className="admin-muted empty">مفيش مبيعات في الفترة دي.</p> : (
            <>
              <div className="admin-table-wrap">
                <table className="admin-table pieces-table">
                  <thead><tr><th>#</th><th>المنتج</th><th>اتباع</th><th>من المبيعات</th><th>أوردرات</th><th>رجع</th><th>باقي عندي</th></tr></thead>
                  <tbody>
                    {shown.map((item, index) => (
                      <tr key={item.productId}>
                        <td>{index + 1}</td>
                        <td>
                          <span className="admin-product">
                            {/* eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail */}
                            {item.image && <img src={item.image} alt="" width={40} height={40} loading="lazy" />}
                            <span>{item.name}{item.soldDirect > 0 && <small className="admin-muted">{item.soldDirect} بيع مباشر</small>}</span>
                          </span>
                        </td>
                        <td><strong>{count.format(item.sold)}</strong></td>
                        <td><span className="pieces-share"><span style={{ width: pct(item.share) }} /></span> {pct(item.share)}</td>
                        <td>{item.orders || "—"}</td>
                        <td>{item.returned || "—"}</td>
                        <td>{item.stock === null ? <span className="admin-muted">مش متسجل</span> : <span className={item.stock <= 0 ? "admin-negative" : ""}>{item.stock}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sold.length > TOP && <button type="button" className="admin-chip" onClick={() => setShowAll((current) => !current)}>{showAll ? "أول ١٠ بس" : `اعرضي الكل (${sold.length})`}</button>}
            </>
          )}
        </section>
      )}

      {report && (report.categories.length > 0 || report.months.length > 0) && (
        <div className="pieces-grid">
          {report.categories.length > 0 && (
            <section className="admin-panel" id="pieces-categories">
              <div className="admin-panel-head"><h2>المبيعات حسب القسم</h2></div>
              <ul className="pieces-bars">
                {report.categories.map((item) => (
                  <li key={item.category}><span>{item.label}</span><span className="pieces-bar"><span style={{ width: pct(item.share) }} /></span><strong>{count.format(item.sold)}</strong></li>
                ))}
              </ul>
            </section>
          )}
          {report.months.length > 0 && (
            <section className="admin-panel" id="pieces-months">
              <div className="admin-panel-head"><h2>القطع المباعة كل شهر</h2></div>
              <ul className="pieces-bars">
                {report.months.map((item) => (
                  <li key={item.month}><span>{monthLabel(item.month)}</span><span className="pieces-bar"><span style={{ width: `${Math.round((item.sold / maxMonth) * 100)}%` }} /></span><strong>{count.format(item.sold)}</strong></li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {report && report.still.length > 0 && (
        <section className="admin-panel" id="pieces-still">
          <div className="admin-panel-head"><h2>عندك ومتباعتش في الفترة دي ({report.still.length})</h2></div>
          <p className="admin-muted small">منتجات في المخزون ومحدش اشتراها في الفترة اللي مختاراها — ممكن تعملي عليها عرض أو إعلان.</p>
          <ul className="pieces-still">
            {report.still.toSorted((a, b) => b.stock - a.stock).map((item) => <li key={item.productId}>{item.name} <strong>{item.stock} قطعة</strong></li>)}
          </ul>
        </section>
      )}
    </>
  );
}
