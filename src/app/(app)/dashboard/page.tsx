import Link from "next/link";
import {
  AlertTriangle, CalendarClock, CalendarDays, Hourglass, IndianRupee, Package, PiggyBank, Receipt, Repeat, Sparkles,
  UserCheck, UserPlus, Users, Wallet,
} from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { lowStockProducts } from "@/lib/inventory";
import {
  addDaysKey, fmtDate, fmtDateShort, fmtNum, fmtTime, fmtWeekday, istDateKey, istDayRange, istMonthRange, money, moneyShort, relativeDays, toNum,
} from "@/lib/format";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD } from "@/components/ui/table";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";

export const metadata = { title: "Dashboard" };

async function cashIn(ids: string[], start: Date, end: Date) {
  const rows = await db.payment.groupBy({
    by: ["kind"],
    where: { branchId: { in: ids }, paidAt: { gte: start, lt: end }, method: { not: "ADVANCE" } },
    _sum: { amount: true },
  });
  const r = rows.find((x) => x.kind === "RECEIPT")?._sum.amount;
  const f = rows.find((x) => x.kind === "REFUND")?._sum.amount;
  return toNum(r) - toNum(f);
}

export default async function DashboardPage() {
  const user = await requirePermission("dashboard.view");
  const scope = await getBranchScope();
  const ids = scope.ids;
  const financial = can(user, "dashboard.financials");
  const today = istDateKey();
  const { start: dayStart, end: dayEnd } = istDayRange(today);
  const { start: monthStart, end: monthEnd } = istMonthRange(today.slice(0, 7));
  const in7 = new Date(dayEnd.getTime() + 6 * 86400000);
  const in30 = new Date(dayStart.getTime() + 30 * 86400000);

  // Doctors & therapists see their own schedule first.
  const mine =
    user.staff && (user.roleKey === "DOCTOR" || user.roleKey === "THERAPIST")
      ? user.roleKey === "DOCTOR"
        ? { doctorId: user.staff.id }
        : { therapistId: user.staff.id }
      : {};

  const [
    totalPatients, newToday, appointments, upcomingSessions, activePackages, expiring, followUps, leadFollowUps,
    activeStaff, attendanceToday, leavesToday, lowStock,
  ] = await Promise.all([
    db.patient.count({ where: { deletedAt: null, branchId: { in: ids } } }),
    db.patient.count({ where: { deletedAt: null, branchId: { in: ids }, registeredAt: { gte: dayStart, lt: dayEnd } } }),
    db.appointment.findMany({
      where: { deletedAt: null, branchId: { in: ids }, startAt: { gte: dayStart, lt: dayEnd }, status: { not: "RESCHEDULED" }, ...mine },
      include: {
        patient: { select: { id: true, fullName: true, code: true, firstVisitAt: true, registeredAt: true } },
        treatment: { select: { name: true } },
        doctor: { select: { fullName: true } },
        therapist: { select: { fullName: true } },
        branch: { select: { code: true } },
      },
      orderBy: { startAt: "asc" },
    }),
    db.treatmentSession.count({ where: { branchId: { in: ids }, status: "SCHEDULED", scheduledAt: { gte: dayStart, lt: in7 }, ...mine } }),
    db.treatmentPackage.count({ where: { deletedAt: null, branchId: { in: ids }, status: "ACTIVE" } }),
    db.treatmentPackage.findMany({
      where: { deletedAt: null, branchId: { in: ids }, status: "ACTIVE", expiryDate: { gte: dayStart, lt: in30 } },
      include: { patient: { select: { id: true, fullName: true } } },
      orderBy: { expiryDate: "asc" },
      take: 6,
    }),
    db.consultation.findMany({
      where: { deletedAt: null, branchId: { in: ids }, followUpDate: { gte: new Date(dayStart.getTime() - 7 * 86400000), lt: in7 }, ...(mine.doctorId ? { doctorId: mine.doctorId } : {}) },
      include: { patient: { select: { id: true, fullName: true, mobile: true } }, doctor: { select: { fullName: true } } },
      orderBy: { followUpDate: "asc" },
      take: 6,
    }),
    can(user, "leads.view")
      ? db.lead.count({ where: { deletedAt: null, branchId: { in: ids }, status: { notIn: ["LOST", "TREATMENT_PURCHASED"] }, followUpDate: { lt: dayEnd } } })
      : Promise.resolve(0),
    db.staff.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_NOTICE"] }, branchId: { in: ids } }, select: { id: true, fullName: true, weeklyOff: true, designation: true } }),
    db.attendance.findMany({ where: { branchId: { in: ids }, date: new Date(`${today}T00:00:00Z`) }, select: { staffId: true, status: true, checkIn: true, lateMinutes: true } }),
    db.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: new Date(`${today}T00:00:00Z`) }, toDate: { gte: new Date(`${today}T00:00:00Z`) } }, select: { staffId: true } }),
    can(user, "inventory.view") ? lowStockProducts(ids) : Promise.resolve([]),
  ]);

  const live = appointments.filter((a) => !["CANCELLED", "NO_SHOW"].includes(a.status));
  const returning = new Set(live.filter((a) => (a.patient.firstVisitAt ?? a.patient.registeredAt) < dayStart).map((a) => a.patient.id)).size;
  const done = live.filter((a) => a.status === "COMPLETED").length;

  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const onLeave = new Set([...leavesToday.map((l) => l.staffId), ...attendanceToday.filter((a) => a.status === "LEAVE").map((a) => a.staffId)]);
  const att = new Map(attendanceToday.map((a) => [a.staffId, a]));
  const rostered = activeStaff.filter((s) => !s.weeklyOff.includes(weekday) && !onLeave.has(s.id));
  const present = rostered.filter((s) => {
    const a = att.get(s.id);
    return a && (a.status === "PRESENT" || a.status === "HALF_DAY") && a.checkIn;
  });
  const late = present.filter((s) => (att.get(s.id)?.lateMinutes ?? 0) > 10).length;
  const notIn = rostered.filter((s) => !present.includes(s));

  // Financials
  type BranchRow = { id: string; name: string; revenue: number; expenses: number; appts: number; newPatients: number; pending: number };
  let fin: null | {
    today: number; month: number; pending: number; pendingCount: number; expensesToday: number; expensesMonth: number;
    chart: { label: string; value: number; sub: string }[];
    branches: BranchRow[];
  } = null;
  if (financial) {
    const chartStart = new Date(dayStart.getTime() - 13 * 86400000);
    const [t, m, pending, expT, expM, pays] = await Promise.all([
      cashIn(ids, dayStart, dayEnd),
      cashIn(ids, monthStart, monthEnd),
      db.invoice.aggregate({ where: { deletedAt: null, branchId: { in: ids }, status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { balance: true }, _count: true }),
      db.expense.aggregate({ where: { deletedAt: null, branchId: { in: ids }, status: { not: "REJECTED" }, date: { gte: dayStart, lt: dayEnd } }, _sum: { amount: true } }),
      db.expense.aggregate({ where: { deletedAt: null, branchId: { in: ids }, status: { not: "REJECTED" }, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
      db.payment.findMany({ where: { branchId: { in: ids }, paidAt: { gte: chartStart, lt: dayEnd }, method: { not: "ADVANCE" } }, select: { paidAt: true, amount: true, kind: true } }),
    ]);
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i--) buckets.set(addDaysKey(today, -i), 0);
    for (const p of pays) {
      const k = istDateKey(p.paidAt);
      if (buckets.has(k)) buckets.set(k, buckets.get(k)! + (p.kind === "REFUND" ? -1 : 1) * toNum(p.amount));
    }
    const chart = [...buckets.entries()].map(([k, v]) => {
      const d = new Date(`${k}T06:30:00Z`);
      return { label: k === today ? "Today" : fmtDateShort(d).replace(/^0/, ""), value: Math.round(v), sub: `${fmtWeekday(d)}, ${fmtDate(d)}` };
    });

    let branchRows: BranchRow[] = [];
    if (scope.branches.length > 1 && scope.isAll) {
      branchRows = await Promise.all(
        scope.branches.map(async (b) => {
          const [rev, exp, ap, np, pend] = await Promise.all([
            cashIn([b.id], monthStart, monthEnd),
            db.expense.aggregate({ where: { deletedAt: null, branchId: b.id, status: { not: "REJECTED" }, date: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true } }),
            db.appointment.count({ where: { deletedAt: null, branchId: b.id, startAt: { gte: monthStart, lt: monthEnd }, status: "COMPLETED" } }),
            db.patient.count({ where: { deletedAt: null, branchId: b.id, registeredAt: { gte: monthStart, lt: monthEnd } } }),
            db.invoice.aggregate({ where: { deletedAt: null, branchId: b.id, status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { balance: true } }),
          ]);
          return { id: b.id, name: b.name, revenue: rev, expenses: toNum(exp._sum.amount), appts: ap, newPatients: np, pending: toNum(pend._sum.balance) };
        }),
      );
    }
    fin = {
      today: t,
      month: m,
      pending: toNum(pending._sum.balance),
      pendingCount: pending._count,
      expensesToday: toNum(expT._sum.amount),
      expensesMonth: toNum(expM._sum.amount),
      chart,
      branches: branchRows,
    };
  }

  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">
            {fmtWeekday(new Date())}, {fmtDate(new Date())} · {scope.current?.name ?? "All branches"}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {greeting}, {user.name.replace(/^Dr\.\s*/, "Dr. ").split(" ").slice(0, 2).join(" ")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, "patients.create") && (
            <LinkButton href="/patients/new" variant="outline">
              <UserPlus className="h-4 w-4" /> New patient
            </LinkButton>
          )}
          {can(user, "appointments.manage") && (
            <LinkButton href="/appointments/new" variant="outline">
              <CalendarDays className="h-4 w-4" /> Book appointment
            </LinkButton>
          )}
          {can(user, "billing.create") && (
            <LinkButton href="/billing/new">
              <Receipt className="h-4 w-4" /> New invoice
            </LinkButton>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Today's appointments" value={fmtNum(live.length)} hint={`${done} completed · ${live.length - done} to go`} icon={<CalendarDays className="h-[18px] w-[18px]" />} tone="accent" href="/appointments" />
        <StatCard label="New patients today" value={fmtNum(newToday)} hint={`${returning} returning patient${returning === 1 ? "" : "s"} today`} icon={<UserPlus className="h-[18px] w-[18px]" />} tone="info" href="/patients?sort=new" />
        <StatCard label="Registered patients" value={fmtNum(totalPatients)} hint={scope.current ? scope.current.name : "All branches"} icon={<Users className="h-[18px] w-[18px]" />} tone="violet" href="/patients" />
        <StatCard label="Staff present" value={`${present.length} / ${rostered.length}`} hint={`${notIn.length} not in · ${late} late · ${onLeave.size} on leave`} icon={<UserCheck className="h-[18px] w-[18px]" />} tone="success" href="/attendance" />
        {fin && (
          <>
            <StatCard label="Today's revenue" value={money(fin.today, { decimals: false })} hint="Payments received today" icon={<IndianRupee className="h-[18px] w-[18px]" />} tone="success" href="/payments" />
            <StatCard label="This month's revenue" value={moneyShort(fin.month)} hint={`Expenses ${moneyShort(fin.expensesMonth)}`} icon={<Wallet className="h-[18px] w-[18px]" />} tone="accent" href="/reports" />
            <StatCard label="Pending payments" value={moneyShort(fin.pending)} hint={`${fin.pendingCount} invoice${fin.pendingCount === 1 ? "" : "s"} outstanding`} icon={<Hourglass className="h-[18px] w-[18px]" />} tone="warning" href="/billing?status=due" />
            <StatCard label="Today's expenses" value={money(fin.expensesToday, { decimals: false })} hint="Excludes rejected claims" icon={<PiggyBank className="h-[18px] w-[18px]" />} tone="neutral" href="/expenses" />
          </>
        )}
        <StatCard label="Upcoming sessions (7 days)" value={fmtNum(upcomingSessions)} hint="Scheduled package sessions" icon={<CalendarClock className="h-[18px] w-[18px]" />} tone="info" href="/sessions" />
        <StatCard label="Active packages" value={fmtNum(activePackages)} hint={`${expiring.length} expiring within 30 days`} icon={<Sparkles className="h-[18px] w-[18px]" />} tone="accent" href="/treatments?tab=packages" />
        <StatCard label="Patient follow-ups" value={fmtNum(followUps.length)} hint={leadFollowUps ? `${leadFollowUps} lead follow-ups due` : "Due this week"} icon={<Repeat className="h-[18px] w-[18px]" />} tone="violet" href="/patients?followup=1" />
        {can(user, "inventory.view") && (
          <StatCard label="Low stock alerts" value={fmtNum(lowStock.length)} hint={lowStock[0] ? `${lowStock[0].name}` : "All products above minimum"} icon={<Package className="h-[18px] w-[18px]" />} tone={lowStock.length ? "danger" : "success"} href="/inventory?filter=low" />
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Today's schedule */}
        <Card className="xl:col-span-2">
          <CardHeader
            title={mine.doctorId || mine.therapistId ? "My schedule today" : "Today's schedule"}
            description={`${live.length} active appointment${live.length === 1 ? "" : "s"}`}
            actions={<LinkButton href="/appointments" variant="ghost" size="sm">Open calendar →</LinkButton>}
          />
          {appointments.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No appointments today" description="Bookings for today will appear here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Patient</TH>
                  <TH className="hidden md:table-cell">Treatment</TH>
                  <TH className="hidden lg:table-cell">Doctor / Therapist</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <tbody>
                {appointments.map((a) => (
                  <TR key={a.id}>
                    <TD className="tabular whitespace-nowrap text-ink-2">
                      {fmtTime(a.startAt)}
                      {scope.isAll && <span className="ml-1.5 text-[11px] text-muted">{a.branch.code}</span>}
                    </TD>
                    <TD>
                      <Link href={`/patients/${a.patient.id}`} className="font-medium hover:text-accent">
                        {a.patient.fullName}
                      </Link>
                      <p className="text-xs text-muted md:hidden">{a.treatment?.name ?? "Consultation"}</p>
                    </TD>
                    <TD className="hidden text-ink-2 md:table-cell">{a.treatment?.name ?? "—"}</TD>
                    <TD className="hidden text-ink-2 lg:table-cell">
                      {[a.doctor?.fullName, a.therapist?.fullName].filter(Boolean).join(" · ") || "—"}
                    </TD>
                    <TD>
                      <StatusBadge kind="appointment" status={a.status} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          {/* Staff */}
          <Card>
            <CardHeader title="Staff today" description={`${present.length} present of ${rostered.length} rostered`} actions={<LinkButton href="/attendance" variant="ghost" size="sm">Attendance →</LinkButton>} />
            <CardBody className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Present", present.length, "text-success"],
                  ["Not in", notIn.length, "text-danger"],
                  ["On leave", onLeave.size, "text-violet"],
                ].map(([l, v, c]) => (
                  <div key={l as string} className="rounded-lg bg-surface-2 py-2.5">
                    <p className={`tabular text-lg font-semibold ${c}`}>{v}</p>
                    <p className="text-[11px] text-muted">{l}</p>
                  </div>
                ))}
              </div>
              {notIn.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">Not checked in yet</p>
                  <ul className="space-y-1">
                    {notIn.slice(0, 5).map((s) => (
                      <li key={s.id} className="flex justify-between text-[13px]">
                        <span className="text-ink">{s.fullName}</span>
                        <span className="text-muted">{s.designation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Alerts */}
          <Card>
            <CardHeader title="Alerts" />
            <CardBody className="space-y-4">
              {lowStock.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertTriangle className="h-3.5 w-3.5" /> Low stock
                  </p>
                  <ul className="space-y-1">
                    {lowStock.slice(0, 4).map((p) => (
                      <li key={p.id} className="flex justify-between gap-2 text-[13px]">
                        <Link href={`/inventory/${p.id}`} className="truncate text-ink hover:text-accent">{p.name}</Link>
                        <span className="tabular shrink-0 text-muted">
                          {fmtNum(p.stock)} / {fmtNum(p.min)} {p.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
                  <Hourglass className="h-3.5 w-3.5" /> Packages expiring in 30 days
                </p>
                {expiring.length === 0 ? (
                  <p className="text-[13px] text-muted">None</p>
                ) : (
                  <ul className="space-y-1">
                    {expiring.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2 text-[13px]">
                        <Link href={`/patients/${p.patient.id}?tab=packages`} className="truncate text-ink hover:text-accent">
                          {p.patient.fullName}
                          <span className="text-muted"> · {p.totalSessions - p.completedSessions} left</span>
                        </Link>
                        <span className="shrink-0 text-muted">{relativeDays(p.expiryDate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-violet">
                  <Repeat className="h-3.5 w-3.5" /> Doctor follow-ups
                </p>
                {followUps.length === 0 ? (
                  <p className="text-[13px] text-muted">None due</p>
                ) : (
                  <ul className="space-y-1">
                    {followUps.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2 text-[13px]">
                        <Link href={`/patients/${c.patient.id}?tab=consultations`} className="truncate text-ink hover:text-accent">
                          {c.patient.fullName}
                        </Link>
                        <span className={`shrink-0 ${c.followUpDate! < dayStart ? "text-danger" : "text-muted"}`}>{relativeDays(c.followUpDate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {fin && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className={fin.branches.length ? "xl:col-span-2" : "xl:col-span-3"}>
            <CardHeader title="Revenue — last 14 days" description="Payments received per day (net of refunds)" actions={<Badge tone="accent">{moneyShort(fin.chart.reduce((s, d) => s + d.value, 0))} total</Badge>} />
            <CardBody>
              <SimpleBarChart data={fin.chart} seriesLabel="Revenue" />
            </CardBody>
          </Card>
          {fin.branches.length > 0 && (
            <Card>
              <CardHeader title="Branch performance" description="This month" actions={<LinkButton href="/reports?tab=branches" variant="ghost" size="sm">Reports →</LinkButton>} />
              <Table>
                <THead>
                  <tr>
                    <TH>Branch</TH>
                    <TH className="text-right">Revenue</TH>
                    <TH className="text-right">Expenses</TH>
                    <TH className="text-right">Visits</TH>
                  </tr>
                </THead>
                <tbody>
                  {fin.branches.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <p className="font-medium">{b.name}</p>
                        <p className="text-xs text-muted">{b.newPatients} new patients · {moneyShort(b.pending)} due</p>
                      </TD>
                      <TD className="tabular text-right">{moneyShort(b.revenue)}</TD>
                      <TD className="tabular text-right text-ink-2">{moneyShort(b.expenses)}</TD>
                      <TD className="tabular text-right text-ink-2">{b.appts}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
