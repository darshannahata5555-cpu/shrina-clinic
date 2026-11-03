import Link from "next/link";
import { CalendarClock, Camera, History, ShoppingBag, Stethoscope } from "lucide-react";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth";
import type { AccessiblePatient } from "@/lib/patients";
import { addDaysKey, fmtDate, fmtDateTime, fromIst, istDateKey, money, r2, toNum } from "@/lib/format";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DateParam, FilterBar, SelectParam } from "@/components/ui/filters";
import { ProgressBar } from "./overview";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Money = { paid: number; pending: number; billed: number };
type Entry = {
  key: string;
  kind: "package" | "session" | "consultation" | "products" | "billed";
  date: Date;
  visitDates: Date[];
  branchId: string;
  branchName: string;
  doctorIds: string[];
  category: string;
  render: React.ReactNode;
};

function shareOf(item: { total: unknown; invoice: { total: unknown; paidAmount: unknown; balance: unknown; status: string } }): Money {
  const total = toNum(item.invoice.total as never);
  if (item.invoice.status === "CANCELLED" || total <= 0) return { paid: 0, pending: 0, billed: 0 };
  const share = toNum(item.total as never) / total;
  return {
    billed: r2(toNum(item.total as never)),
    paid: r2(toNum(item.invoice.paidAmount as never) * share),
    pending: r2(toNum(item.invoice.balance as never) * share),
  };
}

