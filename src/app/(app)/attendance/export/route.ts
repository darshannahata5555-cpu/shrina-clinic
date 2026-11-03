import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getBranchScope } from "@/lib/branch";
import { audit } from "@/lib/audit";
import { STATUS_LETTER, dateKeysBetween, impliedStatus, keyOfDbDate, monthKeys } from "@/lib/attendance";
import { dbDate, istDateKey } from "@/lib/format";
import { getSetting } from "@/lib/settings";

/** Monthly attendance register as .xlsx (attendance.view + reports.export or attendance.manage). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissions.has("attendance.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const scope = await getBranchScope();
  const month = /^\d{4}-\d{2}$/.test(req.nextUrl.searchParams.get("month") ?? "") ? req.nextUrl.searchParams.get("month")! : istDateKey().slice(0, 7);
  const b = req.nextUrl.searchParams.get("branch");
  const branchIds = b && scope.ids.includes(b) ? [b] : scope.ids;
  const keys = monthKeys(month);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const today = istDateKey();
  const { lateGraceMinutes: grace } = await getSetting("payroll");

  const staff = await db.staff.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "ON_NOTICE"] }, branchId: { in: branchIds } },
    include: { branch: { select: { name: true } } },
    orderBy: [{ branchId: "asc" }, { fullName: "asc" }],
  });
  const [rows, holidays, leaves] = await Promise.all([
    db.attendance.findMany({ where: { staffId: { in: staff.map((s) => s.id) }, date: { gte: dbDate(first), lte: dbDate(last) } } }),
    db.holiday.findMany({ where: { date: { gte: dbDate(first), lte: dbDate(last) } } }),
    db.leaveRequest.findMany({ where: { status: "APPROVED", staffId: { in: staff.map((s) => s.id) }, fromDate: { lte: dbDate(last) }, toDate: { gte: dbDate(first) } } }),
  ]);
  const att = new Map(rows.map((r) => [`${r.staffId}|${keyOfDbDate(r.date)}`, r]));
  const leaveSet = new Set<string>();
  for (const l of leaves) for (const k of dateKeysBetween(keyOfDbDate(l.fromDate), keyOfDbDate(l.toDate))) leaveSet.add(`${l.staffId}|${k}`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SHRINA Clinic";
  const ws = wb.addWorksheet(`Attendance ${month}`, { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
  ws.columns = [
    { header: "Employee ID", width: 11 },
    { header: "Name", width: 24 },
    { header: "Branch", width: 18 },
    ...keys.map((k) => ({ header: String(Number(k.slice(8))), width: 4.5 })),
    { header: "Present", width: 8 },
    { header: "Half days", width: 9 },
    { header: "Absent", width: 8 },
    { header: "Leave", width: 7 },
    { header: "Late", width: 6 },
    { header: "Hours", width: 8 },
    { header: "OT hours", width: 9 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const s of staff) {
    const join = istDateKey(s.joiningDate);
    let work = 0,
      ot = 0,
      late = 0;
    const letters = keys.map((k) => {
      const r = att.get(`${s.id}|${k}`);
      if (r) {
        work += r.workMinutes;
        ot += r.overtimeMinutes;
        late += r.lateMinutes > grace ? 1 : 0;
        return STATUS_LETTER[r.status]!;
      }
      if (k < join) return "";
      const hol = holidays.some((h) => keyOfDbDate(h.date) === k && (!h.branchId || h.branchId === s.branchId));
      return STATUS_LETTER[impliedStatus({ dateKey: k, today, weeklyOff: s.weeklyOff, holiday: hol, onLeave: leaveSet.has(`${s.id}|${k}`) })] ?? "";
    });
    const n = (l: string) => letters.filter((x) => x === l).length;
    ws.addRow([s.code, s.fullName, s.branch.name, ...letters, n("P"), n("H"), n("A"), n("L"), late, +(work / 60).toFixed(1), +(ot / 60).toFixed(1)]);
  }
  ws.eachRow((row, i) => {
    if (i === 1) return;
    row.eachCell((cell, col) => {
      if (col > 3 && col <= 3 + keys.length) {
        cell.alignment = { horizontal: "center" };
        if (cell.value === "A") cell.font = { color: { argb: "FFB42F3A" }, bold: true };
        if (cell.value === "H") cell.font = { color: { argb: "FFA2650F" }, bold: true };
        if (cell.value === "L") cell.font = { color: { argb: "FF6B4FA0" }, bold: true };
      }
    });
  });

  await audit(user.id, "EXPORT", "Attendance", null, `Exported attendance register for ${month}`);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="shrina-attendance-${month}.xlsx"`,
    },
  });
}
