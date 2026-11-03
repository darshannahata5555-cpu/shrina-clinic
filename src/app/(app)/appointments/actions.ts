"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { AppointmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionError, assertPermission, getCurrentUser } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { FieldError, formObject, handle, parse, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { fmtDate, fmtTime, fromIst, istDateKey } from "@/lib/format";
import { completeSession, remainingSessions, syncPackageProgress } from "@/lib/packages";
import { NEXT_STATUS, conflictMessage, findConflicts, outsideBranchHours, scheduledSessionCount } from "@/lib/appointments";

const SOURCES = ["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "OTHER"] as const;

const AppointmentSchema = z.object({
  id: zf.optId(),
  patientId: zf.id("Patient"),
  branchId: zf.optId(),
  treatmentId: zf.optId(),
  packageId: zf.optId(),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time is required"),
  duration: zf.int("Duration").pipe(z.number().min(5, "Minimum 5 minutes").max(600, "Maximum 10 hours")),
  source: zf.enumOf(SOURCES, "Booking source"),
  notes: zf.optText(),
  confirmed: zf.bool(),
  override: zf.bool(),
});

/** Active packages (with sessions left) for a patient — used by the booking form when the patient changes. */
export async function patientPackagesAction(patientId: string) {
  const user = await getCurrentUser();
  if (!user || !user.permissions.has("appointments.view")) return [];
  const rows = await db.treatmentPackage.findMany({
    where: { patientId, deletedAt: null, status: "ACTIVE" },
    include: { treatment: { select: { name: true, durationMins: true } } },
    orderBy: { purchaseDate: "desc" },
  });
  return rows
    .filter((p) => remainingSessions(p) > 0)
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      treatmentId: p.treatmentId,
      durationMins: p.treatment.durationMins,
      doctorId: p.doctorId,
      therapistId: p.therapistId,
      branchId: p.branchId,
      remaining: remainingSessions(p),
      total: p.totalSessions,
      expiryDate: p.expiryDate ? fmtDate(p.expiryDate) : null,
    }));
}

