import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { db, type Tx } from "./db";
import { resolvePermissions, type Permission } from "./permissions";

/**
 * In-app notification to staff users (the bell in the top bar).
 * Targets either explicit `userIds`, or every active user holding `permission`
 * who can access `branchId`.
 */
export async function notifyUsers(
  opts: { permission?: Permission; branchId?: string | null; userIds?: string[]; title: string; body: string; link?: string },
  tx?: Tx,
) {
  const client = tx ?? db;
  let ids = opts.userIds ?? [];
  if (opts.permission) {
    const users = await client.user.findMany({ where: { isActive: true }, include: { role: true } });
    ids = [
      ...ids,
      ...users
        .filter((u) => {
          const perms = resolvePermissions(u.role.permissions, u.grantPermissions, u.revokePermissions);
          if (!perms.has(opts.permission!)) return false;
          if (!opts.branchId) return true;
          return u.allBranches || perms.has("branches.all") || u.branchId === opts.branchId || u.extraBranchIds.includes(opts.branchId);
        })
        .map((u) => u.id),
    ];
  }
  const unique = [...new Set(ids)];
  if (!unique.length) return 0;
  await client.notification.createMany({
    data: unique.map((userId) => ({
      channel: "IN_APP" as const,
      recipient: userId,
      userId,
      branchId: opts.branchId ?? null,
      title: opts.title,
      body: opts.body,
      link: opts.link,
      status: "SENT" as const,
      sentAt: new Date(),
    })),
  });
  return unique.length;
}

/**
 * Queue an outbound patient message (WhatsApp / SMS / email). The dispatcher
 * (`/api/cron/reminders`) sends queued messages when they fall due. `dedupeKey`
 * makes reminder generation idempotent — the same key is never queued twice.
 */
export async function queueMessage(
  input: {
    channel: Exclude<NotificationChannel, "IN_APP">;
    recipient: string;
    body: string;
    title?: string;
    patientId?: string | null;
    branchId?: string | null;
    ruleKey?: string;
    refType?: string;
    refId?: string;
    dedupeKey?: string;
    scheduledFor?: Date;
  },
  tx?: Tx,
) {
  const client = tx ?? db;
  if (input.dedupeKey) {
    const exists = await client.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    if (exists) return null;
  }
  return client.notification.create({
    data: {
      channel: input.channel,
      recipient: input.recipient,
      body: input.body,
      title: input.title,
      patientId: input.patientId ?? null,
      branchId: input.branchId ?? null,
      ruleKey: input.ruleKey,
      refType: input.refType,
      refId: input.refId,
      dedupeKey: input.dedupeKey,
      scheduledFor: input.scheduledFor ?? new Date(),
    },
  });
}

/** Fill {{placeholders}} in a reminder template. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}
