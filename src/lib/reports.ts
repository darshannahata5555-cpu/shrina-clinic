import "server-only";
import { db } from "./db";
import { addDaysKey, dbDate, fmtDate, fromIst, istDateKey, r2, toNum, weekdayOfKey } from "./format";
import { getSetting } from "./settings";
import { EXPENSE_CATEGORY_LABEL, LEAD_SOURCES, PAYMENT_METHOD_LABEL } from "./status";

/**
 * Reports & analytics (spec §14). Each tab returns { kpis, sections }. A section is a titled table
 * (columns + rows) with an optional chart spec — the page renders chart + table, the Excel export writes
 * one sheet per section, and the print view renders the tables. Money columns are `financial` and are
 * stripped for users without `reports.financial`.
 */

export type ColKind = "text" | "money" | "number" | "percent" | "hours";
export type Col = { key: string; label: string; kind?: ColKind; financial?: boolean };
export type Cell = string | number | null;
export type Row = Record<string, Cell> & { _kind?: ColKind; _financial?: number };
export type ChartSpec = { type: "column" | "grouped" | "hbar"; x: string; series: { key: string; label: string }[]; format?: "money" | "number" | "percent"; limit?: number };
export type Section = { id: string; title: string; description?: string; columns: Col[]; rows: Row[]; totals?: Row; chart?: ChartSpec; note?: string };
export type Kpi = { label: string; value: number; kind: ColKind; hint?: string };
export type Report = { kpis: Kpi[]; sections: Section[] };

export const REPORT_TABS = [
  { key: "revenue", label: "Revenue", financial: true },
  { key: "patients", label: "Patients", financial: false },
  { key: "staff", label: "Staff", financial: false },
  { key: "business", label: "Business", financial: true },
  { key: "branches", label: "Branches", financial: false },
] as const;
export type ReportTab = (typeof REPORT_TABS)[number]["key"];
export type Gran = "day" | "week" | "month" | "year";

export const PRESETS = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["quarter", "This quarter"],
  ["fy", "This financial year"],
  ["custom", "Custom range"],
] as const;

export type Range = { preset: string; fromKey: string; toKey: string; start: Date; end: Date; gran: Gran; label: string };

const isKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Resolve ?preset=&from=&to=&gran= into an IST date range (inclusive keys, [start,end) instants). */
export function resolveRange(sp: Record<string, string | string[] | undefined>): Range {
  const today = istDateKey();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  let preset = typeof sp.preset === "string" ? sp.preset : "month";
  let fromKey = today;
  let toKey = today;
  switch (preset) {
    case "today":
      break;
    case "week": {
      const wd = weekdayOfKey(today);
      fromKey = addDaysKey(today, -((wd + 6) % 7));
      break;
    }
    case "lastmonth": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      fromKey = `${ly}-${String(lm).padStart(2, "0")}-01`;
      toKey = addDaysKey(`${today.slice(0, 7)}-01`, -1);
      break;
    }
    case "quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      fromKey = `${y}-${String(qm).padStart(2, "0")}-01`;
      break;
    }
    case "fy":
      fromKey = `${m >= 4 ? y : y - 1}-04-01`;
      break;
    case "custom":
      if (isKey(sp.from) && isKey(sp.to)) {
        fromKey = sp.from <= sp.to ? sp.from : sp.to;
        toKey = sp.from <= sp.to ? sp.to : sp.from;
      } else {
        preset = "month";
        fromKey = `${today.slice(0, 7)}-01`;
      }
      break;
    default:
      preset = "month";
      fromKey = `${today.slice(0, 7)}-01`;
  }
  const days = Math.round((fromIst(toKey).getTime() - fromIst(fromKey).getTime()) / 86400000) + 1;
  let gran: Gran = (["day", "week", "month", "year"] as const).includes(sp.gran as Gran) ? (sp.gran as Gran) : days <= 31 ? "day" : days <= 120 ? "week" : "month";
  if (gran === "day" && days > 92) gran = "week";
  if (gran === "week" && days > 730) gran = "month";
  const label = fromKey === toKey ? fmtDate(fromIst(fromKey)) : `${fmtDate(fromIst(fromKey))} – ${fmtDate(fromIst(toKey))}`;
  return { preset, fromKey, toKey, start: fromIst(fromKey), end: fromIst(addDaysKey(toKey, 1)), gran, label };
}

