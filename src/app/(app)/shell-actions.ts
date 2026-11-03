"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { BRANCH_COOKIE } from "@/lib/branch";
import { audit } from "@/lib/audit";

export async function setBranchAction(branchId: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const allowed = branchId === "all" ? user.allBranches || user.extraBranchIds.length > 0 : user.allBranches || branchId === user.branchId || user.extraBranchIds.includes(branchId);
  if (!allowed) return;
  (await cookies()).set(BRANCH_COOKIE, branchId, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 * 180 });
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await audit(user.id, "LOGOUT", "User", user.id, `${user.name} signed out`);
  await destroySession();
  redirect("/login");
}
