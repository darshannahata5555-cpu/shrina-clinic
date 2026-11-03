import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { ActionError, requireUser, type CurrentUser } from "./auth";

export const BRANCH_COOKIE = "shrina_branch";

export type BranchScope = Awaited<ReturnType<typeof getBranchScope>>;

/**
 * The branches the signed-in user may see, and which one is currently selected
 * in the top-bar switcher. `current === null` means "All branches" (owner-style view).
 * Always filter queries with `scope.ids` (e.g. `where: { branchId: { in: scope.ids } }`).
 */
export const getBranchScope = cache(async () => {
  const user = await requireUser();
  const all = await db.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const accessible = user.allBranches
    ? all
    : all.filter((b) => b.id === user.branchId || user.extraBranchIds.includes(b.id));

  const pref = (await cookies()).get(BRANCH_COOKIE)?.value;
  let current = pref && pref !== "all" ? (accessible.find((b) => b.id === pref) ?? null) : null;
  if (!current) {
    const wantsAll = (pref === "all" || (!pref && user.allBranches)) && accessible.length > 1;
    if (!wantsAll) current = accessible.find((b) => b.id === user.branchId) ?? accessible[0] ?? null;
  }

  return {
    user,
    branches: accessible,
    current,
    isAll: current === null,
    ids: current ? [current.id] : accessible.map((b) => b.id),
    /** Branch to use when creating a record and no branch was chosen explicitly. */
    defaultBranchId: current?.id ?? user.branchId ?? accessible[0]?.id ?? null,
  };
});

/** `where` fragment restricting a query to the current branch scope. */
export async function branchFilter() {
  const scope = await getBranchScope();
  return { branchId: { in: scope.ids } };
}

export function accessibleBranchIdsFor(user: CurrentUser, allBranchIds: string[]): string[] {
  if (user.allBranches) return allBranchIds;
  return allBranchIds.filter((id) => id === user.branchId || user.extraBranchIds.includes(id));
}

/** For server actions: ensure the user may act on records of `branchId`. */
export async function assertBranchAccess(user: CurrentUser, branchId: string | null | undefined) {
  if (!branchId) throw new ActionError("Branch is required.");
  if (user.allBranches) return;
  if (branchId === user.branchId || user.extraBranchIds.includes(branchId)) return;
  throw new ActionError("You don't have access to that branch.");
}

/** Resolve the branch a new record should belong to (form value or current scope). */
export async function resolveWriteBranch(formBranchId?: string | null): Promise<string> {
  const scope = await getBranchScope();
  const id = formBranchId || scope.defaultBranchId;
  await assertBranchAccess(scope.user, id);
  return id!;
}
