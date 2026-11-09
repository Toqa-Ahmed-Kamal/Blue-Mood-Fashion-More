"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, LogOut, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AnalyticsReport, OrderRow, OrderStatus } from "@/lib/analytics-report";
import { formatEGP } from "@/lib/format";
import { SOURCE_TYPES, TRAFFIC_SOURCES, type SourceType, type TrafficSource } from "@/lib/traffic-source";

const SOURCE_COLORS: Record<TrafficSource, string> = {
  "Facebook Ads": "#2f5fb3",
  "Instagram Ads": "#d6246e",
  "Other Paid": "#b8874f",
  "Facebook Organic": "#7a96be",
  "Instagram Organic": "#ee8fb6",
  "Other Social": "#9b7fc4",
  WhatsApp: "#1c9d50",
  Google: "#e0a019",
  Referral: "#44749c",
  Direct: "#1f3550",
  Unknown: "#b9b3ba",
};

const TYPE_COLORS: Record<SourceType, string> = { Paid: "#d6246e", Organic: "#1c9d50", Direct: "#1f3550", Unknown: "#b9b3ba" };
const TYPE_LABELS: Record<SourceType, string> = { Paid: "Paid (إعلانات)", Organic: "Organic (مجاني)", Direct: "Direct (مباشر)", Unknown: "Unknown" };
const STATUS_LABELS: Record<OrderStatus, string> = { submitted: "مستني تأكيد", confirmed: "بيع مؤكد", cancelled: "اتلغى" };

const PRESETS = [
  { id: "7", label: "٧ أيام", days: 7 },
  { id: "30", label: "٣٠ يوم", days: 30 },
  { id: "90", label: "٩٠ يوم", days: 90 },
] as const;

