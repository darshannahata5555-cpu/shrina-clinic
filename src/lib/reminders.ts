import "server-only";
import type { NotificationChannel, ReminderRule } from "@prisma/client";
import { db } from "./db";
import { queueMessage, renderTemplate } from "./notify";
import { sendOnChannel } from "./messaging";
import { lowStockProducts } from "./inventory";
import { expireOverduePackages } from "./packages";
import { fmtDate, fmtTime, istDateKey, istDayRange, toNum } from "./format";
import { resolvePermissions } from "./permissions";

/**
 * Reminder engine.
 *
 *  generateReminders(now) — scans appointments / sessions / consultations / packages / stock / leads and queues
 *  messages for each enabled ReminderRule. A rule fires at `eventTime + offsetMinutes` (negative = before).
 *  Messages are only generated while that send moment lies inside [now − grace, now + LOOKAHEAD]; the queued
 *  row's `scheduledFor` is the send moment, so the dispatcher sends it on time. Every message carries a
 *  deterministic dedupeKey (RULE:entityId:channel) so re-running is idempotent.
 *
 *  dispatchDue(now) — sends QUEUED WhatsApp/SMS/email rows that are due and records SENT / FAILED / SKIPPED.
 *
 *  runReminderCycle(now) — expire overdue packages + generate + dispatch. Called by /api/cron/reminders and
 *  by the "Run reminders now" button.
 */

const LOOKAHEAD_MS = 12 * 3600_000;
const GRACE_TIMED_MS = 2 * 3600_000; // appointment-time rules: don't send a "24h before" reminder 20h late
const GRACE_DAY_MS = 24 * 3600_000; // date-based rules (follow-up, expiry, post-care)

export const TEMPLATE_PLACEHOLDERS: Record<string, string[]> = {
  APPOINTMENT_24H: ["name", "fullName", "treatment", "branch", "date", "time", "doctor", "clinic"],
  APPOINTMENT_2H: ["name", "fullName", "treatment", "branch", "date", "time", "doctor", "clinic"],
  SESSION_UPCOMING: ["name", "fullName", "session", "package", "treatment", "branch", "date", "time", "clinic"],
  FOLLOW_UP: ["name", "fullName", "doctor", "date", "branch", "clinic"],
  PACKAGE_EXPIRY: ["name", "fullName", "package", "date", "remaining", "branch", "clinic"],
  PRODUCT_REORDER: ["product", "branch", "stock", "min", "unit"],
  POST_TREATMENT: ["name", "fullName", "treatment", "branch", "date", "clinic"],
};

export const SAMPLE_VARS: Record<string, string> = {
  name: "Priya",
  fullName: "Priya Sharma",
  treatment: "Hydra Luxe Facial",
  branch: "SHRINA Flagship",
  date: "05 Nov 2026",
  time: "4:30 PM",
  doctor: "Ananya Rao",
  session: "3",
  package: "Laser Hair Reduction – Full Body · 6 sessions",
  remaining: "2",
  product: "Hyaluronic Acid Booster Serum",
  stock: "40",
  min: "200",
  unit: "ml",
  clinic: "SHRINA",
};

type Counts = Record<string, number>;
const firstName = (n: string) => n.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0] ?? n;
const noDr = (n: string | null | undefined) => (n ? n.replace(/^Dr\.?\s*/i, "") : "your doctor");

/** Patients who have revoked communication consent. */
async function optedOut(patientIds: string[]): Promise<Set<string>> {
  if (!patientIds.length) return new Set();
  const rows = await db.consentRecord.findMany({
    where: { patientId: { in: patientIds }, type: "COMMUNICATION" },
    orderBy: { signedAt: "asc" },
    select: { patientId: true, granted: true, revokedAt: true },
  });
  const latest = new Map<string, boolean>();
  for (const r of rows) latest.set(r.patientId, r.granted && !r.revokedAt);
  return new Set([...latest.entries()].filter(([, ok]) => !ok).map(([id]) => id));
}

type Target = {
  entityId: string;
  eventAt: Date;
  patient: { id: string; fullName: string; mobile: string; email: string | null };
  branchId: string;
  vars: Record<string, string | number | null | undefined>;
  refType: string;
};

