"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PENDING_2FA_COOKIE, createSession, signToken, verifyToken } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { verifyTotp } from "@/lib/totp";
import type { ActionState } from "@/lib/action";

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
}

async function recentFailures(email: string) {
  return db.auditLog.count({
    where: { action: "LOGIN_FAILED", entity: "User", summary: { contains: email }, createdAt: { gte: new Date(Date.now() - LOCK_MINUTES * 60000) } },
  });
}

async function finishLogin(userId: string, sv: number, name: string, next: string): Promise<never> {
  await createSession(userId, sv);
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit(userId, "LOGIN", "User", userId, `${name} signed in`);
  (await cookies()).delete(PENDING_2FA_COOKIE);
  redirect(next);
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(fd.get("next"));
  if (!email || !password) return { ok: false, error: "Enter your email and password." };

  if ((await recentFailures(email)) >= MAX_FAILS)
    return { ok: false, error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or ask the owner to reset your password.` };

  const user = await db.user.findUnique({ where: { email } });
  const valid = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !valid) {
    await audit(user?.id, "LOGIN_FAILED", "User", user?.id, `Failed sign-in for ${email}`);
    return { ok: false, error: "Incorrect email or password." };
  }

  if (user.totpEnabled && user.totpSecret) {
    const token = await signToken({ uid: user.id, stage: "2fa" }, "5m");
    (await cookies()).set(PENDING_2FA_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
    return { ok: true, message: "2fa" };
  }
  return finishLogin(user.id, user.sessionVersion, user.name, next);
}

export async function verify2faAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const code = String(fd.get("code") ?? "");
  const next = safeNext(fd.get("next"));
  const pending = await verifyToken<{ uid: string; stage: string }>((await cookies()).get(PENDING_2FA_COOKIE)?.value);
  if (!pending || pending.stage !== "2fa") return { ok: false, error: "Your sign-in timed out. Please enter your password again.", message: "restart" };
  const user = await db.user.findUnique({ where: { id: pending.uid } });
  if (!user || !user.isActive || !user.totpSecret) return { ok: false, error: "Account unavailable." };
  if (!verifyTotp(user.totpSecret, code)) {
    await audit(user.id, "LOGIN_FAILED", "User", user.id, `Invalid 2FA code for ${user.email}`);
    return { ok: false, error: "That code is not valid. Check your authenticator app and try again." };
  }
  return finishLogin(user.id, user.sessionVersion, user.name, next);
}
