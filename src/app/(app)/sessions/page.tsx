import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Syringe } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { staffOptions } from "@/lib/lookups";
import { remainingSessions } from "@/lib/packages";
import { addDaysKey, fmtDate, fmtTime, fromIst, istDayRange, istDateKey, relativeDays } from "@/lib/format";
import { LinkTabs, PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/form";
import { FilterBar, SegmentParam, SelectParam } from "@/components/ui/filters";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { approveManySessionsAction, approveSessionAction, quickSessionAction } from "./actions";

export const metadata = { title: "Treatment Sessions" };
const PAGE = 25;

export default async function SessionsPage({ searchParams }: PageProps<"/sessions">) {
  const user = await requirePermission(["packages.view", "sessions.update"]);
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const canApprove = can(user, "sessions.approve");
  const tabs = ["today", "upcoming", "missed", "completed", ...(canApprove ? ["approval"] : [])];
  const tab = tabs.includes(one("tab")) ? one("tab") : "today";
  const page = Math.max(1, Number(one("page")) || 1);
  const range = one("range") === "30" ? 30 : 7;

  const clinicianRole = user.staff && (user.roleKey === "DOCTOR" || user.roleKey === "THERAPIST") ? user.roleKey : null;
  const who = clinicianRole ? (one("who") === "all" ? "all" : "mine") : "all";
  let doctor = one("doctor");
  let therapist = one("therapist");
  if (who === "mine" && clinicianRole === "DOCTOR" && !doctor) doctor = user.staff!.id;
  if (who === "mine" && clinicianRole === "THERAPIST" && !therapist) therapist = user.staff!.id;
  const treatment = one("treatment");

  const today = istDateKey();
  const { start: dayStart, end: dayEnd } = istDayRange(today);
  const base: Prisma.TreatmentSessionWhereInput = {
    branchId: { in: scope.ids },
    patient: { deletedAt: null },
    ...(doctor ? { doctorId: doctor } : {}),
    ...(therapist ? { therapistId: therapist } : {}),
    ...(treatment ? { treatmentId: treatment } : {}),
  };
  const tabWhere: Record<string, Prisma.TreatmentSessionWhereInput> = {
    today: { status: { not: "RESCHEDULED" }, OR: [{ scheduledAt: { gte: dayStart, lt: dayEnd } }, { performedAt: { gte: dayStart, lt: dayEnd } }] },
    upcoming: { status: "SCHEDULED", scheduledAt: { gte: dayEnd, lt: fromIst(addDaysKey(today, range + 1)) } },
    missed: { OR: [{ status: "MISSED", scheduledAt: { gte: fromIst(addDaysKey(today, -90)) } }, { status: "SCHEDULED", scheduledAt: { lt: dayStart } }] },
    completed: { status: "COMPLETED" },
    approval: { status: "COMPLETED", approvedAt: null },
  };
  const where = { ...base, ...tabWhere[tab] };
  const orderBy: Prisma.TreatmentSessionOrderByWithRelationInput[] =
    tab === "completed" || tab === "approval" ? [{ performedAt: "desc" }] : tab === "missed" ? [{ scheduledAt: "desc" }] : [{ scheduledAt: "asc" }];

  const counts = await Promise.all(tabs.map((t) => db.treatmentSession.count({ where: { ...base, ...tabWhere[t] } })));
  const [rows, total, staff, treatments] = await Promise.all([
    db.treatmentSession.findMany({
      where,
      include: {
        patient: { select: { id: true, fullName: true, code: true } },
        treatment: { select: { name: true } },
        package: { select: { id: true, code: true, totalSessions: true, completedSessions: true, expiryDate: true } },
        doctor: { select: { fullName: true } },
        therapist: { select: { fullName: true } },
        branch: { select: { code: true } },
      },
      orderBy,
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.treatmentSession.count({ where }),
    staffOptions(scope.ids, ["DOCTOR", "THERAPIST"]),
    db.treatment.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const canUpdate = can(user, "sessions.update");
  const href = (o: Record<string, string | number | null>) => withParams("/sessions", sp as Record<string, string | string[] | undefined>, o);
  const label: Record<string, string> = { today: "Today", upcoming: "Upcoming", missed: "Missed / overdue", completed: "Completed", approval: "Needs approval" };
  const unapprovedIds = tab === "approval" ? rows.map((r) => r.id).join(",") : "";

  return (
    <>
      <PageHeader
        title="Treatment Sessions"
        description="Every package session — planned, done, missed or cancelled. Remaining sessions update automatically."
      />
      <LinkTabs
        active={tab}
        tabs={tabs.map((t, i) => ({ key: t, label: label[t], href: href({ tab: t === "today" ? null : t, page: null }), count: counts[i] }))}
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            {clinicianRole && (
              <SegmentParam name="who" defaultValue="mine" options={[["mine", clinicianRole === "DOCTOR" ? "My patients" : "Assigned to me"], ["all", "Everyone"]]} />
            )}
            {tab === "upcoming" && <SegmentParam name="range" defaultValue="7" options={[["7", "Next 7 days"], ["30", "Next 30 days"]]} />}
            <SelectParam name="therapist" placeholder="All therapists" options={staff.filter((s) => s.staffType === "THERAPIST").map((s) => [s.id, s.fullName] as const)} />
            <SelectParam name="doctor" placeholder="All doctors" options={staff.filter((s) => s.staffType === "DOCTOR").map((s) => [s.id, s.fullName] as const)} />
            <SelectParam name="treatment" placeholder="All treatments" options={treatments.map((t) => [t.id, t.name] as const)} />
          </FilterBar>
          {tab === "approval" && rows.length > 0 && (
            <ActionButton action={approveManySessionsAction} fields={{ ids: unapprovedIds }} variant="primary" confirm={`Approve all ${rows.length} session records shown?`}>
              Approve all shown
            </ActionButton>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<Syringe className="h-5 w-5" />} title={`No ${label[tab]!.toLowerCase()} sessions`} description="Try a different filter or tab." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>{tab === "completed" || tab === "approval" ? "Done on" : "Date"}</TH>
                <TH>Patient</TH>
                <TH className="hidden md:table-cell">Treatment / package</TH>
                <TH className="hidden lg:table-cell">Therapist / Doctor</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((s) => {
                const when = s.performedAt ?? s.scheduledAt;
                const overdue = s.status === "SCHEDULED" && s.scheduledAt && s.scheduledAt < dayStart;
                return (
                  <TR key={s.id}>
                    <TD className="whitespace-nowrap">
                      <span className="tabular block text-[13px] text-ink">{when ? fmtDate(when) : "—"}</span>
                      <span className="block text-xs text-muted">
                        {when ? fmtTime(when) : ""}
                        {overdue ? <span className="text-danger"> · overdue {relativeDays(s.scheduledAt)}</span> : ""}
                        {scope.isAll ? ` · ${s.branch.code}` : ""}
                      </span>
                    </TD>
                    <TD>
                      <Link href={`/patients/${s.patient.id}`} className="font-medium hover:text-accent">
                        {s.patient.fullName}
                      </Link>
                      <p className="text-xs text-muted md:hidden">{s.treatment.name}</p>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <span className="block text-ink-2">{s.treatment.name}</span>
                      {s.package ? (
                        <Link href={`/treatments/packages/${s.package.id}`} className="text-xs text-muted hover:text-accent">
                          {s.package.code} · {s.sessionNumber ? `session ${s.sessionNumber} · ` : ""}
                          {remainingSessions(s.package)} of {s.package.totalSessions} left
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">One-off treatment</span>
                      )}
                    </TD>
                    <TD className="hidden text-ink-2 lg:table-cell">{[s.therapist?.fullName, s.doctor?.fullName].filter(Boolean).join(" · ") || "—"}</TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge kind="session" status={s.status} />
                        {s.status === "COMPLETED" && (s.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Not approved</Badge>)}
                      </div>
                    </TD>
                    <TD className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {s.status === "SCHEDULED" && canUpdate && (
                          <>
                            <ActionButton action={quickSessionAction} fields={{ sessionId: s.id, to: "COMPLETED" }} variant="primary" confirm={`Mark ${s.patient.fullName}'s ${s.treatment.name} session as done?`}>
                              Done
                            </ActionButton>
                            <ActionButton action={quickSessionAction} fields={{ sessionId: s.id, to: "MISSED" }} variant="ghost" confirm="Mark this session as missed? It won't use up a package session.">
                              Missed
                            </ActionButton>
                          </>
                        )}
                        {s.status === "COMPLETED" && !s.approvedAt && canApprove && (
                          <ActionButton action={approveSessionAction} fields={{ sessionId: s.id }}>
                            Approve
                          </ActionButton>
                        )}
                        {s.package && (
                          <Link href={`/treatments/packages/${s.package.id}`} className="inline-flex h-8 items-center px-2 text-[13px] text-muted hover:text-ink">
                            Open
                          </Link>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => href({ page: p })} />
      </Card>
    </>
  );
}
