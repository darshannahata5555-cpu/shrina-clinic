import Link from "next/link";
import { Copy, Download, Upload, UserPlus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { clinicianOptions } from "@/lib/lookups";
import { ageFrom, fmtDate, humanize, money, relativeDays, toNum } from "@/lib/format";
import { buildPatientWhere, patientOrder } from "./query";
import { LEAD_SOURCES } from "@/lib/status";
import { PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, THead, TH, TR, TD, TableEmpty } from "@/components/ui/table";
import { DateParam, FilterBar, SearchParamInput, SegmentParam, SelectParam } from "@/components/ui/filters";

export const metadata = { title: "Patients" };

const PAGE_SIZE = 25;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PatientsPage({ searchParams }: PageProps<"/patients">) {
  const user = await requirePermission("patients.view");
  const scope = await getBranchScope();
  const sp = await searchParams;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const sort = one(sp.sort) || "recent";
  const followup = one(sp.followup) === "1";
  const canBilling = can(user, "billing.view");

  const where = await buildPatientWhere(sp, scope.ids);
  const [total, patients, { doctors }, dupGroups] = await Promise.all([
    db.patient.count({ where }),
    db.patient.findMany({
      where,
      orderBy: patientOrder(sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        branch: { select: { code: true, name: true } },
        assignedDoctor: { select: { fullName: true } },
        ...(followup
          ? { consultations: { where: { deletedAt: null, followUpDate: { not: null } }, orderBy: { followUpDate: "desc" as const }, take: 1, select: { followUpDate: true } } }
          : {}),
      },
    }),
    clinicianOptions(scope.branches.map((b) => b.id)),
    can(user, "patients.edit")
      ? db.patient.groupBy({ by: ["mobile"], where: { deletedAt: null, branchId: { in: scope.ids } }, having: { mobile: { _count: { gt: 1 } } } })
      : Promise.resolve([]),
  ]);

  const dues = canBilling && patients.length
    ? await db.invoice.groupBy({
        by: ["patientId"],
        where: { deletedAt: null, patientId: { in: patients.map((p) => p.id) }, status: { in: ["UNPAID", "PARTIAL"] } },
        _sum: { balance: true },
      })
    : [];
  const dueOf = new Map(dues.map((d) => [d.patientId, toNum(d._sum.balance)]));
  const hrefFor = (p: number) => withParams("/patients", sp, { page: p });
  const filtered = Object.keys(sp).some((k) => k !== "page" && k !== "sort" && one(sp[k]));

  return (
    <>
      <PageHeader
        title="Patients"
        description={`${total.toLocaleString("en-IN")} ${filtered ? "matching" : "registered"} patient${total === 1 ? "" : "s"}${scope.current ? ` at ${scope.current.name}` : " across all branches"}`}
        actions={
          <>
            {dupGroups.length > 0 && (
              <LinkButton href="/patients/duplicates" variant="outline">
                <Copy className="h-4 w-4" /> Duplicates <Badge tone="warning">{dupGroups.length}</Badge>
              </LinkButton>
            )}
            {can(user, "patients.import") && (
              <LinkButton href="/patients/import" variant="outline">
                <Upload className="h-4 w-4" /> Import
              </LinkButton>
            )}
            {can(user, "reports.export") && (
              <a href={withParams("/api/patients/export", sp, { page: null })} className="inline-flex h-9.5 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-2">
                <Download className="h-4 w-4" /> Export
              </a>
            )}
            {can(user, "patients.create") && (
              <LinkButton href="/patients/new">
                <UserPlus className="h-4 w-4" /> Register patient
              </LinkButton>
            )}
          </>
        }
      />

      <Card>
        <div className="space-y-3 border-b border-border px-4 py-3 sm:px-5">
          <FilterBar>
            <SearchParamInput placeholder="Name, mobile or Patient ID" className="sm:w-72" />
            <SelectParam name="source" placeholder="All sources" options={LEAD_SOURCES} />
            <SelectParam name="doctor" placeholder="All doctors" options={doctors} />
            <SelectParam name="gender" placeholder="Any gender" options={[["FEMALE", "Female"], ["MALE", "Male"], ["OTHER", "Other"]]} />
            <SelectParam name="followup" placeholder="All patients" options={[["1", "Follow-up due"]]} />
            {canBilling && <SelectParam name="outstanding" placeholder="Any balance" options={[["1", "Has pending payment"]]} />}
          </FilterBar>
          <FilterBar>
            <DateParam name="from" label="Registered from" />
            <DateParam name="to" label="to" />
            <div className="ml-auto">
              <SegmentParam name="sort" defaultValue="recent" options={[["recent", "Recent visit"], ["new", "Newest"], ["name", "A–Z"]]} />
            </div>
          </FilterBar>
        </div>

        {total === 0 && !filtered ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No patients yet"
            description="Register your first patient or import existing records from Excel."
            action={can(user, "patients.create") && <LinkButton href="/patients/new">Register patient</LinkButton>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Patient</TH>
                <TH>Mobile</TH>
                <TH className="hidden lg:table-cell">Age / gender</TH>
                <TH className="hidden md:table-cell">{followup ? "Follow-up" : "Last visit"}</TH>
                <TH className="hidden xl:table-cell">Doctor</TH>
                <TH className="hidden xl:table-cell">Source</TH>
                {scope.isAll && <TH className="hidden sm:table-cell">Branch</TH>}
                {canBilling && <TH className="text-right">Due</TH>}
              </tr>
            </THead>
            <tbody>
              {patients.length === 0 && <TableEmpty colSpan={8}>No patients match these filters.</TableEmpty>}
              {patients.map((p) => {
                const age = ageFrom(p.dob);
                const due = dueOf.get(p.id) ?? 0;
                const fu = "consultations" in p ? (p.consultations as { followUpDate: Date | null }[])[0]?.followUpDate : null;
                return (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/patients/${p.id}`} className="font-medium text-ink hover:text-accent">
                        {p.fullName}
                      </Link>
                      <p className="text-xs text-muted">{p.code}</p>
                    </TD>
                    <TD className="tabular whitespace-nowrap text-ink-2">{p.mobile}</TD>
                    <TD className="hidden text-ink-2 lg:table-cell">
                      {[age !== null ? `${age} yrs` : null, p.gender ? humanize(p.gender) : null].filter(Boolean).join(" · ") || "—"}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-ink-2 md:table-cell">
                      {followup && fu ? (
                        <span className={fu < new Date() ? "text-danger" : ""}>
                          {fmtDate(fu)} <span className="text-xs text-muted">({relativeDays(fu)})</span>
                        </span>
                      ) : p.lastVisitAt ? (
                        fmtDate(p.lastVisitAt)
                      ) : (
                        <span className="text-muted">No visit yet</span>
                      )}
                    </TD>
                    <TD className="hidden text-ink-2 xl:table-cell">{p.assignedDoctor?.fullName ?? "—"}</TD>
                    <TD className="hidden text-ink-2 xl:table-cell">{p.source ? (LEAD_SOURCES.find(([k]) => k === p.source)?.[1] ?? humanize(p.source)) : "—"}</TD>
                    {scope.isAll && (
                      <TD className="hidden sm:table-cell">
                        <Badge tone="neutral">{p.branch.code}</Badge>
                      </TD>
                    )}
                    {canBilling && (
                      <TD className={`tabular text-right ${due > 0 ? "font-medium text-warning" : "text-muted"}`}>{due > 0 ? money(due, { decimals: false }) : "—"}</TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />
      </Card>
    </>
  );
}
