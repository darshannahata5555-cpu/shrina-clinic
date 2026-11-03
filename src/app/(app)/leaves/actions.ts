"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError, getCurrentUser } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { addDaysKey, dbDate, istDateKey } from "@/lib/format";
import { LEAVE_TYPES, keyOfDbDate, leaveBalances, leaveDayKeys, leaveDaysFor } from "@/lib/attendance";

const typeLabel = (t: string) => LEAVE_TYPES.find((x) => x[0] === t)?.[1] ?? t;
const LEAVE_NOTE = "Leave:";

export async function requestLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired. Please sign in again.");
    const v = parse(
      z.object({
        staffId: zf.optId(),
        type: zf.enumOf(["CASUAL", "SICK", "PAID", "UNPAID"] as const, "Leave type"),
        dayType: zf.enumOf(["FULL", "HALF"] as const, "Day type"),
        fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required"),
        toDate: z.preprocess((x) => (x === "" ? undefined : x), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
        reason: zf.text("Reason", 3),
      }),
      formObject(fd),
    );

    // Self-service by default; approvers may file on behalf of someone in their branches.
    const forOther = v.staffId && v.staffId !== user.staff?.id;
    if (forOther && !user.permissions.has("leaves.approve")) throw new ActionError("You can only request leave for yourself.");
    const staffId = forOther ? v.staffId! : user.staff?.id;
    if (!staffId) throw new ActionError("Your login isn't linked to an employee profile. Ask HR to link it.");
    const staff = await db.staff.findFirst({ where: { id: staffId, deletedAt: null } });
    if (!staff) throw new ActionError("Employee not found.");
    if (forOther) await assertBranchAccess(user, staff.branchId);

    const from = v.fromDate;
    const to = v.dayType === "HALF" ? from : (v.toDate ?? from);
    if (to < from) throw new ActionError("End date is before the start date.");
    if (from < addDaysKey(istDateKey(), -30)) throw new ActionError("Leave can be applied at most 30 days back. Ask HR to correct older attendance.");
    if (to > addDaysKey(from, 60)) throw new ActionError("A single request can cover at most 60 days.");
    if (from.slice(0, 4) !== to.slice(0, 4)) throw new ActionError("Split leave that crosses the new year into two requests.");

    const keys = await leaveDayKeys(staff, from, to);
    if (!keys.length) throw new ActionError("Those dates are all weekly offs or holidays — no leave needed.");
    const days = leaveDaysFor(v.dayType, keys);

    const overlap = await db.leaveRequest.findFirst({
      where: { staffId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: dbDate(to) }, toDate: { gte: dbDate(from) } },
    });
    if (overlap) throw new ActionError(`There's already a ${overlap.status.toLowerCase()} leave request overlapping these dates.`);

    if (v.type !== "UNPAID") {
      const bal = (await leaveBalances(staffId, Number(from.slice(0, 4)))).find((b) => b.type === v.type)!;
      const pending = await db.leaveRequest.aggregate({ where: { staffId, type: v.type, status: "PENDING", fromDate: { gte: dbDate(`${from.slice(0, 4)}-01-01`) } }, _sum: { days: true } });
      const available = (bal.remaining ?? 0) - Number(pending._sum.days ?? 0);
      if (days > available)
        throw new ActionError(`Only ${Math.max(0, available)} day(s) of ${typeLabel(v.type).toLowerCase()} available (including pending requests). Apply the rest as unpaid leave.`);
    }

    const req = await db.leaveRequest.create({
      data: { staffId, type: v.type, dayType: v.dayType, fromDate: dbDate(from), toDate: dbDate(to), days, reason: v.reason },
    });
    await audit(user.id, "CREATE", "LeaveRequest", req.id, `${forOther ? `Filed leave for ${staff.fullName}` : `${staff.fullName} requested leave`}: ${typeLabel(v.type)}, ${days} day(s) from ${from}`, { branchId: staff.branchId });
    await notifyUsers({ permission: "leaves.approve", branchId: staff.branchId, title: "New leave request", body: `${staff.fullName} — ${typeLabel(v.type)}, ${days} day(s) from ${from}`, link: "/leaves" });
    return { ok: true, message: `Leave request sent (${days} day${days === 1 ? "" : "s"})` };
  });
}

