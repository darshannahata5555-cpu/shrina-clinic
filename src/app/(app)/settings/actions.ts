"use server";

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { saveSetting, getSetting } from "@/lib/settings";
import { ALL_PERMISSIONS, resolvePermissions } from "@/lib/permissions";

// ───────────────────────────── Users ─────────────────────────────

const UserSchema = z.object({
  id: zf.optId(),
  name: zf.text("Name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  phone: zf.optText(),
  roleId: zf.id("Role"),
  branchId: zf.optId(),
  allBranches: zf.bool(),
  staffId: zf.optId(),
  password: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(8, "Password must be at least 8 characters").optional()),
});

function generatePassword() {
  const a = randomBytes(9).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `${a}@${Math.floor(10 + Math.random() * 89)}`;
}

/** Owners must always exist: block changes that would leave no active user holding users.manage. */
async function assertStillAnAdmin(exceptUserId: string) {
  const users = await db.user.findMany({ where: { isActive: true, id: { not: exceptUserId } }, include: { role: true } });
  const ok = users.some((u) => resolvePermissions(u.role.permissions, u.grantPermissions, u.revokePermissions).has("users.manage"));
  if (!ok) throw new ActionError("At least one other active user must keep 'Manage users & permissions'.");
}

export async function saveUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("users.manage");
    const v = parse(UserSchema, formObject(fd));
    const extraBranchIds = fd.getAll("extraBranchIds").map(String).filter((b) => b && b !== v.branchId);
    if (!v.allBranches && !v.branchId) throw new ActionError("Choose a primary branch (or give access to all branches).");
    if (v.staffId) {
      const taken = await db.user.findFirst({ where: { staffId: v.staffId, id: { not: v.id ?? undefined } } });
      if (taken) throw new ActionError(`That employee is already linked to ${taken.email}.`);
    }
    const data = { name: v.name, email: v.email, phone: v.phone, roleId: v.roleId, branchId: v.branchId, allBranches: v.allBranches, extraBranchIds, staffId: v.staffId };

    if (v.id) {
      const before = await db.user.findUniqueOrThrow({ where: { id: v.id }, include: { role: true } });
      if (before.roleId !== v.roleId && before.id === me.id) throw new ActionError("You can't change your own role.");
      if (before.roleId !== v.roleId) await assertStillAnAdmin(v.id);
      const after = await db.user.update({
        where: { id: v.id },
        data: { ...data, ...(before.roleId !== v.roleId || before.allBranches !== v.allBranches ? { sessionVersion: { increment: 1 } } : {}) },
      });
      await audit(me.id, "UPDATE", "User", v.id, `Updated user ${after.email}`, { changes: diff(before, after, Object.keys(data)) });
      return { ok: true, message: "User updated", id: v.id };
    }
    const password = v.password ?? generatePassword();
    const created = await db.user.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 10) } });
    await audit(me.id, "CREATE", "User", created.id, `Created user ${created.email}`);
    return { ok: true, message: v.password ? "User created" : `User created — temporary password: ${password}`, id: created.id };
  });
}

export async function saveUserPermissionsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("users.manage");
    const id = String(fd.get("id"));
    const user = await db.user.findUniqueOrThrow({ where: { id }, include: { role: true } });
    const checked = new Set(fd.getAll("perm").map(String).filter((p) => (ALL_PERMISSIONS as string[]).includes(p)));
    const role = new Set(user.role.permissions);
    const grant = [...checked].filter((p) => !role.has(p));
    const revoke = [...role].filter((p) => !checked.has(p));
    if (id === me.id && !checked.has("users.manage")) throw new ActionError("You can't remove your own access to manage users.");
    if (!checked.has("users.manage")) await assertStillAnAdmin(id);
    await db.user.update({ where: { id }, data: { grantPermissions: grant, revokePermissions: revoke } });
    await audit(me.id, "PERMISSIONS", "User", id, `Changed permissions for ${user.email}`, {
      changes: { grant: [user.grantPermissions, grant], revoke: [user.revokePermissions, revoke] },
    });
    return { ok: true, message: "Permissions saved" };
  });
}

