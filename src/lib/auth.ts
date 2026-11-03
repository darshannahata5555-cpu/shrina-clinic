import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";
import { resolvePermissions, type Permission } from "./permissions";

export const SESSION_COOKIE = "shrina_session";
export const PENDING_2FA_COOKIE = "shrina_2fa";
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function signToken(payload: Record<string, unknown>, expiresIn: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(secret());
}

export async function verifyToken<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as T;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, sessionVersion: number) {
  const token = await signToken({ uid: userId, sv: sessionVersion }, `${SESSION_HOURS}h`);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

async function loadUser(userId: string, sv: number) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: true, branch: true, staff: { select: { id: true, fullName: true, staffType: true, code: true } } },
  });
  if (!user || !user.isActive || user.sessionVersion !== sv) return null;
  const permissions = resolvePermissions(user.role.permissions, user.grantPermissions, user.revokePermissions);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roleKey: user.role.key,
    roleName: user.role.name,
    branchId: user.branchId,
    branchName: user.branch?.name ?? null,
    extraBranchIds: user.extraBranchIds,
    allBranches: user.allBranches || permissions.has("branches.all"),
    staff: user.staff,
    totpEnabled: user.totpEnabled,
    permissions,
  };
}

/** Current signed-in user (memoised per request) or null. */
export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const payload = await verifyToken<{ uid: string; sv: number }>(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return loadUser(payload.uid, payload.sv);
});

/** For pages/layouts: redirect to login if signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function can(user: Pick<CurrentUser, "permissions"> | null | undefined, perm: Permission): boolean {
  return !!user && user.permissions.has(perm);
}

export function canAny(user: Pick<CurrentUser, "permissions"> | null | undefined, perms: Permission[]): boolean {
  return !!user && perms.some((p) => user.permissions.has(p));
}

/** For pages: redirect to /forbidden when the permission is missing. */
export async function requirePermission(perm: Permission | Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  const list = Array.isArray(perm) ? perm : [perm];
  if (!list.some((p) => user.permissions.has(p))) redirect("/forbidden");
  return user;
}

export class ActionError extends Error {}

/** For server actions: throws ActionError (caught by `action()` wrapper) when not allowed. */
export async function assertPermission(perm: Permission | Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  const list = Array.isArray(perm) ? perm : [perm];
  if (!list.some((p) => user.permissions.has(p))) throw new ActionError("You don't have permission to do that.");
  return user;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