/** Create or edit an appointment (with doctor/therapist double-booking protection). */
export async function saveAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string | null = null;
  const result = await handle(async () => {
    const user = await assertPermission("appointments.manage");
    const v = parse(AppointmentSchema, formObject(fd));
    const startAt = fromIst(v.date, v.time);
    const endAt = new Date(startAt.getTime() + v.duration * 60000);

    const existing = v.id
      ? await db.appointment.findFirst({ where: { id: v.id, deletedAt: null }, include: { session: true } })
      : null;
    if (v.id && !existing) throw new ActionError("Appointment not found.");
    if (existing) {
      await assertBranchAccess(user, existing.branchId);
      if (["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(existing.status))
        throw new ActionError("Completed, cancelled or rescheduled appointments can't be edited.");
    }
    const branchId = await resolveWriteBranch(v.branchId ?? existing?.branchId);
    const branch = await db.branch.findUniqueOrThrow({ where: { id: branchId } });

    const patient = await db.patient.findFirst({ where: { id: v.patientId, deletedAt: null }, select: { id: true, fullName: true } });
    if (!patient) throw new FieldError({ patientId: "Choose a patient" });

    // Package checks (new bookings only — a booked appointment keeps its package)
    const packageId = existing ? existing.packageId : v.packageId;
    let pkg = null;
    if (packageId) {
      pkg = await db.treatmentPackage.findFirst({ where: { id: packageId, deletedAt: null } });
      if (!pkg || pkg.patientId !== patient.id) throw new FieldError({ packageId: "This package doesn't belong to the patient" });
      if (!existing) {
        if (pkg.status !== "ACTIVE") throw new FieldError({ packageId: `This package is ${pkg.status.toLowerCase()}` });
        const remaining = remainingSessions(pkg);
        if (remaining <= 0) throw new FieldError({ packageId: "No sessions left in this package — renew it first" });
        const planned = await scheduledSessionCount(pkg.id);
        if (planned >= remaining)
          throw new FieldError({ packageId: `All ${remaining} remaining session(s) are already scheduled. Reschedule an existing session instead.` });
      }
    }
    const treatmentId = pkg?.treatmentId ?? v.treatmentId;

    // Conflicts: doctor / therapist → block. Patient overlap / outside hours / package expiry → warn (confirmable).
    const conflicts = await findConflicts({
      startAt,
      endAt,
      doctorId: v.doctorId,
      therapistId: v.therapistId,
      patientId: patient.id,
      excludeIds: existing ? [existing.id] : [],
    });
    const blockers: Record<string, string> = {};
    if (conflicts.doctor) blockers.doctorId = conflictMessage("doctor", conflicts.doctor);
    if (conflicts.therapist) blockers.therapistId = conflictMessage("therapist", conflicts.therapist);
    if (Object.keys(blockers).length) throw new FieldError(blockers, Object.values(blockers)[0]);

    const warnings: string[] = [];
    if (conflicts.patient)
      warnings.push(`${patient.fullName} already has an appointment ${fmtTime(conflicts.patient.startAt)}–${fmtTime(conflicts.patient.endAt)} on ${fmtDate(conflicts.patient.startAt)}.`);
    if (outsideBranchHours(branch, startAt, endAt)) warnings.push(`This is outside ${branch.name} hours (${branch.openTime}–${branch.closeTime}).`);
    if (pkg?.expiryDate && pkg.expiryDate < startAt) warnings.push(`The package expires on ${fmtDate(pkg.expiryDate)}, before this appointment.`);
    if (!existing && startAt.getTime() < Date.now() - 15 * 60000) warnings.push("This time is in the past.");
    if (warnings.length && !v.override) throw new FieldError({ _warn: warnings.join(" ") }, "Please review the warnings below.");

    const data = {
      patientId: patient.id,
      branchId,
      treatmentId: treatmentId ?? null,
      doctorId: v.doctorId,
      therapistId: v.therapistId,
      startAt,
      endAt,
      source: v.source,
      notes: v.notes,
    };

    if (existing) {
      const after = await db.$transaction(async (tx) => {
        const a = await tx.appointment.update({ where: { id: existing.id }, data });
        if (existing.session && existing.session.status === "SCHEDULED") {
          await tx.treatmentSession.update({
            where: { id: existing.session.id },
            data: { scheduledAt: startAt, doctorId: v.doctorId, therapistId: v.therapistId, branchId, ...(treatmentId ? { treatmentId } : {}) },
          });
        }
        return a;
      });
      await audit(user.id, "UPDATE", "Appointment", existing.id, `Updated appointment for ${patient.fullName} (${fmtDate(startAt)} ${fmtTime(startAt)})`, {
        changes: diff(existing, after, ["startAt", "endAt", "doctorId", "therapistId", "treatmentId", "branchId", "source", "notes"]),
        branchId,
      });
      return { ok: true, message: "Appointment updated", id: existing.id };
    }

    const created = await db.$transaction(async (tx) => {
      const a = await tx.appointment.create({
        data: { ...data, packageId: pkg?.id ?? null, status: v.confirmed ? "CONFIRMED" : "BOOKED", createdById: user.id },
      });
      if (pkg) {
        await tx.treatmentSession.create({
          data: {
            packageId: pkg.id,
            patientId: patient.id,
            treatmentId: pkg.treatmentId,
            branchId,
            appointmentId: a.id,
            scheduledAt: startAt,
            status: "SCHEDULED",
            doctorId: v.doctorId,
            therapistId: v.therapistId,
            createdById: user.id,
          },
        });
      }
      return a;
    });
    await audit(user.id, "CREATE", "Appointment", created.id, `Booked appointment for ${patient.fullName} on ${fmtDate(startAt)} at ${fmtTime(startAt)}${pkg ? ` (package ${pkg.code})` : ""}`, { branchId });
    newId = created.id;
  });
  if (newId) redirect(`/appointments/${newId}?booked=1`);
  return result;
}

const LABEL: Record<string, string> = {
  BOOKED: "Booked",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  IN_TREATMENT: "In treatment",
  NO_SHOW: "Marked as no-show",
};

/** Simple workflow transitions: confirm, check in, start treatment, no-show (and step back). */
export async function setAppointmentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const id = String(fd.get("id") ?? "");
    const to = String(fd.get("status") ?? "") as AppointmentStatus;
    const user = await assertPermission(to === "IN_TREATMENT" || to === "CHECKED_IN" ? ["appointments.manage", "sessions.update"] : "appointments.manage");
    const a = await db.appointment.findFirst({ where: { id, deletedAt: null }, include: { patient: { select: { fullName: true } }, session: true } });
    if (!a) throw new ActionError("Appointment not found.");
    await assertBranchAccess(user, a.branchId);
    if (!NEXT_STATUS[a.status]?.includes(to)) throw new ActionError(`Can't change a ${a.status.toLowerCase().replace("_", " ")} appointment to ${to.toLowerCase().replace("_", " ")}.`);

    await db.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id },
        data: {
          status: to,
          ...(to === "CHECKED_IN" && !a.checkedInAt ? { checkedInAt: new Date() } : {}),
        },
      });
      if (to === "NO_SHOW" && a.session && a.session.status === "SCHEDULED") {
        await tx.treatmentSession.update({ where: { id: a.session.id }, data: { status: "MISSED", notes: a.session.notes ?? "Patient did not show up" } });
        if (a.session.packageId) await syncPackageProgress(a.session.packageId, tx);
      }
    });
    await audit(user.id, "STATUS", "Appointment", id, `${LABEL[to] ?? to}: ${a.patient.fullName}, ${fmtDate(a.startAt)} ${fmtTime(a.startAt)}`, {
      changes: { status: [a.status, to] },
      branchId: a.branchId,
    });
    return { ok: true, message: LABEL[to] ?? "Updated" };
  });
}

