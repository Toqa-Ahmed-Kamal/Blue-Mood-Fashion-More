"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, BadgeCheck, ChartColumn, ClipboardList, CheckCircle2, PackageCheck, ExternalLink, Eye, LogOut, Menu, Package, PanelRightClose, Pencil, RefreshCw, RotateCcw, Route, ShoppingBag, Undo2, Wallet, X, XCircle } from "lucide-react";
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

import { AllOrdersTab } from "@/components/admin/all-orders";
import { OrderEditDialog } from "@/components/admin/order-edit-dialog";
import { editRecordProducts, editTotals } from "@/lib/order-edit";
import { OldOrdersTab } from "@/components/admin/old-orders";
import { WhatsAppLink, WhatsAppMenu, WhatsAppTargetPicker } from "@/components/admin/whatsapp-link";
import { FinanceTab } from "@/components/admin/finance";
import { QuantitySummaryTab } from "@/components/admin/quantity-summary";
import type { Touch } from "@/lib/attribution";
import type { AnalyticsOrder, AnalyticsReport, OrderRow, OrderStatus } from "@/lib/analytics-report";
import { confirmationMessage, orderMessage, unavailableMessage, weightMessage, whatsappChatUrl } from "@/lib/customer-whatsapp";
import { formatEGP } from "@/lib/format";
import type { JourneyEntry } from "@/lib/journey";
import type { OrderDetails } from "@/lib/order-vault";
import { findProduct } from "@/lib/site-data";
import { SOURCE_TYPES, TRAFFIC_SOURCES, sourceTypeOf, type SourceType, type TrafficSource } from "@/lib/traffic-source";

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
const STATUS_LABELS: Record<OrderStatus, string> = { submitted: "مستني تأكيد", confirmed: "بيع مؤكد", delivered: "تم الاستلام", cancelled: "اتلغى", returned: "مرتجع" };

const PRESETS = [
  { id: "7", label: "٧ أيام", days: 7 },
  { id: "30", label: "٣٠ يوم", days: 30 },
  { id: "90", label: "٩٠ يوم", days: 90 },
  { id: "all", label: "الكل", days: 400 },
] as const;

const TABS = [
  { id: "all", label: "كل الأوردرات", icon: ClipboardList },
  { id: "traffic", label: "الزيارات", icon: ChartColumn },
  { id: "journey", label: "رحلة العميلة والمنتجات", icon: Route },
  { id: "orders", label: "الأوردرات", icon: ShoppingBag },
  { id: "old", label: "الأوردرات القديمة", icon: Archive },
  { id: "quantities", label: "حصر كميات المصنع", icon: Package },
  { id: "finance", label: "الإدارة المالية", icon: Wallet },
] as const;
const SIDEBAR_KEY = "bm-admin-sidebar";
const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches;
type TabId = (typeof TABS)[number]["id"];

