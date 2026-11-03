"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError, getCurrentUser, verifyToken } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { dbDate, fromIst, istDateKey } from "@/lib/format";
import { computeAttendance, haversineMeters, punch } from "@/lib/attendance";

const STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "WEEK_OFF", "HOLIDAY"] as const;
const optTime = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{2}:\d{2}$/).optional());

/** Manual attendance entry / correction (attendance.manage). */
export async function saveAttendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("attendance.manage");
    const v = parse(
      z.object({
        staffId: zf.id("Employee"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
        status: zf.enumOf(STATUSES, "Status"),
        checkIn: optTime,
        checkOut: optTime,
        notes: zf.optText(),
      }),
      formObject(fd),
    );
    if (v.date > istDateKey()) throw new ActionError("You can't mark attendance for a future date.");
    const staff = await db.staff.findFirst({ where: { id: v.staffId, deletedAt: null } });
    if (!staff) throw new ActionError("Employee not found.");
    await assertBranchAccess(user, staff.branchId);

    const worked = v.status === "PRESENT" || v.status === "HALF_DAY";
    const checkIn = worked && v.checkIn ? fromIst(v.date, v.checkIn) : null;
    let checkOut = worked && v.checkOut ? fromIst(v.date, v.checkOut) : null;
    if (checkOut && !checkIn) throw new ActionError("Enter a check-in time before the check-out time.");
    if (checkIn && checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86400000); // past midnight
    const rules = await getSetting("payroll");
    const m = checkIn ? computeAttendance(v.date, checkIn, checkOut, staff, rules) : { workMinutes: 0, lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0 };

    const key = { staffId_date: { staffId: staff.id, date: dbDate(v.date) } };
    const before = await db.attendance.findUnique({ where: key });
    const data = {
      branchId: before?.branchId ?? staff.branchId,
      status: v.status,
      checkIn,
      checkOut,
      workMinutes: m.workMinutes,
      lateMinutes: m.lateMinutes,
      earlyMinutes: m.earlyMinutes,
      overtimeMinutes: m.overtimeMinutes,
      method: "MANUAL" as const,
      notes: v.notes,
      markedById: user.id,
    };
    const after = await db.attendance.upsert({ where: key, create: { staffId: staff.id, date: dbDate(v.date), ...data }, update: data });
    await audit(user.id, before ? "UPDATE" : "CREATE", "Attendance", after.id, `${before ? "Corrected" : "Marked"} attendance for ${staff.fullName} on ${v.date}: ${v.status.replace("_", " ").toLowerCase()}${v.notes ? ` — ${v.notes}` : ""}`, {
      branchId: data.branchId,
      changes: before ? diff(before, after, ["status", "checkIn", "checkOut", "lateMinutes", "overtimeMinutes", "notes"]) : undefined,
    });
    return { ok: true, message: "Attendance saved" };
  });
}

export async function clearAttendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("attendance.manage");
    const id = String(fd.get("id"));
    const row = await db.attendance.findUnique({ where: { id }, include: { staff: { select: { fullName: true } } } });
    if (!row) throw new ActionError("Record not found.");
    await assertBranchAccess(user, row.branchId);
    await db.attendance.delete({ where: { id } });
    await audit(user.id, "DELETE", "Attendance", id, `Cleared attendance for ${row.staff.fullName} on ${row.date.toISOString().slice(0, 10)} (was ${row.status})`, {
      branchId: row.branchId,
      changes: { status: row.status, checkIn: row.checkIn, checkOut: row.checkOut },
    });
    return { ok: true, message: "Record cleared" };
  });
}

/* ───────────── Holidays ───────────── */

