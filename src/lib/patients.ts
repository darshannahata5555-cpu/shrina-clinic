import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { getBranchScope } from "./branch";
import { normalizeMobile } from "./format";

/** Patients (any branch, not deleted) whose mobile or alternate mobile matches. */
export async function findMobileMatches(mobile: string, excludeId?: string | null) {
  const m = normalizeMobile(mobile);
  if (m.length < 10) return [];
  return db.patient.findMany({
    where: {
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ mobile: m }, { altMobile: m }],
    },
    select: { id: true, code: true, fullName: true, mobile: true, registeredAt: true, branchId: true, branch: { select: { name: true } } },
    orderBy: { registeredAt: "asc" },
    take: 10,
  });
}

/**
 * Load a patient the signed-in user may open (any branch they can access — patient
 * records are centralised, not limited to the currently selected branch). 404 otherwise.
 */
export async function getAccessiblePatient(id: string) {
  const scope = await getBranchScope();
  const patient = await db.patient.findFirst({
    where: { id, deletedAt: null, branchId: { in: scope.branches.map((b) => b.id) } },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      assignedDoctor: { select: { id: true, fullName: true } },
    },
  });
  if (!patient) notFound();
  return { patient, scope };
}

export const CONSENT_LABEL: Record<string, string> = {
  TREATMENT: "Treatment consent",
  PHOTO_CLINICAL: "Clinical photo consent",
  PHOTO_MARKETING: "Marketing photo consent",
  COMMUNICATION: "WhatsApp / SMS communication",
};

export const MEDICAL_CATEGORIES = [
  ["CONDITION", "Medical condition"],
  ["ALLERGY", "Allergy"],
  ["MEDICATION", "Current medication"],
  ["PROCEDURE", "Past procedure / surgery"],
  ["PREGNANCY", "Pregnancy / breastfeeding"],
  ["OTHER", "Other"],
] as const;

/** Active (granted, not revoked) consent types for a patient. */
export async function activeConsents(patientId: string) {
  const rows = await db.consentRecord.findMany({ where: { patientId, granted: true, revokedAt: null }, select: { type: true } });
  return new Set(rows.map((r) => r.type));
}

export type AccessiblePatient = Awaited<ReturnType<typeof getAccessiblePatient>>["patient"];
