import "server-only";
import { db } from "./db";

/** Option lists for selects. All are plain-serialisable so they can be passed to client components. */

export async function staffOptions(branchIds: string[], types?: ("DOCTOR" | "THERAPIST" | "RECEPTIONIST" | "MANAGER" | "ACCOUNTS" | "HR_ADMIN" | "SUPPORT")[]) {
  const rows = await db.staff.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "ON_NOTICE"] }, branchId: { in: branchIds }, ...(types ? { staffType: { in: types } } : {}) },
    select: { id: true, fullName: true, staffType: true, branchId: true, designation: true },
    orderBy: { fullName: "asc" },
  });
  return rows;
}

/** { doctors, therapists } as [value, label] tuples for <Select options>. */
export async function clinicianOptions(branchIds: string[]) {
  const rows = await staffOptions(branchIds, ["DOCTOR", "THERAPIST"]);
  return {
    doctors: rows.filter((r) => r.staffType === "DOCTOR").map((r) => [r.id, r.fullName] as const),
    therapists: rows.filter((r) => r.staffType === "THERAPIST").map((r) => [r.id, r.fullName] as const),
    all: rows,
  };
}

export async function treatmentOptions() {
  const rows = await db.treatment.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, category: true, defaultPrice: true, defaultSessions: true, durationMins: true, gstRate: true, validityDays: true, sessionGapDays: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => ({ ...r, defaultPrice: Number(r.defaultPrice), gstRate: Number(r.gstRate) }));
}

export async function branchOptions(branchIds: string[]) {
  const rows = await db.branch.findMany({ where: { id: { in: branchIds }, isActive: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  return rows;
}

/** Minimal patient payload for <PatientPicker defaultValue>. */
export async function pickedPatient(id: string | null | undefined) {
  if (!id) return null;
  const p = await db.patient.findFirst({ where: { id, deletedAt: null }, select: { id: true, code: true, fullName: true, mobile: true, branch: { select: { name: true } } } });
  return p ? { id: p.id, code: p.code, fullName: p.fullName, mobile: p.mobile, branch: p.branch.name } : null;
}