/**
 * Complete an appointment: completes its linked package session (product deduction, package
 * remaining count) or records a stand-alone completed session for one-off treatments.
 */
export async function completeAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.update");
    const o = formObject(fd);
    const a = await db.appointment.findFirst({ where: { id: o.id, deletedAt: null }, include: { patient: { select: { fullName: true } }, session: true } });
    if (!a) throw new ActionError("Appointment not found.");
    await assertBranchAccess(user, a.branchId);
    if (["COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"].includes(a.status)) throw new ActionError(`This appointment is already ${a.status.toLowerCase().replace("_", " ")}.`);

    // Backfilling a past day keeps that day's date; otherwise the session happened now.
    const performedAt = istDateKey(a.startAt) < istDateKey() ? a.startAt : new Date();
    const notes = o.notes?.trim() || null;
    const observations = o.observations?.trim() || null;

    const shortfalls = await db.$transaction(async (tx) => {
      let sessionId = a.session && a.session.status === "SCHEDULED" ? a.session.id : null;
      if (!sessionId && a.treatmentId && !a.session) {
        const s = await tx.treatmentSession.create({
          data: {
            patientId: a.patientId,
            treatmentId: a.treatmentId,
            branchId: a.branchId,
            appointmentId: a.id,
            scheduledAt: a.startAt,
            status: "SCHEDULED",
            doctorId: a.doctorId,
            therapistId: a.therapistId,
            createdById: user.id,
          },
        });
        sessionId = s.id;
      }
      if (sessionId) {
        const r = await completeSession(sessionId, { performedAt, notes, observations, doctorId: a.doctorId, therapistId: a.therapistId, userId: user.id }, tx);
        return r.shortfalls;
      }
      // Consultation-only visit without a treatment.
      await tx.appointment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: performedAt } });
      const p = await tx.patient.findUniqueOrThrow({ where: { id: a.patientId }, select: { firstVisitAt: true, lastVisitAt: true } });
      await tx.patient.update({
        where: { id: a.patientId },
        data: { firstVisitAt: p.firstVisitAt ?? performedAt, lastVisitAt: !p.lastVisitAt || p.lastVisitAt < performedAt ? performedAt : p.lastVisitAt },
      });
      return [] as { product: string; shortfall: number; unit: string }[];
    });

    await audit(user.id, "STATUS", "Appointment", a.id, `Completed appointment: ${a.patient.fullName}, ${fmtDate(a.startAt)}`, {
      changes: { status: [a.status, "COMPLETED"] },
      branchId: a.branchId,
    });
    const warn = shortfalls.length
      ? ` Stock warning — ${shortfalls.map((s) => `${s.product} short by ${s.shortfall} ${s.unit}`).join(", ")}. Inventory managers were notified.`
      : "";
    return { ok: true, message: `Appointment completed and session recorded.${warn}` };
  });
}

const CancelSchema = z.object({ id: zf.id(), reason: zf.text("Reason") });

export async function cancelAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("appointments.manage");
    const { id, reason } = parse(CancelSchema, formObject(fd));
    const a = await db.appointment.findFirst({ where: { id, deletedAt: null }, include: { patient: { select: { fullName: true } }, session: true } });
    if (!a) throw new ActionError("Appointment not found.");
    await assertBranchAccess(user, a.branchId);
    if (["COMPLETED", "CANCELLED", "RESCHEDULED"].includes(a.status)) throw new ActionError(`This appointment is already ${a.status.toLowerCase()}.`);
    await db.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
      if (a.session && a.session.status === "SCHEDULED") {
        await tx.treatmentSession.update({ where: { id: a.session.id }, data: { status: "CANCELLED", adjustmentReason: `Appointment cancelled: ${reason}` } });
      }
    });
    await audit(user.id, "CANCEL", "Appointment", id, `Cancelled appointment for ${a.patient.fullName} (${fmtDate(a.startAt)} ${fmtTime(a.startAt)}) — ${reason}`, { branchId: a.branchId });
    return { ok: true, message: "Appointment cancelled" };
  });
}