const integer = new Intl.NumberFormat("en-US");
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(value < 0.1 ? 2 : 1)}%`);
const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const cairoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);
const daysAgo = (days: number) => cairoDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
const cairoTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });
const productName = (id: string) => findProduct(id)?.name ?? id;

type Report = AnalyticsReport;
type OrderUpdate = (id: string, status: OrderStatus, value: number | null, at: string | null) => void;
type DepositUpdate = (id: string, deposit: OrderRow["deposit"]) => void;

export function AnalyticsDashboard() {
  const router = useRouter();
  const [preset, setPreset] = useState<string>("30");
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Opens on "كل الأوردرات": the section used every day.
  const [tab, setTab] = useState<TabId>("all");
  // Old Orders stays mounted once opened, so an import preview is not lost when switching tabs.
  const [oldOpened, setOldOpened] = useState(false);
  // Sections sidebar: open by default on wide screens, closed on phones; the choice is remembered.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(SIDEBAR_KEY);
    } catch {
      saved = null;
    }
    // Reading the saved choice after mount keeps server and browser markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarOpen(isNarrow() ? false : saved !== "closed");
  }, []);

  function toggleSidebar() {
    setSidebarOpen((open) => {
      if (!isNarrow()) {
        try {
          window.localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
        } catch {
          // Not remembered; still toggles.
        }
      }
      return !open;
    });
  }

  function chooseTab(id: TabId) {
    setTab(id);
    if (id === "old") setOldOpened(true);
    if (isNarrow()) setSidebarOpen(false);
  }

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

  function applyDeposit(orderId: string, deposit: OrderRow["deposit"]) {
    setReport((current) => current && { ...current, orders: current.orders.map((row) => (row.orderId === orderId ? { ...row, deposit } : row)) });
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
    <div className={`admin admin-shell${sidebarOpen ? " sidebar-open" : ""}`} dir="rtl">
      <aside className="admin-sidebar" id="admin-sidebar" aria-label="أقسام الداشبورد" hidden={!sidebarOpen}>
        <div className="admin-sidebar-head">
          <strong>الأقسام</strong>
          <button type="button" className="admin-icon-btn small" onClick={toggleSidebar} aria-label="قفل القائمة"><PanelRightClose size={16} /></button>
        </div>
        <nav role="tablist" aria-orientation="vertical" aria-label="أقسام الداشبورد">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`panel-${item.id}`}
                className={tab === item.id ? "active" : ""}
                onClick={() => chooseTab(item.id)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === "orders" && report && report.totals.pending > 0 && <span className="admin-badge">{report.totals.pending}</span>}
              </button>
            );
          })}
        </nav>
      </aside>
      {sidebarOpen && <button type="button" className="admin-sidebar-backdrop" aria-label="قفل القائمة" onClick={() => setSidebarOpen(false)} />}

      <div className="admin-main">
      <header className="admin-header">
        <div className="admin-header-title">
          <button
            type="button"
            className="admin-icon-btn"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? "قفل قائمة الأقسام" : "فتح قائمة الأقسام"}
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
          >
            <Menu size={18} />
          </button>
          <div>
            <p className="admin-kicker">Blue Mood · Private · {TABS.find((item) => item.id === tab)?.label}</p>
            <h1>Analytics</h1>
          </div>
        </div>
        <div className="admin-header-actions">
          <WhatsAppTargetPicker />
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
      {report && (
        <>
          <OverviewCards report={report} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "all" && <AllOrdersTab />}
            {tab === "traffic" && <TrafficTab report={report} />}
            {tab === "journey" && <JourneyTab report={report} />}
            {tab === "orders" && <OrdersPanel report={report} onOrderUpdated={applyOrderUpdate} onDepositUpdated={applyDeposit} onEdited={() => void load(range.from, range.to)} />}
            {oldOpened && <div hidden={tab !== "old"}><OldOrdersTab active={tab === "old"} /></div>}
            {tab === "quantities" && <QuantitySummaryTab />}
            {tab === "finance" && <FinanceTab />}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function OverviewCards({ report }: { report: Report }) {
  const { totals } = report;
  const type = (name: SourceType) => report.byType.find((row) => row.type === name);
  const paid = type("Paid");
  const organic = type("Organic");
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
      {totals.pending > 0 && <p className="admin-note">فيه {totals.pending} طلب لسه مستني تأكيد. راجعيهم من تبويب الأوردرات علشان أرقام المبيعات المؤكدة تبقى صح.</p>}
    </>
  );
}

// ── 1. Traffic ─────────────────────────────────────────────────────────────

function TrafficTab({ report }: { report: Report }) {
  const sourcesWithSessions = report.bySource.filter((row) => row.sessions > 0);
  const activeSources = report.bySource.filter((row) => row.sessions > 0 || row.submitted > 0);
  const metaAds = report.bySource.filter((row) => row.source === "Facebook Ads" || row.source === "Instagram Ads");

  return (
    <>
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

      <SourceCampaignPanel report={report} />

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
    </>
  );
}

function SourceCampaignPanel({ report }: { report: Report }) {
  const [source, setSource] = useState("");
  const rows = report.sourceCampaigns.filter((row) => (row.sessions > 0 || row.submitted > 0) && (!source || row.source === source));
  const sources = [...new Set(report.sourceCampaigns.map((row) => row.source))];
  return (
    <Panel
      title="الزيارات حسب المصدر والحملة"
      action={(
        <select className="admin-select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="المصدر">
          <option value="">كل المصادر</option>
          {sources.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      )}
    >
      {rows.length === 0 ? <Empty /> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>المصدر</th><th>النوع</th><th>الحملة</th><th>Sessions</th><th>النسبة</th><th>Submitted</th><th>Confirmed</th><th>قيمة المؤكد</th><th>Conv. طلبات</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.source}|${row.campaign}`}>
                  <td><span className="dot" style={{ background: SOURCE_COLORS[row.source] }} />{row.source}</td>
                  <td>{TYPE_LABELS[sourceTypeOf(row.source)]}</td>
                  <td>{row.campaign || <span className="admin-muted">بدون حملة</span>}</td>
                  <td>{integer.format(row.sessions)}</td>
                  <td>{percent(row.sessionShare)}</td>
                  <td>{row.submitted}</td>
                  <td>{row.confirmed}</td>
                  <td>{formatEGP(row.confirmedValue)}</td>
                  <td>{percent(row.submittedConversion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-muted small">تفصيل المصدر مع الحملة بيتسجل من أول التحديث ده. الزيارات الأقدم موجودة في جداول المصادر والحملات فوق، والطلبات الأقدم ظاهرة هنا عادي.</p>
    </Panel>
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

// ── 2. Customer journey & products ─────────────────────────────────────────

function JourneyTab({ report }: { report: Report }) {
  const { funnel } = report;
  const steps = [
    { label: "دخلت الموقع", count: funnel.sessions },
    { label: "فتحت منتج", count: funnel.view },
    { label: "أضافت للسلة", count: funnel.add },
    { label: "فتحت صفحة الطلب", count: funnel.checkout },
    { label: "بعتت الطلب", count: funnel.order },
  ];
  const [metric, setMetric] = useState<"views" | "adds">("adds");
  const top = report.products
    .filter((row) => row[metric] > 0)
    .toSorted((a, b) => b[metric] - a[metric])
    .slice(0, 8)
    .map((row) => ({ ...row, label: row.name.length > 26 ? `${row.name.slice(0, 25)}…` : row.name }));

  return (
    <>
      <Panel title="رحلة العميلة: من الدخول لحد إرسال الطلب">
        <div className="admin-funnel">
          {steps.map((step, index) => {
            const share = ratio(step.count, funnel.sessions);
            const fromPrevious = index === 0 ? null : ratio(step.count, steps[index - 1].count);
            return (
              <div className="admin-funnel-step" key={step.label}>
                <div className="admin-funnel-head">
                  <span>{index + 1}. {step.label}</span>
                  <strong>{integer.format(step.count)}</strong>
                </div>
                <div className="admin-funnel-track"><span style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }} /></div>
                <small>
                  {index === 0 ? "كل الجلسات" : `${percent(share)} من الجلسات · ${percent(fromPrevious)} من الخطوة اللي قبلها`}
                </small>
              </div>
            );
          })}
        </div>
        <p className="admin-muted small">كل خطوة بتتحسب مرة واحدة لكل جلسة. &quot;فتحت منتج&quot; يعني فتحت صورة المنتج بالكامل. الرحلة بتتسجل من أول التحديث ده، فالأرقام الأقدم ممكن تبان أقل. رحلة كل عميلة بالتفصيل موجودة جوه تفاصيل الأوردر.</p>
      </Panel>

      <Panel
        title="المنتجات الأكثر مشاهدة وإضافة للسلة"
        action={(
          <div className="admin-presets small" role="group">
            <button type="button" className={metric === "adds" ? "active" : ""} onClick={() => setMetric("adds")}>إضافة للسلة</button>
            <button type="button" className={metric === "views" ? "active" : ""} onClick={() => setMetric("views")}>مشاهدة</button>
          </div>
        )}
      >
        {top.length === 0 ? <Empty /> : (
          <ChartBox height={Math.max(220, top.length * 36)}>
            <BarChart data={top} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ecdfd6" />
              <XAxis type="number" allowDecimals={false} fontSize={11} />
              <YAxis type="category" dataKey="label" width={170} fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="views" name="مشاهدات" fill="#7a96be" radius={[0, 4, 4, 0]} />
              <Bar dataKey="adds" name="إضافات للسلة" fill="#d6246e" radius={[0, 4, 4, 0]} />
              <Bar dataKey="uniqueAdders" name="عميلات مختلفات" fill="#1c9d50" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartBox>
        )}
      </Panel>

      <ProductsTable report={report} />
    </>
  );
}

