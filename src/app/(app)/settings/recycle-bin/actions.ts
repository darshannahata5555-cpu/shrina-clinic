"use server";

import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { handle, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { assertBranchAccess } from "@/lib/branch";
import { RECYCLE_TYPES } from "./types";

/** Restore a soft-deleted record (clears deletedAt). */
export async function restoreAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("recycle.manage");
    const type = String(fd.get("type"));
    const id = String(fd.get("id"));
    const def = RECYCLE_TYPES.find((t) => t.key === type);
    if (!def) throw new ActionError("Unknown record type");
    // Each delegate shares the same findUnique/update signature for deletedAt.
    const delegate = (db as unknown as Record<string, { findUnique: (a: object) => Promise<Record<string, unknown> | null>; update: (a: object) => Promise<Record<string, unknown>> }>)[def.model]!;
    const existing = await delegate.findUnique({ where: { id } });
    if (!existing) throw new ActionError("The record no longer exists.");
    if (def.branch) await assertBranchAccess(user, existing.branchId as string);
    const row = await delegate.update({ where: { id }, data: { deletedAt: null } });
    const label = String(row[def.labelField] ?? id);
    await audit(user.id, "RESTORE", def.entity, id, `Restored ${def.label.toLowerCase()} ${label}`, { branchId: (row.branchId as string) ?? null });
    return { ok: true, message: `${def.label} restored` };
  });
}
