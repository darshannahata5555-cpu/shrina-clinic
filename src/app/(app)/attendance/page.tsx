import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus, Download, MonitorSmartphone, Pencil, Trash2, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { STATUS_LETTER, dateKeysBetween, impliedStatus, keyOfDbDate, monthKeys } from "@/lib/attendance";
import { cn, dbDate, fmtDate, fmtTime, fmtWeekday, humanize, istDateKey, istTimeKey, minutesToHours, weekdayOfKey } from "@/lib/format";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { ManualAttendanceForm, HolidayForm } from "./attendance-forms";
import { clearAttendanceAction, deleteHolidayAction } from "./actions";
import { MonthNav } from "./_components/month-calendar";
import { getSetting } from "@/lib/settings";

export const metadata = { title: "Attendance" };

const CELL_TONE: Record<string, string> = {
  P: "text-success",
  A: "text-danger bg-danger-soft",
  H: "text-warning bg-warning-soft",
  L: "text-violet bg-violet-soft",
  WO: "text-muted",
  HO: "text-info",
  "–": "text-muted",
};

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const user = await requireUser();
  if (!can(user, "attendance.view")) redirect("/attendance/me");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tab = str("tab") || "today";
  const today = istDateKey();
  const manage = can(user, "attendance.manage");
  const { lateGraceMinutes: grace } = await getSetting("payroll");
  const isLate = (m: number | undefined | null) => (m ?? 0) > grace;

  const branchIds = str("branch") && scope.ids.includes(str("branch")) ? [str("branch")] : scope.ids;
  const staff = await db.staff.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ACTIVE", "ON_NOTICE"] },
      branchId: { in: branchIds },
      ...(str("q") ? { OR: [{ fullName: { contains: str("q"), mode: "insensitive" } }, { code: { contains: str("q"), mode: "insensitive" } }] } : {}),
    },
    include: { branch: { select: { name: true, code: true } } },
    orderBy: [{ branchId: "asc" }, { fullName: "asc" }],
  });

  const tabs = [
    { key: "today", label: "Daily board", href: "/attendance" },
    { key: "register", label: "Monthly register", href: "/attendance?tab=register" },
    { key: "holidays", label: "Holidays", href: "/attendance?tab=holidays" },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Check-ins from the kiosk (PIN / QR), mobile and manual entries."
        actions={
          <>
            {user.staff && (
              <LinkButton href="/attendance/me" variant="outline">
                <UserRound className="h-4 w-4" /> My attendance
              </LinkButton>
            )}
            {manage && (
              <LinkButton href="/attendance/kiosk" variant="outline" target="_blank">
                <MonitorSmartphone className="h-4 w-4" /> Open kiosk
              </LinkButton>
            )}
            {manage && (
              <Dialog title="Mark attendance" trigger={<Button><CalendarPlus className="h-4 w-4" /> Mark attendance</Button>}>
                <ManualAttendanceForm values={{ date: str("date") || today }} maxDate={today} staff={staff.map((s) => ({ id: s.id, fullName: s.fullName, code: s.code }))} />
              </Dialog>
            )}
          </>
        }
      />
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "today" && <Board />}
      {tab === "register" && <Register />}
      {tab === "holidays" && <Holidays />}
    </>
  );

  async function Board() {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str("date")) && str("date") <= today ? str("date") : today;
    const [rows, holidays, leaves] = await Promise.all([
      db.attendance.findMany({ where: { staffId: { in: staff.map((s) => s.id) }, date: dbDate(date) } }),
      db.holiday.findMany({ where: { date: dbDate(date) } }),
      db.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: dbDate(date) }, toDate: { gte: dbDate(date) }, staffId: { in: staff.map((s) => s.id) } }, select: { staffId: true, type: true, dayType: true } }),
    ]);
    const byStaff = new Map(rows.map((r) => [r.staffId, r]));
    const leaveOf = new Map(leaves.map((l) => [l.staffId, l]));
    const list = staff
      .filter((s) => keyOfDbDate(dbDate(date)) >= istDateKey(s.joiningDate))
      .map((s) => {
        const r = byStaff.get(s.id);
        const hol = holidays.find((h) => !h.branchId || h.branchId === s.branchId);
        const status = r?.status === "PRESENT" && !r.checkIn && !r.checkOut ? "PRESENT" : (r?.status ?? impliedStatus({ dateKey: date, today, weeklyOff: s.weeklyOff, holiday: !!hol, onLeave: leaveOf.has(s.id) }));
        return { s, r, status, holiday: hol?.name };
      });
    const filtered = str("status") ? list.filter((x) => (str("status") === "LATE" ? isLate(x.r?.lateMinutes) : x.status === str("status"))) : list;
    const count = (st: string) => list.filter((x) => x.status === st).length;
    const late = list.filter((x) => isLate(x.r?.lateMinutes)).length;
    const rostered = list.filter((x) => !["WEEK_OFF", "HOLIDAY"].includes(x.status)).length;

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Present" value={`${count("PRESENT") + count("HALF_DAY")} / ${rostered}`} hint={`${count("HALF_DAY")} half day`} tone="success" />
          <StatCard label="Late arrivals" value={late} hint="Beyond grace period" tone="warning" />
          <StatCard label={date === today ? "Not in yet" : "Absent"} value={date === today ? count("NOT_IN") + count("ABSENT") : count("ABSENT")} tone="danger" />
          <StatCard label="On leave" value={count("LEAVE")} tone="violet" />
          <StatCard label="Week off / holiday" value={count("WEEK_OFF") + count("HOLIDAY")} />
        </div>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <FilterBar>
              <DateParam name="date" />
              <SearchParamInput placeholder="Employee name or ID" />
              {scope.branches.length > 1 && scope.isAll && <SelectParam name="branch" options={scope.branches.map((b) => [b.id, b.name] as const)} placeholder="All branches" />}
              <SelectParam
                name="status"
                placeholder="All statuses"
                options={[
                  ["PRESENT", "Present"],
                  ["LATE", "Late"],
                  ["HALF_DAY", "Half day"],
                  ["NOT_IN", "Not in yet"],
                  ["ABSENT", "Absent"],
                  ["LEAVE", "On leave"],
                  ["WEEK_OFF", "Week off"],
                ]}
              />
            </FilterBar>
            <p className="text-[13px] text-muted">
              {fmtWeekday(new Date(`${date}T06:00:00Z`))}, {fmtDate(new Date(`${date}T06:00:00Z`))}
            </p>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                {scope.isAll && <TH className="hidden lg:table-cell">Branch</TH>}
                <TH className="hidden md:table-cell">Shift</TH>
                <TH>In</TH>
                <TH>Out</TH>
                <TH className="hidden sm:table-cell text-right">Hours</TH>
                <TH className="hidden md:table-cell">Late / OT</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Method</TH>
                {manage && <TH />}
              </tr>
            </THead>
            <tbody>
              {filtered.length === 0 && <TableEmpty colSpan={10}>No employees match.</TableEmpty>}
              {filtered.map(({ s, r, status, holiday }) => (
                <TR key={s.id}>
                  <TD>
                    <Link href={`/staff/${s.id}?tab=attendance`} className="font-medium hover:text-accent">
                      {s.fullName}
                    </Link>
                    <p className="text-xs text-muted">{s.code} · {s.designation}</p>
                  </TD>
                  {scope.isAll && <TD className="hidden text-ink-2 lg:table-cell">{s.branch.code}</TD>}
                  <TD className="tabular hidden text-ink-2 md:table-cell">{s.shiftStart}–{s.shiftEnd}</TD>
                  <TD className="tabular whitespace-nowrap">{r?.checkIn ? fmtTime(r.checkIn) : "—"}</TD>
                  <TD className="tabular whitespace-nowrap">{r?.checkOut ? fmtTime(r.checkOut) : r?.checkIn ? <span className="text-muted">working</span> : "—"}</TD>
                  <TD className="tabular hidden text-right sm:table-cell">{r?.workMinutes ? minutesToHours(r.workMinutes) : "—"}</TD>
                  <TD className="hidden md:table-cell">
                    {isLate(r?.lateMinutes) ? <Badge tone="warning">{r!.lateMinutes}m late</Badge> : null}{" "}
                    {r?.overtimeMinutes ? <Badge tone="info">+{minutesToHours(r.overtimeMinutes)} OT</Badge> : null}
                    {!isLate(r?.lateMinutes) && !r?.overtimeMinutes && <span className="text-muted">—</span>}
                  </TD>
                  <TD>
                    {status === "NOT_IN" ? <Badge tone="neutral">Not in yet</Badge> : <StatusBadge kind="attendance" status={status} />}
                    {holiday && <p className="mt-0.5 text-[11px] text-muted">{holiday}</p>}
                  </TD>
                  <TD className="hidden text-[13px] text-ink-2 lg:table-cell">{r ? humanize(r.method) : "—"}</TD>
                  {manage && (
                    <TD className="whitespace-nowrap text-right">
                      <Dialog title={`Attendance — ${s.fullName}`} description={fmtDate(new Date(`${date}T06:00:00Z`))} trigger={<Button variant="ghost" size="sm" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>}>
                        <ManualAttendanceForm
                          maxDate={today}
                          values={{
                            staffId: s.id,
                            date,
                            status: r?.status ?? (status === "NOT_IN" || status === "UPCOMING" ? "PRESENT" : status),
                            checkIn: r?.checkIn ? istTimeKey(r.checkIn) : "",
                            checkOut: r?.checkOut ? istTimeKey(r.checkOut) : "",
                            notes: r?.notes,
                          }}
                        />
                      </Dialog>
                      {r && (
                        <ActionButton action={clearAttendanceAction} fields={{ id: r.id }} variant="ghost" confirm={`Clear ${s.fullName}'s attendance record for this day?`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </ActionButton>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function Register() {
    const month = /^\d{4}-\d{2}$/.test(str("month")) ? str("month") : today.slice(0, 7);
    const keys = monthKeys(month);
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    const [rows, holidays, leaves] = await Promise.all([
      db.attendance.findMany({ where: { staffId: { in: staff.map((s) => s.id) }, date: { gte: dbDate(first), lte: dbDate(last) } } }),
      db.holiday.findMany({ where: { date: { gte: dbDate(first), lte: dbDate(last) } } }),
      db.leaveRequest.findMany({ where: { status: "APPROVED", staffId: { in: staff.map((s) => s.id) }, fromDate: { lte: dbDate(last) }, toDate: { gte: dbDate(first) } } }),
    ]);
    const att = new Map(rows.map((r) => [`${r.staffId}|${keyOfDbDate(r.date)}`, r]));
    const leaveSet = new Set<string>();
    for (const l of leaves) for (const k of dateKeysBetween(keyOfDbDate(l.fromDate), keyOfDbDate(l.toDate))) leaveSet.add(`${l.staffId}|${k}`);

    const grid = staff.map((s) => {
      const join = istDateKey(s.joiningDate);
      const cells = keys.map((k) => {
        const r = att.get(`${s.id}|${k}`);
        if (r) return { k, letter: STATUS_LETTER[r.status]!, late: isLate(r.lateMinutes), ot: r.overtimeMinutes };
        if (k < join) return { k, letter: "", late: false, ot: 0 };
        const hol = holidays.some((h) => keyOfDbDate(h.date) === k && (!h.branchId || h.branchId === s.branchId));
        const st = impliedStatus({ dateKey: k, today, weeklyOff: s.weeklyOff, holiday: hol, onLeave: leaveSet.has(`${s.id}|${k}`) });
        return { k, letter: STATUS_LETTER[st] ?? "", late: false, ot: 0 };
      });
      const n = (l: string) => cells.filter((c) => c.letter === l).length;
      return { s, cells, P: n("P"), H: n("H"), A: n("A"), L: n("L"), late: cells.filter((c) => c.late).length, ot: cells.reduce((t, c) => t + c.ot, 0) };
    });

    return (
      <Card>
        <CardHeader
          title="Monthly attendance register"
          description="P present · H half day · A absent · L leave · WO week off · HO holiday · red dot = late"
          actions={
            <>
              <MonthNav month={month} hrefFor={(m) => `/attendance?tab=register&month=${m}${str("branch") ? `&branch=${str("branch")}` : ""}`} />
              <a href={`/attendance/export?month=${month}${str("branch") ? `&branch=${str("branch")}` : ""}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-2">
                <Download className="h-3.5 w-3.5" /> Excel
              </a>
            </>
          }
        />
        {grid.length === 0 ? (
          <EmptyState title="No employees in this branch" />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="sticky left-0 z-10 min-w-40 bg-surface-2 px-3 py-2 text-left font-medium">Employee</th>
                  {keys.map((k) => (
                    <th key={k} className={cn("min-w-7 px-0.5 py-1 text-center font-medium", weekdayOfKey(k) === 0 && "bg-surface-3", k === today && "text-accent")}>
                      <div>{Number(k.slice(8))}</div>
                      <div className="text-[9px] font-normal">{"SMTWTFS"[weekdayOfKey(k)]}</div>
                    </th>
                  ))}
                  {["P", "H", "A", "L", "Late", "OT"].map((h) => (
                    <th key={h} className="px-2 py-2 text-right font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map(({ s, cells, P, H, A, L, late, ot }) => (
                  <tr key={s.id} className="border-t border-border hover:bg-surface-2/60">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-1.5">
                      <Link href={`/staff/${s.id}?tab=attendance&month=${month}`} className="font-medium text-ink hover:text-accent">{s.fullName}</Link>
                      <div className="text-[10.5px] text-muted">{s.code}</div>
                    </td>
                    {cells.map((c) => (
                      <td key={c.k} className={cn("relative px-0.5 py-1.5 text-center font-semibold", CELL_TONE[c.letter] ?? "")}>
                        {c.letter}
                        {c.late && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-danger" />}
                      </td>
                    ))}
                    <td className="tabular px-2 text-right">{P}</td>
                    <td className="tabular px-2 text-right">{H}</td>
                    <td className="tabular px-2 text-right">{A}</td>
                    <td className="tabular px-2 text-right">{L}</td>
                    <td className="tabular px-2 text-right">{late}</td>
                    <td className="tabular whitespace-nowrap px-2 text-right">{ot ? minutesToHours(ot) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  }

  async function Holidays() {
    const year = Number(str("year")) || Number(today.slice(0, 4));
    const holidays = await db.holiday.findMany({
      where: { date: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) }, OR: [{ branchId: null }, { branchId: { in: scope.branches.map((b) => b.id) } }] },
      include: { branch: { select: { name: true } } },
      orderBy: { date: "asc" },
    });
    return (
      <Card>
        <CardHeader
          title={`Holidays ${year}`}
          description="Holidays are excluded from leave days and treated as paid (configurable in payroll rules)."
          actions={
            <div className="flex gap-1">
              <LinkButton href={`/attendance?tab=holidays&year=${year - 1}`} variant="ghost" size="sm">{year - 1}</LinkButton>
              <LinkButton href={`/attendance?tab=holidays&year=${year + 1}`} variant="ghost" size="sm">{year + 1}</LinkButton>
            </div>
          }
        />
        {manage && (
          <CardBody className="border-b border-border">
            <HolidayForm branches={scope.branches.map((b) => ({ id: b.id, name: b.name }))} allowAll={user.allBranches} />
          </CardBody>
        )}
        <Table>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Holiday</TH>
              <TH>Applies to</TH>
              {manage && <TH />}
            </tr>
          </THead>
          <tbody>
            {holidays.length === 0 && <TableEmpty colSpan={4}>No holidays added for {year}.</TableEmpty>}
            {holidays.map((h) => (
              <TR key={h.id}>
                <TD className="whitespace-nowrap">
                  {fmtWeekday(new Date(`${keyOfDbDate(h.date)}T06:00:00Z`))}, {fmtDate(new Date(`${keyOfDbDate(h.date)}T06:00:00Z`))}
                </TD>
                <TD className="font-medium">{h.name}</TD>
                <TD className="text-ink-2">{h.branch?.name ?? "All branches"}</TD>
                {manage && (
                  <TD className="text-right">
                    <ActionButton action={deleteHolidayAction} fields={{ id: h.id }} variant="ghost" confirm={`Remove ${h.name}?`}>
                      Remove
                    </ActionButton>
                  </TD>
                )}
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }
}
