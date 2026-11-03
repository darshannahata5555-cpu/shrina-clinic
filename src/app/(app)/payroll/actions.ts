"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { assertBranchAccess, getBranchScope } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { getSetting, saveSetting } from "@/lib/settings";
import { nextExpenseCode } from "@/lib/sequence";
import { fromIst, istDateKey, money, toNum } from "@/lib/format";
import { monthEndKey, savePayroll } from "@/lib/payroll";

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Choose a month");

function assertMonthRunnable(month: string) {
  if (month > istDateKey().slice(0, 7)) throw new ActionError("You can't run payroll for a future month.");
}

/** Calculate / recalculate DRAFT payroll for every active employee in scope (finalized rows are skipped). */
export async function runPayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const month = parse(monthSchema, String(fd.get("month") ?? ""));
    assertMonthRunnable(month);
    const scope = await getBranchScope();
    const staff = await db.staff.findMany({
      where: {
        deletedAt: null,
        branchId: { in: scope.ids },
        joiningDate: { lte: fromIst(monthEndKey(month), "23:59") },
        OR: [{ status: { in: ["ACTIVE", "ON_NOTICE"] } }, { payrolls: { some: { month } } }],
      },
      select: { id: true },
    });
    const locked = await db.payroll.findMany({ where: { month, staffId: { in: staff.map((s) => s.id) }, status: { not: "DRAFT" } }, select: { staffId: true } });
    const lockedIds = new Set(locked.map((l) => l.staffId));
    let n = 0;
    for (const s of staff) {
      if (lockedIds.has(s.id)) continue;
      await db.$transaction((tx) => savePayroll(s.id, month, tx), { timeout: 20000 });
      n++;
    }
    await audit(user.id, "UPDATE", "Payroll", null, `Calculated payroll for ${month}: ${n} employee(s)${lockedIds.size ? `, ${lockedIds.size} already finalized` : ""}`, { branchId: scope.current?.id });
    return { ok: true, message: `Payroll calculated for ${n} employee${n === 1 ? "" : "s"}${lockedIds.size ? ` (${lockedIds.size} finalized skipped)` : ""}` };
  });
}

async function loadPayroll(id: string) {
  const p = await db.payroll.findUnique({ where: { id }, include: { staff: true } });
  if (!p) throw new ActionError("Payroll record not found.");
  return p;
}

export async function recalcOneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const p = await loadPayroll(String(fd.get("id")));
    await assertBranchAccess(user, p.staff.branchId);
    await db.$transaction((tx) => savePayroll(p.staffId, p.month, tx));
    await audit(user.id, "UPDATE", "Payroll", p.id, `Recalculated ${p.staff.fullName}'s payroll for ${p.month}`, { branchId: p.staff.branchId });
    return { ok: true, message: "Recalculated" };
  });
}

export async function finalizePayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const id = fd.get("id") ? String(fd.get("id")) : null;
    if (id) {
      const p = await loadPayroll(id);
      await assertBranchAccess(user, p.staff.branchId);
      if (p.status !== "DRAFT") throw new ActionError("Only draft payroll can be finalized.");
      await db.payroll.update({ where: { id }, data: { status: "FINALIZED" } });
      await audit(user.id, "APPROVE", "Payroll", id, `Finalized ${p.staff.fullName}'s payroll for ${p.month}: net ${money(p.netPay)}`, { branchId: p.staff.branchId });
      return { ok: true, message: "Payroll finalized" };
    }
    const month = parse(monthSchema, String(fd.get("month") ?? ""));
    const scope = await getBranchScope();
    const r = await db.payroll.updateMany({ where: { month, status: "DRAFT", staff: { branchId: { in: scope.ids } } }, data: { status: "FINALIZED" } });
    await audit(user.id, "APPROVE", "Payroll", null, `Finalized ${r.count} payroll record(s) for ${month}`, { branchId: scope.current?.id });
    return { ok: true, message: `${r.count} record${r.count === 1 ? "" : "s"} finalized` };
  });
}

