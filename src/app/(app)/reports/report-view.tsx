import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Table, TableEmpty, TD, TH, THead, TR } from "@/components/ui/table";
import { ReportChart } from "@/components/charts/report-chart";
import { formatCell, type Report, type Section } from "@/lib/reports";
import { cn } from "@/lib/format";

/** Shared rendering of a report (KPIs + section cards with chart and table). Server component. */
export function KpiGrid({ report }: { report: Report }) {
  if (!report.kpis.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {report.kpis.map((k) => (
        <StatCard key={k.label} label={k.label} value={formatCell(k.value, k.kind)} hint={k.hint} />
      ))}
    </div>
  );
}

export function SectionTable({ s, dense }: { s: Section; dense?: boolean }) {
  const numeric = (k?: string) => !!k && k !== "text";
  return (
    <Table>
      <THead>
        <tr>
          {s.columns.map((c, i) => (
            <TH key={c.key} className={cn(i > 0 && numeric(c.kind) && "text-right", dense && "py-1.5")}>
              {c.label}
            </TH>
          ))}
        </tr>
      </THead>
      <tbody>
        {s.rows.length === 0 && <TableEmpty colSpan={s.columns.length}>{s.note ?? "No data for this period."}</TableEmpty>}
        {s.rows.map((r, ri) => (
          <TR key={ri}>
            {s.columns.map((c, i) => {
              const kind = i > 0 && r._kind ? r._kind : c.kind;
              return (
                <TD key={c.key} className={cn(i > 0 && numeric(kind) && "tabular text-right", i === 0 && "font-medium", dense && "py-1.5 text-[13px]")}>
                  {formatCell(r[c.key] ?? null, kind)}
                </TD>
              );
            })}
          </TR>
        ))}
        {s.totals && s.rows.length > 0 && (
          <tr className="border-t-2 border-border-strong bg-surface-2">
            {s.columns.map((c, i) => (
              <td key={c.key} className={cn("px-4 py-2.5 text-sm font-semibold first:pl-5 last:pr-5", i > 0 && numeric(c.kind) && "tabular text-right")}>
                {s.totals![c.key] === undefined ? "" : formatCell(s.totals![c.key] ?? null, c.kind)}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </Table>
  );
}

export function SectionCard({ s }: { s: Section }) {
  return (
    <Card id={s.id}>
      <CardHeader title={s.title} description={s.description} />
      {s.chart && s.rows.length > 0 && (
        <CardBody className="border-b border-border">
          <ReportChart spec={s.chart} rows={s.rows} title={s.title} />
        </CardBody>
      )}
      <SectionTable s={s} />
    </Card>
  );
}