const integer = new Intl.NumberFormat("en-US");
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`);
const cairoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);
const daysAgo = (days: number) => cairoDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

type Report = AnalyticsReport;

export function AnalyticsDashboard() {
  const router = useRouter();
  const [preset, setPreset] = useState<string>("30");
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/analytics?from=${from}&to=${to}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "حصلت مشكلة في تحميل البيانات.");
        return;
      }
      setReport(result.report);
    } catch {
      setError("مفيش اتصال. جربي تاني.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // Fetching on mount / range change is the intended side effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(range.from, range.to);
  }, [load, range.from, range.to]);

  function choosePreset(id: string, days: number) {
    setPreset(id);
    setRange({ from: daysAgo(days - 1), to: daysAgo(0) });
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  }

  function applyOrderUpdate(orderId: string, status: OrderStatus, confirmedValue: number | null, statusAt: string | null) {
    setReport((current) => {
      if (!current) return current;
      // Re-fetch keeps every total consistent; the row updates immediately meanwhile.
      return { ...current, orders: current.orders.map((row) => (row.orderId === orderId ? { ...row, status, confirmedValue, statusAt } : row)) };
    });
    void load(range.from, range.to);
  }

  return (
    <div className="admin" dir="rtl">
      <header className="admin-header">
        <div>
          <p className="admin-kicker">Blue Mood · Private</p>
          <h1>Analytics</h1>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="admin-icon-btn" onClick={() => void load(range.from, range.to)} disabled={loading} aria-label="تحديث">
            <RefreshCw size={17} className={loading ? "spin" : undefined} />
          </button>
          <button type="button" className="admin-icon-btn" onClick={logout} aria-label="خروج"><LogOut size={17} /></button>
        </div>
      </header>

      <section className="admin-range" aria-label="الفترة">
        <div className="admin-presets" role="group">
          {PRESETS.map((item) => (
            <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => choosePreset(item.id, item.days)}>{item.label}</button>
          ))}
        </div>
        <label>من <input type="date" value={range.from} max={range.to} onChange={(e) => { setPreset("custom"); if (e.target.value) setRange((r) => ({ ...r, from: e.target.value })); }} /></label>
        <label>لحد <input type="date" value={range.to} min={range.from} onChange={(e) => { setPreset("custom"); if (e.target.value) setRange((r) => ({ ...r, to: e.target.value })); }} /></label>
      </section>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!report && loading && <p className="admin-muted">جاري التحميل…</p>}
      {report && <ReportView report={report} onOrderUpdated={applyOrderUpdate} />}
    </div>
  );
}

function ReportView({ report, onOrderUpdated }: { report: Report; onOrderUpdated: (id: string, status: OrderStatus, value: number | null, at: string | null) => void }) {
  const { totals } = report;
  const type = (name: SourceType) => report.byType.find((row) => row.type === name);
  const paid = type("Paid");
  const organic = type("Organic");
  const sourcesWithSessions = report.bySource.filter((row) => row.sessions > 0);
  const activeSources = report.bySource.filter((row) => row.sessions > 0 || row.submitted > 0);
  const metaAds = report.bySource.filter((row) => row.source === "Facebook Ads" || row.source === "Instagram Ads");

  return (
    <>
      <section className="admin-cards">
        <StatCard label="Sessions (زيارات)" value={integer.format(totals.sessions)} hint="زيارة = جلسة تصفح واحدة" />
        <StatCard label="Unique Visitors" value={integer.format(totals.uniqueVisitors)} hint="متصفحات مختلفة" />
        <StatCard label="Submitted Orders" value={integer.format(totals.submitted)} hint={formatEGP(totals.submittedValue)} />
        <StatCard label="Confirmed Sales" value={integer.format(totals.confirmed)} hint={formatEGP(totals.confirmedValue)} tone="good" />
        <StatCard label="Conversion (طلبات)" value={percent(totals.submittedConversion)} hint="Submitted ÷ Sessions" />
        <StatCard label="Conversion (مبيعات)" value={percent(totals.confirmedConversion)} hint="Confirmed ÷ Sessions" tone="good" />
        <StatCard label="طلبات Paid Ads" value={integer.format(paid?.submitted ?? 0)} hint={`${paid?.confirmed ?? 0} مؤكد`} />
        <StatCard label="طلبات Organic" value={integer.format(organic?.submitted ?? 0)} hint={`${organic?.confirmed ?? 0} مؤكد · Direct لوحده`} />
      </section>
      {totals.pending > 0 && <p className="admin-note">فيه {totals.pending} طلب لسه مستني تأكيد. علّميهم من جدول الطلبات تحت علشان أرقام المبيعات المؤكدة تبقى صح.</p>}

      <Panel title="الزيارات والطلبات يوم بيوم">
        <ChartBox height={290}>
          <LineChart data={report.timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
            <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} fontSize={11} />
            <YAxis yAxisId="s" allowDecimals={false} fontSize={11} width={36} />
            <YAxis yAxisId="o" orientation="right" allowDecimals={false} fontSize={11} width={30} />
            <Tooltip />
            <Legend />
            <Line yAxisId="s" type="monotone" dataKey="sessions" name="Sessions" stroke="#44749c" strokeWidth={2} dot={false} />
            <Line yAxisId="o" type="monotone" dataKey="submitted" name="Submitted" stroke="#d6246e" strokeWidth={2} dot={false} />
            <Line yAxisId="o" type="monotone" dataKey="confirmed" name="Confirmed" stroke="#1c9d50" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartBox>
      </Panel>

      <div className="admin-grid-2">
        <Panel title="مصادر الزيارات">
          {sourcesWithSessions.length === 0 ? <Empty /> : (
            <ChartBox height={260}>
              <PieChart>
                <Pie data={sourcesWithSessions} dataKey="sessions" nameKey="source" innerRadius={55} outerRadius={95} paddingAngle={2}>
                  {sourcesWithSessions.map((row) => <Cell key={row.source} fill={SOURCE_COLORS[row.source]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ChartBox>
          )}
        </Panel>
        <Panel title="Paid · Organic · Direct">
          <ChartBox height={260}>
            <BarChart data={report.byType} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
              <XAxis dataKey="type" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={36} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sessions" name="Sessions" fill="#7a96be" radius={[4, 4, 0, 0]} />
              <Bar dataKey="submitted" name="Submitted" fill="#d6246e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="confirmed" name="Confirmed" fill="#1c9d50" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartBox>
          <TypeTable rows={report.byType} />
        </Panel>
      </div>

      <Panel title="أداء كل مصدر">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>المصدر</th><th>النوع</th><th>Sessions</th><th>النسبة</th><th>Submitted</th><th>قيمة الطلبات</th><th>Confirmed</th><th>قيمة المؤكد</th><th>Conv. طلبات</th><th>Conv. مبيعات</th></tr>
            </thead>
            <tbody>
              {report.bySource.map((row) => (
                <tr key={row.source} className={row.sessions === 0 && row.submitted === 0 ? "dim" : ""}>
                  <td><span className="dot" style={{ background: SOURCE_COLORS[row.source] }} />{row.source}</td>
                  <td>{row.type}</td>
                  <td>{integer.format(row.sessions)}</td>
                  <td>{percent(row.sessionShare)}</td>
                  <td>{row.submitted}</td>
                  <td>{formatEGP(row.submittedValue)}</td>
                  <td>{row.confirmed}</td>
                  <td>{formatEGP(row.confirmedValue)}</td>
                  <td>{percent(row.submittedConversion)}</td>
                  <td>{percent(row.confirmedConversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="admin-muted small">الطلب بيتحسب لآخر مصدر غير مباشر (Last Non-Direct Touch). يعني لو عميلة جت من إعلان ورجعت بعدين مباشرة، الطلب بيتحسب للإعلان، فنسبة التحويل للمصادر المدفوعة ممكن تطلع أعلى شوية من نسبة الجلسات بتاعتها.</p>
      </Panel>

      <div className="admin-grid-2">
        <Panel title="قيمة الطلبات حسب المصدر">
          {activeSources.length === 0 ? <Empty /> : (
            <ChartBox height={Math.max(220, activeSources.length * 34)}>
              <BarChart data={activeSources} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="source" width={118} fontSize={11} />
                <Tooltip formatter={(value) => formatEGP(Number(value))} />
                <Legend />
                <Bar dataKey="submittedValue" name="Submitted" fill="#f09ab8" radius={[0, 4, 4, 0]} />
                <Bar dataKey="confirmedValue" name="Confirmed" fill="#1c9d50" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartBox>
          )}
        </Panel>
        <Panel title="Conversion Rate لكل مصدر">
          {sourcesWithSessions.length === 0 ? <Empty /> : (
            <ChartBox height={Math.max(220, sourcesWithSessions.length * 34)}>
              <BarChart data={sourcesWithSessions.map((row) => ({ source: row.source, submitted: (row.submittedConversion ?? 0) * 100, confirmed: (row.confirmedConversion ?? 0) * 100 }))} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
                <XAxis type="number" unit="%" fontSize={11} />
                <YAxis type="category" dataKey="source" width={118} fontSize={11} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(2)}%`} />
                <Legend />
                <Bar dataKey="submitted" name="Submitted" fill="#d6246e" radius={[0, 4, 4, 0]} />
                <Bar dataKey="confirmed" name="Confirmed" fill="#1c9d50" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartBox>
          )}
        </Panel>
      </div>

      <div className="admin-grid-2">
        <Panel title="Facebook Ads مقابل Instagram Ads">
          <ChartBox height={240}>
            <BarChart data={metaAds} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
              <XAxis dataKey="source" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={36} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sessions" name="Sessions" fill="#7a96be" radius={[4, 4, 0, 0]} />
              <Bar dataKey="submitted" name="Submitted" fill="#d6246e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="confirmed" name="Confirmed" fill="#1c9d50" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartBox>
          <p className="admin-muted small">علشان الفصل ده يشتغل، لازم روابط إعلانات Meta يبقى فيها <code dir="ltr">utm_source={"{{site_source_name}}"}&amp;utm_medium=paid</code>.</p>
        </Panel>
        <CampaignPanel report={report} />
      </div>

      <OrdersPanel report={report} onOrderUpdated={onOrderUpdated} />
    </>
  );
}

