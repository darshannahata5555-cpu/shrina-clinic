import Link from "next/link";
import { CalendarOff, CalendarPlus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requireUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { LEAVE_TYPES, entitlements, keyOfDbDate, leaveBalances } from "@/lib/attendance";
import { getSetting } from "@/lib/settings";
import { dbDate, fmtDate, fmtDateTime, fmtNum, istDateKey } from "@/lib/format";
import { LinkTabs, PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionButton } from "@/components/ui/form";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { LeaveRequestForm, ReviewLeaveForm } from "./leave-forms";
import { cancelLeaveAction } from "./actions";

export const metadata = { title: "Leave Management" };
const PAGE_SIZE = 25;
const typeLabel = (t: string) => LEAVE_TYPES.find((x) => x[0] === t)?.[1] ?? t;
const range = (from: Date, to: Date) => {
  const a = keyOfDbDate(from);
  const b = keyOfDbDate(to);
  const f = (k: string) => fmtDate(new Date(`${k}T06:00:00Z`));
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};

export default async function LeavesPage({ searchParams }: PageProps<"/leaves">) {
  const user = await requireUser();
  const scope = await getBranchScope();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const approver = can(user, "leaves.approve");
  const today = istDateKey();
  const year = Number(str("year")) || Number(today.slice(0, 4));
  const tab = str("tab") || (approver ? "requests" : "mine");

  const team = approver
    ? await db.staff.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_NOTICE"] }, branchId: { in: scope.ids } }, select: { id: true, fullName: true, code: true, branchId: true, branch: { select: { code: true } } }, orderBy: { fullName: "asc" } })
    : [];
  const myBalances = user.staff ? await leaveBalances(user.staff.id, year) : null;
  const pendingCount = approver ? await db.leaveRequest.count({ where: { status: "PENDING", staff: { branchId: { in: scope.ids }, deletedAt: null } } }) : 0;

  const tabs = [
    ...(approver ? [{ key: "requests", label: "Requests", href: "/leaves", count: pendingCount }] : []),
    ...(approver ? [{ key: "balances", label: "Balances", href: "/leaves?tab=balances" }] : []),
    ...(user.staff ? [{ key: "mine", label: "My leave", href: "/leaves?tab=mine" }] : []),
  ];

  const canRequest = !!user.staff || approver;

  return (
    <>
      <PageHeader
        title="Leave Management"
        description={approver ? "Review leave requests, track balances and keep attendance in sync." : "Request leave and track your balance."}
        actions={
          canRequest && (
            <Dialog title="Request leave" trigger={<Button><CalendarPlus className="h-4 w-4" /> Request leave</Button>}>
              <LeaveRequestForm
                today={today}
                selfId={user.staff?.id}
                balances={myBalances?.map((b) => ({ type: b.type, remaining: b.remaining })) ?? undefined}
                staff={approver ? team.map((t) => ({ id: t.id, label: `${t.fullName} (${t.code})${scope.isAll ? ` · ${t.branch.code}` : ""}` })) : undefined}
              />
            </Dialog>
          )
        }
      />
      {tabs.length > 1 && <LinkTabs tabs={tabs} active={tab} />}

      {!user.staff && !approver ? (
        <Card>
          <EmptyState icon={<CalendarOff className="h-5 w-5" />} title="Your login isn't linked to an employee profile" description="Leave is requested against an employee profile. Ask HR to link your account." />
        </Card>
      ) : tab === "requests" && approver ? (
        <Requests />
      ) : tab === "balances" && approver ? (
        <Balances />
      ) : user.staff ? (
        <Mine />
      ) : null}
    </>
  );

  async function Mine() {
    const rows = await db.leaveRequest.findMany({ where: { staffId: user.staff!.id }, orderBy: { fromDate: "desc" }, take: 50 });
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {myBalances!.map((b) => (
            <StatCard key={b.type} label={typeLabel(b.type)} value={b.remaining === null ? `${fmtNum(b.used)} taken` : `${fmtNum(b.remaining)} left`} hint={b.entitled === null ? `in ${year} — deducted from salary` : `${fmtNum(b.used)} used of ${b.entitled} in ${year}`} tone={b.type === "UNPAID" ? "neutral" : "violet"} />
          ))}
        </div>
        <Card>
          <CardHeader title="My requests" />
          <Table>
            <THead>
              <tr>
                <TH>Dates</TH>
                <TH>Type</TH>
                <TH className="text-right">Days</TH>
                <TH className="hidden md:table-cell">Reason</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 && <TableEmpty colSpan={6}>You haven&apos;t requested any leave yet.</TableEmpty>}
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{range(r.fromDate, r.toDate)}</TD>
                  <TD>
                    {typeLabel(r.type)}
                    {r.dayType === "HALF" && <span className="text-xs text-muted"> · half day</span>}
                  </TD>
                  <TD className="tabular text-right">{fmtNum(r.days)}</TD>
                  <TD className="hidden max-w-xs text-ink-2 md:table-cell">
                    <p className="truncate">{r.reason}</p>
                    {r.reviewNote && <p className="truncate text-xs text-muted">Reply: {r.reviewNote}</p>}
                  </TD>
                  <TD>
                    <StatusBadge kind="leave" status={r.status} />
                  </TD>
                  <TD className="text-right">
                    {r.status === "PENDING" && (
                      <ActionButton action={cancelLeaveAction} fields={{ id: r.id }} variant="ghost" confirm="Cancel this leave request?">
                        Cancel
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    );
  }

  async function Requests() {
    const status = str("status") || "PENDING";
    const page = Math.max(1, Number(str("page")) || 1);
    const where: Prisma.LeaveRequestWhereInput = {
      staff: {
        deletedAt: null,
        branchId: { in: str("branch") && scope.ids.includes(str("branch")) ? [str("branch")] : scope.ids },
        ...(str("q") ? { OR: [{ fullName: { contains: str("q"), mode: "insensitive" } }, { code: { contains: str("q"), mode: "insensitive" } }] } : {}),
      },
      ...(status !== "all" ? { status: status as never } : {}),
      ...(str("type") ? { type: str("type") as never } : {}),
    };
    const [rows, total, onLeaveToday] = await Promise.all([
      db.leaveRequest.findMany({
        where,
        include: { staff: { select: { id: true, fullName: true, code: true, designation: true, branch: { select: { code: true } } } } },
        orderBy: status === "PENDING" ? { fromDate: "asc" } : { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.leaveRequest.count({ where }),
      db.leaveRequest.count({ where: { status: "APPROVED", fromDate: { lte: dbDate(today) }, toDate: { gte: dbDate(today) }, staff: { branchId: { in: scope.ids } } } }),
    ]);
    const reviewers = await db.user.findMany({ where: { id: { in: rows.map((r) => r.reviewedById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const reviewer = new Map(reviewers.map((u) => [u.id, u.name]));
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Awaiting decision" value={pendingCount} tone="warning" href="/leaves" />
          <StatCard label="On leave today" value={onLeaveToday} tone="violet" href="/attendance?status=LEAVE" />
          <StatCard label="Leave year" value={year} hint="Balances reset every January" />
        </div>
        <Card>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <FilterBar>
              <SearchParamInput placeholder="Employee name or ID" />
              <SelectParam
                name="status"
                placeholder="Pending"
                options={[
                  ["all", "All statuses"],
                  ["APPROVED", "Approved"],
                  ["REJECTED", "Rejected"],
                  ["CANCELLED", "Cancelled"],
                ]}
              />
              <SelectParam name="type" options={LEAVE_TYPES} placeholder="All types" />
              {scope.branches.length > 1 && scope.isAll && <SelectParam name="branch" options={scope.branches.map((b) => [b.id, b.name] as const)} placeholder="All branches" />}
            </FilterBar>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH>Dates</TH>
                <TH className="hidden md:table-cell">Type</TH>
                <TH className="text-right">Days</TH>
                <TH className="hidden lg:table-cell">Reason</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 && <TableEmpty colSpan={7}>{status === "PENDING" ? "No pending requests — all caught up." : "No requests match."}</TableEmpty>}
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/staff/${r.staff.id}?tab=leave`} className="font-medium hover:text-accent">
                      {r.staff.fullName}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.staff.code} · {r.staff.designation}
                      {scope.isAll && ` · ${r.staff.branch.code}`}
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {range(r.fromDate, r.toDate)}
                    <p className="text-xs text-muted">Requested {fmtDateTime(r.createdAt)}</p>
                  </TD>
                  <TD className="hidden md:table-cell">
                    {typeLabel(r.type)}
                    {r.dayType === "HALF" && <span className="text-xs text-muted"> · half day</span>}
                  </TD>
                  <TD className="tabular text-right">{fmtNum(r.days)}</TD>
                  <TD className="hidden max-w-xs text-ink-2 lg:table-cell">
                    <p className="truncate">{r.reason ?? "—"}</p>
                    {r.reviewNote && <p className="truncate text-xs text-muted">Note: {r.reviewNote}</p>}
                  </TD>
                  <TD>
                    <StatusBadge kind="leave" status={r.status} />
                    {r.reviewedById && r.status !== "PENDING" && <p className="mt-0.5 text-[11px] text-muted">by {reviewer.get(r.reviewedById) ?? "—"}</p>}
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    {r.status === "PENDING" && r.staff.id !== user.staff?.id && (
                      <Dialog title={`Review leave — ${r.staff.fullName}`} description={`${typeLabel(r.type)} · ${range(r.fromDate, r.toDate)} · ${fmtNum(r.days)} day(s)`} size="sm" trigger={<Button size="sm">Review</Button>}>
                        <ReviewLeaveForm id={r.id} />
                      </Dialog>
                    )}
                    {r.status === "PENDING" && r.staff.id === user.staff?.id && <Badge tone="neutral">Your request</Badge>}
                    {r.status === "APPROVED" && keyOfDbDate(r.toDate) >= today && (
                      <ActionButton action={cancelLeaveAction} fields={{ id: r.id }} variant="ghost" confirm="Cancel this approved leave? Leave marks in attendance will be removed.">
                        Cancel
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/leaves", sp as Record<string, string>, { page: p })} />
        </Card>
      </div>
    );
  }

  async function Balances() {
    const ent = entitlements(await getSetting("payroll"));
    const used = await db.leaveRequest.groupBy({
      by: ["staffId", "type"],
      where: { status: "APPROVED", staffId: { in: team.map((t) => t.id) }, fromDate: { gte: dbDate(`${year}-01-01`), lte: dbDate(`${year}-12-31`) } },
      _sum: { days: true },
    });
    const u = (id: string, t: string) => Number(used.find((x) => x.staffId === id && x.type === t)?._sum.days ?? 0);
    return (
      <Card>
        <CardHeader
          title={`Leave balances ${year}`}
          description={`Entitlement per year: casual ${ent.CASUAL}, sick ${ent.SICK}, paid ${ent.PAID} (change in Payroll → Rules)`}
          actions={
            <div className="flex gap-1">
              <Link href={`/leaves?tab=balances&year=${year - 1}`} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-3">{year - 1}</Link>
              <Link href={`/leaves?tab=balances&year=${year + 1}`} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-3">{year + 1}</Link>
            </div>
          }
        />
        <Table>
          <THead>
            <tr>
              <TH>Employee</TH>
              {(["CASUAL", "SICK", "PAID"] as const).map((t) => (
                <TH key={t} className="text-right">{typeLabel(t).replace(" / earned", "")} left</TH>
              ))}
              <TH className="text-right">Unpaid taken</TH>
            </tr>
          </THead>
          <tbody>
            {team.length === 0 && <TableEmpty colSpan={5}>No employees.</TableEmpty>}
            {team.map((t) => (
              <TR key={t.id}>
                <TD>
                  <Link href={`/staff/${t.id}?tab=leave`} className="font-medium hover:text-accent">{t.fullName}</Link>
                  <p className="text-xs text-muted">{t.code}{scope.isAll && ` · ${t.branch.code}`}</p>
                </TD>
                {(["CASUAL", "SICK", "PAID"] as const).map((type) => {
                  const left = Math.max(0, ent[type] - u(t.id, type));
                  return (
                    <TD key={type} className="tabular text-right">
                      <span className={left === 0 ? "text-danger" : ""}>{fmtNum(left)}</span>
                      <span className="text-muted"> / {ent[type]}</span>
                    </TD>
                  );
                })}
                <TD className="tabular text-right text-ink-2">{fmtNum(u(t.id, "UNPAID"))}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    );
  }
}
