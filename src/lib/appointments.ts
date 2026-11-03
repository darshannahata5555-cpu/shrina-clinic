import "server-only";
import type { AppointmentStatus } from "@prisma/client";
import { db, type Tx } from "./db";
import { addDaysKey, fmtTime, istDateKey, istTimeKey, weekdayOfKey } from "./format";

/** Appointment statuses that no longer occupy a time slot. */
export const INACTIVE_STATUSES: AppointmentStatus[] = ["CANCELLED", "NO_SHOW", "RESCHEDULED"];

/** Allowed simple status transitions (completion, cancellation & reschedule have their own actions). */
export const NEXT_STATUS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  BOOKED: ["CONFIRMED", "CHECKED_IN", "NO_SHOW"],
  CONFIRMED: ["BOOKED", "CHECKED_IN", "NO_SHOW"],
  CHECKED_IN: ["IN_TREATMENT", "CONFIRMED"],
  IN_TREATMENT: ["CHECKED_IN"],
};

export const OPEN_STATUSES: AppointmentStatus[] = ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_TREATMENT"];

type Slot = {
  startAt: Date;
  endAt: Date;
  doctorId?: string | null;
  therapistId?: string | null;
  patientId?: string | null;
  excludeIds?: string[];
};

/** Overlapping, still-active appointments for the doctor, therapist and patient of a proposed slot. */
export async function findConflicts(slot: Slot, tx?: Tx) {
  const client = tx ?? db;
  const base = {
    deletedAt: null,
    status: { notIn: INACTIVE_STATUSES },
    startAt: { lt: slot.endAt },
    endAt: { gt: slot.startAt },
    ...(slot.excludeIds?.length ? { id: { notIn: slot.excludeIds } } : {}),
  };
  const include = { patient: { select: { fullName: true } }, doctor: { select: { fullName: true } }, therapist: { select: { fullName: true } } };
  const [doctor, therapist, patient] = await Promise.all([
    slot.doctorId ? client.appointment.findFirst({ where: { ...base, doctorId: slot.doctorId }, include }) : null,
    slot.therapistId ? client.appointment.findFirst({ where: { ...base, therapistId: slot.therapistId }, include }) : null,
    slot.patientId ? client.appointment.findFirst({ where: { ...base, patientId: slot.patientId }, include }) : null,
  ]);
  return { doctor, therapist, patient };
}

export function conflictMessage(kind: "doctor" | "therapist", a: { startAt: Date; endAt: Date; patient: { fullName: string }; doctor: { fullName: string } | null; therapist: { fullName: string } | null }) {
  const who = kind === "doctor" ? a.doctor?.fullName : a.therapist?.fullName;
  return `${who ?? "This " + kind} is already booked ${fmtTime(a.startAt)}–${fmtTime(a.endAt)} with ${a.patient.fullName}. Choose another time or ${kind}.`;
}

/** True when the slot falls outside the branch's opening hours (IST). */
export function outsideBranchHours(branch: { openTime: string; closeTime: string }, startAt: Date, endAt: Date) {
  if (istDateKey(startAt) !== istDateKey(new Date(endAt.getTime() - 1))) return true;
  return istTimeKey(startAt) < branch.openTime || istTimeKey(endAt) > branch.closeTime;
}

/** Monday-start week containing the date key. */
export function weekStartKey(dateKey: string) {
  const wd = weekdayOfKey(dateKey);
  return addDaysKey(dateKey, -((wd + 6) % 7));
}

/** Sessions already planned (scheduled) for a package — used to stop over-booking a package. */
export async function scheduledSessionCount(packageId: string, tx?: Tx, excludeSessionId?: string) {
  return (tx ?? db).treatmentSession.count({
    where: { packageId, status: "SCHEDULED", ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
  });
}
