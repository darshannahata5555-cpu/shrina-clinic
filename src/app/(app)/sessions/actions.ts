"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, assertPermission } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { FieldError, formObject, handle, parse, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { fmtDate } from "@/lib/format";
import { completeSession, remainingSessions, syncPackageProgress } from "@/lib/packages";

type Shortfall = { product: string; shortfall: number; unit: string };
const shortfallText = (s: Shortfall[]) =>
  s.length ? ` Stock warning — ${s.map((x) => `${x.product} short by ${x.shortfall} ${x.unit}`).join(", ")}. Inventory managers were notified.` : "";

async function loadSession(id: string) {
  const s = await db.treatmentSession.findUnique({
    where: { id },
    include: { patient: { select: { fullName: true } }, treatment: { select: { name: true } }, package: { select: { code: true, totalSessions: true, completedSessions: true } } },
  });
  if (!s) throw new ActionError("Session not found.");
  return s;
}

const CompleteSchema = z.object({
  sessionId: zf.id(),
  performedAt: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).optional()),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  notes: zf.optText(),
  observations: zf.optText(),
});

/** Mark a planned session as done (deducts product usage, updates package remaining sessions). */
export async function completeSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.update");
    const v = parse(CompleteSchema, formObject(fd));
    const s = await loadSession(v.sessionId);
    await assertBranchAccess(user, s.branchId);
    if (s.status !== "SCHEDULED") throw new ActionError(`This session is ${s.status.toLowerCase()} — only planned sessions can be marked done.`);
    const performedAt = v.performedAt ? new Date(`${v.performedAt.slice(0, 16)}:00+05:30`) : new Date();
    if (performedAt.getTime() > Date.now() + 5 * 60000) throw new FieldError({ performedAt: "Can't record a session in the future" });
    const r = await db.$transaction((tx) =>
      completeSession(
        s.id,
        { performedAt, doctorId: v.doctorId ?? undefined, therapistId: v.therapistId ?? undefined, notes: v.notes ?? undefined, observations: v.observations ?? undefined, userId: user.id },
        tx,
      ),
    );
    await audit(user.id, "STATUS", "TreatmentSession", s.id, `Session done: ${s.patient.fullName} — ${s.treatment.name}${s.package ? ` (${s.package.code}, session ${r.session.sessionNumber})` : ""}`, {
      changes: { status: ["SCHEDULED", "COMPLETED"] },
      branchId: s.branchId,
    });
    return { ok: true, message: `Session marked done.${shortfallText(r.shortfalls)}` };
  });
}

const MarkSchema = z.object({ sessionId: zf.id(), status: z.enum(["MISSED", "CANCELLED"]), reason: zf.optText() });

/** Planned session → Missed (patient didn't come) or Cancelled. Neither uses up a package session. */
export async function markSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.update");
    const v = parse(MarkSchema, formObject(fd));
    const s = await loadSession(v.sessionId);
    await assertBranchAccess(user, s.branchId);
    if (s.status !== "SCHEDULED") throw new ActionError("Only planned sessions can be marked missed or cancelled.");
    const reason = v.reason ?? (v.status === "MISSED" ? "Patient did not attend" : "Cancelled");
    await db.$transaction(async (tx) => {
      await tx.treatmentSession.update({ where: { id: s.id }, data: { status: v.status, adjustmentReason: reason } });
      if (s.appointmentId)
        await tx.appointment.updateMany({
          where: { id: s.appointmentId, status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT"] } },
          data: v.status === "MISSED" ? { status: "NO_SHOW" } : { status: "CANCELLED", cancelReason: reason },
        });
      if (s.packageId) await syncPackageProgress(s.packageId, tx);
    });
    await audit(user.id, "STATUS", "TreatmentSession", s.id, `Session ${v.status === "MISSED" ? "missed" : "cancelled"}: ${s.patient.fullName} — ${s.treatment.name} (${reason})`, {
      changes: { status: ["SCHEDULED", v.status] },
      branchId: s.branchId,
    });
    return { ok: true, message: v.status === "MISSED" ? "Marked as missed" : "Session cancelled" };
  });
}