function ProductsTable({ report }: { report: Report }) {
  const [sort, setSort] = useState<"adds" | "views" | "uniqueAdders">("adds");
  const rows = report.products.toSorted((a, b) => b[sort] - a[sort] || b.adds - a.adds || b.views - a.views);
  const header = (key: typeof sort, label: string) => (
    <th aria-sort={sort === key ? "descending" : "none"}>
      <button type="button" className={`admin-sort${sort === key ? " active" : ""}`} onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button>
    </th>
  );
  return (
    <Panel title={`كل المنتجات (${rows.length})`}>
      <div className="admin-table-wrap">
        <table className="admin-table products">
          <thead>
            <tr>
              <th>المنتج</th><th>القسم</th>
              {header("views", "مشاهدات")}
              {header("adds", "مرات الإضافة للسلة")}
              {header("uniqueAdders", "عميلات مختلفات أضافوه")}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId} className={row.views === 0 && row.adds === 0 ? "dim" : ""}>
                <td>
                  <a className="admin-product" href={row.image} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail, no optimisation needed */}
                    <img src={row.image} alt="" width={34} height={34} loading="lazy" />
                    <span>{row.name}</span>
                  </a>
                </td>
                <td>{row.category}</td>
                <td>{integer.format(row.views)}</td>
                <td>{integer.format(row.adds)}</td>
                <td>{integer.format(row.uniqueAdders)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-muted small">مرات الإضافة = عدد القطع اللي اتضافت للسلة (اختيار قطعة جوه العرض بيتحسب إضافة). عميلات مختلفات = عدد المتصفحات المختلفة اللي أضافت المنتج.</p>
    </Panel>
  );
}

// ── 3. Orders ──────────────────────────────────────────────────────────────

/** Confirm / cancel / reset an order (shared by the table and the details window). */
function useOrderStatus(onOrderUpdated: OrderUpdate, onDepositUpdated?: DepositUpdate) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function update(orderId: string, value: number, next: OrderStatus) {
    let confirmedValue: number | null = null;
    if (next === "confirmed") {
      const answer = window.prompt(`القيمة اللي اتحصلت فعلاً للطلب ${orderId} (سيبيها زي ما هي لو مفيش تغيير):`, String(value));
      if (answer === null) return false;
      // Empty answer = keep the order total (null), never 0.
      const digits = answer.replace(/[^\d.]/g, "");
      confirmedValue = digits ? Number(digits) : null;
      if (confirmedValue !== null && (!Number.isFinite(confirmedValue) || confirmedValue <= 0)) {
        setError("اكتبي قيمة صحيحة أكبر من صفر، أو سيبي الخانة فاضية علشان نستخدم قيمة الطلب.");
        return false;
      }
    }
    setBusyId(orderId);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, confirmedValue }),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return false;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ التغيير.");
        return false;
      }
      onOrderUpdated(orderId, result.order.status, result.order.confirmedValue, result.order.statusAt);
      return true;
    } catch {
      setError("مفيش اتصال. جربي تاني.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  /** Records the deposit that confirmed the booking (empty answer removes it). */
  async function setDeposit(orderId: string, current: number | null) {
    const answer = window.prompt(`مبلغ الديبوزيت اللي العميلة دفعته لتأكيد الحجز ${orderId} (ج.م) — سيبيها فاضية لإلغاء الديبوزيت:`, current === null ? "" : String(current));
    if (answer === null) return false;
    const digits = answer.replace(/[^\d.]/g, "");
    const amount = digits ? Number(digits) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      setError("اكتبي مبلغ صحيح أكبر من صفر، أو سيبيها فاضية.");
      return false;
    }
    setBusyId(orderId);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deposit: amount }) });
      if (response.status === 401) {
        router.replace("/admin/login");
        return false;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) {
        setError(result?.error?.message ?? "مقدرناش نحفظ الديبوزيت.");
        return false;
      }
      onDepositUpdated?.(orderId, result.order.deposit);
      return true;
    } catch {
      setError("مفيش اتصال. جربي تاني.");
      return false;
    } finally {
      setBusyId("");
    }
  }

  return { update, setDeposit, busyId, error };
}

