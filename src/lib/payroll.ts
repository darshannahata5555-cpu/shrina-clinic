import "server-only";
import type { AdjustmentType, LeaveType, Prisma, SalaryType } from "@prisma/client";
import { db, type Tx } from "./db";
import { ActionError } from "./auth";
import { dbDate, istDateKey, r2, toNum, weekdayOfKey } from "./format";
import { getSetting, type Settings } from "./settings";
import { daysInMonth, entitlements, holidayKeys, keyOfDbDate, leaveDayKeys, monthKeys, shiftBounds } from "./attendance";

export type PayrollRules = Settings<"payroll">;

/** Day counts that drive the salary maths (all in days unless noted). */
export type PayrollCounts = {
  calendarDays: number;
  workingDays: number; // calendar − weekly offs − holidays
  presentDays: number; // full days present (excluding half days)
  halfDays: number; // half-day attendances NOT covered by a half-day leave
  paidLeaveDays: number; // approved leave within balance
  unpaidLeaveDays: number; // unpaid leave + leave beyond balance
  absentDays: number; // working days with no attendance and no leave
  weekOffDays: number;
  holidayDays: number;
  notEmployedDays: number; // before joining date
  projectedDays: number; // future days when payroll is run mid-month (assumed paid)
  lateCount: number; // arrivals beyond grace
  overtimeMinutes: number;
  workMinutes: number; // for hourly staff
  shiftHours: number;
};

export type PayrollAdjustments = { incentives: number; bonus: number; advances: number; deductions: number };

export type PayrollLine = { label: string; detail: string; amount: number };

export type PayrollResult = {
  baseSalary: number;
  perDayRate: number;
  basisDays: number;
  leaveDeduction: number;
  halfDayDeduction: number;
  absentDeduction: number;
  lateDeduction: number;
  otherAttendanceDeduction: number;
  overtimePay: number;
  incentives: number;
  advances: number;
  otherDeductions: number;
  grossPay: number;
  netPay: number;
  earnings: PayrollLine[];
  deductions: PayrollLine[];
  notes: string[];
};