const WalkInSchema = z.object({
  packageId: zf.id("Package"),
  performedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Date & time required"),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  notes: zf.optText(),
  observations: zf.optText(),
});

/** Record a session done without a prior appointment (walk-in / backfill). */
export async function walkInSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.update");
    const v = parse(WalkInSchema, formObject(fd));
    const pkg = await db.treatmentPackage.findFirst({ where: { id: v.packageId, deletedAt: null }, include: { patient: { select: { fullName: true } } } });
    if (!pkg) throw new ActionError("Package not found.");
    await assertBranchAccess(user, pkg.branchId);
    if (pkg.status !== "ACTIVE") throw new ActionError(`This package is ${pkg.status.toLowerCase()}.`);
    if (remainingSessions(pkg) <= 0) throw new ActionError("No sessions left in this package.");
    const performedAt = new Date(`${v.performedAt.slice(0, 16)}:00+05:30`);
    if (performedAt.getTime() > Date.now() + 5 * 60000) throw new FieldError({ performedAt: "Can't record a session in the future" });
    const r = await db.$transaction(async (tx) => {
      const s = await tx.treatmentSession.create({
        data: {
          packageId: pkg.id,
          patientId: pkg.patientId,
          treatmentId: pkg.treatmentId,
          branchId: pkg.branchId,
          scheduledAt: performedAt,
          status: "SCHEDULED",
          doctorId: v.doctorId ?? pkg.doctorId,
          therapistId: v.therapistId ?? pkg.therapistId,
          createdById: user.id,
        },
      });
      return completeSession(s.id, { performedAt, notes: v.notes, observations: v.observations, userId: user.id }, tx);
    });
    await audit(user.id, "CREATE", "TreatmentSession", r.session.id, `Recorded walk-in session ${r.session.sessionNumber} of ${pkg.code} for ${pkg.patient.fullName} (${fmtDate(performedAt)})`, {
      branchId: pkg.branchId,
    });
    return { ok: true, message: `Session ${r.session.sessionNumber} recorded.${shortfallText(r.shortfalls)}` };
  });
}

const NotesSchema = z.object({ sessionId: zf.id(), notes: zf.optText(), observations: zf.optText() });

export async function updateSessionNotesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.update");
    const v = parse(NotesSchema, formObject(fd));
    const s = await loadSession(v.sessionId);
    await assertBranchAccess(user, s.branchId);
    const after = await db.treatmentSession.update({ where: { id: s.id }, data: { notes: v.notes, observations: v.observations } });
    await audit(user.id, "UPDATE", "TreatmentSession", s.id, `Updated session notes: ${s.patient.fullName} — ${s.treatment.name}`, {
      changes: diff(s, after, ["notes", "observations"]),
      branchId: s.branchId,
    });
    return { ok: true, message: "Notes saved" };
  });
}

/** Doctor / owner sign-off on a completed session record. */
export async function approveSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.approve");
    const s = await loadSession(String(fd.get("sessionId") ?? ""));
    await assertBranchAccess(user, s.branchId);
    if (s.status !== "COMPLETED") throw new ActionError("Only completed sessions can be approved.");
    if (s.approvedAt) throw new ActionError("Already approved.");
    await db.treatmentSession.update({ where: { id: s.id }, data: { approvedById: user.id, approvedAt: new Date() } });
    await audit(user.id, "APPROVE", "TreatmentSession", s.id, `Approved session record: ${s.patient.fullName} — ${s.treatment.name}`, { branchId: s.branchId });
    return { ok: true, message: "Session approved" };
  });
}

