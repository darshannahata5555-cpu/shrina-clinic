"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, createSession, getCurrentUser } from "@/lib/auth";
import { handle, parse, formObject, zf, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { newTotpSecret, verifyTotp } from "@/lib/totp";

async function me() {
  const u = await getCurrentUser();
  if (!u) throw new ActionError("Your session has expired. Please sign in again.");
  return u;
}

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    const v = parse(z.object({ name: zf.text("Name"), phone: zf.optText() }), formObject(fd));
    await db.user.update({ where: { id: u.id }, data: v });
    await audit(u.id, "UPDATE", "User", u.id, "Updated own profile");
    return { ok: true, message: "Profile saved" };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    const v = parse(
      z
        .object({
          current: z.string().min(1, "Enter your current password"),
          next: z.string().min(8, "Use at least 8 characters").regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number"),
          confirm: z.string(),
        })
        .refine((x) => x.next === x.confirm, { path: ["confirm"], message: "Passwords don't match" }),
      formObject(fd),
    );
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!(await bcrypt.compare(v.current, row.passwordHash))) throw new ActionError("Current password is incorrect.");
    const updated = await db.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(v.next, 10), sessionVersion: { increment: 1 } },
    });
    await createSession(u.id, updated.sessionVersion); // keep this device signed in; others are signed out
    await audit(u.id, "UPDATE", "User", u.id, "Changed own password (other devices signed out)");
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  });
}

export async function start2faAction(_: ActionState): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    if (u.totpEnabled) throw new ActionError("Two-factor authentication is already on.");
    await db.user.update({ where: { id: u.id }, data: { totpSecret: newTotpSecret() } });
    return { ok: true };
  });
}

export async function confirm2faAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!row.totpSecret) throw new ActionError("Start the setup again.");
    if (!verifyTotp(row.totpSecret, String(fd.get("code") ?? ""))) throw new ActionError("That code didn't match. Check the time on your phone and try the newest code.");
    await db.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
    await audit(u.id, "UPDATE", "User", u.id, "Turned on two-factor authentication");
    return { ok: true, message: "Two-factor authentication is on" };
  });
}

export async function cancel2faSetupAction(_: ActionState): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    if (!u.totpEnabled) await db.user.update({ where: { id: u.id }, data: { totpSecret: null } });
    return { ok: true };
  });
}

export async function disable2faAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!row.totpEnabled || !row.totpSecret) throw new ActionError("Two-factor authentication is not on.");
    if (!verifyTotp(row.totpSecret, String(fd.get("code") ?? ""))) throw new ActionError("Enter a valid code from your authenticator app to turn 2FA off.");
    await db.user.update({ where: { id: u.id }, data: { totpEnabled: false, totpSecret: null } });
    await audit(u.id, "UPDATE", "User", u.id, "Turned off two-factor authentication");
    return { ok: true, message: "Two-factor authentication is off" };
  });
}

export async function signOutOthersAction(_: ActionState): Promise<ActionState> {
  return handle(async () => {
    const u = await me();
    const updated = await db.user.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } });
    await createSession(u.id, updated.sessionVersion);
    await audit(u.id, "UPDATE", "User", u.id, "Signed out of all other devices");
    return { ok: true, message: "Signed out of all other devices" };
  });
}