export async function reopenPayrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const p = await loadPayroll(String(fd.get("id")));
    await assertBranchAccess(user, p.staff.branchId);
    if (p.status !== "FINALIZED") throw new ActionError(p.status === "PAID" ? "Paid payroll can't be reopened." : "Payroll is already a draft.");
    await db.payroll.update({ where: { id: p.id }, data: { status: "DRAFT" } });
    await audit(user.id, "STATUS", "Payroll", p.id, `Reopened ${p.staff.fullName}'s payroll for ${p.month} for corrections`, { branchId: p.staff.branchId });
    return { ok: true, message: "Payroll reopened as draft" };
  });
}

export async function markPaidAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const v = parse(
      z.object({
        id: zf.id(),
        method: zf.enumOf(["BANK_TRANSFER", "UPI", "CASH"] as const, "Payment method"),
        paymentRef: zf.optText(),
        paidOn: zf.date("Payment date"),
        recordExpense: zf.bool(),
      }),
      formObject(fd),
    );
    const p = await loadPayroll(v.id);
    await assertBranchAccess(user, p.staff.branchId);
    if (p.status === "PAID") throw new ActionError("Already marked as paid.");
    if (p.status === "DRAFT") throw new ActionError("Finalize the payroll before marking it paid.");
    await db.$transaction(async (tx) => {
      await tx.payroll.update({ where: { id: p.id }, data: { status: "PAID", paidAt: v.paidOn, paymentMethod: v.method, paymentRef: v.paymentRef } });
      if (v.recordExpense && toNum(p.netPay) > 0) {
        await tx.expense.create({
          data: {
            code: await nextExpenseCode(tx),
            branchId: p.staff.branchId,
            date: v.paidOn,
            category: "SALARIES",
            amount: p.netPay,
            paidTo: `${p.staff.fullName} (${p.staff.code})`,
            method: v.method,
            description: `Salary for ${p.month}${v.paymentRef ? ` · ref ${v.paymentRef}` : ""}`,
            addedById: user.id,
            approvedById: user.id,
            approvedAt: new Date(),
            status: "APPROVED",
          },
        });
      }
      await audit(user.id, "PAYMENT", "Payroll", p.id, `Paid ${p.staff.fullName}'s salary for ${p.month}: ${money(p.netPay)} by ${v.method.replace("_", " ").toLowerCase()}${v.recordExpense ? " (expense recorded)" : ""}`, { branchId: p.staff.branchId, tx });
    });
    return { ok: true, message: "Marked as paid" };
  });
}

/* ───────────── Adjustments (advance, incentive, bonus, deduction) ───────────── */

export async function addAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const v = parse(
      z.object({
        staffId: zf.id("Employee"),
        month: monthSchema,
        type: zf.enumOf(["ADVANCE", "INCENTIVE", "BONUS", "DEDUCTION"] as const, "Type"),
        amount: zf.num("Amount").pipe(z.number().positive("Amount must be more than 0")),
        note: zf.text("Note"),
      }),
      formObject(fd),
    );
    const staff = await db.staff.findFirst({ where: { id: v.staffId, deletedAt: null } });
    if (!staff) throw new ActionError("Employee not found.");
    await assertBranchAccess(user, staff.branchId);
    const existing = await db.payroll.findUnique({ where: { staffId_month: { staffId: v.staffId, month: v.month } } });
    if (existing && existing.status !== "DRAFT") throw new ActionError(`${staff.fullName}'s payroll for ${v.month} is ${existing.status.toLowerCase()}. Reopen it first, or add this to next month.`);
    await db.$transaction(async (tx) => {
      const a = await tx.payrollAdjustment.create({ data: { staffId: v.staffId, month: v.month, type: v.type, amount: v.amount, note: v.note, createdById: user.id } });
      if (existing) await savePayroll(v.staffId, v.month, tx);
      await audit(user.id, "CREATE", "PayrollAdjustment", a.id, `Added ${v.type.toLowerCase()} of ${money(v.amount)} for ${staff.fullName} (${v.month}) — ${v.note}`, { branchId: staff.branchId, tx });
    });
    return { ok: true, message: "Adjustment added" };
  });
}

