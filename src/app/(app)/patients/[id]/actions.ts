"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, assertPermission, type CurrentUser } from "@/lib/auth";
import { assertBranchAccess } from "@/lib/branch";
import { handle, parse, formObject, zf, FieldError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { CONSENT_LABEL } from "@/lib/patients";

async function loadPatient(user: CurrentUser, id: string) {
  const p = await db.patient.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new ActionError("Patient not found.");
  await assertBranchAccess(user, p.branchId);
  return p;
}

// ───────────────────────── Consultations ─────────────────────────

const ConsultSchema = z.object({
  id: zf.optId(),
  patientId: zf.id("Patient"),
  branchId: zf.optId(),
  doctorId: zf.id("Doctor"),
  consultationDate: zf.dateTime("Consultation date"),
  complaint: zf.optText(),
  medicalHistory: zf.optText(),
  skinAssessment: zf.optText(),
  skinType: zf.optText(),
  treatmentRecommended: zf.optText(),
  treatmentPerformed: zf.optText(),
  productsRecommended: zf.optText(),
  homeCare: zf.optText(),
  doctorNotes: zf.optText(),
  followUpDate: zf.optDate(),
});

export async function saveConsultationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("consultations.create");
    const d = parse(ConsultSchema, formObject(fd));
    const p = await loadPatient(user, d.patientId);
    const medical = user.permissions.has("patients.medical");
    const doctor = await db.staff.findFirst({ where: { id: d.doctorId, staffType: "DOCTOR", deletedAt: null } });
    if (!doctor) throw new FieldError({ doctorId: "Choose a doctor" });
    if (d.consultationDate > new Date(Date.now() + 60 * 60000)) throw new FieldError({ consultationDate: "Consultation date can't be in the future" });
    if (!d.complaint && !d.treatmentRecommended && !d.skinAssessment && !d.treatmentPerformed)
      throw new FieldError({ complaint: "Record at least the complaint, assessment or recommendation" });

    const fields = {
      doctorId: d.doctorId,
      consultationDate: d.consultationDate,
      complaint: d.complaint,
      skinAssessment: d.skinAssessment,
      skinType: d.skinType,
      treatmentRecommended: d.treatmentRecommended,
      treatmentPerformed: d.treatmentPerformed,
      productsRecommended: d.productsRecommended,
      homeCare: d.homeCare,
      followUpDate: d.followUpDate,
      ...(medical ? { medicalHistory: d.medicalHistory, doctorNotes: d.doctorNotes } : {}),
    };

    if (d.id) {
      const before = await db.consultation.findFirst({ where: { id: d.id, patientId: p.id, deletedAt: null } });
      if (!before) throw new ActionError("Consultation not found.");
      const own = before.createdById === user.id || (user.staff && before.doctorId === user.staff.id);
      if (!own && !user.permissions.has("users.manage")) throw new ActionError("Only the consulting doctor or the owner can edit this consultation.");
      const after = await db.consultation.update({ where: { id: d.id }, data: fields });
      const changes = diff(before, after, Object.keys(fields));
      if (changes.doctorNotes) changes.doctorNotes = ["(confidential)", "(updated)"];
      if (changes.medicalHistory) changes.medicalHistory = ["(confidential)", "(updated)"];
      await audit(user.id, "UPDATE", "Consultation", d.id, `Updated consultation for ${p.fullName} (${p.code})`, { changes, branchId: before.branchId });
      return { ok: true, message: "Consultation updated" };
    }

    const branchId = d.branchId && (user.allBranches || d.branchId === user.branchId || user.extraBranchIds.includes(d.branchId)) ? d.branchId : p.branchId;
    await db.$transaction(async (tx) => {
      const c = await tx.consultation.create({ data: { ...fields, patientId: p.id, branchId, createdById: user.id } });
      await tx.patient.update({
        where: { id: p.id },
        data: {
          firstVisitAt: p.firstVisitAt ?? d.consultationDate,
          lastVisitAt: !p.lastVisitAt || p.lastVisitAt < d.consultationDate ? d.consultationDate : p.lastVisitAt,
          ...(d.skinType ? { skinType: d.skinType } : {}),
          ...(p.assignedDoctorId ? {} : { assignedDoctorId: d.doctorId }),
        },
      });
      await audit(user.id, "CREATE", "Consultation", c.id, `Recorded consultation for ${p.fullName} (${p.code}) with ${doctor.fullName}`, { branchId, tx });
    });
    return { ok: true, message: "Consultation saved" };
  });
}

