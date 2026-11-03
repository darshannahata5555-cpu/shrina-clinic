import { can, requirePermission } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { buildReport, formatCell, REPORT_TABS, resolveRange, type ReportTab } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { fmtDateTime } from "@/lib/format";
import { SectionTable } from "../report-view";
import { allowedTabs } from "../tabs";
import { PrintButton } from "./print-button";

export const metadata = { title: "Report (print)" };

/** Print-optimised report — use the browser's "Save as PDF" for a PDF export. */
export default async function ReportPrintPage({ searchParams }: PageProps<"/reports/print">) {
  const user = await requirePermission(["reports.view", "reports.financial"]);
  const scope = await getBranchScope();
  const sp = await searchParams;
  const tabs = allowedTabs(user);
  const tab = (tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0]!.key) as ReportTab;
  const range = resolveRange(sp);
  const [report, clinic] = await Promise.all([
    buildReport(tab, {
      range,
      branchIds: scope.ids,
      branches: scope.branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
      financial: can(user, "reports.financial"),
      payroll: can(user, "reports.financial") || can(user, "payroll.view"),
    }),
    getSetting("clinic"),
  ]);
  await audit(user.id, "EXPORT", "Report", tab, `Opened print/PDF view of ${tab} report (${range.label})`, { branchId: scope.current?.id ?? null });
  const title = REPORT_TABS.find((t) => t.key === tab)!.label;

  return (
    <div className="mx-auto max-w-5xl rounded-xl border border-border bg-surface p-6 print-plain sm:p-8">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3 text-[13px] text-muted">
        <span>Use “Save as PDF” in the print dialog to download a PDF.</span>
        <PrintButton />
      </div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.25em] text-accent">{clinic.clinicName}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title} report</h1>
          <p className="mt-1 text-sm text-muted">
            {range.label} · {scope.current?.name ?? `All branches (${scope.branches.map((b) => b.code).join(", ")})`}
          </p>
        </div>
        <p className="text-right text-xs text-muted">
          {clinic.legalName}
          <br />
          Generated {fmtDateTime(new Date())} by {user.name}
        </p>
      </header>

      {report.kpis.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {report.kpis.map((k) => (
            <div key={k.label} className="rounded-lg border border-border px-3 py-2">
              <p className="text-[11px] text-muted">{k.label}</p>
              <p className="tabular text-base font-semibold">{formatCell(k.value, k.kind)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {report.sections.map((s) => (
          <section key={s.id} className="break-inside-avoid-page">
            <h2 className="mb-1 text-[15px] font-semibold">{s.title}</h2>
            {s.description && <p className="mb-2 text-xs text-muted">{s.description}</p>}
            <div className="overflow-hidden rounded-lg border border-border">
              <SectionTable s={s} dense />
            </div>
          </section>
        ))}
      </div>
      <p className="mt-8 border-t border-border pt-3 text-[11px] text-muted">Confidential — for internal use by {clinic.clinicName} management only.</p>
    </div>
  );
}