export async function reviewLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leaves.approve");
    const v = parse(z.object({ id: zf.id(), decision: zf.enumOf(["APPROVED", "REJECTED"] as const, "Decision"), note: zf.optText() }), formObject(fd));
    const req = await db.leaveRequest.findUnique({ where: { id: v.id }, include: { staff: true } });
    if (!req) throw new ActionError("Leave request not found.");
    await assertBranchAccess(user, req.staff.branchId);
    if (req.status !== "PENDING") throw new ActionError(`This request is already ${req.status.toLowerCase()}.`);
    if (user.staff?.id === req.staffId) throw new ActionError("You can't approve your own leave. Another approver must review it.");
    if (v.decision === "REJECTED" && !v.note) throw new ActionError("Please add a short reason for rejecting.");

    const from = keyOfDbDate(req.fromDate);
    const to = keyOfDbDate(req.toDate);
    await db.$transaction(async (tx) => {
      await tx.leaveRequest.update({ where: { id: req.id }, data: { status: v.decision, reviewedById: user.id, reviewedAt: new Date(), reviewNote: v.note } });
      if (v.decision === "APPROVED") {
        const keys = await leaveDayKeys(req.staff, from, to, tx);
        for (const k of keys) {
          const existing = await tx.attendance.findUnique({ where: { staffId_date: { staffId: req.staffId, date: dbDate(k) } } });
          if (existing?.checkIn) continue; // already worked that day — keep the real record
          const data = {
            status: req.dayType === "HALF" ? ("HALF_DAY" as const) : ("LEAVE" as const),
            method: "MANUAL" as const,
            notes: `${LEAVE_NOTE} ${typeLabel(req.type)} (approved)`,
            markedById: user.id,
            workMinutes: 0,
            lateMinutes: 0,
            earlyMinutes: 0,
            overtimeMinutes: 0,
          };
          await tx.attendance.upsert({
            where: { staffId_date: { staffId: req.staffId, date: dbDate(k) } },
            create: { staffId: req.staffId, branchId: req.staff.branchId, date: dbDate(k), ...data },
            update: data,
          });
        }
      }
      await audit(user.id, v.decision === "APPROVED" ? "APPROVE" : "REJECT", "LeaveRequest", req.id, `${v.decision === "APPROVED" ? "Approved" : "Rejected"} ${req.staff.fullName}'s ${typeLabel(req.type).toLowerCase()} (${Number(req.days)} day(s) from ${from})${v.note ? ` — ${v.note}` : ""}`, { branchId: req.staff.branchId, tx });
    });

    const requester = await db.user.findFirst({ where: { staffId: req.staffId, isActive: true }, select: { id: true } });
    if (requester)
      await notifyUsers({ userIds: [requester.id], title: `Leave ${v.decision === "APPROVED" ? "approved" : "rejected"}`, body: `${typeLabel(req.type)} from ${from}${to !== from ? ` to ${to}` : ""}${v.note ? ` — ${v.note}` : ""}`, link: "/leaves" });
    return { ok: true, message: v.decision === "APPROVED" ? "Leave approved and attendance updated" : "Leave rejected" };
  });
}

/** Requester cancels their pending request; approvers can also cancel an approved leave (attendance is reverted). */
export async function cancelLeaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired.");
    const req = await db.leaveRequest.findUnique({ where: { id: String(fd.get("id")) }, include: { staff: true } });
    if (!req) throw new ActionError("Leave request not found.");
    const own = user.staff?.id === req.staffId;
    const approver = user.permissions.has("leaves.approve");
    if (req.status === "PENDING" && !own && !approver) throw new ActionError("You can only cancel your own requests.");
    if (req.status === "APPROVED" && !approver) throw new ActionError("Approved leave can only be cancelled by HR or your manager.");
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw new ActionError(`This request is already ${req.status.toLowerCase()}.`);
    if (!own) await assertBranchAccess(user, req.staff.branchId);

    await db.$transaction(async (tx) => {
      await tx.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED", reviewedById: req.status === "APPROVED" ? user.id : req.reviewedById, reviewedAt: req.status === "APPROVED" ? new Date() : req.reviewedAt } });
      if (req.status === "APPROVED") {
        await tx.attendance.deleteMany({
          where: { staffId: req.staffId, date: { gte: req.fromDate, lte: req.toDate }, checkIn: null, notes: { startsWith: LEAVE_NOTE } },
        });
      }
      await audit(user.id, "CANCEL", "LeaveRequest", req.id, `Cancelled ${req.status.toLowerCase()} leave of ${req.staff.fullName} (${keyOfDbDate(req.fromDate)})`, { branchId: req.staff.branchId, tx });
    });
    return { ok: true, message: "Leave request cancelled" };
  });
}
