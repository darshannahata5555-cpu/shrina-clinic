"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { nextStaffCode } from "@/lib/sequence";

const STAFF_TYPES = ["DOCTOR", "THERAPIST", "RECEPTIONIST", "MANAGER", "ACCOUNTS", "HR_ADMIN", "SUPPORT"] as const;
const time = (label: string) => z.string().regex(/^\d{2}:\d{2}$/, `${label} is required`);

const StaffSchema = z.object({
  id: zf.optId(),
  fullName: zf.text("Full name", 2),
  mobile: zf.mobile(),
  email: zf.optEmail(),
  designation: zf.text("Designation"),
  department: zf.text("Department"),
  staffType: zf.enumOf(STAFF_TYPES, "Staff type"),
  joiningDate: zf.date("Joining date"),
  branchId: zf.optId(),
  monthlySalary: zf.num("Salary").pipe(z.number().min(0, "Salary can't be negative")),
  salaryType: zf.enumOf(["MONTHLY", "DAILY", "HOURLY"] as const, "Salary type"),
  shiftStart: time("Shift start"),
  shiftEnd: time("Shift end"),
  bankName: zf.optText(),
  bankAccount: zf.optText(),
  ifsc: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC looks wrong (e.g. HDFC0001234)").optional()).transform((v) => v ?? null),
  upiId: zf.optText(),
  emergencyName: zf.optText(),
  emergencyPhone: zf.optText(),
  status: zf.enumOf(["ACTIVE", "ON_NOTICE", "RESIGNED", "TERMINATED"] as const, "Status"),
});

const SENSITIVE = ["bankAccount", "ifsc", "upiId", "monthlySalary"];

export async function saveStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("staff.manage");
    const { id, branchId: formBranch, ...data } = parse(StaffSchema, formObject(fd));
    const weeklyOff = fd
      .getAll("weeklyOff")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    const branchId = await resolveWriteBranch(formBranch);

    if (id) {
      const before = await db.staff.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new ActionError("Employee not found.");
      await assertBranchAccess(user, before.branchId);
      const after = await db.staff.update({ where: { id }, data: { ...data, branchId, weeklyOff } });
      const changes = diff(before, after, [...Object.keys(data), "branchId", "weeklyOff"]);
      for (const k of SENSITIVE) if (changes[k]) changes[k] = ["•••", "changed"];
      await audit(user.id, "UPDATE", "Staff", id, `Updated employee ${after.fullName} (${after.code})`, { changes, branchId });
      return { ok: true, message: "Employee updated", id };
    }

    const created = await db.$transaction(async (tx) => {
      const s = await tx.staff.create({
        data: { ...data, branchId, weeklyOff, code: await nextStaffCode(tx), qrToken: `qr_${randomBytes(9).toString("base64url")}` },
      });
      await audit(user.id, "CREATE", "Staff", s.id, `Added employee ${s.fullName} (${s.code}) — ${s.designation}`, { branchId, tx });
      return s;
    });
    redirect(`/staff/${created.id}?created=1`);
  });
}

export async function setPinAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission(["staff.manage", "attendance.manage"]);
    const { id, pin } = parse(
      z.object({
        id: zf.id(),
        pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
        confirm: z.string(),
      }).refine((v) => v.pin === v.confirm, { message: "PINs don't match", path: ["confirm"] }),
      formObject(fd),
    );
    if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin))
      throw new ActionError("Choose a less guessable PIN (not repeated or sequential digits).");
    const s = await db.staff.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new ActionError("Employee not found.");
    await assertBranchAccess(user, s.branchId);
    await db.staff.update({ where: { id }, data: { attendancePinHash: await bcrypt.hash(pin, 8) } });
    await audit(user.id, "UPDATE", "Staff", id, `Set attendance PIN for ${s.fullName}`, { branchId: s.branchId });
    return { ok: true, message: "Attendance PIN saved" };
  });
}

export async function regenerateQrAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission(["staff.manage", "attendance.manage"]);
    const id = String(fd.get("id"));
    const s = await db.staff.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new ActionError("Employee not found.");
    await assertBranchAccess(user, s.branchId);
    await db.staff.update({ where: { id }, data: { qrToken: `qr_${randomBytes(9).toString("base64url")}` } });
    await audit(user.id, "UPDATE", "Staff", id, `Regenerated attendance QR badge for ${s.fullName} (old badge no longer works)`, { branchId: s.branchId });
    return { ok: true, message: "New QR badge generated — print and replace the old one" };
  });
}

export async function archiveStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("staff.manage");
    const id = String(fd.get("id"));
    const s = await db.staff.findFirst({ where: { id, deletedAt: null }, include: { user: true } });
    if (!s) throw new ActionError("Employee not found.");
    await assertBranchAccess(user, s.branchId);
    if (s.user?.isActive) throw new ActionError("This employee still has an active login. Disable it in Settings → Users first.");
    await db.staff.update({ where: { id }, data: { deletedAt: new Date(), status: s.status === "ACTIVE" ? "RESIGNED" : s.status } });
    await audit(user.id, "DELETE", "Staff", id, `Archived employee ${s.fullName} (${s.code})`, { branchId: s.branchId });
    redirect("/staff");
  });
}