/* ── time buckets ── */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function bucketOf(dateKey: string, gran: Gran) {
  if (gran === "day") return dateKey;
  if (gran === "week") return addDaysKey(dateKey, -((weekdayOfKey(dateKey) + 6) % 7));
  if (gran === "month") return dateKey.slice(0, 7);
  return dateKey.slice(0, 4);
}
function bucketLabel(key: string, gran: Gran) {
  if (gran === "day") return `${key.slice(8, 10)} ${MON[Number(key.slice(5, 7)) - 1]}`;
  if (gran === "week") return `Wk ${key.slice(8, 10)} ${MON[Number(key.slice(5, 7)) - 1]}`;
  if (gran === "month") return `${MON[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return key;
}
function buckets(r: Range) {
  const out: string[] = [];
  for (let k = r.fromKey; k <= r.toKey; k = addDaysKey(k, 1)) {
    const b = bucketOf(k, r.gran);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out.map((key) => ({ key, label: bucketLabel(key, r.gran) }));
}
const bk = (d: Date, r: Range) => bucketOf(istDateKey(d), r.gran);

/* ── helpers ── */
const pct = (a: number, b: number) => (b ? r2((a / b) * 100) : 0);
const inRange = (r: Range) => ({ gte: r.start, lt: r.end });
function sumBy<T>(items: T[], key: (t: T) => string, val: (t: T) => number) {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + val(it));
  return m;
}
const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES) as Record<string, string>;

export type Ctx = {
  range: Range;
  branchIds: string[];
  branches: { id: string; name: string; code: string }[];
  financial: boolean;
  payroll: boolean;
};

/** Remove money columns / rows / KPIs for users without reports.financial. */
export function stripFinancial(rep: Report, financial: boolean): Report {
  if (financial) return rep;
  return {
    kpis: rep.kpis.filter((k) => k.kind !== "money"),
    sections: rep.sections
      .map((s) => {
        const cols = s.columns.filter((c) => !c.financial);
        const rows = s.rows.filter((r) => !r._financial);
        const series = s.chart?.series.filter((x) => cols.some((c) => c.key === x.key)) ?? [];
        return { ...s, columns: cols, rows, chart: s.chart && series.length ? { ...s.chart, series } : undefined };
      })
      .filter((s) => s.columns.length > 1 && s.rows.length > 0),
  };
}

/* ══════════════════════════ Revenue ══════════════════════════ */

async function revenueReport(c: Ctx): Promise<Report> {
  const r = c.range;
  const [payments, invoices, items] = await Promise.all([
    db.payment.findMany({ where: { branchId: { in: c.branchIds }, paidAt: inRange(r), method: { not: "ADVANCE" } }, select: { amount: true, kind: true, method: true, paidAt: true, branchId: true } }),
    db.invoice.findMany({
      where: { deletedAt: null, branchId: { in: c.branchIds }, date: inRange(r), status: { not: "CANCELLED" } },
      select: { total: true, discountTotal: true, taxTotal: true, balance: true, date: true, branchId: true },
    }),
    db.invoiceItem.findMany({
      where: { invoice: { deletedAt: null, branchId: { in: c.branchIds }, date: inRange(r), status: { not: "CANCELLED" } } },
      select: { kind: true, description: true, quantity: true, taxable: true, total: true, treatment: { select: { id: true, name: true, category: true } }, product: { select: { id: true, name: true, category: true } } },
    }),
  ]);
  const sign = (k: string) => (k === "REFUND" ? -1 : 1);
  const collected = r2(payments.reduce((s, p) => s + sign(p.kind) * toNum(p.amount), 0));
  const refunds = r2(payments.filter((p) => p.kind === "REFUND").reduce((s, p) => s + toNum(p.amount), 0));
  const billed = r2(invoices.reduce((s, i) => s + toNum(i.total), 0));
  const discounts = r2(invoices.reduce((s, i) => s + toNum(i.discountTotal), 0));
  const gst = r2(invoices.reduce((s, i) => s + toNum(i.taxTotal), 0));
  const outstanding = r2(invoices.reduce((s, i) => s + toNum(i.balance), 0));

  const coll = sumBy(payments, (p) => bk(p.paidAt, r), (p) => sign(p.kind) * toNum(p.amount));
  const bill = sumBy(invoices, (i) => bk(i.date, r), (i) => toNum(i.total));
  const cnt = sumBy(invoices, (i) => bk(i.date, r), () => 1);
  const trend: Row[] = buckets(r).map((b) => ({ period: b.label, collected: r2(coll.get(b.key) ?? 0), billed: r2(bill.get(b.key) ?? 0), invoices: cnt.get(b.key) ?? 0 }));

  const methods = new Map<string, { rec: number; ref: number }>();
  for (const p of payments) {
    const m = methods.get(p.method) ?? { rec: 0, ref: 0 };
    if (p.kind === "REFUND") m.ref += toNum(p.amount);
    else m.rec += toNum(p.amount);
    methods.set(p.method, m);
  }
  const byMethod: Row[] = [...methods.entries()]
    .map(([k, v]) => ({ method: PAYMENT_METHOD_LABEL[k] ?? k, receipts: r2(v.rec), refunds: r2(v.ref), net: r2(v.rec - v.ref), share: pct(v.rec - v.ref, collected) }))
    .sort((a, b) => b.net - a.net);

  const bName = new Map(c.branches.map((b) => [b.id, b.name]));
  const byBranch: Row[] = c.branches
    .filter((b) => c.branchIds.includes(b.id))
    .map((b) => ({
      branch: b.name,
      collected: r2(payments.filter((p) => p.branchId === b.id).reduce((s, p) => s + sign(p.kind) * toNum(p.amount), 0)),
      billed: r2(invoices.filter((i) => i.branchId === b.id).reduce((s, i) => s + toNum(i.total), 0)),
      outstanding: r2(invoices.filter((i) => i.branchId === b.id).reduce((s, i) => s + toNum(i.balance), 0)),
      invoices: invoices.filter((i) => i.branchId === b.id).length,
    }))
    .sort((a, b) => b.collected - a.collected);
  void bName;

  const tMap = new Map<string, { name: string; category: string; qty: number; taxable: number; total: number }>();
  const pMap = new Map<string, { name: string; category: string; qty: number; taxable: number; total: number }>();
  for (const it of items) {
    const isProduct = it.kind === "PRODUCT";
    const key = isProduct ? (it.product?.id ?? it.description) : (it.treatment?.id ?? it.description);
    const map = isProduct ? pMap : tMap;
    const e = map.get(key) ?? {
      name: (isProduct ? it.product?.name : it.treatment?.name) ?? it.description,
      category: (isProduct ? it.product?.category : it.treatment?.category) ?? (it.kind === "CONSULTATION" ? "Consultation" : "Other"),
      qty: 0,
      taxable: 0,
      total: 0,
    };
    e.qty += toNum(it.quantity);
    e.taxable += toNum(it.taxable);
    e.total += toNum(it.total);
    map.set(key, e);
  }
  const svcTotal = [...tMap.values()].reduce((s, x) => s + x.taxable, 0);
  const byTreatment: Row[] = [...tMap.values()].sort((a, b) => b.taxable - a.taxable).map((x) => ({ treatment: x.name, category: x.category, sold: r2(x.qty), revenue: r2(x.taxable), withGst: r2(x.total), share: pct(x.taxable, svcTotal) }));
  const byProduct: Row[] = [...pMap.values()].sort((a, b) => b.taxable - a.taxable).map((x) => ({ product: x.name, category: x.category, qty: r2(x.qty), revenue: r2(x.taxable), withGst: r2(x.total) }));

  const sections: Section[] = [
    {
      id: "trend",
      title: "Billed vs collected",
      description: `Per ${r.gran}. Collected = payments received net of refunds (advance adjustments excluded to avoid double counting).`,
      columns: [
        { key: "period", label: "Period" },
        { key: "billed", label: "Billed", kind: "money", financial: true },
        { key: "collected", label: "Collected", kind: "money", financial: true },
        { key: "invoices", label: "Invoices", kind: "number" },
      ],
      rows: trend,
      totals: { period: "Total", billed: billed, collected, invoices: invoices.length },
      chart: { type: "grouped", x: "period", series: [{ key: "billed", label: "Billed" }, { key: "collected", label: "Collected" }], format: "money" },
    },
    {
      id: "methods",
      title: "Payment method-wise revenue",
      columns: [
        { key: "method", label: "Method" },
        { key: "receipts", label: "Received", kind: "money", financial: true },
        { key: "refunds", label: "Refunded", kind: "money", financial: true },
        { key: "net", label: "Net", kind: "money", financial: true },
        { key: "share", label: "Share", kind: "percent" },
      ],
      rows: byMethod,
      chart: { type: "hbar", x: "method", series: [{ key: "net", label: "Net collected" }], format: "money" },
    },
    ...(byBranch.length > 1
      ? [
          {
            id: "branches",
            title: "Branch-wise revenue",
            columns: [
              { key: "branch", label: "Branch" },
              { key: "collected", label: "Collected", kind: "money", financial: true },
              { key: "billed", label: "Billed", kind: "money", financial: true },
              { key: "outstanding", label: "Still due", kind: "money", financial: true },
              { key: "invoices", label: "Invoices", kind: "number" },
            ],
            rows: byBranch,
            chart: { type: "hbar", x: "branch", series: [{ key: "collected", label: "Collected" }], format: "money" },
          } satisfies Section,
        ]
      : []),
    {
      id: "treatments",
      title: "Treatment-wise revenue",
      description: "Invoice lines for treatments, packages and consultations. Revenue = taxable value (before GST).",
      columns: [
        { key: "treatment", label: "Treatment" },
        { key: "category", label: "Category" },
        { key: "sold", label: "Sold", kind: "number" },
        { key: "revenue", label: "Revenue", kind: "money", financial: true },
        { key: "withGst", label: "Incl. GST", kind: "money", financial: true },
        { key: "share", label: "Share", kind: "percent" },
      ],
      rows: byTreatment,
      chart: { type: "hbar", x: "treatment", series: [{ key: "revenue", label: "Revenue" }], format: "money", limit: 10 },
    },
    {
      id: "products",
      title: "Product-wise revenue",
      columns: [
        { key: "product", label: "Product" },
        { key: "category", label: "Category" },
        { key: "qty", label: "Qty sold", kind: "number" },
        { key: "revenue", label: "Revenue", kind: "money", financial: true },
        { key: "withGst", label: "Incl. GST", kind: "money", financial: true },
      ],
      rows: byProduct,
      chart: byProduct.length ? { type: "hbar", x: "product", series: [{ key: "revenue", label: "Revenue" }], format: "money", limit: 10 } : undefined,
    },
  ];

  return {
    kpis: [
      { label: "Collected", value: collected, kind: "money", hint: `${payments.filter((p) => p.kind === "RECEIPT").length} payments` },
      { label: "Billed", value: billed, kind: "money", hint: `${invoices.length} invoices` },
      { label: "Still due on these invoices", value: outstanding, kind: "money" },
      { label: "Average invoice", value: invoices.length ? r2(billed / invoices.length) : 0, kind: "money" },
      { label: "Discounts given", value: discounts, kind: "money" },
      { label: "GST billed", value: gst, kind: "money" },
      { label: "Refunds", value: refunds, kind: "money" },
    ],
    sections,
  };
}

/* ══════════════════════════ Patients ══════════════════════════ */

async function patientsReport(c: Ctx): Promise<Report> {
  const r = c.range;
  const DAY = 86400000;
  const [total, newPatients, visits, allForActivity, sessions, cohort] = await Promise.all([
    db.patient.count({ where: { deletedAt: null, branchId: { in: c.branchIds }, registeredAt: { lt: r.end } } }),
    db.patient.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, registeredAt: inRange(r) }, select: { id: true, registeredAt: true, source: true } }),
    db.appointment.findMany({
      where: { deletedAt: null, branchId: { in: c.branchIds }, status: "COMPLETED", startAt: inRange(r), patient: { deletedAt: null } },
      select: { startAt: true, patientId: true, patient: { select: { firstVisitAt: true, registeredAt: true } } },
    }),
    db.patient.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, registeredAt: { lt: r.end } }, select: { lastVisitAt: true } }),
    db.treatmentSession.findMany({
      where: { branchId: { in: c.branchIds }, status: "COMPLETED", performedAt: inRange(r) },
      select: { patientId: true, treatment: { select: { id: true, name: true, category: true } } },
    }),
    db.patient.findMany({
      where: { deletedAt: null, branchId: { in: c.branchIds }, OR: [{ firstVisitAt: inRange(r) }, { firstVisitAt: null, registeredAt: inRange(r) }] },
      select: { id: true, firstVisitAt: true, registeredAt: true },
    }),
  ]);

  const firstOf = (p: { firstVisitAt: Date | null; registeredAt: Date }) => p.firstVisitAt ?? p.registeredAt;
  const returningVisits = visits.filter((v) => firstOf(v.patient) < new Date(v.startAt.getTime() - DAY / 2));
  const returningPatients = new Set(returningVisits.map((v) => v.patientId)).size;
  const uniqueVisitors = new Set(visits.map((v) => v.patientId)).size;

  const newBy = sumBy(newPatients, (p) => bk(p.registeredAt, r), () => 1);
  const retBy = sumBy(returningVisits, (v) => bk(v.startAt, r), () => 1);
  const visBy = sumBy(visits, (v) => bk(v.startAt, r), () => 1);
  const trend: Row[] = buckets(r).map((b) => ({ period: b.label, newPatients: newBy.get(b.key) ?? 0, returningVisits: retBy.get(b.key) ?? 0, visits: visBy.get(b.key) ?? 0 }));

  const src = sumBy(newPatients, (p) => p.source ?? "OTHER", () => 1);
  const sources: Row[] = [...src.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ source: SOURCE_LABEL[k] ?? k, patients: v, share: pct(v, newPatients.length) }));

  const tMap = new Map<string, { name: string; category: string; patients: Set<string>; sessions: number }>();
  for (const s of sessions) {
    const e = tMap.get(s.treatment.id) ?? { name: s.treatment.name, category: s.treatment.category, patients: new Set<string>(), sessions: 0 };
    e.patients.add(s.patientId);
    e.sessions++;
    tMap.set(s.treatment.id, e);
  }
  const treatments: Row[] = [...tMap.values()].sort((a, b) => b.patients.size - a.patients.size).map((t) => ({ treatment: t.name, category: t.category, patients: t.patients.size, sessions: t.sessions }));

  const asOf = r.end.getTime();
  const act = { active: 0, lapsing: 0, inactive: 0, never: 0 };
  for (const p of allForActivity) {
    if (!p.lastVisitAt) act.never++;
    else {
      const d = (asOf - p.lastVisitAt.getTime()) / DAY;
      if (d <= 90) act.active++;
      else if (d <= 180) act.lapsing++;
      else act.inactive++;
    }
  }
  const activity: Row[] = [
    { segment: "Active (visited in last 90 days)", patients: act.active, share: pct(act.active, total) },
    { segment: "Lapsing (91–180 days)", patients: act.lapsing, share: pct(act.lapsing, total) },
    { segment: "Inactive (over 180 days)", patients: act.inactive, share: pct(act.inactive, total) },
    { segment: "Registered, no completed visit", patients: act.never, share: pct(act.never, total) },
  ];

  // Retention: of patients whose first visit fell in the range, how many came back within 6 months.
  const cohortIds = cohort.map((p) => p.id);
  const laterVisits = cohortIds.length
    ? await db.appointment.findMany({ where: { patientId: { in: cohortIds }, status: "COMPLETED", deletedAt: null }, select: { patientId: true, startAt: true } })
    : [];
  const visitsOf = new Map<string, Date[]>();
  for (const v of laterVisits) visitsOf.set(v.patientId, [...(visitsOf.get(v.patientId) ?? []), v.startAt]);
  const cohortRows = new Map<string, { n: number; back: number }>();
  let retained = 0;
  for (const p of cohort) {
    const f = firstOf(p);
    const back = (visitsOf.get(p.id) ?? []).some((d) => d.getTime() > f.getTime() + DAY && d.getTime() <= f.getTime() + 180 * DAY);
    if (back) retained++;
    const m = istDateKey(f).slice(0, 7);
    const e = cohortRows.get(m) ?? { n: 0, back: 0 };
    e.n++;
    if (back) e.back++;
    cohortRows.set(m, e);
  }
  const retention: Row[] = [...cohortRows.entries()].sort().map(([m, v]) => ({ cohort: bucketLabel(m, "month"), firstVisits: v.n, returned: v.back, rate: pct(v.back, v.n) }));

  return {
    kpis: [
      { label: "Registered patients", value: total, kind: "number", hint: "As of the end of the period" },
      { label: "New patients", value: newPatients.length, kind: "number" },
      { label: "Returning patients", value: returningPatients, kind: "number", hint: `${uniqueVisitors} patients visited in total` },
      { label: "Active patients", value: act.active, kind: "number", hint: "Visited in the last 90 days" },
      { label: "Inactive patients", value: act.inactive + act.lapsing, kind: "number", hint: "No visit for 90+ days" },
      { label: "6-month retention", value: pct(retained, cohort.length), kind: "percent", hint: `${retained} of ${cohort.length} first-time patients returned` },
    ],
    sections: [
      {
        id: "trend",
        title: "New patients and returning visits",
        description: `Per ${r.gran}. A returning visit is a completed appointment by a patient whose first visit was earlier.`,
        columns: [
          { key: "period", label: "Period" },
          { key: "newPatients", label: "New patients", kind: "number" },
          { key: "returningVisits", label: "Returning visits", kind: "number" },
          { key: "visits", label: "All completed visits", kind: "number" },
        ],
        rows: trend,
        totals: { period: "Total", newPatients: newPatients.length, returningVisits: returningVisits.length, visits: visits.length },
        chart: { type: "grouped", x: "period", series: [{ key: "newPatients", label: "New patients" }, { key: "returningVisits", label: "Returning visits" }], format: "number" },
      },
      {
        id: "sources",
        title: "Where new patients came from",
        columns: [
          { key: "source", label: "Source" },
          { key: "patients", label: "New patients", kind: "number" },
          { key: "share", label: "Share", kind: "percent" },
        ],
        rows: sources,
        chart: { type: "hbar", x: "source", series: [{ key: "patients", label: "New patients" }], format: "number" },
      },
      {
        id: "treatments",
        title: "Treatment-wise patient count",
        description: "Patients with at least one completed session of the treatment in this period.",
        columns: [
          { key: "treatment", label: "Treatment" },
          { key: "category", label: "Category" },
          { key: "patients", label: "Patients", kind: "number" },
          { key: "sessions", label: "Sessions done", kind: "number" },
        ],
        rows: treatments,
        chart: { type: "hbar", x: "treatment", series: [{ key: "patients", label: "Patients" }], format: "number", limit: 10 },
      },
      {
        id: "activity",
        title: "Active vs inactive patients",
        description: "Based on each patient's last completed visit, as of the end of the period.",
        columns: [
          { key: "segment", label: "Segment" },
          { key: "patients", label: "Patients", kind: "number" },
          { key: "share", label: "Share", kind: "percent" },
        ],
        rows: activity,
        chart: { type: "hbar", x: "segment", series: [{ key: "patients", label: "Patients" }], format: "number" },
      },
      {
        id: "retention",
        title: "Patient retention by first-visit month",
        description: "Share of first-time patients who came back for another completed visit within 6 months. Recent months are still maturing.",
        columns: [
          { key: "cohort", label: "First visit" },
          { key: "firstVisits", label: "First-time patients", kind: "number" },
          { key: "returned", label: "Returned ≤ 6 months", kind: "number" },
          { key: "rate", label: "Retention", kind: "percent" },
        ],
        rows: retention,
        totals: { cohort: "All", firstVisits: cohort.length, returned: retained, rate: pct(retained, cohort.length) },
      },
    ],
  };
}

/* ══════════════════════════ Staff ══════════════════════════ */

async function staffReport(c: Ctx): Promise<Report> {
  const r = c.range;
  const payrollSettings = await getSetting("payroll");
  const grace = payrollSettings.lateGraceMinutes;
  const [staff, attendance, sessions, consults, packages, payrolls] = await Promise.all([
    db.staff.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds } }, select: { id: true, fullName: true, designation: true, staffType: true, status: true, branch: { select: { code: true } } }, orderBy: { fullName: "asc" } }),
    db.attendance.findMany({ where: { branchId: { in: c.branchIds }, date: { gte: dbDate(r.fromKey), lte: dbDate(r.toKey) } }, select: { staffId: true, status: true, lateMinutes: true, workMinutes: true, overtimeMinutes: true } }),
    db.treatmentSession.findMany({ where: { branchId: { in: c.branchIds }, status: "COMPLETED", performedAt: inRange(r) }, select: { therapistId: true, doctorId: true, patientId: true } }),
    db.consultation.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, consultationDate: inRange(r) }, select: { doctorId: true, patientId: true } }),
    db.treatmentPackage.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, purchaseDate: inRange(r), status: { not: "CANCELLED" } }, select: { doctorId: true, therapistId: true, price: true } }),
    c.payroll
      ? db.payroll.findMany({ where: { month: { gte: r.fromKey.slice(0, 7), lte: r.toKey.slice(0, 7) }, staff: { branchId: { in: c.branchIds } } }, select: { month: true, grossPay: true, netPay: true, status: true, leaveDeduction: true, halfDayDeduction: true, absentDeduction: true, lateDeduction: true, advances: true, otherDeductions: true, incentives: true, overtimePay: true } })
      : Promise.resolve([]),
  ]);

  const byStaff = new Map<string, { present: number; half: number; leave: number; absent: number; off: number; late: number; lateMin: number; work: number; ot: number }>();
  for (const a of attendance) {
    const e = byStaff.get(a.staffId) ?? { present: 0, half: 0, leave: 0, absent: 0, off: 0, late: 0, lateMin: 0, work: 0, ot: 0 };
    if (a.status === "PRESENT") e.present++;
    else if (a.status === "HALF_DAY") e.half++;
    else if (a.status === "LEAVE") e.leave++;
    else if (a.status === "ABSENT") e.absent++;
    else e.off++;
    if ((a.status === "PRESENT" || a.status === "HALF_DAY") && a.lateMinutes > grace) {
      e.late++;
      e.lateMin += a.lateMinutes;
    }
    e.work += a.workMinutes;
    e.ot += a.overtimeMinutes;
    byStaff.set(a.staffId, e);
  }
  const attRows: Row[] = staff
    .filter((s) => byStaff.has(s.id))
    .map((s) => {
      const e = byStaff.get(s.id)!;
      const scheduled = e.present + e.half + e.leave + e.absent;
      return {
        staff: s.fullName,
        role: s.designation,
        branch: s.branch.code,
        present: e.present,
        halfDays: e.half,
        leave: e.leave,
        absent: e.absent,
        attendance: pct(e.present + e.half * 0.5, scheduled),
        late: e.late,
        avgLate: e.late ? Math.round(e.lateMin / e.late) : 0,
        hours: r2(e.work / 60),
        overtime: r2(e.ot / 60),
      };
    });
  const totalLate = attRows.reduce((s, x) => s + (x.late as number), 0);
  const totalHours = r2(attRows.reduce((s, x) => s + (x.hours as number), 0));
  const avgAtt = attRows.length ? r2(attRows.reduce((s, x) => s + (x.attendance as number), 0) / attRows.length) : 0;

  const name = new Map(staff.map((s) => [s.id, s]));
  const therapistMap = new Map<string, { sessions: number; patients: Set<string>; pkgValue: number }>();
  for (const s of sessions) {
    if (!s.therapistId) continue;
    const e = therapistMap.get(s.therapistId) ?? { sessions: 0, patients: new Set<string>(), pkgValue: 0 };
    e.sessions++;
    e.patients.add(s.patientId);
    therapistMap.set(s.therapistId, e);
  }
  const therapists: Row[] = [...therapistMap.entries()]
    .filter(([id]) => name.has(id))
    .map(([id, e]) => ({ therapist: name.get(id)!.fullName, branch: name.get(id)!.branch.code, sessions: e.sessions, patients: e.patients.size }))
    .sort((a, b) => (b.sessions as number) - (a.sessions as number));

  const docMap = new Map<string, { consults: number; patients: Set<string>; sessions: number; pkgs: number; pkgValue: number }>();
  const doc = (id: string) => docMap.get(id) ?? { consults: 0, patients: new Set<string>(), sessions: 0, pkgs: 0, pkgValue: 0 };
  for (const x of consults) {
    const e = doc(x.doctorId);
    e.consults++;
    e.patients.add(x.patientId);
    docMap.set(x.doctorId, e);
  }
  for (const s of sessions) {
    if (!s.doctorId) continue;
    const e = doc(s.doctorId);
    e.sessions++;
    docMap.set(s.doctorId, e);
  }
  for (const p of packages) {
    if (!p.doctorId) continue;
    const e = doc(p.doctorId);
    e.pkgs++;
    e.pkgValue += toNum(p.price);
    docMap.set(p.doctorId, e);
  }
  const doctors: Row[] = [...docMap.entries()]
    .filter(([id]) => name.has(id))
    .map(([id, e]) => ({ doctor: name.get(id)!.fullName, branch: name.get(id)!.branch.code, consultations: e.consults, patients: e.patients.size, sessions: e.sessions, packages: e.pkgs, packageValue: r2(e.pkgValue) }))
    .sort((a, b) => (b.consultations as number) - (a.consultations as number));

  const payMonths = new Map<string, { n: number; gross: number; ded: number; net: number; paid: number }>();
  for (const p of payrolls) {
    const e = payMonths.get(p.month) ?? { n: 0, gross: 0, ded: 0, net: 0, paid: 0 };
    e.n++;
    e.gross += toNum(p.grossPay);
    e.net += toNum(p.netPay);
    e.ded += toNum(p.leaveDeduction) + toNum(p.halfDayDeduction) + toNum(p.absentDeduction) + toNum(p.lateDeduction) + toNum(p.advances) + toNum(p.otherDeductions);
    if (p.status === "PAID") e.paid++;
    payMonths.set(p.month, e);
  }
  const payrollRows: Row[] = [...payMonths.entries()].sort().map(([m, e]) => ({ month: bucketLabel(m, "month"), staff: e.n, gross: r2(e.gross), deductions: r2(e.ded), net: r2(e.net), paid: `${e.paid} / ${e.n}` }));

  const sections: Section[] = [
    {
      id: "attendance",
      title: "Staff attendance, late arrivals & working hours",
      description: `Late = checked in more than ${grace} minutes after shift start (grace period from payroll settings). Attendance % counts half days as 0.5 and excludes week-offs/holidays.`,
      columns: [
        { key: "staff", label: "Staff" },
        { key: "role", label: "Designation" },
        { key: "branch", label: "Branch" },
        { key: "present", label: "Present", kind: "number" },
        { key: "halfDays", label: "Half days", kind: "number" },
        { key: "leave", label: "Leave", kind: "number" },
        { key: "absent", label: "Absent", kind: "number" },
        { key: "attendance", label: "Attendance", kind: "percent" },
        { key: "late", label: "Late days", kind: "number" },
        { key: "avgLate", label: "Avg late (min)", kind: "number" },
        { key: "hours", label: "Hours worked", kind: "hours" },
        { key: "overtime", label: "Overtime", kind: "hours" },
      ],
      rows: attRows,
      chart: attRows.length ? { type: "hbar", x: "staff", series: [{ key: "late", label: "Late days" }], format: "number", limit: 12 } : undefined,
    },
    {
      id: "therapists",
      title: "Therapist-wise treatments",
      description: "Completed sessions recorded against each therapist.",
      columns: [
        { key: "therapist", label: "Therapist" },
        { key: "branch", label: "Branch" },
        { key: "sessions", label: "Sessions done", kind: "number" },
        { key: "patients", label: "Patients", kind: "number" },
      ],
      rows: therapists,
      chart: { type: "hbar", x: "therapist", series: [{ key: "sessions", label: "Sessions done" }], format: "number" },
    },
    {
      id: "doctors",
      title: "Doctor-wise consultations",
      columns: [
        { key: "doctor", label: "Doctor" },
        { key: "branch", label: "Branch" },
        { key: "consultations", label: "Consultations", kind: "number" },
        { key: "patients", label: "Patients seen", kind: "number" },
        { key: "sessions", label: "Sessions supervised", kind: "number" },
        { key: "packages", label: "Packages prescribed", kind: "number" },
        { key: "packageValue", label: "Package value", kind: "money", financial: true },
      ],
      rows: doctors,
      chart: { type: "hbar", x: "doctor", series: [{ key: "consultations", label: "Consultations" }], format: "number" },
    },
  ];
  if (c.payroll) {
    sections.push({
      id: "payroll",
      title: "Monthly payroll",
      description: "From payroll runs for the months in this period.",
      columns: [
        { key: "month", label: "Month" },
        { key: "staff", label: "Staff", kind: "number" },
        { key: "gross", label: "Gross", kind: "money", financial: true },
        { key: "deductions", label: "Deductions & advances", kind: "money", financial: true },
        { key: "net", label: "Net payable", kind: "money", financial: true },
        { key: "paid", label: "Paid" },
      ],
      rows: payrollRows,
      chart: payrollRows.length ? { type: "column", x: "month", series: [{ key: "net", label: "Net payable" }], format: "money" } : undefined,
      note: payrollRows.length ? undefined : "No payroll has been run for these months yet.",
    });
  }

  return {
    kpis: [
      { label: "Active staff", value: staff.filter((s) => s.status === "ACTIVE" || s.status === "ON_NOTICE").length, kind: "number" },
      { label: "Average attendance", value: avgAtt, kind: "percent" },
      { label: "Late arrivals", value: totalLate, kind: "number", hint: `Beyond ${grace} min grace` },
      { label: "Hours worked", value: totalHours, kind: "hours" },
      { label: "Sessions completed", value: sessions.length, kind: "number" },
      { label: "Consultations", value: consults.length, kind: "number" },
      ...(c.payroll ? [{ label: "Payroll (net)", value: r2(payrollRows.reduce((s, x) => s + (x.net as number), 0)), kind: "money" as const }] : []),
    ],
    sections,
  };
}

/* ══════════════════════════ Business ══════════════════════════ */

async function leadConversion(c: Ctx) {
  const leads = await db.lead.findMany({
    where: { deletedAt: null, branchId: { in: c.branchIds }, enquiryDate: inRange(c.range) },
    select: { source: true, status: true, patientId: true, enquiryDate: true, branchId: true },
  });
  const paidPatients = new Set(
    (
      await db.invoice.findMany({
        where: { deletedAt: null, status: { not: "CANCELLED" }, paidAmount: { gt: 0 }, patientId: { in: leads.map((l) => l.patientId).filter(Boolean) as string[] } },
        select: { patientId: true, date: true },
      })
    ).map((i) => i.patientId),
  );
  const purchased = (l: (typeof leads)[number]) => l.status === "TREATMENT_PURCHASED" || (!!l.patientId && paidPatients.has(l.patientId));
  return { leads, purchased };
}

async function businessReport(c: Ctx): Promise<Report> {
  const r = c.range;
  const [payments, expenses, pending, pkgItems, productItems, saleTxns, batches, products, lc] = await Promise.all([
    db.payment.findMany({ where: { branchId: { in: c.branchIds }, paidAt: inRange(r), method: { not: "ADVANCE" } }, select: { amount: true, kind: true, paidAt: true } }),
    db.expense.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, date: inRange(r), status: { not: "REJECTED" } }, select: { amount: true, category: true, status: true, date: true } }),
    db.invoice.findMany({ where: { deletedAt: null, branchId: { in: c.branchIds }, status: { in: ["UNPAID", "PARTIAL"] } }, select: { balance: true, date: true } }),
    db.invoiceItem.findMany({
      where: { kind: "PACKAGE", invoice: { deletedAt: null, branchId: { in: c.branchIds }, date: inRange(r), status: { not: "CANCELLED" } } },
      select: { taxable: true, treatment: { select: { id: true, name: true } }, package: { select: { totalSessions: true } }, description: true },
    }),
    db.invoiceItem.findMany({
      where: { kind: "PRODUCT", invoice: { deletedAt: null, branchId: { in: c.branchIds }, date: inRange(r), status: { not: "CANCELLED" } } },
      select: { quantity: true, taxable: true, productId: true, description: true, product: { select: { name: true, purchasePrice: true } } },
    }),
    db.inventoryTransaction.findMany({ where: { branchId: { in: c.branchIds }, type: { in: ["SALE", "CUSTOMER_RETURN"] }, createdAt: inRange(r) }, select: { productId: true, quantity: true, unitCost: true } }),
    db.productBatch.findMany({ where: { branchId: { in: c.branchIds }, quantity: { gt: 0 } }, select: { productId: true, quantity: true, purchasePrice: true } }),
    db.product.findMany({ where: { deletedAt: null }, select: { id: true, category: true, sellingPrice: true, isRetail: true, purchasePrice: true } }),
    leadConversion(c),
  ]);
  const sign = (k: string) => (k === "REFUND" ? -1 : 1);
  const revenue = r2(payments.reduce((s, p) => s + sign(p.kind) * toNum(p.amount), 0));
  const expenseTotal = r2(expenses.reduce((s, e) => s + toNum(e.amount), 0));
  const profit = r2(revenue - expenseTotal);

  const rev = sumBy(payments, (p) => bk(p.paidAt, r), (p) => sign(p.kind) * toNum(p.amount));
  const exp = sumBy(expenses, (e) => bk(e.date, r), (e) => toNum(e.amount));
  const trend: Row[] = buckets(r).map((b) => {
    const a = r2(rev.get(b.key) ?? 0);
    const e = r2(exp.get(b.key) ?? 0);
    return { period: b.label, revenue: a, expenses: e, profit: r2(a - e) };
  });

  const cats = new Map<string, { approved: number; pending: number }>();
  for (const e of expenses) {
    const x = cats.get(e.category) ?? { approved: 0, pending: 0 };
    if (e.status === "APPROVED") x.approved += toNum(e.amount);
    else x.pending += toNum(e.amount);
    cats.set(e.category, x);
  }
  const byCategory: Row[] = [...cats.entries()]
    .map(([k, v]) => ({ category: EXPENSE_CATEGORY_LABEL[k] ?? k, approved: r2(v.approved), pending: r2(v.pending), total: r2(v.approved + v.pending), share: pct(v.approved + v.pending, expenseTotal) }))
    .sort((a, b) => b.total - a.total);

  const now = Date.now();
  const aging = [
    { bucket: "0–30 days", min: 0, max: 30 },
    { bucket: "31–60 days", min: 31, max: 60 },
    { bucket: "61–90 days", min: 61, max: 90 },
    { bucket: "Over 90 days", min: 91, max: Infinity },
  ].map((b) => {
    const rows = pending.filter((i) => {
      const d = Math.floor((now - i.date.getTime()) / 86400000);
      return d >= b.min && d <= b.max;
    });
    return { bucket: b.bucket, invoices: rows.length, amount: r2(rows.reduce((s, i) => s + toNum(i.balance), 0)) };
  });
  const pendingTotal = r2(pending.reduce((s, i) => s + toNum(i.balance), 0));

  const pk = new Map<string, { name: string; n: number; sessions: number; value: number }>();
  for (const it of pkgItems) {
    const key = it.treatment?.id ?? it.description;
    const e = pk.get(key) ?? { name: it.treatment?.name ?? it.description, n: 0, sessions: 0, value: 0 };
    e.n++;
    e.sessions += it.package?.totalSessions ?? 0;
    e.value += toNum(it.taxable);
    pk.set(key, e);
  }
  const packageRows: Row[] = [...pk.values()].sort((a, b) => b.value - a.value).map((x) => ({ treatment: x.name, packages: x.n, sessions: x.sessions, value: r2(x.value) }));
  const packageValue = r2(packageRows.reduce((s, x) => s + (x.value as number), 0));

  const cogs = sumBy(saleTxns, (t) => t.productId, (t) => -toNum(t.quantity) * toNum(t.unitCost));
  const pm = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const it of productItems) {
    const key = it.productId ?? it.description;
    const e = pm.get(key) ?? { name: it.product?.name ?? it.description, qty: 0, revenue: 0 };
    e.qty += toNum(it.quantity);
    e.revenue += toNum(it.taxable);
    pm.set(key, e);
  }
  const productRows: Row[] = [...pm.entries()]
    .map(([id, x]) => {
      const fallbackCost = x.qty * toNum(productItems.find((p) => p.productId === id)?.product?.purchasePrice);
      const cost = r2(cogs.get(id) ?? fallbackCost);
      return { product: x.name, qty: r2(x.qty), revenue: r2(x.revenue), cost, profit: r2(x.revenue - cost), margin: pct(x.revenue - cost, x.revenue) };
    })
    .sort((a, b) => (b.profit as number) - (a.profit as number));
  const productRevenue = r2(productRows.reduce((s, x) => s + (x.revenue as number), 0));

  const pInfo = new Map(products.map((p) => [p.id, p]));
  const inv = new Map<string, { qty: number; cost: number; retail: number; skus: Set<string> }>();
  for (const b of batches) {
    const p = pInfo.get(b.productId);
    const cat = p?.category ?? "Other";
    const e = inv.get(cat) ?? { qty: 0, cost: 0, retail: 0, skus: new Set<string>() };
    e.qty += toNum(b.quantity);
    e.cost += toNum(b.quantity) * toNum(b.purchasePrice);
    e.retail += p?.isRetail ? toNum(b.quantity) * toNum(p.sellingPrice) : 0;
    e.skus.add(b.productId);
    inv.set(cat, e);
  }
  const inventoryRows: Row[] = [...inv.entries()].map(([k, v]) => ({ category: k, products: v.skus.size, cost: r2(v.cost), retail: r2(v.retail) })).sort((a, b) => b.cost - a.cost);
  const inventoryValue = r2(inventoryRows.reduce((s, x) => s + (x.cost as number), 0));

  const ls = new Map<string, { leads: number; patients: number; purchased: number; lost: number }>();
  for (const l of lc.leads) {
    const e = ls.get(l.source) ?? { leads: 0, patients: 0, purchased: 0, lost: 0 };
    e.leads++;
    if (l.patientId) e.patients++;
    if (lc.purchased(l)) e.purchased++;
    if (l.status === "LOST") e.lost++;
    ls.set(l.source, e);
  }
  const leadRows: Row[] = [...ls.entries()].map(([k, v]) => ({ source: SOURCE_LABEL[k] ?? k, leads: v.leads, patients: v.patients, purchased: v.purchased, lost: v.lost, conversion: pct(v.purchased, v.leads) })).sort((a, b) => b.leads - a.leads);
  const leadTotal = lc.leads.length;
  const leadWon = lc.leads.filter(lc.purchased).length;

  return {
    kpis: [
      { label: "Revenue collected", value: revenue, kind: "money" },
      { label: "Expenses", value: expenseTotal, kind: "money", hint: "Approved + pending, excludes rejected" },
      { label: "Estimated operating profit", value: profit, kind: "money", hint: revenue ? `${pct(profit, revenue)}% margin` : undefined },
      { label: "Pending payments", value: pendingTotal, kind: "money", hint: `${pending.length} invoices outstanding today` },
      { label: "Package sales", value: packageValue, kind: "money", hint: `${pkgItems.length} packages` },
      { label: "Product sales", value: productRevenue, kind: "money" },
      { label: "Inventory value (cost)", value: inventoryValue, kind: "money", hint: "Current stock" },
      { label: "Lead conversion", value: pct(leadWon, leadTotal), kind: "percent", hint: `${leadWon} of ${leadTotal} enquiries became paying patients` },
    ],
    sections: [
      {
        id: "profit",
        title: "Revenue vs expenses",
        description: "Estimated operating profit = payments collected − expenses recorded (rejected claims excluded). Salaries count once paid and entered as an expense.",
        columns: [
          { key: "period", label: "Period" },
          { key: "revenue", label: "Revenue", kind: "money", financial: true },
          { key: "expenses", label: "Expenses", kind: "money", financial: true },
          { key: "profit", label: "Profit", kind: "money", financial: true },
        ],
        rows: trend,
        totals: { period: "Total", revenue, expenses: expenseTotal, profit },
        chart: { type: "grouped", x: "period", series: [{ key: "revenue", label: "Revenue" }, { key: "expenses", label: "Expenses" }], format: "money" },
      },
      {
        id: "expenses",
        title: "Expenses by category",
        columns: [
          { key: "category", label: "Category" },
          { key: "approved", label: "Approved", kind: "money", financial: true },
          { key: "pending", label: "Awaiting approval", kind: "money", financial: true },
          { key: "total", label: "Total", kind: "money", financial: true },
          { key: "share", label: "Share", kind: "percent" },
        ],
        rows: byCategory,
        totals: { category: "Total", approved: r2(byCategory.reduce((s, x) => s + (x.approved as number), 0)), pending: r2(byCategory.reduce((s, x) => s + (x.pending as number), 0)), total: expenseTotal, share: 100 },
        chart: { type: "hbar", x: "category", series: [{ key: "total", label: "Total" }], format: "money" },
      },
      {
        id: "pending",
        title: "Pending payments by age",
        description: "All unpaid and partly paid invoices as of today, by invoice age.",
        columns: [
          { key: "bucket", label: "Invoice age" },
          { key: "invoices", label: "Invoices", kind: "number" },
          { key: "amount", label: "Amount due", kind: "money", financial: true },
        ],
        rows: aging,
        totals: { bucket: "Total", invoices: pending.length, amount: pendingTotal },
        chart: { type: "column", x: "bucket", series: [{ key: "amount", label: "Amount due" }], format: "money" },
      },
      {
        id: "packages",
        title: "Treatment package sales",
        columns: [
          { key: "treatment", label: "Treatment" },
          { key: "packages", label: "Packages sold", kind: "number" },
          { key: "sessions", label: "Sessions sold", kind: "number" },
          { key: "value", label: "Value (pre-GST)", kind: "money", financial: true },
        ],
        rows: packageRows,
        chart: packageRows.length ? { type: "hbar", x: "treatment", series: [{ key: "value", label: "Value" }], format: "money", limit: 10 } : undefined,
      },
      {
        id: "products",
        title: "Product sales & profit",
        description: "Cost uses the batch purchase price of the stock actually sold (FEFO).",
        columns: [
          { key: "product", label: "Product" },
          { key: "qty", label: "Qty", kind: "number" },
          { key: "revenue", label: "Revenue", kind: "money", financial: true },
          { key: "cost", label: "Cost", kind: "money", financial: true },
          { key: "profit", label: "Gross profit", kind: "money", financial: true },
          { key: "margin", label: "Margin", kind: "percent" },
        ],
        rows: productRows,
        chart: productRows.length ? { type: "hbar", x: "product", series: [{ key: "profit", label: "Gross profit" }], format: "money", limit: 10 } : undefined,
      },
      {
        id: "inventory",
        title: "Inventory value",
        description: "Stock on hand now. Retail value only counts products sold to patients.",
        columns: [
          { key: "category", label: "Category" },
          { key: "products", label: "Products in stock", kind: "number" },
          { key: "cost", label: "Value at cost", kind: "money", financial: true },
          { key: "retail", label: "Retail value", kind: "money", financial: true },
        ],
        rows: inventoryRows,
        totals: { category: "Total", products: inventoryRows.reduce((s, x) => s + (x.products as number), 0), cost: inventoryValue, retail: r2(inventoryRows.reduce((s, x) => s + (x.retail as number), 0)) },
      },
      {
        id: "leads",
        title: "Lead conversion by source",
        description: "Enquiries received in this period. Purchased = became a paying patient (or marked Treatment purchased).",
        columns: [
          { key: "source", label: "Source" },
          { key: "leads", label: "Enquiries", kind: "number" },
          { key: "patients", label: "Became patients", kind: "number" },
          { key: "purchased", label: "Purchased", kind: "number" },
          { key: "lost", label: "Lost", kind: "number" },
          { key: "conversion", label: "Conversion", kind: "percent" },
        ],
        rows: leadRows,
        totals: { source: "Total", leads: leadTotal, patients: lc.leads.filter((l) => l.patientId).length, purchased: leadWon, lost: lc.leads.filter((l) => l.status === "LOST").length, conversion: pct(leadWon, leadTotal) },
        chart: leadRows.length ? { type: "hbar", x: "source", series: [{ key: "conversion", label: "Conversion" }], format: "percent" } : undefined,
      },
    ],
  };
}

/* ══════════════════════════ Branches ══════════════════════════ */

async function branchesReport(c: Ctx): Promise<Report> {
  const r = c.range;
  const list = c.branches.filter((b) => c.branchIds.includes(b.id));
  const ids = list.map((b) => b.id);
  const [payments, invoices, expenses, pending, patients, appts, pkgs, staff, batches, lc] = await Promise.all([
    db.payment.findMany({ where: { branchId: { in: ids }, paidAt: inRange(r), method: { not: "ADVANCE" } }, select: { branchId: true, amount: true, kind: true } }),
    db.invoice.findMany({ where: { deletedAt: null, branchId: { in: ids }, date: inRange(r), status: { not: "CANCELLED" } }, select: { branchId: true, total: true } }),
    db.expense.findMany({ where: { deletedAt: null, branchId: { in: ids }, date: inRange(r), status: { not: "REJECTED" } }, select: { branchId: true, amount: true } }),
    db.invoice.findMany({ where: { deletedAt: null, branchId: { in: ids }, status: { in: ["UNPAID", "PARTIAL"] } }, select: { branchId: true, balance: true } }),
    db.patient.findMany({ where: { deletedAt: null, branchId: { in: ids } }, select: { branchId: true, registeredAt: true } }),
    db.appointment.findMany({ where: { deletedAt: null, branchId: { in: ids }, startAt: inRange(r) }, select: { branchId: true, status: true } }),
    db.treatmentPackage.findMany({ where: { deletedAt: null, branchId: { in: ids }, purchaseDate: inRange(r), status: { not: "CANCELLED" } }, select: { branchId: true } }),
    db.staff.findMany({ where: { deletedAt: null, branchId: { in: ids }, status: { in: ["ACTIVE", "ON_NOTICE"] } }, select: { branchId: true } }),
    db.productBatch.findMany({ where: { branchId: { in: ids }, quantity: { gt: 0 } }, select: { branchId: true, quantity: true, purchasePrice: true } }),
    leadConversion({ ...c, branchIds: ids }),
  ]);
  const by = <T extends { branchId: string }>(rows: T[], id: string) => rows.filter((x) => x.branchId === id);
  const metric = (label: string, kind: ColKind, fn: (id: string) => number, financial = false): Row => {
    const row: Row = { metric: label, _kind: kind, ...(financial ? { _financial: 1 } : {}) };
    for (const b of list) row[b.id] = r2(fn(b.id));
    if (list.length > 1 && kind !== "percent") row.total = r2(list.reduce((s, b) => s + fn(b.id), 0));
    return row;
  };
  const collected = (id: string) => by(payments, id).reduce((s, p) => s + (p.kind === "REFUND" ? -1 : 1) * toNum(p.amount), 0);
  const spent = (id: string) => by(expenses, id).reduce((s, e) => s + toNum(e.amount), 0);
  const leadsOf = (id: string) => lc.leads.filter((l) => l.branchId === id);
  const rows: Row[] = [
    metric("Revenue collected", "money", collected, true),
    metric("Billed", "money", (id) => by(invoices, id).reduce((s, i) => s + toNum(i.total), 0), true),
    metric("Expenses", "money", spent, true),
    metric("Estimated profit", "money", (id) => collected(id) - spent(id), true),
    metric("Pending payments (today)", "money", (id) => by(pending, id).reduce((s, i) => s + toNum(i.balance), 0), true),
    metric("Inventory value (cost)", "money", (id) => by(batches, id).reduce((s, b) => s + toNum(b.quantity) * toNum(b.purchasePrice), 0), true),
    metric("New patients", "number", (id) => by(patients, id).filter((p) => p.registeredAt >= r.start && p.registeredAt < r.end).length),
    metric("Registered patients", "number", (id) => by(patients, id).length),
    metric("Appointments booked", "number", (id) => by(appts, id).filter((a) => a.status !== "RESCHEDULED").length),
    metric("Completed visits", "number", (id) => by(appts, id).filter((a) => a.status === "COMPLETED").length),
    metric("No-shows", "number", (id) => by(appts, id).filter((a) => a.status === "NO_SHOW").length),
    metric("No-show rate", "percent", (id) => {
      const a = by(appts, id).filter((x) => ["COMPLETED", "NO_SHOW"].includes(x.status));
      return pct(a.filter((x) => x.status === "NO_SHOW").length, a.length);
    }),
    metric("Packages sold", "number", (id) => by(pkgs, id).length),
    metric("Enquiries (leads)", "number", (id) => leadsOf(id).length),
    metric("Lead conversion", "percent", (id) => pct(leadsOf(id).filter(lc.purchased).length, leadsOf(id).length)),
    metric("Active staff", "number", (id) => by(staff, id).length),
  ];
  const chartRows: Row[] = list.map((b) => ({ branch: b.name, revenue: r2(collected(b.id)), expenses: r2(spent(b.id)) }));
  return {
    kpis: [],
    sections: [
      {
        id: "compare",
        title: "Branch comparison",
        description: "Side-by-side performance for the selected period.",
        columns: [{ key: "metric", label: "Metric" }, ...list.map((b) => ({ key: b.id, label: b.name, kind: "number" as ColKind })), ...(list.length > 1 ? [{ key: "total", label: "All branches", kind: "number" as ColKind }] : [])],
        rows,
      },
      {
        id: "revexp",
        title: "Revenue and expenses by branch",
        columns: [
          { key: "branch", label: "Branch" },
          { key: "revenue", label: "Revenue", kind: "money", financial: true },
          { key: "expenses", label: "Expenses", kind: "money", financial: true },
        ],
        rows: chartRows,
        chart: { type: "grouped", x: "branch", series: [{ key: "revenue", label: "Revenue" }, { key: "expenses", label: "Expenses" }], format: "money" },
      },
    ],
  };
}

export async function buildReport(tab: ReportTab, c: Ctx): Promise<Report> {
  const rep =
    tab === "revenue" ? await revenueReport(c) : tab === "patients" ? await patientsReport(c) : tab === "staff" ? await staffReport(c) : tab === "business" ? await businessReport(c) : await branchesReport(c);
  return stripFinancial(rep, c.financial);
}

/** Format a cell for display / print. */
export function formatCell(v: Cell, kind: ColKind = "text"): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  switch (kind) {
    case "money":
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);
    case "percent":
      return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v)}%`;
    case "hours":
      return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v)} h`;
    default:
      return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
  }
}