function CampaignPanel({ report }: { report: Report }) {
  const [metric, setMetric] = useState<"sessions" | "submitted">("sessions");
  const rows = report.campaigns
    .filter((row) => row[metric] > 0)
    .toSorted((a, b) => b[metric] - a[metric])
    .slice(0, 8);
  return (
    <Panel
      title="أفضل الحملات"
      action={(
        <div className="admin-presets small" role="group">
          <button type="button" className={metric === "sessions" ? "active" : ""} onClick={() => setMetric("sessions")}>زيارات</button>
          <button type="button" className={metric === "submitted" ? "active" : ""} onClick={() => setMetric("submitted")}>طلبات</button>
        </div>
      )}
    >
      {rows.length === 0 ? <Empty text="مفيش حملات في الفترة دي (utm_campaign)." /> : (
        <ChartBox height={Math.max(220, rows.length * 36)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
            <XAxis type="number" allowDecimals={false} fontSize={11} />
            <YAxis type="category" dataKey="campaign" width={130} fontSize={11} />
            <Tooltip />
            <Legend />
            <Bar dataKey="sessions" name="Sessions" fill="#7a96be" radius={[0, 4, 4, 0]} />
            <Bar dataKey="submitted" name="Submitted" fill="#d6246e" radius={[0, 4, 4, 0]} />
            <Bar dataKey="confirmed" name="Confirmed" fill="#1c9d50" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartBox>
      )}
    </Panel>
  );
}

function OrdersPanel({ report, onOrderUpdated }: { report: Report; onOrderUpdated: (id: string, status: OrderStatus, value: number | null, at: string | null) => void }) {
  const [source, setSource] = useState("");
  const [type, setType] = useState("");
  const [campaign, setCampaign] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [rowError, setRowError] = useState("");

  const campaigns = useMemo(() => [...new Set(report.orders.map((row) => row.campaign).filter(Boolean))].sort(), [report.orders]);
  const rows = report.orders.filter((row) =>
    (!source || row.source === source)
    && (!type || row.sourceType === type)
    && (!campaign || (campaign === "-" ? !row.campaign : row.campaign === campaign))
    && (!status || row.status === status)
    && (!from || row.day >= from)
    && (!to || row.day <= to));

  async function update(row: OrderRow, next: OrderStatus) {
    let confirmedValue: number | null = null;
    if (next === "confirmed") {
      const answer = window.prompt(`القيمة اللي اتحصلت فعلاً للطلب ${row.orderId} (سيبيها زي ما هي لو مفيش تغيير):`, String(row.value));
      if (answer === null) return;
      // Empty answer = keep the order total (null), never 0.
      const digits = answer.replace(/[^\d.]/g, "");
      confirmedValue = digits ? Number(digits) : null;
      if (confirmedValue !== null && (!Number.isFinite(confirmedValue) || confirmedValue <= 0)) {
        setRowError("اكتبي قيمة صحيحة أكبر من صفر، أو سيبي الخانة فاضية علشان نستخدم قيمة الطلب.");
        return;
      }
    }
    setBusyId(row.orderId);
    setRowError("");
    try {
      const response = await fetch(`/api/admin/orders/${row.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, confirmedValue }),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setRowError(result?.error?.message ?? "مقدرناش نحفظ التغيير.");
        return;
      }
      onOrderUpdated(row.orderId, result.order.status, result.order.confirmedValue, result.order.statusAt);
    } catch {
      setRowError("مفيش اتصال. جربي تاني.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <Panel title={`الطلبات ومصادرها (${rows.length})`}>
      <div className="admin-filters">
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="المصدر">
          <option value="">كل المصادر</option>
          {TRAFFIC_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع المصدر">
          <option value="">كل الأنواع</option>
          {SOURCE_TYPES.map((item) => <option key={item} value={item}>{TYPE_LABELS[item]}</option>)}
        </select>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="الحملة">
          <option value="">كل الحملات</option>
          <option value="-">بدون حملة</option>
          {campaigns.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
        </select>
        <label>من <input type="date" value={from} min={report.range.from} max={report.range.to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>لحد <input type="date" value={to} min={report.range.from} max={report.range.to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {rowError && <p className="admin-error" role="alert">{rowError}</p>}
      {rows.length === 0 ? <Empty text="مفيش طلبات بالفلاتر دي." /> : (
        <div className="admin-table-wrap">
          <table className="admin-table orders">
            <thead>
              <tr>
                <th>رقم الطلب</th><th>التاريخ</th><th>القيمة</th><th>الحالة</th><th>Source</th><th>النوع</th><th>Campaign</th><th>Ad Content</th>
                <th>First Touch</th><th>Last Touch</th><th>Landing Page</th><th>المحافظة</th><th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td dir="ltr" className="mono">{row.orderId}</td>
                  <td dir="ltr">{new Date(row.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{formatEGP(row.value)}{row.confirmedValue !== null && row.confirmedValue !== row.value && <small> (اتحصل {formatEGP(row.confirmedValue)})</small>}</td>
                  <td><span className={`status ${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td><span className="dot" style={{ background: SOURCE_COLORS[row.source] }} />{row.source}{row.hasFbclid && <small> · fbclid</small>}</td>
                  <td>{row.sourceType}</td>
                  <td>{row.campaign || "—"}</td>
                  <td>{row.adContent || "—"}</td>
                  <td>{row.firstTouch}</td>
                  <td>{row.lastTouch}</td>
                  <td dir="ltr">{row.landingPage || "—"}</td>
                  <td>{row.governorate}</td>
                  <td className="actions">
                    {row.status !== "confirmed" && (
                      <button type="button" disabled={busyId === row.orderId} onClick={() => void update(row, "confirmed")} title="بيع مؤكد"><CheckCircle2 size={16} /> تأكيد</button>
                    )}
                    {row.status !== "cancelled" && (
                      <button type="button" disabled={busyId === row.orderId} onClick={() => void update(row, "cancelled")} title="إلغاء" className="danger"><XCircle size={16} /> إلغاء</button>
                    )}
                    {row.status !== "submitted" && (
                      <button type="button" disabled={busyId === row.orderId} onClick={() => void update(row, "submitted")} title="رجوع لمستني تأكيد"><RotateCcw size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-muted small">الاسم والتليفون والعنوان مش متخزنين هنا. تلاقيهم في رسالة الطلب على تيليجرام برقم الطلب.</p>
    </Panel>
  );
}

function TypeTable({ rows }: { rows: Report["byType"] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table compact">
        <thead><tr><th>النوع</th><th>Sessions</th><th>Submitted</th><th>Confirmed</th><th>قيمة المؤكد</th><th>Conv.</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.type}>
              <td><span className="dot" style={{ background: TYPE_COLORS[row.type] }} />{TYPE_LABELS[row.type]}</td>
              <td>{integer.format(row.sessions)}</td>
              <td>{row.submitted}</td>
              <td>{row.confirmed}</td>
              <td>{formatEGP(row.confirmedValue)}</td>
              <td>{percent(row.submittedConversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" }) {
  return (
    <div className={`admin-card${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Charts render left-to-right inside the RTL page so axes and legends stay readable. */
function ChartBox({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div className="admin-chart" dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Empty({ text = "مفيش بيانات في الفترة دي لسه." }: { text?: string }) {
  return <p className="admin-muted empty">{text}</p>;
}