function StatusActions({ orderId, value, status, busy, onChange }: { orderId: string; value: number; status: OrderStatus; busy: boolean; onChange: (id: string, value: number, next: OrderStatus) => void }) {
  return (
    <>
      {status !== "confirmed" && status !== "delivered" && (
        <button type="button" disabled={busy} onClick={() => onChange(orderId, value, "confirmed")} title="بيع مؤكد"><CheckCircle2 size={16} /> تأكيد</button>
      )}
      {status === "confirmed" && (
        <button type="button" disabled={busy} onClick={() => onChange(orderId, value, "delivered")} title="العميلة استلمت" className="good"><PackageCheck size={16} /> تم الاستلام</button>
      )}
      {status !== "cancelled" && status !== "returned" && status !== "delivered" && (
        <button type="button" disabled={busy} onClick={() => onChange(orderId, value, "cancelled")} title="إلغاء" className="danger"><XCircle size={16} /> إلغاء</button>
      )}
      {(status === "confirmed" || status === "delivered") && (
        <button type="button" disabled={busy} onClick={() => onChange(orderId, value, "returned")} title="الأوردر رجع" className="danger"><Undo2 size={16} /> مرتجع</button>
      )}
      {status !== "submitted" && (
        <button type="button" disabled={busy} onClick={() => onChange(orderId, value, "submitted")} title="رجوع لمستني تأكيد" aria-label="رجوع لمستني تأكيد"><RotateCcw size={15} /></button>
      )}
    </>
  );
}