async function queueForTargets(rule: ReminderRule, targets: Target[], now: Date, graceMs: number, clinic: string): Promise<number> {
  const blocked = await optedOut([...new Set(targets.map((t) => t.patient.id))]);
  let n = 0;
  for (const t of targets) {
    if (blocked.has(t.patient.id)) continue;
    const sendAt = new Date(t.eventAt.getTime() + rule.offsetMinutes * 60000);
    if (sendAt.getTime() < now.getTime() - graceMs || sendAt.getTime() > now.getTime() + LOOKAHEAD_MS) continue;
    const body = renderTemplate(rule.template, { clinic, name: firstName(t.patient.fullName), fullName: t.patient.fullName, ...t.vars });
    for (const ch of rule.channels) {
      if (ch === "IN_APP") continue;
      const recipient = ch === "EMAIL" ? t.patient.email : t.patient.mobile;
      if (!recipient) continue;
      const row = await queueMessage({
        channel: ch,
        recipient,
        body,
        title: rule.name,
        patientId: t.patient.id,
        branchId: t.branchId,
        ruleKey: rule.key,
        refType: t.refType,
        refId: t.entityId,
        dedupeKey: `${rule.key}:${t.entityId}:${ch}`,
        scheduledFor: sendAt < now ? now : sendAt,
      });
      if (row) n++;
    }
  }
  return n;
}

/** Window of event times a rule could fire for right now. */
function eventWindow(rule: ReminderRule, now: Date, graceMs: number) {
  const off = rule.offsetMinutes * 60000;
  return { gte: new Date(now.getTime() - graceMs - off), lte: new Date(now.getTime() + LOOKAHEAD_MS - off) };
}

const patientSel = { select: { id: true, fullName: true, mobile: true, email: true, deletedAt: true } } as const;