/** Bulk approve all unapproved completed sessions currently listed (by id). */
export async function approveManySessionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.approve");
    const ids = String(fd.get("ids") ?? "").split(",").filter(Boolean);
    if (!ids.length) throw new ActionError("Nothing to approve.");
    const rows = await db.treatmentSession.findMany({ where: { id: { in: ids }, status: "COMPLETED", approvedAt: null }, select: { id: true, branchId: true } });
    for (const r of rows) await assertBranchAccess(user, r.branchId);
    await db.treatmentSession.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { approvedById: user.id, approvedAt: new Date() } });
    await audit(user.id, "APPROVE", "TreatmentSession", null, `Approved ${rows.length} session record(s)`, { changes: { ids: rows.map((r) => r.id) } });
    return { ok: true, message: `${rows.length} session(s) approved` };
  });
}

const AdjustSchema = z.object({
  sessionId: zf.id(),
  status: z.enum(["COMPLETED", "MISSED", "CANCELLED"], { error: "Choose the corrected status" }),
  reason: zf.text("Reason for adjustment", 5),
});

/**
 * Correct a session record (authorised users only), e.g. a session wrongly marked done is
 * reverted to Cancelled. The package's completed / remaining counts are recalculated.
 */
export async function adjustSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("sessions.approve");
    const v = parse(AdjustSchema, formObject(fd));
    const s = await loadSession(v.sessionId);
    await assertBranchAccess(user, s.branchId);
    if (s.status === v.status) throw new FieldError({ status: "The session already has this status" });
    if (s.status === "RESCHEDULED") throw new ActionError("Rescheduled entries are history records and can't be changed.");

    let note = "";
    await db.$transaction(async (tx) => {
      if (v.status === "COMPLETED") {
        // Reinstate as done: reopen then complete (product stock is deducted only if not done before).
        await tx.treatmentSession.update({ where: { id: s.id }, data: { status: "SCHEDULED" } });
        await completeSession(s.id, { performedAt: s.performedAt ?? s.scheduledAt ?? new Date(), userId: user.id }, tx);
      } else {
        await tx.treatmentSession.update({ where: { id: s.id }, data: { status: v.status } });
        if (s.appointmentId)
          await tx.appointment.updateMany({
            where: { id: s.appointmentId },
            data: v.status === "MISSED" ? { status: "NO_SHOW" } : { status: "CANCELLED", cancelReason: `Adjusted: ${v.reason}` },
          });
        if (s.status === "COMPLETED" && s.stockDeducted) note = " Products already used were not returned to stock — adjust in Inventory if needed.";
      }
      await tx.treatmentSession.update({
        where: { id: s.id },
        data: { adjustmentReason: v.reason, approvedById: user.id, approvedAt: new Date(), ...(v.status !== "COMPLETED" ? { sessionNumber: null } : {}) },
      });
      if (s.packageId) {
        await syncPackageProgress(s.packageId, tx);
        // Keep session numbers 1..n in date order after a correction.
        const done = await tx.treatmentSession.findMany({ where: { packageId: s.packageId, status: "COMPLETED" }, orderBy: [{ performedAt: "asc" }, { createdAt: "asc" }], select: { id: true, sessionNumber: true } });
        for (const [i, d] of done.entries()) if (d.sessionNumber !== i + 1) await tx.treatmentSession.update({ where: { id: d.id }, data: { sessionNumber: i + 1 } });
      }
    });
    await audit(user.id, "UPDATE", "TreatmentSession", s.id, `Adjusted session: ${s.patient.fullName} — ${s.treatment.name}: ${s.status} → ${v.status} (${v.reason})`, {
      changes: { status: [s.status, v.status], reason: v.reason },
      branchId: s.branchId,
    });
    return { ok: true, message: `Session adjusted.${note}` };
  });
}

/** Quick list action: complete or miss with defaults. */
export async function quickSessionAction(prev: ActionState, fd: FormData): Promise<ActionState> {
  const to = String(fd.get("to") ?? "");
  if (to === "COMPLETED") return completeSessionAction(prev, fd);
  fd.set("status", to);
  return markSessionAction(prev, fd);
}
