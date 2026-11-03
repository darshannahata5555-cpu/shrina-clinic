import "server-only";
import { db } from "@/lib/db";
import { resolvePermissions } from "@/lib/permissions";

export const LEAD_PIPELINE = ["NEW", "CONTACTED", "CONSULTATION_BOOKED", "TREATMENT_PURCHASED", "FOLLOW_UP"] as const;
export const OPEN_STATUSES = ["NEW", "CONTACTED", "CONSULTATION_BOOKED", "FOLLOW_UP"] as const;

/** Active users who can work leads and can access at least one of `branchIds`. */
export async function assignableUsers(branchIds: string[]) {
  const users = await db.user.findMany({ where: { isActive: true }, include: { role: true }, orderBy: { name: "asc" } });
  return users
    .filter((u) => {
      const perms = resolvePermissions(u.role.permissions, u.grantPermissions, u.revokePermissions);
      if (!perms.has("leads.view") && !perms.has("leads.manage")) return false;
      if (u.allBranches || perms.has("branches.all")) return true;
      return branchIds.some((b) => b === u.branchId || u.extraBranchIds.includes(b));
    })
    .map((u) => ({ id: u.id, name: u.name, role: u.role.name }));
}

export async function treatmentNames() {
  const rows = await db.treatment.findMany({ where: { deletedAt: null, isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}
