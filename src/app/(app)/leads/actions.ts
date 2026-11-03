"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { LeadStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPermission, ActionError } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { handle, parse, formObject, zf, FieldError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { nextLeadCode, nextPatientCode } from "@/lib/sequence";
import { STATUS } from "@/lib/status";

const SOURCES = ["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "OTHER"] as const;
const STATUSES = ["NEW", "CONTACTED", "CONSULTATION_BOOKED", "TREATMENT_PURCHASED", "FOLLOW_UP", "LOST"] as const;
const label = (s: string) => STATUS.lead[s as keyof typeof STATUS.lead]?.[1] ?? s;

const LeadSchema = z.object({
  id: zf.optId(),
  name: zf.text("Name", 2),
  mobile: zf.mobile(),
  email: zf.optEmail(),
  interestedTreatment: zf.optText(),
  enquiryDate: zf.date("Enquiry date"),
  source: zf.enumOf(SOURCES, "Source"),
  branchId: zf.optId(),
  assignedToId: zf.optId(),
  followUpDate: zf.optDate(),
  notes: zf.optText(),
  estimatedValue: zf.optNum(),
});

async function loadLead(id: string) {
  const lead = await db.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw new ActionError("Lead not found.");
  return lead;
}

export async function saveLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leads.manage");
    const { id, branchId: formBranch, ...d } = parse(LeadSchema, formObject(fd));
    if (d.estimatedValue !== null && d.estimatedValue < 0) throw new ActionError("Estimated value can't be negative.");

    if (id) {
      const before = await loadLead(id);
      await assertBranchAccess(user, before.branchId);
      const branchId = formBranch ?? before.branchId;
      await assertBranchAccess(user, branchId);
      const after = await db.lead.update({ where: { id }, data: { ...d, branchId } });
      await audit(user.id, "UPDATE", "Lead", id, `Updated lead ${after.code} (${after.name})`, {
        changes: diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [...Object.keys(d), "branchId"]),
        branchId,
      });
      return { ok: true, message: "Lead updated", id };
    }

    const branchId = await resolveWriteBranch(formBranch);
    const lead = await db.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: { ...d, branchId, code: await nextLeadCode(tx), assignedToId: d.assignedToId, createdById: user.id },
      });
      await tx.leadActivity.create({ data: { leadId: created.id, type: "NOTE", note: `Enquiry received via ${d.source.replace("_", " ").toLowerCase()}${d.interestedTreatment ? ` — interested in ${d.interestedTreatment}` : ""}`, createdById: user.id } });
      await audit(user.id, "CREATE", "Lead", created.id, `Added lead ${created.code} (${created.name})`, { branchId, tx });
      return created;
    });
    return { ok: true, message: `Lead ${lead.code} added`, id: lead.id };
  });
}

/** Quick status move from the pipeline board (not LOST — that needs a reason on the lead page). */
export async function moveLeadAction(id: string, status: string): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leads.manage");
    if (!STATUSES.includes(status as LeadStatus) || status === "LOST") throw new ActionError("Choose a valid stage.");
    const lead = await loadLead(id);
    await assertBranchAccess(user, lead.branchId);
    if (lead.status === status) return { ok: true };
    await applyStatus(lead, status as LeadStatus, null, null, user.id);
    return { ok: true, message: `${lead.name} moved to ${label(status)}` };
  });
}

async function applyStatus(
  lead: { id: string; code: string; name: string; status: LeadStatus; branchId: string; convertedAt: Date | null },
  status: LeadStatus,
  reason: string | null,
  note: string | null,
  userId: string,
) {
  await db.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status,
        lostReason: status === "LOST" ? reason : null,
        convertedAt: status === "TREATMENT_PURCHASED" && !lead.convertedAt ? new Date() : undefined,
        followUpDate: status === "LOST" || status === "TREATMENT_PURCHASED" ? null : undefined,
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        note: `${label(lead.status)} → ${label(status)}${status === "LOST" && reason ? ` · Reason: ${reason}` : ""}${note ? ` · ${note}` : ""}`,
        createdById: userId,
      },
    });
    await audit(userId, "STATUS", "Lead", lead.id, `Lead ${lead.code} (${lead.name}): ${label(lead.status)} → ${label(status)}`, {
      changes: { status: [lead.status, status], ...(reason ? { lostReason: [null, reason] } : {}) },
      branchId: lead.branchId,
      tx,
    });
  });
}

const StatusSchema = z.object({
  id: zf.id(),
  status: zf.enumOf(STATUSES, "Stage"),
  reason: zf.optText(),
  note: zf.optText(),
});

export async function changeStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leads.manage");
    const d = parse(StatusSchema, formObject(fd));
    if (d.status === "LOST" && !d.reason) throw new FieldError({ reason: "Say why the lead was lost" });
    const lead = await loadLead(d.id);
    await assertBranchAccess(user, lead.branchId);
    if (lead.status === d.status && !d.note) throw new ActionError("The lead is already at that stage.");
    await applyStatus(lead, d.status, d.reason, d.note, user.id);
    return { ok: true, message: `Moved to ${label(d.status)}` };
  });
}

const ActivitySchema = z.object({
  id: zf.id(),
  type: zf.enumOf(["CALL", "WHATSAPP", "NOTE", "VISIT", "EMAIL"] as const, "Activity type"),
  note: zf.text("Note", 2),
  followUpDate: zf.optDate(),
});