const RescheduleSchema = z.object({
  id: zf.id(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Time is required"),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  reason: zf.optText(),
  override: zf.bool(),
});

/** Move an appointment: the old one is kept as RESCHEDULED for history, a new one is booked. */
export async function rescheduleAppointmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string | null = null;
  const result = await handle(async () => {
    const user = await assertPermission("appointments.manage");
    const v = parse(RescheduleSchema, formObject(fd));
    const a = await db.appointment.findFirst({ where: { id: v.id, deletedAt: null }, include: { patient: { select: { fullName: true } }, session: true, branch: true } });
    if (!a) throw new ActionError("Appointment not found.");
    await assertBranchAccess(user, a.branchId);
    if (["COMPLETED", "CANCELLED", "RESCHEDULED"].includes(a.status)) throw new ActionError(`A ${a.status.toLowerCase()} appointment can't be rescheduled.`);

    const startAt = fromIst(v.date, v.time);
    const endAt = new Date(startAt.getTime() + (a.endAt.getTime() - a.startAt.getTime()));
    const doctorId = v.doctorId ?? a.doctorId;
    const therapistId = v.therapistId ?? a.therapistId;
    const conflicts = await findConflicts({ startAt, endAt, doctorId, therapistId, patientId: a.patientId, excludeIds: [a.id] });
    const blockers: Record<string, string> = {};
    if (conflicts.doctor) blockers.doctorId = conflictMessage("doctor", conflicts.doctor);
    if (conflicts.therapist) blockers.therapistId = conflictMessage("therapist", conflicts.therapist);
    if (Object.keys(blockers).length) throw new FieldError(blockers, Object.values(blockers)[0]);
    const warnings: string[] = [];
    if (conflicts.patient) warnings.push(`${a.patient.fullName} already has another appointment at ${fmtTime(conflicts.patient.startAt)} that day.`);
    if (outsideBranchHours(a.branch, startAt, endAt)) warnings.push(`Outside branch hours (${a.branch.openTime}–${a.branch.closeTime}).`);
    if (startAt.getTime() < Date.now() - 15 * 60000) warnings.push("The new time is in the past.");
    if (warnings.length && !v.override) throw new FieldError({ _warn: warnings.join(" ") }, "Please review the warnings below.");

    const created = await db.$transaction(async (tx) => {
      const n = await tx.appointment.create({
        data: {
          patientId: a.patientId,
          branchId: a.branchId,
          treatmentId: a.treatmentId,
          packageId: a.packageId,
          doctorId,
          therapistId,
          startAt,
          endAt,
          source: a.source,
          status: "BOOKED",
          notes: a.notes,
          rescheduledFromId: a.id,
          createdById: user.id,
        },
      });
      await tx.appointment.update({
        where: { id: a.id },
        data: { status: "RESCHEDULED", cancelReason: v.reason ? `Rescheduled: ${v.reason}` : `Rescheduled to ${fmtDate(startAt)} ${fmtTime(startAt)}` },
      });
      if (a.session && a.session.status === "SCHEDULED") {
        // Keep the old session row as a RESCHEDULED record; plan a fresh one on the new appointment.
        await tx.treatmentSession.update({
          where: { id: a.session.id },
          data: { status: "RESCHEDULED", adjustmentReason: `Moved to ${fmtDate(startAt)} ${fmtTime(startAt)}${v.reason ? ` — ${v.reason}` : ""}` },
        });
        await tx.treatmentSession.create({
          data: {
            packageId: a.session.packageId,
            patientId: a.patientId,
            treatmentId: a.session.treatmentId,
            branchId: a.branchId,
            appointmentId: n.id,
            scheduledAt: startAt,
            status: "SCHEDULED",
            doctorId,
            therapistId,
            notes: a.session.notes,
            createdById: user.id,
          },
        });
      }
      return n;
    });
    await audit(user.id, "UPDATE", "Appointment", a.id, `Rescheduled ${a.patient.fullName} from ${fmtDate(a.startAt)} ${fmtTime(a.startAt)} to ${fmtDate(startAt)} ${fmtTime(startAt)}${v.reason ? ` — ${v.reason}` : ""}`, {
      changes: { startAt: [a.startAt.toISOString(), startAt.toISOString()], newAppointmentId: created.id },
      branchId: a.branchId,
    });
    newId = created.id;
  });
  if (newId) redirect(`/appointments/${newId}?rescheduled=1`);
  return result;
}

/** Quick "next step" from list views. */
export async function quickAdvanceAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  const to = String(fd.get("status") ?? "");
  if (to === "COMPLETED") return completeAppointmentAction(prev, fd);
  return setAppointmentStatusAction(prev, fd);
}