const fmt = (n: number) => `₹${r2(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Pure salary calculation (no DB). Rules (all owner-configurable in Payroll → Rules):
 * - Per-day rate = monthly salary ÷ basis days (CALENDAR = days in month, WORKING = working days, FIXED_30, FIXED_26).
 * - MONTHLY staff start from the full salary; deductions: absent days, unpaid / over-balance leave, ½ day per
 *   half-day attendance, ½ day per `latesPerHalfDay` late arrivals, days before joining, and weekly offs /
 *   holidays when those are configured as unpaid.
 * - DAILY staff (salary field = rate per day): paid days × rate. HOURLY staff (rate per hour): hours worked × rate.
 * - Overtime pay = OT hours × (per-day rate ÷ shift hours) × multiplier (when enabled).
 * - Gross = base − attendance deductions + overtime + incentives + bonus; Net = gross − salary advances − other deductions.
 */
export function computePayroll(
  salary: number,
  salaryType: SalaryType,
  c: PayrollCounts,
  adj: PayrollAdjustments,
  rules: PayrollRules,
): PayrollResult {
  const notes: string[] = [];
  const earnings: PayrollLine[] = [];
  const deductions: PayrollLine[] = [];
  const shiftHours = c.shiftHours > 0 ? c.shiftHours : 8;

  let basisDays = c.calendarDays;
  if (rules.salaryBasis === "WORKING") basisDays = Math.max(1, c.workingDays);
  if (rules.salaryBasis === "FIXED_30") basisDays = 30;
  if (rules.salaryBasis === "FIXED_26") basisDays = 26;

  let baseSalary: number;
  let perDayRate: number;
  let leaveDeduction = 0,
    halfDayDeduction = 0,
    absentDeduction = 0,
    lateDeduction = 0,
    otherAttendanceDeduction = 0;
  const lateHalfDays = rules.latesPerHalfDay > 0 ? Math.floor(c.lateCount / rules.latesPerHalfDay) : 0;

  if (salaryType === "MONTHLY") {
    baseSalary = salary;
    perDayRate = salary / basisDays;
    earnings.push({ label: "Basic monthly salary", detail: `Rate ${fmt(perDayRate)}/day (${basisDays}-day basis: ${rules.salaryBasis.toLowerCase().replace("_", " ")})`, amount: r2(baseSalary) });
    absentDeduction = c.absentDays * perDayRate;
    leaveDeduction = c.unpaidLeaveDays * perDayRate;
    halfDayDeduction = c.halfDays * 0.5 * perDayRate;
    lateDeduction = lateHalfDays * 0.5 * perDayRate;
    const unpaidOffs = (rules.weeklyOffPaid ? 0 : c.weekOffDays) + (rules.holidaysPaid ? 0 : c.holidayDays);
    otherAttendanceDeduction = (c.notEmployedDays + unpaidOffs) * perDayRate;
    if (c.absentDays) deductions.push({ label: "Absent days", detail: `${c.absentDays} day(s) × ${fmt(perDayRate)}`, amount: r2(absentDeduction) });
    if (c.unpaidLeaveDays) deductions.push({ label: "Unpaid leave", detail: `${c.unpaidLeaveDays} day(s) × ${fmt(perDayRate)}`, amount: r2(leaveDeduction) });
    if (c.halfDays) deductions.push({ label: "Half days", detail: `${c.halfDays} × ½ day × ${fmt(perDayRate)}`, amount: r2(halfDayDeduction) });
    if (lateHalfDays) deductions.push({ label: "Late arrivals", detail: `${c.lateCount} lates → ${lateHalfDays} half day(s) (every ${rules.latesPerHalfDay} lates)`, amount: r2(lateDeduction) });
    if (c.notEmployedDays) deductions.push({ label: "Before joining date", detail: `${c.notEmployedDays} day(s) × ${fmt(perDayRate)}`, amount: r2(c.notEmployedDays * perDayRate) });
    if (unpaidOffs) deductions.push({ label: "Unpaid weekly offs / holidays", detail: `${unpaidOffs} day(s) × ${fmt(perDayRate)}`, amount: r2(unpaidOffs * perDayRate) });
  } else if (salaryType === "DAILY") {
    perDayRate = salary;
    const paidDays = c.presentDays + c.halfDays * 0.5 + c.paidLeaveDays + c.projectedDays + (rules.weeklyOffPaid ? c.weekOffDays : 0) + (rules.holidaysPaid ? c.holidayDays : 0);
    const effective = Math.max(0, paidDays - lateHalfDays * 0.5);
    baseSalary = paidDays * perDayRate;
    earnings.push({ label: "Daily wages", detail: `${paidDays} paid day(s) × ${fmt(perDayRate)}`, amount: r2(baseSalary) });
    lateDeduction = (paidDays - effective) * perDayRate;
    if (lateDeduction) deductions.push({ label: "Late arrivals", detail: `${c.lateCount} lates → ${lateHalfDays} half day(s)`, amount: r2(lateDeduction) });
  } else {
    const hours = c.workMinutes / 60;
    perDayRate = salary * shiftHours;
    baseSalary = hours * salary;
    earnings.push({ label: "Hourly wages", detail: `${r2(hours)} h × ${fmt(salary)}`, amount: r2(baseSalary) });
  }

  let overtimePay = 0;
  if (rules.overtimeEnabled && c.overtimeMinutes > 0 && salaryType !== "HOURLY") {
    const hourly = perDayRate / shiftHours;
    overtimePay = (c.overtimeMinutes / 60) * hourly * rules.overtimeRateMultiplier;
    earnings.push({ label: "Overtime", detail: `${r2(c.overtimeMinutes / 60)} h × ${fmt(hourly)} × ${rules.overtimeRateMultiplier}`, amount: r2(overtimePay) });
  }
  if (adj.incentives) earnings.push({ label: "Incentives", detail: "From payroll adjustments", amount: r2(adj.incentives) });
  if (adj.bonus) earnings.push({ label: "Bonus", detail: "From payroll adjustments", amount: r2(adj.bonus) });
  if (adj.advances) deductions.push({ label: "Salary advance recovery", detail: "From payroll adjustments", amount: r2(adj.advances) });
  if (adj.deductions) deductions.push({ label: "Other deductions", detail: "From payroll adjustments", amount: r2(adj.deductions) });
  if (c.projectedDays) notes.push(`${c.projectedDays} upcoming day(s) in this month are assumed paid — recalculate after month end.`);

  const attendanceDeductions = absentDeduction + leaveDeduction + halfDayDeduction + lateDeduction + otherAttendanceDeduction;
  const grossPay = salaryType === "MONTHLY" ? baseSalary - attendanceDeductions + overtimePay + adj.incentives + adj.bonus : baseSalary - lateDeduction + overtimePay + adj.incentives + adj.bonus;
  const netPay = Math.max(0, grossPay - adj.advances - adj.deductions);
  if (grossPay - adj.advances - adj.deductions < 0) notes.push("Deductions exceed earnings — net pay floored at ₹0. Carry the balance to next month as an adjustment.");

  return {
    baseSalary: r2(baseSalary),
    perDayRate: r2(perDayRate),
    basisDays,
    leaveDeduction: r2(leaveDeduction),
    halfDayDeduction: r2(halfDayDeduction),
    absentDeduction: r2(absentDeduction),
    lateDeduction: r2(lateDeduction),
    otherAttendanceDeduction: r2(otherAttendanceDeduction),
    overtimePay: r2(overtimePay),
    incentives: r2(adj.incentives + adj.bonus),
    advances: r2(adj.advances),
    otherDeductions: r2(adj.deductions + otherAttendanceDeduction),
    grossPay: r2(grossPay),
    netPay: r2(netPay),
    earnings,
    deductions,
    notes,
  };
}

/* ───────────────────────────── DB-backed calculation ───────────────────────────── */

/** Gather day counts for a staff member and month ("YYYY-MM") from attendance, leave and holidays. */
export async function gatherCounts(staffId: string, month: string, tx?: Tx) {
  const client = tx ?? db;
  const staff = await client.staff.findUniqueOrThrow({ where: { id: staffId } });
  const keys = monthKeys(month);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const today = istDateKey();
  const joinKey = istDateKey(staff.joiningDate);
  const rules = await getSetting("payroll");

  const [rows, holidays, leaves] = await Promise.all([
    client.attendance.findMany({ where: { staffId, date: { gte: dbDate(first), lte: dbDate(last) } } }),
    holidayKeys(staff.branchId, first, last, tx),
    client.leaveRequest.findMany({
      where: { staffId, status: "APPROVED", fromDate: { lte: dbDate(last) }, toDate: { gte: dbDate(first) } },
      orderBy: { fromDate: "asc" },
    }),
  ]);
  const byKey = new Map(rows.map((r) => [keyOfDbDate(r.date), r]));

  // Leave portion per day key, by type.
  const leaveByKey = new Map<string, { type: LeaveType; portion: number }>();
  for (const l of leaves) {
    const days = await leaveDayKeys(staff, keyOfDbDate(l.fromDate), keyOfDbDate(l.toDate), tx);
    for (const k of days) if (k >= first && k <= last) leaveByKey.set(k, { type: l.type, portion: l.dayType === "HALF" ? 0.5 : 1 });
  }

  // Remaining paid balance (by type) at the start of this month, for this calendar year.
  const year = Number(month.slice(0, 4));
  const ent = entitlements(rules);
  const usedBefore = await client.leaveRequest.findMany({
    where: { staffId, status: "APPROVED", fromDate: { gte: dbDate(`${year}-01-01`), lt: dbDate(first) } },
    select: { type: true, days: true },
  });
  const remaining: Record<string, number> = { CASUAL: ent.CASUAL, SICK: ent.SICK, PAID: ent.PAID, UNPAID: 0 };
  for (const u of usedBefore) if (u.type !== "UNPAID") remaining[u.type] = Math.max(0, remaining[u.type]! - Number(u.days));

  const c: PayrollCounts = {
    calendarDays: keys.length,
    workingDays: 0,
    presentDays: 0,
    halfDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    weekOffDays: 0,
    holidayDays: 0,
    notEmployedDays: 0,
    projectedDays: 0,
    lateCount: 0,
    overtimeMinutes: 0,
    workMinutes: 0,
    shiftHours: shiftBounds(first, staff).minutes / 60,
  };
  const leaveTaken = (type: LeaveType, portion: number) => {
    if (type === "UNPAID") return void (c.unpaidLeaveDays += portion);
    const paid = Math.min(portion, remaining[type]!);
    remaining[type] = remaining[type]! - paid;
    c.paidLeaveDays += paid;
    c.unpaidLeaveDays += portion - paid;
  };

  for (const k of keys) {
    const row = byKey.get(k);
    if (row) {
      c.lateCount += row.lateMinutes > rules.lateGraceMinutes ? 1 : 0;
      c.overtimeMinutes += row.overtimeMinutes;
      c.workMinutes += row.workMinutes;
    }
    if (k < joinKey) {
      c.notEmployedDays++;
      continue;
    }
    const isHoliday = holidays.has(k);
    const isOff = staff.weeklyOff.includes(weekdayOfKey(k));
    if (isHoliday) {
      c.holidayDays++;
      continue;
    }
    if (isOff) {
      c.weekOffDays++;
      continue;
    }
    c.workingDays++;
    const leave = leaveByKey.get(k);
    const status = row?.status;
    if (status === "PRESENT" && row?.checkIn) {
      c.presentDays++;
    } else if (status === "HALF_DAY") {
      if (leave && leave.portion === 0.5) {
        c.presentDays += 0.5;
        leaveTaken(leave.type, 0.5);
      } else c.halfDays++;
    } else if (leave) {
      if (leave.portion === 0.5) {
        // half-day leave but no attendance for the other half
        leaveTaken(leave.type, 0.5);
        if (k > today) c.projectedDays += 0.5;
        else c.absentDays += 0.5;
      } else leaveTaken(leave.type, 1);
    } else if (status === "LEAVE") {
      leaveTaken("CASUAL", 1); // leave marked manually without a request: counts as casual leave
    } else if (status === "PRESENT") {
      c.presentDays++; // manually marked present without times
    } else if (k > today) {
      c.projectedDays++;
    } else if (k === today && !row) {
      c.projectedDays++;
    } else {
      c.absentDays++;
    }
  }
  return { staff, counts: c, rules };
}

export async function monthAdjustments(staffId: string, month: string, tx?: Tx): Promise<PayrollAdjustments> {
  const rows = await (tx ?? db).payrollAdjustment.findMany({ where: { staffId, month } });
  const sum = (t: AdjustmentType) => rows.filter((r) => r.type === t).reduce((s, r) => s + toNum(r.amount), 0);
  return { incentives: sum("INCENTIVE"), bonus: sum("BONUS"), advances: sum("ADVANCE"), deductions: sum("DEDUCTION") };
}

export async function calculatePayroll(staffId: string, month: string, tx?: Tx) {
  const { staff, counts, rules } = await gatherCounts(staffId, month, tx);
  const adj = await monthAdjustments(staffId, month, tx);
  const result = computePayroll(toNum(staff.monthlySalary), staff.salaryType, counts, adj, rules);
  return { staff, counts, adj, result, rules };
}

/** Create or refresh the DRAFT payroll row. Finalized / paid rows are never overwritten. */
export async function savePayroll(staffId: string, month: string, tx: Tx) {
  const existing = await tx.payroll.findUnique({ where: { staffId_month: { staffId, month } } });
  if (existing && existing.status !== "DRAFT") throw new ActionError(`Payroll for ${month} is already ${existing.status.toLowerCase()}. Reopen it to recalculate.`);
  const { counts: c, result: r, adj, rules } = await calculatePayroll(staffId, month, tx);
  const data = {
    calendarDays: c.calendarDays,
    workingDays: c.workingDays,
    presentDays: c.presentDays,
    halfDays: c.halfDays,
    paidLeaveDays: c.paidLeaveDays,
    unpaidLeaveDays: c.unpaidLeaveDays,
    absentDays: c.absentDays,
    lateCount: c.lateCount,
    overtimeMinutes: c.overtimeMinutes,
    baseSalary: r.baseSalary,
    perDayRate: r.perDayRate,
    leaveDeduction: r.leaveDeduction,
    halfDayDeduction: r.halfDayDeduction,
    absentDeduction: r.absentDeduction,
    lateDeduction: r.lateDeduction,
    overtimePay: r.overtimePay,
    incentives: r.incentives,
    advances: r.advances,
    otherDeductions: r.otherDeductions,
    grossPay: r.grossPay,
    netPay: r.netPay,
    breakdown: {
      counts: c,
      adjustments: adj,
      earnings: r.earnings,
      deductions: r.deductions,
      notes: r.notes,
      basisDays: r.basisDays,
      rules: { salaryBasis: rules.salaryBasis, weeklyOffPaid: rules.weeklyOffPaid, holidaysPaid: rules.holidaysPaid, latesPerHalfDay: rules.latesPerHalfDay, overtimeRateMultiplier: rules.overtimeRateMultiplier },
      calculatedAt: new Date().toISOString(),
    } as unknown as Prisma.InputJsonValue,
  };
  return tx.payroll.upsert({
    where: { staffId_month: { staffId, month } },
    create: { staffId, month, ...data },
    update: data,
  });
}

export function previousMonth(month = istDateKey().slice(0, 7)) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthEndKey(month: string) {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/* ───────────────────────────── Amount in words (Indian system) ───────────────────────────── */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number) {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? twoDigits(rest) : ""].filter(Boolean).join(" ");
}

export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}
