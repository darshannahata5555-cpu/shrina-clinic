"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ActionError, assertPermission, can } from "@/lib/auth";
import { assertBranchAccess, resolveWriteBranch } from "@/lib/branch";
import { FieldError, formObject, handle, parse, zf, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { fmtDate } from "@/lib/format";
import { createPackage, remainingSessions } from "@/lib/packages";
import { TREATMENT_CATEGORIES } from "@/lib/status";

// ───────────────────────── Treatment catalogue ─────────────────────────

const TreatmentSchema = z.object({
  id: zf.optId(),
  name: zf.text("Treatment name"),
  category: zf.enumOf(TREATMENT_CATEGORIES, "Category"),
  description: zf.optText(),
  defaultPrice: zf.num("Price").pipe(z.number().min(0, "Price can't be negative")),
  defaultSessions: zf.int("Sessions").pipe(z.number().min(1, "At least 1 session").max(50)),
  sessionGapDays: zf.int("Gap").pipe(z.number().min(0).max(365)),
  durationMins: zf.int("Duration").pipe(z.number().min(5, "At least 5 minutes").max(600)),
  gstRate: zf.num("GST rate").pipe(z.number().min(0).max(28)),
  validityDays: zf.int("Validity").pipe(z.number().min(1, "At least 1 day").max(3650)),
  isActive: zf.bool(),
});

export async function saveTreatmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("treatments.manage");
    const { id, ...data } = parse(TreatmentSchema, formObject(fd));
    const dupe = await db.treatment.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
    if (dupe) throw new FieldError({ name: "A treatment with this name already exists" });
    if (id) {
      const before = await db.treatment.findFirstOrThrow({ where: { id, deletedAt: null } });
      const after = await db.treatment.update({ where: { id }, data });
      await audit(user.id, "UPDATE", "Treatment", id, `Updated treatment ${after.name}`, { changes: diff(before, after, Object.keys(data)) });
      return { ok: true, message: "Treatment updated", id };
    }
    const created = await db.treatment.create({ data });
    await audit(user.id, "CREATE", "Treatment", created.id, `Added treatment ${created.name} (${data.category}, ₹${data.defaultPrice})`);
    return { ok: true, message: "Treatment added", id: created.id };
  });
}

export async function deleteTreatmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let done = false;
  const r = await handle(async () => {
    const user = await assertPermission("treatments.manage");
    const id = String(fd.get("id") ?? "");
    const t = await db.treatment.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new ActionError("Treatment not found.");
    const active = await db.treatmentPackage.count({ where: { treatmentId: id, status: "ACTIVE", deletedAt: null } });
    if (active) throw new ActionError(`${active} active package(s) use this treatment. Deactivate it instead, or wait until they finish.`);
    await db.treatment.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit(user.id, "DELETE", "Treatment", id, `Deleted treatment ${t.name} (restorable from Recycle bin)`);
    done = true;
  });
  if (done) redirect("/treatments?tab=catalog");
  return r;
}

const UsageSchema = z.object({
  treatmentId: zf.id("Treatment"),
  productId: zf.id("Product"),
  quantity: zf.num("Quantity").pipe(z.number().positive("Quantity must be more than 0").max(10000)),
});

/** Add or update the quantity of a product consumed per session of a treatment. */
export async function saveUsageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("treatments.manage");
    const v = parse(UsageSchema, formObject(fd));
    const [t, p] = await Promise.all([
      db.treatment.findFirstOrThrow({ where: { id: v.treatmentId, deletedAt: null } }),
      db.product.findFirstOrThrow({ where: { id: v.productId, deletedAt: null } }),
    ]);
    const existing = await db.treatmentProductUsage.findUnique({ where: { treatmentId_productId: { treatmentId: t.id, productId: p.id } } });
    await db.treatmentProductUsage.upsert({
      where: { treatmentId_productId: { treatmentId: t.id, productId: p.id } },
      create: { treatmentId: t.id, productId: p.id, quantity: v.quantity },
      update: { quantity: v.quantity },
    });
    await audit(user.id, existing ? "UPDATE" : "CREATE", "TreatmentProductUsage", t.id, `${t.name}: uses ${v.quantity} ${p.unit} of ${p.name} per session`, {
      changes: existing ? { quantity: [String(existing.quantity), String(v.quantity)] } : undefined,
    });
    return { ok: true, message: existing ? "Usage updated" : "Product added to treatment" };
  });
}

