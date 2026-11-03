import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { clientIp } from "./auth";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "APPROVE"
  | "REJECT"
  | "CANCEL"
  | "PAYMENT"
  | "REFUND"
  | "TRANSFER"
  | "STATUS"
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "EXPORT"
  | "IMPORT"
  | "PERMISSIONS";

/**
 * Record an important action in the audit log. Pass `tx` when inside a transaction.
 * `changes` can be any JSON-serialisable diff, e.g. { before, after } or { field: [old, new] }.
 */
export async function audit(
  userId: string | null | undefined,
  action: AuditAction,
  entity: string,
  entityId: string | null | undefined,
  summary: string,
  opts: { changes?: unknown; branchId?: string | null; tx?: Tx } = {},
) {
  let ip: string | null = null;
  try {
    ip = await clientIp();
  } catch {
    /* called outside a request (seed / cron) */
  }
  await (opts.tx ?? db).auditLog.create({
    data: {
      userId: userId ?? null,
      action,
      entity,
      entityId: entityId ?? null,
      summary,
      changes: opts.changes === undefined ? undefined : (JSON.parse(JSON.stringify(opts.changes)) as Prisma.InputJsonValue),
      branchId: opts.branchId ?? null,
      ip,
    },
  });
}

/** Shallow diff of two records, limited to the given keys. Decimals/Dates are stringified. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, keys?: string[]) {
  const out: Record<string, [unknown, unknown]> = {};
  const ks = keys ?? Object.keys(after);
  const norm = (v: unknown) =>
    v instanceof Date ? v.toISOString() : v && typeof v === "object" && "toFixed" in (v as object) ? String(v) : v;
  for (const k of ks) {
    const a = norm(before[k]);
    const b = norm(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a ?? null, b ?? null];
  }
  return out;
}