export async function generateReminders(now = new Date()): Promise<Counts> {
  const rules = await db.reminderRule.findMany({ where: { enabled: true } });
  const clinicRow = await db.setting.findUnique({ where: { key: "clinic" } });
  const clinic = ((clinicRow?.value as { clinicName?: string } | null)?.clinicName ?? "SHRINA") as string;
  const counts: Counts = {};

  for (const rule of rules) {
    let n = 0;
    switch (rule.key) {
      case "APPOINTMENT_24H":
      case "APPOINTMENT_2H": {
        const w = eventWindow(rule, now, GRACE_TIMED_MS);
        const appts = await db.appointment.findMany({
          where: { deletedAt: null, status: { in: ["BOOKED", "CONFIRMED"] }, startAt: { ...w, gt: now } },
          include: { patient: patientSel, treatment: { select: { name: true } }, branch: { select: { name: true } }, doctor: { select: { fullName: true } } },
        });
        n = await queueForTargets(
          rule,
          appts.filter((a) => !a.patient.deletedAt).map((a) => ({
            entityId: a.id,
            eventAt: a.startAt,
            patient: a.patient,
            branchId: a.branchId,
            refType: "Appointment",
            vars: { treatment: a.treatment?.name ?? "consultation", branch: a.branch.name, date: fmtDate(a.startAt), time: fmtTime(a.startAt), doctor: noDr(a.doctor?.fullName) },
          })),
          now,
          GRACE_TIMED_MS,
          clinic,
        );
        break;
      }
      case "SESSION_UPCOMING": {
        const w = eventWindow(rule, now, GRACE_TIMED_MS);
        const sessions = await db.treatmentSession.findMany({
          where: { status: "SCHEDULED", packageId: { not: null }, scheduledAt: { ...w, gt: now } },
          include: { patient: patientSel, package: { select: { name: true, completedSessions: true, totalSessions: true } }, treatment: { select: { name: true } }, branch: { select: { name: true } } },
        });
        n = await queueForTargets(
          rule,
          sessions.filter((s) => !s.patient.deletedAt && s.scheduledAt).map((s) => ({
            entityId: s.id,
            eventAt: s.scheduledAt!,
            patient: s.patient,
            branchId: s.branchId,
            refType: "Session",
            vars: {
              session: s.sessionNumber ?? (s.package ? s.package.completedSessions + 1 : ""),
              package: s.package?.name ?? s.treatment.name,
              treatment: s.treatment.name,
              branch: s.branch.name,
              date: fmtDate(s.scheduledAt),
              time: fmtTime(s.scheduledAt),
            },
          })),
          now,
          GRACE_TIMED_MS,
          clinic,
        );
        break;
      }
      case "FOLLOW_UP": {
        // Follow-ups fire at 10:00 IST on the follow-up date (+ offset). Skipped if the patient already has a future booking.
        const w = eventWindow(rule, now, GRACE_DAY_MS);
        const consults = await db.consultation.findMany({
          where: { deletedAt: null, followUpDate: { gte: new Date(w.gte.getTime() - 10 * 3600_000), lte: w.lte } },
          include: { patient: patientSel, doctor: { select: { fullName: true } }, branch: { select: { name: true } } },
        });
        const booked = new Set(
          (
            await db.appointment.findMany({
              where: { patientId: { in: consults.map((c) => c.patientId) }, deletedAt: null, status: { in: ["BOOKED", "CONFIRMED"] }, startAt: { gt: now } },
              select: { patientId: true },
            })
          ).map((a) => a.patientId),
        );
        n = await queueForTargets(
          rule,
          consults
            .filter((c) => !c.patient.deletedAt && !booked.has(c.patientId) && c.followUpDate)
            .map((c) => ({
              entityId: c.id,
              eventAt: new Date(c.followUpDate!.getTime() + 10 * 3600_000),
              patient: c.patient,
              branchId: c.branchId,
              refType: "Consultation",
              vars: { doctor: noDr(c.doctor.fullName), date: fmtDate(c.followUpDate), branch: c.branch.name },
            })),
          now,
          GRACE_DAY_MS,
          clinic,
        );
        break;
      }
      case "PACKAGE_EXPIRY": {
        const w = eventWindow(rule, now, GRACE_DAY_MS);
        const pkgs = await db.treatmentPackage.findMany({
          where: { deletedAt: null, status: "ACTIVE", expiryDate: w },
          include: { patient: patientSel, branch: { select: { name: true } } },
        });
        n = await queueForTargets(
          rule,
          pkgs
            .filter((p) => !p.patient.deletedAt && p.totalSessions - p.completedSessions > 0 && p.expiryDate)
            .map((p) => ({
              entityId: p.id,
              eventAt: p.expiryDate!,
              patient: p.patient,
              branchId: p.branchId,
              refType: "Package",
              vars: { package: p.name, date: fmtDate(p.expiryDate), remaining: p.totalSessions - p.completedSessions, branch: p.branch.name },
            })),
          now,
          GRACE_DAY_MS,
          clinic,
        );
        break;
      }
      case "POST_TREATMENT": {
        const w = eventWindow(rule, now, GRACE_DAY_MS);
        const appts = await db.appointment.findMany({
          where: { deletedAt: null, status: "COMPLETED", OR: [{ completedAt: w }, { completedAt: null, startAt: w }], treatment: { category: { not: "Consultation" } } },
          include: { patient: patientSel, treatment: { select: { name: true } }, branch: { select: { name: true } } },
        });
        n = await queueForTargets(
          rule,
          appts
            .filter((a) => !a.patient.deletedAt && (a.completedAt ?? a.startAt) <= now)
            .map((a) => ({
              entityId: a.id,
              eventAt: a.completedAt ?? a.startAt,
              patient: a.patient,
              branchId: a.branchId,
              refType: "Appointment",
              vars: { treatment: a.treatment?.name ?? "treatment", branch: a.branch.name, date: fmtDate(a.completedAt ?? a.startAt) },
            })),
          now,
          GRACE_DAY_MS,
          clinic,
        );
        break;
      }
      case "PRODUCT_REORDER": {
        n = await productReorderAlerts(rule, now);
        break;
      }
    }
    counts[rule.key] = n;
  }

  counts.LEAD_FOLLOW_UP = await leadFollowUpAlerts(now);
  return counts;
}

