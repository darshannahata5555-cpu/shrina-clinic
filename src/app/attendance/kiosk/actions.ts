"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { db } from "@/lib/db";
import { ActionError, getCurrentUser, signToken } from "@/lib/auth";
import { KIOSK_COOKIE, kioskBranchId } from "./kiosk-lib";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { punch } from "@/lib/attendance";
import { fmtTime } from "@/lib/format";

const MAX_PIN_FAILS = 5;
const LOCK_MINUTES = 15;

export type KioskState = {
  ok: boolean;
  error?: string;
  result?: { kind: "in" | "out" | "already-in"; name: string; time: string; lateMinutes: number; workMinutes: number };
} | null;

async function wrap(fn: () => Promise<KioskState>): Promise<KioskState> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ActionError) return { ok: false, error: e.message };
    console.error("[kiosk]", e);
    return { ok: false, error: "Something went wrong. Please try again or tell the front desk." };
  }
}

/** Register this device as the attendance kiosk of a branch (needs a signed-in user with attendance.manage). */
export async function unlockKioskAction(_: KioskState, fd: FormData): Promise<KioskState> {
  return wrap(async () => {
    const user = await getCurrentUser();
    if (!user || !user.permissions.has("attendance.manage")) throw new ActionError("Only a manager with attendance rights can set up the kiosk.");
    const branchId = String(fd.get("branchId") ?? "");
    const allowed = user.allBranches || branchId === user.branchId || user.extraBranchIds.includes(branchId);
    const branch = allowed ? await db.branch.findFirst({ where: { id: branchId, isActive: true } }) : null;
    if (!branch) throw new ActionError("Choose a branch you have access to.");
    const token = await signToken({ kiosk: branch.id, by: user.id }, "365d");
    (await cookies()).set(KIOSK_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 });
    await audit(user.id, "CREATE", "Kiosk", branch.id, `Set up attendance kiosk device for ${branch.name}`, { branchId: branch.id });
    return { ok: true };
  });
}

export async function lockKioskAction(): Promise<KioskState> {
  return wrap(async () => {
    const user = await getCurrentUser();
    if (!user || !user.permissions.has("attendance.manage")) throw new ActionError("Sign in as a manager on this device to remove the kiosk.");
    const branchId = await kioskBranchId();
    (await cookies()).delete(KIOSK_COOKIE);
    await audit(user.id, "DELETE", "Kiosk", branchId, "Removed attendance kiosk from a device", { branchId });
    return { ok: true };
  });
}

function normaliseCode(raw: string) {
  const t = raw.trim().toUpperCase();
  if (/^\d+$/.test(t)) return `EMP-${t.padStart(3, "0")}`;
  if (/^EMP-?\d+$/.test(t)) return `EMP-${t.replace(/\D/g, "").padStart(3, "0")}`;
  return t;
}

function resultOf(r: Awaited<ReturnType<typeof punch>>): KioskState {
  return { ok: true, result: { kind: r.kind, name: r.staffName, time: fmtTime(r.at), lateMinutes: r.lateMinutes, workMinutes: r.workMinutes } };
}

/**
 * Employee ID + PIN punch. Wrong-PIN protection: after 5 wrong PINs for an employee within
 * 15 minutes, that employee's PIN is locked for the rest of the window. Failures are stored as
 * LOGIN_FAILED audit entries (entity "AttendancePIN"), so the limit survives restarts and is visible
 * in the activity log.
 */
export async function kioskPunchAction(_: KioskState, fd: FormData): Promise<KioskState> {
  return wrap(async () => {
    const branchId = await kioskBranchId();
    if (!branchId) throw new ActionError("This device is no longer set up as a kiosk. Ask a manager to set it up again.");
    const settings = await getSetting("attendance");
    if (!settings.pinEnabled) throw new ActionError("PIN attendance is turned off. Use the QR option.");
    const code = normaliseCode(String(fd.get("code") ?? ""));
    const pin = String(fd.get("pin") ?? "");
    if (!code || !/^\d{4,6}$/.test(pin)) throw new ActionError("Enter your employee ID and 4–6 digit PIN.");

    const staff = await db.staff.findFirst({ where: { code: { equals: code, mode: "insensitive" }, deletedAt: null } });
    if (!staff || !staff.attendancePinHash) throw new ActionError("Employee ID or PIN is incorrect.");

    const fails = await db.auditLog.count({
      where: { action: "LOGIN_FAILED", entity: "AttendancePIN", entityId: staff.id, createdAt: { gte: new Date(Date.now() - LOCK_MINUTES * 60000) } },
    });
    if (fails >= MAX_PIN_FAILS) throw new ActionError(`Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes or ask your manager to mark attendance.`);
    if (!(await bcrypt.compare(pin, staff.attendancePinHash))) {
      await audit(null, "LOGIN_FAILED", "AttendancePIN", staff.id, `Wrong attendance PIN for ${staff.code} at kiosk`, { branchId });
      const left = MAX_PIN_FAILS - fails - 1;
      throw new ActionError(left > 0 ? `Employee ID or PIN is incorrect. ${left} attempt${left === 1 ? "" : "s"} left.` : `PIN locked for ${LOCK_MINUTES} minutes.`);
    }
    const mode = fd.get("mode") === "in" ? "in" : fd.get("mode") === "out" ? "out" : "auto";
    return resultOf(await punch({ staffId: staff.id, mode, method: "PIN", branchId }));
  });
}

/** Punch by scanning an employee's printed QR ID badge with the kiosk camera. */
export async function kioskBadgeAction(_: KioskState, fd: FormData): Promise<KioskState> {
  return wrap(async () => {
    const branchId = await kioskBranchId();
    if (!branchId) throw new ActionError("This device is no longer set up as a kiosk.");
    const settings = await getSetting("attendance");
    if (!settings.qrEnabled) throw new ActionError("QR attendance is turned off.");
    const raw = String(fd.get("badge") ?? "");
    const token = raw.startsWith("SHRINA-ATT:") ? raw.slice("SHRINA-ATT:".length) : "";
    const staff = token ? await db.staff.findFirst({ where: { qrToken: token, deletedAt: null } }) : null;
    if (!staff) throw new ActionError("Badge not recognised. It may have been replaced — use your PIN.");
    return resultOf(await punch({ staffId: staff.id, mode: "auto", method: "QR", branchId }));
  });
}