export async function deleteConsultationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("consultations.create");
    const id = String(fd.get("id") ?? "");
    const c = await db.consultation.findFirst({ where: { id, deletedAt: null }, include: { patient: true } });
    if (!c) throw new ActionError("Consultation not found.");
    await assertBranchAccess(user, c.patient.branchId);
    if (c.createdById !== user.id && !user.permissions.has("users.manage")) throw new ActionError("Only the doctor who recorded it or the owner can delete this consultation.");
    await db.consultation.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "Consultation", id, `Deleted consultation of ${c.patient.fullName} dated ${c.consultationDate.toISOString().slice(0, 10)}`, { branchId: c.branchId });
    return { ok: true, message: "Consultation deleted" };
  });
}

// ───────────────────────── Photos ─────────────────────────

const PhotoSchema = z.object({
  patientId: zf.id("Patient"),
  kind: zf.enumOf(["BEFORE", "AFTER", "PROGRESS"] as const, "Photo type"),
  packageId: zf.optId(),
  treatmentId: zf.optId(),
  takenAt: zf.optDate(),
  caption: zf.optText(),
});

export async function uploadPhotosAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("photos.manage");
    const d = parse(PhotoSchema, formObject(fd));
    const p = await loadPatient(user, d.patientId);
    const consent = await db.consentRecord.findFirst({ where: { patientId: p.id, type: "PHOTO_CLINICAL", granted: true, revokedAt: null } });
    if (!consent) throw new ActionError("Record the patient's clinical photo consent (Consents & records tab) before uploading photos.");

    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) throw new FieldError({ files: "Choose at least one photo" });
    if (files.length > 12) throw new FieldError({ files: "Upload at most 12 photos at a time" });

    let treatmentId = d.treatmentId;
    if (d.packageId) {
      const pkg = await db.treatmentPackage.findFirst({ where: { id: d.packageId, patientId: p.id } });
      if (!pkg) throw new FieldError({ packageId: "Choose one of this patient's packages" });
      treatmentId = pkg.treatmentId;
    }

    const saved: string[] = [];
    for (const f of files) {
      const { relPath, mimeType } = await saveUpload(f, "photos", { kind: "image", maxMb: 10 });
      saved.push(relPath);
      await db.patientPhoto.create({
        data: {
          patientId: p.id,
          kind: d.kind,
          packageId: d.packageId,
          treatmentId,
          takenAt: d.takenAt ?? new Date(),
          caption: d.caption,
          filePath: relPath,
          mimeType,
          uploadedById: user.id,
        },
      });
    }
    await audit(user.id, "CREATE", "PatientPhoto", p.id, `Uploaded ${files.length} ${d.kind.toLowerCase()} photo${files.length > 1 ? "s" : ""} for ${p.fullName} (${p.code})`, { branchId: p.branchId });
    return { ok: true, message: `${files.length} photo${files.length > 1 ? "s" : ""} uploaded` };
  });
}

export async function approvePhotoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("photos.approve");
    const id = String(fd.get("id") ?? "");
    const ph = await db.patientPhoto.findFirst({ where: { id, deletedAt: null }, include: { patient: true } });
    if (!ph) throw new ActionError("Photo not found.");
    await assertBranchAccess(user, ph.patient.branchId);
    const approve = !ph.approved;
    await db.patientPhoto.update({ where: { id }, data: { approved: approve, approvedById: approve ? user.id : null, approvedAt: approve ? new Date() : null } });
    await audit(user.id, approve ? "APPROVE" : "UPDATE", "PatientPhoto", id, `${approve ? "Approved" : "Withdrew approval of"} ${ph.kind.toLowerCase()} photo of ${ph.patient.fullName}`, { branchId: ph.patient.branchId });
    return { ok: true, message: approve ? "Photo approved" : "Approval withdrawn" };
  });
}