export async function userStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("users.manage");
    const id = String(fd.get("id"));
    const op = String(fd.get("op"));
    const user = await db.user.findUniqueOrThrow({ where: { id } });
    if (op === "toggle") {
      if (id === me.id) throw new ActionError("You can't deactivate your own account.");
      if (user.isActive) await assertStillAnAdmin(id);
      await db.user.update({ where: { id }, data: { isActive: !user.isActive, sessionVersion: { increment: 1 } } });
      await audit(me.id, "STATUS", "User", id, `${user.isActive ? "Deactivated" : "Reactivated"} user ${user.email}`);
      return { ok: true, message: user.isActive ? "User deactivated and signed out" : "User reactivated" };
    }
    if (op === "reset-password") {
      const password = generatePassword();
      await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), sessionVersion: { increment: 1 } } });
      await audit(me.id, "UPDATE", "User", id, `Reset password for ${user.email}`);
      return { ok: true, message: `New temporary password for ${user.email}: ${password}` };
    }
    if (op === "reset-2fa") {
      await db.user.update({ where: { id }, data: { totpEnabled: false, totpSecret: null, sessionVersion: { increment: 1 } } });
      await audit(me.id, "UPDATE", "User", id, `Reset two-factor authentication for ${user.email}`);
      return { ok: true, message: "2FA reset — the user can set it up again from My account" };
    }
    if (op === "signout") {
      await db.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
      await audit(me.id, "UPDATE", "User", id, `Signed out ${user.email} on all devices`);
      return { ok: true, message: "User signed out everywhere" };
    }
    throw new ActionError("Unknown operation");
  });
}

// ───────────────────────────── Roles ─────────────────────────────

export async function saveRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("users.manage");
    const id = String(fd.get("id") ?? "");
    const perms = fd.getAll("perm").map(String).filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
    if (!id) {
      const name = String(fd.get("name") ?? "").trim();
      if (name.length < 3) throw new ActionError("Give the role a name (3+ characters).");
      const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
      if (await db.role.findUnique({ where: { key } })) throw new ActionError("A role with that name already exists.");
      const r = await db.role.create({ data: { key, name, description: String(fd.get("description") ?? "") || null, permissions: perms, isSystem: false } });
      await audit(me.id, "CREATE", "Role", r.id, `Created role ${name}`);
      return { ok: true, message: "Role created" };
    }
    const role = await db.role.findUniqueOrThrow({ where: { id } });
    if (role.key === "OWNER") throw new ActionError("The Owner role always has every permission.");
    await db.role.update({ where: { id }, data: { permissions: perms } });
    const added = perms.filter((p) => !role.permissions.includes(p));
    const removed = role.permissions.filter((p) => !perms.includes(p));
    await audit(me.id, "PERMISSIONS", "Role", id, `Changed permissions of role ${role.name}`, { changes: { added, removed } });
    return { ok: true, message: `${role.name} permissions saved` };
  });
}

// ───────────────────────────── Clinic / billing / security settings ─────────────────────────────

export async function saveClinicSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("settings.manage");
    const o = formObject(fd);
    const v = parse(
      z.object({
        clinicName: zf.text("Clinic name"),
        legalName: zf.text("Legal name"),
        tagline: z.string().trim().default(""),
        phone: z.string().trim().default(""),
        email: z.string().trim().default(""),
        website: z.string().trim().default(""),
        address: z.string().trim().default(""),
        gstin: z.string().trim().toUpperCase().refine((s) => s === "" || /^\d{2}[A-Z0-9]{13}$/.test(s), "GSTIN must be 15 characters"),
        state: z.string().trim().default(""),
        stateCode: z.string().trim().default(""),
        invoiceFooter: z.string().trim().default(""),
        terms: z.string().trim().default(""),
      }),
      o,
    );
    const before = await getSetting("clinic");
    await saveSetting("clinic", v);
    await audit(me.id, "UPDATE", "Setting", "clinic", "Updated clinic details", { changes: diff(before, v) });
    return { ok: true, message: "Clinic details saved" };
  });
}

export async function saveBillingSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("settings.manage");
    const v = parse(
      z.object({
        gstEnabled: zf.bool(),
        pricesIncludeGst: zf.bool(),
        roundOff: zf.bool(),
        defaultServiceGst: zf.num("Service GST").pipe(z.number().min(0).max(28)),
        defaultProductGst: zf.num("Product GST").pipe(z.number().min(0).max(28)),
        serviceSac: z.string().trim().default(""),
        invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,3}$/, "Up to 3 letters/digits (invoice numbers must stay ≤16 characters)"),
        maxDiscountPercentWithoutApproval: zf.num("Max discount").pipe(z.number().min(0).max(100)),
      }),
      formObject(fd),
    );
    const before = await getSetting("billing");
    await saveSetting("billing", v);
    await audit(me.id, "UPDATE", "Setting", "billing", "Updated GST & invoice settings", { changes: diff(before, v) });
    return { ok: true, message: "GST & invoice settings saved" };
  });
}

export async function saveSecuritySettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const me = await assertPermission("settings.manage");
    const v = parse(z.object({ require2faForOwner: zf.bool() }), formObject(fd));
    const before = await getSetting("security");
    await saveSetting("security", v);
    await audit(me.id, "UPDATE", "Setting", "security", "Updated security settings", { changes: diff(before, v) });
    return { ok: true, message: "Security settings saved" };
  });
}
