import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { can, getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { buildReport, REPORT_TABS, resolveRange, type ColKind, type ReportTab } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { fmtDateTime } from "@/lib/format";
import { allowedTabs } from "@/app/(app)/reports/tabs";

/** Excel export of one report tab: a Summary sheet (KPIs) + one sheet per section. Needs reports.export. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user, "reports.export") || !(can(user, "reports.view") || can(user, "reports.financial")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tabs = allowedTabs(user);
  const tab = tabs.find((t) => t.key === sp.tab)?.key as ReportTab | undefined;
  if (!tab) return NextResponse.json({ error: "Report not available" }, { status: 403 });

  const scope = await getBranchScope();
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
  const title = REPORT_TABS.find((t) => t.key === tab)!.label;

  const wb = new ExcelJS.Workbook();
  wb.creator = `${clinic.clinicName} Clinic Management`;
  wb.created = new Date();
  const numFmt = (k?: ColKind) => (k === "money" ? '"₹"#,##,##0' : k === "percent" ? '0.0"%"' : k === "hours" ? '0.0" h"' : k === "number" ? "#,##,##0.##" : undefined);

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 36 }, { width: 24 }, { width: 48 }];
  summary.addRow([`${clinic.clinicName} — ${title} report`]).font = { bold: true, size: 14 };
  summary.addRow(["Period", range.label]);
  summary.addRow(["Branches", scope.current?.name ?? scope.branches.map((b) => b.name).join(", ")]);
  summary.addRow(["Generated", `${fmtDateTime(new Date())} by ${user.name}`]);
  summary.addRow([]);
  if (report.kpis.length) {
    const h = summary.addRow(["Measure", "Value", "Note"]);
    h.font = { bold: true };
    for (const k of report.kpis) {
      const row = summary.addRow([k.label, k.value, k.hint ?? ""]);
      const f = numFmt(k.kind);
      if (f) row.getCell(2).numFmt = f;
    }
  }

  const used = new Set<string>(["Summary"]);
  for (const s of report.sections) {
    let name = s.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim();
    let n = 2;
    while (used.has(name)) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = s.columns.map((c, i) => ({ header: c.label, key: c.key, width: i === 0 ? 34 : Math.max(12, c.label.length + 4) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1EEEA" } };
    for (const r of s.rows) {
      const row = ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, r[c.key] ?? null])));
      s.columns.forEach((c, i) => {
        const f = numFmt(i > 0 && r._kind ? r._kind : c.kind);
        if (f) row.getCell(i + 1).numFmt = f;
      });
    }
    if (s.totals) {
      const row = ws.addRow(Object.fromEntries(s.columns.map((c) => [c.key, s.totals![c.key] ?? null])));
      row.font = { bold: true };
      s.columns.forEach((c, i) => {
        const f = numFmt(c.kind);
        if (f) row.getCell(i + 1).numFmt = f;
      });
    }
    if (s.description) {
      ws.addRow([]);
      ws.addRow([s.description]).font = { italic: true, color: { argb: "FF78716C" } };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  await audit(user.id, "EXPORT", "Report", tab, `Exported ${title} report to Excel (${range.label})`, { branchId: scope.current?.id ?? null });
  const file = `SHRINA-${tab}-report-${range.fromKey}-to-${range.toKey}.xlsx`;
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
