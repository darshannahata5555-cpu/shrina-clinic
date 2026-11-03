import { Download, Printer } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { buildReport, resolveRange, type ReportTab } from "@/lib/reports";
import { allowedTabs } from "./tabs";
import { LinkTabs, PageHeader, withParams } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { KpiGrid, SectionCard } from "./report-view";
import { ReportFilters } from "./report-filters";

export const metadata = { title: "Reports & Analytics" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const user = await requirePermission(["reports.view", "reports.financial"]);
  const scope = await getBranchScope();
  const sp = await searchParams;
  const tabs = allowedTabs(user);
  const tab = (tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0]!.key) as ReportTab;
  const range = resolveRange(sp);
  const autoGran = resolveRange({ ...sp, gran: undefined }).gran;
  const report = await buildReport(tab, {
    range,
    branchIds: scope.ids,
    branches: scope.branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    financial: can(user, "reports.financial"),
    payroll: can(user, "reports.financial") || can(user, "payroll.view"),
  });

  const keep = { preset: sp.preset, from: sp.from, to: sp.to, gran: sp.gran } as Record<string, string | string[] | undefined>;
  const qs = new URLSearchParams(Object.entries({ ...keep, tab }).filter(([, v]) => typeof v === "string") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        description={`${range.label} · ${scope.current?.name ?? "All branches"}`}
        actions={
          <>
            <LinkButton href={`/reports/print?${qs}`} variant="outline" target="_blank">
              <Printer className="h-4 w-4" /> Print / PDF
            </LinkButton>
            {can(user, "reports.export") && (
              <LinkButton href={`/api/reports/export?${qs}`} variant="outline" prefetch={false}>
                <Download className="h-4 w-4" /> Excel
              </LinkButton>
            )}
          </>
        }
      />
      <LinkTabs tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: withParams("/reports", keep, { tab: t.key }) }))} active={tab} className="mb-4" />
      <div className="mb-5">
        <ReportFilters preset={range.preset} autoGran={autoGran} showGran={tab !== "branches" && tab !== "staff"} />
      </div>
      <div className="space-y-6">
        <KpiGrid report={report} />
        {report.sections.length === 0 ? (
          <Card>
            <EmptyState title="Nothing to show" description="There is no data you can view for this period." />
          </Card>
        ) : (
          report.sections.map((s) => <SectionCard key={s.id} s={s} />)
        )}
      </div>
    </>
  );
}