function OrdersPanel({ report, onOrderUpdated, onDepositUpdated, onEdited }: { report: Report; onOrderUpdated: OrderUpdate; onDepositUpdated: DepositUpdate; onEdited: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [type, setType] = useState("");
  const [campaign, setCampaign] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { update, setDeposit, busyId, error } = useOrderStatus(onOrderUpdated, onDepositUpdated);

  const campaigns = useMemo(() => [...new Set(report.orders.map((row) => row.campaign).filter(Boolean))].sort(), [report.orders]);
  const rows = report.orders.filter((row) =>
    (!source || row.source === source)
    && (!type || row.sourceType === type)
    && (!campaign || (campaign === "-" ? !row.campaign : row.campaign === campaign))
    && (!status || row.status === status)
    && (!from || row.day >= from)
    && (!to || row.day <= to));
  const openRow = openId ? report.orders.find((row) => row.orderId === openId) ?? null : null;
  const [view, setView] = useState<"cards" | "table">("cards");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const shown = rows.slice(0, limit);
  const details = useOrdersDetails(view === "cards" ? shown.map((row) => row.orderId) : []);

  return (
    <Panel
      title={`الأوردرات (${rows.length})`}
      action={(
        <div className="admin-presets small" role="group" aria-label="طريقة العرض">
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>تفاصيل كاملة</button>
          <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>جدول المصادر</button>
        </div>
      )}
    >
      <div className="admin-filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((item) => <option key={item} value={item}>{STATUS_LABELS[item]}</option>)}
        </select>
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
        <label>من <input type="date" value={from} min={report.range.from} max={report.range.to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>لحد <input type="date" value={to} min={report.range.from} max={report.range.to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {details.error && <p className="admin-error" role="alert">{details.error}</p>}
      {rows.length === 0 ? <Empty text="مفيش طلبات بالفلاتر دي." /> : view === "cards" ? (
        <>
          <div className="admin-orders">
            {shown.map((row) => (
              <OrderCard
                key={row.orderId}
                row={row}
                details={details.byId[row.orderId]}
                vaultConfigured={details.vaultConfigured}
                busy={busyId === row.orderId}
                onChange={(id, value, next) => void update(id, value, next)}
                onJourney={() => setOpenId(row.orderId)}
                onDeposit={() => void setDeposit(row.orderId, row.deposit?.amount ?? null)}
                onEdit={() => setEditId(row.orderId)}
              />
            ))}
          </div>
          {rows.length > shown.length && (
            <button type="button" className="admin-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              اعرضي {Math.min(PAGE_SIZE, rows.length - shown.length)} أوردر كمان ({rows.length - shown.length} باقيين)
            </button>
          )}
        </>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table orders">
            <thead>
              <tr>
                <th>رقم الطلب</th><th>التاريخ</th><th>القيمة</th><th>القطع</th><th>الحالة</th><th>Source</th><th>النوع</th><th>Campaign</th><th>Ad Content</th>
                <th>First Touch</th><th>Last Touch</th><th>Landing Page</th><th>المحافظة</th><th>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.orderId}>
                  <td dir="ltr" className="mono"><button type="button" className="admin-link" onClick={() => setOpenId(row.orderId)}>{row.orderId}</button></td>
                  <td dir="ltr">{cairoTime(row.createdAt)}</td>
                  <td>{formatEGP(row.value)}{row.confirmedValue !== null && row.confirmedValue !== row.value && <small> (اتحصل {formatEGP(row.confirmedValue)})</small>}</td>
                  <td>{row.pieces}</td>
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
                    <button type="button" onClick={() => setOpenId(row.orderId)} title="تفاصيل الأوردر"><Eye size={15} /> تفاصيل</button>
                    <StatusActions orderId={row.orderId} value={row.value} status={row.status} busy={busyId === row.orderId} onChange={(id, value, next) => void update(id, value, next)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-muted small">بيانات العميلة متخزنة متشفرة وبتتفك على السيرفر بس لما تفتحي الداشبورد. &quot;رحلة العميلة&quot; بيوريكي خطواتها من أول ما دخلت لحد ما طلبت.</p>
      {openId && (
        <OrderDialog
          orderId={openId}
          row={openRow}
          busy={busyId === openId}
          error={error}
          onChange={(id, value, next) => void update(id, value, next)}
          onClose={() => setOpenId(null)}
        />
      )}
      {editId && details.byId[editId] && (() => {
        const editRow = report.orders.find((row) => row.orderId === editId);
        const current = details.byId[editId]!;
        if (!editRow) return null;
        return (
          <OrderEditDialog
            order={{ ...current, source: "site", offerName: current.offerName || editRow.offerName, products: current.products.map((product) => ({ modelId: product.modelId, name: product.name, quantity: product.quantity, unitPrice: product.unitPrice })) }}
            onClose={() => setEditId(null)}
            onSaved={(_saved, edit) => {
              setEditId(null);
              const totals = editTotals(edit);
              // Shown at once; then the stored copy and the report are fetched again.
              details.put(editId, { ...current, ...edit, governorate: edit.governorate || current.governorate, offerName: edit.offerName || current.offerName, products: editRecordProducts(edit), itemsTotal: totals.itemsTotal, subtotal: totals.subtotal, total: totals.total });
              details.reload(editId);
              onEdited();
            }}
          />
        );
      })()}
    </Panel>
  );
}

const PAGE_SIZE = 30;

/** Loads (and caches) the decrypted details of the orders currently shown. */
function useOrdersDetails(orderIds: string[]) {
  const [version, setVersion] = useState(0);
  const router = useRouter();
  const [byId, setById] = useState<Record<string, OrderDetails | null | undefined>>({});
  const [vaultConfigured, setVaultConfigured] = useState(true);
  const [error, setError] = useState("");
  const requested = useRef(new Set<string>());
  const idsKey = orderIds.join(",");

  useEffect(() => {
    // Only ask for orders not fetched yet (the list grows with "show more").
    const ids = idsKey.split(",").filter((id) => id && !requested.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => requested.current.add(id));
    (async () => {
      try {
        const response = await fetch(`/api/admin/orders?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          ids.forEach((id) => requested.current.delete(id));
          setError(result?.error?.message ?? "مقدرناش نجيب تفاصيل الأوردرات.");
          return;
        }
        setError("");
        setVaultConfigured(result.vaultConfigured);
        setById((current) => ({ ...current, ...result.details }));
      } catch {
        ids.forEach((id) => requested.current.delete(id));
        setError("مفيش اتصال. جربي تاني.");
      }
    })();
  }, [idsKey, router, version]);

  /** Fetches one order's details again (after it was edited). */
  function reload(orderId: string) {
    requested.current.delete(orderId);
    setVersion((current) => current + 1);
  }

  function put(orderId: string, value: OrderDetails) {
    setById((current) => ({ ...current, [orderId]: value }));
  }

  return { byId, vaultConfigured, error, reload, put };
}

function OrderCard({ row, details, vaultConfigured, busy, onChange, onJourney, onDeposit, onEdit }: {
  row: OrderRow;
  /** undefined = still loading, null = not stored / unreadable. */
  details: OrderDetails | null | undefined;
  vaultConfigured: boolean;
  busy: boolean;
  onChange: (id: string, value: number, next: OrderStatus) => void;
  onJourney: () => void;
  onDeposit: () => void;
  onEdit: () => void;
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const chat = (text: string) => (details ? whatsappChatUrl(details.phone, text) : null);
  const products = details?.products ?? row.products.map((product) => ({ ...product, name: productName(product.modelId), fit: "", unitPrice: null as number | null, link: null as string | null }));
  return (
    <article className={`admin-order status-${row.status}`}>
      <header className="admin-order-head">
        <div>
          <strong dir="ltr" className="mono">{row.orderId}</strong>
          <span className="admin-muted" dir="ltr">{cairoTime(row.createdAt)}</span>
          <span className={`status ${row.status}`}>{STATUS_LABELS[row.status]}</span>
          {row.deposit && <span className="admin-deposit"><BadgeCheck size={14} aria-hidden="true" /> حجز مؤكد بديبوزيت {formatEGP(row.deposit.amount)}</span>}
        </div>
        <div className="admin-order-source">
          <span className="dot" style={{ background: SOURCE_COLORS[row.source] }} />{row.source}
          {row.campaign && <small> · {row.campaign}</small>}
        </div>
      </header>

      <div className="admin-order-body">
        <section className="admin-order-customer" aria-label="بيانات العميلة">
          {details ? (
            <dl className="admin-dl">
              <div><dt>الاسم</dt><dd>{details.customerName}</dd></div>
              <div><dt>الموبايل</dt><dd dir="ltr"><a href={`tel:${details.phone}`}>{details.phone}</a>{details.alternatePhone && <> · <a href={`tel:${details.alternatePhone}`}>{details.alternatePhone}</a></>}</dd></div>
              <div className="wide">
                <WhatsAppMenu options={[
                  { label: "✅ تأكيد الطلب والتوصيل (إنستا باي)", href: chat(confirmationMessage({ name: details.customerName, orderId: row.orderId, shippingCost: row.shippingCost })) },
                  { label: "⚖️ سؤال عن الوزن", href: chat(weightMessage({ name: details.customerName, orderId: row.orderId })) },
                  { label: "💬 رسالة عادية", href: chat(orderMessage({ name: details.customerName, orderId: row.orderId })) },
                ]} />
              </div>
              <div><dt>المحافظة / المنطقة</dt><dd>{details.governorate} — {details.area}</dd></div>
              <div className="wide"><dt>العنوان</dt><dd>{details.address}</dd></div>
              {details.notes && <div className="wide"><dt>ملاحظات</dt><dd className="pre">{details.notes}</dd></div>}
              {details.importedFrom === "telegram" && <div className="wide"><dd className="admin-muted">البيانات دي اتكملت من رسالة تيليجرام</dd></div>}
            </dl>
          ) : details === undefined ? (
            <p className="admin-muted">جاري تحميل بيانات العميلة…</p>
          ) : (
            <p className="admin-muted small">
              {vaultConfigured
                ? "بيانات العميلة مش متخزنة للأوردر ده (اتسجل قبل تفعيل الحفظ). ارفعي ملف تيليجرام في تبويب \"الأوردرات القديمة\" وهتتكمل تلقائيًا."
                : "بيانات العميلة مش بتتخزن لسه لأن ORDER_DATA_KEY مش متضاف على Vercel. تلاقيها في تيليجرام برقم الطلب."}
              {" "}المحافظة: {row.governorate}
            </p>
          )}
        </section>

        <section className="admin-order-items" aria-label="المنتجات">
          <p className="admin-order-offer">{row.offerName}</p>
          <ul>
            {products.map((product, index) => {
              const image = findProduct(product.modelId)?.image;
              return (
                <li key={`${product.modelId}-${index}`}>
                  {image ? (
                    <a href={product.link ?? image} target="_blank" rel="noreferrer" className="admin-order-thumb" aria-label={`صورة ${product.name}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- small admin thumbnail */}
                      <img src={image} alt="" width={56} height={56} loading="lazy" />
                    </a>
                  ) : <span className="admin-order-thumb missing" title="الصورة مش متاحة">مفيش صورة</span>}
                  <div>
                    <strong>{product.name}</strong>
                    {product.fit && <small>{product.fit}</small>}
                  </div>
                  <span className="qty">× {product.quantity}</span>
                  <span className="price">{!details ? "" : product.unitPrice === null ? "ضمن العرض" : formatEGP(product.unitPrice * product.quantity)}</span>
                  {details && (
                    <WhatsAppLink
                      compact
                      href={chat(unavailableMessage({ name: details.customerName, orderId: row.orderId, productName: product.name, productId: product.modelId, origin, category: findProduct(product.modelId)?.category }))}
                      label={`${product.name} مش متوفر — ابعتي بدائل`}
                    />
                  )}
                  {details && findProduct(product.modelId)?.category === "winter-pajamas" && (
                    <WhatsAppLink
                      compact
                      text="وزنها؟"
                      href={chat(weightMessage({ name: details.customerName, orderId: row.orderId, productName: product.name, productId: product.modelId }))}
                      label={`اسألي عن وزنها علشان ${product.name}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <dl className="admin-totals">
            {details && details.offerPrice > 0 && <div><dt>سعر العرض</dt><dd>{formatEGP(details.offerPrice)}</dd></div>}
            {details && details.itemsTotal > 0 && <div><dt>القطع المنفردة</dt><dd>{formatEGP(details.itemsTotal)}</dd></div>}
            <div><dt>الشحن</dt><dd>{row.shippingCost === null ? "لسه هيتأكد" : formatEGP(row.shippingCost)}</dd></div>
            <div className="grand"><dt>الإجمالي</dt><dd>{row.total === null ? `${formatEGP(row.subtotal)} + الشحن` : formatEGP(row.total)}</dd></div>
            {row.confirmedValue !== null && row.confirmedValue !== row.value && <div><dt>اتحصل فعلاً</dt><dd>{formatEGP(row.confirmedValue)}</dd></div>}
            {row.deposit && <div><dt>ديبوزيت مدفوع</dt><dd>− {formatEGP(row.deposit.amount)}</dd></div>}
            {row.deposit && row.total !== null && <div className="grand"><dt>الباقي عند الاستلام</dt><dd>{formatEGP(Math.max(0, row.total - row.deposit.amount))}</dd></div>}
          </dl>
        </section>
      </div>

      <footer className="admin-order-actions actions">
        <button type="button" onClick={onJourney}><Eye size={15} /> رحلة العميلة</button>
        <button type="button" disabled={busy || !details} onClick={onEdit} title={details ? "تبديل أو إضافة أو شيل منتجات، وتعديل البيانات والشحن" : "بيانات الأوردر مش متسجلة علشان يتعدل"}><Pencil size={15} /> تعديل الأوردر</button>
        <button type="button" disabled={busy} onClick={onDeposit} className={row.deposit ? "deposit-on" : undefined}><BadgeCheck size={15} /> {row.deposit ? "تعديل الديبوزيت" : "تأكيد بديبوزيت"}</button>
        <StatusActions orderId={row.orderId} value={row.value} status={row.status} busy={busy} onChange={onChange} />
      </footer>
    </article>
  );
}

type OrderDetailsResponse = {
  order: AnalyticsOrder;
  details: OrderDetails | null;
  detailsState: "ok" | "not_stored" | "unreadable";
  journey: JourneyEntry[];
  vaultConfigured: boolean;
};

function OrderDialog({ orderId, row, busy, error, onChange, onClose }: {
  orderId: string;
  row: OrderRow | null;
  busy: boolean;
  error: string;
  onChange: (id: string, value: number, next: OrderStatus) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<OrderDetailsResponse | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/orders/${orderId}`, { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/admin/login");
          return;
        }
        const result = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !result?.success) setLoadError(result?.error?.message ?? "مقدرناش نجيب تفاصيل الأوردر.");
        else setData(result);
      } catch {
        if (!cancelled) setLoadError("مفيش اتصال. جربي تاني.");
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, router]);

  // The table row is updated right away after a status change; the fetched copy may be older.
  const status = row?.status ?? data?.order.status ?? "submitted";
  const value = row?.value ?? (data ? data.order.total ?? data.order.subtotal : 0);
  const details = data?.details ?? null;

  return (
    <dialog
      ref={dialogRef}
      className="admin-dialog"
      dir="rtl"
      aria-labelledby="order-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="admin-dialog-inner">
        <header className="admin-dialog-head">
          <div>
            <h2 id="order-dialog-title" dir="ltr">{orderId}</h2>
            <p className="admin-muted">
              {data && cairoTime(data.order.createdAt)} · <span className={`status ${status}`}>{STATUS_LABELS[status]}</span>
              {row?.confirmedValue != null && <> · اتحصل {formatEGP(row.confirmedValue)}</>}
            </p>
          </div>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        {loadError && <p className="admin-error" role="alert">{loadError}</p>}
        {!data && !loadError && <p className="admin-muted">جاري التحميل…</p>}

        {data && (
          <div className="admin-dialog-body">
            <section className="admin-detail">
              <h3>بيانات العميلة</h3>
              {details ? (
                <dl className="admin-dl">
                  <div><dt>الاسم</dt><dd>{details.customerName}</dd></div>
                  <div><dt>الموبايل</dt><dd dir="ltr"><a href={`tel:${details.phone}`}>{details.phone}</a></dd></div>
                  {details.alternatePhone && <div><dt>رقم تاني</dt><dd dir="ltr"><a href={`tel:${details.alternatePhone}`}>{details.alternatePhone}</a></dd></div>}
                  <div><dt>المحافظة</dt><dd>{details.governorate}</dd></div>
                  <div><dt>المنطقة</dt><dd>{details.area}</dd></div>
                  <div className="wide"><dt>العنوان</dt><dd>{details.address}</dd></div>
                  {details.notes && <div className="wide"><dt>ملاحظات</dt><dd className="pre">{details.notes}</dd></div>}
                  {details.importedFrom === "telegram" && <div className="wide"><dd className="admin-muted">البيانات دي اتكملت من رسالة تيليجرام (الأوردر اتسجل قبل حفظ بيانات العميلة).</dd></div>}
                </dl>
              ) : (
                <p className="admin-note">
                  {data.detailsState === "unreadable"
                    ? "بيانات العميلة متخزنة بس مش قادرين نفكها بالمفتاح الحالي (ORDER_DATA_KEY اتغير). تلاقيها في رسالة تيليجرام برقم الطلب."
                    : !data.vaultConfigured
                      ? "بيانات العميلة مش بتتخزن لسه لأن ORDER_DATA_KEY مش متضاف على Vercel. تلاقيها في رسالة تيليجرام برقم الطلب."
                      : "الأوردر ده اتسجل قبل تفعيل حفظ بيانات العميلة. ارفعي ملف تيليجرام في تبويب \"الأوردرات القديمة\" وبياناتها هتتكمل هنا تلقائيًا."}
                </p>
              )}
            </section>

            <section className="admin-detail">
              <h3>المنتجات · {data.order.offerName}</h3>
              <div className="admin-table-wrap">
                <table className="admin-table compact">
                  <thead><tr><th>المنتج</th><th>المقاس</th><th>الكمية</th><th>سعر القطعة</th><th>الإجمالي</th></tr></thead>
                  <tbody>
                    {(details?.products ?? data.order.products.map((product) => ({ ...product, name: productName(product.modelId), fit: "", unitPrice: null, link: null }))).map((product, index) => {
                      const image = findProduct(product.modelId)?.image;
                      return (
                        <tr key={`${product.modelId}-${index}`}>
                          <td>
                            {image ? (
                              <a className="admin-product" href={product.link ?? image} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail */}
                                <img src={image} alt="" width={34} height={34} loading="lazy" />
                                <span>{product.name}</span>
                                <ExternalLink size={12} aria-hidden="true" />
                              </a>
                            ) : <>{product.name} <small className="admin-muted">(الصورة مش متاحة)</small></>}
                          </td>
                          <td className="wrap">{product.fit || "—"}</td>
                          <td>{product.quantity}</td>
                          <td>{!details ? "—" : product.unitPrice === null ? "ضمن العرض" : formatEGP(product.unitPrice)}</td>
                          <td>{!details || product.unitPrice === null ? "—" : formatEGP(product.unitPrice * product.quantity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <dl className="admin-totals">
                {details && details.offerPrice > 0 && <div><dt>سعر العرض</dt><dd>{formatEGP(details.offerPrice)}</dd></div>}
                {details && details.itemsTotal > 0 && <div><dt>القطع المنفردة</dt><dd>{formatEGP(details.itemsTotal)}</dd></div>}
                <div><dt>المجموع</dt><dd>{formatEGP(data.order.subtotal)}</dd></div>
                <div><dt>الشحن</dt><dd>{data.order.shippingCost === null ? "لسه هيتأكد" : formatEGP(data.order.shippingCost)}</dd></div>
                <div className="grand"><dt>الإجمالي</dt><dd>{data.order.total === null ? `${formatEGP(data.order.subtotal)} + الشحن` : formatEGP(data.order.total)}</dd></div>
              </dl>
            </section>

            <section className="admin-detail">
              <h3>المصدر</h3>
              <dl className="admin-dl">
                <div><dt>المصدر</dt><dd><span className="dot" style={{ background: SOURCE_COLORS[data.order.source] }} />{data.order.source} · {data.order.sourceType}</dd></div>
                <div><dt>الحملة</dt><dd>{data.order.campaign || "—"}</dd></div>
                <div><dt>Ad Content</dt><dd>{data.order.adContent || "—"}</dd></div>
                <div><dt>Landing Page</dt><dd dir="ltr">{data.order.landingPage || "—"}</dd></div>
                <TouchDetails label="آخر زيارة (اللي اتحسب لها الطلب)" touch={data.order.lastTouch} />
                {data.order.firstTouch && data.order.firstTouch.at !== data.order.lastTouch?.at && <TouchDetails label="أول زيارة" touch={data.order.firstTouch} />}
              </dl>
            </section>

            <section className="admin-detail">
              <h3>رحلة العميلة</h3>
              <JourneyTimeline entries={data.journey} />
            </section>
          </div>
        )}

        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer className="admin-dialog-actions actions">
          <StatusActions orderId={orderId} value={value} status={status} busy={busy || !data} onChange={onChange} />
        </footer>
      </div>
    </dialog>
  );
}

function TouchDetails({ label, touch }: { label: string; touch: Touch | null }) {
  if (!touch) return null;
  const tags = [
    touch.utmSource && `utm_source=${touch.utmSource}`,
    touch.utmMedium && `utm_medium=${touch.utmMedium}`,
    touch.utmCampaign && `utm_campaign=${touch.utmCampaign}`,
    touch.utmContent && `utm_content=${touch.utmContent}`,
    touch.utmTerm && `utm_term=${touch.utmTerm}`,
  ].filter(Boolean);
  return (
    <div className="wide">
      <dt>{label}</dt>
      <dd className="admin-touch">
        <span>{touch.channel}{touch.at && <> · <time dir="ltr">{cairoTime(touch.at)}</time></>}</span>
        {tags.length > 0 && <code dir="ltr">{tags.join(" | ")}</code>}
        <span className="admin-muted">
          Facebook Click ID (fbclid): {touch.fbclid ? <code dir="ltr" title={touch.fbclid}>{touch.fbclid.length > 24 ? `${touch.fbclid.slice(0, 24)}…` : touch.fbclid}</code> : "مفيش"}
          {touch.landingPage && <> · صفحة الدخول <code dir="ltr">{touch.landingPage}</code></>}
          {touch.referrer && <> · جاي من <code dir="ltr">{touch.referrer}</code></>}
        </span>
      </dd>
    </div>
  );
}

const PAGE_NAMES: Record<string, string> = { "/": "الصفحة الرئيسية", "/checkout": "صفحة الطلب" };

function pageName(path: string) {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  if (path.startsWith("/offer/")) return "صفحة اختيار قطع العرض";
  return path;
}

function journeyText(entry: JourneyEntry) {
  switch (entry.e) {
    case "visit": {
      const tags = [entry.u && `source=${entry.u}`, entry.m && `medium=${entry.m}`, entry.n && `content=${entry.n}`].filter(Boolean).join(" | ");
      return `دخلت الموقع من ${entry.s}${entry.c ? ` · حملة ${entry.c}` : ""}${tags ? ` · ${tags}` : ""}${entry.f ? " · fbclid" : ""}${entry.r ? ` · جاية من ${entry.r}` : ""}${entry.l ? ` · أول صفحة ${entry.l}` : ""}`;
    }
    case "page": return `فتحت ${pageName(entry.l)}`;
    case "view": return `فتحت ${productName(entry.p)}`;
    case "add": return `أضافت ${productName(entry.p)} للسلة${entry.q > 1 ? ` × ${entry.q}` : ""}`;
    case "remove": return `شالت ${productName(entry.p)} من السلة${entry.q > 1 ? ` × ${entry.q}` : ""}`;
    case "checkout": return "بدأت إتمام الطلب (Initiate Checkout)";
    case "order": return `بعتت الطلب ${entry.o} · ${formatEGP(entry.v)}`;
  }
}

function JourneyTimeline({ entries }: { entries: JourneyEntry[] }) {
  if (entries.length <= 1) {
    return <p className="admin-muted small">مفيش خطوات متسجلة قبل الطلب. تسجيل الرحلة بدأ مع تحديث الداشبورد، فالأوردرات اللي قبله مالهاش رحلة، وكمان لو المتصفح مانع التتبع.</p>;
  }
  return (
    <ol className="admin-journey">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className={`step-${entry.e}`}>
          <time dir="ltr">{cairoTime(entry.at)}</time>
          <span>{journeyText(entry)}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────

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