export async function removeUsageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("treatments.manage");
    const id = String(fd.get("id") ?? "");
    const u = await db.treatmentProductUsage.findUnique({ where: { id }, include: { product: true, treatment: true } });
    if (!u) throw new ActionError("Already removed.");
    await db.treatmentProductUsage.delete({ where: { id } });
    await audit(user.id, "DELETE", "TreatmentProductUsage", u.treatmentId, `${u.treatment.name}: stopped auto-deducting ${u.product.name}`);
    return { ok: true, message: "Removed" };
  });
}

// ───────────────────────── Treatment packages ─────────────────────────

const PackageSchema = z.object({
  patientId: zf.id("Patient"),
  treatmentId: zf.id("Treatment"),
  branchId: zf.optId(),
  name: zf.optText(),
  bodyArea: zf.optText(),
  totalSessions: zf.int("Total sessions").pipe(z.number().min(1, "At least 1 session").max(100)),
  price: zf.num("Package price").pipe(z.number().min(0, "Price can't be negative")),
  purchaseDate: zf.date("Purchase date"),
  expiryDate: zf.optDate(),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  notes: zf.optText(),
  renewedFromId: zf.optId(),
});

export async function createPackageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let newId: string | null = null;
  const r = await handle(async () => {
    const user = await assertPermission("packages.manage");
    const v = parse(PackageSchema, formObject(fd));
    const patient = await db.patient.findFirst({ where: { id: v.patientId, deletedAt: null }, select: { id: true, fullName: true, branchId: true } });
    if (!patient) throw new FieldError({ patientId: "Choose a patient" });
    const branchId = await resolveWriteBranch(v.branchId ?? patient.branchId);
    if (v.expiryDate && v.expiryDate < v.purchaseDate) throw new FieldError({ expiryDate: "Expiry must be after the purchase date" });
    if (v.renewedFromId) {
      const old = await db.treatmentPackage.findFirst({ where: { id: v.renewedFromId, deletedAt: null } });
      if (!old || old.patientId !== patient.id) throw new ActionError("The package being renewed doesn't belong to this patient.");
      await assertBranchAccess(user, old.branchId);
    }
    const pkg = await db.$transaction(async (tx) => createPackage({ ...v, branchId, userId: user.id }, tx));
    await audit(
      user.id,
      "CREATE",
      "TreatmentPackage",
      pkg.id,
      `${v.renewedFromId ? "Renewed" : "Sold"} package ${pkg.code} "${pkg.name}" to ${patient.fullName} — ${pkg.totalSessions} sessions, ₹${v.price}`,
      { branchId, changes: v.renewedFromId ? { renewedFromId: v.renewedFromId } : undefined },
    );
    newId = pkg.id;
  });
  if (newId) redirect(`/treatments/packages/${newId}?created=1`);
  return r;
}

const UpdatePackageSchema = z.object({
  id: zf.id(),
  name: zf.text("Package name"),
  bodyArea: zf.optText(),
  doctorId: zf.optId(),
  therapistId: zf.optId(),
  notes: zf.optText(),
  expiryDate: zf.optDate(),
  totalSessions: zf.int("Total sessions").pipe(z.number().min(1).max(100)),
  reason: zf.optText(),
});

