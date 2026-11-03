import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { KeyRound, Mail, Pencil, Phone, QrCode, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { leaveBalances, staffMonth, LEAVE_TYPES, keyOfDbDate } from "@/lib/attendance";
import { fmtDate, fmtNum, fmtMonth, humanize, initials, istDateKey, istMonthRange, money, toNum } from "@/lib/format";
import { LinkTabs, PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, DetailList, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { MonthCalendar, MonthNav, SummaryStrip } from "../../attendance/_components/month-calendar";
import { STAFF_TYPE_OPTIONS, WEEKDAY_LONG as WEEKDAYS } from "../constants";
import { PinForm } from "./security-forms";
import { archiveStaffAction, regenerateQrAction } from "../actions";

const mask = (v: string | null | undefined) => (v ? `•••• ${v.slice(-4)}` : "—");

export default async function StaffProfilePage({ params, searchParams }: PageProps<"/staff/[id]">) {
  const user = await requirePermission("staff.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "details";
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : istDateKey().slice(0, 7);
  const scope = await getBranchScope();

  const s = await db.staff.findFirst({
    where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    include: { branch: true, user: { select: { email: true, isActive: true, lastLoginAt: true, role: { select: { name: true } } } } },
  });
  if (!s) notFound();

  const manage = can(user, "staff.manage");
  const seeMoney = manage || can(user, "payroll.view");
  const base = `/staff/${s.id}`;
  const clinical = s.staffType === "DOCTOR" || s.staffType === "THERAPIST";
  const typeLabel = STAFF_TYPE_OPTIONS.find((o) => o[0] === s.staffType)?.[1];

  const tabs = [
    { key: "details", label: "Details", href: base },
    { key: "attendance", label: "Attendance", href: `${base}?tab=attendance` },
    { key: "leave", label: "Leave", href: `${base}?tab=leave` },
    ...(can(user, "payroll.view") ? [{ key: "payroll", label: "Payroll", href: `${base}?tab=payroll` }] : []),
    ...(clinical ? [{ key: "performance", label: "Performance", href: `${base}?tab=performance` }] : []),
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/staff", label: "Staff" }}
        title={
          <span className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{initials(s.fullName)}</span>
            <span>{s.fullName}</span>
          </span>
        }
        meta={
          <>
            <Badge tone="neutral">{s.code}</Badge>
            <StatusBadge kind="employment" status={s.status} />
            <span className="text-[13px] text-muted">
              {s.designation} · {typeLabel} · {s.branch.name}
            </span>
          </>
        }
        actions={
          manage && (
            <>
              <LinkButton href={`${base}/edit`} variant="outline">
                <Pencil className="h-4 w-4" /> Edit
              </LinkButton>
              <ActionButton action={archiveStaffAction} fields={{ id: s.id }} variant="ghost" size="md" confirm={`Archive ${s.fullName}? They will disappear from staff lists (restorable from the recycle bin).`}>
                Archive
              </ActionButton>
            </>
          )
        }
      />
      <LinkTabs tabs={tabs} active={tab} />

      {tab === "details" && <Details />}
      {tab === "attendance" && <AttendanceTab />}
      {tab === "leave" && <LeaveTab />}
      {tab === "payroll" && can(user, "payroll.view") && <PayrollTab />}
      {tab === "performance" && clinical && <PerformanceTab />}
    </>
  );

  async function Details() {
    const qr = s!.qrToken ? await QRCode.toDataURL(`SHRINA-ATT:${s!.qrToken}`, { margin: 1, width: 180 }) : null;
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Employee details" />
            <CardBody>
              <DetailList
                items={[
                  ["Employee ID", s!.code],
                  ["Mobile", <a key="m" href={`tel:${s!.mobile}`} className="inline-flex items-center gap-1 hover:text-accent"><Phone className="h-3.5 w-3.5" /> {s!.mobile}</a>],
                  ["Email", s!.email ? <a key="e" href={`mailto:${s!.email}`} className="inline-flex items-center gap-1 hover:text-accent"><Mail className="h-3.5 w-3.5" /> {s!.email}</a> : "—"],
                  ["Department", s!.department],
                  ["Designation", s!.designation],
                  ["Role type", typeLabel],
                  ["Branch", s!.branch.name],
                  ["Joining date", fmtDate(s!.joiningDate)],
                  ["Working hours", `${s!.shiftStart} – ${s!.shiftEnd}`],
                  ["Weekly off", s!.weeklyOff.length ? s!.weeklyOff.map((d) => WEEKDAYS[d]).join(", ") : "None"],
                  ["Emergency contact", s!.emergencyName ? `${s!.emergencyName} · ${s!.emergencyPhone ?? ""}` : "—"],
                  ["Employment status", humanize(s!.status)],
                ]}
              />
            </CardBody>
          </Card>
          {seeMoney && (
            <Card>
              <CardHeader title="Salary & bank" description="Visible to HR, payroll and the owner only." />
              <CardBody>
                <DetailList
                  items={[
                    ["Salary", `${money(s!.monthlySalary, { decimals: false })}${s!.salaryType === "MONTHLY" ? " / month" : s!.salaryType === "DAILY" ? " / day" : " / hour"}`],
                    ["Salary type", humanize(s!.salaryType)],
                    ["Bank", s!.bankName ?? "—"],
                    ["Account number", manage || can(user, "payroll.manage") ? (s!.bankAccount ?? "—") : mask(s!.bankAccount)],
                    ["IFSC", s!.ifsc ?? "—"],
                    ["UPI ID", s!.upiId ?? "—"],
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="App login" />
            <CardBody className="text-sm">
              {s!.user ? (
                <div className="flex items-start gap-3">
                  <UserRound className="mt-0.5 h-4 w-4 text-muted" />
                  <div>
                    <p className="font-medium">Has login: {s!.user.email}</p>
                    <p className="text-xs text-muted">
                      {s!.user.role.name} · {s!.user.isActive ? "Active" : "Disabled"} · last sign-in {s!.user.lastLoginAt ? fmtDate(s!.user.lastLoginAt) : "never"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-muted">No login. {can(user, "users.manage") ? <Link href="/settings/users" className="text-accent hover:underline">Create one in Settings → Users</Link> : "The owner can create one in Settings → Users."}</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Attendance kiosk" description="PIN and printable QR badge" />
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm">
                  <KeyRound className="h-4 w-4 text-muted" /> PIN {s!.attendancePinHash ? <Badge tone="success">Set</Badge> : <Badge tone="warning">Not set</Badge>}
                </span>
                {(manage || can(user, "attendance.manage")) && (
                  <Dialog title={`Attendance PIN — ${s!.fullName}`} size="sm" trigger={<Button variant="outline" size="sm">{s!.attendancePinHash ? "Reset PIN" : "Set PIN"}</Button>}>
                    <PinForm id={s!.id} />
                  </Dialog>
                )}
              </div>
              {qr && (
                <div className="flex items-center gap-4 rounded-lg border border-border p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="Attendance QR badge" className="h-24 w-24 rounded bg-white p-1" />
                  <div className="min-w-0 text-xs text-muted">
                    <p className="flex items-center gap-1 font-medium text-ink-2"><QrCode className="h-3.5 w-3.5" /> ID badge</p>
                    <p className="mt-1">Scan at the kiosk (“Scan ID badge”) to check in or out. Print and keep with the employee ID card.</p>
                    {(manage || can(user, "attendance.manage")) && (
                      <div className="mt-2">
                        <ActionButton action={regenerateQrAction} fields={{ id: s!.id }} variant="ghost" confirm="Generate a new badge? The old printed badge will stop working.">
                          Regenerate badge
                        </ActionButton>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  async function AttendanceTab() {
    const m = await staffMonth(s!, month);
    return (
      <Card>
        <CardHeader
          title="Monthly attendance"
          description={`${s!.shiftStart} – ${s!.shiftEnd} shift`}
          actions={<MonthNav month={month} hrefFor={(mm) => `${base}?tab=attendance&month=${mm}`} />}
        />
        <CardBody className="space-y-4">
          <SummaryStrip summary={m.summary} />
          <MonthCalendar days={m.days} />
          {can(user, "attendance.view") && (
            <p className="text-right text-[13px]">
              <Link href={`/attendance?tab=register&month=${month}`} className="text-accent hover:underline">Open monthly register →</Link>
            </p>
          )}
        </CardBody>
      </Card>
    );
  }

  async function LeaveTab() {
    const year = Number(istDateKey().slice(0, 4));
    const [balances, requests] = await Promise.all([
      leaveBalances(s!.id, year),
      db.leaveRequest.findMany({ where: { staffId: s!.id }, orderBy: { fromDate: "desc" }, take: 30 }),
    ]);
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {balances.map((b) => (
            <StatCard key={b.type} label={LEAVE_TYPES.find((t) => t[0] === b.type)![1]} value={b.remaining === null ? fmtNum(b.used) : `${fmtNum(b.remaining)} left`} hint={b.entitled === null ? `taken in ${year}` : `${fmtNum(b.used)} used of ${b.entitled} (${year})`} />
          ))}
        </div>
        <Card>
          <CardHeader title="Leave requests" actions={<LinkButton href="/leaves" variant="ghost" size="sm">Leave management →</LinkButton>} />
          <Table>
            <THead>
              <tr>
                <TH>Dates</TH>
                <TH>Type</TH>
                <TH className="text-right">Days</TH>
                <TH className="hidden md:table-cell">Reason</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {requests.length === 0 && <TableEmpty colSpan={5}>No leave requests.</TableEmpty>}
              {requests.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">
                    {fmtDate(keyOfDbDate(r.fromDate))}
                    {keyOfDbDate(r.toDate) !== keyOfDbDate(r.fromDate) && ` – ${fmtDate(keyOfDbDate(r.toDate))}`}
                  </TD>
                  <TD>{LEAVE_TYPES.find((t) => t[0] === r.type)![1]}{r.dayType === "HALF" && <span className="text-xs text-muted"> (half day)</span>}</TD>
                  <TD className="tabular text-right">{fmtNum(r.days)}</TD>
                  <TD className="hidden max-w-xs truncate text-ink-2 md:table-cell">{r.reason ?? "—"}</TD>
                  <TD><StatusBadge kind="leave" status={r.status} /></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function PayrollTab() {
    const rows = await db.payroll.findMany({ where: { staffId: s!.id }, orderBy: { month: "desc" }, take: 24 });
    const adj = await db.payrollAdjustment.findMany({ where: { staffId: s!.id }, orderBy: { createdAt: "desc" }, take: 20 });
    return (
      <div className="space-y-5">
        <Card>
          <CardHeader title="Payroll history" actions={<LinkButton href="/payroll" variant="ghost" size="sm">Payroll →</LinkButton>} />
          <Table>
            <THead>
              <tr>
                <TH>Month</TH>
                <TH className="hidden sm:table-cell text-right">Paid days</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Net pay</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 && <TableEmpty colSpan={6}>No payroll runs yet.</TableEmpty>}
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD>{fmtMonth(new Date(`${p.month}-15T00:00:00Z`))}</TD>
                  <TD className="tabular hidden text-right sm:table-cell">{fmtNum(toNum(p.presentDays) + toNum(p.paidLeaveDays))}</TD>
                  <TD className="tabular text-right">{money(p.grossPay)}</TD>
                  <TD className="tabular text-right font-medium">{money(p.netPay)}</TD>
                  <TD><StatusBadge kind="payroll" status={p.status} /></TD>
                  <TD className="text-right"><Link href={`/payroll/${p.id}`} className="text-[13px] text-accent hover:underline">Slip</Link></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Advances, incentives & deductions" />
          <Table>
            <THead>
              <tr>
                <TH>Month</TH>
                <TH>Type</TH>
                <TH className="hidden sm:table-cell">Note</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <tbody>
              {adj.length === 0 && <TableEmpty colSpan={4}>None recorded.</TableEmpty>}
              {adj.map((a) => (
                <TR key={a.id}>
                  <TD>{a.month}</TD>
                  <TD><Badge tone={a.type === "INCENTIVE" || a.type === "BONUS" ? "success" : "warning"}>{humanize(a.type)}</Badge></TD>
                  <TD className="hidden text-ink-2 sm:table-cell">{a.note ?? "—"}</TD>
                  <TD className="tabular text-right">{money(a.amount)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function PerformanceTab() {
    const { start, end } = istMonthRange(month);
    const who = s!.staffType === "DOCTOR" ? { doctorId: s!.id } : { therapistId: s!.id };
    const months = Array.from({ length: 6 }, (_, i) => {
      const [y, mm] = month.split("-").map(Number) as [number, number];
      return new Date(Date.UTC(y, mm - 1 - i, 1)).toISOString().slice(0, 7);
    });
    const [sessions, consults, appts, noShows, history] = await Promise.all([
      db.treatmentSession.count({ where: { ...who, status: "COMPLETED", performedAt: { gte: start, lt: end } } }),
      s!.staffType === "DOCTOR" ? db.consultation.count({ where: { doctorId: s!.id, deletedAt: null, consultationDate: { gte: start, lt: end } } }) : Promise.resolve(0),
      db.appointment.count({ where: { ...who, deletedAt: null, status: "COMPLETED", startAt: { gte: start, lt: end } } }),
      db.appointment.count({ where: { ...who, deletedAt: null, status: "NO_SHOW", startAt: { gte: start, lt: end } } }),
      Promise.all(
        months.map(async (mm) => {
          const r = istMonthRange(mm);
          const [ss, cc, pts] = await Promise.all([
            db.treatmentSession.count({ where: { ...who, status: "COMPLETED", performedAt: { gte: r.start, lt: r.end } } }),
            s!.staffType === "DOCTOR" ? db.consultation.count({ where: { doctorId: s!.id, deletedAt: null, consultationDate: { gte: r.start, lt: r.end } } }) : Promise.resolve(0),
            db.treatmentSession.findMany({ where: { ...who, status: "COMPLETED", performedAt: { gte: r.start, lt: r.end } }, distinct: ["patientId"], select: { patientId: true } }),
          ]);
          return { month: mm, sessions: ss, consults: cc, patients: pts.length };
        }),
      ),
    ]);
    return (
      <div className="space-y-5">
        <div className="flex justify-end">
          <MonthNav month={month} hrefFor={(mm) => `${base}?tab=performance&month=${mm}`} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Sessions completed" value={sessions} hint={fmtMonth(start)} />
          {s!.staffType === "DOCTOR" && <StatCard label="Consultations" value={consults} />}
          <StatCard label="Appointments completed" value={appts} />
          <StatCard label="No-shows" value={noShows} tone="danger" />
        </div>
        <Card>
          <CardHeader title="Last 6 months" />
          {history.every((h) => !h.sessions && !h.consults) ? (
            <EmptyState title="No treatment activity recorded" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Month</TH>
                  <TH className="text-right">Sessions</TH>
                  {s!.staffType === "DOCTOR" && <TH className="text-right">Consultations</TH>}
                  <TH className="text-right">Unique patients</TH>
                </tr>
              </THead>
              <tbody>
                {history.map((h) => (
                  <TR key={h.month}>
                    <TD>{fmtMonth(new Date(`${h.month}-15T00:00:00Z`))}</TD>
                    <TD className="tabular text-right">{h.sessions}</TD>
                    {s!.staffType === "DOCTOR" && <TD className="tabular text-right">{h.consults}</TD>}
                    <TD className="tabular text-right">{h.patients}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }
}
