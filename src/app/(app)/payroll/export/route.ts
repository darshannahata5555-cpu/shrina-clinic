import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { audit } from "@/lib/audit";
import { istDateKey, toNum } from "@/lib/format";

/** Monthly payroll report (.xlsx). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("payroll.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await getBranchScope();
  const m = req.nextUrl.searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(m) ? m : istDateKey().slice(0, 7);
  const rows = await db.payroll.findMany({
    where: { month, staff: { branchId: { in: scope.ids } } },
    include: { staff: { include: { branch: { select: { name: true } } } } },
    orderBy: { staff: { fullName: "asc" } },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  const ws = wb.addWorksheet(`Payroll ${month}`, { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const cols: [string, number][] = [
    ["Employee ID", 11], ["Name", 24], ["Branch", 18], ["Designation", 20], ["Salary type", 10], ["Base salary", 12], ["Per-day rate", 11],
    ["Days in month", 9], ["Working days", 9], ["Present", 8], ["Half days", 8], ["Paid leave", 9], ["Unpaid leave", 9], ["Absent", 8], ["Late count", 8], ["OT hours", 8],
    ["Absent deduction", 12], ["Leave deduction", 12], ["Half-day deduction", 12], ["Late deduction", 12], ["Overtime pay", 12], ["Incentives + bonus", 12], ["Advances", 11], ["Other deductions", 12],
    ["Gross pay", 12], ["Net pay", 12], ["Status", 10], ["Paid on", 11], ["Payment method", 13], ["Payment ref", 16], ["Bank", 16], ["Account", 18], ["IFSC", 12],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      r.staff.code, r.staff.fullName, r.staff.branch.name, r.staff.designation, r.staff.salaryType, toNum(r.baseSalary), toNum(r.perDayRate),
      r.calendarDays, r.workingDays, toNum(r.presentDays), r.halfDays, toNum(r.paidLeaveDays), toNum(r.unpaidLeaveDays), toNum(r.absentDays), r.lateCount, +(r.overtimeMinutes / 60).toFixed(2),
      toNum(r.absentDeduction), toNum(r.leaveDeduction), toNum(r.halfDayDeduction), toNum(r.lateDeduction), toNum(r.overtimePay), toNum(r.incentives), toNum(r.advances), toNum(r.otherDeductions),
      toNum(r.grossPay), toNum(r.netPay), r.status, r.paidAt ? istDateKey(r.paidAt) : "", r.paymentMethod ?? "", r.paymentRef ?? "", r.staff.bankName ?? "", r.staff.bankAccount ?? "", r.staff.ifsc ?? "",
    ]);
  }
  const total = ws.addRow(["", "TOTAL", "", "", "", ...Array(19).fill(null), rows.reduce((s, r) => s + toNum(r.grossPay), 0), rows.reduce((s, r) => s + toNum(r.netPay), 0)]);
  total.font = { bold: true };
  for (let c = 6; c <= 26; c++) ws.getColumn(c).numFmt = c >= 8 && c <= 16 ? "0.##" : "#,##0.00";

  await audit(user.id, "EXPORT", "Payroll", null, `Exported payroll report for ${month} (${rows.length} rows)`);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shrina-payroll-${month}.xlsx"`,
    },
  });
}
