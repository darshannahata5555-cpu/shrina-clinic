"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, assertPermission } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { handle, parse, formObject, zf, FieldError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { nextPatientCode } from "@/lib/sequence";
import { findMobileMatches } from "@/lib/patients";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optMobile = z
  .preprocess(blank, z.string().optional())
  .transform((v) => (v ? v.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "") : null))
  .refine((v) => v === null || /^\d{10}$/.test(v), "Alternate mobile must be 10 digits");

const SOURCES = ["INSTAGRAM", "FACEBOOK", "GOOGLE", "WHATSAPP", "WEBSITE", "REFERRAL", "WALK_IN", "PHONE", "OTHER"] as const;

const PatientSchema = z.object({
  id: zf.optId(),
  fullName: zf.text("Full name", 2),
  mobile: zf.mobile(),
  altMobile: optMobile,
  email: zf.optEmail(),
  dob: zf.optDate(),
  gender: z.preprocess(blank, z.enum(["FEMALE", "MALE", "OTHER"]).optional()).transform((v) => v ?? null),
  address: zf.optText(),
  city: zf.optText(),
  source: z.preprocess(blank, z.enum(SOURCES).optional()).transform((v) => v ?? null),
  referredBy: zf.optText(),
  assignedDoctorId: zf.optId(),
  branchId: zf.optId(),
  skinType: zf.optText(),
  allergies: zf.optText(),
  medicalHistory: zf.optText(),
  notes: zf.optText(),
  marketingConsent: zf.bool(),
  registeredAt: zf.optDate(),
  confirmDuplicate: zf.bool(),
});

const EDIT_KEYS = [
  "fullName", "mobile", "altMobile", "email", "dob", "gender", "address", "city", "source", "referredBy",
  "assignedDoctorId", "skinType", "allergies", "medicalHistory", "notes", "marketingConsent", "registeredAt",
] as const;

async function validateDoctor(id: string | null) {
  if (!id) return;
  const d = await db.staff.findFirst({ where: { id, deletedAt: null, staffType: "DOCTOR" }, select: { id: true } });
  if (!d) throw new FieldError({ assignedDoctorId: "Choose a doctor from the list" });
}

export async function savePatientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const result = await handle(async () => {
    const data = parse(PatientSchema, formObject(fd));
    const user = await assertPermission(data.id ? "patients.edit" : "patients.create");
    const medical = user.permissions.has("patients.medical");
    if (data.dob && data.dob > new Date()) throw new FieldError({ dob: "Date of birth can't be in the future" });
    await validateDoctor(data.assignedDoctorId);

    // Duplicate detection by mobile (all branches). On edit, only when the mobile changes.
    const existing = data.id ? await db.patient.findFirst({ where: { id: data.id, deletedAt: null }, select: { mobile: true } }) : null;
    const mobileChanged = !existing || existing.mobile !== data.mobile;
    const matches = mobileChanged ? await findMobileMatches(data.mobile, data.id) : [];
    if (matches.length && !data.confirmDuplicate) {
      const who = matches.map((m) => `${m.fullName} (${m.code}, ${m.branch.name})`).join(", ");
      throw new FieldError(
        { mobile: "This mobile number is already registered", confirmDuplicate: "Tick to register anyway" },
        `This mobile number is already registered to ${who}. Open the existing profile, or tick “Register anyway” if this is a different person (e.g. family member sharing a phone).`,
      );
    }

    const fields = {
      fullName: data.fullName,
      mobile: data.mobile,
      altMobile: data.altMobile,
      email: data.email,
      dob: data.dob,
      gender: data.gender,
      address: data.address,
      city: data.city,
      source: data.source,
      referredBy: data.referredBy,
      assignedDoctorId: data.assignedDoctorId,
      skinType: data.skinType,
      allergies: data.allergies,
      notes: data.notes,
      marketingConsent: data.marketingConsent,
      ...(medical ? { medicalHistory: data.medicalHistory } : {}),
    };

    if (data.id) {
      const before = await db.patient.findFirst({ where: { id: data.id, deletedAt: null } });
      if (!before) throw new ActionError("Patient not found.");
      await assertBranchAccess(user, before.branchId);
      const after = await db.patient.update({
        where: { id: data.id },
        data: { ...fields, ...(data.registeredAt ? { registeredAt: data.registeredAt } : {}) },
      });
      const changes = diff(before, after, [...EDIT_KEYS]);
      if (changes.medicalHistory) changes.medicalHistory = ["(confidential)", "(updated)"];
      await audit(user.id, "UPDATE", "Patient", after.id, `Updated patient ${after.fullName} (${after.code})`, { changes, branchId: after.branchId });
      target = `/patients/${after.id}`;
      return;
    }

    const branchId = await resolveWriteBranch(data.branchId);
    const created = await db.$transaction(async (tx) => {
      const p = await tx.patient.create({
        data: {
          ...fields,
          code: await nextPatientCode(tx),
          branchId,
          registeredAt: data.registeredAt ?? new Date(),
          createdById: user.id,
        },
      });
      await audit(
        user.id,
        "CREATE",
        "Patient",
        p.id,
        `Registered patient ${p.fullName} (${p.code})${matches.length ? " — registered despite duplicate mobile warning" : ""}`,
        { branchId, tx },
      );
      return p;
    });
    target = `/patients/${created.id}`;
  });
  if (result?.ok && target) redirect(target);
  return result;
}

export async function deletePatientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const result = await handle(async () => {
    const user = await assertPermission("patients.delete");
    const id = String(fd.get("id") ?? "");
    const p = await db.patient.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new ActionError("Patient not found.");
    await assertBranchAccess(user, p.branchId);
    await db.patient.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "Patient", id, `Archived patient ${p.fullName} (${p.code})`, { branchId: p.branchId });
  });
  if (result?.ok) redirect("/patients");
  return result;
}

const TransferSchema = z.object({
  id: zf.id("Patient"),
  toBranchId: zf.id("Destination branch"),
  reason: zf.optText(),
});

export async function transferPatientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("patients.transfer");
    const { id, toBranchId, reason } = parse(TransferSchema, formObject(fd));
    const p = await db.patient.findFirst({ where: { id, deletedAt: null }, include: { branch: true } });
    if (!p) throw new ActionError("Patient not found.");
    await assertBranchAccess(user, p.branchId);
    if (p.branchId === toBranchId) throw new FieldError({ toBranchId: "Patient is already registered at this branch" });
    const to = await db.branch.findFirst({ where: { id: toBranchId, isActive: true } });
    if (!to) throw new FieldError({ toBranchId: "Choose an active branch" });

    await db.$transaction(async (tx) => {
      await tx.patientTransfer.create({
        data: { patientId: id, fromBranchId: p.branchId, toBranchId, reason, transferredById: user.id },
      });
      await tx.patient.update({ where: { id }, data: { branchId: toBranchId } });
      await audit(user.id, "TRANSFER", "Patient", id, `Transferred ${p.fullName} (${p.code}) from ${p.branch.name} to ${to.name}${reason ? ` — ${reason}` : ""}`, {
        changes: { branchId: [p.branchId, toBranchId] },
        branchId: toBranchId,
        tx,
      });
    });
    return { ok: true, message: `Transferred to ${to.name}. Full history is kept.` };
  });
}