export async function logActivityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leads.manage");
    const d = parse(ActivitySchema, formObject(fd));
    const lead = await loadLead(d.id);
    await assertBranchAccess(user, lead.branchId);
    await db.$transaction(async (tx) => {
      await tx.leadActivity.create({ data: { leadId: lead.id, type: d.type, note: d.note, createdById: user.id } });
      const bumpContacted = lead.status === "NEW" && ["CALL", "WHATSAPP", "VISIT", "EMAIL"].includes(d.type);
      if (d.followUpDate || bumpContacted) {
        await tx.lead.update({ where: { id: lead.id }, data: { ...(d.followUpDate ? { followUpDate: d.followUpDate } : {}), ...(bumpContacted ? { status: "CONTACTED" } : {}) } });
      }
      if (bumpContacted)
        await tx.leadActivity.create({ data: { leadId: lead.id, type: "STATUS_CHANGE", note: "New lead → Contacted", createdById: user.id } });
    });
    return { ok: true, message: "Activity logged" };
  });
}

const AssignSchema = z.object({ id: zf.id(), assignedToId: zf.optId(), followUpDate: zf.optDate() });

export async function assignLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("leads.manage");
    const d = parse(AssignSchema, formObject(fd));
    const lead = await loadLead(d.id);
    await assertBranchAccess(user, lead.branchId);
    const after = await db.lead.update({ where: { id: lead.id }, data: { assignedToId: d.assignedToId, followUpDate: d.followUpDate } });
    const changes = diff(lead as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ["assignedToId", "followUpDate"]);
    if (Object.keys(changes).length) {
      const assignee = d.assignedToId ? await db.user.findUnique({ where: { id: d.assignedToId }, select: { name: true } }) : null;
      const parts = [
        changes.assignedToId ? `assigned to ${assignee?.name ?? "nobody"}` : null,
        changes.followUpDate ? (d.followUpDate ? `follow-up set for ${d.followUpDate.toISOString().slice(0, 10)}` : "follow-up cleared") : null,
      ].filter(Boolean);
      await db.leadActivity.create({ data: { leadId: lead.id, type: "NOTE", note: parts.join(", ").replace(/^./, (c) => c.toUpperCase()), createdById: user.id } });
      await audit(user.id, "UPDATE", "Lead", lead.id, `Lead ${lead.code}: ${parts.join(", ")}`, { changes, branchId: lead.branchId });
    }
    return { ok: true, message: "Saved" };
  });
}

const ConvertSchema = z.object({
  id: zf.id(),
  branchId: zf.optId(),
  status: zf.enumOf(["CONSULTATION_BOOKED", "TREATMENT_PURCHASED"] as const, "Stage"),
  next: zf.enumOf(["stay", "patient", "appointment", "invoice"] as const, "Next step"),
});

/**
 * Convert a lead into a patient: link the existing patient with the same mobile, or register a new one
 * (keeping the lead's source). Moves the lead to the chosen stage and optionally opens booking / billing.
 */
export async function convertLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await handle(async () => {
    const user = await assertPermission("leads.manage");
    const d = parse(ConvertSchema, formObject(fd));
    const lead = await loadLead(d.id);
    await assertBranchAccess(user, lead.branchId);
    if (lead.patientId) throw new ActionError("This lead is already linked to a patient.");
    const branchId = d.branchId ?? lead.branchId;
    await assertBranchAccess(user, branchId);

    const patientId = await db.$transaction(async (tx) => {
      let patient = await tx.patient.findFirst({ where: { deletedAt: null, OR: [{ mobile: lead.mobile }, { altMobile: lead.mobile }] }, orderBy: { registeredAt: "asc" } });
      let created = false;
      if (!patient) {
        if (!user.permissions.has("patients.create")) throw new ActionError("No patient with this mobile exists and you don't have permission to register patients.");
        patient = await tx.patient.create({
          data: {
            code: await nextPatientCode(tx),
            fullName: lead.name,
            mobile: lead.mobile,
            email: lead.email,
            source: lead.source,
            branchId,
            notes: `Converted from lead ${lead.code}${lead.interestedTreatment ? ` · interested in ${lead.interestedTreatment}` : ""}`,
            createdById: user.id,
          },
        });
        created = true;
        await audit(user.id, "CREATE", "Patient", patient.id, `Registered patient ${patient.code} (${patient.fullName}) from lead ${lead.code}`, { branchId, tx });
      }
      await tx.lead.update({
        where: { id: lead.id },
        data: { patientId: patient.id, status: d.status, convertedAt: lead.convertedAt ?? new Date(), followUpDate: d.status === "TREATMENT_PURCHASED" ? null : lead.followUpDate },
      });
      await tx.leadActivity.create({
        data: {
          leadId: lead.id,
          type: "STATUS_CHANGE",
          note: `${created ? "Registered as new patient" : "Linked to existing patient"} ${patient.code} · ${label(lead.status)} → ${label(d.status)}`,
          createdById: user.id,
        },
      });
      await audit(user.id, "STATUS", "Lead", lead.id, `Converted lead ${lead.code} → patient ${patient.code}`, { changes: { status: [lead.status, d.status], patientId: [null, patient.id] }, branchId, tx });
      return patient.id;
    });

    target =
      d.next === "appointment" ? `/appointments/new?patientId=${patientId}` : d.next === "invoice" ? `/billing/new?patientId=${patientId}` : d.next === "patient" ? `/patients/${patientId}` : "";
    return { ok: true, message: "Lead converted", id: patientId };
  });
  if (res?.ok && target) redirect(target);
  return res;
}

export async function deleteLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await handle(async () => {
    const user = await assertPermission("leads.manage");
    const lead = await loadLead(String(fd.get("id") ?? ""));
    await assertBranchAccess(user, lead.branchId);
    await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "Lead", lead.id, `Deleted lead ${lead.code} (${lead.name})`, { branchId: lead.branchId });
    return { ok: true };
  });
  if (res?.ok) redirect("/leads?view=list");
  return res;
}
