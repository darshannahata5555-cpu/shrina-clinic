import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { expireOverduePackages, remainingSessions } from "@/lib/packages";
import { fmtDate, istDayRange, money, relativeDays, toNum } from "@/lib/format";
import { STATUS, TREATMENT_CATEGORIES } from "@/lib/status";
import { LinkTabs, PageHeader, Pagination, withParams } from "@/components/ui/page";
import { Card, EmptyState } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FilterBar, SearchParamInput, SelectParam } from "@/components/ui/filters";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/format";
import { TreatmentForm } from "./treatment-form";
import { Progress } from "./_components/progress";

export const metadata = { title: "Treatments" };
const PAGE = 25;

export default async function TreatmentsPage({ searchParams }: PageProps<"/treatments">) {
  const user = await requirePermission(["packages.view", "treatments.manage"]);
  const scope = await getBranchScope();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const canPackages = can(user, "packages.view");
  const tab = one("tab") === "catalog" || !canPackages ? "catalog" : "packages";
  const href = (o: Record<string, string | number | null>) => withParams("/treatments", sp as Record<string, string | string[] | undefined>, o);

  return (
    <>
      <PageHeader
        title="Treatments"
        description="Treatment packages sold to patients and the clinic's treatment catalogue."
        actions={
          <>
            {tab === "packages" && can(user, "packages.manage") && (
              <LinkButton href="/treatments/packages/new">
                <Plus className="h-4 w-4" /> Sell package
              </LinkButton>
            )}
            {tab === "catalog" && can(user, "treatments.manage") && (
              <Dialog title="Add treatment" size="lg" trigger={<Button><Plus className="h-4 w-4" /> Add treatment</Button>}>
                <TreatmentForm />
              </Dialog>
            )}
          </>
        }
      />
      <LinkTabs
        active={tab}
        tabs={[
          ...(canPackages ? [{ key: "packages", label: "Patient packages", href: "/treatments" }] : []),
          { key: "catalog", label: "Treatment catalogue", href: "/treatments?tab=catalog" },
        ]}
      />
      {tab === "packages" ? <PackagesTab sp={sp} one={one} href={href} scopeIds={scope.ids} isAll={scope.isAll} /> : <CatalogTab one={one} canEdit={can(user, "treatments.manage")} />}
    </>
  );
}