/** Low-stock alerts per branch: email (rule channels) + in-app to users who manage inventory there. Once per day. */
async function productReorderAlerts(rule: ReminderRule, now: Date): Promise<number> {
  const day = istDateKey(now);
  const [branches, users] = await Promise.all([
    db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true }, include: { role: true } }),
  ]);
  const managers = users.filter((u) => resolvePermissions(u.role.permissions, u.grantPermissions, u.revokePermissions).has("inventory.manage"));
  let n = 0;
  for (const b of branches) {
    const low = await lowStockProducts([b.id]);
    if (!low.length) continue;
    const recipients = managers.filter(
      (u) => u.allBranches || resolvePermissions(u.role.permissions, u.grantPermissions, u.revokePermissions).has("branches.all") || u.branchId === b.id || u.extraBranchIds.includes(b.id),
    );
    for (const p of low) {
      const body = renderTemplate(rule.template, { product: p.name, branch: b.name, stock: toNum(p.stock), min: p.min, unit: p.unit });
      for (const u of recipients) {
        for (const ch of rule.channels) {
          if (ch === "EMAIL" && u.email) {
            const row = await queueMessage({ channel: "EMAIL", recipient: u.email, body, title: `Low stock: ${p.name}`, branchId: b.id, ruleKey: rule.key, refType: "Product", refId: p.id, dedupeKey: `${rule.key}:${p.id}:${b.id}:${u.id}:EMAIL:${day}` });
            if (row) n++;
          }
        }
        const key = `${rule.key}:${p.id}:${b.id}:${u.id}:IN_APP:${day}`;
        const exists = await db.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } });
        if (!exists) {
          await db.notification.create({
            data: { channel: "IN_APP", recipient: u.id, userId: u.id, branchId: b.id, title: `Low stock at ${b.name}`, body, link: `/inventory/${p.id}`, status: "SENT", sentAt: now, ruleKey: rule.key, refType: "Product", refId: p.id, dedupeKey: key },
          });
          n++;
        }
      }
    }
  }
  return n;
}

/** In-app reminder to the assigned staff member for leads whose follow-up is due today or overdue. Once per lead per day. */
async function leadFollowUpAlerts(now: Date): Promise<number> {
  const day = istDateKey(now);
  const { end } = istDayRange(day);
  const leads = await db.lead.findMany({
    where: { deletedAt: null, status: { notIn: ["LOST", "TREATMENT_PURCHASED"] }, followUpDate: { lt: end }, assignedToId: { not: null } },
    select: { id: true, name: true, code: true, followUpDate: true, assignedToId: true, interestedTreatment: true, branchId: true },
  });
  let n = 0;
  for (const l of leads) {
    const key = `LEAD_FOLLOW_UP:${l.id}:${day}`;
    const exists = await db.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } });
    if (exists) continue;
    const overdue = l.followUpDate! < istDayRange(day).start;
    await db.notification.create({
      data: {
        channel: "IN_APP",
        recipient: l.assignedToId!,
        userId: l.assignedToId!,
        branchId: l.branchId,
        title: overdue ? `Overdue lead follow-up: ${l.name}` : `Lead follow-up today: ${l.name}`,
        body: `${l.code}${l.interestedTreatment ? ` · interested in ${l.interestedTreatment}` : ""} — follow-up ${overdue ? `was due ${fmtDate(l.followUpDate)}` : "is due today"}.`,
        link: `/leads/${l.id}`,
        status: "SENT",
        sentAt: now,
        ruleKey: "LEAD_FOLLOW_UP",
        refType: "Lead",
        refId: l.id,
        dedupeKey: key,
      },
    });
    n++;
  }
  return n;
}

/** Send due outbound messages. */
export async function dispatchDue(now = new Date(), limit = 200) {
  const due = await db.notification.findMany({
    where: { status: "QUEUED", channel: { not: "IN_APP" }, scheduledFor: { lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const m of due) {
    const r = await sendOnChannel(m.channel as NotificationChannel, m.recipient, m.body, m.title);
    await db.notification.update({
      where: { id: m.id },
      data: { status: r.status, sentAt: r.status === "SENT" ? new Date() : null, error: r.error ?? null },
    });
    if (r.status === "SENT") out.sent++;
    else if (r.status === "FAILED") out.failed++;
    else out.skipped++;
  }
  return out;
}

export async function runReminderCycle(now = new Date()) {
  const expired = await expireOverduePackages();
  const generated = await generateReminders(now);
  const dispatched = await dispatchDue(new Date(Math.max(Date.now(), now.getTime())));
  return { ranAt: now.toISOString(), expiredPackages: expired.count, generated, dispatched };
}
