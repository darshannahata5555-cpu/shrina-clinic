import Link from "next/link";
import { CalendarOff, Clock, QrCode } from "lucide-react";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { staffMonth } from "@/lib/attendance";
import { dbDate, fmtDate, fmtTime, fmtWeekday, istDateKey, minutesToHours } from "@/lib/format";
import { PageHeader } from "@/components/ui/page";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { MonthCalendar, MonthNav, SummaryStrip } from "../_components/month-calendar";
import { PunchButtons, QrConfirm } from "./punch-buttons";

export const metadata = { title: "My attendance" };

export default async function MyAttendancePage({ searchParams }: PageProps<"/attendance/me">) {
  const user = await requireUser();
  const sp = await searchParams;
  const token = typeof sp.k === "string" ? sp.k : null;
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : istDateKey().slice(0, 7);

  if (!user.staff) {
    return (
      <>
        <PageHeader title="My attendance" />
        <Card>
          <EmptyState
            icon={<Clock className="h-5 w-5" />}
            title="Your login isn't linked to an employee profile"
            description="Attendance is recorded against employee profiles. Ask HR or the owner to link your account in Settings → Users."
            action={can(user, "attendance.view") ? <LinkButton href="/attendance" variant="outline">Open attendance board</LinkButton> : undefined}
          />
        </Card>
      </>
    );
  }

  const today = istDateKey();
  const [staff, settings, row] = await Promise.all([
    db.staff.findUniqueOrThrow({ where: { id: user.staff.id }, include: { branch: { select: { name: true } } } }),
    getSetting("attendance"),
    db.attendance.findUnique({ where: { staffId_date: { staffId: user.staff.id, date: dbDate(today) } } }),
  ]);
  const m = await staffMonth(staff, month);
  const isOff = staff.weeklyOff.includes(new Date(`${today}T00:00:00Z`).getUTCDay());

  return (
    <>
      <PageHeader
        title="My attendance"
        description={`${staff.fullName} · ${staff.code} · shift ${staff.shiftStart}–${staff.shiftEnd}`}
        actions={
          <>
            <LinkButton href="/leaves" variant="outline">
              <CalendarOff className="h-4 w-4" /> Request leave
            </LinkButton>
            {can(user, "attendance.view") && <LinkButton href="/attendance" variant="outline">Attendance board</LinkButton>}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Today" description={`${fmtWeekday(new Date())}, ${fmtDate(new Date())} · ${staff.branch.name}`} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-2 py-2.5">
                <p className="tabular text-base font-semibold">{row?.checkIn ? fmtTime(row.checkIn) : "—"}</p>
                <p className="text-[11px] text-muted">Checked in</p>
              </div>
              <div className="rounded-lg bg-surface-2 py-2.5">
                <p className="tabular text-base font-semibold">{row?.checkOut ? fmtTime(row.checkOut) : "—"}</p>
                <p className="text-[11px] text-muted">Checked out</p>
              </div>
              <div className="rounded-lg bg-surface-2 py-2.5">
                <p className="tabular text-base font-semibold">{row?.workMinutes ? minutesToHours(row.workMinutes) : "—"}</p>
                <p className="text-[11px] text-muted">Worked</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {row ? <StatusBadge kind="attendance" status={row.status} /> : isOff ? <StatusBadge kind="attendance" status="WEEK_OFF" /> : <Badge>Not checked in</Badge>}
              {row && row.lateMinutes > (await getSetting("payroll")).lateGraceMinutes ? <Badge tone="warning">{row.lateMinutes} min late</Badge> : null}
              {row?.overtimeMinutes ? <Badge tone="info">{minutesToHours(row.overtimeMinutes)} overtime</Badge> : null}
            </div>
            {token ? (
              settings.qrEnabled ? (
                <div className="rounded-lg border border-accent/30 bg-accent-soft p-3">
                  <p className="mb-3 flex items-center gap-2 text-sm font-medium text-accent">
                    <QrCode className="h-4 w-4" /> Kiosk QR scanned
                  </p>
                  <QrConfirm token={token} />
                </div>
              ) : (
                <p className="text-sm text-muted">QR attendance is turned off.</p>
              )
            ) : settings.mobileEnabled ? (
              <PunchButtons checkedIn={!!row?.checkIn} checkedOut={!!row?.checkOut} gpsRequired={settings.gpsRequired} />
            ) : (
              <p className="text-sm text-muted">Mobile check-in is turned off — please use the attendance kiosk at reception.</p>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="This month" actions={<MonthNav month={month} hrefFor={(mm) => `/attendance/me?month=${mm}`} />} />
          <CardBody className="space-y-4">
            <SummaryStrip summary={m.summary} />
            <MonthCalendar days={m.days} />
            <p className="text-xs text-muted">
              Something wrong? Ask your manager to correct it — corrections are logged. See <Link href="/leaves" className="text-accent hover:underline">your leave balance</Link>.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
