"use client";

// "الرسوم البيانية": one page of charts over everything — orders, sales and profit, order status and
// shipping, cancel reasons, pieces, categories, governorates, sources, margins, expenses and stock.
// Built from the same APIs the other sections use (no new data). One filter row on top scopes every
// chart; each chart has its table under it (the values never depend on colour or hover alone).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CANCEL_REASONS, type OrderStatus } from "@/lib/analytics-report";
import { ORDER_FILTERS, filterCounts, type UnifiedOrder } from "@/lib/all-orders";
import type { FinanceReport } from "@/lib/finance";
import { formatEGP } from "@/lib/format";
import { categoryInfo, findProduct, type CatalogCategory } from "@/lib/site-data";

// Categorical slots in fixed order (validated: adjacent CVD ΔE ≥ 9.1 on the white card). Slots 3 and 4 sit
// below 3:1 on white, so every chart carries its table.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
const ONE = SERIES[0];
const GRID = "#ece7e1";
const AXIS = "#8a857f";
// Stock states are status, not identity: status colours, always with their label.
const STATUS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b", none: "#b9b4ad" } as const;

const PRESETS = [
  { id: "7", label: "٧ أيام", days: 7 },
  { id: "30", label: "٣٠ يوم", days: 30 },
  { id: "90", label: "٩٠ يوم", days: 90 },
  { id: "all", label: "الكل", days: 0 },
] as const;

const integer = new Intl.NumberFormat("en-US");
const cairoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(date);
const daysAgo = (days: number) => cairoDay(new Date(Date.now() - days * 86_400_000));
const SALE: readonly OrderStatus[] = ["confirmed", "delivered"];

type StockProduct = { productId: string; name: string; category: CatalogCategory; hidden: boolean; tracked: boolean; available: number; state: "untracked" | "out" | "low" | "ok" };
type Data = { orders: UnifiedOrder[]; finance: FinanceReport | null; stock: StockProduct[] | null };