export async function deleteAdjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("payroll.manage");
    const a = await db.payrollAdjustment.findUnique({ where: { id: String(fd.get("id")) }, include: { staff: true } });
    if (!a) throw new ActionError("Adjustment not found.");
    await assertBranchAccess(user, a.staff.branchId);
    const p = await db.payroll.findUnique({ where: { staffId_month: { staffId: a.staffId, month: a.month } } });
    if (p && p.status !== "DRAFT") throw new ActionError("Payroll for that month is finalized — reopen it first.");
    await db.$transaction(async (tx) => {
      await tx.payrollAdjustment.delete({ where: { id: a.id } });
      if (p) await savePayroll(a.staffId, a.month, tx);
      await audit(user.id, "DELETE", "PayrollAdjustment", a.id, `Removed ${a.type.toLowerCase()} of ${money(a.amount)} for ${a.staff.fullName} (${a.month})`, { branchId: a.staff.branchId, tx, changes: { note: a.note } });
    });
    return { ok: true, message: "Adjustment removed" };
  });
}

/* ───────────── Rules (owner-configurable) ───────────── */

const n = (label: string, min = 0, max = 1000) => zf.num(label).pipe(z.number().min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`));

export async function saveRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission(["settings.manage", "payroll.manage"]);
    const o = formObject(fd);
    const payroll = parse(
      z.object({
        salaryBasis: zf.enumOf(["CALENDAR", "WORKING", "FIXED_30", "FIXED_26"] as const, "Salary basis"),
        weeklyOffPaid: zf.bool(),
        holidaysPaid: zf.bool(),
        lateGraceMinutes: n("Grace minutes", 0, 120),
        latesPerHalfDay: n("Lates per half day", 0, 31),
        halfDayMinHours: n("Half-day hours", 0, 12),
        fullDayMinHours: n("Full-day hours", 0, 16),
        overtimeEnabled: zf.bool(),
        overtimeMinMinutes: n("Minimum overtime", 0, 600),
        overtimeRateMultiplier: n("Overtime multiplier", 0, 5),
        paidLeavesPerYear: n("Paid leaves", 0, 60),
        sickLeavesPerYear: n("Sick leaves", 0, 60),
        casualLeavesPerYear: n("Casual leaves", 0, 60),
      }),
      o,
    );
    if (payroll.halfDayMinHours > payroll.fullDayMinHours) throw new ActionError("Half-day hours must be less than full-day hours.");
    const attendance = parse(
      z.object({ pinEnabled: zf.bool(), qrEnabled: zf.bool(), mobileEnabled: zf.bool(), gpsRequired: zf.bool(), gpsRadiusMeters: n("GPS radius", 20, 5000) }),
      o,
    );
    if (!attendance.pinEnabled && !attendance.qrEnabled && !attendance.mobileEnabled) throw new ActionError("Keep at least one attendance method switched on.");
    const beforeP = await getSetting("payroll");
    const beforeA = await getSetting("attendance");
    await saveSetting("payroll", payroll);
    await saveSetting("attendance", attendance);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(payroll)) if ((beforeP as Record<string, unknown>)[k] !== v) changes[k] = [(beforeP as Record<string, unknown>)[k], v];
    for (const [k, v] of Object.entries(attendance)) if ((beforeA as Record<string, unknown>)[k] !== v) changes[k] = [(beforeA as Record<string, unknown>)[k], v];
    await audit(user.id, "UPDATE", "Setting", "payroll", `Updated payroll & attendance rules (${Object.keys(changes).length} change(s))`, { changes });
    return { ok: true, message: "Rules saved — recalculate draft payroll to apply them" };
  });
}
