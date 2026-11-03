import "server-only";
import { db } from "@/lib/db";
import type { BranchScope } from "@/lib/branch";
import { staffOptions } from "@/lib/lookups";

/** Option lists shared by the new / edit appointment pages. */
export async function appointmentFormData(scope: BranchScope) {
  const branchIds = scope.branches.map((b) => b.id);
  const [treatments, clinicians, branches] = await Promise.all([
    db.treatment.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, category: true, durationMins: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    staffOptions(branchIds, ["DOCTOR", "THERAPIST"]),
    db.branch.findMany({ where: { id: { in: branchIds }, isActive: true }, select: { id: true, name: true, openTime: true, closeTime: true }, orderBy: { name: "asc" } }),
  ]);
  return { treatments, clinicians: clinicians.map((c) => ({ id: c.id, fullName: c.fullName, staffType: c.staffType, branchId: c.branchId })), branches };
}
