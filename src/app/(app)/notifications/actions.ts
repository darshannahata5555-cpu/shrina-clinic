"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertPermission, getCurrentUser, ActionError } from "@/lib/auth";
import { handle, parse, formObject, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { dispatchDue, runReminderCycle } from "@/lib/reminders";
import { sendOnChannel } from "@/lib/messaging";

/* ── My alerts (any signed-in user, own notifications only) ── */

export async function openAlertAction(fd: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = String(fd.get("id") ?? "");
  const n = await db.notification.findFirst({ where: { id, userId: user.id } });
  if (!n) redirect("/notifications");
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  redirect(n.link && n.link.startsWith("/") ? n.link : "/notifications");
}

export async function markReadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired.");
    const id = String(fd.get("id") ?? "");
    await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}

export async function markAllReadAction(): Promise<ActionState> {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Your session has expired.");
    const r = await db.notification.updateMany({ where: { userId: user.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
    return { ok: true, message: r.count ? `Marked ${r.count} alert${r.count === 1 ? "" : "s"} as read` : "No unread alerts" };
  });
}

/* ── Outbox ── */

export async function retryMessageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const id = String(fd.get("id") ?? "");
    const n = await db.notification.findUniqueOrThrow({ where: { id } });
    if (n.channel === "IN_APP") throw new ActionError("In-app alerts don't need resending.");
    const r = await sendOnChannel(n.channel, n.recipient, n.body, n.title);
    await db.notification.update({ where: { id }, data: { status: r.status, sentAt: r.status === "SENT" ? new Date() : null, error: r.error ?? null, scheduledFor: new Date() } });
    await audit(user.id, "UPDATE", "Notification", id, `Resent ${n.channel} message to ${n.recipient} — ${r.status}`, { branchId: n.branchId });
    if (r.status === "FAILED") throw new ActionError(`Send failed: ${r.error}`);
    return { ok: true, message: r.status === "SENT" ? "Message sent" : `Not sent — ${r.error}` };
  });
}

export async function dispatchNowAction(): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const r = await dispatchDue(new Date());
    await audit(user.id, "UPDATE", "Notification", null, `Dispatched due messages: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`);
    return { ok: true, message: `${r.sent} sent · ${r.failed} failed · ${r.skipped} skipped (no provider)` };
  });
}

export async function runRemindersAction(): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const r = await runReminderCycle(new Date());
    const generated = Object.values(r.generated).reduce((s, n) => s + n, 0);
    await audit(user.id, "UPDATE", "ReminderRule", null, `Ran reminders manually: ${generated} queued, ${r.dispatched.sent} sent`, { changes: r });
    return {
      ok: true,
      message: `${generated} reminder${generated === 1 ? "" : "s"} queued · ${r.dispatched.sent} sent · ${r.dispatched.skipped} logged only · ${r.dispatched.failed} failed${r.expiredPackages ? ` · ${r.expiredPackages} packages expired` : ""}`,
    };
  });
}

/* ── Reminder rules ── */

const RuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(3, "Name is required"),
  enabled: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  amount: z.coerce.number().int("Whole numbers only").min(0, "Must be 0 or more").max(10000),
  unit: z.enum(["minutes", "hours", "days"]),
  direction: z.enum(["before", "after"]),
  template: z.string().trim().min(5, "Message template is required").max(1000, "Keep messages under 1000 characters"),
});

const UNIT_MIN = { minutes: 1, hours: 60, days: 1440 } as const;

export async function saveRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const d = parse(RuleSchema, formObject(fd));
    const channels = fd.getAll("channels").map(String).filter((c) => ["WHATSAPP", "SMS", "EMAIL"].includes(c)) as ("WHATSAPP" | "SMS" | "EMAIL")[];
    if (d.enabled && channels.length === 0) throw new ActionError("Pick at least one channel, or turn the reminder off.");
    const offsetMinutes = d.amount * UNIT_MIN[d.unit] * (d.direction === "before" ? -1 : 1);
    const before = await db.reminderRule.findUniqueOrThrow({ where: { id: d.id } });
    const after = await db.reminderRule.update({
      where: { id: d.id },
      data: { name: d.name, enabled: d.enabled, offsetMinutes, channels, template: d.template },
    });
    await audit(user.id, "UPDATE", "ReminderRule", d.id, `Updated reminder "${after.name}"`, {
      changes: diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ["name", "enabled", "offsetMinutes", "channels", "template"]),
    });
    return { ok: true, message: "Reminder saved" };
  });
}

export async function toggleRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const id = String(fd.get("id") ?? "");
    const r = await db.reminderRule.findUniqueOrThrow({ where: { id } });
    await db.reminderRule.update({ where: { id }, data: { enabled: !r.enabled } });
    await audit(user.id, "STATUS", "ReminderRule", id, `${r.enabled ? "Turned off" : "Turned on"} reminder "${r.name}"`);
    return { ok: true, message: r.enabled ? "Reminder turned off" : "Reminder turned on" };
  });
}

const TestSchema = z.object({
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
  recipient: z.string().trim().min(5, "Enter a mobile number or email"),
  body: z.string().trim().min(2, "Write a message").max(1000),
});

export async function sendTestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("notifications.manage");
    const d = parse(TestSchema, formObject(fd));
    if (d.channel === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.recipient)) throw new ActionError("Enter a valid email address for email tests.");
    const r = await sendOnChannel(d.channel, d.recipient, d.body, "SHRINA test message");
    const row = await db.notification.create({
      data: { channel: d.channel, recipient: d.recipient, body: d.body, title: "Test message", status: r.status, sentAt: r.status === "SENT" ? new Date() : null, error: r.error ?? null, ruleKey: "TEST" },
    });
    await audit(user.id, "CREATE", "Notification", row.id, `Sent test ${d.channel} message to ${d.recipient} — ${r.status}`);
    if (r.status === "FAILED") throw new ActionError(`Send failed: ${r.error}`);
    return { ok: true, message: r.status === "SENT" ? "Test message sent" : "Logged only — provider not configured" };
  });
}