async function PackagesTab({
  sp,
  one,
  href,
  scopeIds,
  isAll,
}: {
  sp: Record<string, string | string[] | undefined>;
  one: (k: string) => string;
  href: (o: Record<string, string | number | null>) => string;
  scopeIds: string[];
  isAll: boolean;
}) {
  await expireOverduePackages();
  const page = Math.max(1, Number(one("page")) || 1);
  const q = one("q").trim();
  const status = one("status") || "ACTIVE";
  const category = one("category");
  const expiring = one("expiring");
  const { start } = istDayRange();
  const where: Prisma.TreatmentPackageWhereInput = {
    deletedAt: null,
    branchId: { in: scopeIds },
    patient: { deletedAt: null },
    ...(status !== "ALL" ? { status: status as never } : {}),
    ...(category ? { treatment: { category } } : {}),
    ...(expiring ? { status: "ACTIVE", expiryDate: { gte: start, lt: new Date(start.getTime() + Number(expiring) * 86400000) } } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { patient: { fullName: { contains: q, mode: "insensitive" } } },
            { patient: { code: { contains: q, mode: "insensitive" } } },
            { patient: { mobile: { contains: q.replace(/\D/g, "") || q } } },
          ],
        }
      : {}),
  };
  const [rows, total, summary] = await Promise.all([
    db.treatmentPackage.findMany({
      where,
      include: { patient: { select: { id: true, fullName: true, code: true } }, treatment: { select: { category: true } }, branch: { select: { code: true } } },
      orderBy: expiring ? { expiryDate: "asc" } : { purchaseDate: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.treatmentPackage.count({ where }),
    db.treatmentPackage.groupBy({ by: ["status"], where: { deletedAt: null, branchId: { in: scopeIds } }, _count: true }),
  ]);
  void sp;

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5">
        <FilterBar>
          <SearchParamInput placeholder="Patient, package or code…" />
          <SelectParam
            name="status"
            placeholder="Active"
            options={[["ALL", "All statuses"], ...Object.entries(STATUS.package).filter(([k]) => k !== "ACTIVE").map(([k, [, l]]) => [k, l] as const)]}
          />
          <SelectParam name="category" placeholder="All categories" options={TREATMENT_CATEGORIES.map((c) => [c, c] as const)} />
          <SelectParam name="expiring" placeholder="Any expiry" options={[["30", "Expiring in 30 days"], ["60", "Expiring in 60 days"]]} />
        </FilterBar>
        <div className="flex flex-wrap gap-1.5">
          {summary.map((s) => (
            <Badge key={s.status} tone={STATUS.package[s.status][0]}>
              {STATUS.package[s.status][1]} · {s._count}
            </Badge>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No packages match" description="Change the filters, or sell a package from a patient's profile." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Package</TH>
              <TH>Patient</TH>
              <TH>Sessions</TH>
              <TH className="hidden text-right sm:table-cell">Remaining</TH>
              <TH className="hidden md:table-cell">Expiry</TH>
              <TH className="hidden text-right lg:table-cell">Price</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((p) => {
              const rem = remainingSessions(p);
              const soon = p.status === "ACTIVE" && p.expiryDate && p.expiryDate.getTime() - Date.now() < 30 * 86400000;
              return (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/treatments/packages/${p.id}`} className="font-medium hover:text-accent">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {p.code} · {p.treatment.category}
                      {isAll ? ` · ${p.branch.code}` : ""}
                    </p>
                  </TD>
                  <TD>
                    <Link href={`/patients/${p.patient.id}?tab=packages`} className="hover:text-accent">
                      {p.patient.fullName}
                    </Link>
                    <p className="text-xs text-muted">{p.patient.code}</p>
                  </TD>
                  <TD>
                    <Progress done={p.completedSessions} total={p.totalSessions} />
                  </TD>
                  <TD className="tabular hidden text-right font-medium sm:table-cell">{rem}</TD>
                  <TD className="hidden md:table-cell">
                    <span className={cn("text-[13px]", soon ? "text-warning" : "text-ink-2")}>{fmtDate(p.expiryDate)}</span>
                    {p.status === "ACTIVE" && p.expiryDate && <span className="block text-xs text-muted">{relativeDays(p.expiryDate)}</span>}
                  </TD>
                  <TD className="tabular hidden text-right lg:table-cell">{money(toNum(p.price), { decimals: false })}</TD>
                  <TD>
                    <StatusBadge kind="package" status={p.status} />
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageSize={PAGE} total={total} hrefFor={(p) => href({ page: p })} />
    </Card>
  );
}

async function CatalogTab({ one, canEdit }: { one: (k: string) => string; canEdit: boolean }) {
  const category = one("category");
  const q = one("q").trim();
  const showInactive = one("inactive") === "1";
  const rows = await db.treatment.findMany({
    where: {
      deletedAt: null,
      ...(showInactive ? {} : { isActive: true }),
      ...(category ? { category } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    include: { _count: { select: { productUsages: true, packages: { where: { status: "ACTIVE", deletedAt: null } } } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return (
    <Card>
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <FilterBar>
          <SearchParamInput placeholder="Search treatments…" />
          <SelectParam name="category" placeholder="All categories" options={TREATMENT_CATEGORIES.map((c) => [c, c] as const)} />
          <SelectParam name="inactive" placeholder="Active only" options={[["1", "Include inactive"]]} />
        </FilterBar>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No treatments" description={canEdit ? "Add the clinic's first treatment." : undefined} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Treatment</TH>
              <TH className="text-right">Price / session</TH>
              <TH className="hidden text-right sm:table-cell">Sessions</TH>
              <TH className="hidden text-right md:table-cell">Duration</TH>
              <TH className="hidden text-right md:table-cell">GST</TH>
              <TH className="hidden text-right lg:table-cell">Validity</TH>
              <TH className="hidden lg:table-cell">Auto stock use</TH>
              <TH className="hidden text-right sm:table-cell">Active packages</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((t) => (
              <TR key={t.id} className={t.isActive ? "" : "opacity-60"}>
                <TD>
                  <Link href={`/treatments/catalog/${t.id}`} className="font-medium hover:text-accent">
                    {t.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {t.category}
                    {!t.isActive && " · inactive"}
                  </p>
                </TD>
                <TD className="tabular text-right">{money(toNum(t.defaultPrice), { decimals: false })}</TD>
                <TD className="tabular hidden text-right sm:table-cell">
                  {t.defaultSessions}
                  {t.defaultSessions > 1 && <span className="block text-xs text-muted">every {t.sessionGapDays}d</span>}
                </TD>
                <TD className="tabular hidden text-right md:table-cell">{t.durationMins} min</TD>
                <TD className="tabular hidden text-right md:table-cell">{toNum(t.gstRate)}%</TD>
                <TD className="tabular hidden text-right lg:table-cell">{t.validityDays} days</TD>
                <TD className="hidden lg:table-cell">
                  {t._count.productUsages ? <Badge tone="info">{t._count.productUsages} product{t._count.productUsages > 1 ? "s" : ""}</Badge> : <span className="text-xs text-muted">—</span>}
                </TD>
                <TD className="tabular hidden text-right sm:table-cell">{t._count.packages}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
