import Link from "next/link";
import { Plus, UserCog } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { dbDate, fmtDate, istDateKey, money, initials } from "@/lib/format";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { STAFF_TYPE_OPTIONS } from "./constants";

export const metadata = { title: "Staff Management" };
const PAGE_SIZE = 25;

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const user = await requirePermission("staff.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = str("q").trim();
  const page = Math.max(1, Number(str("page")) || 1);
  const status = str("status") || "current";

  const where: Prisma.StaffWhereInput = {
    deletedAt: null,
    branchId: { in: str("branch") && scope.ids.includes(str("branch")) ? [str("branch")] : scope.ids },
    ...(str("type") ? { staffType: str("type") as never } : {}),
    ...(str("dept") ? { department: str("dept") } : {}),
    ...(status === "current" ? { status: { in: ["ACTIVE", "ON_NOTICE"] } } : status !== "all" ? { status: status as never } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { mobile: { contains: q.replace(/\D/g, "") || q } },
            { designation: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const todayKey = istDateKey();
  const [rows, total, departments, counts, todayAtt] = await Promise.all([
    db.staff.findMany({
      where,
      include: { branch: { select: { name: true, code: true } }, user: { select: { email: true, isActive: true } } },
      orderBy: [{ status: "asc" }, { fullName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.staff.count({ where }),
    db.staff.findMany({ where: { deletedAt: null, branchId: { in: scope.ids } }, distinct: ["department"], select: { department: true }, orderBy: { department: "asc" } }),
    db.staff.groupBy({ by: ["staffType"], where: { deletedAt: null, branchId: { in: scope.ids }, status: { in: ["ACTIVE", "ON_NOTICE"] } }, _count: true }),
    db.attendance.findMany({ where: { branchId: { in: scope.ids }, date: dbDate(todayKey) }, select: { staffId: true, status: true, checkIn: true, checkOut: true } }),
  ]);
  const att = new Map(todayAtt.map((a) => [a.staffId, a]));
  const n = (t: string) => counts.find((c) => c.staffType === t)?._count ?? 0;
  const activeTotal = counts.reduce((s, c) => s + c._count, 0);
  const showSalary = can(user, "payroll.view") || can(user, "staff.manage");

  return (
    <>
      <PageHeader
        title="Staff Management"
        description="Employee records, roles, shifts and salary details."
        actions={
          <>
            <LinkButton href="/attendance" variant="outline">Attendance</LinkButton>
            {can(user, "staff.manage") && (
              <LinkButton href="/staff/new">
                <Plus className="h-4 w-4" /> Add employee
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Active employees" value={activeTotal} hint={scope.current?.name ?? "All branches"} />
        <StatCard label="Doctors" value={n("DOCTOR")} />
        <StatCard label="Therapists" value={n("THERAPIST")} />
        <StatCard label="Front desk & admin" value={activeTotal - n("DOCTOR") - n("THERAPIST")} />
      </div>
      <Card>
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Name, employee ID, mobile…" />
            <SelectParam name="type" options={STAFF_TYPE_OPTIONS} placeholder="All roles" />
            <SelectParam name="dept" options={departments.map((d) => [d.department, d.department] as const)} placeholder="All departments" />
            {scope.branches.length > 1 && scope.isAll && <SelectParam name="branch" options={scope.branches.map((b) => [b.id, b.name] as const)} placeholder="All branches" />}
            <SelectParam
              name="status"
              placeholder="Current staff"
              options={[
                ["all", "Everyone"],
                ["ACTIVE", "Active"],
                ["ON_NOTICE", "On notice"],
                ["RESIGNED", "Resigned"],
                ["TERMINATED", "Terminated"],
              ]}
            />
          </FilterBar>
        </div>
        {total === 0 && !q ? (
          <EmptyState icon={<UserCog className="h-5 w-5" />} title="No employees yet" description="Add your doctors, therapists and front-desk team." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH>
                <TH className="hidden md:table-cell">Role</TH>
                {scope.isAll && <TH className="hidden lg:table-cell">Branch</TH>}
                <TH className="hidden lg:table-cell">Mobile</TH>
                <TH className="hidden xl:table-cell">Joined</TH>
                <TH className="hidden sm:table-cell">Today</TH>
                {showSalary && <TH className="hidden md:table-cell text-right">Salary</TH>}
                <TH>Status</TH>
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 && <TableEmpty colSpan={8}>No employees match these filters.</TableEmpty>}
              {rows.map((s) => {
                const a = att.get(s.id);
                return (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/staff/${s.id}`} className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials(s.fullName)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium hover:text-accent">{s.fullName}</span>
                          <span className="block truncate text-xs text-muted">
                            {s.code} · {s.designation}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD className="hidden text-ink-2 md:table-cell">
                      {STAFF_TYPE_OPTIONS.find((o) => o[0] === s.staffType)?.[1]}
                      <p className="text-xs text-muted">{s.department}</p>
                    </TD>
                    {scope.isAll && <TD className="hidden text-ink-2 lg:table-cell">{s.branch.name}</TD>}
                    <TD className="tabular hidden text-ink-2 lg:table-cell">{s.mobile}</TD>
                    <TD className="hidden text-ink-2 xl:table-cell">{fmtDate(s.joiningDate)}</TD>
                    <TD className="hidden sm:table-cell">
                      {a ? (
                        <StatusBadge kind="attendance" status={a.checkOut ? a.status : a.status === "PRESENT" && a.checkIn ? "PRESENT" : a.status} />
                      ) : s.weeklyOff.includes(new Date(`${todayKey}T00:00:00Z`).getUTCDay()) ? (
                        <StatusBadge kind="attendance" status="WEEK_OFF" />
                      ) : (
                        <Badge tone="neutral">Not in</Badge>
                      )}
                    </TD>
                    {showSalary && (
                      <TD className="tabular hidden text-right md:table-cell">
                        {money(s.monthlySalary, { decimals: false })}
                        {s.salaryType !== "MONTHLY" && <span className="text-xs text-muted">/{s.salaryType === "DAILY" ? "day" : "hr"}</span>}
                      </TD>
                    )}
                    <TD>
                      <StatusBadge kind="employment" status={s.status} />
                      {s.user && <p className="mt-0.5 hidden text-[11px] text-muted lg:block">Has login</p>}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={(p) => withParams("/staff", sp as Record<string, string>, { page: p })} />
      </Card>
    </>
  );
}