export async function deletePhotoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("photos.manage");
    const id = String(fd.get("id") ?? "");
    const ph = await db.patientPhoto.findFirst({ where: { id, deletedAt: null }, include: { patient: true } });
    if (!ph) throw new ActionError("Photo not found.");
    await assertBranchAccess(user, ph.patient.branchId);
    await db.patientPhoto.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(user.id, "DELETE", "PatientPhoto", id, `Deleted ${ph.kind.toLowerCase()} photo of ${ph.patient.fullName}`, { branchId: ph.patient.branchId });
    return { ok: true, message: "Photo deleted" };
  });
}

// ───────────────────────── Consents ─────────────────────────

const ConsentSchema = z.object({
  patientId: zf.id("Patient"),
  type: zf.enumOf(["TREATMENT", "PHOTO_CLINICAL", "PHOTO_MARKETING", "COMMUNICATION"] as const, "Consent type"),
  signedAt: zf.optDate(),
  notes: zf.optText(),
});

export async function addConsentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission(["photos.manage", "patients.edit"]);
    const d = parse(ConsentSchema, formObject(fd));
    const p = await loadPatient(user, d.patientId);
    const file = fd.get("document");
    let documentPath: string | null = null;
    if (file instanceof File && file.size > 0) documentPath = (await saveUpload(file, "consents", { kind: "document", maxMb: 10 })).relPath;
    if (d.type === "PHOTO_MARKETING" && !documentPath && !d.notes)
      throw new FieldError({ notes: "Marketing use of photos needs documented consent — attach the signed form or describe how consent was taken" });

    const c = await db.consentRecord.create({
      data: { patientId: p.id, type: d.type, signedAt: d.signedAt ?? new Date(), notes: d.notes, documentPath, recordedById: user.id },
    });
    if (d.type === "COMMUNICATION" && !p.marketingConsent) await db.patient.update({ where: { id: p.id }, data: { marketingConsent: true } });
    await audit(user.id, "CREATE", "ConsentRecord", c.id, `Recorded ${CONSENT_LABEL[d.type]} for ${p.fullName} (${p.code})`, { branchId: p.branchId });
    return { ok: true, message: "Consent recorded" };
  });
}

export async function revokeConsentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission(["photos.manage", "patients.edit"]);
    const id = String(fd.get("id") ?? "");
    const c = await db.consentRecord.findFirst({ where: { id, revokedAt: null }, include: { patient: true } });
    if (!c) throw new ActionError("Consent not found or already revoked.");
    await assertBranchAccess(user, c.patient.branchId);
    await db.consentRecord.update({ where: { id }, data: { revokedAt: new Date() } });
    if (c.type === "COMMUNICATION") await db.patient.update({ where: { id: c.patientId }, data: { marketingConsent: false } });
    await audit(user.id, "STATUS", "ConsentRecord", id, `Revoked ${CONSENT_LABEL[c.type]} for ${c.patient.fullName} (${c.patient.code})`, { branchId: c.patient.branchId });
    return { ok: true, message: "Consent revoked" };
  });
}

// ───────────────────────── Medical history entries ─────────────────────────

const MedicalSchema = z.object({
  patientId: zf.id("Patient"),
  category: zf.enumOf(["CONDITION", "ALLERGY", "MEDICATION", "PROCEDURE", "PREGNANCY", "OTHER"] as const, "Category"),
  description: zf.text("Description"),
});

export async function addMedicalEntryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("patients.medical");
    const d = parse(MedicalSchema, formObject(fd));
    const p = await loadPatient(user, d.patientId);
    const e = await db.medicalHistoryEntry.create({ data: { patientId: p.id, category: d.category, description: d.description, recordedById: user.id } });
    if (d.category === "ALLERGY") {
      const allergies = p.allergies && !/^(none|nil|no)/i.test(p.allergies) ? `${p.allergies}, ${d.description}` : d.description;
      await db.patient.update({ where: { id: p.id }, data: { allergies } });
    }
    await audit(user.id, "CREATE", "MedicalHistoryEntry", e.id, `Added medical record (${d.category.toLowerCase()}) for ${p.fullName} (${p.code})`, { branchId: p.branchId });
    return { ok: true, message: "Medical record added" };
  });
}