/** Day → bucket: by day up to a month, by week up to ~4 months, else by month. */
function bucketer(days: number) {
  if (days <= 31) return { label: "يوم", key: (day: string) => day, show: (key: string) => key.slice(5) };
  if (days <= 124) {
    return {
      label: "أسبوع",
      key: (day: string) => {
        const date = new Date(`${day}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 1) % 7)); // weeks start on Saturday
        return date.toISOString().slice(0, 10);
      },
      show: (key: string) => `أسبوع ${key.slice(5)}`,
    };
  }
  return { label: "شهر", key: (day: string) => day.slice(0, 7), show: (key: string) => key };
}

/** Every bucket between two days, so empty days show as zero instead of disappearing. */
function bucketsBetween(from: string, to: string, key: (day: string) => string) {
  const keys: string[] = [];
  const date = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (date <= end) {
    const bucket = key(date.toISOString().slice(0, 10));
    if (keys.at(-1) !== bucket) keys.push(bucket);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return keys;
}

export function ChartsTab() {
  const router = useRouter();
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("30");
  const [source, setSource] = useState<"" | "site" | "telegram">("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const days = PRESETS.find((item) => item.id === preset)!.days;
  const to = daysAgo(0);
  const from = days > 0 ? daysAgo(days - 1) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const get = async (url: string) => {
        const response = await fetch(url, { cache: "no-store" });
        if (response.status === 401) {
          router.replace("/admin/login");
          throw new Error("auth");
        }
        const result = await response.json().catch(() => null);
        return response.ok && result?.success ? result : null;
      };
      const [orders, finance, stock] = await Promise.all([
        get("/api/admin/all-orders"),
        get(`/api/admin/finance${from ? `?from=${from}&to=${to}` : ""}`),
        get("/api/admin/inventory"),
      ]);
      if (!orders) {
        setError("مقدرناش نجيب الأوردرات. جربي تاني.");
        return;
      }
      setError(finance && stock ? "" : "فيه جزء من البيانات مجاش (الفلوس أو المخزون). التشارتات التانية شغالة.");
      setData({ orders: orders.orders, finance: finance?.report ?? null, stock: stock?.products ?? null });
    } catch (reason) {
      if (!(reason instanceof Error && reason.message === "auth")) setError("مفيش اتصال. جربي تاني.");
    } finally {
      setLoading(false);
    }
  }, [from, to, router]);

  useEffect(() => {
    // Loading when the section opens and when the dates change is the intended side effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const orders = data.orders.filter((order) => !order.archived && (!source || order.source === source) && (!from || cairoDay(new Date(order.createdAt)) >= from));
    const first = from ?? (orders.length ? orders.map((order) => cairoDay(new Date(order.createdAt))).toSorted()[0] : to);
    const span = Math.round((Date.parse(to) - Date.parse(first)) / 86_400_000) + 1;
    const bucket = bucketer(span);
    const keys = bucketsBetween(first, to, bucket.key);

    // Orders over time, by where they stand.
    const perBucket = new Map(keys.map((key) => [key, { key, label: bucket.show(key), submitted: 0, confirmed: 0, delivered: 0, lost: 0 }]));
    for (const order of orders) {
      const row = perBucket.get(bucket.key(cairoDay(new Date(order.createdAt))));
      if (!row) continue;
      if (order.status === "cancelled" || order.status === "returned") row.lost += 1;
      else row[order.status] += 1;
    }

    // Sales and net profit over time (sales without the customer's shipping; same rules as "ملخص المكسب").
    const money = new Map(keys.map((key) => [key, { key, label: bucket.show(key), sales: 0, netProfit: 0 }]));
    for (const row of data.finance?.orders ?? []) {
      if (source && row.source !== source) continue;
      if (!SALE.includes(row.status)) continue;
      const item = money.get(bucket.key(row.day));
      if (!item) continue;
      item.sales += row.sales;
      item.netProfit += row.netProfit;
    }

    // Pieces sold (not cancelled / returned), by product and by category.
    const byProduct = new Map<string, { name: string; pieces: number }>();
    const byCategory = new Map<string, number>();
    for (const order of orders) {
      if (order.status === "cancelled" || order.status === "returned") continue;
      for (const product of order.products) {
        const known = findProduct(product.modelId);
        const name = known?.name ?? product.name;
        const entry = byProduct.get(product.modelId || name) ?? { name, pieces: 0 };
        entry.pieces += product.quantity;
        byProduct.set(product.modelId || name, entry);
        const category = known ? categoryInfo[known.category].label : "غير معروف";
        byCategory.set(category, (byCategory.get(category) ?? 0) + product.quantity);
      }
    }

    const count = <T,>(items: T[], keyOf: (item: T) => string) => {
      const map = new Map<string, number>();
      for (const item of items) map.set(keyOf(item), (map.get(keyOf(item)) ?? 0) + 1);
      return [...map].map(([name, value]) => ({ name, value })).toSorted((a, b) => b.value - a.value);
    };

    const statusCounts = filterCounts(orders);
    const cancelled = orders.filter((order) => order.status === "cancelled");
    const reasons = [
      ...CANCEL_REASONS.map((reason) => ({ name: reason.label, value: cancelled.filter((order) => order.cancelReason === reason.id).length })),
      { name: "من غير سبب", value: cancelled.filter((order) => !order.cancelReason).length },
    ];

    // Margin per sold or waiting order (pieces only, no shipping), in ranges.
    const marginBins = [
      { name: "خسارة", test: (m: number) => m < 0 },
      { name: "أقل من 100", test: (m: number) => m >= 0 && m < 100 },
      { name: "من 100 لـ 200", test: (m: number) => m >= 100 && m < 200 },
      { name: "من 200 لـ 300", test: (m: number) => m >= 200 && m < 300 },
      { name: "300 وأكتر", test: (m: number) => m >= 300 },
    ];
    const margins = orders.filter((order) => order.money && order.status !== "cancelled" && order.status !== "returned").map((order) => order.money!.margin);

    const sold = orders.filter((order) => SALE.includes(order.status));
    const pieces = orders.filter((order) => order.status !== "cancelled" && order.status !== "returned").reduce((sum, order) => sum + order.products.reduce((total, product) => total + product.quantity, 0), 0);

    const stock = (data.stock ?? []).filter((product) => !product.hidden || product.tracked);
    const stockStates = [
      { name: "متاح", value: stock.filter((product) => product.state === "ok").length, color: STATUS.good },
      { name: "قرب يخلص", value: stock.filter((product) => product.state === "low").length, color: STATUS.warning },
      { name: "خلص", value: stock.filter((product) => product.state === "out").length, color: STATUS.critical },
      { name: "مش متسجل", value: stock.filter((product) => product.state === "untracked").length, color: STATUS.none },
    ];
    const lowest = stock.filter((product) => product.tracked).toSorted((a, b) => a.available - b.available).slice(0, 10).map((product) => ({ name: product.name, value: product.available }));

    return {
      bucketLabel: bucket.label,
      timeline: [...perBucket.values()],
      money: [...money.values()],
      tiles: {
        orders: orders.length,
        pieces,
        sales: data.finance ? (source ? data.finance.orders.filter((row) => row.source === source && SALE.includes(row.status)).reduce((sum, row) => sum + row.sales, 0) : data.finance.totals.sales) : null,
        netProfit: data.finance && !source ? data.finance.totals.netProfit : null,
        cancelRate: orders.length ? cancelled.length / orders.length : null,
        soldOrders: sold.length,
      },
      statuses: ORDER_FILTERS.filter((item) => item.id !== "all").map((item) => ({ name: item.label, value: statusCounts[item.id] ?? 0 })),
      reasons,
      cancelledCount: cancelled.length,
      products: [...byProduct.values()].toSorted((a, b) => b.pieces - a.pieces).slice(0, 10).map((item) => ({ name: item.name, value: item.pieces })),
      categories: [...byCategory].map(([name, value]) => ({ name, value })).toSorted((a, b) => b.value - a.value),
      governorates: count(orders.filter((order) => order.governorate), (order) => order.governorate.trim()).slice(0, 10),
      sources: count(orders, (order) => (order.source === "telegram" ? "تيليجرام (قديم)" : order.origin.split(" · ")[0] || "الموقع")).slice(0, 8),
      margins: marginBins.map((bin) => ({ name: bin.name, value: margins.filter(bin.test).length })),
      expenses: (data.finance?.expensesByCategory ?? []).filter((row) => row.amount > 0).map((row) => ({ name: row.label, value: row.amount })).toSorted((a, b) => b.value - a.value),
      stockStates,
      lowest,
      hasStock: data.stock !== null,
      hasFinance: data.finance !== null,
    };
  }, [data, source, from, to]);

  return (
    <section className="admin-charts" aria-label="الرسوم البيانية">
      <div className="admin-range admin-charts-filters" role="group" aria-label="فلتر التشارتات">
        <div className="admin-presets" role="group" aria-label="الفترة">
          {PRESETS.map((item) => <button key={item.id} type="button" className={preset === item.id ? "active" : ""} onClick={() => setPreset(item.id)}>{item.label}</button>)}
        </div>
        <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} aria-label="المصدر">
          <option value="">الموقع وتيليجرام</option>
          <option value="site">الموقع بس</option>
          <option value="telegram">تيليجرام القديم بس</option>
        </select>
        <button type="button" className="admin-icon-btn" onClick={() => void load()} disabled={loading} aria-label="تحديث"><RefreshCw size={16} className={loading ? "spin" : undefined} /></button>
      </div>

      {error && <p className="admin-note" role="status">{error}</p>}
      {!view && !error && <p className="admin-muted">جاري تجهيز التشارتات…</p>}

      {view && (
        <div className={loading ? "admin-charts-body refreshing" : "admin-charts-body"}>
          <div className="admin-cards admin-chart-tiles">
            <Tile label="الأوردرات" value={integer.format(view.tiles.orders)} note={`${integer.format(view.tiles.soldOrders)} مؤكد أو اتسلم`} />
            <Tile label="القطع المطلوبة" value={integer.format(view.tiles.pieces)} note="من غير الملغي والمرتجع" />
            <Tile label="المبيعات" value={view.tiles.sales === null ? "—" : formatEGP(view.tiles.sales)} note="المؤكد والمستلم · من غير الشحن" />
            <Tile label="صافي المكسب" value={view.tiles.netProfit === null ? "—" : formatEGP(view.tiles.netProfit)} note={source ? "للمصدرين مع بعض بس" : "بعد المصنع والمصروفات"} />
            <Tile label="نسبة الإلغاء" value={view.tiles.cancelRate === null ? "—" : `${(view.tiles.cancelRate * 100).toFixed(1)}%`} note={`${integer.format(view.cancelledCount)} أوردر اتلغى`} />
          </div>

          <div className="admin-grid-2">
            <ChartCard title={`الأوردرات كل ${view.bucketLabel}`} note="حسب يوم الطلب، ومقسومة على حالتها دلوقتي." table={{ head: [view.bucketLabel, "مستني تأكيد", "مؤكد", "اتسلم", "اتلغى أو رجع"], rows: view.timeline.map((row) => [row.label, row.submitted, row.confirmed, row.delivered, row.lost]) }}>
              <ChartBox height={280}>
                <BarChart data={view.timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" fontSize={11} stroke={AXIS} tickLine={false} reversed />
                  <YAxis allowDecimals={false} fontSize={11} width={32} stroke={AXIS} tickLine={false} axisLine={false} orientation="right" />
                  <Tooltip cursor={{ fill: "rgba(31,53,80,.06)" }} />
                  <Legend />
                  <Bar dataKey="submitted" name="مستني تأكيد" stackId="s" fill={SERIES[0]} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="confirmed" name="مؤكد" stackId="s" fill={SERIES[1]} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="delivered" name="اتسلم" stackId="s" fill={SERIES[2]} stroke="#fff" strokeWidth={1} />
                  <Bar dataKey="lost" name="اتلغى أو رجع" stackId="s" fill={SERIES[3]} stroke="#fff" strokeWidth={1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartBox>
            </ChartCard>

            <ChartCard title={`المبيعات وصافي المكسب كل ${view.bucketLabel}`} note="الأوردرات المؤكدة والمستلمة، من غير الشحن، وصافي المكسب بعد سعر المصنع ونصيبها من المصروفات." table={{ head: [view.bucketLabel, "المبيعات", "صافي المكسب"], rows: view.money.map((row) => [row.label, formatEGP(row.sales), formatEGP(Math.round(row.netProfit))]) }}>
              {!view.hasFinance ? <Empty text="أرقام الفلوس مجتش." /> : (
                <ChartBox height={280}>
                  <LineChart data={view.money} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="label" fontSize={11} stroke={AXIS} tickLine={false} reversed />
                    <YAxis fontSize={11} width={52} stroke={AXIS} tickLine={false} axisLine={false} orientation="right" tickFormatter={(value) => integer.format(Number(value))} />
                    <Tooltip formatter={(value) => formatEGP(Math.round(Number(value)))} />
                    <Legend />
                    <Line type="monotone" dataKey="sales" name="المبيعات" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="netProfit" name="صافي المكسب" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ChartBox>
              )}
            </ChartCard>
          </div>

          <div className="admin-grid-2">
            <RankedBars title="حالة الأوردرات والشحن" note="نفس فلاتر كل الأوردرات (الأوردر ممكن يبقى في أكتر من واحدة، زي مؤكد ومع شركة الشحن)." rows={view.statuses} unit="أوردر" keepZero />
            <RankedBars title="أسباب الإلغاء" note={view.cancelledCount ? `${integer.format(view.cancelledCount)} أوردر اتلغى في الفترة دي.` : "مفيش أوردرات اتلغت في الفترة دي."} rows={view.reasons} unit="أوردر" keepZero />
          </div>

          <div className="admin-grid-2">
            <RankedBars title="أكتر 10 قطع اتطلبت" note="القطع في الأوردرات اللي مش ملغية ولا مرتجعة." rows={view.products} unit="قطعة" />
            <RankedBars title="القطع حسب القسم" note="نفس القطع، مجموعة على القسم." rows={view.categories} unit="قطعة" />
          </div>

          <div className="admin-grid-2">
            <RankedBars title="هامش الربح للأوردر" note="عدد الأوردرات في كل مدى هامش (تمن القطع − سعر المصنع، من غير الشحن). الملغي والمرتجع مش محسوبين." rows={view.margins} unit="أوردر" keepZero keepOrder />
            <RankedBars title="المصروفات حسب النوع" note={view.hasFinance ? "اللي اتسجل في المصروفات في الفترة دي (شراء البضاعة من المصنع منهم بس مش بيتخصم من المكسب)." : "أرقام الفلوس مجتش."} rows={view.expenses} unit="ج.م" money />
          </div>

          <div className="admin-grid-2">
            <RankedBars title="أكتر المحافظات" note="عدد الأوردرات من كل محافظة." rows={view.governorates} unit="أوردر" />
            <RankedBars title="الأوردرات جت منين" note="مصدر الزيارة لأوردرات الموقع، وتيليجرام للأوردرات القديمة." rows={view.sources} unit="أوردر" />
          </div>

          {view.hasStock && (
            <div className="admin-grid-2">
              <ChartCard title="حالة المخزون" note="عدد المنتجات في كل حالة دلوقتي (مش مرتبط بالفترة)." table={{ head: ["الحالة", "منتجات"], rows: view.stockStates.map((row) => [row.name, row.value]) }}>
                <ChartBox height={Math.max(180, view.stockStates.length * 44)}>
                  <BarChart data={view.stockStates.map((row) => ({ ...row, label: `${row.name} · ${integer.format(row.value)}` }))} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid horizontal={false} stroke={GRID} />
                    <XAxis type="number" allowDecimals={false} fontSize={11} stroke={AXIS} tickLine={false} reversed />
                    <YAxis type="category" dataKey="label" width={120} fontSize={11} stroke={AXIS} tickLine={false} axisLine={false} orientation="right" tick={{ fill: "#52514e" }} />
                    <Tooltip cursor={{ fill: "rgba(31,53,80,.06)" }} formatter={(value) => [`${integer.format(Number(value))} منتج`, "العدد"]} />
                    <Bar dataKey="value" name="منتجات" radius={[4, 0, 0, 4]} maxBarSize={22}>
                      {view.stockStates.map((row) => <Cell key={row.name} fill={row.color} />)}
                    </Bar>
                  </BarChart>
                </ChartBox>
              </ChartCard>
              <RankedBars title="أقل 10 قطع متاحة في المخزون" note="المتاح = المخزون − المحجوز في أوردرات مستنية تأكيد." rows={view.lowest} unit="قطعة" ascending keepZero />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="admin-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function ChartCard({ title, note, table, children }: { title: string; note?: string; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode }) {
  return (
    <section className="admin-panel admin-chart-card">
      <div className="admin-panel-head"><h2>{title}</h2></div>
      {note && <p className="admin-muted small admin-chart-note">{note}</p>}
      {children}
      <details className="admin-chart-table">
        <summary>عرض كجدول</summary>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr>{table.head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{typeof cell === "number" ? integer.format(cell) : cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** One series of horizontal bars (one colour), largest first unless the order means something. */
function RankedBars({ title, note, rows, unit, money = false, keepZero = false, keepOrder = false, ascending = false }: { title: string; note?: string; rows: { name: string; value: number }[]; unit: string; money?: boolean; keepZero?: boolean; keepOrder?: boolean; ascending?: boolean }) {
  const shown = (keepZero ? rows : rows.filter((row) => row.value > 0));
  const sorted = keepOrder ? shown : shown.toSorted((a, b) => (ascending ? a.value - b.value : b.value - a.value));
  const format = (value: number) => (money ? formatEGP(Math.round(value)) : `${integer.format(value)} ${unit}`);
  // The value is written next to each name (a direct label that never sits on top of a bar).
  const labelled = sorted.map((row) => ({ ...row, label: `${row.name} · ${integer.format(Math.round(row.value))}` }));
  const longest = Math.max(0, ...labelled.map((row) => row.label.length));
  return (
    <ChartCard title={title} note={note} table={{ head: ["", money ? "المبلغ" : unit], rows: sorted.map((row) => [row.name, money ? formatEGP(Math.round(row.value)) : row.value]) }}>
      {sorted.length === 0 || sorted.every((row) => row.value === 0) ? <Empty /> : (
        <ChartBox height={Math.max(180, sorted.length * 34 + 24)}>
          <BarChart data={labelled} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" allowDecimals={false} fontSize={11} stroke={AXIS} tickLine={false} reversed tickFormatter={(value) => integer.format(Number(value))} />
            <YAxis type="category" dataKey="label" width={Math.min(240, Math.max(90, longest * 6.6))} fontSize={11} stroke={AXIS} tickLine={false} axisLine={false} orientation="right" interval={0} tick={{ fill: "#52514e" }} />
            <Tooltip cursor={{ fill: "rgba(31,53,80,.06)" }} formatter={(value) => [format(Number(value)), money ? "المبلغ" : "العدد"]} />
            <Bar dataKey="value" fill={ONE} radius={[4, 0, 0, 4]} maxBarSize={22} />
          </BarChart>
        </ChartBox>
      )}
    </ChartCard>
  );
}

function ChartBox({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div className="admin-chart" dir="ltr" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Empty({ text = "مفيش بيانات في الفترة دي." }: { text?: string }) {
  return <p className="admin-muted empty">{text}</p>;
}
