import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { staffOptions } from "@/lib/lookups";
import { INACTIVE_STATUSES, weekStartKey } from "@/lib/appointments";
import { addDaysKey, fmtDate, fmtMonth, fmtTime, fmtWeekday, fromIst, istDateKey } from "@/lib/format";
import { STATUS } from "@/lib/status";
import { PageHeader, withParams } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/form";
import { DateParam, FilterBar, SegmentParam, SelectParam } from "@/components/ui/filters";
import { Table, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { DayGrid, MonthGrid, WeekGrid, type CalAppt } from "./_components/calendar";
import { quickAdvanceAction } from "./actions";

export const metadata = { title: "Appointments" };

const VIEWS = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["list", "List"],
] as const;

const NEXT_STEP: Record<string, [string, string]> = {
  BOOKED: ["CONFIRMED", "Confirm"],
  CONFIRMED: ["CHECKED_IN", "Check in"],
  CHECKED_IN: ["IN_TREATMENT", "Start"],
  IN_TREATMENT: ["COMPLETED", "Complete"],
};

function monthShift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const user = await requirePermission("appointments.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const view = (["day", "week", "month", "list"].includes(one("view")) ? one("view") : "day") as "day" | "week" | "month" | "list";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one("date")) ? one("date") : istDateKey();
  const group = one("group") === "therapist" ? "therapist" : "doctor";

  // Clinicians see their own schedule by default.
  const clinicianRole = user.staff && (user.roleKey === "DOCTOR" || user.roleKey === "THERAPIST") ? user.roleKey : null;
  const who = clinicianRole ? (one("who") === "all" ? "all" : "mine") : "all";
  let doctor = one("doctor");
  let therapist = one("therapist");
  if (who === "mine" && clinicianRole === "DOCTOR" && !doctor) doctor = user.staff!.id;
  if (who === "mine" && clinicianRole === "THERAPIST" && !therapist) therapist = user.staff!.id;
  const status = one("status");
  const treatment = one("treatment");

  // Visible range
  let rangeStart: string, rangeEnd: string, title: string, prev: string, next: string;
  if (view === "week") {
    rangeStart = weekStartKey(date);
    rangeEnd = addDaysKey(rangeStart, 7);
    const last = addDaysKey(rangeStart, 6);
    title = `${fmtDate(fromIst(rangeStart)).replace(/ \d{4}$/, "")} – ${fmtDate(fromIst(last))}`;
    prev = addDaysKey(date, -7);
    next = addDaysKey(date, 7);
  } else if (view === "month") {
    const month = date.slice(0, 7);
    const wd = new Date(`${month}-01T00:00:00Z`).getUTCDay();
    rangeStart = addDaysKey(`${month}-01`, -((wd + 6) % 7));
    rangeEnd = addDaysKey(rangeStart, 42);
    title = fmtMonth(fromIst(`${month}-15`));
    prev = `${monthShift(month, -1)}-01`;
    next = `${monthShift(month, 1)}-01`;
  } else {
    rangeStart = date;
    rangeEnd = addDaysKey(date, 1);
    title = `${fmtWeekday(fromIst(date, "12:00"))}, ${fmtDate(fromIst(date, "12:00"))}`;
    prev = addDaysKey(date, -1);
    next = addDaysKey(date, 1);
  }

  const where: Prisma.AppointmentWhereInput = {
    deletedAt: null,
    branchId: { in: scope.ids },
    startAt: { gte: fromIst(rangeStart), lt: fromIst(rangeEnd) },
    ...(doctor ? { doctorId: doctor } : {}),
    ...(therapist ? { therapistId: therapist } : {}),
    ...(treatment ? { treatmentId: treatment } : {}),
    ...(status ? { status: status as never } : view === "list" ? {} : { status: { not: "RESCHEDULED" } }),
  };

  const [rows, staff, treatments] = await Promise.all([
    db.appointment.findMany({
      where,
      include: {
        patient: { select: { fullName: true, code: true, mobile: true, id: true } },
        treatment: { select: { name: true } },
        doctor: { select: { fullName: true } },
        therapist: { select: { fullName: true } },
        branch: { select: { code: true } },
        package: { select: { name: true, totalSessions: true, completedSessions: true } },
      },
      orderBy: { startAt: "asc" },
    }),
    staffOptions(scope.ids, ["DOCTOR", "THERAPIST"]),
    db.treatment.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const appts: CalAppt[] = rows.map((a) => ({
    id: a.id,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    patientName: a.patient.fullName,
    treatment: a.treatment?.name ?? null,
    doctorId: a.doctorId,
    doctor: a.doctor?.fullName ?? null,
    therapistId: a.therapistId,
    therapist: a.therapist?.fullName ?? null,
    branchCode: a.branch.code,
    packageLabel: a.package ? `${a.package.completedSessions}/${a.package.totalSessions}` : null,
  }));

  const doctors = staff.filter((s) => s.staffType === "DOCTOR");
  const therapists = staff.filter((s) => s.staffType === "THERAPIST");
  const base = "/appointments";
  const href = (o: Record<string, string | null>) => withParams(base, sp as Record<string, string | string[] | undefined>, o);
  const dayHref = (d: string) => href({ view: null, date: d });
  const manage = can(user, "appointments.manage");
  const canComplete = can(user, "sessions.update");

  // Day-view columns: doctors or therapists (filtered), plus "Unassigned" when needed.
  const groupKey = group === "therapist" ? "therapistId" : "doctorId";
  const pool = (group === "therapist" ? therapists : doctors).filter((s) => !(group === "therapist" ? therapist : doctor) || s.id === (group === "therapist" ? therapist : doctor));
  const columns: { id: string | null; name: string }[] = pool.map((s) => ({ id: s.id, name: s.fullName }));
  for (const a of appts) {
    const id = a[groupKey];
    if (id && !columns.some((c) => c.id === id)) columns.push({ id, name: (group === "therapist" ? a.therapist : a.doctor) ?? "Staff" });
  }
  if (appts.some((a) => !a[groupKey])) columns.push({ id: null, name: group === "therapist" ? "No therapist" : "No doctor" });
  if (columns.length === 0) columns.push({ id: null, name: "Appointments" });

  const hoursFrom = scope.current ? [scope.current] : scope.branches;
  const openTime = hoursFrom.reduce((m, b) => (b.openTime < m ? b.openTime : m), "23:59");
  const closeTime = hoursFrom.reduce((m, b) => (b.closeTime > m ? b.closeTime : m), "00:00");

  const counts = new Map<string, number>();
  for (const a of appts) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const active = appts.filter((a) => !INACTIVE_STATUSES.includes(a.status)).length;

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`${scope.current?.name ?? "All branches"} · ${active} active appointment${active === 1 ? "" : "s"} in view`}
        actions={
          manage && (
            <LinkButton href={`/appointments/new?date=${date}`}>
              <CalendarPlus className="h-4 w-4" /> Book appointment
            </LinkButton>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={href({ date: prev })} className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-ink-2 hover:bg-surface-2" aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Link href={href({ date: istDateKey() })} className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] leading-9 font-medium text-ink-2 hover:bg-surface-2">
                Today
              </Link>
              <Link href={href({ date: next })} className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-ink-2 hover:bg-surface-2" aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Link>
              <h2 className="ml-1 text-[15px] font-semibold text-ink">{title}</h2>
            </div>
            <SegmentParam name="view" options={VIEWS} defaultValue="day" />
          </div>
          <FilterBar>
            <DateParam name="date" />
            {view === "day" && (
              <SegmentParam
                name="group"
                defaultValue="doctor"
                options={[
                  ["doctor", "By doctor"],
                  ["therapist", "By therapist"],
                ]}
              />
            )}
            {clinicianRole && (
              <SegmentParam
                name="who"
                defaultValue="mine"
                options={[
                  ["mine", "My schedule"],
                  ["all", "Everyone"],
                ]}
              />
            )}
            <SelectParam name="doctor" placeholder="All doctors" options={doctors.map((d) => [d.id, d.fullName] as const)} />
            <SelectParam name="therapist" placeholder="All therapists" options={therapists.map((d) => [d.id, d.fullName] as const)} />
            <SelectParam name="treatment" placeholder="All treatments" options={treatments.map((t) => [t.id, t.name] as const)} />
            <SelectParam name="status" placeholder="Any status" options={Object.entries(STATUS.appointment).map(([k, [, l]]) => [k, l] as const)} />
          </FilterBar>
          {appts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(STATUS.appointment)
                .filter((k) => counts.get(k))
                .map((k) => (
                  <Badge key={k} tone={(STATUS.appointment as Record<string, [never, string]>)[k]![0]}>
                    {(STATUS.appointment as Record<string, [string, string]>)[k]![1]} · {counts.get(k)}
                  </Badge>
                ))}
            </div>
          )}
        </div>

        {view === "day" && (
          <DayGrid date={date} appts={appts} columns={columns} groupKey={groupKey} openTime={openTime} closeTime={closeTime} showBranch={scope.isAll} canBook={manage} />
        )}
        {view === "week" && <WeekGrid start={rangeStart} appts={appts} showBranch={scope.isAll} dayHref={dayHref} />}
        {view === "month" && <MonthGrid month={date.slice(0, 7)} appts={appts} dayHref={dayHref} />}
        {view === "list" &&
          (rows.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No appointments on this day" description="Use the arrows to move between days, or book a new appointment." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>Patient</TH>
                  <TH className="hidden md:table-cell">Treatment</TH>
                  <TH className="hidden lg:table-cell">Doctor / Therapist</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Next step</TH>
                </tr>
              </THead>
              <tbody>
                {rows.length === 0 && <TableEmpty colSpan={6}>No appointments</TableEmpty>}
                {rows.map((a) => {
                  const step = NEXT_STEP[a.status];
                  const allowed = step && (step[0] === "COMPLETED" ? canComplete : step[0] === "CONFIRMED" ? manage : manage || canComplete);
                  return (
                    <TR key={a.id}>
                      <TD className="tabular whitespace-nowrap text-ink-2">
                        <Link href={`/appointments/${a.id}`} className="hover:text-accent">
                          {fmtTime(a.startAt)}
                        </Link>
                        {scope.isAll && <span className="ml-1.5 text-[11px] text-muted">{a.branch.code}</span>}
                      </TD>
                      <TD>
                        <Link href={`/appointments/${a.id}`} className="font-medium hover:text-accent">
                          {a.patient.fullName}
                        </Link>
                        <p className="text-xs text-muted md:hidden">{a.treatment?.name ?? "Consultation"}</p>
                      </TD>
                      <TD className="hidden text-ink-2 md:table-cell">
                        {a.treatment?.name ?? "Consultation"}
                        {a.package && <span className="block text-xs text-muted">Package · {a.package.completedSessions}/{a.package.totalSessions} done</span>}
                      </TD>
                      <TD className="hidden text-ink-2 lg:table-cell">{[a.doctor?.fullName, a.therapist?.fullName].filter(Boolean).join(" · ") || "—"}</TD>
                      <TD>
                        <StatusBadge kind="appointment" status={a.status} />
                      </TD>
                      <TD className="text-right">
                        {allowed ? (
                          <ActionButton
                            action={quickAdvanceAction}
                            fields={{ id: a.id, status: step[0] }}
                            variant={step[0] === "COMPLETED" ? "primary" : "outline"}
                            confirm={step[0] === "COMPLETED" ? `Mark ${a.patient.fullName}'s ${a.treatment?.name ?? "visit"} as completed?` : undefined}
                          >
                            {step[1]}
                          </ActionButton>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          ))}
      </Card>
    </>
  );
}