/** Edit package details. Changing expiry or total sessions is an adjustment (sessions.approve) and needs a reason. */
export async function updatePackageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("packages.manage");
    const v = parse(UpdatePackageSchema, formObject(fd));
    const before = await db.treatmentPackage.findFirst({ where: { id: v.id, deletedAt: null } });
    if (!before) throw new ActionError("Package not found.");
    await assertBranchAccess(user, before.branchId);

    const expiryChanged = (before.expiryDate?.getTime() ?? null) !== (v.expiryDate?.getTime() ?? null);
    const sessionsChanged = before.totalSessions !== v.totalSessions;
    if ((expiryChanged || sessionsChanged) && !can(user, "sessions.approve"))
      throw new ActionError("Only the owner or an authorised doctor/manager can change expiry or session count.");
    if ((expiryChanged || sessionsChanged) && !v.reason) throw new FieldError({ reason: "Give a reason for this adjustment" });
    if (v.totalSessions < before.completedSessions) throw new FieldError({ totalSessions: `${before.completedSessions} sessions are already completed` });

    let status = before.status;
    const remaining = v.totalSessions - before.completedSessions;
    if (status === "EXPIRED" && v.expiryDate && v.expiryDate > new Date() && remaining > 0) status = "ACTIVE";
    if (status === "COMPLETED" && remaining > 0) status = "ACTIVE";
    if (status === "ACTIVE" && remaining <= 0) status = "COMPLETED";

    const after = await db.treatmentPackage.update({
      where: { id: v.id },
      data: {
        name: v.name,
        bodyArea: v.bodyArea,
        doctorId: v.doctorId,
        therapistId: v.therapistId,
        notes: v.notes,
        expiryDate: v.expiryDate,
        totalSessions: v.totalSessions,
        status,
      },
    });
    await audit(user.id, "UPDATE", "TreatmentPackage", v.id, `Updated package ${before.code}${v.reason ? ` — ${v.reason}` : ""}`, {
      changes: diff(before, after, ["name", "bodyArea", "doctorId", "therapistId", "notes", "expiryDate", "totalSessions", "status"]),
      branchId: before.branchId,
    });
    return { ok: true, message: "Package updated" };
  });
}

const CancelPackageSchema = z.object({ id: zf.id(), reason: zf.text("Reason") });

/** Cancel a package: its planned sessions and their appointments are cancelled too. */
export async function cancelPackageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return handle(async () => {
    const user = await assertPermission("packages.manage");
    const { id, reason } = parse(CancelPackageSchema, formObject(fd));
    const pkg = await db.treatmentPackage.findFirst({ where: { id, deletedAt: null }, include: { patient: { select: { fullName: true } } } });
    if (!pkg) throw new ActionError("Package not found.");
    await assertBranchAccess(user, pkg.branchId);
    if (pkg.status === "CANCELLED") throw new ActionError("Already cancelled.");
    const planned = await db.$transaction(async (tx) => {
      const sessions = await tx.treatmentSession.findMany({ where: { packageId: id, status: "SCHEDULED" } });
      for (const s of sessions) {
        await tx.treatmentSession.update({ where: { id: s.id }, data: { status: "CANCELLED", adjustmentReason: `Package cancelled: ${reason}` } });
        if (s.appointmentId)
          await tx.appointment.updateMany({
            where: { id: s.appointmentId, status: { in: ["BOOKED", "CONFIRMED", "CHECKED_IN"] } },
            data: { status: "CANCELLED", cancelReason: `Package cancelled: ${reason}` },
          });
      }
      await tx.treatmentPackage.update({
        where: { id },
        data: { status: "CANCELLED", notes: [pkg.notes, `Cancelled on ${fmtDate(new Date())}: ${reason}`].filter(Boolean).join("\n") },
      });
      return sessions.length;
    });
    await audit(user.id, "CANCEL", "TreatmentPackage", id, `Cancelled package ${pkg.code} for ${pkg.patient.fullName} (${remainingSessions(pkg)} sessions unused) — ${reason}`, {
      branchId: pkg.branchId,
    });
    return { ok: true, message: `Package cancelled${planned ? ` and ${planned} planned session(s) cancelled` : ""}. Issue any refund from Billing.` };
  });
}