export async function addHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("attendance.manage");
    const v = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"), name: zf.text("Holiday name"), branchId: zf.optId() }), formObject(fd));
    if (v.branchId) await assertBranchAccess(user, v.branchId);
    else if (!user.allBranches) throw new ActionError("Only users with access to all branches can add clinic-wide holidays.");
    const exists = await db.holiday.findFirst({ where: { date: dbDate(v.date), branchId: v.branchId } });
    if (exists) throw new ActionError("A holiday already exists on that date.");
    const h = await db.holiday.create({ data: { date: dbDate(v.date), name: v.name, branchId: v.branchId } });
    await audit(user.id, "CREATE", "Holiday", h.id, `Added holiday ${v.name} on ${v.date}`, { branchId: v.branchId });
    return { ok: true, message: "Holiday added" };
  });
}

export async function deleteHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("attendance.manage");
    const h = await db.holiday.findUnique({ where: { id: String(fd.get("id")) } });
    if (!h) throw new ActionError("Holiday not found.");
    if (h.branchId) await assertBranchAccess(user, h.branchId);
    else if (!user.allBranches) throw new ActionError("Only users with access to all branches can remove clinic-wide holidays.");
    await db.holiday.delete({ where: { id: h.id } });
    await audit(user.id, "DELETE", "Holiday", h.id, `Removed holiday ${h.name} (${h.date.toISOString().slice(0, 10)})`, { branchId: h.branchId });
    return { ok: true, message: "Holiday removed" };
  });
}

/* ───────────── Self service (mobile / QR) ───────────── */

async function myStaff() {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  if (!user.staff) throw new ActionError("Your login isn't linked to an employee profile. Ask HR to link it.");
  return user;
}

/** Mobile check-in/out from the employee's own phone, with optional GPS verification. */
export async function selfPunchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await myStaff();
    const settings = await getSetting("attendance");
    if (!settings.mobileEnabled) throw new ActionError("Mobile check-in is turned off. Please use the kiosk at reception.");
    const mode = fd.get("mode") === "out" ? "out" : "in";
    const lat = fd.get("lat") ? Number(fd.get("lat")) : null;
    const lng = fd.get("lng") ? Number(fd.get("lng")) : null;
    const staff = await db.staff.findUniqueOrThrow({ where: { id: user.staff!.id } });

    if (settings.gpsRequired) {
      const centre = settings.branchLocations[staff.branchId];
      if (!centre) throw new ActionError("GPS check-in is required but your branch location isn't set up yet. Ask the admin to add it in Branch Management.");
      if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng))
        throw new ActionError("We need your location to check you in. Allow location access and try again.");
      const d = haversineMeters({ lat, lng }, centre);
      if (d > settings.gpsRadiusMeters) throw new ActionError(`You appear to be ${Math.round(d)} m from the clinic. Check-in is allowed within ${settings.gpsRadiusMeters} m.`);
    }

    const r = await punch({ staffId: staff.id, mode, method: "MOBILE", lat, lng, actorUserId: user.id });
    if (r.kind === "already-in") return { ok: true, message: "You're already checked in today." };
    return {
      ok: true,
      message: r.kind === "in" ? `Checked in${r.lateMinutes ? ` — ${r.lateMinutes} min late` : ""}. Have a great day!` : `Checked out after ${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m. See you tomorrow!`,
    };
  });
}

/** Check-in/out by scanning the rotating QR shown on the reception kiosk. */
export async function qrPunchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await myStaff();
    const settings = await getSetting("attendance");
    if (!settings.qrEnabled) throw new ActionError("QR attendance is turned off.");
    const token = await verifyToken<{ qr?: string }>(String(fd.get("k") ?? ""));
    if (!token?.qr) throw new ActionError("This QR code has expired. Scan the code on the kiosk again.");
    const r = await punch({ staffId: user.staff!.id, mode: "auto", method: "QR", branchId: token.qr, actorUserId: user.id });
    return {
      ok: true,
      message: r.kind === "in" ? `Checked in at the kiosk${r.lateMinutes ? ` — ${r.lateMinutes} min late` : ""}.` : r.kind === "out" ? `Checked out after ${Math.floor(r.workMinutes / 60)}h ${r.workMinutes % 60}m.` : "Already checked in.",
    };
  });
}