export async function HistoryTab({ patient: p, user, sp }: { patient: AccessiblePatient; user: CurrentUser; sp: SP }) {
  const showMoney = can(user, "billing.view");
  const now = new Date();
  const invoiceItemInclude = { invoice: { select: { id: true, number: true, date: true, total: true, paidAmount: true, balance: true, status: true, deletedAt: true } } } as const;

  const [packages, looseSessions, consultations, items, photos] = await Promise.all([
    db.treatmentPackage.findMany({
      where: { patientId: p.id, deletedAt: null },
      include: {
        treatment: { select: { name: true, category: true } },
        doctor: { select: { id: true, fullName: true } },
        therapist: { select: { id: true, fullName: true } },
        branch: { select: { id: true, name: true } },
        sessions: { orderBy: [{ performedAt: { sort: "asc", nulls: "last" } }, { scheduledAt: "asc" }], include: { therapist: { select: { fullName: true } }, doctor: { select: { id: true, fullName: true } } } },
        invoiceItems: { include: invoiceItemInclude },
        appointments: { where: { deletedAt: null, startAt: { gte: now }, status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN"] } }, orderBy: { startAt: "asc" }, take: 1, select: { id: true, startAt: true } },
      },
    }),
    db.treatmentSession.findMany({
      where: { patientId: p.id, packageId: null },
      include: {
        treatment: { select: { name: true, category: true } },
        doctor: { select: { id: true, fullName: true } },
        therapist: { select: { fullName: true } },
        branch: { select: { id: true, name: true } },
      },
    }),
    db.consultation.findMany({
      where: { patientId: p.id, deletedAt: null },
      include: { doctor: { select: { id: true, fullName: true } }, branch: { select: { id: true, name: true } } },
    }),
    db.invoiceItem.findMany({
      where: { packageId: null, invoice: { patientId: p.id, deletedAt: null } },
      include: { ...invoiceItemInclude, invoice: { select: { ...invoiceItemInclude.invoice.select, branchId: true, branch: { select: { name: true } } } }, treatment: { select: { category: true } } },
    }),
    can(user, "photos.view")
      ? db.patientPhoto.groupBy({ by: ["packageId", "treatmentId"], where: { patientId: p.id, deletedAt: null }, _count: true })
      : Promise.resolve([] as { packageId: string | null; treatmentId: string | null; _count: number }[]),
  ]);

  const photoCount = (packageId: string | null, treatmentId: string | null) =>
    photos.filter((x) => (packageId && x.packageId === packageId) || (!x.packageId && treatmentId && x.treatmentId === treatmentId)).reduce((s, x) => s + x._count, 0);

  const entries: Entry[] = [];

  for (const k of packages) {
    const money_ = k.invoiceItems.filter((i) => !i.invoice.deletedAt).map(shareOf).reduce((a, b) => ({ paid: a.paid + b.paid, pending: a.pending + b.pending, billed: a.billed + b.billed }), { paid: 0, pending: 0, billed: 0 });
    const done = k.sessions.filter((s) => s.status === "COMPLETED");
    const last = done[done.length - 1];
    const first = done[0];
    const nextAppt = k.appointments[0];
    const pc = photoCount(k.id, k.treatmentId);
    const observations = done.map((s) => s.observations).filter(Boolean);
    entries.push({
      key: `pkg-${k.id}`,
      kind: "package",
      date: k.purchaseDate,
      visitDates: [k.purchaseDate, ...k.sessions.map((s) => s.performedAt ?? s.scheduledAt).filter((d): d is Date => !!d)],
      branchId: k.branchId,
      branchName: k.branch.name,
      doctorIds: [k.doctorId, ...k.sessions.map((s) => s.doctorId)].filter((x): x is string => !!x),
      category: k.treatment.category,
      render: (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/treatments/packages/${k.id}`} className="text-[15px] font-semibold text-ink hover:text-accent">
                {k.treatment.name}
                {k.bodyArea && !k.treatment.name.toLowerCase().includes(k.bodyArea.toLowerCase()) ? ` – ${k.bodyArea}` : ""}
              </Link>
              <p className="mt-0.5 text-[13px] text-muted">
                {fmtDate(first?.performedAt ?? k.purchaseDate)}
                {last && last !== first ? ` – ${fmtDate(last.performedAt)}` : ""} · {[k.doctor?.fullName, k.therapist?.fullName].filter(Boolean).join(" · ") || "—"} · {k.branch.name}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge tone="neutral">{k.treatment.category}</Badge>
              <StatusBadge kind="package" status={k.status} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Sessions</p>
              <p className="tabular font-medium text-ink">
                {k.completedSessions} / {k.totalSessions}
                <span className="font-normal text-muted"> · {Math.max(0, k.totalSessions - k.completedSessions)} left</span>
              </p>
              <div className="mt-1 max-w-32">
                <ProgressBar done={k.completedSessions} total={k.totalSessions} />
              </div>
            </div>
            {showMoney && (
              <>
                <div>
                  <p className="text-xs text-muted">Amount paid</p>
                  <p className="tabular font-medium text-success">{money(money_.paid, { decimals: false })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Pending</p>
                  <p className={`tabular font-medium ${money_.pending > 0 ? "text-warning" : "text-ink"}`}>{money(money_.pending, { decimals: false })}</p>
                </div>
              </>
            )}
            <div>
              <p className="text-xs text-muted">Next appointment</p>
              <p className="font-medium text-ink">
                {nextAppt ? (
                  <Link href={`/appointments/${nextAppt.id}`} className="hover:text-accent">
                    {fmtDateTime(nextAppt.startAt)}
                  </Link>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </div>
          {(k.notes || observations.length > 0) && (
            <p className="mt-3 text-[13px] text-ink-2">
              <span className="text-muted">Notes: </span>
              {[k.notes, observations[observations.length - 1]].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
            {pc > 0 && (
              <Link href={`/patients/${p.id}?tab=photos&package=${k.id}`} className="inline-flex items-center gap-1 hover:text-accent">
                <Camera className="h-3.5 w-3.5" /> {pc} photo{pc === 1 ? "" : "s"}
              </Link>
            )}
            <span>{k.code}</span>
          </div>
          {k.sessions.length > 0 && (
            <details className="group mt-3">
              <summary className="cursor-pointer text-[13px] font-medium text-accent">Session history ({k.sessions.length})</summary>
              <ol className="mt-2 space-y-1.5 border-l border-border pl-4">
                {k.sessions.map((s) => (
                  <li key={s.id} className="text-[13px]">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular font-medium text-ink">{s.sessionNumber ? `#${s.sessionNumber}` : "—"}</span>
                      <span className="text-ink-2">{fmtDate(s.performedAt ?? s.scheduledAt)}</span>
                      <StatusBadge kind="session" status={s.status} />
                      {s.therapist && <span className="text-muted">{s.therapist.fullName}</span>}
                    </span>
                    {(s.observations || s.notes) && <span className="block text-xs text-muted">{s.observations ?? s.notes}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ),
    });
  }

  for (const s of looseSessions) {
    const d = s.performedAt ?? s.scheduledAt ?? s.createdAt;
    entries.push({
      key: `ses-${s.id}`,
      kind: "session",
      date: d,
      visitDates: [d],
      branchId: s.branchId,
      branchName: s.branch.name,
      doctorIds: s.doctorId ? [s.doctorId] : [],
      category: s.treatment.category,
      render: (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[15px] font-semibold text-ink">{s.treatment.name}</p>
            <p className="mt-0.5 text-[13px] text-muted">
              {fmtDate(d)} · {[s.doctor?.fullName, s.therapist?.fullName].filter(Boolean).join(" · ") || "—"} · {s.branch.name}
            </p>
            {(s.observations || s.notes) && <p className="mt-2 text-[13px] text-ink-2">{s.observations ?? s.notes}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            <Badge tone="neutral">{s.treatment.category}</Badge>
            <StatusBadge kind="session" status={s.status} />
          </div>
        </div>
      ),
    });
  }

  for (const c of consultations) {
    entries.push({
      key: `con-${c.id}`,
      kind: "consultation",
      date: c.consultationDate,
      visitDates: [c.consultationDate],
      branchId: c.branchId,
      branchName: c.branch.name,
      doctorIds: [c.doctorId],
      category: "Consultation",
      render: (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link href={`/patients/${p.id}?tab=consultations#c-${c.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink hover:text-accent">
                <Stethoscope className="h-4 w-4 text-muted" /> Consultation
              </Link>
              <p className="mt-0.5 text-[13px] text-muted">
                {fmtDate(c.consultationDate)} · {c.doctor.fullName} · {c.branch.name}
              </p>
            </div>
            <Badge tone="violet">Consultation</Badge>
          </div>
          <div className="mt-2 grid gap-1 text-[13px] text-ink-2">
            {c.complaint && (
              <p>
                <span className="text-muted">Complaint: </span>
                {c.complaint}
              </p>
            )}
            {c.treatmentRecommended && (
              <p>
                <span className="text-muted">Recommended: </span>
                {c.treatmentRecommended}
              </p>
            )}
            {c.followUpDate && (
              <p>
                <span className="text-muted">Follow-up: </span>
                {fmtDate(c.followUpDate)}
              </p>
            )}
          </div>
        </div>
      ),
    });
  }

  // Product purchases and billed items without a package, grouped per invoice.
  const byInvoice = new Map<string, typeof items>();
  for (const it of items) {
    if (it.invoice.deletedAt) continue;
    byInvoice.set(it.invoice.id, [...(byInvoice.get(it.invoice.id) ?? []), it]);
  }
  for (const [invId, its] of byInvoice) {
    const inv = its[0]!.invoice;
    const products = its.filter((i) => i.kind === "PRODUCT");
    const other = its.filter((i) => i.kind !== "PRODUCT");
    const totals = its.map(shareOf).reduce((a, b) => ({ paid: a.paid + b.paid, pending: a.pending + b.pending, billed: a.billed + b.billed }), { paid: 0, pending: 0, billed: 0 });
    entries.push({
      key: `inv-${invId}`,
      kind: products.length && !other.length ? "products" : "billed",
      date: inv.date,
      visitDates: [inv.date],
      branchId: inv.branchId,
      branchName: inv.branch.name,
      doctorIds: [],
      category: products.length && !other.length ? "Products" : (other[0]?.treatment?.category ?? "Other"),
      render: (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink">
                <ShoppingBag className="h-4 w-4 text-muted" /> {products.length && !other.length ? "Products purchased" : "Billed treatment / service"}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {fmtDate(inv.date)} · {inv.branch.name}
                {showMoney && (
                  <>
                    {" · "}
                    <Link href={`/billing/${inv.id}`} className="hover:text-accent">
                      {inv.number}
                    </Link>
                  </>
                )}
              </p>
            </div>
            {showMoney && (
              <span className="tabular text-[13px] text-ink-2">
                Paid <strong className="font-medium text-success">{money(totals.paid, { decimals: false })}</strong>
                {totals.pending > 0 && (
                  <>
                    {" · "}Pending <strong className="font-medium text-warning">{money(totals.pending, { decimals: false })}</strong>
                  </>
                )}
              </span>
            )}
          </div>
          <ul className="mt-2 space-y-0.5 text-[13px] text-ink-2">
            {its.map((i) => (
              <li key={i.id}>
                {i.description} <span className="text-muted">× {toNum(i.quantity)}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    });
  }

  // Filter options (from the full history, before filtering)
  const years = [...new Set(entries.map((e) => istDateKey(e.date).slice(0, 4)))].sort().reverse();
  const categories = [...new Set(entries.map((e) => e.category))].sort();
  const doctorMap = new Map<string, string>();
  for (const k of packages) {
    if (k.doctor) doctorMap.set(k.doctor.id, k.doctor.fullName);
    for (const s of k.sessions) if (s.doctor) doctorMap.set(s.doctor.id, s.doctor.fullName);
  }
  for (const c of consultations) doctorMap.set(c.doctor.id, c.doctor.fullName);
  for (const s of looseSessions) if (s.doctor) doctorMap.set(s.doctor.id, s.doctor.fullName);
  const branchMap = new Map(entries.map((e) => [e.branchId, e.branchName]));

  const fYear = one(sp.year);
  const fCat = one(sp.category);
  const fDoc = one(sp.doctor);
  const fBranch = one(sp.branch);
  const fFrom = one(sp.from);
  const fTo = one(sp.to);
  const fromD = /^\d{4}-\d{2}-\d{2}$/.test(fFrom) ? fromIst(fFrom) : null;
  const toD = /^\d{4}-\d{2}-\d{2}$/.test(fTo) ? fromIst(addDaysKey(fTo, 1)) : null;

  const filtered = entries
    .filter((e) => !fYear || istDateKey(e.date).startsWith(fYear))
    .filter((e) => !fCat || e.category === fCat)
    .filter((e) => !fDoc || e.doctorIds.includes(fDoc))
    .filter((e) => !fBranch || e.branchId === fBranch)
    .filter((e) => (!fromD && !toD) || e.visitDates.some((d) => (!fromD || d >= fromD) && (!toD || d < toD)))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const grouped = new Map<string, Entry[]>();
  for (const e of filtered) {
    const y = istDateKey(e.date).slice(0, 4);
    grouped.set(y, [...(grouped.get(y) ?? []), e]);
  }

  const totalSessions = packages.reduce((s, k) => s + k.completedSessions, 0) + looseSessions.filter((s) => s.status === "COMPLETED").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Patient since <strong className="font-medium text-ink">{fmtDate(p.firstVisitAt ?? p.registeredAt)}</strong> · {packages.length} treatment
          {packages.length === 1 ? "" : "s"} · {totalSessions} completed session{totalSessions === 1 ? "" : "s"} · {consultations.length} consultation{consultations.length === 1 ? "" : "s"}
        </p>
      </div>
      <FilterBar>
        <SelectParam name="year" placeholder="All years" options={years.map((y) => [y, y] as const)} />
        <SelectParam name="category" placeholder="All categories" options={categories.map((c) => [c, c] as const)} />
        <SelectParam name="doctor" placeholder="All doctors" options={[...doctorMap].map(([id, n]) => [id, n] as const)} />
        {branchMap.size > 1 && <SelectParam name="branch" placeholder="All branches" options={[...branchMap].map(([id, n]) => [id, n] as const)} />}
        <DateParam name="from" label="Visits from" />
        <DateParam name="to" label="to" />
      </FilterBar>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<History className="h-5 w-5" />} title={entries.length ? "Nothing matches these filters" : "No treatment history yet"} description={entries.length ? "Try clearing a filter." : "Treatments, sessions, consultations and purchases will appear here as a lifetime record."} />
        </Card>
      ) : (
        [...grouped].map(([year, list]) => (
          <section key={year}>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="tabular text-lg font-semibold text-ink">{year}</h3>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted">
                {list.length} record{list.length === 1 ? "" : "s"}
              </span>
            </div>
            <ol className="space-y-3">
              {list.map((e) => (
                <li key={e.key} className="relative rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
                  {e.render}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      {packages.some((k) => k.appointments.length) && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock className="h-3.5 w-3.5" /> Next appointments are shown on each active treatment.
        </p>
      )}
    </div>
  );
}
