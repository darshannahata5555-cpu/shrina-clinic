import "server-only";
import type { BranchScope } from "@/lib/branch";
import { staffOptions, treatmentOptions } from "@/lib/lookups";

export async function packageFormData(scope: BranchScope) {
  const branchIds = scope.branches.map((b) => b.id);
  const [treatments, clinicians] = await Promise.all([treatmentOptions(), staffOptions(branchIds, ["DOCTOR", "THERAPIST"])]);
  return {
    treatments: treatments.map((t) => ({ id: t.id, name: t.name, category: t.category, defaultPrice: t.defaultPrice, defaultSessions: t.defaultSessions, validityDays: t.validityDays, gstRate: t.gstRate })),
    clinicians: clinicians.map((c) => ({ id: c.id, fullName: c.fullName, staffType: c.staffType, branchId: c.branchId })),
    branches: scope.branches.map((b) => ({ id: b.id, name: b.name })),
  };
}
